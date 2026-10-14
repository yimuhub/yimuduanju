// W1 安全修复：加载项目根 .env（ENTERPRISE_ADMIN_TOKEN / YIMU_KEY_SECRET 等）。
// 注意：dotenv 不覆盖已存在的环境变量，start.sh 的 env 传参与系统环境变量优先。
import 'dotenv/config';

import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { configureApp } from '@lark-apaas/fullstack-nestjs-core';
import { join } from 'path';
import { mkdirSync } from 'fs';
import { __express as hbsExpressEngine } from 'hbs';

import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { uploadDir } from './modules/assets/uploads.controller';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    abortOnError: process.env.NODE_ENV !== 'development',
  });
  await configureApp(app, { 
    disableSwagger: true,
  });
  const logger = new Logger('Bootstrap');
  const host = process.env.SERVER_HOST || 'localhost';
  const port = Number(process.env.SERVER_PORT || '3000');

  // 注册视图引擎, 渲染 client 目录下的 html 文件
  app.setBaseViewsDir(join(process.cwd(), 'dist/client'));
  app.setViewEngine('html');
  app.engine('html', hbsExpressEngine);

  // 白模产线 · 本地上传目录静态伺服（/uploads/ → UPLOAD_DIR，默认 data/uploads）；
  // 网关将 /uploads 透传到后端，开发/生产同源可预览，无需改网关。
  const dir = uploadDir();
  mkdirSync(dir, { recursive: true });
  app.useStaticAssets(dir, { prefix: '/uploads/' });

  await app.listen(port, host);
  logger.log(`Server running on ${host}:${port}`);
  logger.log(`API endpoints ready at http://${host}:${port}/api`);
}

bootstrap();
