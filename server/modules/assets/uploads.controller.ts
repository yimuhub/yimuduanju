import {
  BadRequestException,
  Controller,
  Headers,
  Logger,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { projects } from '@server/database/schema';
import { eq } from 'drizzle-orm';
import { createWriteStream } from 'fs';
import { mkdir } from 'fs/promises';
import { createHash, randomUUID } from 'crypto';
import { join, resolve } from 'path';
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

export { uploadDir } from './upload-dir';

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
      let received = 0;
      const stream = createWriteStream(absPath);
      req.on('data', (chunk: Buffer) => {
        received += chunk.length;
        if (received > MAX_BYTES) {
          stream.destroy();
          req.destroy();
          reject(new BadRequestException('文件超过 25MB 上限'));
          return;
        }
        if (!stream.write(chunk)) req.pause();
      });
      stream.on('drain', () => req.resume());
      req.on('end', () => {
        stream.end(() => resolveSize(received));
      });
      req.on('error', (e) => {
        stream.destroy();
        reject(e);
      });
      stream.on('error', (e) => reject(e));
    }).catch(async (e) => {
      // 超限/失败：删除残留空文件，不留脏数据
      const { unlink } = await import('fs/promises');
      await unlink(absPath).catch(() => {});
      throw e;
    });
    if (size === 0) {
      const { unlink } = await import('fs/promises');
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
