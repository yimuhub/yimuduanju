import { Module, forwardRef } from '@nestjs/common';
import { ProvidersController } from './providers.controller';
import { ProvidersService } from './providers.service';
import { StageBindingsController } from './stage-bindings.controller';
import { StageBindingsService } from './stage-bindings.service';
import { GenerationModule } from '../generation/generation.module';

@Module({
  // 注意：StageBindingsController 必须在 ProvidersController 之前，
  // 否则 stage-bindings 会被 :id 路由吞掉（jobs/stream 同类坑）。
  imports: [forwardRef(() => GenerationModule)],
  controllers: [StageBindingsController, ProvidersController],
  providers: [ProvidersService, StageBindingsService],
  exports: [StageBindingsService],
})
export class ProvidersModule {}
