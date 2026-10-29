import { forwardRef, Module } from '@nestjs/common';
import { GenerationController } from './generation.controller';
import { GenerationService } from './generation.service';
import { ModelGatewayService } from './model-gateway.service';
import { BudgetCapService } from './budget-cap.service';
import { JobWorkerService } from './job-worker.service';
import { BillingModule } from '../billing/billing.module';
import { RoutingService } from './routing.service';
import { StorySkillsService } from '../story-skills/story-skills.service';
import { ProvidersModule } from '../providers/providers.module';
// 流水线自动链（P0 断链修复）：job-worker 需要分镜服务（建视频任务）、
// 导出服务（edit 合成）与质检服务（qc 任务）；后两者与分镜模块存在
// 模块级循环依赖（Storyboard/Qc ← Generation），统一 forwardRef 打通。
import { StoryboardModule } from '../storyboard/storyboard.module';
import { ExportModule } from '../export/export.module';
import { QcModule } from '../qc/qc.module';

@Module({
  imports: [
    BillingModule,
    ProvidersModule,
    ExportModule,
    forwardRef(() => StoryboardModule),
    forwardRef(() => QcModule),
  ],
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
