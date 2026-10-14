#!/usr/bin/env node
/**
 * 一幕·YIMU AI 短剧工坊 —— 安装前环境准备脚本（跨平台）
 * --------------------------------------------------
 * 职责：
 *   1. 检查 Node.js 主版本 >= 22（不满足则中文报错并退出，exit 1）。
 *   2. 若工程根没有 .env 则创建；用 crypto 生成 ENTERPRISE_ADMIN_TOKEN /
 *      YIMU_KEY_SECRET（各 32 字节 hex）；已存在的键只补缺、不覆盖。
 *   3. 用 TCP 探测 PostgreSQL 是否可达（2 秒超时）；不通则按平台给出
 *      中文安装指引，只告警不退出（exit 0）。
 *   4. 打印后续步骤中文指引。
 *
 * 用法：node scripts/setup.js
 * 本脚本仅用 Node 内置模块，npm install 之前即可运行。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const net = require('net');

const ROOT = path.resolve(__dirname, '..');

/** 1. Node 版本检查 */
function checkNode() {
  const major = parseInt(process.versions.node.split('.')[0], 10);
  if (Number.isNaN(major) || major < 22) {
    console.error(
      `[setup] 错误：本项目需要 Node.js 22 或更高版本，当前版本为 ${process.version}。` +
        '请升级 Node.js 后再试（推荐从 https://nodejs.org 下载 LTS 22 及以上版本）。',
    );
    process.exit(1);
  }
  console.log(`[setup] Node 版本检查通过：${process.version}`);
}

/** 2. .env：不存在则创建；已存在则只补缺失的键，绝不覆盖已有值 */
function ensureEnv() {
  const envPath = path.join(ROOT, '.env');
  const SECRET_KEYS = ['ENTERPRISE_ADMIN_TOKEN', 'YIMU_KEY_SECRET'];
  let content = '';
  const existed = fs.existsSync(envPath);
  if (existed) {
    content = fs.readFileSync(envPath, 'utf8');
  }

  const lines = content.split('\n');
  const hasKey = (k) => lines.some((line) => line.trim().startsWith(k + '='));

  const added = [];
  for (const key of SECRET_KEYS) {
    if (!hasKey(key)) {
      added.push(`${key}=${crypto.randomBytes(32).toString('hex')}`);
    }
  }

  if (added.length > 0) {
    if (content.length > 0 && !content.endsWith('\n')) {
      content += '\n';
    }
    content += added.join('\n') + '\n';
  }

  const REMINDER = '# 注意：本文件含真实密钥，请勿提交到 Git（.gitignore 已忽略 .env）。';
  if (!content.includes('请勿提交到 Git')) {
    if (content.length > 0 && !content.endsWith('\n')) {
      content += '\n';
    }
    content += REMINDER + '\n';
  }

  fs.writeFileSync(envPath, content);
  if (added.length > 0) {
    console.log(
      `[setup] .env ${existed ? '已更新' : '已创建'}，已生成新密钥：` +
        `${added.map((a) => a.split('=')[0]).join('、')}（已有键未做任何修改）`,
    );
  } else {
    console.log('[setup] .env 已存在，所需密钥齐全，未做任何修改');
  }
}

/** 从连接串解析 PostgreSQL 主机与端口（缺省 localhost:5432） */
function pgTarget() {
  const raw =
    process.env.SUDA_DATABASE_URL ||
    process.env.DATABASE_URL ||
    'postgres://localhost:5432/yimu';
  try {
    const u = new URL(raw);
    return {
      host: u.hostname || 'localhost',
      port: u.port ? parseInt(u.port, 10) : 5432,
      fromEnv: !!(process.env.SUDA_DATABASE_URL || process.env.DATABASE_URL),
    };
  } catch {
    return { host: 'localhost', port: 5432, fromEnv: false };
  }
}

/** TCP 探测（2 秒超时），返回是否可达 */
function probeTcp(host, port, timeoutMs = 2000) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const done = (ok) => {
      if (!settled) {
        settled = true;
        socket.destroy();
        resolve(ok);
      }
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
    socket.connect(port, host);
  });
}

/** 3. PostgreSQL 连通性检查（失败只告警，不退出） */
async function checkPostgres() {
  const { host, port, fromEnv } = pgTarget();
  const where = fromEnv ? '（来自 SUDA_DATABASE_URL / DATABASE_URL）' : '（默认）';
  const ok = await probeTcp(host, port);
  if (ok) {
    console.log(`[setup] PostgreSQL 连接检查通过：${host}:${port}${where}`);
    return;
  }
  const hint =
    process.platform === 'darwin'
      ? '请先安装并启动 PostgreSQL 16：\n' +
        '    brew install postgresql@16\n' +
        '    brew services start postgresql@16'
      : process.platform === 'win32'
        ? '请先安装 PostgreSQL 16：https://www.enterprisedb.com/downloads/postgres-postgresql-downloads\n' +
          '（安装过程中请记住超级用户 postgres 的密码）'
        : '请先安装 PostgreSQL 16：在项目根目录运行 scripts/install-linux.sh';
  console.warn(
    `[setup] 警告：无法连接到 PostgreSQL（${host}:${port}${where}，2 秒超时）。\n` +
      `${hint}\n` +
      '安装完成后请重新运行本脚本确认；本步骤失败不会中断安装流程。',
  );
}

/** 4. 后续步骤中文指引 */
function printNextSteps() {
  const hasNodeModules = fs.existsSync(path.join(ROOT, 'node_modules'));
  console.log('');
  console.log('[setup] 后续步骤：');
  if (!hasNodeModules) {
    console.log('  1. 安装依赖：npm install');
    console.log('  2. 本地启动：./scripts/start.sh');
  } else {
    console.log('  1. 依赖已安装（如需更新请运行 npm install）');
    console.log('  2. 本地启动：./scripts/start.sh');
  }
  console.log(
    '  或使用 Docker：docker compose up --build（首次构建后可用 docker compose up -d 后台运行）',
  );
  console.log('  启动后网关默认监听 http://localhost:5173');
}

async function main() {
  checkNode();
  ensureEnv();
  await checkPostgres();
  printNextSteps();
}

main().catch((err) => {
  console.error('[setup] 发生未预期的错误：' + err.message);
  process.exit(1);
});
