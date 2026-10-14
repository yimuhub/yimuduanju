/**
 * 一幕·YIMU AI 短剧工坊本地网关（已去平台化）
 * ---------------------------------------------------------------
 * 职责（仅本地开发）：
 *   1. 直接伺服前端构建产物 dist/client 的静态资源
 *   2. 把 HTML / /api /uploads 等动态请求转发给后端 NestJS
 *   3. 注入本地单用户身份头（后端 userContext 需要）
 *   4. 管理员 token 注入：仅对 /api/admin/* 与计费写接口注入 x-admin-token
 *      （后端 AdminGuard fail-closed 校验；普通业务接口不注入）
 *   5. 规范访问前缀：/ 与无前缀页面路径 302 到 /app/yimu/（消灭白屏坑）
 * 不再模拟任何外部平台网关，不再处理遥测/鉴权跳转。
 * 用法：node scripts/gateway.js（需先 cd 到工程根目录）
 * 环境变量（亦可写入工程根 .env，网关启动时自动加载）：
 *   GATEWAY_PORT            默认 5173
 *   BACKEND_TARGET          默认 http://localhost:3000
 *   CLIENT_DIST_DIR         默认 <工程根>/dist/client
 *   SUDA_WEBUSER            用户身份 JSON，默认本地一幕用户
 *   ENTERPRISE_ADMIN_TOKEN  管理员 token（W1 生成于 .env），注入 x-admin-token
 */
'use strict';

const http = require('http');
const { URL } = require('url');
const fs = require('fs');
const path = require('path');

// W4：网关是独立 node 进程，启动时加载工程根 .env
// （dotenv ^17.2.2 已在 dependencies；W1 在 .env 生成 ENTERPRISE_ADMIN_TOKEN）。
try {
  require('dotenv').config();
} catch (err) {
  console.warn('[gateway] dotenv 加载失败，将仅使用进程环境变量：' + err.message);
}

const ROOT = process.cwd();
const PORT = parseInt(process.env.GATEWAY_PORT || '5173', 10);
const TARGET = process.env.BACKEND_TARGET || 'http://localhost:3000';
const DIST_DIR = path.resolve(ROOT, process.env.CLIENT_DIST_DIR || 'dist/client');
// W4：5 个数据补全接口（recent-projects / activity / usage-trend /
// GET /api/projects/:id / 嵌套 scenes/:sceneId/shots）已收敛回后端实现，
// 网关不再直连 PostgreSQL，改为纯代理转发。
const WEBUSER_JSON =
  process.env.SUDA_WEBUSER ||
  JSON.stringify({
    user_id: 'local-user',
    tenant_id: 'local',
    app_id: 'yimu',
    user_type: 'user',
    user_name: { zh_cn: '一幕用户' },
  });
const WEBUSER_HEADER = encodeURIComponent(WEBUSER_JSON);
const target = new URL(TARGET);

// W4 fail-closed 提示：未配置 token 时管理接口会 401，这是预期的安全行为。
if (!process.env.ENTERPRISE_ADMIN_TOKEN) {
  console.warn(
    '[gateway] 未设置 ENTERPRISE_ADMIN_TOKEN：/api/admin/* 与计费写接口将返回 401（预期行为）；请确认工程根 .env 已由 W1 生成。',
  );
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json',
};

/** 伺服单个静态文件；命中返回 true */
function serveFile(res, filePath, noCache) {
  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': noCache || ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
  });
  fs.createReadStream(filePath).pipe(res);
  return true;
}

/** 尝试伺服静态文件；命中返回 true，未命中返回 false */
function serveStatic(req, res) {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  // W4：规范访问前缀 —— "/" 302 到 /app/yimu/（消灭白屏坑）。
  // /api/*、/uploads/* 与带扩展名的静态资源不受影响（见下方请求处理器）。
  if (urlPath === '/') {
    res.writeHead(302, { Location: '/app/yimu/' });
    res.end();
    return true;
  }
  // /app/yimu/ 根：直接伺服 index.html（不再 302 回 /，避免跳转环；
  // 后端 ViewController 已去平台化，渲染 index 不再注入平台数据，与静态伺服等价）。
  if (urlPath === '/app/yimu' || urlPath === '/app/yimu/') {
    const indexFile = path.join(DIST_DIR, 'index.html');
    if (fs.existsSync(indexFile)) return serveFile(res, indexFile, true);
    return false;
  }
  // /app/yimu/*：去前缀后先找静态文件，找不到则回退 index.html（SPA 深链路）。
  if (urlPath.startsWith('/app/yimu/')) {
    const stripped = urlPath.slice('/app/yimu'.length) || '/';
    const filePath = path.normalize(path.join(DIST_DIR, stripped));
    if (filePath.startsWith(DIST_DIR) && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      return serveFile(res, filePath, false);
    }
    const indexFile = path.join(DIST_DIR, 'index.html');
    if (fs.existsSync(indexFile)) return serveFile(res, indexFile, true);
    return false;
  }
  const filePath = path.normalize(path.join(DIST_DIR, urlPath));
  if (!filePath.startsWith(DIST_DIR)) return false; // 防目录穿越
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return false;
  return serveFile(res, filePath, false);
}

