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
import { relative, resolve, isAbsolute, sep } from 'path';
import type {
  Asset,
  AssetListResponse,
} from '@shared/api.interface';
import { AssetsService } from './assets.service';
import { uploadDir } from './upload-dir';
import { AssetListQueryDto, CreateAssetDto, UpdateAssetDto } from './dto';
import { isSafeExternalUrl } from '../../common/url-guard';

/**
 * /uploads/ 相对地址或服务端绝对路径 → 上传目录内绝对路径，并做包含性校验。
 * 用 path.relative 判定而不是 startsWith 前缀（后者放行 data/uploads-backup 等兄弟目录）。
 */
function resolveUnderUploads(fileUrlOrPath: string): string {
  const input = fileUrlOrPath.replace(/^\/uploads\//, '');
  const base = resolve(uploadDir());
  // fileUrl 通常是 /uploads/ 相对地址，服务端归档则会写绝对 filePath；
  // 两种形式都允许，但最终路径必须仍在上传目录内。
  const abs = isAbsolute(input) ? resolve(input) : resolve(base, input);
  const rel = relative(base, abs);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
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

  // 路由顺序修复：静态前缀路由必须声明在 `:id/content` / `:id` 之前。
  // NestJS 按声明顺序匹配，GET /api/assets/by-project/<uuid> 是两段路径，
  // 会被先声明的 `@Get(':id/content')` 捕获（id='by-project' → ParseUUIDPipe 400），
  // 作战室产出面板的 listByProject 因此永远拿不到数据。

  @Get('by-project/:projectId')
  async listByProject(
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ): Promise<Asset[]> {
    return this.assetsService.listByProject(projectId);
  }

  @Get('shot/:shotId/history')
  async listShotHistory(
    @Param('shotId', ParseUUIDPipe) shotId: string,
    @Query('assetType') assetType?: string,
  ): Promise<Asset[]> {
    return this.assetsService.listShotHistory(shotId, { assetType });
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
        // filePath 也可由资产 DTO 写入，绝不能直接信任并读取任意服务器路径。
        const buf = await readFile(resolveUnderUploads(asset.filePath));
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

  @Post('shot/:shotId/revert')
  async revertShotAsset(
    @Param('shotId', ParseUUIDPipe) shotId: string,
    @Body() body: { assetId: string; assetType: 'video' | 'image' },
  ): Promise<Asset> {
    if (!body.assetId || !body.assetType) {
      throw new BadRequestException('assetId 与 assetType 为必填项');
    }
    return this.assetsService.revertShotAsset(shotId, body.assetId, body.assetType);
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
    // filePath 仅允许服务端上传/归档流程写入；公共 API 即使收到该字段也忽略。
    const input = { ...body };
    delete input.filePath;
    return this.assetsService.create(input);
  }

  @Patch(':id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateAssetDto,
    @Query('projectId') projectId?: string,
  ): Promise<Asset> {
    const input = { ...body };
    delete input.filePath;
    return this.assetsService.update(id, input, projectId);
  }

  @Delete(':id')
  async delete(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('projectId') projectId?: string,
  ): Promise<void> {
    return this.assetsService.delete(id, projectId);
  }
}
