import { BadRequestException, Body, Controller, Get, Header, Param, ParseUUIDPipe, Post, Query, Res } from '@nestjs/common';
import { createReadStream } from 'fs';
import type { Response } from 'express';
import { ExportService } from './export.service';
import type {
  AssembleFinalVideoRequest,
  AssembleFinalVideoResult,
  PerShotExportRequest,
  PerShotExportResult,
} from '@shared/api.interface';

@Controller('api/projects/:projectId/export')
export class ExportController {
  constructor(private readonly exportService: ExportService) {}

  /**
   * 服务端成片合成：镜头成片按镜序 ffmpeg 拼接 → 可选 BGM 混音 → 可选硬字幕烧录
   * → 落盘 → 登记项目资产 + 自动提取封面。
   * POST body 可空（默认烧录字幕、无 BGM）；非致命失败以 warnings 回报。
   */
  @Post('assemble')
  async assemble(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() body?: AssembleFinalVideoRequest,
  ): Promise<AssembleFinalVideoResult> {
    const options: AssembleFinalVideoRequest = body ?? {};
    return this.exportService.assembleFinalVideo(projectId, {
      burnSubtitles: options.burnSubtitles !== false,
      subtitleStyle: options.subtitleStyle === 'box' ? 'box' : 'outline',
      bgmAssetId: typeof options.bgmAssetId === 'string' ? options.bgmAssetId : undefined,
      autoBgm: options.autoBgm === true,
    });
  }

  /**
   * 逐镜导出（migration 0025）：每个有视频的镜头独立产出一条归一化 MP4
   * （画幅/编码与整片合成同一套，可选烧录该镜自己的字幕），落盘并登记资产。
   * 单镜失败不阻断整批。POST body 可空（默认烧字幕、导出全部镜头）。
   */
  @Post('per-shot')
  async perShot(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() body?: PerShotExportRequest,
  ): Promise<PerShotExportResult> {
    const options: PerShotExportRequest = body ?? {};
    return this.exportService.exportPerShot(projectId, {
      shotIds: Array.isArray(options.shotIds) ? options.shotIds : undefined,
      burnSubtitles: options.burnSubtitles !== false,
    });
  }

  /**
   * 媒体取流代理：浏览器端合成直接 fetch 远端 CDN 会被 CORS 拦截（Failed to fetch）。
   * 前端把远端片段 URL 经此同源端点取流后再喂给 FFmpeg.wasm。仅放行本项目登记 URL + SSRF 守卫。
   */
  @Get('media')
  async media(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query('url') url: string,
    @Res() res: Response,
  ): Promise<void> {
    if (!url) throw new BadRequestException('缺少 url 参数');
    const { buffer, mime } = await this.exportService.proxyProjectMedia(projectId, url);
    res.setHeader('Content-Type', mime);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.setHeader('Content-Length', String(buffer.length));
    res.end(buffer);
  }

  /**
   * 成片下载：文件名严格等于项目名（RFC 5987 的 filename* 带 UTF-8 中文）。
   * 前端资产卡片走 fileUrl（末段已是项目名），这个端点用于「直接点链接下载 /
   * 交付给外部」的场景，保证任何路径下拿到的都是「项目名.mp4」。
   */
  @Get('final.mp4')
  async downloadFinal(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Res() res: Response,
  ): Promise<void> {
    const file = await this.exportService.getFinalVideoFile(projectId);
    // ASCII 回退名给老浏览器；现代浏览器优先用 filename*（中文不被转义成 _）
    const asciiFallback = file.fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '');
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Length', String(file.size));
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
    );
    createReadStream(file.absPath).pipe(res);
  }

  /** 字幕 SRT 文件下载 */
  @Get('subtitles.srt')
  @Header('Content-Type', 'text/plain; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="subtitles.srt"')
  async downloadSubtitles(
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ): Promise<string> {
    return this.exportService.getSubtitles(projectId);
  }

  /** 卡拉 OK 字幕 ASS 下载（P1-2：逐字 {\k} 高亮，烧录见 getKaraokeAss 注释） */
  @Get('karaoke.ass')
  @Header('Content-Type', 'text/plain; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="karaoke.ass"')
  async downloadKaraoke(
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ): Promise<string> {
    return this.exportService.getKaraokeAss(projectId);
  }

  /** 发布包 metadata.txt 下载（P2-3：分平台标题/简介/话题模板） */
  @Get('publish.txt')
  @Header('Content-Type', 'text/plain; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="publish.txt"')
  async downloadPublishPack(
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ): Promise<string> {
    return this.exportService.getPublishPack(projectId);
  }

  /** 分镜 JSON 下载（含场景 + 全部镜头，可做剪辑/备份底稿） */
  @Get('storyboard.json')
  @Header('Content-Type', 'application/json; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="storyboard.json"')
  async downloadStoryboard(
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ): Promise<unknown> {
    return this.exportService.getStoryboard(projectId);
  }

  /** 导出清单 JSON（项目/计数/资产地址/质检/费用，一览交付状态） */
  @Get('manifest.json')
  @Header('Content-Type', 'application/json; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="export-manifest.json"')
  async downloadManifest(
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ): Promise<unknown> {
    return this.exportService.getManifest(projectId);
  }

  /** 剪映草稿内容（实验性）：video/audio/text 三轨，可导入大陆版剪映继续编辑 */
  @Get('jianying.json')
  @Header('Content-Type', 'application/json; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="jianying-draft.json"')
  async downloadJianyingDraft(
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ): Promise<unknown> {
    return this.exportService.getJianyingDraft(projectId);
  }
}
