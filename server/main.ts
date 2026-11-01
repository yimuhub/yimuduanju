// W1 安全修复：加载项目根 .env（ENTERPRISE_ADMIN_TOKEN / YIMU_KEY_SECRET 等）。
// 注意：dotenv 不覆盖已存在的环境变量，start.sh 的 env 传参与系统环境变量优先。
import 'dotenv/config';

import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { configureApp } from '@lark-apaas/fullstack-nestjs-core';
import { join } from 'path';
import { mkdirSync } from 'fs';
import { __express as hbsExpressEngine } from 'hbs';
import type { ServerResponse } from 'http';

import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
// 修复（分层）：uploadDir 是路径工具，不该由 Controller 再导出。
// 旧写法 `export { uploadDir } from './upload-dir'` 写在 uploads.controller.ts 里，
// 逼着 main.ts 和 model-gateway.service.ts 去 import 一个 Controller 模块，
// 形成「启动入口 → Controller → Service → DI」的无谓依赖链。直接 import 工具模块。
import { uploadDir } from './modules/assets/upload-dir';
import { validateCryptoConfig } from './common/crypto.util';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    abortOnError: process.env.NODE_ENV !== 'development',
  });
  await configureApp(app, { 
    disableSwagger: true,
  });
  const logger = new Logger('Bootstrap');

  // 启动期自检：把「YIMU_KEY_SECRET 缺失 / 格式非法」从首次调用 Provider 接口时的
  // 500（错误信息还不可读）提前成启动日志，配置问题一目了然。
  const cryptoProblems = validateCryptoConfig();
  if (cryptoProblems.length > 0) {
    logger.error(`API Key 加密未就绪：${cryptoProblems.join('；')}`);
    logger.error('涉及 Provider 密钥读写的接口将返回明确错误；请在 .env 配置 64 位 hex 的 YIMU_KEY_SECRET');
  }

  // 修复（优雅停机缺失）：JobWorkerService implements OnModuleDestroy，
  // onModuleDestroy 要关闭 BullMQ worker / queue / redis。没有 enableShutdownHooks，
  // SIGTERM（docker stop / systemctl stop）不会触发 onModuleDestroy，
  // 在途任务被丢在 running，只能等下次启动 recoverOrphanedRunning 捞回。
  app.enableShutdownHooks();

  const host = process.env.SERVER_HOST || 'localhost';
  // 修复：Number('abc') === NaN，app.listen(NaN) 行为不可预期（可能随机端口或直接抛错）。
  // 另外 SERVER_HOST 默认 'localhost' 在容器里只绑回环，不显式设 0.0.0.0 外部访问不到 —— 
  // 这是有意保留的默认（安全优先），部署时请按环境显式设置。
  const port = Number.parseInt(process.env.SERVER_PORT ?? '3000', 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(
      `SERVER_PORT 非法：${JSON.stringify(process.env.SERVER_PORT)}（应为 1-65535 的整数）`,
    );
  }

  // 注册视图引擎, 渲染 client 目录下的 html 文件
  app.setBaseViewsDir(join(process.cwd(), 'dist/client'));
  app.setViewEngine('html');
  app.engine('html', hbsExpressEngine);

  // 白模产线 · 本地上传目录静态伺服（/uploads/ → UPLOAD_DIR，默认 data/uploads）；
  // 网关将 /uploads 透传到后端，开发/生产同源可预览，无需改网关。
  const dir = uploadDir();
  mkdirSync(dir, { recursive: true });
  // 安全加固：这条静态路由完全无鉴权，且绕过了 uploads.controller 里的项目归属校验。
  // 文件名是 randomUUID 猜不到，但 URL 一旦泄漏即永久公开，因此至少要做到：
  // 禁止点文件、关闭目录索引、禁止 MIME 嗅探、加缓存头。
  app.useStaticAssets(dir, {
    prefix: '/uploads/',
    dotfiles: 'deny',
    index: false,
    maxAge: '7d',
    setHeaders: (res: ServerResponse) => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Referrer-Policy', 'no-referrer');
      // 用户上传内容一律不作为文档渲染，避免存储型 XSS
      res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    },
  });

  await app.listen(port, host);
  logger.log(`Server running on ${host}:${port}`);
  logger.log(`API endpoints ready at http://${host}:${port}/api`);
}

// 修复（启动失败静默）：旧实现 bootstrap() 没有 .catch()，启动期抛错会变成
// unhandled rejection，进程可能带着「看起来正常」的日志退出，
// 真实原因（端口占用、DB 连不上、.env 缺失）完全丢失。
bootstrap().catch((err: unknown) => {
  // 此时 Nest Logger 可能尚未初始化，直接写 stderr 保证可见
  // eslint-disable-next-line no-console
  console.error('[Bootstrap] 启动失败：', err);
  process.exit(1);
});
