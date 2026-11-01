import {
  BadRequestException,
  Injectable,
  Inject,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { generationJobs, projects, shots, modelProviders } from '@server/database/schema';
import { eq, desc, and, count, sql, notInArray } from 'drizzle-orm';
import { isFreeAgnesModel } from '@shared/agnes';
import { stageOfJobType } from '@shared/stage-bindings';
import { StageBindingsService } from '../providers/stage-bindings.service';
import type {
  GenerationJob,
  JobListParams,
  JobListResponse,
  JobType,
  JobStatus,
} from '@shared/api.interface';
import { ModelGatewayService } from './model-gateway.service';
import { BudgetCapService } from './budget-cap.service';
import { BillingService } from '../billing/billing.service';
import { RoutingService } from './routing.service';

/**
 * 终态集合。所有状态写入都必须带「非终态」谓词：
 * generation.service 的 settleJobSuccess / noteJobError / cancelJob 与
 * job-worker 的完成路径、SSE 轮询会并发触碰同一行，仅靠内存里的状态检查
 * 无法阻止重复计费与终态被翻转。
 */
const TERMINAL_STATUSES = ['succeeded', 'failed', 'cancelled'] as const;

function isTerminal(status: string | null | undefined): boolean {
  if (status === null || status === undefined) return false;
  return (TERMINAL_STATUSES as readonly string[]).includes(status);
}

/** 可选时间列 → ISO 字符串；null/非法值返回 undefined（不再无保护调用 toISOString） */
function iso(value: Date | string | null | undefined): string | undefined {
  if (value === null || value === undefined) return undefined;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

/** 必填时间列 → ISO 字符串；缺失/非法时退回 fallback，避免整条列表接口 500 */
function isoOr(value: Date | string | null | undefined, fallback: Date): string {
  return iso(value) ?? fallback.toISOString();
}

@Injectable()
export class GenerationService {
  private readonly logger = new Logger(GenerationService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    private readonly modelGateway: ModelGatewayService,
    private readonly budgetCap: BudgetCapService,
    private readonly billing: BillingService,
    private readonly routing: RoutingService,
    private readonly stageBindings: StageBindingsService,
  ) {}

  /**
   * Agnes 免费判定：供应商 formatType 为 agnes 且本次使用的模型在免费白名单内。
   * 模型解析：环节绑定优先，否则按任务类型取供应商默认模型。
   */
  private async isAgnesFreeJob(job: GenerationJob): Promise<boolean> {
    try {
      // 供应商解析与网关 getProvider 同口径：任务自带 → 默认 → 首个启用
      let providerName = job.providerName;
      if (!providerName) {
        const defaults = await this.db
          .select()
          .from(modelProviders)
          .where(and(eq(modelProviders.isDefault, true), eq(modelProviders.enabled, true)))
          .limit(1);
        if (defaults.length > 0) {
          providerName = defaults[0].name;
        } else {
          const first = await this.db
            .select()
            .from(modelProviders)
            .where(eq(modelProviders.enabled, true))
            .orderBy(desc(modelProviders.routingPriority))
            .limit(1);
          if (first.length > 0) providerName = first[0].name;
        }
      }
      if (!providerName) return false;
      const rows = await this.db
        .select()
        .from(modelProviders)
        .where(eq(modelProviders.name, providerName))
        .limit(1);
      if (rows.length === 0 || rows[0].formatType !== 'agnes') return false;
      const provider = rows[0];
      let model: string | undefined;
      const stage = stageOfJobType(job.jobType ?? '');
      if (stage) {
        const binding = await this.stageBindings.resolve(stage).catch(() => undefined);
        if (binding?.model) model = binding.model;
      }
      if (!model) {
        model =
          job.jobType === 'video'
            ? (provider.videoModel ?? undefined)
            : job.jobType === 'image'
              ? (provider.imageModel ?? undefined)
              : job.jobType === 'tts'
                ? (provider.ttsModel ?? undefined)
                : (provider.textModel ?? undefined);
      }
      return isFreeAgnesModel(model);
    } catch {
      // 判定失败按收费处理（宁可多记，不漏记）
      return false;
    }
  }

  async listJobs(params: JobListParams): Promise<JobListResponse> {
    // P1 修复：查询参数经 HTTP 传入时为 string，钳制为合法范围，防 NaN/负数/超大翻页
    const page = Math.max(1, Math.floor(Number(params.page)) || 1);
    const pageSize = Math.min(
      100,
      Math.max(1, Math.floor(Number(params.pageSize)) || 20),
    );
    const conditions = [];
    if (params.projectId)
      conditions.push(eq(generationJobs.projectId, params.projectId));
    if (params.status)
      conditions.push(eq(generationJobs.status, params.status));
    if (params.jobType)
      conditions.push(eq(generationJobs.jobType, params.jobType));

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [countResult, rows] = await Promise.all([
      this.db
        .select({ count: count() })
        .from(generationJobs)
        .where(whereClause),
      this.db
        .select()
        .from(generationJobs)
        .where(whereClause)
        .orderBy(desc(generationJobs.createdAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize),
    ]);

    return {
      items: rows.map((r) => this.mapJob(r)),
      total: Number(countResult[0].count),
      page,
      pageSize,
    };
  }

  async getJob(id: string): Promise<GenerationJob> {
    const rows = await this.db
      .select()
      .from(generationJobs)
      .where(eq(generationJobs.id, id));
    if (rows.length === 0) throw new NotFoundException('任务不存在');
    return this.mapJob(rows[0]);
  }

  async createJob(
    dto: Partial<GenerationJob> & { jobType: JobType },
  ): Promise<GenerationJob> {
    // P1 超预算拦截：落库前检查月度预算。
    // 修复（TOCTOU）：旧实现是 assertAllowed() 读 SUM，随后才 insert，
    // 两步之间没有互斥 —— 并发创建可以全部通过检查，一起把上限冲穿。
    // 现在把「检查 + 插入」放进同一个事务并持月度咨询锁（BudgetCapService.runGuarded）。
    // 未配置 MONTHLY_BUDGET_CAP_CNY 时 runGuarded 直接执行、不加锁，无额外开销。
    //
    // 修复（priority 无钳制）：旧实现只有 `dto.priority ?? 50` 兜底。
    // DTO 上的 @Min/@Max 只作用于 HTTP 入口，而本服务还被流水线自动链、
    // storyboard 等内部路径直接调用，可以写入任意整数扰乱认领顺序。
    const rawPriority = Number(dto.priority ?? 50);
    const priority = Number.isFinite(rawPriority)
      ? Math.min(100, Math.max(0, Math.trunc(rawPriority)))
      : 50;

    const rows = await this.budgetCap.runGuarded(async (tx) =>
      tx
        .insert(generationJobs)
        .values({
          projectId: dto.projectId,
          jobType: dto.jobType,
          targetType: dto.targetType,
          targetId: dto.targetId,
          status: 'pending',
          priority,
          providerName: dto.providerName,
          modelName: dto.modelName,
          inputData: dto.inputData as Record<string, unknown>,
          maxRetries: dto.maxRetries ?? 3,
        })
        .returning(),
    );
    return this.mapJob(rows[0]);
  }

  /**
   * 成功结算（幂等）：终态任务直接返回，不重复结算、不重复累加项目成本。
   * 由 pollJob（视频远端完成）与任务消费器（本地同步完成）共用。
   */
  async settleJobSuccess(
    id: string,
    outputData?: Record<string, unknown>,
    actualCost?: number,
  ): Promise<GenerationJob> {
    const job = await this.getJob(id);
    if (job.status === 'succeeded') return job;
    if (job.status === 'failed' || job.status === 'cancelled') return job;

    // P1 计费 + W1 价格表单一可信源 + W2 智能路由：成功即结算。
    // 上游真实费用优先；否则按项目预算模式取档位单价（映射见 RoutingService.tierFor）
    let tablePrice: number;
    if (job.projectId) {
      const projRows = await this.db
        .select({ budgetMode: projects.budgetMode })
        .from(projects)
        .where(eq(projects.id, job.projectId))
        .limit(1);
      tablePrice = await this.billing.getUnitPrice(
        job.jobType,
        this.routing.tierFor(projRows[0]?.budgetMode ?? undefined),
      );
    } else {
      tablePrice = await this.billing.getUnitPrice(job.jobType);
    }
    const finalCostPre =
      actualCost !== undefined && actualCost > 0
        ? actualCost
        : job.cost > 0
          ? job.cost
          : tablePrice;
    // Agnes 免费模型：官方现价 $0，直接记 0（2.5-flash 限时免费，到期按下文注释处理）
    const agnesFree = await this.isAgnesFreeJob(job);
    const finalCost = agnesFree ? 0 : finalCostPre;
    const accrue = Math.max(0, finalCost - (job.cost ?? 0));

    // P0 修复（重复计费）：WHERE 必须带非终态谓词。
    // 旧实现只按 id 更新，pollJob 与 worker 完成路径并发调用时，两者都能通过上面的
    // 内存终态检查 → totalCost 被累加两次、outputData.billing 被写两次。
    // 现在由数据库保证只有第一个把任务推进终态的调用能拿到返回行，
    // 也只有拿到行才允许累加项目成本。
    const rows = await this.db
      .update(generationJobs)
      .set({
        status: 'succeeded',
        progress: 100,
        // F6 调用明细规范化（移植 ArcReel api_calls 思想的轻量版）：
        // outputData.billing 记录价格表单价与实扣，预估/结算分离展示有据可查。
        // 修复：不再回落到 job.inputData。把输入当输出会把用户 prompt 发布成镜头产物，
        // 也会让 adoptJob / writeback 读到伪造的 output.url。
        outputData: {
          ...((outputData ?? {}) as Record<string, unknown>),
          billing: {
            unitPrice: agnesFree ? 0 : tablePrice,
            charged: finalCost,
            currency: 'CNY',
            ...(agnesFree ? { free: 'agnes 免费模型' } : {}),
          },
        } as Record<string, unknown>,
        cost: finalCost.toFixed(4),
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(generationJobs.id, id),
          notInArray(generationJobs.status, [...TERMINAL_STATUSES]),
        ),
      )
      .returning();

    // 并发中已被另一条路径结算：直接返回当前行，绝不二次累加成本
    if (rows.length === 0) {
      this.logger.warn(`任务 ${id} 已被并发结算，跳过重复计费`);
      return this.getJob(id);
    }

    if (job.projectId && accrue > 0) {
      await this.db
        .update(projects)
        .set({
          totalCost: sql`${projects.totalCost} + ${accrue.toFixed(4)}`,
          updatedAt: new Date(),
        })
        .where(eq(projects.id, job.projectId));
    }
    return this.mapJob(rows[0]);
  }

  /** 失败结算（幂等）：写失败原因与完成时间 */
  async settleJobFailure(id: string, errorMessage: string): Promise<GenerationJob> {
    const job = await this.getJob(id);
    if (
      job.status === 'succeeded' ||
      job.status === 'failed' ||
      job.status === 'cancelled'
    ) {
      return job;
    }
    const rows = await this.db
      .update(generationJobs)
      .set({
        status: 'failed',
        errorMessage: errorMessage.slice(0, 500),
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(generationJobs.id, id))
      .returning();
    // V5 每镜状态机：任务终结失败 → 镜头 failed（变体不碰主状态）
    const input = (job.inputData ?? {}) as Record<string, unknown>;
    if (job.targetType === 'shot' && job.targetId && typeof input.variantGroup !== 'string') {
      const conditions = [eq(shots.id, job.targetId)];
      if (job.projectId) conditions.push(eq(shots.projectId, job.projectId));
      await this.db
        .update(shots)
        .set({ status: 'failed', updatedAt: new Date() })
        .where(and(...conditions))
        .catch((e: Error) => this.logger.warn(`镜头状态更新失败 ${job.targetId}：${e.message}`));
    }
    return this.mapJob(rows[0]);
  }

  /**
   * 记录一次失败并按 maxRetries 决定重试或终结。
   * 返回终态 failed（耗尽）或 pending（待重试）。
   */
  async noteJobError(id: string, errorMessage: string): Promise<GenerationJob> {
    const job = await this.getJob(id);
    // P0 修复（终态被翻转）：旧实现没有任何终态保护，一条迟到的错误回调能把
    // succeeded / cancelled 的任务翻回 pending，触发重跑并二次扣费。
    if (isTerminal(job.status)) {
      this.logger.warn(
        `忽略对终态任务 ${id}（${job.status}）的错误回报：${errorMessage.slice(0, 120)}`,
      );
      return job;
    }
    const nextRetry = (job.retryCount ?? 0) + 1;
    // 修复（重试预算差一）：maxRetries=N 意为「最多自动重试 N 次」，即第 N+1 次失败才终结。
    // 旧条件 nextRetry >= maxRetries 在第 N 次失败就放弃，实际只重试了 N-1 次。
    const budget = job.maxRetries ?? 3;
    if (nextRetry > budget) {
      return this.settleJobFailure(
        id,
        `${errorMessage}（已重试 ${budget} 次，放弃）`,
      );
    }
    const rows = await this.db
      .update(generationJobs)
      .set({
        status: 'pending',
        // 原子自增：并发错误回报不会互相覆盖成同一个值（旧实现是读-改-写）
        retryCount: sql`${generationJobs.retryCount} + 1`,
        errorMessage: errorMessage.slice(0, 500),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(generationJobs.id, id),
          notInArray(generationJobs.status, [...TERMINAL_STATUSES]),
        ),
      )
      .returning();
    if (rows.length === 0) return this.getJob(id);
    return this.mapJob(rows[0]);
  }

  /** 认领一个待处理任务（worker 用；无可领返回 null） */
  async claimNextPendingJob(): Promise<GenerationJob | null> {
    const rows = await this.db
      .select()
      .from(generationJobs)
      .where(eq(generationJobs.status, 'pending'))
      .orderBy(desc(generationJobs.priority), generationJobs.createdAt)
      .limit(1);
    if (rows.length === 0) return null;
    const claimed = await this.db
      .update(generationJobs)
      .set({ status: 'running', startedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(generationJobs.id, rows[0].id),
          eq(generationJobs.status, 'pending'),
        ),
      )
      .returning();
    // 并发认领冲突（单机多实例）时返回 null，本轮跳过
    if (claimed.length === 0) return null;
    return this.mapJob(claimed[0]);
  }

  /**
   * 手动重试：状态回到 pending 供消费器重新认领。
   * 修复：旧实现置 'retrying'，但认领路径（claimForQueue/claimNextPendingJob）
   * 只认领 'pending'，手动重试的任务会永久卡死在 retrying。
   */
  async retryJob(id: string): Promise<GenerationJob> {
    const job = await this.getJob(id);
    if (job.status === 'succeeded') {
      throw new BadRequestException('任务已成功，无需重试');
    }
    // 修复（预算绕过）：createJob 落库前会过 budgetCap.assertAllowed()，
    // 手动重试同样会真实调用上游并产生花费，必须走同一道闸门。
    await this.budgetCap.assertAllowed();
    const rows = await this.db
      .update(generationJobs)
      .set({
        status: 'pending',
        retryCount: job.retryCount + 1,
        errorMessage: null,
        // 修复（脏状态残留）：旧实现只重置 status / retryCount / errorMessage，
        // 却保留 progress、outputData、startedAt、completedAt、externalTaskId。后果：
        // 1) progress 仍是上次的 95，pollJob 一进演示分支立刻封顶，看不出真的重跑了；
        // 2) externalTaskId 还在，pollJob 会拿旧的外部任务 ID 去结算上一次的结果，
        //    把上次失败的产物当成本次成功输出；
        // 3) outputData 残留会让前端继续展示上一次的结果。
        // 手动重试必须是一次干净起跑。
        progress: 0,
        outputData: null,
        startedAt: null,
        completedAt: null,
        externalTaskId: null,
        updatedAt: new Date(),
      })
      .where(eq(generationJobs.id, id))
      .returning();
    if (rows.length === 0) throw new NotFoundException('任务不存在');
    return this.mapJob(rows[0]);
  }

  /**
   * F7 采纳变体：把成功的视频任务输出显式设为镜头成片。
   * 变体成功默认不覆盖（writeback 侧），只有这里能改 videoUrl，谱系清晰可审计。
   */
  async adoptJob(id: string): Promise<GenerationJob> {
    const job = await this.getJob(id);
    if (job.status !== 'succeeded') {
      throw new BadRequestException('只能采纳已成功的任务');
    }
    if (job.jobType !== 'video' || job.targetType !== 'shot' || !job.targetId) {
      throw new BadRequestException('只能采纳镜头视频任务');
    }
    const output = (job.outputData ?? {}) as Record<string, unknown>;
    const url = typeof output.url === 'string' && output.url ? output.url : undefined;
    if (!url) throw new BadRequestException('该任务没有可用视频输出');
    const conditions = [eq(shots.id, job.targetId)];
    if (job.projectId) conditions.push(eq(shots.projectId, job.projectId));
    await this.db
      .update(shots)
      .set({ videoUrl: url, updatedAt: new Date() })
      .where(and(...conditions));
    this.logger.log(`变体采纳 ${id} → 镜头 ${job.targetId}`);
    return this.getJob(id);
  }

  async cancelJob(id: string): Promise<GenerationJob> {
    const job = await this.getJob(id);
    // P1 修复：终态任务取消改为幂等直接返回，避免已完成任务被误标 cancelled
    if (isTerminal(job.status)) {
      return job;
    }
    // 修复（竞态覆盖）：与 settleJobSuccess 并发时，取消不能覆盖已结算的终态。
    // WHERE 加非终态谓词，由数据库裁决谁先落地；抢不到就返回当前行。
    const rows = await this.db
      .update(generationJobs)
      .set({
        status: 'cancelled',
        updatedAt: new Date(),
        completedAt: new Date(),
      })
      .where(
        and(
          eq(generationJobs.id, id),
          notInArray(generationJobs.status, [...TERMINAL_STATUSES]),
        ),
      )
      .returning();
    if (rows.length === 0) return this.getJob(id);
    const cancelled = this.mapJob(rows[0]);
    // 已知限制（显式记录，不再静默）：取消只改本地状态，不会通知上游。
    // externalTaskId 已存在时供应商仍在生成并照收费用，而随后的 settleJobSuccess
    // 会因终态直接 no-op —— 这笔花费连记录都留不下。
    // 彻底修复需要网关提供 cancelVideoTask（当前 ModelGatewayService 未实现），
    // 在此之前至少把事实写进日志，便于对账时定位差额来源。
    if (cancelled.externalTaskId) {
      this.logger.warn(
        `任务 ${id} 已本地取消，但上游任务 ${cancelled.externalTaskId} 未取消，` +
          '可能继续产生费用且不会被记账（网关暂无取消接口）',
      );
    }
    return cancelled;
  }

  async deleteJob(id: string): Promise<void> {
    const rows = await this.db
      .delete(generationJobs)
      .where(eq(generationJobs.id, id))
      .returning({ id: generationJobs.id });
    if (rows.length === 0) throw new NotFoundException('任务不存在');
  }

  async pollJob(id: string): Promise<GenerationJob> {
    const job = await this.getJob(id);

    // 终态直接返回
    if (
      job.status === 'succeeded' ||
      job.status === 'failed' ||
      job.status === 'cancelled'
    ) {
      return job;
    }

    // 如果有 externalTaskId 且是 video 任务，通过 model gateway 轮询
    if (job.externalTaskId && job.jobType === 'video') {
      try {
        const result = await this.modelGateway.pollVideoTask(
          job.externalTaskId,
          job.providerName,
        );
        if (result.status === 'succeeded') {
          return this.settleJobSuccess(id, result.outputData);
        }
        if (result.status === 'failed') {
          return this.settleJobFailure(id, result.errorMessage ?? '视频生成失败');
        }
        if (result.progress !== undefined) {
          const updated = await this.db
            .update(generationJobs)
            .set({ progress: result.progress, updatedAt: new Date() })
            .where(eq(generationJobs.id, id))
            .returning();
          return this.mapJob(updated[0]);
        }
      } catch (error) {
        this.logger.warn(`轮询任务失败: ${(error as Error).message}`);
      }
    }

    // 演示性进度推进：仅覆盖「消费器关闭/消费中」的等待期展示，永远不会将任务标为
    // succeeded（封顶 95），避免误判完成。
    // P0 修复：pending 任务绝不能被改写成 running。
    // 两条认领路径都只认 pending —— claimNextPendingJob() 是 where(status='pending')，
    // job-worker 的 claimForQueue 也只认领 pending 并置 queued；而 recoverOrphanedRunning()
    // 仅在 onModuleInit 执行一次。旧实现把 pending 改成 running 后，该任务再也不会被认领，
    // UI 永远停在 ≤95%，只能重启服务才能恢复。
    // 因此这里对 pending 只推进进度、不改状态，也不写 startedAt（startedAt 由认领方负责）。
    if (job.status === 'running' || job.status === 'pending') {
      const newProgress = Math.min(job.progress + 10, 95);

      const patch: Record<string, unknown> = {
        progress: newProgress,
        updatedAt: new Date(),
      };
      // P1 修复：startedAt 首次推进时显式落库，不再依赖 undefined 跳过语义；
      // 仅对已被认领的 running 任务补写，pending 任务的 startedAt 由认领路径负责
      if (job.status === 'running' && !job.startedAt) patch.startedAt = new Date();

      const rows = await this.db
        .update(generationJobs)
        .set(patch)
        .where(
          and(
            eq(generationJobs.id, id),
            notInArray(generationJobs.status, [...TERMINAL_STATUSES]),
          ),
        )
        .returning();
      if (rows.length === 0) return this.getJob(id);
      return this.mapJob(rows[0]);
    }

    return job;
  }

  private mapJob(row: typeof generationJobs.$inferSelect): GenerationJob {
    // P1 修复：数值列在 DB 可空（无 NOT NULL），此处兜底保证契约必填字段永不为 null
    return {
      id: row.id,
      projectId: row.projectId ?? undefined,
      jobType: row.jobType as JobType,
      targetType: row.targetType ?? undefined,
      targetId: row.targetId ?? undefined,
      status: row.status as JobStatus,
      progress: row.progress ?? 0,
      priority: row.priority ?? 50,
      providerName: row.providerName ?? undefined,
      modelName: row.modelName ?? undefined,
      errorMessage: row.errorMessage ?? undefined,
      inputData: (row.inputData as Record<string, unknown> | null) ?? undefined,
      outputData: (row.outputData as Record<string, unknown> | null) ?? undefined,
      retryCount: row.retryCount ?? 0,
      maxRetries: row.maxRetries ?? 3,
      cost: Number(row.cost ?? 0),
      startedAt: iso(row.startedAt),
      completedAt: iso(row.completedAt),
      externalTaskId: row.externalTaskId ?? undefined,
      // 修复：customTimestamptz 在驱动/迁移差异下可能返回 null 或字符串，
      // 无保护调用 .toISOString() 会让整个任务列表接口 500。
      createdAt: isoOr(row.createdAt, new Date(0)),
      updatedAt: isoOr(row.updatedAt, new Date(0)),
    };
  }
}
