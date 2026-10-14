import { Module } from '@nestjs/common';
import { GenerationController } from './generation.controller';
import { GenerationService } from './generation.service';
import { ModelGatewayService } from './model-gateway.service';
import { BudgetCapService } from './budget-cap.service';
import { JobWorkerService } from './job-worker.service';
import { BillingModule } from '../billing/billing.module';
import { RoutingService } from './routing.service';
import { StorySkillsService } from '../story-skills/story-skills.service';
import { ProvidersModule } from '../providers/providers.module';

@Module({
  imports: [BillingModule, ProvidersModule],
  controllers: [GenerationController],
  providers: [
    GenerationService,
    ModelGatewayService,
    BudgetCapService,
    JobWorkerService,
    RoutingService,
    StorySkillsService,
  ],
  exports: [ModelGatewayService, BudgetCapService, RoutingService, StorySkillsService],
})
export class GenerationModule {}
