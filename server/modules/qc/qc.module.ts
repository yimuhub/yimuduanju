import { forwardRef, Module } from '@nestjs/common';
import { QcController } from './qc.controller';
import { QcService } from './qc.service';
import { StoryboardModule } from '../storyboard/storyboard.module';

@Module({
  imports: [StoryboardModule],
  controllers: [QcController],
  providers: [QcService],
  // 流水线自动链：job-worker 的 qc 任务复用确定性规则质检
  exports: [QcService],
})
export class QcModule {}
