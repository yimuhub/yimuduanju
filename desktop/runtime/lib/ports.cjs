'use strict';
/**
 * 端口选择：桌面端不能假设 3000/5173 空闲（开发者机器上常被占用）。
 * 从给定区间挑第一个能 bind 的端口；全部占用则报错，不做随机降级
 * （随机端口会让用户看到的书签/日志对不上）。
 */
const net = require('net');

function isFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => srv.close(() => resolve(true)));
    // 绑定回环：与后端 SERVER_HOST 默认值一致，不会因 0.0.0.0 上别的进程而误判
    srv.listen(port, '127.0.0.1');
  });
}

async function pick(start, end, label) {
  for (let port = start; port <= end; port += 1) {
    if (await isFree(port)) return port;
  }
  throw new Error(`没有可用端口（${label} 区间 ${start}-${end} 全部被占用）`);
}

module.exports = { pick, isFree };
