import { Module } from '@nestjs/common';
import { AssistantController } from './assistant.controller';
import { AssistantService } from './assistant.service';
import { GenerationModule } from '../generation/generation.module';
import { TimelineModule } from '../timeline/timeline.module';

@Module({
  imports: [GenerationModule, TimelineModule],
  controllers: [AssistantController],
  providers: [AssistantService],
})
export class AssistantModule {}
