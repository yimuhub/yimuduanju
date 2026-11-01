import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { generationJobs } from '@server/database/schema';
import { count, sql } from 'drizzle-orm';
import { BillingService } from '../billing/billing.service';

/**
 * 月度预算上限守卫（零迁移方案）。
 *
 * 上限来自环境变量 MONTHLY_BUDGET_CAP_CNY（元，未设置视为不限）。
 * 花费口径与 cost-summary 一致：当月 generationJobs.cost 求和，
 * 并叠加「在途任务的预估花费」（见 getInFlightEstimate）。
 * 所有用户发起的任务创建入口在落库前调用 assertAllowed()，超限直接 400 并给出明确原因。
 * 需要「检查 + 落库」严格原子时，改用 runGuarded()。
 */

/**
 * 当月起点的 ISO 字符串（服务器本地时区的 1 号 00:00 → UTC）。
 * 修复：同一段逻辑原本在 getMonthlySpend 与 countMonthlyJobs 里各写一遍，
 * 一旦其中一处改动，预算闸门与 cost-summary 展示就会不同口径。
 * createdAt 是 customTimestamptz（瞬时语义），用本地月边界自洽。
 */
export function monthStartIso(now: Date = new Date()): string {
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
}

@Injectable()
export class BudgetCapService {
  private readonly logger = new Logger(BudgetCapService.name);
  /** 配置错误只在进程内告警一次，避免每个请求刷屏 */
  private capWarned = false;

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    private readonly billing: BillingService,
  ) {}

  /** 上限（元），null 表示不限 */
  getCap(): number | null {
    const rawEnv = process.env.MONTHLY_BUDGET_CAP_CNY;
    // 未设置 / 空串 = 有意「不限」，这是合法配置，不告警
    if (rawEnv === undefined || rawEnv.trim() === '') return null;
    const raw = Number(rawEnv);
    if (!Number.isFinite(raw) || raw <= 0) {
      // 修复：旧实现 `!(cap > 0)` 把「写错的值」（如 "100元"、"1e"、"-5"）
      // 静默当作不限，一个 typo 就把预算闸门整个拆掉，且不留任何痕迹。
      if (!this.capWarned) {
        this.capWarned = true;
        this.logger.error(
          `MONTHLY_BUDGET_CAP_CNY 非法（${JSON.stringify(rawEnv)}），本次按「不限」处理。` +
            '请修正为正的十进制数字（单位：元），否则预算闸门不会生效。',
        );
      }
      return null;
    }
    this.capWarned = false;
    return raw;
  }

  /** 当月已结算花费（元）。conn 可传入事务连接，供 runGuarded 复用 */
  async getMonthlySpend(conn?: PostgresJsDatabase): Promise<number> {
    const start = monthStartIso();
    const db = conn ?? this.db;
    const rows = await db
      .select({ total: sql<number>`COALESCE(SUM(${generationJobs.cost}), 0)` })
      .from(generationJobs)
      .where(sql`${generationJobs.createdAt} >= ${start}`);
    return Number(rows[0]?.total ?? 0);
  }

  /**
   * 在途任务的预估花费（元）。
   * 修复：旧实现只对「已结算 cost」求和，pending/queued/running 任务一律算 0。
   * 一批昂贵视频任务可以在任何一条结算之前把上限冲穿 —— 这恰恰是预算闸门最该拦的场景。
   * 这里按任务类型取价格表默认档单价做保守预估（不区分项目档位，避免为此多查 projects）。
   * 预估失败时退回 0（即旧行为），不阻塞任务创建。
   */
  async getInFlightEstimate(conn?: PostgresJsDatabase): Promise<number> {
    try {
      const db = conn ?? this.db;
      const rows = await db
        .select({ jobType: generationJobs.jobType, n: count() })
        .from(generationJobs)
        .where(sql`${generationJobs.status} IN ('pending', 'queued', 'running', 'retrying')`)
        .groupBy(generationJobs.jobType);
      let total = 0;
      for (const row of rows) {
        const price = await this.billing.getUnitPrice(String(row.jobType ?? ''));
        const n = Number(row.n ?? 0);
        if (Number.isFinite(price) && Number.isFinite(n)) total += price * n;
      }
      return total;
    } catch (e) {
      this.logger.warn(`在途花费预估失败，本次按 0 计入：${(e as Error).message}`);
      return 0;
    }
  }

  /**
   * 预算闸门。已结算花费 + 在途预估 >= 上限即拒绝。
   * 注意：本方法本身不是原子的（检查与调用方随后的 insert 之间仍有窗口）；
   * 需要严格原子时用 runGuarded()。
   */
  async assertAllowed(conn?: PostgresJsDatabase): Promise<void> {
    const cap = this.getCap();
    if (cap === null) return;
    const [spend, inFlight] = await Promise.all([
      this.getMonthlySpend(conn),
      this.getInFlightEstimate(conn),
    ]);
    const projected = spend + inFlight;
    if (projected >= cap) {
      this.logger.warn(
        `月度预算已耗尽，拒绝新任务：settled=${spend.toFixed(2)} inflight≈${inFlight.toFixed(2)} cap=${cap.toFixed(2)}`,
      );
      throw new BadRequestException(
        `本月生成预算已用尽（已结算 ¥${spend.toFixed(2)} + 在途预估 ¥${inFlight.toFixed(2)} / 上限 ¥${cap.toFixed(2)}），请上调 MONTHLY_BUDGET_CAP_CNY 或下月再试`,
      );
    }
  }

  /**
   * 在互斥保护下执行「预算检查 + 落库」。
   * 修复（TOCTOU）：旧流程是 assertAllowed() 读 SUM，随后调用方才 insert，
   * 两步之间没有互斥 —— 并发创建可以全部通过检查，一起把上限冲穿。
   * 这里用 Postgres 事务级咨询锁（锁键按月份取）把「检查 → 插入」串行化，
   * 锁在事务提交/回滚时自动释放，无需新表或迁移。
   *
   * 用法：const rows = await budgetCap.runGuarded((tx) => tx.insert(...).values(...).returning());
   * 不限额时直接执行 fn，不加锁，避免无谓串行化。
   */
  async runGuarded<T>(fn: (tx: PostgresJsDatabase) => Promise<T>): Promise<T> {
    const cap = this.getCap();
    if (cap === null) return fn(this.db);
    return this.db.transaction(async (rawTx) => {
      const tx = rawTx as unknown as PostgresJsDatabase;
      const lockKey = `yimu:budget:${monthStartIso()}`;
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${lockKey})::bigint)`);
      await this.assertAllowed(tx);
      return fn(tx);
    });
  }
}

/** 月度任务数的轻量 honest 计数（cost-summary 复用） */
export async function countMonthlyJobs(
  db: PostgresJsDatabase,
): Promise<number> {
  // 修复：月初边界改用共享的 monthStartIso()，与预算闸门保持同口径
  const rows = await db
    .select({ count: count() })
    .from(generationJobs)
    .where(sql`${generationJobs.createdAt} >= ${monthStartIso()}`);
  return Number(rows[0]?.count ?? 0);
}
