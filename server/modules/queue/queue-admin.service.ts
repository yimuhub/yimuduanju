/**
 * 全站排队管理（V8）
 * ---------------------------------------------------------------------------
 * 背景：改造前「谁先跑」由三套互不一致的顺序共同决定 ——
 *   ① BullMQ 队列模式：ORDER BY _created_at ASC（同事务批量插入时间戳相同、无 tiebreaker）
 *   ② Redis 降级模式：ORDER BY priority DESC, _created_at（语义在掉线时突变）
 *   ③ 列表接口：ORDER BY _created_at DESC（前端看到的顺序与执行顺序相反）
 * 而且 priority 在队列模式完全不生效，多项目并行时既不确定、也看不见、更没法干预。
 *
 * 本服务把 queue_seq 作为唯一可读写排序键，提供：
 *   · 全站总览（按真实执行顺序，带项目名、等待时长、依赖原因、各项目排队深度）
 *   · 暂停 / 恢复 / 终止：暂停态不参与认领，后面的任务自动补位
 *   · 上移 / 下移 / 置顶 / 置底：交换或改写 queue_seq
 *   · 按项目轮转重排：一键消除「一个项目批量任务饿死其它项目」
 *   · 全站消费暂停：进程级开关，不写库
 *
 * 依赖链不回退：暂停/终止前置首帧任务会级联处理 dependsOnJobId 指向它的下游任务，
 * 避免视频任务永久停在 blockedReason（旧实现 first_frame_failed 是死锁）。
 */
import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { generationJobs, projects } from '@server/database/schema';
import { GenerationService } from '../generation/generation.service';
import { JobWorkerService } from '../generation/job-worker.service';
import {
  QUEUE_NOT_STARTED_STATUSES,
  QUEUE_OPEN_STATUSES,
  roundRobinByProject,
} from '@shared/queue-order';
import type {
  JobStatus,
  JobType,
  QueueActionResult,
  QueueItem,
  QueueMoveDirection,
  QueueOverviewResponse,
  QueueProjectSummary,
} from '@shared/api.interface';

/** 状态口径统一来自 @shared/queue-order，避免 service / worker / 前端各写一份 */
const OPEN_STATUSES: JobStatus[] = [...QUEUE_OPEN_STATUSES];
const NOT_STARTED_STATUSES: JobStatus[] = [...QUEUE_NOT_STARTED_STATUSES];
/** 单次总览/重排上限：防止极端积压把接口拖死 */
const QUEUE_LIMIT = 500;

const iso = (value: Date | string | null | undefined): string => {
  if (value === null || value === undefined) return '';
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
};

@Injectable()
export class QueueAdminService {
  private readonly logger = new Logger(QueueAdminService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    private readonly generationService: GenerationService,
    private readonly worker: JobWorkerService,
  ) {}

  // ==================== 查询 ====================

  async overview(): Promise<QueueOverviewResponse> {
    const rows = await this.db
      .select({
        job: generationJobs,
        projectTitle: projects.title,
      })
      .from(generationJobs)
      .leftJoin(projects, eq(generationJobs.projectId, projects.id))
      .where(inArray(generationJobs.status, OPEN_STATUSES))
      .orderBy(asc(generationJobs.queueSeq))
      .limit(QUEUE_LIMIT);

    const worker = await this.worker.workerStats().catch(() => ({
      mode: 'off',
      concurrency: 0,
      waiting: 0,
      active: 0,
    }));
    const now = Date.now();
    const stats = {
      pending: 0,
      queued: 0,
      running: 0,
      retrying: 0,
      paused: 0,
      blocked: 0,
    };
    const projectMap = new Map<string, QueueProjectSummary>();

    const items: QueueItem[] = rows.map(({ job, projectTitle }, index) => {
      const status = job.status as JobStatus;
      if (
        status === 'pending' ||
        status === 'queued' ||
        status === 'running' ||
        status === 'retrying' ||
        status === 'paused'
      ) {
        stats[status] += 1;
      }
      const input = (job.inputData ?? {}) as Record<string, unknown>;
      const blockedReason =
        typeof input.blockedReason === 'string' ? input.blockedReason : undefined;
      if (blockedReason) stats.blocked += 1;
      const createdAt = iso(job.createdAt) || new Date(now).toISOString();
      const startedAt = iso(job.startedAt) || undefined;
      const since = startedAt && status === 'running' ? startedAt : createdAt;
      const waitedMs = Math.max(0, now - new Date(since).getTime());

      const key = job.projectId ?? '__no_project__';
      const title = projectTitle ?? (job.projectId ? '（项目已删除）' : '无项目任务');
      if (!projectMap.has(key)) {
        projectMap.set(key, {
          projectId: key,
          projectTitle: title,
          waiting: 0,
          running: 0,
          paused: 0,
        });
      }
      const summary = projectMap.get(key)!;
      if (status === 'running') summary.running += 1;
      else if (status === 'paused') summary.paused += 1;
      else summary.waiting += 1;

      return {
        id: job.id,
        queueSeq: Number(job.queueSeq ?? 0),
        position: index + 1,
        projectId: job.projectId ?? undefined,
        projectTitle: title,
        jobType: job.jobType as JobType,
        targetType: job.targetType ?? undefined,
        targetId: job.targetId ?? undefined,
        status,
        progress: job.progress ?? 0,
        providerName: job.providerName ?? undefined,
        modelName: job.modelName ?? undefined,
        retryCount: job.retryCount ?? 0,
        maxRetries: job.maxRetries ?? 3,
        errorMessage: job.errorMessage ?? undefined,
        blockedReason,
        dependsOnJobId:
          typeof input.dependsOnJobId === 'string' ? input.dependsOnJobId : undefined,
        pausedByDependency: input.pausedByDependency === true,
        createdAt,
        updatedAt: iso(job.updatedAt) || createdAt,
        startedAt,
        waitedMs,
      };
    });

    return {
      items,
      total: items.length,
      stats,
      projects: [...projectMap.values()].sort((a, b) => b.waiting - a.waiting),
      worker,
      globallyPaused: this.worker.isQueuePaused(),
      generatedAt: new Date(now).toISOString(),
    };
  }

