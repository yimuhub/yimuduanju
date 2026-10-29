/**
 * 一幕·YIMU AI 短剧创作平台本地网关（已去平台化）
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
const zlib = require('zlib');
const { randomBytes } = require('crypto');

// 网关自签 CSRF token：随 HTML 页面以 cookie 下发，/api/* 转发时补齐同名 header。
// 后端为无状态双提交校验（cookie === header），token 值本身不需要后端感知。
const CSRF_TOKEN = randomBytes(24).toString('hex');

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

// ===== 性能精简：文本类响应 gzip 压缩（按 content-type 判断，SSE 明确排除） =====
const GZIP_CONTENT_TYPES = new Set([
  'text/html',
  'text/css',
  'application/javascript',
  'text/javascript',
  'application/json',
  'image/svg+xml',
]);
/** 客户端是否声明接受 gzip */
const clientAcceptsGzip = (req) =>
  ((req && req.headers && req.headers['accept-encoding']) || '').includes('gzip');
/** 该响应是否可 gzip：类型命中 + 客户端接受 + 未被上游压缩过（SSE 的 text/event-stream 不在白名单内） */
const shouldGzip = (req, contentType, existingEncoding) =>
  clientAcceptsGzip(req) &&
  !existingEncoding &&
  GZIP_CONTENT_TYPES.has(String(contentType || '').split(';')[0].trim());

