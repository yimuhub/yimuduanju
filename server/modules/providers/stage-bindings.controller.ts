import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import type { StageBinding } from '@shared/stage-bindings';
import { StageBindingsService } from './stage-bindings.service';
import { SetStageBindingDto } from './dto';

/** B1 分环节模型绑定：每个生产环节独立指定供应商+模型（ToonFlow agentDeploy 思想） */
@Controller('api/providers/stage-bindings')
export class StageBindingsController {
  constructor(private readonly bindings: StageBindingsService) {}

  @Get()
  async list(): Promise<StageBinding[]> {
    return this.bindings.list();
  }

  @Post(':stage')
  async set(
    @Param('stage') stage: string,
    @Body() body: SetStageBindingDto,
  ): Promise<StageBinding> {
    return this.bindings.set(stage, body);
  }

  @Delete(':stage')
  async clear(@Param('stage') stage: string): Promise<{ cleared: boolean }> {
    await this.bindings.clear(stage);
    return { cleared: true };
  }
}