  // ==================== 单任务操作 ====================

  /** 暂停：只在「还没开跑」时允许；写 paused 并级联暂停依赖它的下游任务 */
  async pauseJob(id: string): Promise<QueueActionResult> {
    const job = await this.requireJob(id);
    if (job.status === 'paused') {
      return { id, status: 'paused', queueSeq: Number(job.queueSeq), message: '任务已处于暂停状态' };
    }
    if (!NOT_STARTED_STATUSES.includes(job.status as JobStatus)) {
      throw new BadRequestException(
        '正在执行或已终结的任务不能暂停（执行中的任务请使用「终止」）',
      );
    }
    const now = new Date().toISOString();
    const rows = await this.db
      .update(generationJobs)
      .set({
        status: 'paused',
        inputData: sql`jsonb_set(coalesce(${generationJobs.inputData}, '{}'::jsonb), '{queuePausedAt}', to_jsonb(${now}::text), true)`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(generationJobs.id, id),
          inArray(generationJobs.status, NOT_STARTED_STATUSES),
        ),
      )
      .returning({ id: generationJobs.id, queueSeq: generationJobs.queueSeq });
    if (rows.length === 0) {
      const fresh = await this.requireJob(id);
      return {
        id,
        status: fresh.status as JobStatus,
        queueSeq: Number(fresh.queueSeq),
        message: '任务状态已变化，未做改动',
      };
    }

    const cascaded = await this.cascadePause(id, true);
    this.logger.log(`全站排队：暂停任务 ${id}，级联暂停下游 ${cascaded} 个`);
    return {
      id,
      status: 'paused',
      queueSeq: Number(rows[0].queueSeq),
      cascaded,
      message: cascaded > 0 ? `已暂停，并级联暂停 ${cascaded} 个依赖它的任务` : '已暂停，后续任务将自动补位',
    };
  }

  /** 恢复：回到 pending 并保留原 queue_seq（原位），同时级联恢复下游 */
  async resumeJob(id: string): Promise<QueueActionResult> {
    const job = await this.requireJob(id);
    if (job.status !== 'paused') {
      throw new BadRequestException('只有已暂停的任务可以恢复');
    }
    const rows = await this.db
      .update(generationJobs)
      .set({
        status: 'pending',
        inputData: sql`coalesce(${generationJobs.inputData}, '{}'::jsonb) - 'queuePausedAt' - 'pausedByDependency'`,
        updatedAt: new Date(),
      })
      .where(and(eq(generationJobs.id, id), eq(generationJobs.status, 'paused')))
      .returning({ id: generationJobs.id, queueSeq: generationJobs.queueSeq });
    if (rows.length === 0) throw new BadRequestException('任务状态已变化，请刷新后重试');

    const cascaded = await this.cascadeResume(id);
    return {
      id,
      status: 'pending',
      queueSeq: Number(rows[0].queueSeq),
      cascaded,
      message: cascaded > 0 ? `已恢复，并级联恢复 ${cascaded} 个下游任务` : '已恢复到原排队位置',
    };
  }

