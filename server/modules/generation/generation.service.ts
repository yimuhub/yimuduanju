import {
  BadRequestException,
  Injectable,
  Inject,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { generationJobs, projects, shots, modelProviders } from '@server/database/schema';
import { eq, desc, and, count, sql, inArray } from 'drizzle-orm';
import { isFreeAgnesModel } from '@shared/agnes';
import { stageOfJobType } from '@shared/stage-bindings';
// 产物形态硬校验：变体采纳同样不允许把图片当视频设成成片
import { checkArtifact } from '@shared/artifact-kind';
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
import { systemLog } from '../../common/system-log.store';

/**
 * 未终结的任务状态。结算/失败/重试都只允许从这些状态出发，
 * 用「带状态条件的 UPDATE」做 CAS，避免并发写把终态改回去。
 */
const OPEN_JOB_STATUSES: JobStatus[] = ['pending', 'queued', 'running', 'retrying'];

/**
 * 分类型并发水位的环境变量兜底：非法值（"abc"→NaN）、空串（Number("")→0）、
 * 负数都会让该类型的水位判定永不成立 → 任务永久饿死。统一回退默认值。
 */
function envCapOr(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : fallback;
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
  /** 视频 status 轮询节流表（jobId → 上次查询时间戳） */
  private readonly videoPollAt = new Map<string, number>();
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
   * 供应商解析与网关 getProvider 同口径：任务自带 → 默认 → 首个启用。
   * 结算判定（免费/演练）必须看「实际执行的那个供应商」，否则会算错钱。
   */
  private async resolveProviderForJob(
    job: GenerationJob,
  ): Promise<typeof modelProviders.$inferSelect | null> {
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
    if (!providerName) return null;
    const rows = await this.db
      .select()
      .from(modelProviders)
      .where(eq(modelProviders.name, providerName))
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * Agnes 免费判定：供应商 formatType 为 agnes 且本次使用的模型在免费白名单内。
   * 模型解析：环节绑定优先，否则按任务类型取供应商默认模型。
   */
  private async isAgnesFreeJob(job: GenerationJob): Promise<boolean> {
    try {
      const provider = await this.resolveProviderForJob(job);
      if (!provider || provider.formatType !== 'agnes') return false;
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

  /**
   * mock 演练判定：产物来自免 Key 的占位通道，不产生任何上游费用，一律不计费。
   * 判定与网关 isMockProvider 同口径：
   * - 任务产物自报 mock（视频轮询结果已置 outputData.mock=true）；
   * - 或实际执行的供应商 formatType='mock' / 基址指向本地 mock 端点。
   * 注意：这里必须是「实际执行供应商」，不能用默认供应商猜——否则把真实调用误判成免费。
   */
  async isMockJob(
    job: GenerationJob,
    outputData?: Record<string, unknown>,
  ): Promise<boolean> {
    try {
      if (outputData?.mock === true) return true;
      const stored = (job.outputData ?? {}) as Record<string, unknown>;
      if (stored.mock === true) return true;
      const provider = await this.resolveProviderForJob(job);
      if (!provider) return false;
      return (
        provider.formatType === 'mock' ||
        /\/\/(localhost|127\.0\.0\.1)(:\d+)?\/mock(\/|$)/.test(provider.baseUrl ?? '')
      );
    } catch {
      // 判定失败按收费处理（宁可多记，不漏记；宁可不误标成免费）
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
   * 成功结算（幂等 + 并发安全）：
   * 1) 状态迁移用 CAS（`status IN 未终结态`）——两个消费器/轮询同时完成同一任务时，
   *    只有一个能命中 UPDATE，另一个拿 0 行后按当前库内状态返回，不会重复记账；
   * 2) 任务置成功与项目累计费用放在同一事务里，避免「任务已成功但费用没累加」的半写；
   * 3) 累计用 `COALESCE(total_cost,0) + delta` 原子自增，靠行锁串行化同一项目的并发结算。
   * 由 pollJob（视频远端完成）与任务消费器（本地同步完成）共用。
   */
  async settleJobSuccess(
    id: string,
    outputData?: Record<string, unknown>,
    actualCost?: number,
  ): Promise<GenerationJob> {
    const job = await this.getJob(id);
    if (!OPEN_JOB_STATUSES.includes(job.status)) return job;

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
    // mock 演练产物（占位图/占位视频/规则文案）不产生任何上游费用：一律不计费。
    // 必须在 Agnes 判定之前短路——否则占位产物会按价格表照价扣费。
    const mock = await this.isMockJob(job, outputData);
    // Agnes 免费模型：官方现价 $0，直接记 0（2.5-flash 限时免费，到期按下文注释处理）
    const agnesFree = mock ? false : await this.isAgnesFreeJob(job);
    const freeReason = mock
      ? 'mock 演练产物（占位内容，不计费）'
      : agnesFree
        ? 'agnes 免费模型'
        : undefined;
    const finalCost = mock || agnesFree ? 0 : finalCostPre;
    const accrue = Math.max(0, finalCost - (job.cost ?? 0));

    // 修复：outputData 不回落 job.inputData。把输入当输出会把用户 prompt 发布成镜头产物，
    // 也会让 adoptJob / writeback 读到伪造的 output.url（我方的增量，补到 main 事务版上）。
    const settled = await this.db.transaction(async (tx) => {
      const rows = await tx
        .update(generationJobs)
        .set({
          status: 'succeeded',
          progress: 100,
          // F6 调用明细规范化（移植 ArcReel api_calls 思想的轻量版）：
          // outputData.billing 记录价格表单价与实扣，预估/结算分离展示有据可查
          // 修复（我方增量）：outputData 不回落 job.inputData —— 把输入当输出会把用户 prompt
          // 发布成镜头产物，也会让 adoptJob / writeback 读到伪造的 output.url。
          outputData: {
            ...((outputData ?? {}) as Record<string, unknown>),
            // mock 标记是产物可信度的唯一凭据：任务页/资产库/分镜页据此打「演示」标签
            ...(mock ? { mock: true } : {}),
            billing: {
              unitPrice: mock || agnesFree ? 0 : tablePrice,
              charged: finalCost,
              currency: 'CNY',
              ...(freeReason ? { free: freeReason } : {}),
            },
          } as Record<string, unknown>,
          cost: finalCost.toFixed(4),
          // 重试后成功：清掉上一轮失败留下的报错，避免「已完成但错误信息还在」的误导
          errorMessage: null,
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        // CAS：只有仍处于未终结态的任务才允许被结算，重复/并发结算在此被拦下
        .where(and(eq(generationJobs.id, id), inArray(generationJobs.status, OPEN_JOB_STATUSES)))
        .returning();

      // 0 行 = 已被另一条结算路径处理（或期间被取消）：本次事务不写任何东西，直接按库内状态返回
      if (rows.length === 0) return null;

      if (job.projectId && accrue > 0) {
        await tx
          .update(projects)
          .set({
            // 历史行可能为 NULL（建表默认值不回溯），必须 COALESCE 否则整列变 NULL
            totalCost: sql`COALESCE(${projects.totalCost}, 0) + ${accrue.toFixed(4)}`,
            updatedAt: new Date(),
          })
          .where(eq(projects.id, job.projectId));
      }
      return rows[0];
    });

    // 未抢到结算权：以库内当前状态为准（幂等语义不变，调用方无需区分）
    if (!settled) return this.getJob(id);
    return this.mapJob(settled);
  }

  /** 失败结算（幂等 + 并发安全）：只允许从未终结态迁移，绝不覆盖已成功的结算结果 */
  async settleJobFailure(id: string, errorMessage: string): Promise<GenerationJob> {
    const job = await this.getJob(id);
    if (!OPEN_JOB_STATUSES.includes(job.status)) return job;
    // 结构化事件保留**未截断**的完整失败原因（库列只有 500 字符，长上游响应会被切掉）
    systemLog.record({
      level: 'ERROR',
      category: 'job',
      jobId: id,
      projectId: job.projectId ?? undefined,
      provider: job.providerName ?? undefined,
      message: `任务失败 [${job.jobType}/${job.targetType ?? '-'}]：${errorMessage}`,
      detail: {
        errorMessage,
        status: 'failed',
        retryCount: job.retryCount ?? 0,
        maxRetries: job.maxRetries ?? 3,
        jobType: job.jobType,
        targetType: job.targetType ?? null,
        targetId: job.targetId ?? null,
        inputData: job.inputData ?? null,
      },
    });
    const rows = await this.db
      .update(generationJobs)
      .set({
        status: 'failed',
        errorMessage: errorMessage.slice(0, 500),
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      // CAS：若同一瞬间成功结算先到，这里拿 0 行，不会把 succeeded 改回 failed
      .where(and(eq(generationJobs.id, id), inArray(generationJobs.status, OPEN_JOB_STATUSES)))
      .returning();
    if (rows.length === 0) return this.getJob(id);
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
    // 已经是终态（含并发结算抢先成功）：不再改状态，避免把 succeeded 拖回 pending
    if (!OPEN_JOB_STATUSES.includes(job.status)) return job;
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
      // CAS：同状态的并发终态写入（成功/取消）优先，重试不得覆盖
      .where(and(eq(generationJobs.id, id), inArray(generationJobs.status, OPEN_JOB_STATUSES)))
      .returning();
    if (rows.length === 0) return this.getJob(id);
    systemLog.record({
      level: 'WARN',
      category: 'job',
      jobId: id,
      projectId: job.projectId ?? undefined,
      message: `任务失败，第 ${nextRetry}/${budget} 次自动重试：${errorMessage.slice(0, 200)}`,
      detail: { errorMessage, retryCount: nextRetry, jobType: job.jobType },
    });
    return this.mapJob(rows[0]);
  }

  /** 认领一个待处理任务（worker 用；无可领返回 null） */
  /**
   * W 分类型并发队列：按 jobType 分道认领——文本/图片是秒级-分钟级任务，
   * 视频是十分钟级任务。混在一条队列里时，队头的慢视频会阻塞后面所有
   * 快任务（队头阻塞）。各类型独立并发上限（环境变量可覆盖），互不占坑。
   */
  private static readonly TYPE_CONCURRENCY: Record<string, number> = {
    video: envCapOr(process.env.JOB_CONCURRENCY_VIDEO, 2),
    image: envCapOr(process.env.JOB_CONCURRENCY_IMAGE, 4),
    text: envCapOr(process.env.JOB_CONCURRENCY_TEXT, 4),
    tts: envCapOr(process.env.JOB_CONCURRENCY_TTS, 6),
    parse_script: envCapOr(process.env.JOB_CONCURRENCY_TEXT, 4),
    script: envCapOr(process.env.JOB_CONCURRENCY_TEXT, 4),
    edit: envCapOr(process.env.JOB_CONCURRENCY_EDIT, 1),
    qc: envCapOr(process.env.JOB_CONCURRENCY_EDIT, 1),
  };

  async claimNextPendingJob(): Promise<GenerationJob | null> {
    // 有 blockedReason 的视频仍在等待首帧，必须在 SQL 层排除，避免 limit(1) 队头阻塞。
    const dependencyReady = sql`${generationJobs.inputData} ->> 'blockedReason' IS NULL`;
    // 候选按优先级/时间排序取一小批，再按"分类型并发水位"挑第一个未满道的
    const candidates = await this.db
      .select({ id: generationJobs.id, jobType: generationJobs.jobType })
      .from(generationJobs)
      .where(and(eq(generationJobs.status, 'pending'), dependencyReady))
      .orderBy(desc(generationJobs.priority), generationJobs.createdAt)
      .limit(24);
    if (candidates.length === 0) return null;

    // 各类型当前占用水位（running/queued 都计入）
    const active = await this.db
      .select({ jobType: generationJobs.jobType, count: sql<number>`count(*)::int` })
      .from(generationJobs)
      .where(sql`${generationJobs.status} in ('running','queued')`)
      .groupBy(generationJobs.jobType);
    const used = new Map<string, number>();
    for (const row of active) used.set(row.jobType, row.count);

    let pickedId: string | null = null;
    for (const cand of candidates) {
      const cap = GenerationService.TYPE_CONCURRENCY[cand.jobType] ?? 4;
      if ((used.get(cand.jobType) ?? 0) < cap) {
        pickedId = cand.id;
        used.set(cand.jobType, (used.get(cand.jobType) ?? 0) + 1);
        break;
      }
    }
    if (!pickedId) return null; // 所有候选的类型道都已满

    const claimed = await this.db
      .update(generationJobs)
      .set({ status: 'running', startedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(generationJobs.id, pickedId),
          eq(generationJobs.status, 'pending'),
          dependencyReady,
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
    const check = checkArtifact(url, 'video');
    if (!check.ok) throw new BadRequestException(check.reason ?? '该任务产物不是视频，不能采纳');
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
    if (!OPEN_JOB_STATUSES.includes(job.status)) return job;
    const rows = await this.db
      .update(generationJobs)
      .set({
        status: 'cancelled',
        updatedAt: new Date(),
        completedAt: new Date(),
      })
      // CAS：取消与成功结算并发时，谁先写到状态谁生效；后到者不会覆盖终态
      .where(and(eq(generationJobs.id, id), inArray(generationJobs.status, OPEN_JOB_STATUSES)))
      .returning();
    // 0 行 = 期间已被结算成终态（成功/失败），按当前状态返回，不再抛「任务不存在」
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
    // W 节流：同一任务 8s 内只打一次上游状态查询（多页签轮询/SSE 并发会放大
    // 查询次数，Agnes 对 status 查询有独立限流）
    if (job.externalTaskId && job.jobType === 'video') {
      const last = this.videoPollAt.get(id) ?? 0;
      if (Date.now() - last < 8_000) return job;
      this.videoPollAt.set(id, Date.now());
      try {
        const result = await this.modelGateway.pollVideoTask(
          job.externalTaskId,
          job.providerName,
        );
        if (result.status === 'succeeded') {
          return this.settleJobSuccess(id, result.outputData);
        }
        if (result.status === 'rate_limit') {
          // W: 上游状态查询限流——保持 running，退避后由下一次轮询继续，
          // 不消耗重试次数、不推进演示进度（避免"看起来在跑其实没查"）
          this.logger.warn(`视频任务 ${id} 状态查询被上游限流，稍后自动重试`);
          return job;
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
            inArray(generationJobs.status, OPEN_JOB_STATUSES),
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
