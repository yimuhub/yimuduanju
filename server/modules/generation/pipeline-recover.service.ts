/**
 * 失败续跑（对标 huobao POST /tasks/:id/recover + resumeInterruptedTasks）
 * ---------------------------------------------------------------------------
 * 「续跑」不是「重跑」：流水线任务失败时不丢弃已产出——
 *  · 视频任务已建上游单（有 externalTaskId）→ **可续跑**：直接恢复 running 让
 *    轮询继续拉上游结果，不重新生成、不重复计费（huobao recoverVideoTask 语义）。
 *  · 其余失败任务（本地同步任务：图片/TTS/文本，或视频未建单就失败）→ **需重做**：
 *    重置为 pending 重新排队；shots 上已写入的产物字段一律保留（settleJobFailure
 *    本就只改 shots.status，不碰产物列）。
 *  · 暂停/卡死的非终态任务 → **released**：回 pending 让队列自动补位。
 * 全部动作幂等：重复点击 recover 不会翻倍（CAS 限定原状态）。
 */
import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { generationJobs, projects, shots } from '@server/database/schema';
import type { PipelineRecoverItem, PipelineRecoverResult } from '@shared/api.interface';
import { BudgetCapService } from './budget-cap.service';

/** 非终态状态集合（与 generation.service 的 OPEN 集合 + paused 对齐） */
const NON_TERMINAL_STATUSES = ['pending', 'queued', 'running', 'retrying', 'paused'];
/** 单次诊断上限：极端积压时接口必须能返回 */
const DIAGNOSE_LIMIT = 1000;
/** 确定性失败（重做也不会变好）不自动重排，只报告 */
const DETERMINISTIC_ERROR_PATTERNS = ['不支持的任务类型', '缺少 prompt', '缺少文本'];

@Injectable()
export class PipelineRecoverService {
  private readonly logger = new Logger(PipelineRecoverService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    private readonly budgetCap: BudgetCapService,
  ) {}

