'use strict';
/**
 * 一幕·YIMU 桌面运行时入口（纯本地模式）
 * ---------------------------------------------------------------------------
 * 桌面安装包内的全部环境由本进程拉起，用户无需安装 Node / PostgreSQL / Redis：
 *
 *   1. 内嵌 PostgreSQL（embedded-postgres）+ 首次 initdb 建库、建角色、建表、跑增量迁移
 *   2. 后端 NestJS（dist/server/main.js，端口 3000-3099 自动选）
 *   3. 本地网关（scripts/gateway.js，伺服 dist/client + 代理 /api + 注入单用户身份）
 *   4. 健康检查通过后向壳层输出 `YIMU_READY <url>`，壳层据此加载 WebView
 *
 * Redis 不打包：job-worker 自带「无 Redis 即进程内串行」的降级路径。
 * 数据全部落在用户数据目录（macOS: ~/Library/Application Support/<bundle-id>）。
 *
 * 调用方：Tauri 壳（desktop/src-tauri/src/lib.rs）以 sidecar 方式启动本文件。
 * 也可以手工调试：YIMU_DATA_DIR=/tmp/yimu-node node desktop/runtime/launch.cjs
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');

const log = require('./lib/log.cjs');
const { pick } = require('./lib/ports.cjs');
const { Database } = require('./lib/database.cjs');

/**
 * 应用目录：打包后 launch.cjs 就在包根（/app 或 Resources/app），
 * 开发时在 desktop/runtime/ 下。用「有没有 dist/server/main.js」判定，
 * 不能写死 __dirname/../..（容器里会解析成根目录 /）。
 */
function resolveAppDir() {
  const candidates = [
    process.env.YIMU_APP_DIR,
    __dirname,
    path.resolve(__dirname, '..', '..'),
  ].filter(Boolean);
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'dist', 'server', 'main.js'))) return path.resolve(dir);
  }
  return path.resolve(process.env.YIMU_APP_DIR || candidates[1]);
}

const APP_DIR = resolveAppDir();
const DATA_DIR = path.resolve(
  process.env.YIMU_DATA_DIR || path.join(os.homedir(), '.yimu-desktop'),
);
const LOG_DIR = path.join(DATA_DIR, 'logs');
const RUNTIME_FILE = path.join(DATA_DIR, 'runtime.json');
const SECRET_FILE = path.join(DATA_DIR, 'secrets.json');

const children = [];
let database = null;
let shuttingDown = false;

/* ------------------------------------------------------------------ 工具 */

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function httpGet(url, timeoutMs = 2000) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      res.resume();
      resolve({ ok: res.statusCode >= 200 && res.statusCode < 400, status: res.statusCode, location: res.headers.location });
    });
    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, status: 0 });
    });
    req.on('error', () => resolve({ ok: false, status: 0 }));
  });
}

async function waitHttp(url, { timeoutMs = 90000, follow = 0 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await httpGet(url);
    if (res.ok || (res.status >= 300 && res.status < 400 && follow > 0)) return true;
    await sleep(500);
  }
  return false;
}

/** 首次运行生成并持久化密钥：YIMU_KEY_SECRET 用于 Provider 密钥加密（64 hex） */
function loadSecrets() {
  if (fs.existsSync(SECRET_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(SECRET_FILE, 'utf8'));
    } catch (err) {
      log.warn(`secrets.json 解析失败，将重新生成：${err.message}`);
    }
  }
  const secrets = {
    YIMU_KEY_SECRET: crypto.randomBytes(32).toString('hex'),
    ENTERPRISE_ADMIN_TOKEN: crypto.randomBytes(32).toString('hex'),
    createdAt: new Date().toISOString(),
  };
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(SECRET_FILE, JSON.stringify(secrets, null, 2), { mode: 0o600 });
  log.info('已生成本机密钥（YIMU_KEY_SECRET / ENTERPRISE_ADMIN_TOKEN）');
  return secrets;
}

/** 单实例：第二次双击同一应用时不再起第二套 PG，直接复用已就绪的地址 */
async function reuseRunningInstance() {
  if (!fs.existsSync(RUNTIME_FILE)) return null;
  try {
    const info = JSON.parse(fs.readFileSync(RUNTIME_FILE, 'utf8'));
    if (!info.url || !info.pid) return null;
    // pid 仍存活 + 网关可访问 → 直接复用
    try {
      process.kill(info.pid, 0);
    } catch {
      return null;
    }
    const res = await httpGet(info.url, 1500);
    if (res.ok) return info.url;
    return null;
  } catch {
    return null;
  }
}

