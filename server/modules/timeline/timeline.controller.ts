import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import type { TimelineDocument } from '@shared/api.interface';
import { TimelineMediaService } from './media-analysis.service';
import { PreviewProxyService } from './preview-proxy.service';
import { TimelineService } from './timeline.service';
import { AgentTimelineOpsDto, ExportTimelineDto, SaveTimelineDto } from './dto';

const numOrUndef = (raw?: string): number | undefined => {
  if (raw == null || raw.trim() === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
};

@Controller('api/projects/:projectId/timeline')
export class TimelineController {
  constructor(
    private readonly timelineService: TimelineService,
    private readonly mediaService: TimelineMediaService,
    private readonly previewProxy: PreviewProxyService,
  ) {}

  /** 读取 EDL：未保存过则从镜头台账派生默认工程（只读） */
  @Get()
  @Header('Cache-Control', 'no-cache, no-store, must-revalidate')
  async get(
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ): Promise<TimelineDocument> {
    return this.timelineService.getDocument(projectId);
  }

  /**
   * 流畅预览代理：540p 小文件，按源地址哈希缓存。
   * 源只接受 /uploads、/api/assets/:id/content 或公网 http(s)，由 ExportService
   * materializeMediaToFile 统一做路径与 SSRF 守卫。
   */
  @Get('preview-proxy')
  async previewProxyFile(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query('src') src: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    if (!src?.trim()) throw new BadRequestException('src 不能为空');
    const raw = src.trim();
    const isLocal = raw.startsWith('/uploads/') || raw.startsWith('/api/assets/');
    const isRemote = /^https?:\/\//i.test(raw);
    if (!isLocal && !isRemote) throw new BadRequestException('src 只支持本地素材或公网 http(s)');
    const file = await this.previewProxy.cachedProxy(projectId, raw);
    if (file) {
      res.setHeader('Content-Type', 'video/mp4');
      res.setHeader('Cache-Control', 'private, max-age=86400');
      res.sendFile(file);
      return;
    }
    // 没有缓存时不阻塞播放：本地素材 302 回原片（同时后台转码），
    // 远程素材立即 404 让前端 <video> 的 onError 回退原片，避免一直黑屏。
    void this.previewProxy.ensureProxy(projectId, raw).catch(() => undefined);
    if (isLocal) {
      res.setHeader('Cache-Control', 'no-store');
      res.redirect(302, raw);
      return;
    }
    res.setHeader('Cache-Control', 'no-store');
    res.status(404).end();
  }

  /** 整体保存 EDL（事务替换 + 乐观锁） */
  @Put()
  async save(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() body: SaveTimelineDto,
  ): Promise<TimelineDocument> {
    return this.timelineService.saveDocument(projectId, body);
  }

  /**
   * 对话驱动的剪辑：一批动作，服务端事务应用 + 审计。
   * 客户端先用同一份 shared/timeline-ops 做 dry-run 出 diff，再调这里落库。
   */
  /** 最近剪辑历史（审计回放） */
  @Get('agent-ops')
  async agentOpsHistory(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query('limit') limitRaw?: string,
  ) {
    return this.timelineService.listAgentOps(projectId, limitRaw ? Number(limitRaw) : 20);
  }

  @Post('agent-ops')
  async agentOps(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() body: AgentTimelineOpsDto,
  ) {
    return this.timelineService.applyAgentOps(projectId, body);
  }

  /** 视频片段帧缩略图 sprite（懒生成 + 磁盘缓存） */
  @Get('thumbnails')
  @Header('Cache-Control', 'no-cache, no-store, must-revalidate')
  async thumbnails(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query('url') url?: string,
    @Query('interval') interval?: string,
    @Query('tileWidth') tileWidth?: string,
  ) {
    if (!url) throw new BadRequestException('缺少 url 参数');
    return this.mediaService.thumbnails(
      projectId,
      url,
      numOrUndef(interval),
      numOrUndef(tileWidth),
    );
  }

  /** 音频片段波形 peaks（懒生成 + 磁盘缓存） */
  @Get('waveform')
  @Header('Cache-Control', 'no-cache, no-store, must-revalidate')
  async waveform(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query('url') url?: string,
    @Query('points') points?: string,
  ) {
    if (!url) throw new BadRequestException('缺少 url 参数');
    return this.mediaService.waveform(projectId, url, numOrUndef(points));
  }

  /** 按 EDL 导出成片（trim → concat → 混音 → 字幕）并登记资产 */
  @Post('export')
  async export(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() body: ExportTimelineDto,
  ) {
    return this.timelineService.exportTimeline(projectId, body ?? {});
  }
}
