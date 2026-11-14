import { Controller, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import type { PipelineRecoverResult } from '@shared/api.interface';
import { PipelineRecoverService } from './pipeline-recover.service';

/**
 * 失败续跑端点（对标 huobao POST /tasks/:id/recover 的项目级批量版）。
 * 流程总控页失败段的「诊断并续跑」按钮调用：
 * POST /api/projects/:id/pipeline/recover
 */
@Controller('api/projects/:projectId/pipeline')
export class PipelineRecoverController {
  constructor(private readonly recoverService: PipelineRecoverService) {}

  @Post('recover')
  async recover(
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ): Promise<PipelineRecoverResult> {
    return this.recoverService.recover(projectId);
  }
}
