import { Body, Controller, Get, Header, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ExportService } from './export.service';
import type { Asset } from '@shared/api.interface';

@Controller('api/projects/:projectId/export')
export class ExportController {
  constructor(private readonly exportService: ExportService) {}

  /**
   * 服务端成片合成：镜头成片按镜序 ffmpeg 拼接 → 落盘 → 登记项目资产。
   * POST body 可空；返回资产（项目资产页可见）。
   */
  @Post('assemble')
  async assemble(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() _body?: Record<string, unknown>,
  ): Promise<{ asset: Asset; clips: number; durationSeconds: number }> {
    return this.exportService.assembleFinalVideo(projectId);
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
