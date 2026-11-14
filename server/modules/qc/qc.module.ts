import { forwardRef, Module } from '@nestjs/common';
import { QcController } from './qc.controller';
import { QcService } from './qc.service';
// 看图审计（migration 0025）：定妆照/场景图/镜头首帧逐一对锚点审计
import { VisualAuditService } from './visual-audit.service';
import { StoryboardModule } from '../storyboard/storyboard.module';
// 审计需要文本网关；GenerationModule 反向依赖 QcModule（qc 任务），
// 模块级循环依赖统一 forwardRef 打通。
import { GenerationModule } from '../generation/generation.module';

@Module({
  imports: [StoryboardModule, forwardRef(() => GenerationModule)],
  controllers: [QcController],
  providers: [QcService, VisualAuditService],
  // 流水线自动链：job-worker 的 qc 任务复用确定性规则质检
  exports: [QcService],
})
export class QcModule {}
