import { Module } from '@nestjs/common';

import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';
import { GenerationModule } from '../generation/generation.module';
import { MemoryModule } from '../memory/memory.module';
import { AssetsModule } from '../assets/assets.module';

@Module({
  imports: [GenerationModule, MemoryModule, AssetsModule],
  controllers: [ProjectsController],
  providers: [ProjectsService],
})
export class ProjectsModule {}