  /** 终止：复用 cancelJob 的幂等 CAS；下游依赖任务一并终止，避免永久 blocked 死锁 */
  async terminateJob(id: string): Promise<QueueActionResult> {
    const job = await this.requireJob(id);
    const cancelled = await this.generationService.cancelJob(id);
    const cascaded = await this.cascadeTerminate(id);
    this.logger.log(`全站排队：终止任务 ${id}（原状态 ${job.status}），级联终止下游 ${cascaded} 个`);
    return {
      id,
      status: cancelled.status,
      queueSeq: Number(job.queueSeq),
      cascaded,
      message: cascaded > 0 ? `已终止，并级联终止 ${cascaded} 个依赖它的任务` : '已终止，后续任务将自动补位',
    };
  }

  /** 调序：与相邻任务交换 queue_seq，或置顶/置底 */
  async moveJob(id: string, direction: QueueMoveDirection): Promise<QueueActionResult> {
    const job = await this.requireJob(id);
    if (!NOT_STARTED_STATUSES.includes(job.status as JobStatus)) {
      throw new BadRequestException('只有排队中的任务可以调整顺序');
    }
    const ordered = await this.db
      .select({ id: generationJobs.id, queueSeq: generationJobs.queueSeq, status: generationJobs.status })
      .from(generationJobs)
      .where(inArray(generationJobs.status, NOT_STARTED_STATUSES))
      .orderBy(asc(generationJobs.queueSeq))
      .limit(QUEUE_LIMIT);
    const index = ordered.findIndex((r) => r.id === id);
    if (index < 0) throw new BadRequestException('任务不在可排队列表中');

    let nextSeq: number;
    let swapId: string | null = null;
    let swapSeq: number | null = null;
    const currentSeq = Number(job.queueSeq);

    if (direction === 'up') {
      if (index === 0) throw new BadRequestException('已经在队首');
      const prev = ordered[index - 1];
      nextSeq = Number(prev.queueSeq);
      swapId = prev.id;
      swapSeq = currentSeq;
    } else if (direction === 'down') {
      if (index === ordered.length - 1) throw new BadRequestException('已经在队尾');
      const next = ordered[index + 1];
      nextSeq = Number(next.queueSeq);
      swapId = next.id;
      swapSeq = currentSeq;
    } else if (direction === 'top') {
      // 不能用「可排队任务的最小 seq - 1」：running / paused / 终态任务可能正好占着那个号。
      // 取全表最小值再减一，保证与任何现存行都不撞号；后续 nextval 只增不减，也不会撞上。
      const minRow = await this.db
        .select({ minSeq: sql<string>`coalesce(min(${generationJobs.queueSeq}), 0)` })
        .from(generationJobs);
      nextSeq = Number(minRow[0]?.minSeq ?? 0) - 1;
    } else {
      // 置底必须从序列领新号。直接 max+1 会和「紧接着提交的新任务」撞号：
      // 序列仍停在旧值，下一个 nextval 会返回同一个数字，排序重新变得不确定。
      [nextSeq] = await this.allocateQueueSeqs(1);
    }

    await this.db.transaction(async (tx) => {
      if (swapId !== null && swapSeq !== null) {
        // 先给对方让位，避免两个任务同 seq 时顺序不确定
        await tx
          .update(generationJobs)
          .set({ queueSeq: swapSeq, updatedAt: new Date() })
          .where(eq(generationJobs.id, swapId));
      }
      await tx
        .update(generationJobs)
        .set({ queueSeq: nextSeq, updatedAt: new Date() })
        .where(eq(generationJobs.id, id));
    });

    return {
      id,
      status: job.status as JobStatus,
      queueSeq: nextSeq,
      message: `已${direction === 'top' ? '置顶' : direction === 'bottom' ? '置底' : direction === 'up' ? '上移' : '下移'}`,
    };
  }

  // ==================== 批量操作 ====================

