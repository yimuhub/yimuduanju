import { Module } from '@nestjs/common';
import { QcController } from './qc.controller';
import { QcService } from './qc.service';
import { StoryboardModule } from '../storyboard/storyboard.module';

@Module({
  imports: [StoryboardModule],
  controllers: [QcController],
  providers: [QcService],
})
export class QcModule {}
