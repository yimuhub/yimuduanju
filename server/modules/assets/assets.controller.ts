import {
  BadRequestException,
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  ParseUUIDPipe,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { readFile } from 'fs/promises';
import { relative, resolve, isAbsolute } from 'path';
import type {
  Asset,
  AssetListResponse,
} from '@shared/api.interface';
import { AssetsService } from './assets.service';
import { uploadDir } from './upload-dir';
import { AssetListQueryDto, CreateAssetDto, UpdateAssetDto } from './dto';
import { isSafeExternalUrl } from '../../common/url-guard';

/**
 * /uploads/ 相对路径 → 上传目录内绝对路径，并做包含性校验。
 * 用 path.relative 判定而不是 startsWith 前缀（后者放行 data/uploads-backup 等兄弟目录）。
 */
function resolveUnderUploads(fileUrl: string): string {
  const rel = fileUrl.replace(/^\/uploads\//, '');
  const base = resolve(uploadDir());
  const abs = resolve(base, rel);
  if (isAbsolute(rel) || relative(base, abs).startsWith('..')) {
    throw new BadRequestException('非法路径');
  }
  return abs;
}

@Controller('api/assets')
export class AssetsController {
  constructor(private readonly assetsService: AssetsService) {}

  @Get()
  async list(
    @Query() params: AssetListQueryDto,
  ): Promise<AssetListResponse> {
    return this.assetsService.list(params);
  }

  /**
   * 媒体取流：本地直接读盘返回；远程 CDN 由后端重试拉取并落盘缓存。
   * 前端资产库统一用 /api/assets/:id/content 做 img/video src。
   */
  @Get(':id/content')
  async content(
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
    @Query('projectId') projectId?: string,
  ): Promise<void> {
    const asset = await this.assetsService.get(id, projectId);
    const url = asset.fileUrl;
    if (!url) throw new BadRequestException('资产无文件地址');
    const mime = asset.mimeType
      || (asset.assetType === 'video' ? 'video/mp4'
        : asset.assetType === 'audio' ? 'audio/mpeg'
          : asset.assetType === 'image' ? 'image/png' : 'application/octet-stream');
    res.setHeader('Content-Type', mime);
    res.setHeader('Cache-Control', 'private, max-age=3600');

    if (url.startsWith('/uploads/')) {
      const abs = resolveUnderUploads(url);
      try {
        const buf = await readFile(abs);
        res.setHeader('Content-Length', String(buf.length));
        res.end(buf);
        return;
      } catch {
        throw new BadRequestException('本地文件不存在');
      }
    }
    if (asset.filePath) {
      try {
        const buf = await readFile(asset.filePath);
        res.setHeader('Content-Length', String(buf.length));
        res.end(buf);
        return;
      } catch {
        /* fallthrough to remote */
      }
    }
    if (!/^https?:\/\//i.test(url)) {
      throw new BadRequestException('不支持的资产地址');
    }
    // W7 安全修复：fileUrl 客户端可控（create/update DTO），远程取流必须过 SSRF 守卫
    if (!(await isSafeExternalUrl(url))) {
      throw new BadRequestException('资产地址被安全策略拦截（仅允许公网 http/https）');
    }
    const buf = await this.assetsService.fetchRemoteToBuffer(url, asset);
    res.setHeader('Content-Length', String(buf.length));
    res.end(buf);
  }

  @Get('by-project/:projectId')
  async listByProject(
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ): Promise<Asset[]> {
    return this.assetsService.listByProject(projectId);
  }

  @Get(':id')
  async get(
    @Param('id', ParseUUIDPipe) id: string,
    // P0 安全加固：调用方可传 projectId 启用归属约束，不传保持原行为
    @Query('projectId') projectId?: string,
  ): Promise<Asset> {
    return this.assetsService.get(id, projectId);
  }

  @Post()
  async create(@Body() body: CreateAssetDto): Promise<Asset> {
    return this.assetsService.create(body);
  }

  @Patch(':id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateAssetDto,
    @Query('projectId') projectId?: string,
  ): Promise<Asset> {
    return this.assetsService.update(id, body, projectId);
  }

  @Delete(':id')
  async delete(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('projectId') projectId?: string,
  ): Promise<void> {
    return this.assetsService.delete(id, projectId);
  }
}