/** 伺服单个静态文件；命中返回 true */
function serveFile(req, res, filePath, noCache) {
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME[ext] || 'application/octet-stream';
  const headers = {
    'Content-Type': contentType,
    'Cache-Control': noCache || ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
  };
  // HTML 页面响应附带网关自签的 CSRF cookie（随机 token，进程内一次生成）：
  // 后端按云端 HTTPS 环境下发 Secure/Partitioned cookie，纯 HTTP 环境会被浏览器拒绝，
  // 而静态伺服路径不会经手后端 Set-Cookie —— 没有这条 cookie，CSRF 双提交校验全站 403。
  // 后端为无状态双提交校验（cookie === header 即通过），API 转发时网关已从 cookie 补齐 header。
  if (ext === '.html' && CSRF_TOKEN) {
    headers['Set-Cookie'] = `suda-csrf-token=${CSRF_TOKEN}; Path=/; SameSite=Lax`;
  }
  if (shouldGzip(req, contentType, '')) {
    headers['Content-Encoding'] = 'gzip';
    headers.Vary = 'Accept-Encoding';
    res.writeHead(200, headers);
    fs.createReadStream(filePath).pipe(zlib.createGzip()).pipe(res);
    return true;
  }
  res.writeHead(200, headers);
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
    if (fs.existsSync(indexFile)) return serveFile(req, res, indexFile, true);
    return false;
  }
  // /app/yimu/*：去前缀后先找静态文件，找不到则回退 index.html（SPA 深链路）。
  if (urlPath.startsWith('/app/yimu/')) {
    const stripped = urlPath.slice('/app/yimu'.length) || '/';
    const filePath = path.normalize(path.join(DIST_DIR, stripped));
    if (filePath.startsWith(DIST_DIR) && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      return serveFile(req, res, filePath, false);
    }
    const indexFile = path.join(DIST_DIR, 'index.html');
    if (fs.existsSync(indexFile)) return serveFile(req, res, indexFile, true);
    return false;
  }
  const filePath = path.normalize(path.join(DIST_DIR, urlPath));
  if (!filePath.startsWith(DIST_DIR)) return false; // 防目录穿越
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return false;
  return serveFile(req, res, filePath, false);
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
  // 支持多租户/多用户身份头：若客户端携带 x-yimu-user-id 则构造对应租户上下文，否则回落本地默认用户
  const customUserId = typeof req.headers['x-yimu-user-id'] === 'string' ? req.headers['x-yimu-user-id'].trim() : '';
  const customTenantId = typeof req.headers['x-yimu-tenant-id'] === 'string' ? req.headers['x-yimu-tenant-id'].trim() : '';
  if (customUserId && /^[a-zA-Z0-9_-]{1,64}$/.test(customUserId)) {
    headers['x-larkgw-suda-webuser'] = encodeURIComponent(
      JSON.stringify({
        user_id: customUserId,
        tenant_id: customTenantId && /^[a-zA-Z0-9_-]{1,64}$/.test(customTenantId) ? customTenantId : 'local',
        app_id: 'yimu',
        user_type: 'user',
        user_name: { zh_cn: customUserId },
      }),
    );
  } else if (!headers['x-larkgw-suda-webuser']) {
    headers['x-larkgw-suda-webuser'] = WEBUSER_HEADER;
  }
  // 安全加固（修复网关代填提权风险）：
  // 仅当客户端未显式携带 x-admin-token、且请求严格来自本机回环地址（127.0.0.1 / ::1）、
  // 且未设置 GATEWAY_AUTO_ADMIN_TOKEN=false 时，才为本机开发自动注入管理员令牌；
  // 局域网/公网（GATEWAY_HOST=0.0.0.0）访问管理接口必须由客户端自行携带合法 x-admin-token。
  const remoteAddr = (req.socket && req.socket.remoteAddress) || '';
  const isLoopback =
    remoteAddr === '127.0.0.1' ||
    remoteAddr === '::1' ||
    remoteAddr === '::ffff:127.0.0.1';
  const needAdminToken =
    pathname === '/api/admin' ||
    pathname.startsWith('/api/admin/') ||
    (req.method === 'PATCH' &&
      (/^\/api\/billing\/pricing\/.+/.test(pathname) || pathname === '/api/billing/official'));
  if (
    needAdminToken &&
    !headers['x-admin-token'] &&
    isLoopback &&
    process.env.GATEWAY_AUTO_ADMIN_TOKEN !== 'false' &&
    process.env.ENTERPRISE_ADMIN_TOKEN
  ) {
    headers['x-admin-token'] = process.env.ENTERPRISE_ADMIN_TOKEN;
  }
  // CSRF：网关自签 token（serveFile 时随 HTML 页面以 cookie 下发，进程内唯一）。
  // 请求没带 csrf header 时优先从请求 cookie 取值补齐；cookie 也缺（首载竞态）
  // 则直接用网关自签值兜底，保证 cookie===header 的双提交校验恒通过。
  if (!headers['x-suda-csrf-token']) {
    const m = req.headers.cookie
      ? /(?:^|;\s*)suda-csrf-token=([^;]+)/.exec(req.headers.cookie)
      : null;
    headers['x-suda-csrf-token'] = m ? m[1] : CSRF_TOKEN;
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
      // 后端下发的 Set-Cookie（含真实 suda-csrf-token）透传前做本地化改写：
      // 后端按云端 HTTPS 环境下发 `Secure; Partitioned; SameSite=None`，
      // 纯 HTTP 环境（应用内 WebView、部分内嵌浏览器、未来客户端壳）会拒绝该 cookie，
      // 导致 CSRF 校验全站 403。仅本机回环部署时改写属性（安全语义不变：仅 127.0.0.1 可达）。
      const outHeaders = { ...proxyRes.headers };
      const rawCookies = proxyRes.headers['set-cookie'];
      if (rawCookies && GATEWAY_HOST === '127.0.0.1') {
        outHeaders['set-cookie'] = rawCookies.map((c) =>
          c
            .replace(/;\s*Secure/gi, '')
            .replace(/;\s*Partitioned/gi, '')
            .replace(/;\s*SameSite=None/gi, '; SameSite=Lax'),
        );
      }
      // 性能精简：后端文本类响应（html/css/js/json）经网关 gzip 后再下发；
      // SSE（text/event-stream）不在白名单内保持逐事件直通，上游已压缩的跳过。
      if (
        proxyRes.statusCode === 200 &&
        shouldGzip(req, proxyRes.headers['content-type'], proxyRes.headers['content-encoding'])
      ) {
        delete outHeaders['content-length'];
        outHeaders['content-encoding'] = 'gzip';
        outHeaders.Vary = 'Accept-Encoding';
        res.writeHead(proxyRes.statusCode, outHeaders);
        proxyRes.pipe(zlib.createGzip()).pipe(res);
        return;
      }
      res.writeHead(proxyRes.statusCode, outHeaders);
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

// W4 安全加固：默认仅监听 127.0.0.1（本机回环），安全语义不变。
// 网关代理的 /api/* 包含无认证的业务接口，绑定 0.0.0.0 暴露到局域网/公网
// 即意味着同网段任意设备可读写本地数据 —— 如确需暴露请先评估风险。
// Docker Compose 下可通过环境变量 GATEWAY_HOST=0.0.0.0 开放容器端口。
const GATEWAY_HOST = process.env.GATEWAY_HOST || '127.0.0.1';
server.listen(PORT, GATEWAY_HOST, () => {
  console.log(`[gateway] 一幕·YIMU AI 短剧创作平台本地网关已启动：http://${GATEWAY_HOST}:${PORT}`);
  console.log(`[gateway] 监听地址：${GATEWAY_HOST}${GATEWAY_HOST === '127.0.0.1' ? '（仅本机访问）' : '（已开放，请评估风险）'}`);
  console.log(`[gateway] 静态资源目录：${DIST_DIR}`);
  console.log(`[gateway] 动态请求转发：${TARGET}`);
});
