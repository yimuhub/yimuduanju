import { Module } from '@nestjs/common';
import { AgentsController } from './agents.controller';
import { AgentsService } from './agents.service';
import { GenerationModule } from '../generation/generation.module';
import { SkillsModule } from '../skills/skills.module';

@Module({
  imports: [GenerationModule, SkillsModule],
  controllers: [AgentsController],
  providers: [AgentsService],
})
export class AgentsModule {}
