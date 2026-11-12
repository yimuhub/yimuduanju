'use strict';
/**
 * 桌面运行时日志：同时写 stdout（Tauri 读取）与 <dataDir>/logs/desktop.log。
 * 桌面端没有终端，日志文件是唯一事后排查依据，因此必须落盘。
 */
const fs = require('fs');
const path = require('path');

let stream = null;
// 壳层关闭读端后 stdout 会 EPIPE。之前 console.log 直接抛错 → 被
// uncaughtException 兜住 → 再写日志 → 再 EPIPE，形成死循环刷屏且拖死看门狗。
let stdoutBroken = false;

function say(text) {
  if (stdoutBroken) return;
  try {
    process.stdout.write(text + '\n');
  } catch (err) {
    if (err && (err.code === 'EPIPE' || err.code === 'ERR_STREAM_DESTROYED')) {
      stdoutBroken = true; // 只退化一次，之后只写文件
    }
  }
}

function init(logDir) {
  try {
    fs.mkdirSync(logDir, { recursive: true });
    stream = fs.createWriteStream(path.join(logDir, 'desktop.log'), { flags: 'a' });
    stream.on('error', () => {
      stream = null; // 写盘失败就彻底放弃，不让它冒泡成未捕获异常
    });
  } catch (err) {
    console.error('[desktop] 日志文件不可写，仅输出到 stdout：', err.message);
  }
}

function line(level, msg) {
  const text = `[${new Date().toISOString()}] [${level}] ${msg}`;
  if (stream) {
    try {
      stream.write(text + '\n');
    } catch {
      /* 忽略写盘失败 */
    }
  }
  // Tauri 壳只读 stdout 的 READY 行，其余仅作调试
  say(text);
}

module.exports = {
  init,
  info: (msg) => line('INFO', msg),
  warn: (msg) => line('WARN', msg),
  error: (msg) => line('ERROR', msg),
  /** 壳层握手：这一行必须原样出现在 stdout */
  ready: (url) => {
    say(`YIMU_READY ${url}`);
    if (stream) stream.write(`[${new Date().toISOString()}] [INFO] READY ${url}\n`);
  },
};
