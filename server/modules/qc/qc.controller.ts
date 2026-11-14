import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  ParseUUIDPipe,
} from '@nestjs/common';
import type { QcReport, VisualAuditReport } from '@shared/api.interface';
import { QcService } from './qc.service';
import { VisualAuditService } from './visual-audit.service';
import { QcTriggerDto } from './dto';

@Controller('api/projects/:projectId/qc')
export class QcController {
  constructor(
    private readonly qcService: QcService,
    private readonly visualAudit: VisualAuditService,
  ) {}

  @Get('latest')
  async getLatest(
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ): Promise<QcReport | null> {
    return this.qcService.getLatest(projectId);
  }

  @Get('reports')
  async listReports(
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ): Promise<QcReport[]> {
    return this.qcService.listReports(projectId);
  }

  @Get(':id')
  async getReport(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<QcReport> {
    return this.qcService.getReport(projectId, id);
  }

  @Post()
  async triggerQc(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() body: QcTriggerDto,
  ): Promise<QcReport> {
    return this.qcService.triggerQc(projectId, body ?? {});
  }

  @Post('retry-failed')
  async retryFailed(
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ): Promise<{ jobIds: string[]; retriedShots: number; skipped: number; errors: string[] }> {
    return this.qcService.retryFailedShots(projectId);
  }

  /**
   * 角色一致性看图审计（对标 ArcReel inspect_images）：定妆照 + 场景图 + 最新分镜
   * 首帧逐一对照角色 LOCK 锚点审计，结果写 qc_reports（audit_type='visual'）。
   */
  @Post('visual-audit')
  async runVisualAudit(
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ): Promise<VisualAuditReport> {
    return this.visualAudit.runAudit(projectId);
  }

  /** 最新一份看图审计报告（无则 null，前端展示空态引导） */
  @Get('visual-audit/latest')
  async getLatestVisualAudit(
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ): Promise<VisualAuditReport | null> {
    return this.visualAudit.getLatestAudit(projectId);
  }
}
