#!/usr/bin/env node
'use strict';
/**
 * 桌面客户端「全量运行时」打包器（三平台通用）
 * ---------------------------------------------------------------------------
 * 产物：build/desktop-app/  —— 一个自包含目录，拷到任何同平台机器都能直接跑，
 * 不含需要用户另装的依赖：
 *
 *   build/desktop-app/
 *   ├─ node(.exe)               ← 内嵌 Node 运行时（源自构建机，版本一致）
 *   ├─ bin/ffmpeg(.exe)         ← 内嵌 ffmpeg（导出/首帧压缩用，可选但尽量带）
 *   ├─ launch.cjs               ← 桌面运行时入口（起 PG → 迁移 → 后端 → 网关）
 *   ├─ dist/{server,client,shared}
 *   ├─ scripts/{gateway.js,migrate.js,db-init.sql}
 *   ├─ server/database/migrations/
 *   └─ node_modules/            ← 仅生产依赖（含 embedded-postgres 平台二进制）
 *
 * 用法：
 *   node scripts/desktop-pack.js            # 构建前端后端再打包
 *   node scripts/desktop-pack.js --skip-build
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'build', 'desktop-app');
const SKIP_BUILD = process.argv.includes('--skip-build');
const IS_WIN = process.platform === 'win32';
const NODE_BIN = IS_WIN ? 'node.exe' : 'node';
const FFMPEG_BIN = IS_WIN ? 'ffmpeg.exe' : 'ffmpeg';
// 国内网络下 registry.npmjs.org 只有几十 KB/s，镜像快一个数量级；
// 可用 YIMU_NPM_REGISTRY 覆盖（CI 在国外可设回官方源）。
const REGISTRY = process.env.YIMU_NPM_REGISTRY || 'https://registry.npmmirror.com';

/**
 * 桌面包里不需要的重依赖。
 * 教训（两次实测崩后端）：平台 SDK `@lark-apaas/fullstack-nestjs-core` 在
 * **require 阶段**就会拉 `@opentelemetry/sdk-node`、`typescript` 等看起来"构建期"的
 * 包，裁掉直接 MODULE_NOT_FOUND 起不来。所以只裁「确定与后端启动无关」的三类：
 * - onnxruntime-* / @huggingface/transformers：记忆检索的本地向量模型，
 *   memory.service 的 require 在 try/catch 里，失败降级关键词检索；模型本身还要联网
 *   下载，桌面离线场景用不到，省 ~440MB；
 * - @ffmpeg：浏览器端合成用的 wasm 包，服务端 ffmpeg 走二进制；
 * - @img / sharp：全仓无引用（只在文案里出现过 sharp 这个词）。
 */
const PRUNE_PACKAGES = [
  'onnxruntime-node',
  'onnxruntime-web',
  '@huggingface/transformers',
  '@ffmpeg',
  '@img',
  'sharp',
];


function log(msg) {
  console.log(`[pack] ${msg}`);
}

function run(cmd, args, opts = {}) {
  log(`$ ${cmd} ${args.join(' ')}`);
  execFileSync(cmd, args, { cwd: ROOT, stdio: 'inherit', ...opts });
}

function copyDir(from, to, filter) {
  if (!fs.existsSync(from)) return;
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dest = path.join(to, entry.name);
    if (filter && !filter(src, entry)) continue;
    if (entry.isDirectory()) copyDir(src, dest, filter);
    else if (entry.isSymbolicLink()) fs.symlinkSync(fs.readlinkSync(src), dest);
    else fs.copyFileSync(src, dest);
  }
}

function copyFile(from, to, mode) {
  if (!fs.existsSync(from)) return false;
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  if (mode) fs.chmodSync(to, mode);
  return true;
}

function dirSize(dir) {
  let total = 0;
  const walk = (p) => {
    for (const entry of fs.readdirSync(p, { withFileTypes: true })) {
      const full = path.join(p, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) total += fs.statSync(full).size;
    }
  };
  walk(dir);
  return total;
}

/** 在独立目录里装生产依赖：不污染仓库 node_modules，也保证产物可复现 */
function installProdDeps(target) {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const appPkg = {
    name: pkg.name,
    version: pkg.version,
    private: true,
    description: pkg.description,
    license: pkg.license,
    dependencies: pkg.dependencies,
  };
  fs.writeFileSync(path.join(target, 'package.json'), JSON.stringify(appPkg, null, 2));

  const lock = path.join(ROOT, 'package-lock.json');
  if (fs.existsSync(lock)) {
    // 用仓库 lock 保证版本与开发机一致；--omit=dev 只装运行时依赖
    fs.copyFileSync(lock, path.join(target, 'package-lock.json'));
    try {
      run('npm', ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], {
        cwd: target,
        env: { ...process.env, npm_config_registry: REGISTRY, NODE_OPTIONS: '' },
      });
      return;
    } catch (err) {
      log(`npm ci 失败（${err.message}），回退到 npm install`);
    }
  }
  run('npm', ['install', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], {
    cwd: target,
    env: { ...process.env, npm_config_registry: REGISTRY, NODE_OPTIONS: '' },
  });
}

