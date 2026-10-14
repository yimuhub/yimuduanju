import { Inject, Injectable, Logger } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { desc, sql } from 'drizzle-orm';
import { verifyLicense, type LicenseInfo } from './license';

export interface AuditLogItem {
  id: string;
  actor: string | null;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  detail: unknown;
  createdAt: string;
}

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
  ) {}

  getLicense(): LicenseInfo {
    return verifyLicense(
      process.env.ENTERPRISE_LICENSE,
      process.env.LICENSE_SECRET,
    );
  }

  getSsoStatus(): {
    configured: boolean;
    provider?: string;
    message: string;
  } {
    // W6 1.0 为配置桩：读取 OIDC 标准环境变量，真实对接在 SSO 实施阶段完成
    const issuer = process.env.OIDC_ISSUER;
    const clientId = process.env.OIDC_CLIENT_ID;
    if (!issuer || !clientId) {
      return {
        configured: false,
        message:
          '未配置 SSO（需设置 OIDC_ISSUER / OIDC_CLIENT_ID / OIDC_CLIENT_SECRET），当前为单机模式',
      };
    }
    return {
      configured: true,
      provider: issuer,
      message: 'SSO 已配置（1.0 桩：登录回调对接中，以网关层集成为准）',
    };
  }

  async listAuditLogs(page = 1, pageSize = 20): Promise<{
    items: AuditLogItem[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const safePage = Math.max(1, Math.floor(Number(page)) || 1);
    const safeSize = Math.min(100, Math.max(1, Math.floor(Number(pageSize)) || 20));
    try {
      const [rows, totalRows] = await Promise.all([
        this.db.execute(sql`
          SELECT id, actor, action, resource_type, resource_id, detail, created_at
          FROM audit_logs ORDER BY created_at DESC
          LIMIT ${safeSize} OFFSET ${(safePage - 1) * safeSize}
        `),
        this.db.execute(sql`SELECT COUNT(*)::int AS count FROM audit_logs`),
      ]);
      const items = (rows as unknown as Record<string, unknown>[]).map((r) => ({
        id: String(r.id),
        actor: (r.actor as string) ?? null,
        action: String(r.action),
        resourceType: (r.resource_type as string) ?? null,
        resourceId: (r.resource_id as string) ?? null,
        detail: r.detail ?? null,
        createdAt: r.created_at instanceof Date
          ? (r.created_at as Date).toISOString()
          : String(r.created_at),
      }));
      const total = Number(
        (totalRows as unknown as Record<string, unknown>[])[0]?.count ?? 0,
      );
      return { items, total, page: safePage, pageSize: safeSize };
    } catch (e) {
      // 审计表缺失（未执行迁移）时如实返回空，而非 500
      this.logger.warn(`审计查询失败: ${(e as Error).message}`);
      return { items: [], total: 0, page: safePage, pageSize: safeSize };
    }
  }
}
