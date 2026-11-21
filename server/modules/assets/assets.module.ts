import { Module } from '@nestjs/common';
import { ExportModule } from '../export/export.module';
import { AssetsController } from './assets.controller';
import { AssetsService } from './assets.service';
import { UploadsController } from './uploads.controller';

@Module({
  // G16 元数据探测复用 ExportService 的 ffmpeg/ffprobe 路径推导
  imports: [ExportModule],
  controllers: [AssetsController, UploadsController],
  providers: [AssetsService],
  exports: [AssetsService],
})
export class AssetsModule {}