/** embedded-postgres 会为所有平台装二进制（~90MB），只留当前平台 */
function pruneForeignPgBinaries(target) {
  const scope = path.join(target, 'node_modules', '@embedded-postgres');
  if (!fs.existsSync(scope)) return;
  const key = `${process.platform}-${process.arch}`;
  for (const entry of fs.readdirSync(scope, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (entry.name === key) continue;
    fs.rmSync(path.join(scope, entry.name), { recursive: true, force: true });
    log(`剔除非本平台数据库二进制：@embedded-postgres/${entry.name}`);
  }
}

/**
 * 平台包里的 lib/*.dylib 是靠 postinstall 里的 hydrate-symlinks.js 建软链的
 * （libicudata.68.dylib → libicudata.68.2.dylib 等）。我们用 --ignore-scripts
 * 安装（避免跑任意第三方安装脚本），所以必须自己补这一步，否则 initdb 会
 * 因 dyld 找不到库直接 SIGABRT。
 */
function hydratePgSymlinks(target) {
  const pkgDir = path.join(target, 'node_modules', '@embedded-postgres', `${process.platform}-${process.arch}`);
  const hydrator = path.join(pkgDir, 'scripts', 'hydrate-symlinks.js');
  if (!fs.existsSync(hydrator)) {
    if (fs.existsSync(pkgDir)) log('警告：未找到 hydrate-symlinks.js，PostgreSQL 可能因缺少软链无法启动');
    return;
  }
  run(process.execPath, [hydrator], { cwd: pkgDir });
  log('已补齐 PostgreSQL 动态库软链');
}


function prunePackages(target) {
  const preserved = [];
  for (const name of PRUNE_PACKAGES) {
    const dir = path.join(target, 'node_modules', name);
    if (!fs.existsSync(dir)) continue;
    fs.rmSync(dir, { recursive: true, force: true });
    preserved.push(name);
  }
  if (preserved.length > 0) log(`剔除桌面端不需要的依赖：${preserved.join(', ')}`);

  // node_modules/.bin 里是 npm 脚本用的软链，删掉包之后会留下断链；
  // Tauri 打包资源时会跟着软链走，遇到断链直接失败（实测 .bin/tsserver）。
  // 运行时用绝对路径 spawn，不需要 .bin。
  const binDir = path.join(target, 'node_modules', '.bin');
  if (fs.existsSync(binDir)) {
    fs.rmSync(binDir, { recursive: true, force: true });
  }
}



function main() {
  const started = Date.now();

  if (!SKIP_BUILD) {
    run('npm', ['run', 'build:prod']);
  }
  for (const required of ['dist/server/main.js', 'dist/client/index.html']) {
    if (!fs.existsSync(path.join(ROOT, required))) {
      throw new Error(`缺少构建产物 ${required}，请先 npm run build:prod`);
    }
  }

  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  log('复制前端/后端产物');
  copyDir(path.join(ROOT, 'dist'), path.join(OUT, 'dist'));

  log('复制运行时脚本');
  copyDir(path.join(ROOT, 'scripts'), path.join(OUT, 'scripts'), (_src, entry) => {
    if (entry.isDirectory()) return entry.name !== 'hooks';
    return entry.name.endsWith('.js') || entry.name.endsWith('.sql');
  });
  copyDir(path.join(ROOT, 'server', 'database', 'migrations'), path.join(OUT, 'server', 'database', 'migrations'));
  copyDir(path.join(ROOT, 'desktop', 'runtime'), OUT);

  log('安装生产依赖（embedded-postgres 会带入本平台二进制）');
  installProdDeps(OUT);
  pruneForeignPgBinaries(OUT);
  hydratePgSymlinks(OUT);
  prunePackages(OUT);

  log('内嵌 Node 运行时');
  const nodeTarget = path.join(OUT, NODE_BIN);
  copyFile(process.execPath, nodeTarget, 0o755);

  log('内嵌 ffmpeg');
  if (process.env.YIMU_SKIP_BUNDLED_FFMPEG === '1') {
    // 容器形态由基础镜像 apt 安装 ffmpeg，避免把 deb 二进制再复制一份
    log('YIMU_SKIP_BUNDLED_FFMPEG=1，跳过 ffmpeg（由运行环境提供）');
  } else {
    const ffmpegCandidates = [
      path.join(ROOT, 'node_modules', 'ffmpeg-static', FFMPEG_BIN),
      ...(IS_WIN ? [] : ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg']),
    ];
    let ffmpegFrom = null;
    for (const candidate of ffmpegCandidates) {
      if (fs.existsSync(candidate)) {
        ffmpegFrom = candidate;
        break;
      }
    }
    if (ffmpegFrom) {
      copyFile(ffmpegFrom, path.join(OUT, 'bin', FFMPEG_BIN), 0o755);
      log(`ffmpeg 来源：${ffmpegFrom}`);
    } else {
      log('未找到 ffmpeg：导出合成会退化为浏览器端 FFmpeg.wasm，功能可用但较慢');
    }
  }

  const manifest = {
    name: 'yimu-desktop-runtime',
    version: JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version,
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    builtAt: new Date().toISOString(),
    ffmpeg: Boolean(ffmpegFrom),
  };
  fs.writeFileSync(path.join(OUT, 'bundle.json'), JSON.stringify(manifest, null, 2));

  const mb = (dirSize(OUT) / 1024 / 1024).toFixed(1);
  log(`完成：${OUT}（${mb} MB，${((Date.now() - started) / 1000).toFixed(0)}s）`);
}

try {
  main();
} catch (err) {
  console.error(`[pack] 失败：${err.stack || err.message}`);
  process.exit(1);
}
