'use strict';
/**
 * 桌面运行时日志：同时写 stdout（Tauri 读取）与 <dataDir>/logs/desktop.log。
 * 桌面端没有终端，日志文件是唯一事后排查依据，因此必须落盘。
 *
 * 两个必须守住的底线：
 * 1) stdout 断开（壳被强杀、管道关闭）时绝不能抛错。EPIPE 是异步发在
 *    stream 的 'error' 事件上的，try/catch 抓不到；漏了监听就会变成
 *    未捕获异常 → 处理器再写日志 → 再 EPIPE，几秒内刷出几百 MB 并拖垮进程。
 * 2) 日志必须自限体积。曾经一次刷屏写出 700MB 的单文件，用户磁盘直接少 0.7G。
 */
const fs = require('fs');
const path = require('path');

/** 单文件上限：超过就滚到 .1（只保留一份旧的），日志够排查即可 */
const MAX_BYTES = 8 * 1024 * 1024;

let stream = null;
let logFile = null;
let written = 0;
let stdoutBroken = false;

function markStdoutBroken() {
  stdoutBroken = true;
}

function say(text) {
  if (stdoutBroken) return;
  try {
    process.stdout.write(`${text}\n`);
  } catch (err) {
    if (err && (err.code === 'EPIPE' || err.code === 'ERR_STREAM_DESTROYED')) markStdoutBroken();
  }
}

function openStream() {
  stream = fs.createWriteStream(logFile, { flags: 'a' });
  stream.on('error', () => {
    stream = null; // 写盘失败就彻底放弃，不让它冒泡成未捕获异常
  });
  written = 0;
}

function rotateIfNeeded() {
  if (!logFile) return;
  try {
    const size = fs.statSync(logFile).size;
    if (size <= MAX_BYTES) return;
    stream?.end();
    fs.renameSync(logFile, `${logFile}.1`);
    openStream();
  } catch {
    /* 轮转失败不影响继续写 */
  }
}

function init(logDir) {
  logFile = path.join(logDir, 'desktop.log');
  try {
    fs.mkdirSync(logDir, { recursive: true });
    rotateIfNeeded();
    if (!stream) openStream();
  } catch (err) {
    console.error('[desktop] 日志文件不可写，仅输出到 stdout：', err.message);
  }
  // 关键：管道关闭是异步 error 事件，不是同步抛错
  process.stdout.on('error', markStdoutBroken);
}

function line(level, msg) {
  const text = `[${new Date().toISOString()}] [${level}] ${msg}`;
  if (stream) {
    try {
      stream.write(`${text}\n`);
      written += Buffer.byteLength(text) + 1;
      if (written > MAX_BYTES) {
        rotateIfNeeded();
        written = 0;
      }
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
