import { Module } from '@nestjs/common';
import { ExportModule } from '../export/export.module';
import { TimelineController } from './timeline.controller';
import { TimelineMediaService } from './media-analysis.service';
import { PreviewProxyService } from './preview-proxy.service';
import { TimelineService } from './timeline.service';

@Module({
  // 复用 ExportService 的 ffmpeg 探测 / 媒体物化 / 下载守卫
  imports: [ExportModule],
  controllers: [TimelineController],
  providers: [TimelineService, TimelineMediaService, PreviewProxyService],
  exports: [TimelineService, TimelineMediaService],
})
export class TimelineModule {}
