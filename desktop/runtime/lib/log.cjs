'use strict';
/**
 * 桌面运行时日志：同时写 stdout（Tauri 读取）与 <dataDir>/logs/desktop.log。
 * 桌面端没有终端，日志文件是唯一事后排查依据，因此必须落盘。
 */
const fs = require('fs');
const path = require('path');

let stream = null;

function init(logDir) {
  try {
    fs.mkdirSync(logDir, { recursive: true });
    stream = fs.createWriteStream(path.join(logDir, 'desktop.log'), { flags: 'a' });
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
  console.log(text);
}

module.exports = {
  init,
  info: (msg) => line('INFO', msg),
  warn: (msg) => line('WARN', msg),
  error: (msg) => line('ERROR', msg),
  /** 壳层握手：这一行必须原样出现在 stdout */
  ready: (url) => {
    console.log(`YIMU_READY ${url}`);
    if (stream) stream.write(`[${new Date().toISOString()}] [INFO] READY ${url}\n`);
  },
};
