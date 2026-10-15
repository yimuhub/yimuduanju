import { Controller, Get, Query } from '@nestjs/common';

import { DashboardService } from './dashboard.service';
import type { DashboardStats, CostSummary, OpsMetrics, ProjectListItem } from '@shared/api.interface';

@Controller('api/dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('stats')
  async getStats(): Promise<DashboardStats> {
    return this.dashboardService.getStats();
  }

  @Get('cost-summary')
  async getCostSummary(): Promise<CostSummary> {
    return this.dashboardService.getCostSummary();
  }

  @Get('metrics')
  async getMetrics(): Promise<OpsMetrics> {
    return this.dashboardService.getMetrics();
  }

  /**
   * W4 网关收敛：最近项目（原网关直连 PG 补全，现收敛回后端）。
   */
  @Get('recent-projects')
  async getRecentProjects(@Query('limit') limit?: string): Promise<ProjectListItem[]> {
    return this.dashboardService.getRecentProjects(limit);
  }

  /**
   * W4 网关收敛：最近动态（原网关直连 PG 补全，现收敛回后端）。
   */
  @Get('activity')
  async getActivity(@Query('limit') limit?: string) {
    return this.dashboardService.getActivity(limit);
  }

  /**
   * W4 网关收敛：用量趋势（原网关直连 PG 补全，现收敛回后端）。
   */
  @Get('usage-trend')
  async getUsageTrend(@Query('days') days?: string) {
    return this.dashboardService.getUsageTrend(days);
  }

  /**
   * 平台运营经理看板：全站创作转化漏斗与供应商通道健康度/错误归因。
   */
  @Get('funnel-health')
  async getFunnelAndChannelHealth() {
    return this.dashboardService.getFunnelAndChannelHealth();
  }
}
