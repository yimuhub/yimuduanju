import { Injectable, Inject, Logger } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { count, sql, inArray, gte, lt } from 'drizzle-orm';

import {
  projects,
  shots,
  assets,
  generationJobs,
} from '@server/database/schema';
import type { DashboardStats, CostSummary, OpsMetrics, ProjectListItem } from '@shared/api.interface';
import { BudgetCapService } from '../generation/budget-cap.service';

/**
 * W4 网关收敛：数据库行 → ProjectListItem。
 * 与原 scripts/gateway.js 的 toProjectListItem 逐字段同口径（收敛后唯一实现）。
 */
function toProjectListItemRaw(row: Record<string, any>): ProjectListItem {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    mode: row.mode,
    durationSeconds: Number(row.duration_seconds || 0),
    artStyle: row.art_style,
    thumbnailUrl: row.thumbnail_url,
    totalCost: Number(row.total_cost || 0),
    createdAt: new Date(row._created_at).toISOString(),
    updatedAt: new Date(row._updated_at).toISOString(),
  };
}

@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    private readonly budgetCap: BudgetCapService,
  ) {}

  async getStats(): Promise<DashboardStats> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const todayIso = today.toISOString();
    const tomorrowIso = tomorrow.toISOString();

    const [
      projectCount,
      shotCount,
      assetCount,
      costResult,
      runningJobsResult,
      completedTodayResult,
    ] = await Promise.all([
      // 项目总数
      this.db.select({ count: count() }).from(projects),
      // 总镜头数（所有项目的 shots 总数）
      this.db.select({ count: count() }).from(shots),
      // 资产总数
      this.db.select({ count: count() }).from(assets),
      // 总费用
      this.db
        .select({ total: sql<number>`COALESCE(SUM(${projects.totalCost}), 0)` })
        .from(projects),
      // 进行中的任务数
      this.db
        .select({ count: count() })
        .from(generationJobs)
        .where(
          inArray(generationJobs.status, ['running', 'pending', 'queued']),
        ),
      // 今日完成数
      this.db
        .select({ count: count() })
        .from(generationJobs)
        .where(
          sql`${generationJobs.status} = 'succeeded'
              AND ${generationJobs.completedAt} >= ${todayIso}
              AND ${generationJobs.completedAt} < ${tomorrowIso}`,
        ),
    ]);

    const totalProjects = Number(projectCount[0]?.count ?? 0);
    const totalShots = Number(shotCount[0]?.count ?? 0);
    const totalAssets = Number(assetCount[0]?.count ?? 0);
    const totalCost = Number(costResult[0]?.total ?? 0);
    const runningJobs = Number(runningJobsResult[0]?.count ?? 0);
    const completedToday = Number(completedTodayResult[0]?.count ?? 0);

    this.logger.log(
      `Dashboard stats: projects=${totalProjects}, shots=${totalShots}, ` +
      `assets=${totalAssets}, cost=${totalCost}, running=${runningJobs}, ` +
      `completedToday=${completedToday}`,
    );

    return {
      totalProjects,
      totalShots,
      totalAssets,
      totalCost,
      runningJobs,
      completedToday,
    };
  }

  /**
   * P1 计费真实化：费用全部来自 generationJobs.cost 落库求和。
   * 历史累计 + 本月累计 + 按任务类型聚合，预算页不再展示写死假数。
   */
  async getCostSummary(): Promise<CostSummary> {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthStartIso = monthStart.toISOString();

    const [totalResult, monthlyResult, byTypeRows] = await Promise.all([
      this.db
        .select({ total: sql<number>`COALESCE(SUM(${generationJobs.cost}), 0)` })
        .from(generationJobs),
      this.db
        .select({
          total: sql<number>`COALESCE(SUM(${generationJobs.cost}), 0)`,
          count: count(),
        })
        .from(generationJobs)
        .where(sql`${generationJobs.createdAt} >= ${monthStartIso}`),
      this.db
        .select({
          jobType: generationJobs.jobType,
          count: count(),
          cost: sql<number>`COALESCE(SUM(${generationJobs.cost}), 0)`,
        })
        .from(generationJobs)
        .where(sql`${generationJobs.createdAt} >= ${monthStartIso}`)
        .groupBy(generationJobs.jobType),
    ]);

    return {
      totalCost: Number(totalResult[0]?.total ?? 0),
      monthlyCost: Number(monthlyResult[0]?.total ?? 0),
      monthlyJobs: Number(monthlyResult[0]?.count ?? 0),
      jobsByType: byTypeRows.map((r) => ({
        jobType: r.jobType ?? 'unknown',
        count: Number(r.count ?? 0),
        cost: Number(r.cost ?? 0),
      })),
      budgetCap: this.budgetCap.getCap(),
    };
  }

  /**
   * W5 可观测 v1：任务状态分布 + 24h 成功率/平均耗时 + 月花费 + 消费器配置。
   * Prometheus 格式后续可按此口径扩展。
   */
  async getMetrics(): Promise<OpsMetrics> {
    const dayAgoIso = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const monthStartIso = new Date(
      new Date().getFullYear(),
      new Date().getMonth(),
      1,
    ).toISOString();

    const [byStatusRows, last24hRows, spendRows] = await Promise.all([
      this.db
        .select({
          status: generationJobs.status,
          count: count(),
        })
        .from(generationJobs)
        .groupBy(generationJobs.status),
      this.db
        .select({
          status: generationJobs.status,
          count: count(),
          avgSecs: sql<number | null>`AVG(EXTRACT(EPOCH FROM (${generationJobs.completedAt} - ${generationJobs.startedAt})))`,
        })
        .from(generationJobs)
        .where(sql`${generationJobs.createdAt} >= ${dayAgoIso}`)
        .groupBy(generationJobs.status),
      this.db
        .select({ total: sql<number>`COALESCE(SUM(${generationJobs.cost}), 0)` })
        .from(generationJobs)
        .where(sql`${generationJobs.createdAt} >= ${monthStartIso}`),
    ]);

    const total24 = last24hRows.reduce((s, r) => s + Number(r.count ?? 0), 0);
    const succeeded24 = Number(
      last24hRows.find((r) => r.status === 'succeeded')?.count ?? 0,
    );
    const failed24 = Number(
      last24hRows.find((r) => r.status === 'failed')?.count ?? 0,
    );
    const succeededAvg = last24hRows.find((r) => r.status === 'succeeded')?.avgSecs;

    return {
      jobsByStatus: byStatusRows.map((r) => ({
        status: r.status ?? 'unknown',
        count: Number(r.count ?? 0),
      })),
      last24h: {
        total: total24,
        succeeded: succeeded24,
        failed: failed24,
        successRate: total24 === 0 ? 1 : Math.round((succeeded24 / total24) * 1000) / 1000,
        avgCompletionMinutes:
          succeededAvg === null || succeededAvg === undefined
            ? null
            : Math.round((Number(succeededAvg) / 60) * 100) / 100,
      },
      monthlySpend: Number(spendRows[0]?.total ?? 0),
      worker: {
        enabled: process.env.JOB_WORKER_ENABLED !== 'false',
        mode: 'bullmq-with-inline-fallback',
        intervalMs: Math.max(2000, Number(process.env.JOB_WORKER_INTERVAL_MS) || 10000),
        concurrency: Math.max(1, Math.min(8, Number(process.env.JOB_WORKER_CONCURRENCY) || 2)),
      },
    };
  }

  /**
   * W4 网关收敛：最近项目（原 scripts/gateway.js 直连 PG 补全）。
   * SQL 与网关实现逐字一致；返回字段与网关 toProjectListItem 同口径。
   */
  async getRecentProjects(limit?: string | number): Promise<ProjectListItem[]> {
    const lim = Math.min(Math.max(1, Math.floor(Number(limit)) || 5), 50);
    const rows = (await this.db.execute(sql`
      SELECT id, title, description, status, mode, duration_seconds, art_style,
             thumbnail_url, total_cost, _created_at, _updated_at
      FROM projects
      ORDER BY _created_at DESC
      LIMIT ${lim}
    `)) as unknown as Record<string, any>[];
    return rows.map(toProjectListItemRaw);
  }

  /**
   * W4 网关收敛：最近动态（原 scripts/gateway.js 直连 PG 补全）。
   * 项目创建 + 生成任务按时间倒序合并；SQL 与网关实现逐字一致。
   */
  async getActivity(
    limit?: string | number,
  ): Promise<{ id: string; type: string; message: string; createdAt: string }[]> {
    const lim = Math.min(Math.max(1, Math.floor(Number(limit)) || 10), 50);
    const [projectRows, jobRows] = await Promise.all([
      this.db.execute(sql`
        SELECT id, title, _created_at FROM projects ORDER BY _created_at DESC LIMIT ${lim}
      `),
      this.db.execute(sql`
        SELECT id, job_type, status, project_id, _created_at
        FROM generation_jobs ORDER BY _created_at DESC LIMIT ${lim}
      `),
    ]);
    const items: { id: string; type: string; message: string; createdAt: string }[] = [];
    for (const p of projectRows as unknown as Record<string, any>[]) {
      items.push({
        id: p.id,
        type: 'project',
        message: `创建了项目「${p.title}」`,
        createdAt: new Date(p._created_at).toISOString(),
      });
    }
    for (const j of jobRows as unknown as Record<string, any>[]) {
      items.push({
        id: j.id,
        type: 'generation',
        message: `生成任务 ${j.job_type || 'job'} 状态：${j.status || 'pending'}`,
        createdAt: new Date(j._created_at).toISOString(),
      });
    }
    items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    return items.slice(0, lim);
  }

  /**
   * W4 网关收敛：用量趋势（原 scripts/gateway.js 直连 PG 补全）。
   * 按天聚合生成任务并补零缺失日期；SQL 与网关实现逐字一致。
   */
  async getUsageTrend(
    days?: string | number,
  ): Promise<{ date: string; cost: number; jobs: number }[]> {
    const d = Math.min(Math.max(1, Math.floor(Number(days)) || 7), 90);
    const rows = (await this.db.execute(sql`
      SELECT
        date_trunc('day', _created_at)::date AS day,
        count(*)::int AS jobs,
        COALESCE(SUM(COALESCE(cost, 0)), 0)::float AS cost
      FROM generation_jobs
      WHERE _created_at >= now() - make_interval(days => ${d})
      GROUP BY day ORDER BY day
    `)) as unknown as Record<string, any>[];
    const byDay = new Map(rows.map((r) => [String(r.day), r]));
    const out: { date: string; cost: number; jobs: number }[] = [];
    for (let i = d - 1; i >= 0; i--) {
      const dt = new Date(Date.now() - i * 86400000);
      const key = dt.toISOString().slice(0, 10);
      const row = byDay.get(key);
      out.push({
        date: key,
        cost: row ? Number(row.cost) : 0,
        jobs: row ? Number(row.jobs) : 0,
      });
    }
    return out;
  }
}
