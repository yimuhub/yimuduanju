import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AdminService } from './admin.service';
import { AdminGuard } from './admin.guard';
import type { LicenseInfo } from './license';

/**
 * W6 企业版管理接口：全部经 AdminGuard（x-admin-token）。
 * 未配置 ENTERPRISE_ADMIN_TOKEN 时整体锁定，不存在无保护的管理后台。
 */
@Controller('api/admin')
@UseGuards(AdminGuard)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('license')
  async license(): Promise<LicenseInfo> {
    return this.adminService.getLicense();
  }

  @Get('sso')
  async sso(): Promise<{ configured: boolean; provider?: string; message: string }> {
    return this.adminService.getSsoStatus();
  }

  @Get('audit-logs')
  async auditLogs(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ): Promise<{
    items: import('./admin.service').AuditLogItem[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    return this.adminService.listAuditLogs(
      page ? Number(page) : 1,
      pageSize ? Number(pageSize) : 20,
    );
  }
}
