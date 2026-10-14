import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { generationJobs } from '@server/database/schema';
import { count, sql } from 'drizzle-orm';

/**
 * 月度预算上限守卫（零迁移方案）。
 *
 * 上限来自环境变量 MONTHLY_BUDGET_CAP_CNY（元，未设置/<=0 视为不限）。
 * 花费口径与 cost-summary 一致：当月 generationJobs.cost 求和。
 * 所有用户发起的任务创建入口在落库前调用 assertAllowed()，超限直接 400 并给出明确原因。
 */
@Injectable()
export class BudgetCapService {
  private readonly logger = new Logger(BudgetCapService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
  ) {}

  /** 上限（元），null 表示不限 */
  getCap(): number | null {
    const raw = Number(process.env.MONTHLY_BUDGET_CAP_CNY);
    if (!Number.isFinite(raw) || raw <= 0) return null;
    return raw;
  }

  async getMonthlySpend(): Promise<number> {
    const now = new Date();
    const monthStartIso = new Date(
      now.getFullYear(),
      now.getMonth(),
      1,
    ).toISOString();
    const rows = await this.db
      .select({ total: sql<number>`COALESCE(SUM(${generationJobs.cost}), 0)` })
      .from(generationJobs)
      .where(sql`${generationJobs.createdAt} >= ${monthStartIso}`);
    return Number(rows[0]?.total ?? 0);
  }

  async assertAllowed(): Promise<void> {
    const cap = this.getCap();
    if (cap === null) return;
    const spend = await this.getMonthlySpend();
    if (spend >= cap) {
      this.logger.warn(
        `月度预算已耗尽，拒绝新任务：spend=${spend.toFixed(2)} cap=${cap.toFixed(2)}`,
      );
      throw new BadRequestException(
        `本月生成预算已用尽（¥${spend.toFixed(2)} / ¥${cap.toFixed(2)}），请上调 MONTHLY_BUDGET_CAP_CNY 或下月再试`,
      );
    }
  }
}

/** 月度任务数的轻量 honest 计数（cost-summary 复用） */
export async function countMonthlyJobs(
  db: PostgresJsDatabase,
): Promise<number> {
  const now = new Date();
  const monthStartIso = new Date(
    now.getFullYear(),
    now.getMonth(),
    1,
  ).toISOString();
  const rows = await db
    .select({ count: count() })
    .from(generationJobs)
    .where(sql`${generationJobs.createdAt} >= ${monthStartIso}`);
  return Number(rows[0]?.count ?? 0);
}
