import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import type { TimelineDocument } from '@shared/api.interface';
import { TimelineService } from './timeline.service';
import { ExportTimelineDto, SaveTimelineDto } from './dto';

@Controller('api/projects/:projectId/timeline')
export class TimelineController {
  constructor(private readonly timelineService: TimelineService) {}

  /** 读取 EDL：未保存过则从镜头台账派生默认工程（只读） */
  @Get()
  async get(
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ): Promise<TimelineDocument> {
    return this.timelineService.getDocument(projectId);
  }

  /** 整体保存 EDL（事务替换） */
  @Put()
  async save(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() body: SaveTimelineDto,
  ): Promise<TimelineDocument> {
    return this.timelineService.saveDocument(projectId, body);
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
