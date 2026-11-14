import { forwardRef, Module } from '@nestjs/common';
import { GenerationController } from './generation.controller';
import { QueueAdminController } from '../queue/queue-admin.controller';
import { QueueAdminService } from '../queue/queue-admin.service';
import { GenerationService } from './generation.service';
import { ModelGatewayService } from './model-gateway.service';
import { BudgetCapService } from './budget-cap.service';
import { ArtifactQcService } from './artifact-qc.service';
import { JobWorkerService } from './job-worker.service';
import { BillingModule } from '../billing/billing.module';
import { RoutingService } from './routing.service';
import { ProviderKeyPoolService } from './provider-key-pool.service';
import { StorySkillsService } from '../story-skills/story-skills.service';
import { ProvidersModule } from '../providers/providers.module';
// 流水线自动链（P0 断链修复）：job-worker 需要分镜服务（建视频任务）、
// 导出服务（edit 合成）与质检服务（qc 任务）；后两者与分镜模块存在
// 模块级循环依赖（Storyboard/Qc ← Generation），统一 forwardRef 打通。
import { StoryboardModule } from '../storyboard/storyboard.module';
import { ExportModule } from '../export/export.module';
import { QcModule } from '../qc/qc.module';
// 资产前置（asset-first）：job worker 的 `asset_prep` 任务要调 AssetPrepService，
// 而 BibleModule 又要 GenerationModule 的预算与网关服务 —— 循环依赖走 forwardRef。
import { BibleModule } from '../bible/bible.module';

@Module({
  imports: [
    BillingModule,
    ProvidersModule,
    ExportModule,
    forwardRef(() => StoryboardModule),
    forwardRef(() => QcModule),
    forwardRef(() => BibleModule),
  ],
  controllers: [GenerationController, QueueAdminController],
  providers: [
    GenerationService,
    ModelGatewayService,
    BudgetCapService,
    // 产物指纹与「不更坏」QC 比对（migration 0024 B3）：重跑入口快照旧指纹，
    // 结算时比对新指纹；分镜模块（rerunShot）也要用，export 供 forwardRef 取用
    ArtifactQcService,
    JobWorkerService,
    RoutingService,
    ProviderKeyPoolService,
    StorySkillsService,
    QueueAdminService,
  ],
  exports: [ModelGatewayService, BudgetCapService, ArtifactQcService, RoutingService, ProviderKeyPoolService, StorySkillsService, QueueAdminService],
})
export class GenerationModule {}
