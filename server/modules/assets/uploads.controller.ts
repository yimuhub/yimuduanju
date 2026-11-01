import {
  BadRequestException,
  Controller,
  Headers,
  Inject,
  Logger,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { projects } from '@server/database/schema';
import { eq } from 'drizzle-orm';
import { createWriteStream } from 'fs';
// 修复：unlink 原本在两个分支里各写一次 `await import('fs/promises')` 动态导入，
// 而顶部已静态导入了 mkdir。统一为静态导入，去掉重复的运行时解析。
import { mkdir, unlink } from 'fs/promises';
import { createHash, randomUUID } from 'crypto';
// 修复：`resolve` 从未被使用，noUnusedLocals 下会直接编译失败；
// 同时把重复的第二条 '@nestjs/common' import 合并进上面那条。
import { join } from 'path';
import type { Request } from 'express';
import type { Asset } from '@shared/api.interface';
import { AssetsService } from './assets.service';
import { uploadDir } from './upload-dir';

/**
 * 项目本地上传（白模产线 · 白模视频/照片落盘）
 * ------------------------------------------------------------------
 * POST /api/projects/:projectId/uploads  binary body（octet-stream，不用 multipart，零新依赖）
 *   Headers: Content-Type（白名单）, X-Filename（原文件名，仅取 basename 做展示名）
 *   Query:   durationSeconds?（白模时长，写入资产与镜头元数据）
 * 落盘 <UPLOAD_DIR>/<projectId>/<uuid>.<ext>，UPLOAD_DIR 默认 <cwd>/data/uploads，
 * 由 main.ts 以 /uploads/ 前缀静态伺服（网关透传，无需改网关）。
 * 同时登记一条 sourceType='whitemodel' 的 Asset 行，fileUrl 为相对路径。
 *
 * 诚实边界：本地 URL 仅同源可访问（预览/存档/R2V 就绪位），云端视频模型
 * 直喂需要公网可拉取 URL——Key 到位做 R2V 联调时，需换 S3/OSS 公网地址。
 */
const MAX_BYTES = 25 * 1024 * 1024;
/** 请求体接收超时：旧实现的 Promise 没有任何超时，客户端只连不发就会挂死一个请求 */
const UPLOAD_TIMEOUT_MS = 60_000;
const ALLOWED: Record<string, string> = {
  'video/webm': 'webm',
  'video/mp4': 'mp4',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  // P1-3 BGM 归档：配乐可上传为项目资产（合成时也可直接用本地文件不上传）
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/x-m4a': 'm4a',
  'audio/mp4': 'm4a',
};

// 修复（分层）：删除原本的 `export { uploadDir } from './upload-dir';`。
// 这个再导出写在 Controller 里，逼着 main.ts 与 model-gateway.service.ts
// 都去 import 一个 Controller 模块，形成「启动入口 → Controller → Service → DI」
// 的无谓依赖链。两处调用方已改为直接 import './upload-dir'。

@Controller('api/projects/:projectId/uploads')
export class UploadsController {
  private readonly logger = new Logger(UploadsController.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    private readonly assetsService: AssetsService,
  ) {}

  @Post()
  async upload(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Req() req: Request,
    @Headers('content-type') contentType?: string,
    @Headers('x-filename') rawName?: string,
    @Query('durationSeconds') durationRaw?: string,
  ): Promise<{ asset: Asset; fileUrl: string }> {
    const mime = (contentType ?? '').split(';')[0].trim().toLowerCase();
    const ext = ALLOWED[mime];
    if (!ext) {
      throw new BadRequestException(
        `不支持的 Content-Type，仅允许 ${Object.keys(ALLOWED).join('、')}`,
      );
    }
    // 修复（无 Content-Length 预检）：旧实现要等客户端把 25MB 全部灌满才拒绝。
    // 声明长度已超限时立刻拒绝，不建目录、不落盘、不浪费带宽。
    const declaredLength = Number(req.headers['content-length']);
    if (Number.isFinite(declaredLength) && declaredLength > MAX_BYTES) {
      throw new BadRequestException(
        `文件超过 ${MAX_BYTES / 1024 / 1024}MB 上限（Content-Length: ${declaredLength}）`,
      );
    }

    const projRows = await this.db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    if (projRows.length === 0) throw new NotFoundException('项目不存在');

    const dir = join(uploadDir(), projectId);
    await mkdir(dir, { recursive: true });
    const fileName = `${randomUUID()}.${ext}`;
    const absPath = join(dir, fileName);

    const size = await new Promise<number>((resolveSize, reject) => {
      // 修复（监听器挂得太晚）：'data' 原本在两次 await（项目查询、mkdir）之后才注册。
      // 若 configureApp 为该 Content-Type 装了 body parser，'end' 早已触发，
      // 下面的 req.on('end') 永远不会再回调 → Promise 永不 settle，请求挂死。
      if (req.readableEnded) {
        reject(
          new BadRequestException(
            '请求体已被上游中间件消费，无法直接落盘（请勿对 octet-stream 启用 body parser）',
          ),
        );
        return;
      }

      let received = 0;
      let settled = false;
      let timer: NodeJS.Timeout | undefined;
      const stream = createWriteStream(absPath);

      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        fn();
      };

      // 修复（无超时）：客户端只连不发就会永久占用一个请求与一个文件句柄
      timer = setTimeout(() => {
        settle(() => {
          stream.destroy();
          req.destroy();
          reject(
            new BadRequestException(
              `上传超时：${UPLOAD_TIMEOUT_MS / 1000}s 内未收完请求体`,
            ),
          );
        });
      }, UPLOAD_TIMEOUT_MS);

      req.on('data', (chunk: Buffer) => {
        received += chunk.length;
        if (received > MAX_BYTES) {
          stream.destroy();
          // 修复（413 永远发不出去）：旧实现先 req.destroy() 再 reject，
          // socket 已销毁，Nest 没有连接可写，客户端只看到 ECONNRESET，
          // 拿不到「文件超过 25MB 上限」这句提示。
          // 改为：停止读取 → 抛异常让 Nest 正常写 4xx → 响应 flush 完再销毁 socket。
          req.pause();
          req.removeAllListeners('data');
          const res = req.res;
          if (res && !res.headersSent) {
            res.once('finish', () => req.destroy());
          }
          settle(() =>
            reject(
              new BadRequestException(
                `文件超过 ${MAX_BYTES / 1024 / 1024}MB 上限`,
              ),
            ),
          );
          return;
        }
        if (!stream.write(chunk)) req.pause();
      });
      stream.on('drain', () => req.resume());
      req.on('end', () => {
        stream.end(() => settle(() => resolveSize(received)));
      });
      req.on('error', (e) => {
        stream.destroy();
        settle(() => reject(e));
      });
      stream.on('error', (e) => settle(() => reject(e)));
    }).catch(async (e) => {
      // 超限/失败：删除残留文件，不留脏数据
      await unlink(absPath).catch(() => {});
      throw e;
    });
    if (size === 0) {
      await unlink(absPath).catch(() => {});
      throw new BadRequestException('空文件，上传被拒绝');
    }

    const displayName = (rawName ?? '')
      .split(/[/\\]/)
      .pop()
      ?.replace(/[^\w\u4e00-\u9fff.\-()\[\] ]/g, '')
      .slice(0, 80);
    const isVideo = mime.startsWith('video/');
    const isAudio = mime.startsWith('audio/');
    const durationSeconds = durationRaw ? Number(durationRaw) : NaN;
    const asset = await this.assetsService.create({
      projectId,
      assetType: isVideo ? 'video' : isAudio ? 'audio' : 'image',
      name: displayName || `白模-${createHash('md5').update(fileName).digest('hex').slice(0, 8)}.${ext}`,
      fileUrl: `/uploads/${projectId}/${fileName}`,
      mimeType: mime,
      fileSize: size,
      durationSeconds: Number.isFinite(durationSeconds) && durationSeconds > 0
        ? durationSeconds
        : undefined,
      sourceType: 'whitemodel',
      status: 'ready',
    });
    this.logger.log(`本地上传 ${projectId}/${fileName} ${(size / 1024).toFixed(1)}KB`);
    return { asset, fileUrl: asset.fileUrl ?? '' };
  }
}
