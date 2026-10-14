import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  ParseUUIDPipe,
} from '@nestjs/common';
import type { QcReport } from '@shared/api.interface';
import { QcService } from './qc.service';
import { QcTriggerDto } from './dto';

@Controller('api/projects/:projectId/qc')
export class QcController {
  constructor(private readonly qcService: QcService) {}

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
}