function startChild(name, args, env, cwd) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const out = fs.openSync(path.join(LOG_DIR, `${name}.log`), 'a');
  const child = spawn(process.execPath, args, {
    cwd,
    env,
    stdio: ['ignore', out, out],
    // Windows 下 detached 会让子进程脱离控制台，避免黑窗闪烁
    windowsHide: true,
  });
  child.__name = name;
  children.push(child);
  child.on('exit', (code, signal) => {
    if (shuttingDown) return;
    if (code !== 0) log.error(`${name} 异常退出（code=${code} signal=${signal}），详见 logs/${name}.log`);
  });
  child.on('error', (err) => log.error(`${name} 启动失败：${err.message}`));
  log.info(`已启动 ${name}（pid ${child.pid}）`);
  return child;
}

function tailLog(name, lines = 15) {
  const file = path.join(LOG_DIR, `${name}.log`);
  try {
    const text = fs.readFileSync(file, 'utf8').trim().split('\n');
    return text.slice(-lines).join('\n');
  } catch {
    return '（无日志）';
  }
}

/* -------------------------------------------------------------- 生命周期 */

function cleanup() {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info('正在关闭桌面运行时…');

  // 注意：不能用 child.killed 判断存活——kill() 一调用它就变 true，
  // 导致 2 秒后的 SIGKILL 升级永远不会执行，后端/网关会变成孤儿进程一直占着端口和内存。
  const alive = (child) => child.exitCode === null && child.signalCode === null;

  for (const child of [...children].reverse()) {
    try {
      if (alive(child)) child.kill('SIGTERM');
    } catch {
      /* ignore */
    }
  }
  // 给后端 2 秒优雅退出（enableShutdownHooks 会收尾在途任务），再强杀
  setTimeout(() => {
    for (const child of children) {
      try {
        if (alive(child)) child.kill('SIGKILL');
      } catch {
        /* ignore */
      }
    }
  }, 2000);

  try {
    fs.rmSync(RUNTIME_FILE, { force: true });
  } catch {
    /* ignore */
  }

  const finish = () => process.exit(0);
  if (database) {
    database.stop().then(finish).catch(finish);
    setTimeout(finish, 12000);
  } else {
    finish();
  }
}

/* ------------------------------------------------------------------ 主流程 */

