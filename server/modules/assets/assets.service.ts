import { Injectable, Inject, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { assets } from '@server/database/schema';
import { eq, desc, and, count, ilike } from 'drizzle-orm';
import { spawn } from 'child_process';
import { mkdir, stat, writeFile } from 'fs/promises';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { uploadDir } from './upload-dir';
import type { Asset, AssetListParams, AssetListResponse } from '@shared/api.interface';

@Injectable()
export class AssetsService {
  private readonly logger = new Logger(AssetsService.name);

  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase) {}

  async list(params: AssetListParams): Promise<AssetListResponse> {
    // P1 修复：查询参数经 HTTP 传入时为 string，钳制为合法范围
    const page = Math.max(1, Math.floor(Number(params.page)) || 1);
    const pageSize = Math.min(
      100,
      Math.max(1, Math.floor(Number(params.pageSize)) || 20),
    );
    const conditions = [];
    if (params.projectId) conditions.push(eq(assets.projectId, params.projectId));
    if (params.assetType) conditions.push(eq(assets.assetType, params.assetType));
    if (params.keyword) {
      // P1 修复：资产搜索之前只在 mock 兜底里过滤，真后端下搜不出东西
      const escaped = params.keyword.replace(/[\\%_]/g, (c) => `\\${c}`);
      conditions.push(ilike(assets.name, `%${escaped}%`));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [countResult, rows] = await Promise.all([
      this.db
        .select({ count: count() })
        .from(assets)
        .where(whereClause),
      this.db
        .select()
        .from(assets)
        .where(whereClause)
        .orderBy(desc(assets.createdAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize),
    ]);

    return {
      items: rows.map((r) => this.mapAsset(r)),
      total: Number(countResult[0].count),
      page,
      pageSize,
    };
  }

  // P0 安全修复：get/update/delete 支持可选 projectId 归属约束；
  // 调用方传入 projectId 时同时匹配 id + projectId，跨项目访问直接 404
  async get(id: string, projectId?: string): Promise<Asset> {
    const whereClause = projectId
      ? and(eq(assets.id, id), eq(assets.projectId, projectId))
      : eq(assets.id, id);
    const rows = await this.db.select().from(assets).where(whereClause);
    if (rows.length === 0) throw new NotFoundException('资产不存在');
    return this.mapAsset(rows[0]);
  }

  async create(dto: Partial<Asset>): Promise<Asset> {
    if (!dto.name || !dto.assetType) {
      // P0 修复：参数缺失抛 400 而非裸 Error（裸 Error 会触发 500 + 生产堆栈泄漏链）
      throw new BadRequestException('name 和 assetType 为必填项');
    }
    if (!dto.projectId) {
      throw new BadRequestException('projectId 为必填项（资产必须归属项目）');
    }
    const rows = await this.db
      .insert(assets)
      .values({
        projectId: dto.projectId,
        assetType: dto.assetType,
        name: dto.name,
        fileUrl: dto.fileUrl,
        filePath: dto.filePath,
        thumbnailUrl: dto.thumbnailUrl,
        mimeType: dto.mimeType,
        fileSize: dto.fileSize,
        durationSeconds: dto.durationSeconds?.toString(),
        width: dto.width,
        height: dto.height,
        sourceType: dto.sourceType ?? 'generated',
        sourceId: dto.sourceId,
        generationPrompt: dto.generationPrompt,
        generationModel: dto.generationModel,
        generationSeed: dto.generationSeed,
        version: dto.version ?? 1,
        parentAssetId: dto.parentAssetId,
        status: dto.status ?? 'ready',
        locked: dto.locked ?? false,
      })
      .returning();
    return this.mapAsset(rows[0]);
  }

  async update(id: string, dto: Partial<Asset>, projectId?: string): Promise<Asset> {
    const patch: Record<string, unknown> = {};
    if (dto.name !== undefined) patch.name = dto.name;
    if (dto.assetType !== undefined) patch.assetType = dto.assetType;
    if (dto.fileUrl !== undefined) patch.fileUrl = dto.fileUrl;
    if (dto.filePath !== undefined) patch.filePath = dto.filePath;
    if (dto.thumbnailUrl !== undefined) patch.thumbnailUrl = dto.thumbnailUrl;
    if (dto.mimeType !== undefined) patch.mimeType = dto.mimeType;
    if (dto.fileSize !== undefined) patch.fileSize = dto.fileSize;
    if (dto.durationSeconds !== undefined && dto.durationSeconds !== null)
      patch.durationSeconds = dto.durationSeconds.toString();
    if (dto.width !== undefined) patch.width = dto.width;
    if (dto.height !== undefined) patch.height = dto.height;
    if (dto.sourceType !== undefined) patch.sourceType = dto.sourceType;
    if (dto.sourceId !== undefined) patch.sourceId = dto.sourceId;
    if (dto.generationPrompt !== undefined)
      patch.generationPrompt = dto.generationPrompt;
    if (dto.generationModel !== undefined)
      patch.generationModel = dto.generationModel;
    if (dto.generationSeed !== undefined)
      patch.generationSeed = dto.generationSeed;
    if (dto.status !== undefined) patch.status = dto.status;
    if (dto.locked !== undefined) patch.locked = dto.locked;

    if (Object.keys(patch).length === 0) {
      return this.get(id, projectId);
    }
    patch.updatedAt = new Date();

    const whereClause = projectId
      ? and(eq(assets.id, id), eq(assets.projectId, projectId))
      : eq(assets.id, id);
    const rows = await this.db
      .update(assets)
      .set(patch)
      .where(whereClause)
      .returning();
    if (rows.length === 0) throw new NotFoundException('资产不存在');
    return this.mapAsset(rows[0]);
  }

  async delete(id: string, projectId?: string): Promise<void> {
    const whereClause = projectId
      ? and(eq(assets.id, id), eq(assets.projectId, projectId))
      : eq(assets.id, id);
    const rows = await this.db
      .delete(assets)
      .where(whereClause)
      .returning({ id: assets.id });
    if (rows.length === 0) throw new NotFoundException('资产不存在');
  }

  async listByProject(projectId: string): Promise<Asset[]> {
    const rows = await this.db
      .select()
      .from(assets)
      .where(eq(assets.projectId, projectId))
      .orderBy(desc(assets.createdAt));
    return rows.map((r) => this.mapAsset(r));
  }

  private mapAsset(row: typeof assets.$inferSelect): Asset {
    // P1 修复：DB 可空列兜底，保证契约必填字段永不为 null
    return {
      id: row.id,
      projectId: row.projectId ?? undefined,
      assetType: row.assetType,
      name: row.name,
      fileUrl: row.fileUrl ?? undefined,
      filePath: row.filePath ?? undefined,
      thumbnailUrl: row.thumbnailUrl ?? undefined,
      mimeType: row.mimeType ?? undefined,
      fileSize: row.fileSize ?? undefined,
      durationSeconds: row.durationSeconds ? Number(row.durationSeconds) : undefined,
      width: row.width ?? undefined,
      height: row.height ?? undefined,
      sourceType: row.sourceType ?? 'generated',
      sourceId: row.sourceId ?? undefined,
      generationPrompt: row.generationPrompt ?? undefined,
      generationModel: row.generationModel ?? undefined,
      generationSeed: row.generationSeed ?? undefined,
      version: row.version ?? 1,
      parentAssetId: row.parentAssetId ?? undefined,
      status: row.status ?? 'ready',
      locked: row.locked ?? false,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  /**
   * 拉远程资产到内存（取流用）。成功后若能落盘则回写本地 fileUrl，
   * 下次直连 /uploads，不再打不稳的 CDN。
   */
  async fetchRemoteToBuffer(url: string, asset: Asset): Promise<Buffer> {
    // 取流必须快失败：资产库列表不能被 CDN 卡死。
    const isHeavy = asset.assetType === 'video' || asset.assetType === 'audio';
    const perTryMs = isHeavy ? 15_000 : 6_000;
    const rounds = 1;
    const candidates = [url];
    if (url.includes('cos-platform-outputs.agnes-ai.cn')) {
      candidates.push(url.replace('cos-platform-outputs.agnes-ai.cn', 'platform-outputs.agnes-ai.space'));
    }
    if (url.includes('platform-outputs.agnes-ai.space')) {
      candidates.push(url.replace('platform-outputs.agnes-ai.space', 'cos-platform-outputs.agnes-ai.cn'));
    }
    const unique = [...new Set(candidates)];

    for (let round = 0; round < rounds; round += 1) {
      for (const target of unique) {
        // eslint-disable-next-line no-await-in-loop
        const buf = await this.curlBuffer(target, perTryMs);
        if (buf && buf.length > 64) {
          void this.persistLocal(asset, buf);
          return buf;
        }
      }
      if (round < rounds - 1) {
        // eslint-disable-next-line no-await-in-loop
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    throw new BadRequestException('媒体源暂时不可达（CDN 超时）');
  }

  private curlBuffer(url: string, timeoutMs: number): Promise<Buffer | null> {
    return new Promise((resolve) => {
      const child = spawn(
        '/usr/bin/curl',
        [
          '-sS', '-f', '-L',
          '--connect-timeout', '8',
          '--max-time', String(Math.ceil(timeoutMs / 1000)),
          url,
        ],
        { stdio: ['ignore', 'pipe', 'pipe'] },
      );
      const chunks: Buffer[] = [];
      let err = '';
      child.stdout.on('data', (c: Buffer) => chunks.push(c));
      child.stderr.on('data', (c: Buffer) => { err += c.toString(); });
      child.on('error', () => resolve(null));
      child.on('close', (code) => {
        if (code === 0 && chunks.length > 0) {
          const buf = Buffer.concat(chunks);
          if (buf.length > 64) resolve(buf);
          else resolve(null);
        } else {
          resolve(null);
        }
      });
    });
  }

  /** 落盘成功后把资产改写为本地 /uploads URL（幂等） */
  private async persistLocal(asset: Asset, buf: Buffer): Promise<void> {
    if (!asset.projectId) return;
    try {
      const dir = join(uploadDir(), asset.projectId);
      await mkdir(dir, { recursive: true });
      const ext = asset.mimeType?.includes('png') ? 'png'
        : asset.mimeType?.includes('jpeg') || asset.mimeType?.includes('jpg') ? 'jpg'
          : asset.mimeType?.includes('webp') ? 'webp'
            : asset.assetType === 'video' ? 'mp4'
              : asset.assetType === 'audio' ? 'mp3'
                : asset.assetType === 'image' ? 'png' : 'bin';
      const name = `a_${asset.id.slice(0, 8)}_${randomUUID().slice(0, 4)}.${ext}`;
      const dest = join(dir, name);
      await writeFile(dest, buf);
      const localUrl = `/uploads/${asset.projectId}/${name}`;
      await this.db
        .update(assets)
        .set({ fileUrl: localUrl, filePath: dest, fileSize: buf.length, updatedAt: new Date() })
        .where(eq(assets.id, asset.id));
      this.logger.log(`资产已落盘 ${asset.id} → ${localUrl} (${buf.length}B)`);
    } catch (e) {
      this.logger.warn(`资产落盘失败 ${asset.id}: ${(e as Error).message}`);
    }
  }
}
