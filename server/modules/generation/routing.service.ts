import { Inject, Injectable, Logger } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { modelProviders } from '@server/database/schema';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { BudgetMode, JobType } from '@shared/api.interface';

export type RouteTier = 'budget' | 'balanced' | 'flagship';

export interface RouteDecision {
  /** 价格档位（决定结算单价） */
  tier: RouteTier;
  /** 选定的 Provider 行名称；undefined 表示走网关默认逻辑 */
  providerName?: string;
  /** 是否命中官方直供 */
  official: boolean;
  /** 决策说明（展示给用户看“为什么选这个”） */
  reason: string;
}

const TIER_BY_MODE: Record<string, RouteTier> = {
  quality_first: 'flagship',
  balanced: 'balanced',
  cost_first: 'budget',
  // fast_first 走 balanced 档 + 高并发/短超时（由消费器并发与网关超时控制），不降模型档
  fast_first: 'balanced',
};

export const OFFICIAL_PROVIDER_NAME = '官方直供通道';

/**
 * 智能路由：预算模式 → 价格档位；官方通道启用且有 Key 时优先。
 * 把“更懂系统”可视化：每次返回 reason，前端可在任务详情展示。
 */
@Injectable()
export class RoutingService {
  private readonly logger = new Logger(RoutingService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
  ) {}

  tierFor(budgetMode?: string): RouteTier {
    return TIER_BY_MODE[budgetMode ?? ''] ?? 'balanced';
  }

  private async findOfficial(): Promise<{ name: string } | null> {
    // 修复：旧实现发两条查询，且第二条不再过滤 enabled ——
    // 在两条查询之间被禁用的官方通道仍会被选中并返回。
    // 合并为一条带 enabled 条件的查询；用 SQL 判空代替把 apiKey 密文取到应用层，
    // 既省一次往返，也不必触碰密文。
    const rows = await this.db
      .select({ name: modelProviders.name })
      .from(modelProviders)
      .where(
        and(
          eq(modelProviders.name, OFFICIAL_PROVIDER_NAME),
          eq(modelProviders.enabled, true),
          sql`${modelProviders.apiKey} IS NOT NULL AND ${modelProviders.apiKey} <> ''`,
        ),
      )
      .limit(1);
    if (rows.length === 0) return null;
    return { name: OFFICIAL_PROVIDER_NAME };
  }

  /**
   * 兼容 Drizzle execute 的两种返回形状。
   * postgres-js 驱动返回行数组，node-postgres 驱动返回 { rows }；
   * 无法识别时返回 null（而不是让调用方拿到 undefined 后静默失效）。
   */
  private extractRows(result: unknown): Record<string, unknown>[] | null {
    if (Array.isArray(result)) return result as Record<string, unknown>[];
    if (
      typeof result === 'object' &&
      result !== null &&
      Array.isArray((result as { rows?: unknown }).rows)
    ) {
      return (result as { rows: Record<string, unknown>[] }).rows;
    }
    return null;
  }

  private safeParseJson(text: string): { providerName?: unknown } | null {
    try {
      const parsed: unknown = JSON.parse(text);
      return typeof parsed === 'object' && parsed !== null
        ? (parsed as { providerName?: unknown })
        : null;
    } catch {
      return null;
    }
  }

  /** 项目级覆盖（对标 ArcReel 项目覆盖全局）：跟随全局时返回 null */
  private async findProjectOverride(projectId?: string): Promise<string | null> {
    if (!projectId) return null;
    try {
      // 修复：旧实现用 `as unknown as {...}[]` 强转 db.execute 的返回值。
      // Drizzle execute 的形状随驱动变化，强转让编译期失去保护：
      // 形状不符时 rows[0] 为 undefined，项目级覆盖被静默忽略，且没有任何日志。
      // 注：provider_override 是 JSONB 列且未由 schema.ts 导出（见 migration 0007），
      // 因此仍需用 raw SQL，但这里改为兼容两种形状 + 显式记录解析失败。
      const result: unknown = await this.db.execute(
        sql`SELECT provider_override FROM projects WHERE id = ${projectId} LIMIT 1`,
      );
      const rows = this.extractRows(result);
      if (rows === null) {
        this.logger.warn(
          `无法解析 projects.provider_override 查询结果（驱动返回形状不符），项目 ${projectId} 的覆盖本次不生效`,
        );
        return null;
      }
      const first = rows[0];
      if (!first) return null;
      // JSONB 列可能返回已解析对象，也可能返回字符串，两种都要处理
      const raw = first['provider_override'] ?? first['providerOverride'];
      const parsed =
        typeof raw === 'string' ? this.safeParseJson(raw) : (raw as { providerName?: unknown } | null);
      const name = parsed?.providerName;
      return typeof name === 'string' && name.trim() ? name.trim() : null;
    } catch (e) {
      // 列缺失（如未执行迁移）时不阻塞路由
      this.logger.warn(`读取项目覆盖失败: ${(e as Error).message}`);
      return null;
    }
  }

  async resolve(
    jobType: JobType,
    budgetMode?: BudgetMode,
    projectId?: string,
  ): Promise<RouteDecision> {
    const tier = this.tierFor(budgetMode);
    // 优先级：项目覆盖 > 官方直供 > 网关默认
    const override = await this.findProjectOverride(projectId);
    if (override) {
      return {
        tier,
        providerName: override,
        // 修复：项目覆盖的正是官方通道时 official 必须为 true。
        // 旧实现无条件 official: false，导致下游免费/计费判断跟着错。
        official: override === OFFICIAL_PROVIDER_NAME,
        reason: `项目专属覆盖：优先使用「${override}」（不存在或禁用时任务等待，不静默回落）`,
      };
    }
    const official = await this.findOfficial();
    if (official) {
      return {
        tier,
        providerName: official.name,
        official: true,
        reason: `官方直供（${tier === 'flagship' ? '旗舰' : tier === 'budget' ? '极速' : '均衡'}档），失败自动切换备用通道`,
      };
    }
    // 默认供应商：与网关 getProvider 同口径（isDefault 优先，其次首个启用），
    // 决策返回名字以便任务落盘；找不到时仍返回 undefined 由网关再兜底
    const def = await this.db
      .select({ name: modelProviders.name })
      .from(modelProviders)
      .where(and(eq(modelProviders.isDefault, true), eq(modelProviders.enabled, true)))
      .limit(1);
    const fallbackName =
      def[0]?.name ??
      ((
        await this.db
          .select({ name: modelProviders.name })
          .from(modelProviders)
          .where(eq(modelProviders.enabled, true))
          .orderBy(desc(modelProviders.routingPriority))
          .limit(1)
      )[0]?.name);
    return {
      tier,
      providerName: fallbackName,
      official: false,
      reason: `使用默认供应商${fallbackName ? `「${fallbackName}」` : ''}；可在设置中启用官方直供以降低成本`,
    };
  }
}