async function main() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  log.init(LOG_DIR);
  log.info(`应用目录：${APP_DIR}`);
  log.info(`数据目录：${DATA_DIR}`);

  const running = await reuseRunningInstance();
  if (running) {
    log.info(`检测到已在运行的实例，直接复用：${running}`);
    log.ready(running);
    return;
  }

  // 端口默认自动挑选（桌面端要避开用户已占用的端口）；
  // 容器里需要固定端口对外映射，可用 YIMU_*_PORT 显式指定。
  const serverPort = Number(process.env.YIMU_SERVER_PORT) || (await pick(3000, 3099, '后端'));
  const gatewayPort = Number(process.env.YIMU_GATEWAY_PORT) || (await pick(5100, 5199, '网关'));
  const pgPort = Number(process.env.YIMU_PG_PORT) || (await pick(5433, 5499, 'PostgreSQL'));
  // 桌面端只监听回环；容器需要 0.0.0.0 才能被宿主机访问
  const listenHost = process.env.YIMU_LISTEN_HOST || '127.0.0.1';
  log.info(`端口分配：后端 ${serverPort} / 网关 ${gatewayPort} / 数据库 ${pgPort}`);


  const secrets = loadSecrets();

  database = new Database({ dataDir: DATA_DIR, port: pgPort });
  await database.start();
  await database.bootstrapSchema(APP_DIR);
  await database.migrate(APP_DIR);
  // 起完就交给看门狗：数据库若被系统杀掉，自动拉起，避免全站接口无限等待
  database.startWatchdog();

  const uploadDir = path.join(DATA_DIR, 'uploads');
  fs.mkdirSync(uploadDir, { recursive: true });

  // 包内自带的 ffmpeg：显式告知后端，避免它去猜 /usr/bin（Windows 上不存在）
  let ffmpegPath = process.env.FFMPEG_PATH || '';
  if (!ffmpegPath) {
    const bundled = path.join(APP_DIR, 'bin', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
    if (fs.existsSync(bundled)) {
      ffmpegPath = bundled;
      log.info(`ffmpeg：包内自带 ${bundled}`);
    } else {
      log.info('ffmpeg：包内未自带，使用系统 PATH 中的 ffmpeg');
    }
  }

  const baseEnv = {
    ...process.env,
    NODE_ENV: 'development',
    SUDA_DATABASE_URL: database.urlWithSchema,
    DATABASE_URL: database.url,
    REDIS_URL: '',
    UPLOAD_DIR: uploadDir,
    YIMU_KEY_SECRET: secrets.YIMU_KEY_SECRET,
    ENTERPRISE_ADMIN_TOKEN: secrets.ENTERPRISE_ADMIN_TOKEN,
    ...(ffmpegPath ? { FFMPEG_PATH: ffmpegPath } : {}),
    // 桌面端不接外部 authn，平台 SDK 走本地放行
    FORCE_AUTHN_INNERAPI_DOMAIN: 'http://localhost:9999',
    NODE_OPTIONS: '',
  };
  delete baseEnv.NODE_OPTIONS;

  const serverEntry = path.join(APP_DIR, 'dist', 'server', 'main.js');
  if (!fs.existsSync(serverEntry)) {
    throw new Error(`缺少后端构建产物：${serverEntry}（安装包不完整）`);
  }

  startChild(
    'server',
    [serverEntry],
    {
      ...baseEnv,
      SERVER_PORT: String(serverPort),
      SERVER_HOST: listenHost,
      JOB_WORKER_CONCURRENCY: process.env.JOB_WORKER_CONCURRENCY || '2',
    },
    APP_DIR,
  );

  const serverUp = await waitHttp(`http://127.0.0.1:${serverPort}/`, { timeoutMs: 120000 });
  if (!serverUp) {
    throw new Error(`后端启动失败：\n${tailLog('server')}`);
  }
  log.info('后端已就绪');

  const gatewayEntry = path.join(APP_DIR, 'scripts', 'gateway.js');
  if (!fs.existsSync(gatewayEntry)) {
    throw new Error(`缺少网关脚本：${gatewayEntry}（安装包不完整）`);
  }

  startChild(
    'gateway',
    [gatewayEntry],
    {
      ...baseEnv,
      GATEWAY_PORT: String(gatewayPort),
      BACKEND_TARGET: `http://127.0.0.1:${serverPort}`,
      CLIENT_DIST_DIR: path.join('dist', 'client'),
      GATEWAY_HOST: listenHost,
    },
    APP_DIR,
  );

  const gatewayUp = await waitHttp(`http://127.0.0.1:${gatewayPort}/`, { timeoutMs: 60000 });
  if (!gatewayUp) {
    throw new Error(`网关启动失败：\n${tailLog('gateway')}`);
  }

  const url = `http://127.0.0.1:${gatewayPort}/app/yimu/`;
  fs.writeFileSync(
    RUNTIME_FILE,
    JSON.stringify(
      { pid: process.pid, url, serverPort, gatewayPort, pgPort, startedAt: new Date().toISOString() },
      null,
      2,
    ),
  );
  log.info(`桌面端就绪：${url}`);
  log.ready(url);
}

process.on('SIGTERM', cleanup);
process.on('SIGINT', cleanup);
process.on('SIGHUP', cleanup);
// 壳层崩溃时不留孤儿进程（某些平台父进程消失不会触发信号，用看门狗兜底）
process.on('disconnect', cleanup);

const PARENT_PID = Number(process.env.YIMU_PARENT_PID || 0);
if (PARENT_PID > 0) {
  const watchdog = setInterval(() => {
    try {
      process.kill(PARENT_PID, 0);
    } catch {
      log.warn('壳层进程已退出，运行时自动关停');
      clearInterval(watchdog);
      cleanup();
    }
  }, 5000);
  watchdog.unref();
}

main().catch((err) => {
  log.error(`启动失败：${err.stack || err.message}`);
  // 壳层据此展示可读错误，而不是白屏
  console.log(`YIMU_ERROR ${String(err.message).replace(/\s+/g, ' ').slice(0, 2000)}`);
  cleanup();
});
