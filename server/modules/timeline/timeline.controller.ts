import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import type { TimelineDocument } from '@shared/api.interface';
import { TimelineMediaService } from './media-analysis.service';
import { TimelineService } from './timeline.service';
import { ExportTimelineDto, SaveTimelineDto } from './dto';

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
  ) {}

  /** 读取 EDL：未保存过则从镜头台账派生默认工程（只读） */
  @Get()
  async get(
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ): Promise<TimelineDocument> {
    return this.timelineService.getDocument(projectId);
  }

  /** 整体保存 EDL（事务替换 + 乐观锁） */
  @Put()
  async save(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() body: SaveTimelineDto,
  ): Promise<TimelineDocument> {
    return this.timelineService.saveDocument(projectId, body);
  }

  /** 视频片段帧缩略图 sprite（懒生成 + 磁盘缓存） */
  @Get('thumbnails')
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