  /**
   * 诊断并续跑一个项目的全部非终态/失败任务。
   * 返回分类明细（resumed / requeued / released），前端流程总控页按此展示。
   */
  async recover(projectId: string): Promise<PipelineRecoverResult> {
    const projRows = await this.db
      .select({ id: projects.id, title: projects.title })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    if (projRows.length === 0) throw new NotFoundException('项目不存在');
    // 续跑会真实调用上游并产生花费，与手动重试共用同一道预算闸门
    await this.budgetCap.assertAllowed();

    const jobs = await this.db
      .select()
      .from(generationJobs)
      .where(eq(generationJobs.projectId, projectId))
      .orderBy(desc(generationJobs.createdAt))
      .limit(DIAGNOSE_LIMIT);

    // 锁定镜头集合：Agent/面板明确锁定的镜不自动重做（调研方案四红线）
    const lockedShotIds = new Set(
      (
        await this.db
          .select({ id: shots.id })
          .from(shots)
          .where(and(eq(shots.projectId, projectId), eq(shots.locked, true)))
      ).map((r) => r.id),
    );

    const resumed: PipelineRecoverItem[] = [];
    const requeued: PipelineRecoverItem[] = [];
    const released: PipelineRecoverItem[] = [];
    let skipped = 0;

    for (const job of jobs) {
      const input = (job.inputData ?? {}) as Record<string, unknown>;
      const blockedReason = typeof input.blockedReason === 'string' ? input.blockedReason : undefined;

      // ---- 非终态任务：只处理「卡住」的，正常在途的不动 ----
      if (NON_TERMINAL_STATUSES.includes(job.status)) {
        if (job.status === 'paused') {
          // eslint-disable-next-line no-await-in-loop
          const ok = await this.resumePaused(job.id);
          if (ok) {
            released.push({
              jobId: job.id,
              jobType: job.jobType,
              targetId: job.targetId ?? undefined,
              previousStatus: job.status,
              action: 'released',
              reason: '任务处于暂停态，已恢复排队',
            });
          } else skipped += 1;
          continue;
        }
        // 在途（含等待首帧的）：不动。等待中的依赖会由 reconcileFirstFrameDependencies 解封
        skipped += 1;
        continue;
      }

      // ---- 失败任务：区分「可续跑」与「需重做」 ----
      if (job.status !== 'failed') continue; // succeeded/cancelled 不碰

      const deterministic = DETERMINISTIC_ERROR_PATTERNS.some((p) =>
        (job.errorMessage ?? '').includes(p),
      );
      const locked =
        job.targetType === 'shot' && job.targetId ? lockedShotIds.has(job.targetId) : false;

      if (job.jobType === 'video' && job.externalTaskId && !deterministic) {
        // 可续跑：上游已建单，可能有产出（huobao：有 resultUrl/继续轮询原任务）。
        // 恢复 running 让 driveInflightVideoJobs 继续轮询；保留 externalTaskId 与
        // boundKeyId（轮询必须复用建单时的 Key），progress 拨回 10 表示在途。
        // eslint-disable-next-line no-await-in-loop
        const ok = await this.resumeUpstreamPolling(job.id);
        if (ok) {
          resumed.push({
            jobId: job.id,
            jobType: job.jobType,
            targetId: job.targetId ?? undefined,
            previousStatus: job.status,
            action: 'resumed',
            reason: '上游任务已建单，从上游续拉结果（不重复生成/计费）',
          });
        } else skipped += 1;
        continue;
      }

      if (deterministic) {
        skipped += 1;
        continue;
      }
      if (locked) {
        skipped += 1;
        continue;
      }

      // 需重做：干净起跑重新排队（清残留 externalTaskId/进度/错误，retryCount 归零）
      // eslint-disable-next-line no-await-in-loop
      const ok = await this.requeueFailed(job.id);
      if (ok) {
        requeued.push({
          jobId: job.id,
          jobType: job.jobType,
          targetId: job.targetId ?? undefined,
          previousStatus: job.status,
          action: 'requeued',
          reason: job.externalTaskId
            ? '上游未产出可用结果（未建单/已确认失败），重新排队生成'
            : '本地任务失败，重新排队执行',
        });
      } else skipped += 1;
    }

    // ---- 镜头状态修复：卡在 queued/generating 但已无在途任务 → 回 failed ----
    // 这些镜头是「回写中断/任务被清」的残局；它们的失败任务上面已重排，
    // 修回 failed 让前端状态可见，成功后照常回 ready。
    const openTargets = new Set(
      jobs
        .filter((j) => NON_TERMINAL_STATUSES.includes(j.status) && j.targetId)
        .map((j) => j.targetId as string),
    );
    const staleShots = await this.db
      .select({ id: shots.id, status: shots.status })
      .from(shots)
      .where(
        and(
          eq(shots.projectId, projectId),
          inArray(shots.status, ['queued', 'generating']),
        ),
      );
    let shotsRepaired = 0;
    for (const s of staleShots) {
      if (openTargets.has(s.id)) continue;
      // eslint-disable-next-line no-await-in-loop
      await this.db
        .update(shots)
        .set({ status: 'failed', updatedAt: new Date() })
        .where(eq(shots.id, s.id))
        .catch((e: Error) => this.logger.warn(`镜头状态修复失败 ${s.id}：${e.message}`));
      shotsRepaired += 1;
    }

    const total = resumed.length + requeued.length + released.length;
    this.logger.log(
      `流水线续跑 ${projectId}：诊断 ${jobs.length}，续拉 ${resumed.length}，重排 ${requeued.length}，` +
        `恢复 ${released.length}，跳过 ${skipped}，修复镜头 ${shotsRepaired}`,
    );
    return {
      projectId,
      diagnosed: jobs.length,
      resumed,
      requeued,
      released,
      shotsRepaired,
      message:
        total === 0 && shotsRepaired === 0
          ? '没有需要续跑的任务：失败任务要么已可跳过，要么属于确定性错误（请在任务页查看原因）'
          : `已续跑 ${total} 个任务（续拉 ${resumed.length} / 重做 ${requeued.length} / 恢复 ${released.length}），修复卡住镜头 ${shotsRepaired} 个`,
    };
  }

  /** 视频任务恢复轮询：running + 保留 externalTaskId（幂等：仅 failed → running） */
  private async resumeUpstreamPolling(id: string): Promise<boolean> {
    const rows = await this.db
      .update(generationJobs)
      .set({
        status: 'running',
        progress: 10,
        errorMessage: null,
        completedAt: null,
        startedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(generationJobs.id, id), eq(generationJobs.status, 'failed')))
      .returning({ id: generationJobs.id });
    return rows.length > 0;
  }

  /** 失败任务重新排队：干净起跑（retryCount 归零，queue_seq 取队尾新号） */
  private async requeueFailed(id: string): Promise<boolean> {
    const rows = await this.db
      .update(generationJobs)
      .set({
        status: 'pending',
        retryCount: 0,
        progress: 0,
        outputData: null,
        errorMessage: null,
        externalTaskId: null,
        startedAt: null,
        completedAt: null,
        queueSeq: sql`nextval('generation_jobs_queue_seq_seq')`,
        updatedAt: new Date(),
      })
      .where(and(eq(generationJobs.id, id), eq(generationJobs.status, 'failed')))
      .returning({ id: generationJobs.id });
    return rows.length > 0;
  }

  /** 暂停任务恢复排队（幂等：仅 paused → pending；语义与 QueueAdminService.resumeJob 一致） */
  private async resumePaused(id: string): Promise<boolean> {
    const rows = await this.db
      .update(generationJobs)
      .set({
        status: 'pending',
        inputData: sql`coalesce(${generationJobs.inputData}, '{}'::jsonb) - 'queuePausedAt' - 'pausedByDependency'`,
        updatedAt: new Date(),
      })
      .where(and(eq(generationJobs.id, id), eq(generationJobs.status, 'paused')))
      .returning({ id: generationJobs.id });
    return rows.length > 0;
  }
}
