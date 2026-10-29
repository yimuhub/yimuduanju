import { Module } from '@nestjs/common';

import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';
import { GenerationModule } from '../generation/generation.module';
import { MemoryModule } from '../memory/memory.module';
import { AssetsModule } from '../assets/assets.module';
import { StoryboardModule } from '../storyboard/storyboard.module';

@Module({
  imports: [GenerationModule, MemoryModule, AssetsModule, StoryboardModule],
  controllers: [ProjectsController],
  providers: [ProjectsService],
})
export class ProjectsModule {}