/* W4：5 个数据补全接口已收敛回后端实现 —— 网关不再拦截直连 PG，统一走下方纯代理转发。 */

const server = http.createServer((req, res) => {
  if (serveStatic(req, res)) return;

  const pathname = (req.url || '/').split('?')[0];

  // W4：无前缀页面路径 302 到 /app/yimu/（消灭白屏坑）。
  // 只处理无扩展名的页面路径；/api/*、/uploads/* 与静态资源原样放行代理（query 保留）。
  if (
    pathname !== '/api' &&
    !pathname.startsWith('/api/') &&
    pathname !== '/uploads' &&
    !pathname.startsWith('/uploads/') &&
    !pathname.startsWith('/app/yimu/') &&
    path.extname(pathname) === ''
  ) {
    res.writeHead(302, { Location: '/app/yimu' + (req.url || '/') });
    res.end();
    return;
  }

  const headers = { ...req.headers, host: target.host };
  // 本地单用户身份头（后端 userContext 需要；已去平台化，不再模拟任何外部网关，
  // 内容就是本地用户本身）
  headers['x-larkgw-suda-webuser'] = WEBUSER_HEADER;
  // W4：管理员 token 注入 —— 仅管理类接口（后端 AdminGuard fail-closed 校验）。
  // 覆盖 /api/admin/* 全部与两个计费写接口；普通业务接口不注入。
  // ENTERPRISE_ADMIN_TOKEN 未配置时不注入，后端返回 401（预期行为，见启动告警）。
  const needAdminToken =
    pathname === '/api/admin' ||
    pathname.startsWith('/api/admin/') ||
    (req.method === 'PATCH' &&
      (/^\/api\/billing\/pricing\/.+/.test(pathname) || pathname === '/api/billing/official'));
  if (needAdminToken && process.env.ENTERPRISE_ADMIN_TOKEN) {
    headers['x-admin-token'] = process.env.ENTERPRISE_ADMIN_TOKEN;
  }
  // CSRF：后端 CSRF 中间件自行下发 suda-csrf-token cookie 并注入渲染页面的
  // window.csrfToken，浏览器带同名 header（天然配对）。网关兜底：请求没带
  // csrf header 时从请求自身 cookie 取同值补上，保证 cookie===header。
  if (!headers['x-suda-csrf-token'] && req.headers.cookie) {
    const m = /(?:^|;\s*)suda-csrf-token=([^;]+)/.exec(req.headers.cookie);
    if (m) headers['x-suda-csrf-token'] = m[1];
  }

  const proxyReq = http.request(
    {
      hostname: target.hostname,
      port: target.port,
      path: req.url || '/',
      method: req.method,
      headers,
    },
    (proxyRes) => {
      // 后端下发的 Set-Cookie（含真实 suda-csrf-token）原样透传
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res);
    }
  );
  proxyReq.on('error', (err) => {
    console.error('[gateway] upstream error:', err.message);
    res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('网关无法连接后端 ' + TARGET + '：' + err.message);
  });
  req.pipe(proxyReq);
});

// W4 安全加固：默认仅监听 127.0.0.1（本机回环）。
// 网关代理的 /api/* 包含无认证的业务接口，绑定 0.0.0.0 暴露到局域网/公网
// 即意味着同网段任意设备可读写本地数据 —— 如确需暴露请先评估风险。
server.listen(PORT, '127.0.0.1', () => {
  console.log(`[gateway] 一幕·YIMU AI 短剧工坊本地网关已启动：http://127.0.0.1:${PORT}`);
  console.log(`[gateway] 监听地址：127.0.0.1（仅本机访问）`);
  console.log(`[gateway] 静态资源目录：${DIST_DIR}`);
  console.log(`[gateway] 动态请求转发：${TARGET}`);
});
