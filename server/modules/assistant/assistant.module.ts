import { Module } from '@nestjs/common';
import { AssistantController } from './assistant.controller';
import { AssistantService } from './assistant.service';
import { GenerationModule } from '../generation/generation.module';

@Module({
  imports: [GenerationModule],
  controllers: [AssistantController],
  providers: [AssistantService],
})
export class AssistantModule {}
