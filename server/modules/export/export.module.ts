import { Module } from '@nestjs/common';
import { ExportController } from './export.controller';
import { ExportService } from './export.service';

@Module({
  controllers: [ExportController],
  providers: [ExportService],
  // 流水线自动链：job-worker 的 edit 任务复用服务端 ffmpeg 合成
  exports: [ExportService],
})
export class ExportModule {}
