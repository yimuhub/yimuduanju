import {
  CallHandler,
  ExecutionContext,
  Inject,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { sql } from 'drizzle-orm';

/**
 * W6 企业版：审计拦截器（只记录变更操作，不记读）。
 * body 只记顶层 key（防 Key/大文本落库），失败请求记 error。
 * 直写 audit_logs（migration 0003），本地插入可忽略延迟。
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<{
      method?: string;
      originalUrl?: string;
      url?: string;
      userContext?: { userId?: string };
      body?: unknown;
      params?: Record<string, string>;
      headers?: Record<string, string | string[] | undefined>;
    }>();
    const method = (req.method ?? '').toUpperCase();
    if (!['POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) {
      return next.handle();
    }
    // 健康检查/轮询/预估等高频只读形 POST 不记（降噪）
    const url = req.originalUrl ?? req.url ?? '';
    if (/\/poll$|\/progress$|\/estimate$|\/usage-trend$/.test(url)) {
      return next.handle();
    }
    const startedAt = Date.now();
    const headerActor = req.headers?.['x-admin-actor'];
    const actor =
      req.userContext?.userId ??
      (Array.isArray(headerActor) ? headerActor[0] : headerActor) ??
      'anonymous';
    const bodyKeys =
      req.body && typeof req.body === 'object'
        ? Object.keys(req.body as Record<string, unknown>).slice(0, 20)
        : [];
    return next.handle().pipe(
      tap({
        next: () => {
          void this.write({
            actor,
            action: `${method} ${url.split('?')[0]}`,
            resourceId: req.params?.id ?? req.params?.projectId,
            detail: { bodyKeys, ms: Date.now() - startedAt, ok: true },
          });
        },
        error: (e: Error) => {
          void this.write({
            actor,
            action: `${method} ${url.split('?')[0]}`,
            resourceId: req.params?.id ?? req.params?.projectId,
            detail: {
              bodyKeys,
              ms: Date.now() - startedAt,
              ok: false,
              error: String(e?.message ?? e).slice(0, 200),
            },
          });
        },
      }),
    );
  }

  private async write(entry: {
    actor: string;
    action: string;
    resourceId?: string;
    detail: Record<string, unknown>;
  }): Promise<void> {
    try {
      const resourceType = entry.action.split('/')[2] ?? null;
      await this.db.execute(sql`
        INSERT INTO audit_logs (actor, action, resource_type, resource_id, detail)
        VALUES (${entry.actor}, ${entry.action}, ${resourceType}, ${entry.resourceId ?? null}, ${JSON.stringify(entry.detail)}::jsonb)
      `);
    } catch (e) {
      // 审计表缺失（如未执行迁移）不阻塞业务
      this.logger.warn(`审计写入失败: ${(e as Error).message}`);
    }
  }
}
