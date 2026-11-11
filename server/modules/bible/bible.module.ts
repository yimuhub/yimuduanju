import { forwardRef, Module } from '@nestjs/common';
import { BibleController } from './bible.controller';
import { BibleService } from './bible.service';
import { AssetPrepService } from './asset-prep.service';
import { GenerationModule } from '../generation/generation.module';

/**
 * 资产前置（asset-first）：AssetPrepService 需要 GenerationModule 的
 * BudgetCapService / ModelGatewayService（BibleService 已依赖），
 * 而 GenerationModule 的 job worker 反过来要在 `asset_prep` 任务里调
 * AssetPrepService —— 模块级循环依赖，统一 forwardRef 打通。
 */
@Module({
  imports: [forwardRef(() => GenerationModule)],
  controllers: [BibleController],
  providers: [BibleService, AssetPrepService],
  exports: [AssetPrepService, BibleService],
})
export class BibleModule {}
