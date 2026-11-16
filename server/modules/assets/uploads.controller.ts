import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  Inject,
  Logger,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { projects } from '@server/database/schema';
import { eq } from 'drizzle-orm';
import { createWriteStream } from 'fs';
// 修复：unlink 原本在两个分支里各写一次 `await import('fs/promises')` 动态导入，
// 而顶部已静态导入了 mkdir。统一为静态导入，去掉重复的运行时解析。
import { mkdir, stat, unlink, writeFile } from 'fs/promises';
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
/**
 * 分片上传（大文件）：单片 12MB，总大小 2GB。
 * 单请求 25MB 上限保留给小文件（零额外往返），大文件走 init → part* → complete。
 * 会话只存内存：单进程部署足够；多副本部署需换成对象存储 multipart。
 */
const CHUNK_MAX_BYTES = 12 * 1024 * 1024;
const CHUNK_TOTAL_MAX_BYTES = 2 * 1024 * 1024 * 1024;
type ChunkSession = {
  projectId: string;
  absPath: string;
  fileName: string;
  ext: string;
  mime: string;
  displayName: string;
  totalSize: number;
  received: number;
  parts: number;
  durationSeconds?: number;
};
const chunkSessions = new Map<string, ChunkSession>();
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

  /**
   * 大文件分片：初始化会话。
   * POST /api/projects/:projectId/uploads/chunks
   * {"filename":"a.mp4","mimeType":"video/mp4","totalSize":123456789,"durationSeconds":30}
   */
  @Post('chunks')
  async initChunks(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body()
    body: {
      filename?: string;
      mimeType?: string;
      totalSize?: number;
      durationSeconds?: number;
    },
  ): Promise<{ uploadId: string; chunkSize: number }> {
    const mime = (body.mimeType ?? '').split(';')[0].trim().toLowerCase();
    const ext = ALLOWED[mime];
    if (!ext) {
      throw new BadRequestException(
        `不支持的 MIME 类型，仅允许 ${Object.keys(ALLOWED).join('、')}`,
      );
    }
    const totalSize = Number(body.totalSize);
    if (!Number.isFinite(totalSize) || totalSize <= 0) {
      throw new BadRequestException('totalSize 必须是正整数');
    }
    if (totalSize > CHUNK_TOTAL_MAX_BYTES) {
      throw new BadRequestException(
        `文件超过 ${CHUNK_TOTAL_MAX_BYTES / 1024 / 1024 / 1024}GB 上限`,
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
    await writeFile(absPath, Buffer.alloc(0));

    const displayName = (body.filename ?? '')
      .split(/[/\\]/)
      .pop()
      ?.replace(/[^\w\u4e00-\u9fff.\-()\[\] ]/g, '')
      .slice(0, 80) ?? '';

    const uploadId = randomUUID();
    chunkSessions.set(uploadId, {
      projectId,
      absPath,
      fileName,
      ext,
      mime,
      displayName,
      totalSize,
      received: 0,
      parts: 0,
      durationSeconds:
        Number.isFinite(Number(body.durationSeconds)) && Number(body.durationSeconds) > 0
          ? Number(body.durationSeconds)
          : undefined,
    });
    return { uploadId, chunkSize: CHUNK_MAX_BYTES };
  }

  /**
   * 大文件分片：追加一片。必须按 index 顺序（0,1,2…），服务端只追加不重排。
   * PUT /api/projects/:projectId/uploads/chunks/:uploadId/part?index=0  (octet-stream)
   */
  @Put('chunks/:uploadId/part')
  async putChunk(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('uploadId') uploadId: string,
    @Query('index') indexRaw: string | undefined,
    @Req() req: Request,
  ): Promise<{ received: number; nextIndex: number }> {
    const session = chunkSessions.get(uploadId);
    if (!session || session.projectId !== projectId) {
      throw new NotFoundException('上传会话不存在或已过期');
    }
    const index = Number(indexRaw);
    if (!Number.isInteger(index) || index < 0) {
      throw new BadRequestException('index 必须是从 0 开始的整数');
    }
    if (index !== session.parts) {
      throw new BadRequestException(
        `分片顺序错误：期望 index=${session.parts}，收到 ${index}`,
      );
    }
    if (req.readableEnded) {
      throw new BadRequestException('请求体已被上游中间件消费，无法落盘');
    }

    const received = await new Promise<number>((resolvePart, reject) => {
      let bytes = 0;
      let settled = false;
      const stream = createWriteStream(session.absPath, { flags: 'a' });
      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        fn();
      };
      req.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > CHUNK_MAX_BYTES) {
          req.pause();
          settle(() => reject(new BadRequestException('单片超过 12MB 上限')));
          return;
        }
        if (session.received + bytes > session.totalSize) {
          req.pause();
          settle(() => reject(new BadRequestException('分片累计超过声明的 totalSize')));
          return;
        }
        if (!stream.write(chunk)) req.pause();
      });
      stream.on('drain', () => req.resume());
      req.on('end', () => stream.end(() => settle(() => resolvePart(bytes))));
      req.on('error', (e) => {
        stream.destroy();
        settle(() => reject(e));
      });
      stream.on('error', (e) => settle(() => reject(e)));
    });

    if (received === 0) throw new BadRequestException('空分片');
    session.received += received;
    session.parts += 1;
    return { received: session.received, nextIndex: session.parts };
  }

  /**
   * 大文件分片：收尾校验并登记资产。
   * POST /api/projects/:projectId/uploads/chunks/:uploadId/complete
   */
  @Post('chunks/:uploadId/complete')
  async completeChunks(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('uploadId') uploadId: string,
  ): Promise<{ asset: Asset; fileUrl: string }> {
    const session = chunkSessions.get(uploadId);
    if (!session || session.projectId !== projectId) {
      throw new NotFoundException('上传会话不存在或已过期');
    }
    const actual = (await stat(session.absPath).catch(() => null))?.size ?? 0;
    if (session.received !== session.totalSize || actual !== session.totalSize) {
      throw new BadRequestException(
        `文件不完整：声明 ${session.totalSize} 字节，实收 ${session.received}，落盘 ${actual}`,
      );
    }
    const isVideo = session.mime.startsWith('video/');
    const isAudio = session.mime.startsWith('audio/');
    const asset = await this.assetsService.create({
      projectId,
      assetType: isVideo ? 'video' : isAudio ? 'audio' : 'image',
      name:
        session.displayName ||
        `白模-${createHash('md5').update(session.fileName).digest('hex').slice(0, 8)}.${session.ext}`,
      fileUrl: `/uploads/${projectId}/${session.fileName}`,
      mimeType: session.mime,
      fileSize: session.totalSize,
      durationSeconds: session.durationSeconds,
      sourceType: 'whitemodel',
      status: 'ready',
    });
    chunkSessions.delete(uploadId);
    this.logger.log(
      `分片上传完成 ${projectId}/${session.fileName} ${(session.totalSize / 1024 / 1024).toFixed(1)}MB / ${session.parts} 片`,
    );
    return { asset, fileUrl: asset.fileUrl ?? '' };
  }

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
