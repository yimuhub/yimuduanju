import { forwardRef, Module } from '@nestjs/common';
import { StoryboardController } from './storyboard.controller';
import { StoryboardService } from './storyboard.service';
import { GenerationModule } from '../generation/generation.module';

@Module({
  imports: [forwardRef(() => GenerationModule)],
  controllers: [StoryboardController],
  providers: [StoryboardService],
  exports: [StoryboardService],
})
export class StoryboardModule {}