  /**
   * 按项目轮转重排（可选的一键公平化）：默认仍是严格提交顺序，
   * 只有用户主动点这个按钮才改成「每个项目轮流一条」，
   * 解决单个项目批量提交几十条把其它项目整体挡在后面的问题。
   */
  async roundRobin(): Promise<{ reordered: number; message: string }> {
    const rows = await this.db
      .select({ id: generationJobs.id, projectId: generationJobs.projectId, queueSeq: generationJobs.queueSeq })
      .from(generationJobs)
      .where(inArray(generationJobs.status, NOT_STARTED_STATUSES))
      .orderBy(asc(generationJobs.queueSeq))
      .limit(QUEUE_LIMIT);
    if (rows.length < 2) return { reordered: 0, message: '可排队任务不足，无需重排' };

    // 稳定轮转逻辑收在 shared/queue-order.ts（有单测），桶内保持原提交顺序
    const interleaved = roundRobinByProject(rows);
    const projectCount = new Set(rows.map((r) => r.projectId ?? '__no_project__')).size;

    // 从数据库序列领一批全新号码：既大于所有现存行（含 running / 历史），
    // 也把序列推进到新值之后，避免紧接着提交的新任务领到同一个号造成撞号。
    const seqs = await this.allocateQueueSeqs(interleaved.length);
    await this.db.transaction(async (tx) => {
      for (let i = 0; i < interleaved.length; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await tx
          .update(generationJobs)
          .set({ queueSeq: seqs[i], updatedAt: new Date() })
          .where(eq(generationJobs.id, interleaved[i].id));
      }
    });
    const message = `已按项目轮转重排 ${interleaved.length} 个任务（${projectCount} 个项目）`;
    this.logger.log(`全站排队：${message}`);
    return { reordered: interleaved.length, message };
  }

  /** 全站消费暂停/恢复（进程级，不写库；重启自动恢复） */
  setGlobalPause(paused: boolean): { globallyPaused: boolean; message: string } {
    this.worker.setQueuePaused(paused);
    return {
      globallyPaused: paused,
      message: paused ? '全站消费已暂停，排队的任务保持原顺序' : '全站消费已恢复，从队首继续',
    };
  }

  // ==================== 内部方法 ====================

  private async requireJob(id: string) {
    const rows = await this.db
      .select()
      .from(generationJobs)
      .where(eq(generationJobs.id, id))
      .limit(1);
    if (rows.length === 0) throw new NotFoundException('任务不存在');
    return rows[0];
  }

  /**
   * 向数据库序列领一批递增的 queue_seq。
   * 人工重排 / 置底都必须走这里，不能自己算 max+1：序列不跟着走的话，
   * 下一次 nextval 会返回已被手工占用的号，两个任务同 seq → 排序重新不确定。
   */
  private async allocateQueueSeqs(count: number): Promise<number[]> {
    if (count <= 0) return [];
    const rows = (await this.db.execute(sql`
      SELECT nextval('generation_jobs_queue_seq_seq') AS seq
      FROM generate_series(1, ${count})
    `)) as unknown as { seq: string | number }[];
    return rows.map((r) => Number(r.seq)).sort((a, b) => a - b);
  }

  /** 依赖本任务的下游（视频等首帧）：只处理还没开跑的 */
  private dependentsOf(id: string) {
    return sql`${generationJobs.inputData} ->> 'dependsOnJobId' = ${id}`;
  }

  private async cascadePause(id: string, byDependency: boolean): Promise<number> {
    const rows = await this.db
      .update(generationJobs)
      .set({
        status: 'paused',
        inputData: byDependency
          ? sql`jsonb_set(coalesce(${generationJobs.inputData}, '{}'::jsonb), '{pausedByDependency}', to_jsonb(true::boolean), true)`
          : sql`coalesce(${generationJobs.inputData}, '{}'::jsonb)`,
        updatedAt: new Date(),
      })
      .where(
        and(
          this.dependentsOf(id),
          inArray(generationJobs.status, NOT_STARTED_STATUSES),
        ),
      )
      .returning({ id: generationJobs.id });
    return rows.length;
  }

  private async cascadeResume(id: string): Promise<number> {
    const rows = await this.db
      .update(generationJobs)
      .set({
        status: 'pending',
        inputData: sql`coalesce(${generationJobs.inputData}, '{}'::jsonb) - 'pausedByDependency' - 'queuePausedAt'`,
        updatedAt: new Date(),
      })
      .where(
        and(
          this.dependentsOf(id),
          eq(generationJobs.status, 'paused'),
          sql`${generationJobs.inputData} ->> 'pausedByDependency' = 'true'`,
        ),
      )
      .returning({ id: generationJobs.id });
    return rows.length;
  }

  private async cascadeTerminate(id: string): Promise<number> {
    const rows = await this.db
      .update(generationJobs)
      .set({
        status: 'cancelled',
        errorMessage: `前置任务 ${id} 已被终止，无法继续生成`,
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          this.dependentsOf(id),
          inArray(generationJobs.status, ['pending', 'queued', 'retrying', 'paused']),
        ),
      )
      .returning({ id: generationJobs.id });
    return rows.length;
  }
}
