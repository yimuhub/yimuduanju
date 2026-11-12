import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import {
  assets,
  characters,
  generationJobs,
  locations,
  modelProviders,
  projects,
  props,
  scenes,
  segments,
  shots,
} from '@server/database/schema';
// 修复：新增 isNull / lt / notInArray / or，供「陈旧 queued 回收」与
// 「按 provider 维度限流冷却」的条件构造使用；desc 用于任务列表按时间倒序；
// sql 用于首帧质量门的 JSONB 列运算与按 updatedAt 轮转
import { and, desc, eq, inArray, isNotNull, isNull, lt, notInArray, or, sql } from 'drizzle-orm';
import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import { mkdir, stat, writeFile } from 'fs/promises';
import { join } from 'path';
import type {
  AxisDirection,
  CharacterIdentityKit,
  GenerationJob,
  ProfessionalPrefs,
  PropStateVariant,
  ScreenDirection,
  ShotBeat,
  SpaceAnchor,
} from '@shared/api.interface';
import { stageOfJobType, type StageKey } from '@shared/stage-bindings';
import { StageBindingsService } from '../providers/stage-bindings.service';
import { GenerationService } from './generation.service';
import { ModelGatewayService } from './model-gateway.service';
import { BudgetCapService } from './budget-cap.service';
import { RoutingService } from './routing.service';
import { StorySkillsService, type BoardsShot } from '../story-skills/story-skills.service';
import { StoryboardService } from '../storyboard/storyboard.service';
import { ExportService } from '../export/export.service';
import { QcService } from '../qc/qc.service';
// 资产前置（asset-first）：人物/场景/道具必须先出定妆图，才允许拆分镜与出首帧
import { AssetPrepService } from '../bible/asset-prep.service';
// 参考图编排：把「图N」从字符串字面量改成真实图号，并补上场景图与上一镜成帧
import {
  buildShotPrompt,
  composeShotReferences,
  type CharacterRefInput,
  type PropRefInput,
  type SceneRefInput,
} from '@shared/shot-context';
// 片段（场→片段→镜）+ 空间轴线 + 3 秒节拍：分镜物化与首帧/视频提示词共用同一套纯函数
import {
  AXIS_LABELS,
  deriveBeats,
  matchPropVariant as matchPropVariantPure,
  planPieces,
  SEGMENT_MAX_SECONDS,
  SPACE_ANCHOR_LABELS,
} from '@shared/shot-craft';
// 时长收口：分镜总时长必须贴齐项目预算，只砍余量不砍台词
import { fitTotalBudget, minimumReadableSeconds } from '@shared/shot-duration';
// 完成态唯一口径：N 个镜头必须 N 个成片，不允许 some() 假完成
import { computePipelineReadiness } from '@shared/pipeline-readiness';
// 3 秒分段视频提示词 + 段内续接：一句话描述整镜必然被模型各做各的
import { buildSegmentedVideoPrompt, describeContinuity } from '@shared/video-prompt';
// 修复（分层）：uploadDir 直接从工具模块导入。
// 旧写法依赖 uploads.controller 里的再导出，使消费器在模块加载期
// 就被迫拉起整条 Controller → Service → DI 依赖链。
import { uploadDir } from '../assets/upload-dir';
import { Queue, Worker, type Job } from 'bullmq';
import IORedis from 'ioredis';
import {
  DEFAULT_PROVIDER_KEY,
  isMissingProviderMessage,
  isRateLimitMessage,
  RATE_LIMIT_COOLDOWN_MAX_MS,
  RATE_LIMIT_COOLDOWN_MS,
} from './rate-limit.util';

/**
 * queued 滞留回收阈值。
 * 修复：claimForQueue 先置 status='queued' 再 queue.add()，两步之间崩溃、
 * 或 Redis 启动后掉线，任务会永远停在 queued —— tick() 只认领 pending，
 * 而 running 回收原本只在 onModuleInit 跑一次，queued 态没有任何回收路径。
 */
const STALE_QUEUED_MS = 5 * 60 * 1000;

/** 项目资产索引：分镜表给出的 cast/location/props 直接按名字或编号解析成 id */
interface AssetIndex {
  characters: { id: string; name: string; roleType: string | null }[];
  locations: { id: string; name: string; timeOfDay: string | null }[];
  props: { id: string; code: string | null; name: string; category: string | null }[];
}

type FirstFrameDependencyResult =
  | { ready: true; imageUrl?: string }
  | { ready: false; reason: 'waiting_first_frame' | 'first_frame_failed' | 'first_frame_missing' };

/**
 * 任务消费器（W5：BullMQ 队列版，Redis 不可用时自动降级为进程内串行）。
 *
 * - 生产者：每轮认领 pending → 状态置 queued → 推入 generation 队列（jobId 去重）
 * - 消费者：BullMQ Worker 并发执行（JOB_WORKER_CONCURRENCY，默认 2）
 * - 启动时回收上次崩溃残留的 running（无 externalTaskId 的回到 pending）
 * - 其余语义不变：parse_script 物化 / text-image-video-tts 真调 / 无 Key 等待 / maxRetries
 */
@Injectable()
export class JobWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(JobWorkerService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  /** 已提示过“等 Key”的任务，避免每轮刷日志 */
  private readonly awaitingProvider = new Set<string>();
  /**
   * 按 provider 维度的上游限流冷却截止时间（ms epoch）。
   * 修复：旧实现是单例上的一个全局 `holdUntil`，
   * 某个供应商限流会把所有项目、所有任务类型一起冻 20s。
   */
  private readonly providerHoldUntil = new Map<string, number>();
  /** 各 provider 连续限流次数（指数退避用），成功生成后清零 */
  private readonly providerHoldCount = new Map<string, number>();
  private budgetWarned = false;
  private queue: Queue | null = null;
  private worker: Worker | null = null;
  private redis: IORedis | null = null;
  /** BullMQ 不可用时的进程内降级开关 */
  private inlineMode = false;
  private workerConcurrency = 1;
  /** V7：消费器是否已启动（区别于 tick 重入锁 running） */
  private started = false;

  /** V7 并发可见性：当前消费并发 + 队列深度（任务页展示，改并发需重启） */
  async workerStats(): Promise<{
    mode: 'queue' | 'inline' | 'off';
    concurrency: number;
    waiting: number;
    active: number;
  }> {
    if (!this.started) return { mode: 'off', concurrency: 0, waiting: 0, active: 0 };
    if (this.inlineMode || !this.queue) {
      return { mode: 'inline', concurrency: 1, waiting: 0, active: 0 };
    }
    const [waiting, active] = await Promise.all([
      this.queue.getWaitingCount().catch(() => 0),
      this.queue.getActiveCount().catch(() => 0),
    ]);
    return { mode: 'queue', concurrency: this.workerConcurrency, waiting, active };
  }

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    private readonly generationService: GenerationService,
    private readonly modelGateway: ModelGatewayService,
    private readonly budgetCap: BudgetCapService,
    private readonly routing: RoutingService,
    private readonly storySkills: StorySkillsService,
    private readonly stageBindings: StageBindingsService,
    private readonly storyboardService: StoryboardService,
    private readonly exportService: ExportService,
    private readonly qcService: QcService,
    private readonly assetPrep: AssetPrepService,
  ) {}

  /** B1 环节覆盖：分环节绑定的供应商/模型优先于任务自带与路由决策 */
  private async applyStageBinding(
    job: GenerationJob,
    providerName: string | undefined,
  ): Promise<{ providerName: string | undefined; model?: string; temperature?: number }> {
    const stage = stageOfJobType(job.jobType);
    if (!stage) return { providerName };
    const binding = await this.stageBindings.resolve(stage as StageKey);
    if (!binding.providerId && !binding.model && binding.temperature === undefined) {
      return { providerName };
    }
    this.logger.log(
      `任务 ${job.id} 环节覆盖[${stage}]：${binding.providerName ?? '默认供应商'}/${binding.model ?? '默认模型'}`,
    );
    return {
      providerName: binding.providerName ?? providerName,
      model: binding.model,
      temperature: binding.temperature,
    };
  }

  async onModuleInit() {
    if (process.env.JOB_WORKER_ENABLED === 'false') {
      this.logger.log('任务消费器已关闭（JOB_WORKER_ENABLED=false），任务需手动触发');
      return;
    }
    // 崩溃恢复：无 externalTaskId 的 running 一律回到 pending（有 external 的由轮询继续推进）
    await this.recoverOrphanedRunning();
    // Redis 可达 → BullMQ 队列模式；否则进程内串行降级（开发/单机同样可用）
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    try {
      const redis = new IORedis(redisUrl, {
        maxRetriesPerRequest: null,
        connectTimeout: 3000,
        retryStrategy: () => null,
      });
      await redis.ping();
      this.redis = redis;
      const concurrency = Math.max(
        1,
        Math.min(8, Number(process.env.JOB_WORKER_CONCURRENCY) || 2),
      );
      this.workerConcurrency = concurrency;
      this.queue = new Queue('yimu-generation', { connection: redis });
      this.worker = new Worker(
        'yimu-generation',
        (job: Job<{ jobId: string }>) => this.consumeQueuedJob(job.data.jobId),
        { connection: redis, concurrency },
      );
      this.worker.on('failed', (job, err) => {
        this.logger.warn(`队列任务失败 ${job?.data?.jobId}: ${err.message}`);
      });
      // 修复（Redis 掉线不降级）：retryStrategy: () => null 意味着不重连，
      // 'end' 会在连接彻底断开时触发。此时必须切到进程内串行，
      // 否则 tick() 继续把 pending 翻成 queued，任务全部滞留
      // （要等 recoverStaleQueued 5 分钟后才捞回）。
      redis.on('error', (err: Error) => {
        this.logger.warn(`Redis 错误：${err.message}`);
      });
      redis.on('end', () => this.degradeToInline('连接已结束且不会重连'));
      this.logger.log(`任务消费器已启动（BullMQ 队列模式，并发 ${concurrency}）`);
    } catch (e) {
      this.inlineMode = true;
      this.logger.warn(
        `Redis 不可用（${(e as Error).message}），降级为进程内串行消费；如需并发请启动 Redis 并配置 REDIS_URL`,
      );
    }
    const intervalMs = Math.max(
      2000,
      Number(process.env.JOB_WORKER_INTERVAL_MS) || 10000,
    );
    this.started = true;
    this.timer = setInterval(() => {
      void this.tick().catch((err) =>
        this.logger.error(`消费器轮询异常: ${(err as Error).message}`),
      );
    }, intervalMs);
  }

  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    if (this.worker) await this.worker.close().catch(() => {});
    if (this.queue) await this.queue.close().catch(() => {});
    if (this.redis) this.redis.disconnect();
  }

  /**
   * 启动回收：崩溃残留的 running（无远端任务）回到 pending 等待重领。
   * 有 externalTaskId 的视频任务由轮询继续推进，不回收。
   *
   * 修复（N+1）：旧实现先 select 全部 running，再在循环里逐行 UPDATE
   * （还内联了 eslint-disable no-await-in-loop）。改为单条带谓词的
   * UPDATE … RETURNING，一次往返完成。
   *
   * 注意：本方法只能在启动时调用。consumeQueuedJob 会把任务置为 running，
   * 而此时 externalTaskId 仍为空，周期性调用会把正在执行的任务抽回 pending。
   * 周期性回收请用 recoverStaleQueued()。
   */
  private async recoverOrphanedRunning(): Promise<void> {
    try {
      const recovered = await this.db
        .update(generationJobs)
        .set({ status: 'pending', updatedAt: new Date() })
        .where(
          and(
            eq(generationJobs.status, 'running'),
            isNull(generationJobs.externalTaskId),
          ),
        )
        .returning({ id: generationJobs.id });
      if (recovered.length > 0) {
        this.logger.log(`崩溃恢复：${recovered.length} 个残留 running 任务回到 pending`);
      }
    } catch (e) {
      this.logger.warn(`崩溃恢复失败: ${(e as Error).message}`);
    }
  }

  /**
   * 周期性回收滞留的 queued 任务。
   * 修复（queued 无人回收）：claimForQueue 先置 status='queued' 再 queue.add()。
   * 两步之间崩溃、或 Redis 启动后掉线，任务就永远停在 queued ——
   * tick() 只认领 pending，recoverOrphanedRunning() 只处理 running 且只在启动跑一次，
   * consumeQueuedJob() 也不会被触发（消息根本没进队列）。
   * 这里按 updatedAt 加 STALE_QUEUED_MS 阈值捞回；正常几秒内就被消费的任务不受影响。
   */
  private async recoverStaleQueued(): Promise<void> {
    try {
      const staleBefore = new Date(Date.now() - STALE_QUEUED_MS);
      const stale = await this.db
        .update(generationJobs)
        .set({ status: 'pending', updatedAt: new Date() })
        .where(
          and(
            eq(generationJobs.status, 'queued'),
            lt(generationJobs.updatedAt, staleBefore),
          ),
        )
        .returning({ id: generationJobs.id });
      if (stale.length > 0) {
        this.logger.warn(
          `队列回收：${stale.length} 个滞留超过 ${STALE_QUEUED_MS / 1000}s 的 queued 任务回到 pending` +
            `（${stale.slice(0, 5).map((r) => r.id).join(', ')}${stale.length > 5 ? ' …' : ''}）`,
        );
      }
    } catch (e) {
      this.logger.warn(`queued 回收失败: ${(e as Error).message}`);
    }
  }

  /** 当前仍在冷却中的 provider 名称；顺手清理过期项，防止 Map 无界增长 */
  private coolingProviders(): string[] {
    const now = Date.now();
    const out: string[] = [];
    for (const [key, until] of this.providerHoldUntil) {
      if (until <= now) {
        this.providerHoldUntil.delete(key);
        continue;
      }
      if (key !== DEFAULT_PROVIDER_KEY) out.push(key);
    }
    return out;
  }

  /**
   * Redis 中途不可用时降级为进程内串行消费。
   * 修复：IORedis 用 retryStrategy: () => null（不重连），而 inlineMode
   * 原本只在 onModuleInit 的 catch 里设置。启动后 Redis 挂掉 → BullMQ 静默死亡，
   * tick() 仍把 pending 翻成 queued，queue.add 的拒绝只被打日志，没有任何降级。
   */
  private degradeToInline(reason: string): void {
    if (this.inlineMode) return;
    this.logger.error(`Redis 不可用（${reason}），降级为进程内串行消费`);
    this.inlineMode = true;
    const worker = this.worker;
    const queue = this.queue;
    this.worker = null;
    this.queue = null;
    void worker?.close().catch(() => {});
    void queue?.close().catch(() => {});
  }

  /**
   * 首帧质量门：仅一键成片显式绑定 dependsOnJobId 的视频受此约束。
   * 依赖必须是同项目、同镜头的图片任务；成功且能取得真实图片后才放行。
   */
  private async readShotStartFrame(job: GenerationJob): Promise<string | undefined> {
    if (job.targetType !== 'shot' || !job.targetId) return undefined;
    const shotRows = await this.db
      .select({ startFrameUrl: shots.startFrameUrl })
      .from(shots)
      .where(eq(shots.id, job.targetId))
      .limit(1);
    return shotRows[0]?.startFrameUrl ?? undefined;
  }

  private async checkFirstFrameDependency(job: GenerationJob): Promise<FirstFrameDependencyResult> {
    const input = (job.inputData ?? {}) as Record<string, unknown>;
    const dependsOnJobId = typeof input.dependsOnJobId === 'string' ? input.dependsOnJobId : undefined;
    if (job.jobType !== 'video' || !dependsOnJobId) return { ready: true };

    const rows = await this.db
      .select({
        status: generationJobs.status,
        jobType: generationJobs.jobType,
        projectId: generationJobs.projectId,
        targetId: generationJobs.targetId,
        outputData: generationJobs.outputData,
      })
      .from(generationJobs)
      .where(eq(generationJobs.id, dependsOnJobId))
      .limit(1);
    const dependency = rows[0];
    if (
      !dependency ||
      dependency.jobType !== 'image' ||
      dependency.targetId !== job.targetId ||
      (dependency.projectId ?? null) !== (job.projectId ?? null)
    ) {
      // 依赖记录缺失/不匹配（如历史任务被清理）：只要镜头已有可用首帧就放行，
      // 否则会给「首帧其实已就绪」的镜头造成永久阻断。
      const existing = await this.readShotStartFrame(job);
      if (existing) return { ready: true, imageUrl: existing };
      return { ready: false, reason: 'first_frame_missing' };
    }
    if (dependency.status === 'failed' || dependency.status === 'cancelled') {
      return { ready: false, reason: 'first_frame_failed' };
    }
    if (dependency.status !== 'succeeded') {
      return { ready: false, reason: 'waiting_first_frame' };
    }

    const output = (dependency.outputData ?? {}) as Record<string, unknown>;
    const images = Array.isArray(output.images) ? output.images : [];
    const firstImage = images[0] as Record<string, unknown> | undefined;
    let imageUrl =
      (typeof output.url === 'string' && output.url) ||
      (typeof firstImage?.url === 'string' && firstImage.url) ||
      undefined;
    // 镜头已回写的首帧优先；若回写失败，仍可使用依赖任务的真实输出，避免误阻断。
    const written = await this.readShotStartFrame(job);
    if (written) imageUrl = written;
    if (!imageUrl) return { ready: false, reason: 'first_frame_missing' };
    return { ready: true, imageUrl };
  }

  /** 阻断只改调度原因并释放为 pending，不进入成功/失败结算，因此不会产生视频费用。 */
  private async setFirstFrameBlock(
    jobId: string,
    reason: 'waiting_first_frame' | 'first_frame_failed' | 'first_frame_missing' | 'waiting_assets',
  ): Promise<void> {
    await this.db
      .update(generationJobs)
      .set({
        status: 'pending',
        progress: 0,
        startedAt: null,
        externalTaskId: null,
        inputData: sql`jsonb_set(coalesce(${generationJobs.inputData}, '{}'::jsonb), '{blockedReason}', to_jsonb(${reason}::text), true)`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(generationJobs.id, jobId),
          inArray(generationJobs.status, ['pending', 'queued', 'running', 'retrying']),
        ),
      );
  }

  private async clearFirstFrameBlock(jobId: string): Promise<void> {
    await this.db
      .update(generationJobs)
      .set({
        inputData: sql`coalesce(${generationJobs.inputData}, '{}'::jsonb) - 'blockedReason'`,
        updatedAt: new Date(),
      })
      .where(eq(generationJobs.id, jobId));
  }

  /**
   * 首帧成功回写后解除该镜头所有等待首帧的视频阻断，并把依赖重指向本次成功任务。
   * 必须重指向：重试会新建图片任务，视频仍绑在旧的失败任务上，只清 blockedReason
   * 会在下一轮 process 检查时被重新阻断（依赖永远处于 failed）。
   */
  private async unblockVideosForShot(
    job: GenerationJob,
    imageJobId: string,
  ): Promise<void> {
    if (!job.targetId) return;
    const conditions = [
      eq(generationJobs.jobType, 'video'),
      eq(generationJobs.targetId, job.targetId),
      eq(generationJobs.status, 'pending'),
      sql`${generationJobs.inputData} ->> 'blockedReason' IS NOT NULL`,
    ];
    if (job.projectId) conditions.push(eq(generationJobs.projectId, job.projectId));
    await this.db
      .update(generationJobs)
      .set({
        inputData: sql`jsonb_set(coalesce(${generationJobs.inputData}, '{}'::jsonb) - 'blockedReason', '{dependsOnJobId}', to_jsonb(${imageJobId}::text), true)`,
        updatedAt: new Date(),
      })
      .where(and(...conditions))
      .catch((e: Error) =>
        this.logger.warn(`解除首帧阻断失败（镜 ${job.targetId}）：${e.message}`),
      );
  }

  /** 每轮先对账：首帧成功自动解封；首帧重试失败/取消则保持阻断，不裸跑视频。 */
  private async reconcileFirstFrameDependencies(): Promise<void> {
    const rows = await this.db
      .select({ id: generationJobs.id })
      .from(generationJobs)
      .where(
        and(
          eq(generationJobs.status, 'pending'),
          eq(generationJobs.jobType, 'video'),
          sql`${generationJobs.inputData} ->> 'blockedReason' IS NOT NULL`,
        ),
      )
      .orderBy(generationJobs.createdAt)
      .limit(50);
    for (const row of rows) {
      // eslint-disable-next-line no-await-in-loop
      const job = await this.generationService.getJob(row.id);
      // eslint-disable-next-line no-await-in-loop
      const dependency = await this.checkFirstFrameDependency(job);
      // 显式相等判断：strict 模式下 if (dependency.ready) 不会收窄判别联合，dependency.reason 会编译报错
      if (dependency.ready === true) {
        // eslint-disable-next-line no-await-in-loop
        await this.clearFirstFrameBlock(job.id);
        continue;
      }
      const input = (job.inputData ?? {}) as Record<string, unknown>;
      if (input.blockedReason !== dependency.reason) {
        // eslint-disable-next-line no-await-in-loop
        await this.setFirstFrameBlock(job.id, dependency.reason);
      }
    }
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      // 超预算时暂停认领新任务（在途任务继续推进，避免半截浪费）
      const cap = this.budgetCap.getCap();
      if (cap !== null) {
        const spend = await this.budgetCap.getMonthlySpend();
        if (spend >= cap) {
          if (!this.budgetWarned) {
            this.logger.warn(
              `月度预算已用尽（¥${spend.toFixed(2)}/¥${cap.toFixed(2)}），消费器暂停认领新任务`,
            );
            this.budgetWarned = true;
          }
          return;
        }
        this.budgetWarned = false;
      }

      await this.driveInflightVideoJobs();
      // 首帧依赖对账：首帧成功后解封视频；失败/取消则维持阻断（每轮扫描少量，避免全表）
      await this.reconcileFirstFrameDependencies().catch((e: Error) =>
        this.logger.warn(`首帧依赖对账失败: ${e.message}`),
      );
      // 资产门对账：人物/场景定妆图到齐 → 解封分镜物化与首帧任务
      await this.reconcileAssetGate().catch((e: Error) =>
        this.logger.warn(`资产门对账失败: ${e.message}`),
      );
      // 流水线自动链驱动（P0 断链修复）：图→视频→配音→剪辑→质检 段内自动连跑
      await this.drivePipeline().catch((e: Error) =>
        this.logger.warn(`流水线自动链驱动失败: ${e.message}`),
      );
      // 修复：queued 滞留回收必须周期性执行，不能只在启动时跑一次
      await this.recoverStaleQueued();

      if (this.queue && !this.inlineMode) {
        // 上游限流冷却改为按 provider 维度（见 claimForQueue 的过滤），
        // 不再用全局 holdUntil 整轮 return —— 旧实现会让一个供应商的限流
        // 冻住所有项目、所有任务类型。
        // 队列模式：认领 pending → queued → 入队（Worker 并发执行）
        for (let i = 0; i < 5; i += 1) {
          // eslint-disable-next-line no-await-in-loop
          const claimed = await this.claimForQueue();
          if (!claimed) break;
          // BullMQ 按 jobId 去重：完成过的同 id 再 add 会被静默忽略 →
          // 重试任务永远卡 queued。带 retryCount+时间戳保证唯一。
          // 注意：BullMQ jobId 禁止冒号，分隔符必须用下划线。
          try {
            // eslint-disable-next-line no-await-in-loop
            await this.queue.add(
              'execute',
              { jobId: claimed.id },
              {
                jobId: `${claimed.id}_r${claimed.retryCount ?? 0}_${Date.now()}`,
                removeOnComplete: 100,
                removeOnFail: 200,
              },
            );
          } catch (addErr) {
            // 修复（任务滞留）：入队失败时任务已停在 queued，旧实现只把异常抛给
            // tick 外层的 catch，任务要等 5 分钟才被 recoverStaleQueued 捞回。
            // 这里立即降级并就地执行，保证不丢任务、不白等。
            this.logger.error(
              `入队失败 ${claimed.id}：${(addErr as Error).message}`,
            );
            this.degradeToInline('queue.add 失败');
            // eslint-disable-next-line no-await-in-loop
            await this.consumeQueuedJob(claimed.id).catch((e: Error) =>
              this.logger.error(`降级执行失败 ${claimed.id}：${e.message}`),
            );
            break;
          }
        }
      } else {
        // 降级模式：进程内串行直接执行（旧行为）
        const job = await this.generationService.claimNextPendingJob();
        if (job) await this.process(job);
      }
    } finally {
      this.running = false;
    }
  }

  /** 认领一个 pending 并置 queued（队列模式专用，与 claimNextPendingJob 语义一致） */
  private async claimForQueue(): Promise<GenerationJob | null> {
    // 修复（按 provider 冷却）：冷却中的 provider 对应的任务本轮不认领。
    // 既不继续打爆对端池，也不会像旧的全局 holdUntil 那样冻住所有通道。
    // providerName 为 NULL 的任务（路由决策尚未落盘）必须放行，
    // 否则 NOT IN 遇 NULL 结果为 NULL，会把全部未路由任务一起排除掉。
    const cooling = this.coolingProviders();
    // 本地任务不调用供应商，冷却名单不能挡住它们（否则整条本地链被限流误伤）
    const localJobs = inArray(generationJobs.jobType, ['parse_script', 'edit', 'qc', 'asset_prep']);
    // 有 blockedReason 的视频在等首帧，必须跳过，避免队头阻塞整条队列。
    const dependencyReady = sql`${generationJobs.inputData} ->> 'blockedReason' IS NULL`;
    const where =
      cooling.length > 0
        ? and(
            eq(generationJobs.status, 'pending'),
            dependencyReady,
            or(
              localJobs,
              isNull(generationJobs.providerName),
              notInArray(generationJobs.providerName, cooling),
            ),
          )
        : and(eq(generationJobs.status, 'pending'), dependencyReady);
    const rows = await this.db
      .select()
      .from(generationJobs)
      .where(where)
      .orderBy(generationJobs.createdAt)
      .limit(1);
    if (rows.length === 0) return null;
    const claimed = await this.db
      .update(generationJobs)
      .set({ status: 'queued', updatedAt: new Date() })
      .where(
        and(
          eq(generationJobs.id, rows[0].id),
          eq(generationJobs.status, 'pending'),
          dependencyReady,
        ),
      )
      .returning();
    if (claimed.length === 0) return null;
    return this.generationService.getJob(claimed[0].id);
  }

  /** BullMQ Worker 回调：加载最新行状态后执行（终态直接丢弃，保证幂等） */
  private async consumeQueuedJob(jobId: string): Promise<void> {
    const job = await this.generationService.getJob(jobId);
    if (job.status === 'succeeded' || job.status === 'failed' || job.status === 'cancelled') {
      // 修复（缓慢泄漏）：awaitingProvider 原本只在「非限流错误」分支里删除，
      // 任务后来成功或被用户删除，它的 id 会永远留在 Set 里。终态即清理。
      this.awaitingProvider.delete(jobId);
      return;
    }
    if (job.status === 'queued' || job.status === 'pending' || job.status === 'retrying') {
      await this.db
        .update(generationJobs)
        .set({ status: 'running', startedAt: new Date(), updatedAt: new Date() })
        .where(eq(generationJobs.id, jobId));
      const fresh = await this.generationService.getJob(jobId);
      // V5 每镜状态机：任务开跑 → 镜头 generating（变体不碰主状态；best-effort）
      if (fresh.targetType === 'shot' && fresh.targetId) {
        const input = (fresh.inputData ?? {}) as Record<string, unknown>;
        if (typeof input.variantGroup !== 'string') {
          this.db
            .update(shots)
            .set({ status: 'generating', updatedAt: new Date() })
            .where(
              and(
                eq(shots.id, fresh.targetId),
                ...(fresh.projectId ? [eq(shots.projectId, fresh.projectId)] : []),
              ),
            )
            .catch((e: Error) => this.logger.warn(`镜头状态更新失败 ${fresh.targetId}：${e.message}`));
        }
      }
      await this.process(fresh);
      return;
    }
    // running（被其他路径认领）：跳过，避免双执行
    this.logger.warn(`队列任务 ${jobId} 已在执行中，跳过重复消费`);
  }

  /** 推进在途视频任务（已有 externalTaskId 的 running 任务），完成后回写镜头 */
  private async driveInflightVideoJobs(): Promise<void> {
    const rows = await this.db
      .select()
      .from(generationJobs)
      .where(
        and(
          eq(generationJobs.status, 'running'),
          eq(generationJobs.jobType, 'video'),
        ),
      )
      // 修复（在途视频饿死）：旧实现 .limit(5) 但没有 ORDER BY，
      // 每 tick 可能反复选中同 5 行，其余在途视频任务永远轮不到推进。
      // 按 updatedAt 升序 = 最久未推进的优先，天然形成轮转。
      .orderBy(generationJobs.updatedAt)
      .limit(5);
    for (const row of rows) {
      if (!row.externalTaskId) continue;
      try {
        const updated = await this.generationService.pollJob(row.id);
        if (updated.status === 'succeeded') {
          const output = (updated.outputData ?? {}) as Record<string, unknown>;
          await this.writebackToTarget(updated, {
            videoUrl:
              typeof output.url === 'string' ? output.url : undefined,
          });
        }
      } catch (e) {
        this.logger.warn(`在途视频任务推进失败 ${row.id}: ${(e as Error).message}`);
      }
    }
  }

  private async process(job: GenerationJob): Promise<void> {
    this.logger.log(`认领任务 ${job.id}（${job.jobType}，目标 ${job.targetType ?? '-'}）`);
    // 首帧质量门：一键成片的视频必须等本镜首帧成功，否则释放回 pending 并阻断，不调用模型、不计费。
    const dep = await this.checkFirstFrameDependency(job);
    // 显式相等判断：strict 模式下 if (!dep.ready) 不会收窄判别联合，dep.reason 会编译报错
    if (dep.ready === false) {
      await this.setFirstFrameBlock(job.id, dep.reason);
      this.logger.log(`任务 ${job.id} 首帧依赖未满足（${dep.reason}），释放回队列等待`);
      return;
    }
    // W2 智能路由：按项目预算模式选档位与通道（任务自带 providerName 优先，显式指定不受路由覆盖）
    const decision = await this.routing.resolve(
      job.jobType,
      await this.getProjectBudgetMode(job.projectId),
      job.projectId,
    );
    this.logger.log(`任务 ${job.id} 路由决策：${decision.reason}`);
    const routedName = job.providerName ?? decision.providerName;
    // 决策落盘：后续结算/免费判定需要知道实际供应商（否则免费模型会被收费）
    if (routedName && routedName !== job.providerName) {
      await this.db
        .update(generationJobs)
        .set({ providerName: routedName, updatedAt: new Date() })
        .where(eq(generationJobs.id, job.id))
        .catch((e: Error) => this.logger.warn(`任务供应商落盘失败 ${job.id}：${e.message}`));
    }
    // B1 环节覆盖：绑定优先于任务自带与路由决策
    const stage = await this.applyStageBinding(job, routedName);
    const providerName = stage.providerName;
    // 环节绑定可能再次改供应商：必须把「实际执行的供应商」落盘。
    // 否则结算只看路由供应商，会算错钱（mock 演练被照价收费，真实调用被误判免费）。
    if (providerName && providerName !== routedName) {
      await this.db
        .update(generationJobs)
        .set({ providerName, updatedAt: new Date() })
        .where(eq(generationJobs.id, job.id))
        .catch((e: Error) => this.logger.warn(`实际供应商落盘失败 ${job.id}：${e.message}`));
    }
    // 内存对象同步：后续 writeback 判定 mock 用的是这个对象，不跟着改会按旧供应商误判
    if (providerName) job.providerName = providerName;
    const modelOpts = { model: stage.model, temperature: stage.temperature };
    // 修复（本地任务被上游冷却误伤）：parse_script/edit/qc 完全不调用供应商，
    // 不能因为路由给它们的 provider 正在限流冷却就被反复放回 pending，
    // 否则「确认剧本 → 物化分镜」整条本地链会被无关通道的限流冻住。
    const localJob =
      job.jobType === 'parse_script' ||
      job.jobType === 'edit' ||
      job.jobType === 'qc' ||
      job.jobType === 'asset_prep';
    // 修复（按 provider 冷却）：冷却期内不触碰该通道，直接放回 pending 等下一轮，
    // 避免继续打爆对端池；其他 provider 的任务不受影响。
    const holdKey = providerName ?? DEFAULT_PROVIDER_KEY;
    const holdUntil = this.providerHoldUntil.get(holdKey) ?? 0;
    if (!localJob && holdUntil > Date.now()) {
      await this.releaseToPending(job.id);
      return;
    }
    // 注意：此处不再预清零退避计数。旧实现在执行前删除 hold 记录，
    // 导致冷却到期后的下一次尝试即使再次限流，计数也已归位 ——
    // 指数退避永远停在第一档，无法逐级升到 80s/160s/300s。
    // 清零时机改为任务真实成功后（见 switch 之后的成功清零）。
    try {
      switch (job.jobType) {
        case 'asset_prep':
          await this.processAssetPrep(job, providerName);
          break;
        case 'parse_script':
          await this.processParseScript(job);
          break;
        case 'script':
          await this.processScriptJob(job, providerName, modelOpts);
          break;
        case 'boards':
          await this.processBoardsJob(job, providerName, modelOpts);
          break;
        case 'text':
          await this.processText(job, providerName, modelOpts);
          break;
        case 'image':
          await this.processImage(job, providerName, modelOpts);
          break;
        case 'video':
          await this.processVideo(job, providerName, modelOpts);
          break;
        case 'tts':
          await this.processTts(job, providerName);
          break;
        case 'edit':
          await this.processEdit(job);
          break;
        case 'qc':
          await this.processQc(job);
          break;
        default:
          // 修复（无限循环 + 队头阻塞）：旧实现把不支持的类型 releaseToPending，
          // 下一个 tick 又被认领，如此反复 —— 死循环 + 每轮刷一条日志。
          // 更糟的是 claimForQueue 按 createdAt 取最老的一条 pending，
          // 一个古老的不支持任务会永久占住认领名额，把后面所有正常任务堵死。
          // 不支持的类型是确定性错误，重试不会改变结果，直接终结并写明原因。
          this.logger.error(
            `不支持的任务类型 ${job.jobType}（${job.id}），已终结；请检查生产方或升级消费器`,
          );
          await this.generationService.settleJobFailure(
            job.id,
            `消费器不支持的任务类型：${job.jobType}`,
          );
          break;
      }
      // 修复（缓慢泄漏）：执行成功即从 awaitingProvider 移除，
      // 避免任务后来成功或被删除时 id 永远留在 Set 里。
      this.awaitingProvider.delete(job.id);
      // W 指数退避成功清零：真实成功（未抛错）才恢复基线，上游过载解除后 20s 冷却即刻回归。
      if (!localJob) {
        this.providerHoldUntil.delete(holdKey);
        this.providerHoldCount.delete(holdKey);
      }
    } catch (e) {
      const message = (e as Error)?.message ?? '未知错误';
      // 未配置 Provider：保持 pending 等待配置，不消耗重试次数
      if (isMissingProviderMessage(message)) {
        if (!this.awaitingProvider.has(job.id)) {
          this.logger.warn(`任务 ${job.id} 等待 Provider 配置：${message}`);
          this.awaitingProvider.add(job.id);
          // 兜底上限：即使某条清理路径漏了，也不会无界增长
          if (this.awaitingProvider.size > 5000) this.awaitingProvider.clear();
        }
        await this.releaseToPending(job.id);
        return;
      }
      this.awaitingProvider.delete(job.id);
      // 上游限流（pool saturated / rate_limit / 429 / 503）：不消耗重试次数，
      // 冷却后由 tick 重新认领，避免打爆对端池。
      // 修复（全局冻结）：旧实现 `this.holdUntil = Date.now() + 20_000` 是单例上的
      // 一个全局值，某个供应商限流会把所有项目、所有任务类型一起冻 20s。
      // 改为按 provider 维度冷却，未受影响的通道继续跑。
      if (isRateLimitMessage(message)) {
        const key = providerName ?? DEFAULT_PROVIDER_KEY;
        // W 指数退避：连续限流时冷却翻倍（20s→40s→…→300s 封顶），上游过载时
        // 不再以固定 20s 高频重试打爆对端队列；任一任务成功后清零恢复基线。
        // （旧式 consecutive ?? 1 + 1 会让首次失败就直接翻倍到 40s，与注释档位不符）
        const prev = this.providerHoldUntil.get(key) ?? 0;
        const consecutive = prev > Date.now() ? (this.providerHoldCount.get(key) ?? 0) : 0;
        const nextCount = Math.min(consecutive + 1, 8);
        this.providerHoldCount.set(key, nextCount);
        const cooldown = Math.min(RATE_LIMIT_COOLDOWN_MS * 2 ** (nextCount - 1), RATE_LIMIT_COOLDOWN_MAX_MS);
        this.providerHoldUntil.set(key, Date.now() + cooldown);
        this.logger.warn(
          `任务 ${job.id} 上游限流（provider=${key}），冷却 ${cooldown / 1000}s 后重试（连续第 ${nextCount} 次）：${message.slice(0, 160)}`,
        );
        await this.releaseToPending(job.id);
        return;
      }
      this.logger.warn(`任务 ${job.id} 执行失败：${message}`);
      await this.generationService.noteJobError(job.id, message);
    }
  }

  private async getProjectBudgetMode(projectId?: string): Promise<'quality_first' | 'balanced' | 'cost_first' | 'fast_first' | undefined> {
    if (!projectId) return undefined;
    const rows = await this.db
      .select({ budgetMode: projects.budgetMode })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    return (rows[0]?.budgetMode ?? undefined) as
      | 'quality_first'
      | 'balanced'
      | 'cost_first'
      | 'fast_first'
      | undefined;
  }

  private async releaseToPending(id: string): Promise<void> {
    await this.db
      .update(generationJobs)
      .set({ status: 'pending', updatedAt: new Date() })
      .where(eq(generationJobs.id, id));
  }

  private inputPrompt(job: GenerationJob): string {
    const input = (job.inputData ?? {}) as Record<string, unknown>;
    const prompt = input.prompt;
    return typeof prompt === 'string' ? prompt : '';
  }

  // ========== 各类型执行 ==========

  private async processText(job: GenerationJob, providerName?: string, opts?: { model?: string; temperature?: number }): Promise<void> {
    const prompt = this.inputPrompt(job);
    if (!prompt.trim()) {
      await this.generationService.settleJobFailure(job.id, '文本任务缺少 prompt');
      return;
    }
    // 并发安全修复：直接从 generateTextWithUsage 返回 { text, usage }，消除单例 lastTextUsage 竞态
    const { text, usage } = await this.modelGateway.generateTextWithUsage(
      { prompt, model: opts?.model, temperature: opts?.temperature },
      providerName,
    );
    await this.generationService.settleJobSuccess(job.id, {
      text,
      ...(usage ? { usage } : {}),
    });
  }

  private async processImage(job: GenerationJob, providerName?: string, opts?: { model?: string }): Promise<void> {
    const input = (job.inputData ?? {}) as Record<string, unknown>;
    const prompt = this.inputPrompt(job);
    if (!prompt.trim()) {
      await this.generationService.settleJobFailure(job.id, '图片任务缺少 prompt');
      return;
    }
    /* ==================================================================
     * 镜头生图的一致性上下文（对标 ArcReel 的「图N」机械编号）
     * ------------------------------------------------------------------
     * 旧实现把 `` `[图N]` `` 当字符串字面量写进提示词 —— 模型看到的只是「图」「N」
     * 三个字符，多图时根本无法把「哪个角色」对应到「哪张图」。ArcReel 的做法是：
     * 最终参考图列表确定后，由编排层渲染一行类型声明 + 把正文引用替换成真实图号，
     * 且声明行与真正发出去的图**等长同序**。
     *
     * 顺序：角色主图 → 角色角度图 → 场景图 → 道具图 → 上一镜成帧。
     * 第一张必须是「面部唯一真相」，因为部分网关只真正透传第一张。
     * ================================================================== */
    const explicitRefs: string[] = Array.isArray(input.references)
      ? (input.references as unknown[]).filter((r): r is string => typeof r === 'string' && r.length > 0)
      : [];
    const refList: string[] = [];
    let enrichedPrompt = prompt;
    if (job.targetType === 'shot' && job.targetId && job.projectId) {
      // 单镜资产门：本镜引用的人物/场景还没定妆图时不硬闯，挂起等 reconcileAssetGate 解封。
      // 硬闯的代价是「凭空生成一张脸」，一旦回写进 startFrameUrl，用户只能重做整镜。
      const refs = await this.loadShotAssetRefs(job.targetId);
      if (refs) {
        const missing = await this.assetPrep.missingAssetsForShot(job.projectId, refs);
        if (missing.length > 0) {
          await this.setFirstFrameBlock(job.id, 'waiting_assets');
          this.logger.log(
            `首帧任务 ${job.id} 等待资产定妆：${missing.map((m) => `${m.name}(${m.missing.join('/')})`).join('、')}`,
          );
          return;
        }
      }

      const composed = await this.composeShotContext(job.projectId, job.targetId);
      for (const r of composed.refs) refList.push(r.url);
      if (composed.refs.length > 0) {
        enrichedPrompt = buildShotPrompt(prompt, composed);
        // 可观测性：把真实编号声明打进日志，出问题能一眼看出「图N」到底指谁
        this.logger.log(`镜 ${job.targetId} 参考图 ${refList.length} 张 —— ${composed.declaration}`);
        // 落盘给 UI 看（只在用户没手动指定时写，避免覆盖人工选择的参考图）
        const currentRefs = await this.db
          .select({ referenceImageUrls: shots.referenceImageUrls })
          .from(shots)
          .where(eq(shots.id, job.targetId))
          .limit(1);
        if ((currentRefs[0]?.referenceImageUrls ?? []).length === 0) {
          await this.db
            .update(shots)
            .set({ referenceImageUrls: refList.slice(0, 8), updatedAt: new Date() })
            .where(eq(shots.id, job.targetId))
            .catch((e: Error) => this.logger.warn(`参考图落盘失败 ${job.targetId}：${e.message}`));
        }
      }
      if (composed.dropped > 0) {
        this.logger.warn(
          `镜 ${job.targetId} 参考图超出上限被裁 ${composed.dropped} 张（已按顺序去尾，声明行同步）`,
        );
      }
    }
    // 非镜头任务（人物/场景/道具定妆图）的参考图仍由任务自带，避免把整条资产链搅进编排
    if (refList.length === 0) {
      for (const r of explicitRefs) if (r && !refList.includes(r)) refList.push(r);
    }
    const seed = typeof input.seed === 'number' && Number.isFinite(input.seed) ? input.seed : undefined;
    const images = await this.modelGateway.generateImage(
      {
        prompt: enrichedPrompt,
        negativePrompt:
          typeof input.negativePrompt === 'string' ? input.negativePrompt : undefined,
        model: opts?.model,
        referenceImages: refList.length > 0 ? refList : undefined,
        seed,
      },
      providerName,
    );
    const firstUrl = images[0]?.url;
    // data: 大 base64 不进 shots.startFrameUrl 也不原样塞入 outputData JSONB（防 TOAST 表膨胀）；统一先落盘成 /uploads/
    const stableUrl = firstUrl ? await this.ensureLocalUrl(job.projectId, firstUrl) : undefined;
    if (stableUrl) await this.writebackToTarget(job, { imageUrl: stableUrl });
    const sanitizedImages = images.map((img, idx) => ({
      ...img,
      url: idx === 0 && stableUrl ? stableUrl : img.url.startsWith('data:') ? (stableUrl ?? '/uploads/inline.png') : img.url,
    }));
    await this.generationService.settleJobSuccess(job.id, { images: sanitizedImages });
  }

  /**
   * 汇总一个镜头的参考图素材：本镜人物（主图 + 角度图）→ 场景 → 道具 → 上一镜成帧。
   * 只负责取数与排序，编号/声明/锁块全部交给 `shared/shot-context.ts` 的纯函数，
   * 保证「声明行」和「真正发出去的参考图」永远等长同序。
   */
  private async composeShotContext(
    projectId: string,
    shotId: string,
  ): Promise<ReturnType<typeof composeShotReferences>> {
    const shotRows = await this.db
      .select({
        sceneId: shots.sceneId,
        segmentId: shots.segmentId,
        shotNumber: shots.shotNumber,
        characterIds: shots.characterIds,
        referenceImageUrls: shots.referenceImageUrls,
        screenDirection: shots.screenDirection,
        shotSize: shots.shotSize,
        visualPrompt: shots.visualPrompt,
        dialogue: shots.dialogue,
        action: shots.action,
      })
      .from(shots)
      .where(eq(shots.id, shotId))
      .limit(1);
    const shot = shotRows[0];
    if (!shot) return composeShotReferences({});

    let sceneInput: SceneRefInput | null = null;
    let sceneCharIds: string[] = [];
    let propTags: string[] = [];
    let spatialNote: string | null = null;
    if (shot.sceneId) {
      const sceneRows = await this.db
        .select({
          locationId: scenes.locationId,
          props: scenes.props,
          characterIds: scenes.characterIds,
        })
        .from(scenes)
        .where(eq(scenes.id, shot.sceneId))
        .limit(1);
      propTags = sceneRows[0]?.props ?? [];
      sceneCharIds = sceneRows[0]?.characterIds ?? [];
      const locationId = sceneRows[0]?.locationId;
      if (locationId) {
        const locRows = await this.db
          .select()
          .from(locations)
          .where(eq(locations.id, locationId))
          .limit(1);
        const loc = locRows[0];
        if (loc) {
          sceneInput = {
            id: loc.id,
            name: loc.name,
            url: (loc.referenceImageUrls ?? [])[0],
            lock: [
              loc.locationType === 'exterior' ? '室外' : '室内',
              loc.timeOfDay,
              loc.weather,
              loc.architecture,
              loc.furniture,
              loc.lighting,
              loc.colorPalette,
            ]
              .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
              .join('；'),
          };
        }
      }
    }

    // 片段级空间基准与轴线：镜只能服从段，不能段段自说自话
    if (shot.segmentId) {
      const segRows = await this.db
        .select({
          spaceAnchor: segments.spaceAnchor,
          axisDirection: segments.axisDirection,
          title: segments.title,
        })
        .from(segments)
        .where(eq(segments.id, shot.segmentId))
        .limit(1);
      const seg = segRows[0];
      if (seg) {
        const bits: string[] = [];
        if (seg.title) bits.push(`片段「${seg.title}」`);
        if (seg.spaceAnchor) bits.push(`空间基准 ${SPACE_ANCHOR_LABELS[seg.spaceAnchor as SpaceAnchor] ?? seg.spaceAnchor}`);
        if (seg.axisDirection) bits.push(`本段轴线 ${AXIS_LABELS[seg.axisDirection as AxisDirection] ?? seg.axisDirection}`);
        if (shot.screenDirection) {
          bits.push(`本镜画面方向 ${shot.screenDirection}`);
        }
        if (bits.length > 0) spatialNote = bits.join('；');
      }
    }

    // 人物：镜头自带的优先；早期物化数据没有绑定时回落到场次 cast
    const charIds = (shot.characterIds ?? []).length > 0 ? shot.characterIds! : sceneCharIds;
    const charInputs: CharacterRefInput[] = [];
    if (charIds.length > 0) {
      const charRows = await this.db
        .select({
          id: characters.id,
          name: characters.name,
          referenceImageUrls: characters.referenceImageUrls,
          identityKit: characters.identityKit,
          canonicalDescription: characters.canonicalDescription,
          costume: characters.costume,
          forbiddenChanges: characters.forbiddenChanges,
        })
        .from(characters)
        .where(eq(characters.projectId, projectId));
      const byId = new Map(charRows.map((c) => [c.id, c]));
      for (const cid of charIds) {
        const c = byId.get(cid);
        if (!c) continue;
        const kit = (c.identityKit as CharacterIdentityKit | null) ?? null;
        const primary = kit?.portraitUrl || (c.referenceImageUrls ?? [])[0] || kit?.sheetUrl;
        /*
         * 每个镜头给人物 1 张面部真相 + 最多 1 张角度图。
         * 人物形象包里的四视角是「设定页」用的资产，不该每镜全带：
         * 一个主角就吃掉 5 个参考图名额，两人同框时场景图会被挤掉上限，
         * 结果是「人对了但场地每次都不一样」。角度图优先 3/4 侧 —— 它同时
         * 锁骨相与体量，比正面更能防止换脸换身材。
         */
        const viewUrls = [
          kit?.views?.threeQuarter,
          kit?.views?.front,
          kit?.views?.side,
          kit?.views?.back,
        ]
          .filter((v): v is string => typeof v === 'string' && v.length > 0)
          .slice(0, 1);
        charInputs.push({
          id: c.id,
          name: c.name,
          primaryUrl: primary,
          viewUrls,
          lock: [
            kit?.identityDescriptor || c.canonicalDescription,
            kit?.wardrobe || c.costume,
            kit?.signatureDetails,
            c.forbiddenChanges,
          ]
            .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
            .join('；'),
        });
      }
    }

    // 道具：场次 props 标签（名字 / PROP 编号 / @编号 / 后缀匹配）
    const propInputs: PropRefInput[] = [];
    if (propTags.length > 0) {
      const propRows = await this.db
        .select({
          id: props.id,
          name: props.name,
          code: props.code,
          identityAnchors: props.identityAnchors,
          scaleReference: props.scaleReference,
          continuityLock: props.continuityLock,
          stateVariants: props.stateVariants,
          referenceImageUrls: props.referenceImageUrls,
        })
        .from(props)
        .where(eq(props.projectId, projectId));
      const shotText = [shot.visualPrompt, shot.action, shot.dialogue]
        .filter((v): v is string => typeof v === 'string')
        .join(' ');
      for (const p of propRows) {
        const hit = propTags.some(
          (t) => t === p.name || t === p.code || t === `@${p.code}` || t.endsWith(p.name),
        );
        if (!hit) continue;
        /*
         * 道具是持续身份，状态是变体（开合/破损/消耗/转手）。
         * 旧实现只注入形制锁，于是「已经打开的怀表」每镜都被画成合着的。
         * 这里按本镜文字命中变体名/描述，把状态也写进锁块 —— 只写身份不写状态，
         * 等于让模型每镜重新决定该道具此刻是什么形态。
         */
        const variant = this.matchPropVariant(
          p.stateVariants as PropStateVariant[] | null,
          shotText,
        );
        propInputs.push({
          id: p.id,
          code: p.code,
          name: p.name,
          url: (p.referenceImageUrls ?? [])[0],
          lock: [
            p.identityAnchors,
            p.scaleReference,
            p.continuityLock,
            variant ? `本镜状态：${variant.name}${variant.description ? `（${variant.description}）` : ''}` : null,
          ]
            .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
            .join('；'),
        });
      }
    }

    // 上一镜成帧（ArcReel 的 previous_storyboard）：优先取**同片段内**前一镜，
    // 段内没有才回落到同场前一镜。段内镜像链才是真正需要接住的那一段连续动作；
    // 跨段参考会把上一段的收尾光位硬套到新空间，反而制造跳变。
    // 只给构图与色调，不给姿态 —— 否则相邻镜会变成复制粘贴的同角度。
    let previousShot: { shotNumber: number; url: string } | null = null;
    if (shot.sceneId && shot.shotNumber > 1) {
      const sameScene = and(
        eq(shots.sceneId, shot.sceneId),
        lt(shots.shotNumber, shot.shotNumber),
        isNotNull(shots.startFrameUrl),
      );
      const inSegment =
        shot.segmentId != null
          ? await this.db
              .select({ shotNumber: shots.shotNumber, startFrameUrl: shots.startFrameUrl })
              .from(shots)
              .where(and(eq(shots.segmentId, shot.segmentId), sameScene))
              .orderBy(desc(shots.shotNumber))
              .limit(1)
          : [];
      const prevRows =
        inSegment.length > 0
          ? inSegment
          : await this.db
              .select({ shotNumber: shots.shotNumber, startFrameUrl: shots.startFrameUrl })
              .from(shots)
              .where(sameScene)
              .orderBy(desc(shots.shotNumber))
              .limit(1);
      if (prevRows[0]?.startFrameUrl) {
        previousShot = { shotNumber: prevRows[0].shotNumber, url: prevRows[0].startFrameUrl };
      }
    }

    return composeShotReferences({
      characters: charInputs,
      scene: sceneInput,
      props: propInputs,
      previousShot,
      spatialNote,
    });
  }

  private async processVideo(job: GenerationJob, providerName?: string, opts?: { model?: string }): Promise<void> {
    const input = (job.inputData ?? {}) as Record<string, unknown>;
    const rawPrompt = this.inputPrompt(job);
    if (!rawPrompt.trim()) {
      await this.generationService.settleJobFailure(job.id, '视频任务缺少 prompt');
      return;
    }
    /*
     * 视频提示词必须按 3 秒分段重写，不能把分镜表那句整体描述直接丢给模型：
     * 一句「把怀表放进抽屉回头看向门口」在 8 秒里既可能 1 秒做完、也可能做一半循环。
     * 火宝的做法是 0-3s / 3-6s 各写一段可见动作与该段台词 —— 段内密度可控，
     * 段间衔接才有依据。这里再把同段的上一镜结束状态接上（ArcReel 的镜像链）。
     */
    const composed = await this.buildVideoPrompt(job, rawPrompt, input);
    const prompt = composed.prompt;
    const refs = Array.isArray(input.references)
      ? (input.references as unknown[]).filter(
          (r): r is string => typeof r === 'string' && r.length > 0,
        )
      : [];
    // 一键成片时 references 在建任务那刻首帧尚未生成：执行时按镜头现状补空
    // （只填空不覆盖已有引用；变体任务同样受益）
    let imageUrl = refs[0];
    let lastFrameUrl = refs[2];
    // 带首帧依赖的任务（一键成片）必须以镜头当前首帧为准：
    // 建单时快照的 references 可能是旧帧或空值，重试后新帧会被旧值挡住。
    const dependsOnJobId =
      typeof input.dependsOnJobId === 'string' ? input.dependsOnJobId : undefined;
    if ((dependsOnJobId || !imageUrl || !lastFrameUrl) && job.targetType === 'shot' && job.targetId) {
      const shotRows = await this.db
        .select({ startFrameUrl: shots.startFrameUrl, endFrameUrl: shots.endFrameUrl })
        .from(shots)
        .where(eq(shots.id, job.targetId))
        .limit(1);
      if (shotRows[0]?.startFrameUrl && (dependsOnJobId || !imageUrl)) {
        imageUrl = shotRows[0].startFrameUrl;
      }
      if (!lastFrameUrl && shotRows[0]?.endFrameUrl) lastFrameUrl = shotRows[0].endFrameUrl;
    }
    // 白模选填：references[1] 为白模位（generateShotVideo 约定：首帧/白模/尾帧/角色图）。
    // 网关侧再做双门控（供应商 videoReference 开关 + 公网 URL），此处只透传不决策。
    const { taskId } = await this.modelGateway.generateVideo(
      {
        prompt,
        duration:
          typeof input.duration === 'number'
            ? input.duration
            : composed.duration || 5,
        imageUrl,
        referenceVideoUrl: refs[1],
        lastFrameUrl,
        model: opts?.model,
      },
      providerName,
    );
    // 远端任务已创建：记录 externalTaskId，保持 running，由轮询完成
    await this.db
      .update(generationJobs)
      .set({ externalTaskId: taskId, progress: 10, updatedAt: new Date() })
      .where(eq(generationJobs.id, job.id));
    this.logger.log(
      `视频远端任务已创建 ${job.id} → ${taskId}` +
        (composed.degraded ? `（无 3 秒节拍，按整段描述兜底）` : `（${composed.beatCount} 段节拍）`),
    );
  }

  /**
   * 组装一个镜头的分段视频提示词。
   *
   * 取数：镜头（时长/景别/运镜/画面方向/台词/节拍）→ 片段（空间基准/轴线）
   * → 同段上一镜（结束状态）。任何一环缺失都降级而不是报错：
   * 视频是付费环节，宁可给一段保守描述，也不要因为缺节拍直接失败。
   */
  private async buildVideoPrompt(
    job: GenerationJob,
    rawPrompt: string,
    input: Record<string, unknown>,
  ): Promise<{ prompt: string; degraded: boolean; beatCount: number; duration: number }> {
    if (job.targetType !== 'shot' || !job.targetId) {
      const dur = typeof input.duration === 'number' ? input.duration : 5;
      const r = buildSegmentedVideoPrompt({ duration: dur, description: rawPrompt });
      return { prompt: r.prompt, degraded: r.degraded, beatCount: r.beats.length, duration: dur };
    }
    const rows = await this.db
      .select({
        segmentId: shots.segmentId,
        sceneId: shots.sceneId,
        shotNumber: shots.shotNumber,
        duration: shots.duration,
        shotSize: shots.shotSize,
        movement: shots.movement,
        screenDirection: shots.screenDirection,
        dialogue: shots.dialogue,
        visualPrompt: shots.visualPrompt,
        action: shots.action,
        beats: shots.beats,
        characterIds: shots.characterIds,
      })
      .from(shots)
      .where(eq(shots.id, job.targetId))
      .limit(1);
    const shot = rows[0];
    if (!shot) {
      const dur = typeof input.duration === 'number' ? input.duration : 5;
      const r = buildSegmentedVideoPrompt({ duration: dur, description: rawPrompt });
      return { prompt: r.prompt, degraded: r.degraded, beatCount: r.beats.length, duration: dur };
    }
    const duration = Number(shot.duration) || (typeof input.duration === 'number' ? input.duration : 5);

    // 片段级空间基准与轴线
    let spatialNote: string | null = null;
    if (shot.segmentId) {
      const segRows = await this.db
        .select({
          title: segments.title,
          spaceAnchor: segments.spaceAnchor,
          axisDirection: segments.axisDirection,
        })
        .from(segments)
        .where(eq(segments.id, shot.segmentId))
        .limit(1);
      const seg = segRows[0];
      if (seg) {
        spatialNote =
          [
            seg.title ? `片段「${seg.title}」` : null,
            seg.spaceAnchor
              ? `空间基准 ${SPACE_ANCHOR_LABELS[seg.spaceAnchor as SpaceAnchor] ?? seg.spaceAnchor}`
              : null,
            seg.axisDirection
              ? `本段轴线 ${AXIS_LABELS[seg.axisDirection as AxisDirection] ?? seg.axisDirection}`
              : null,
          ]
            .filter((v): v is string => Boolean(v))
            .join('；') || null;
      }
    }

    // 同段上一镜的结束状态（先段内、再同场）
    let previousEndState: string | null = null;
    if (shot.sceneId && shot.shotNumber > 1) {
      const sameScene = and(eq(shots.sceneId, shot.sceneId), lt(shots.shotNumber, shot.shotNumber));
      const prevRows =
        shot.segmentId != null
          ? await this.db
              .select({
                shotNumber: shots.shotNumber,
                dialogue: shots.dialogue,
                action: shots.action,
                visualPrompt: shots.visualPrompt,
              })
              .from(shots)
              .where(and(eq(shots.segmentId, shot.segmentId), sameScene))
              .orderBy(desc(shots.shotNumber))
              .limit(1)
          : [];
      const prev =
        prevRows[0] ??
        (
          await this.db
            .select({
              shotNumber: shots.shotNumber,
              dialogue: shots.dialogue,
              action: shots.action,
              visualPrompt: shots.visualPrompt,
            })
            .from(shots)
            .where(sameScene)
            .orderBy(desc(shots.shotNumber))
            .limit(1)
        )[0];
      if (prev) {
        previousEndState = describeContinuity({
          previousShotNumber: prev.shotNumber,
          previousDialogue: prev.dialogue,
          previousAction: prev.action || prev.visualPrompt,
          shotSize: shot.shotSize,
        });
      }
    }

    // 在场人物：视频也要锁人数与身份，否则模型会自己加人
    let castNames: string[] = [];
    if ((shot.characterIds ?? []).length > 0 && job.projectId) {
      const charRows = await this.db
        .select({ id: characters.id, name: characters.name })
        .from(characters)
        .where(eq(characters.projectId, job.projectId));
      castNames = charRows
        .filter((c) => (shot.characterIds ?? []).includes(c.id))
        .map((c) => c.name);
    }

    const beats = Array.isArray(shot.beats) ? (shot.beats as ShotBeat[]) : null;
    const r = buildSegmentedVideoPrompt({
      duration,
      beats,
      description: shot.visualPrompt || rawPrompt,
      dialogue: shot.dialogue,
      shotSize: shot.shotSize,
      movement: shot.movement,
      screenDirection: (shot.screenDirection as ScreenDirection | null) ?? null,
      characters: castNames,
      previousEndState,
      spatialNote,
    });
    return { prompt: r.prompt, degraded: r.degraded, beatCount: r.beats.length, duration };
  }

  /**
   * 将 data:audio/wav;base64,... 音频落盘至 /uploads/{projectId}/tts_{uuid}.wav，
   * 避免数 MB 的 Base64 字符串直接写入 shots.voice_url 导致 PostgreSQL 行膨胀。
   */
  private async ensureLocalAudioUrl(projectId: string | undefined, audioBase64: string): Promise<string> {
    const raw = audioBase64.replace(/^data:audio\/[a-zA-Z0-9.+-]+;base64,/, '');
    const buf = Buffer.from(raw, 'base64');
    const folder = projectId || 'common';
    const dir = join(uploadDir(), folder);
    await mkdir(dir, { recursive: true });
    const filename = `tts_${randomUUID().slice(0, 12)}.wav`;
    await writeFile(join(dir, filename), buf);
    return `/uploads/${folder}/${filename}`;
  }

  private async processTts(job: GenerationJob, providerName?: string): Promise<void> {
    const text = this.inputPrompt(job);
    if (!text.trim()) {
      await this.generationService.settleJobFailure(job.id, '配音任务缺少文本');
      return;
    }
    // Agnes 通道无配音能力（官方无音频 API）：直接失败并明示，不浪费调用
    if (providerName) {
      const prow = await this.db
        .select({ formatType: modelProviders.formatType })
        .from(modelProviders)
        .where(eq(modelProviders.name, providerName))
        .limit(1);
      if (prow.length > 0 && prow[0].formatType === 'agnes') {
        await this.generationService.settleJobFailure(
          job.id,
          '该供应商为 Agnes 测试通道，官方暂无配音接口；请换有 TTS 能力的供应商后重试',
        );
        return;
      }
    }
    // 多角色音色自动绑定：优先读 input.voice，其次根据镜头关联的 characterIds 或台词角色前缀匹配 characters.voiceId
    const input = (job.inputData ?? {}) as Record<string, unknown>;
    let resolvedVoice = typeof input.voice === 'string' && input.voice.trim() ? input.voice.trim() : undefined;
    if (!resolvedVoice && job.projectId) {
      const charRows = await this.db
        .select({ id: characters.id, name: characters.name, voiceId: characters.voiceId })
        .from(characters)
        .where(eq(characters.projectId, job.projectId));
      if (charRows.length > 0) {
        if (job.targetType === 'shot' && job.targetId) {
          const shotRows = await this.db
            .select({ characterIds: shots.characterIds, dialogue: shots.dialogue })
            .from(shots)
            .where(eq(shots.id, job.targetId))
            .limit(1);
          const cids = shotRows[0]?.characterIds ?? [];
          const byId = charRows.find((c) => cids.includes(c.id) && c.voiceId);
          if (byId?.voiceId) resolvedVoice = byId.voiceId;
        }
        // 台词前缀匹配（如 "林晚：..." 或 "[林晚] ..."）
        if (!resolvedVoice) {
          const byName = charRows.find(
            (c) => c.voiceId && c.name && (text.startsWith(`${c.name}：`) || text.startsWith(`${c.name}:`) || text.includes(`【${c.name}】`)),
          );
          if (byName?.voiceId) resolvedVoice = byName.voiceId;
        }
      }
    }

    const result = await this.modelGateway.generateTTS(
      { text, voice: resolvedVoice },
      providerName,
    );
    let voiceUrl = result.audioUrl;
    if (!voiceUrl && result.audioBase64) {
      voiceUrl = await this.ensureLocalAudioUrl(job.projectId, result.audioBase64);
    } else if (voiceUrl && voiceUrl.startsWith('data:audio/')) {
      voiceUrl = await this.ensureLocalAudioUrl(job.projectId, voiceUrl);
    }
    if (voiceUrl) await this.writebackToTarget(job, { voiceUrl });
    await this.generationService.settleJobSuccess(job.id, {
      audioUrl: voiceUrl,
      voice: resolvedVoice,
      hasAudio: Boolean(voiceUrl),
    });
  }

  // ========== 流水线确认门（docs/流程重构方案-v2.md 三道门） ==========

  /** 读项目 metadata.pipeline.approvals（三道门通过时间；无记录 = 未过门） */
  private async pipelineApprovals(projectId: string): Promise<{
    script?: string;
    storyboard?: string;
    final?: string;
  }> {
    const rows = await this.db
      .select({ metadata: projects.metadata })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    const meta = (rows[0]?.metadata ?? {}) as {
      pipeline?: { approvals?: { script?: string; storyboard?: string; final?: string } };
    };
    return meta.pipeline?.approvals ?? {};
  }

  // ========== P0 断链修复：段内自动连跑驱动器 ==========

  /**
   * 每轮 tick 调用，把过门项目的流水线推进到下一段（幂等，全链去重守卫）：
   * 1. 补写回：前端 poll 提前结算的视频任务不再丢产物（videoUrl 补写 + 资产归档）
   * 2. 图全完成 → 自动建 video 任务（有首帧、无成片、无在途也无成功记录的镜头）
   * 3. 视频全完成 → 自动建 tts 任务（有对白且无配音的镜头）
   * 4. 配音全完成 → 状态推进 editing，自动建 edit 任务（服务端 ffmpeg 合成）
   * 5. edit 成功（processEdit）→ 状态推进 qc，建 qc 任务；qc 完成后停在 qc 等门3
   * 生效条件：已过分镜确认门；或项目已存在 video 任务（旧数据兼容）。
   */
  private async drivePipeline(): Promise<void> {
    const projRows = await this.db
      .select({ id: projects.id })
      .from(projects)
      .where(
        // editing/qc 也要进自动链：旧数据里「1/7 视频就推进到 qc」的假完成
        // 必须在下一轮 tick 被数量门发现并回退，否则永远停在完成假象里。
        inArray(projects.status, [
          'assets_generating',
          'video_generating',
          'audio_generating',
          'editing',
          'qc',
        ]),
      );
    for (const proj of projRows) {
      // eslint-disable-next-line no-await-in-loop
      await this.driveProjectPipeline(proj.id).catch((e: Error) =>
        this.logger.warn(`项目 ${proj.id} 自动链推进失败: ${e.message}`),
      );
    }
  }

  private async driveProjectPipeline(projectId: string): Promise<void> {
    const approvals = await this.pipelineApprovals(projectId);
    const [shotRows, jobRows] = await Promise.all([
      this.db.select().from(shots).where(eq(shots.projectId, projectId)),
      this.db
        .select({
          id: generationJobs.id,
          jobType: generationJobs.jobType,
          status: generationJobs.status,
          targetId: generationJobs.targetId,
          targetType: generationJobs.targetType,
          projectId: generationJobs.projectId,
          // providerName 必带：补写回时据此判定产物是否 mock，缺了会退回默认供应商误判
          providerName: generationJobs.providerName,
          inputData: generationJobs.inputData,
          outputData: generationJobs.outputData,
        })
        .from(generationJobs)
        .where(eq(generationJobs.projectId, projectId)),
    ]);
    const isActive = (s: string) =>
      ['pending', 'queued', 'running', 'retrying'].includes(s);
    const isVariant = (input: unknown) =>
      typeof (input as Record<string, unknown> | null)?.variantGroup === 'string';

    // 旧数据兼容：未过门但已发起过视频生产的项目继续自动链；已过门的一律链
    const hasVideoJobs = jobRows.some((j) => j.jobType === 'video');
    if (!approvals.storyboard && !hasVideoJobs) return;

    // 0) 补写回：succeeded 的非变体 video 任务，镜头还没拿到成片 → 补 writeback
    //    （修复：前端 /poll 抢先结算成功后，writeback 永远不发生的丢产物问题）
    for (const j of jobRows) {
      if (j.jobType !== 'video' || j.status !== 'succeeded' || !j.targetId) continue;
      if (isVariant(j.inputData)) continue;
      const shot = shotRows.find((s) => s.id === j.targetId);
      if (!shot) continue;
      const out = (j.outputData ?? {}) as Record<string, unknown>;
      const url = typeof out.url === 'string' && out.url ? out.url : undefined;
      if (url && shot.videoUrl !== url) {
        // eslint-disable-next-line no-await-in-loop
        await this.writebackToTarget(j as unknown as GenerationJob, { videoUrl: url }).catch(
          (e: Error) => this.logger.warn(`补写回视频失败 ${j.id}: ${e.message}`),
        );
        shot.videoUrl = url;
      }
    }

    const activeJobsOf = (t: string) =>
      jobRows.filter((j) => j.jobType === t && isActive(j.status) && !isVariant(j.inputData));
    // 失败过的目标不再自动重投：否则每轮 tick 都会重建同一个必败任务（配音尤其明显）。
    // 但这只管「不重投」，绝不等于「该镜头已完成」——仍由 readiness 计入缺口。
    const failedTargetsOf = (t: string) =>
      new Set(
        jobRows
          .filter((j) => j.jobType === t && j.status === 'failed' && j.targetId && !isVariant(j.inputData))
          .map((j) => j.targetId as string),
      );

    // 1) 图未跑完不推进
    if (activeJobsOf('image').length > 0) return;

    const activeVideoTargets = new Set(
      activeJobsOf('video').map((j) => j.targetId as string),
    );
    const doneVideoTargets = new Set(
      jobRows
        .filter(
          (j) =>
            j.jobType === 'video' &&
            j.status === 'succeeded' &&
            j.targetId &&
            !isVariant(j.inputData),
        )
        .map((j) => j.targetId as string),
    );
    const failedVideoTargets = failedTargetsOf('video');

    // 2) 自动建 video：有首帧、无成片、无在途/无成功/无失败记录的镜头
    const needVideo = shotRows.filter(
      (s) =>
        s.startFrameUrl &&
        !s.videoUrl &&
        !doneVideoTargets.has(s.id) &&
        !activeVideoTargets.has(s.id) &&
        !failedVideoTargets.has(s.id) &&
        s.status !== 'failed',
    );
    if (needVideo.length > 0) {
      for (const s of needVideo) {
        // eslint-disable-next-line no-await-in-loop
        await this.storyboardService
          .generateShotVideo(projectId, s.id)
          .catch((e: Error) =>
            this.logger.warn(`自动建视频任务失败（镜 ${s.shotNumber}）: ${e.message}`),
          );
      }
      this.logger.log(`自动链：项目 ${projectId} 新建 ${needVideo.length} 个视频任务`);
      await this.advanceProjectStatus(projectId, 'assets_generating', 'video_generating');
      return; // 本轮到此为止，视频跑完再进配音
    }

    // 3) 视频未跑完不推进
    if (activeJobsOf('video').length > 0) {
      await this.advanceProjectStatus(projectId, 'assets_generating', 'video_generating');
      return;
    }

    // 4) 【数量门 · 修复假完成】N 个镜头必须 N 个成片。
    // 旧逻辑用 `needVideo.length === 0` 推导「全段完成」，但失败/缺帧镜头被
    // 过滤条件当成「不需要」，再用 some(videoUrl) 放行 edit —— 7 镜出 1 片
    // 就合成 8 秒成片并推进 editing → qc。这里改成唯一真源 M/N。
    const readiness = computePipelineReadiness(
      shotRows.map((s) => ({
        id: s.id,
        startFrameUrl: s.startFrameUrl,
        videoUrl: s.videoUrl,
        voiceUrl: s.voiceUrl,
        dialogue: s.dialogue,
        status: s.status,
      })),
    );
    if (!readiness.videoComplete) {
      await this.writePipelineField(projectId, 'readiness', {
        blocked: true,
        reason: 'missing_videos',
        total: readiness.total,
        withVideo: readiness.withVideo,
        missing: readiness.missingVideos.length,
        missingFrames: readiness.missingFrames.length,
        failedShots: readiness.failedShots,
      });
      await this.rewindToVideoGenerating(projectId);
      return;
    }
    await this.writePipelineField(projectId, 'readiness', null);

    // 5) 自动建 tts：有对白、无配音、无在途/无成功/无失败 tts 的镜头
    const activeTtsTargets = new Set(activeJobsOf('tts').map((j) => j.targetId as string));
    const doneTtsTargets = new Set(
      jobRows
        .filter((j) => j.jobType === 'tts' && j.status === 'succeeded' && j.targetId)
        .map((j) => j.targetId as string),
    );
    const failedTtsTargets = failedTargetsOf('tts');
    const needTts = shotRows.filter(
      (s) =>
        (s.dialogue ?? '').trim().length > 0 &&
        !s.voiceUrl &&
        !doneTtsTargets.has(s.id) &&
        !activeTtsTargets.has(s.id) &&
        !failedTtsTargets.has(s.id) &&
        s.status !== 'failed',
    );
    if (needTts.length > 0) {
      await this.db.insert(generationJobs).values(
        needTts.map((s) => ({
          projectId,
          jobType: 'tts' as const,
          targetType: 'shot' as const,
          targetId: s.id,
          status: 'pending' as const,
          priority: 45,
          inputData: { prompt: s.dialogue ?? '' },
        })),
      );
      this.logger.log(`自动链：项目 ${projectId} 新建 ${needTts.length} 个配音任务`);
      await this.advanceProjectStatus(projectId, 'video_generating', 'audio_generating');
      return;
    }

    // 6) 配音未跑完不推进
    if (activeJobsOf('tts').length > 0) {
      await this.advanceProjectStatus(projectId, 'video_generating', 'audio_generating');
      return;
    }

    // 7) 配音缺口显式记账但不阻断成片：部分通道（如 Agnes 测试）没有 TTS 接口，
    // 卡死整条链只会让用户永远看不到成片。QC 仍会把「有对白但缺少配音」列为问题。
    if (!readiness.voiceComplete) {
      this.logger.warn(
        `项目 ${projectId} 配音未完成 ${readiness.withVoice}/${readiness.needVoice}（供应商不支持或任务失败），成片将缺少人声`,
      );
    }

    // 8) 全段完成 → editing + 建 edit 任务（服务端合成，幂等去重）
    const activeEdit = jobRows.some((j) => j.jobType === 'edit' && isActive(j.status));
    const doneEdit = jobRows.some((j) => j.jobType === 'edit' && j.status === 'succeeded');
    if (!doneEdit && !activeEdit) {
      await this.db.insert(generationJobs).values({
        projectId,
        jobType: 'edit',
        targetType: 'project',
        targetId: projectId,
        status: 'pending',
        priority: 40,
        inputData: { prompt: 'pipeline-assemble' },
      });
      this.logger.log(
        `自动链：项目 ${projectId} ${readiness.withVideo}/${readiness.total} 个镜头成片齐备，已创建剪辑合成任务`,
      );
    }
    await this.advanceProjectStatus(projectId, 'video_generating', 'audio_generating');
    await this.advanceProjectStatus(projectId, 'audio_generating', 'editing');
  }

  /** 把流水线状态写进 metadata.pipeline[key]（readiness / qc），幂等，不覆盖 approvals */
  private async writePipelineField(
    projectId: string,
    key: string,
    payload: Record<string, unknown> | null,
  ): Promise<void> {
    const [row] = await this.db
      .select({ metadata: projects.metadata })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    if (!row) return;
    const meta = (row.metadata ?? {}) as Record<string, unknown>;
    const pipeline = (meta.pipeline ?? {}) as Record<string, unknown>;
    if (JSON.stringify(pipeline[key] ?? null) === JSON.stringify(payload)) return;
    const nextPipeline = { ...pipeline };
    if (payload) nextPipeline[key] = payload;
    else delete nextPipeline[key];
    await this.db
      .update(projects)
      .set({ metadata: { ...meta, pipeline: nextPipeline }, updatedAt: new Date() })
      .where(eq(projects.id, projectId));
  }

  /** 旧数据里已经「假完成」的项目回退到生成中，避免状态机停在 qc 假象里 */
  private async rewindToVideoGenerating(projectId: string): Promise<void> {
    const [row] = await this.db
      .select({ status: projects.status })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    if (!row || !['audio_generating', 'editing', 'qc'].includes(row.status)) return;
    await this.db
      .update(projects)
      .set({ status: 'video_generating', updatedAt: new Date() })
      .where(eq(projects.id, projectId));
    this.logger.warn(
      `项目 ${projectId} 状态回退 ${row.status} → video_generating：镜头成片未齐，不允许标记完成`,
    );
  }

  // ========== edit 服务端合成 / qc 质检任务（激活状态机 editing/qc 死区） ==========

  /** edit 任务：复用 export/assemble 的 ffmpeg 合成 → editing → qc，自动建质检任务 */
  private async processEdit(job: GenerationJob): Promise<void> {
    if (!job.projectId) {
      await this.generationService.settleJobFailure(job.id, '剪辑任务缺少项目归属');
      return;
    }
    try {
      // 合成前再核一次镜头数：自动链已守一道门，但手动触发的 edit 任务、
      // 以及历史遗留的 in-flight 任务仍可能把 1 个片段当成整片导出。
      const shotRows = await this.db
        .select({ id: shots.id, videoUrl: shots.videoUrl })
        .from(shots)
        .where(eq(shots.projectId, job.projectId));
      const readiness = computePipelineReadiness(
        shotRows.map((s) => ({ id: s.id, videoUrl: s.videoUrl })),
      );
      if (!readiness.videoComplete) {
        throw new Error(
          `镜头成片未齐（${readiness.withVideo}/${readiness.total}），拒绝合成残缺成片`,
        );
      }
      const result = await this.exportService.assembleFinalVideo(job.projectId);
      if (result.clips < readiness.total) {
        throw new Error(
          `合成片段数不足（${result.clips}/${readiness.total}），拒绝把缺镜成片标记为完成`,
        );
      }
      await this.generationService.settleJobSuccess(job.id, {
        assetId: result.asset.id,
        clips: result.clips,
        durationSeconds: result.durationSeconds,
      });
      await this.advanceProjectStatus(job.projectId, 'editing', 'qc');
      await this.db.insert(generationJobs).values({
        projectId: job.projectId,
        jobType: 'qc',
        targetType: 'project',
        targetId: job.projectId,
        status: 'pending',
        priority: 40,
        inputData: { prompt: 'pipeline-qc' },
      });
      this.logger.log(`成片合成完成 ${job.id}：${result.clips} 段，已创建质检任务`);
    } catch (e) {
      // 可预见的业务性失败（缺镜 / 空片）直接终结，不烧 3 次重试
      const message = (e as Error).message;
      if (message.includes('暂无镜头成片') || message.includes('镜头成片未齐') || message.includes('合成片段数不足')) {
        await this.generationService.settleJobFailure(job.id, message);
        return;
      }
      throw e;
    }
  }

  /** qc 任务：确定性规则质检（复用 QcService.triggerQc）→ 停在 qc 等门3 成片确认 */
  private async processQc(job: GenerationJob): Promise<void> {
    if (!job.projectId) {
      await this.generationService.settleJobFailure(job.id, '质检任务缺少项目归属');
      return;
    }
    const report = await this.qcService.triggerQc(job.projectId, {});
    // 质检不通过必须留下硬门记录：旧实现只把 pass:false 写进任务产物，
    // 项目照样停在 qc、成片确认门照样可点，用户看到 29 条问题却被当成「已完成」。
    await this.writePipelineField(
      job.projectId,
      'qc',
      report.pass
        ? { pass: true, score: report.overallScore, issueCount: report.issues.length }
        : {
            pass: false,
            score: report.overallScore,
            issueCount: report.issues.length,
            reportId: report.id,
            reason: '质检未通过：请补齐失败镜头后重新质检',
          },
    );
    await this.generationService.settleJobSuccess(job.id, {
      reportId: report.id,
      overallScore: report.overallScore,
      pass: report.pass,
      issueCount: report.issues.length,
    });
    this.logger.log(
      `质检完成 ${job.id}：得分 ${report.overallScore}，通过=${report.pass}，问题 ${report.issues.length} 条`,
    );
  }

  // ========== script 剧本技能任务 ==========
  /**
   * 剧本技能任务：LLM 生成/改写剧本 → 存回项目 → 自动链式创建 parse_script 物化。
   * 无 Key 时 runSkill 抛可读错，由外层统一转为 pending 等待（不烧重试）。
   */
  private async processScriptJob(job: GenerationJob, providerName?: string, opts?: { model?: string; temperature?: number }): Promise<void> {
    if (!job.projectId) {
      await this.generationService.settleJobFailure(job.id, '剧本任务缺少项目归属');
      return;
    }
    const input = (job.inputData ?? {}) as {
      kind?: string;
      source?: string;
      styleId?: string;
      genreId?: string;
      rewriteEnabled?: boolean;
      directives?: string;
    };
    const kind = input.kind === 'script_rewrite' || input.kind === 'one_sentence_expand' || input.kind === 'ad_creative'
      ? input.kind
      : 'novel_to_script';
    // 风格回落：未显式指定则用项目画风（风格包 id 与 ArtStyle 同源）
    // 时长同理：一句话扩写按项目目标时长控制分场体量（90 秒项目不能写成 60 秒）
    const artRows = await this.db
      .select({ artStyle: projects.artStyle, durationSeconds: projects.durationSeconds })
      .from(projects)
      .where(eq(projects.id, job.projectId))
      .limit(1);
    const styleId = input.styleId ?? artRows[0]?.artStyle ?? undefined;
    const targetSeconds = artRows[0]?.durationSeconds ?? undefined;
    const result = await this.storySkills.runSkill({
      skillId: kind,
      source: input.source ?? '',
      styleId,
      genreId: typeof input.genreId === 'string' ? input.genreId : undefined,
      model: opts?.model,
      temperature: opts?.temperature,
      rewriteEnabled: input.rewriteEnabled,
      directives: input.directives,
      providerName: providerName ?? job.providerName,
      targetSeconds,
    });
    if (!result.scriptText.trim() || result.scenesCount === 0) {
      // 解析不出场景时不能假装成功：否则项目卡在 parsing、用户无任何可继续的入口。
      // 走 noteJobError 按重试预算自动重跑（模型偶发返回损坏 JSON），耗尽后才是真失败。
      await this.generationService.noteJobError(
        job.id,
        result.scriptText.trim()
          ? '剧本已生成但分场解析失败（模型返回格式不完整），正在自动重试；仍失败请到「剧本」页手动粘贴'
          : '技能未产出可用剧本',
      );
      return;
    }
    await this.db
      .update(projects)
      .set({ scriptText: result.scriptText, updatedAt: new Date() })
      .where(eq(projects.id, job.projectId));
    // 门1 剧本确认：未过门则停在「剧本已产出」，等 POST /approve(stage=script) 后再物化分镜
    const approvals = await this.pipelineApprovals(job.projectId);
    if (!approvals.script) {
      await this.generationService.settleJobSuccess(job.id, {
        skillId: result.skillId,
        title: result.title,
        scenesCount: result.scenesCount,
        dialoguesCount: result.dialoguesCount,
        ...(result.degraded ? { degraded: true } : {}),
        awaitingApproval: 'script',
      });
      this.logger.log(`剧本技能完成，等待剧本确认门（项目 ${job.projectId}）`);
      return;
    }
    await this.generationService.settleJobSuccess(job.id, {
      skillId: result.skillId,
      title: result.title,
      scenesCount: result.scenesCount,
      dialoguesCount: result.dialoguesCount,
      ...(result.degraded ? { degraded: true } : {}),
    });
    // 链式资产前置：剧本定稿后第一步不是拆分镜，而是先把人物/场景定妆出来。
    // （旧实现直接链 parse_script，跳过整个资产阶段 —— 流程错位的起点）
    await this.db.insert(generationJobs).values({
      projectId: job.projectId,
      jobType: 'asset_prep',
      targetType: 'project',
      targetId: job.projectId,
      status: 'pending',
      priority: 80,
      inputData: {
        prompt: result.scriptText,
        replaceExisting: true,
        skillId: result.skillId,
      },
    });
    this.logger.log(`剧本技能 ${result.skillId} 完成，已链式创建资产前置任务`);
  }

  // ========== boards 分镜表物化 ==========
  /**
   * 分镜表技能任务：LLM 输出分镜 JSON → 按 scene 分组建场建镜。
   * 解析失败（空数组）则降级：链式 parse_script 用原文启发式拆分，不丢任务。
   */
  private async processBoardsJob(job: GenerationJob, providerName?: string, opts?: { model?: string; temperature?: number }): Promise<void> {
    if (!job.projectId) {
      await this.generationService.settleJobFailure(job.id, '分镜任务缺少项目归属');
      return;
    }
    const input = (job.inputData ?? {}) as {
      scriptText?: string;
      prompt?: string;
      styleId?: string;
      genreId?: string;
      replaceExisting?: boolean;
    };
    // asset_prep 链上来时用的是 prompt 键，历史调用方用 scriptText —— 两个都认
    const scriptText = (input.scriptText ?? input.prompt ?? '').trim();
    if (!scriptText) {
      await this.generationService.settleJobFailure(job.id, '分镜任务缺少剧本内容');
      return;
    }
    let styleId = input.styleId;
    if (!styleId) {
      const artRows = await this.db
        .select({ artStyle: projects.artStyle })
        .from(projects)
        .where(eq(projects.id, job.projectId))
        .limit(1);
      styleId = artRows[0]?.artStyle ?? undefined;
    }
    let boards: BoardsShot[];
    // 已确认资产清单：分镜只能引用真实存在的人/景/道具，避免 LLM 新造角色
    const assetIndex = await this.loadAssetIndex(job.projectId);
    // 目标总时长在 try 外读一次：技能调用与落库前的预算收口共用同一个值，
    // 不能只把数字写进提示词指望模型自觉遵守（实测 30s 项目物化出 66s）。
    const projDurRows = await this.db
      .select({ durationSeconds: projects.durationSeconds })
      .from(projects)
      .where(eq(projects.id, job.projectId))
      .limit(1);
    const targetSeconds = Number(projDurRows[0]?.durationSeconds) || undefined;
    try {
      const result = await this.storySkills.runBoards({
        scriptText,
        styleId,
        genreId: typeof input.genreId === 'string' ? input.genreId : undefined,
        model: opts?.model,
        temperature: opts?.temperature,
        providerName: providerName ?? job.providerName,
        targetSeconds,
        catalog: {
          characters: assetIndex.characters.map((c) => ({ name: c.name, roleType: c.roleType ?? undefined })),
          locations: assetIndex.locations.map((l) => ({ name: l.name, timeOfDay: l.timeOfDay ?? undefined })),
          props: assetIndex.props.map((p) => ({ code: p.code ?? undefined, name: p.name, category: p.category ?? undefined })),
        },
      });
      boards = result.shots;
    } catch (e) {
      // 分镜表是「质量链」的一环，不是必经的付费强依赖：
      // 模型不可用 / 返回损坏 JSON 时降级到确定性启发式，保证流程不断链，
      // 但把降级原因写进任务产物，用户能看到「这版分镜是启发式拆的」。
      const reason = (e as Error)?.message ?? '未知错误';
      this.logger.warn(`分镜表技能失败 ${job.id}，降级走 parse_script：${reason}`);
      await this.settleWithHeuristicFallback(job, scriptText, input.replaceExisting === true, {
        fallback: 'parse_script_error',
        reason: reason.slice(0, 200),
      });
      return;
    }
    if (boards.length === 0) {
      // 降级：LLM 没产出可用 JSON，转 parse_script 启发式拆分
      this.logger.warn(`分镜表空结果 ${job.id}，降级走 parse_script`);
      await this.settleWithHeuristicFallback(job, scriptText, input.replaceExisting === true, {
        fallback: 'parse_script_empty',
      });
      return;
    }
    /*
     * 分镜表质量门：结构上空、内容也空的「分镜」等于没分镜。
     * 判据是画面描述/台词至少有一项像话 —— 三项全空的分镜落库后，
     * 下游首帧只能拿一句「全景 establishing shot」去猜，等于把
     * 「人物/场景/景别/机位」全部丢回给模型随机发挥，这正是前后不连贯的成因。
     * 这里宁可降级到确定性拆分（它至少带场标题、台词与资产绑定）。
     */
    const meaningful = boards.filter(
      (b) =>
        (b.visualPrompt ?? '').trim().length >= 4 || (b.dialogue ?? '').trim().length >= 2,
    );
    if (meaningful.length < Math.ceil(boards.length * 0.5)) {
      this.logger.warn(
        `分镜表质量门未通过 ${job.id}：${boards.length} 镜中仅 ${meaningful.length} 镜有画面/台词，降级走 parse_script`,
      );
      await this.settleWithHeuristicFallback(job, scriptText, input.replaceExisting === true, {
        fallback: 'parse_script_low_quality',
        reason: `${boards.length} 镜中 ${boards.length - meaningful.length} 镜缺少画面描述与台词`,
      });
      return;
    }
    // 时长预算硬收口（fitTotalBudget 此前是死代码，从未接入）：
    // 每镜有「台词念得完」的最小可读时长，超出目标的部分按各镜余量等比例回收；
    // 余量砍光仍超就如实报 overflow，绝不静默截断对白。
    let durationTotal = boards.reduce((sum, b) => sum + (b.durationSeconds || 0), 0);
    let durationOverflow = 0;
    if (targetSeconds && targetSeconds > 0 && boards.length > 0) {
      const wants = boards.map((b) => Math.max(1, Math.min(15, Math.round(b.durationSeconds))));
      const mins = wants.map((want, i) =>
        Math.min(want, Math.max(4, minimumReadableSeconds(boards[i].dialogue))),
      );
      const fit = fitTotalBudget(wants, mins, targetSeconds);
      boards = boards.map((b, i) => {
        const scale = fit.seconds[i] / Math.max(1, wants[i]);
        const round1 = (n: number) => Math.round(n * 10) / 10;
        return {
          ...b,
          durationSeconds: fit.seconds[i],
          beats: b.beats?.map((beat) => ({
            ...beat,
            from: round1(beat.from * scale),
            to: round1(beat.to * scale),
          })),
        };
      });
      durationTotal = fit.total;
      durationOverflow = fit.overflow;
      if (fit.overflow > 0) {
        this.logger.warn(
          `分镜时长仍超预算 ${job.projectId}：${fit.total}s / 目标 ${targetSeconds}s（台词最小可读时长已保住，需删台词或加时长）`,
        );
      }
    }

    if (input.replaceExisting) {
      // 片段先删（shots.segment_id 是 SET NULL，但段随 scenes 级联，清干净更省事）
      await this.db.delete(segments).where(eq(segments.projectId, job.projectId));
      await this.db.delete(shots).where(eq(shots.projectId, job.projectId));
      await this.db.delete(scenes).where(eq(scenes.projectId, job.projectId));
    }
    // 按 scene 分组建场（保持出现顺序），镜号场内递增
    const groups = new Map<string, BoardsShot[]>();
    for (const b of boards) {
      const list = groups.get(b.scene) ?? [];
      list.push(b);
      groups.set(b.scene, list);
    }
    let sceneNumber = 0;
    let shotTotal = 0;
    let segmentTotal = 0;
    // 分镜表同样必须落在资产上：场 → locations，片段/镜 → characters
    const cast = new Map(assetIndex.characters.map((c) => [this.normalizeName(c.name), c.id]));
    // 剧本里「角色：台词」的说话人索引：场景对话/配音要按角色归档，
    // 之前 scenes.dialogues 恒为 []，分镜确认后谁说的这句就永久丢了。
    const speakerByText = new Map<string, string>();
    for (const line of scriptText.split(/\r?\n/)) {
      const m = /^([^：:\n]{1,20})[：:]\s*(.+)$/.exec(line.trim());
      if (m) speakerByText.set(m[2].trim().replace(/^["“「]|["”」]$/g, ''), m[1].trim());
    }
    for (const [title, list] of groups) {
      sceneNumber += 1;
      // 人物绑定优先用 LLM 明确声明的 cast，再退回文本匹配。旧实现只按文本匹配，
      // 模型写英文 "the old man / the prince" 时中文资产名一个都命中不了，
      // 实测 3/3 场 scenesWithCast=0，首帧拿不到任何角色参考图。
      const declaredCast = this.uniqueIds(
        list.flatMap((b) => this.resolveCastByName(assetIndex, b.cast)),
      );
      const sceneCast = declaredCast.length > 0
        ? declaredCast
        : this.matchCastIds(cast, [
            title,
            ...list.map((b) => `${b.visualPrompt ?? ''} ${b.dialogue ?? ''}`),
          ]);
      // 场级对白/动作回填（此前恒为空数组，剧本信息在物化时丢了一半）
      const sceneDialogues = list
        .filter((b) => (b.dialogue ?? '').trim())
        .map((b) => {
          const text = (b.dialogue ?? '').trim();
          return { character: speakerByText.get(text) ?? '', text, emotion: '' };
        });
      const sceneActions = list
        .filter((b) => (b.visualPrompt ?? '').trim())
        .slice(0, 8)
        .map((b) => ({ description: (b.visualPrompt ?? '').trim(), character: '', duration: b.durationSeconds }));
      // 场的地点：优先用分镜表明确写的 location（命中资产清单），再按标题/描述猜
      const explicitLocation = list.map((b) => b.location?.trim()).find((v): v is string => Boolean(v));
      // eslint-disable-next-line no-await-in-loop
      const locationId = await this.resolveSceneLocation(
        job.projectId,
        title,
        explicitLocation ?? list[0]?.visualPrompt,
        assetIndex,
      );
      // eslint-disable-next-line no-await-in-loop
      const [scene] = await this.db
        .insert(scenes)
        .values({
          projectId: job.projectId,
          sceneNumber,
          title: title.slice(0, 200),
          summary: list[0]?.visualPrompt?.slice(0, 200),
          dialogues: sceneDialogues,
          actions: sceneActions,
          characterIds: sceneCast,
          locationId,
          props: await this.scenePropsFor(
            job.projectId,
            [title, ...list.map((b) => `${b.visualPrompt ?? ''} ${b.dialogue ?? ''}`)].join('\n'),
          ),
          sortOrder: sceneNumber,
        })
        .returning({ id: scenes.id });

      // 场 → 片段 → 镜：LLM 给了段号就用它的叙事边界，没给就按 ≤15s/2-4 镜归段
      const pieces = planPieces(
        list.map((b, i) => ({ ...b, shotNumber: i + 1, duration: b.durationSeconds })),
      );
      for (const piece of pieces) {
        const head = piece.shots[0];
        segmentTotal += 1;
        // 段级资产引用：本段所有镜声明过的 cast/props 取并集
        const pieceCast = this.uniqueIds(
          piece.shots.flatMap((s) => this.resolveCastByName(assetIndex, s.cast)),
        );
        const pieceProps = [...new Set(piece.shots.flatMap((s) => this.resolvePropTags(assetIndex, s.props)))];
        // eslint-disable-next-line no-await-in-loop
        const [segment] = await this.db
          .insert(segments)
          .values({
            projectId: job.projectId,
            sceneId: scene.id,
            segmentNumber: piece.segmentNumber,
            title: (head.segmentTitle ?? `片段 ${piece.segmentNumber}`).slice(0, 200),
            summary: head.visualPrompt?.slice(0, 300),
            intent: head.intent,
            spaceAnchor: head.spaceAnchor,
            axisDirection: head.axisDirection,
            characterIds: pieceCast.length > 0 ? pieceCast : sceneCast.slice(0, 2),
            locationId: locationId ?? null,
            props: pieceProps,
            durationSeconds: piece.durationSeconds.toFixed(1),
            // 片段序号同样要全局递增，否则跨场重复
            sortOrder: segmentTotal,
          })
          .returning({ id: segments.id });
        if (piece.durationSeconds > SEGMENT_MAX_SECONDS + 0.01) {
          this.logger.warn(
            `片段超长 ${scene.id}#${piece.segmentNumber}：${piece.durationSeconds}s > ${SEGMENT_MAX_SECONDS}s（保留 LLM 叙事边界，不强行拆）`,
          );
        }

        for (const b of piece.shots) {
          shotTotal += 1;
          const shotCast = this.uniqueIds([
            ...this.resolveCastByName(assetIndex, b.cast),
            ...this.matchCastIds(cast, [`${b.visualPrompt ?? ''} ${b.dialogue ?? ''}`]),
          ]);
          const duration = b.durationSeconds;
          // eslint-disable-next-line no-await-in-loop
          await this.db.insert(shots).values({
            projectId: job.projectId,
            sceneId: scene.id,
            segmentId: segment.id,
            shotNumber: shotTotal,
            duration: duration.toFixed(1),
            shotSize: b.shotSize,
            cameraAngle: 'eye_level',
            lens: '50mm',
            movement: b.movement,
            screenDirection: b.screenDirection,
            beats:
              b.beats && b.beats.length > 0
                ? b.beats
                : deriveBeats({
                    duration,
                    dialogue: b.dialogue,
                    visualPrompt: b.visualPrompt,
                    shotSize: b.shotSize,
                  }),
            dialogue: b.dialogue,
            subtitleText: b.dialogue,
            visualPrompt: b.visualPrompt,
            subject: b.visualPrompt?.slice(0, 200),
            characterIds: shotCast.length > 0 ? shotCast : sceneCast.slice(0, 2),
            status: 'draft',
            // 全局序号，不能写场内镜号：跨场重复会让时间线/画布按 [1,1,1,2,2,2,3]
            // 交错排列，剧情顺序整个打乱（场1 → 场3 → 场2 …）。
            sortOrder: shotTotal,
          });
        }
      }
    }
    // 分镜表落库即代表「分镜已产出」，推进到 storyboard_ready 等门2确认。
    // 旧实现只 settle 不改状态，项目会一直停在 bible_ready，用户在 UI 上
    // 找不到「确认分镜」的入口（门控按状态给门）。
    await this.advanceProjectStatus(job.projectId, 'parsing', 'planning');
    await this.advanceProjectStatus(job.projectId, 'planning', 'bible_ready');
    await this.advanceProjectStatus(job.projectId, 'bible_ready', 'storyboard_ready');
    const bindings = await this.countSceneBindings(job.projectId);
    await this.generationService.settleJobSuccess(job.id, {
      scenesCount: groups.size,
      segmentsCount: segmentTotal,
      shotsCount: shotTotal,
      scenesWithLocation: bindings.withLocation,
      scenesWithCast: bindings.withCast,
      durationTotal,
      durationTarget: targetSeconds ?? null,
      durationOverflow,
    });
    this.logger.log(
      `分镜表物化完成 ${job.id}：${groups.size} 场 ${segmentTotal} 片段 ${shotTotal} 镜，` +
        `绑定场景 ${bindings.withLocation}/${groups.size}，绑定人物 ${bindings.withCast}/${groups.size}`,
    );
  }

  /**
   * 分镜表技能不可用时的确定性兜底：链式 parse_script（不需要任何模型），
   * 并如实记录降级原因，避免「没配模型 → 整条链死掉」。
   */
  private async settleWithHeuristicFallback(
    job: GenerationJob,
    scriptText: string,
    replaceExisting: boolean,
    extra: { fallback: string; reason?: string },
  ): Promise<void> {
    if (job.projectId) {
      await this.db.insert(generationJobs).values({
        projectId: job.projectId,
        jobType: 'parse_script',
        targetType: 'project',
        targetId: job.projectId,
        status: 'pending',
        priority: 80,
        inputData: { prompt: scriptText, replaceExisting },
      });
    }
    await this.generationService.settleJobSuccess(job.id, {
      ...extra,
      shotsCount: 0,
      degraded: true,
    });
  }

  // ========== 场次道具登记 ==========

  /**
   * 分镜物化时登记道具：按剧本文本匹配圣经里已登记的道具，写入 scenes.props。
   * 用稳定 @PROP001 编号而非名称，改名不会断链；背景陈设不入镜。
   * 这一步是「道具卡片 → 首帧生成参考图」链路的起点，之前写死 props: [] 导致
   * 道具永远进不了镜头上下文。
   */
  private async scenePropsFor(projectId: string | undefined, text: string): Promise<string[]> {
    if (!projectId) return [];
    const rows = await this.db
      .select({ name: props.name, code: props.code, category: props.category })
      .from(props)
      .where(eq(props.projectId, projectId));
    return rows
      .filter(
        (p) =>
          p.category !== 'set_dressing' &&
          (text.includes(p.name) || (!!p.code && text.includes(p.code))),
      )
      .map((p) => `@${p.code || p.name}`);
  }

  // ========== 资产 ↔ 分镜绑定 ==========

  /** 名称归一化：去标点/空白/大小写，用于剧本里的人和资产清单里的人对上号 */
  private normalizeName(raw: string): string {
    return raw
      .replace(/[\s·・、,，.。:：!！?？"“”'‘’（）()【】[\]<>《》\-—_/\\|]/g, '')
      .toLowerCase();
  }

  /** 项目人物名索引：归一化名 → characters.id（含「」包裹与常见后缀的宽松匹配） */
  private async loadCastIndex(projectId: string): Promise<Map<string, string>> {
    const rows = await this.db
      .select({ id: characters.id, name: characters.name })
      .from(characters)
      .where(eq(characters.projectId, projectId));
    const index = new Map<string, string>();
    for (const c of rows) {
      const key = this.normalizeName(c.name);
      if (key) index.set(key, c.id);
    }
    return index;
  }

  /**
   * 资产索引：LLM 分镜表直接给出 cast / location / props 时，按名字或编号解析成 id。
   * 这比「事后拿画面描述去猜谁在场」可靠得多 —— 猜出来的 cast 会漏人、会把
   * 画外音当成在场、也会把背景路人当成角色，首帧自然就换人。
   */
  private async loadAssetIndex(projectId: string): Promise<AssetIndex> {
    const [charRows, locRows, propRows] = await Promise.all([
      this.db
        .select({ id: characters.id, name: characters.name, roleType: characters.roleType })
        .from(characters)
        .where(eq(characters.projectId, projectId)),
      this.db
        .select({ id: locations.id, name: locations.name, timeOfDay: locations.timeOfDay })
        .from(locations)
        .where(eq(locations.projectId, projectId)),
      this.db
        .select({ id: props.id, code: props.code, name: props.name, category: props.category })
        .from(props)
        .where(eq(props.projectId, projectId)),
    ]);
    return { characters: charRows, locations: locRows, props: propRows };
  }

  /** 名称列表 → 人物 id（精确优先，其次包含匹配；保持给定顺序以稳定参考图顺序） */
  private resolveCastByName(index: AssetIndex, names?: string[] | null): string[] {
    const ids: string[] = [];
    for (const raw of names ?? []) {
      const key = this.normalizeName(raw);
      if (!key) continue;
      const hit =
        index.characters.find((c) => this.normalizeName(c.name) === key) ??
        index.characters.find((c) => {
          const n = this.normalizeName(c.name);
          return n.length >= 2 && (key.includes(n) || n.includes(key));
        });
      if (hit && !ids.includes(hit.id)) ids.push(hit.id);
    }
    return ids;
  }

  /** 名称/编号列表 → 道具标签（优先用 PROP 编号，兼容 scenes.props 的字符串语义） */
  private resolvePropTags(index: AssetIndex, names?: string[] | null): string[] {
    const tags: string[] = [];
    for (const raw of names ?? []) {
      const key = this.normalizeName(raw);
      if (!key) continue;
      const hit =
        index.props.find((p) => {
          const code = this.normalizeName(p.code ?? '');
          return (code && (code === key || key.includes(code))) || this.normalizeName(p.name) === key;
        }) ??
        index.props.find((p) => {
          const n = this.normalizeName(p.name);
          return n.length >= 2 && (key.includes(n) || n.includes(key));
        });
      if (!hit) continue;
      const tag = (hit.code ?? '').trim() || hit.name;
      if (tag && !tags.includes(tag)) tags.push(tag);
    }
    return tags;
  }

  private uniqueIds(ids: string[]): string[] {
    return [...new Set(ids.filter(Boolean))];
  }

  /**
   * 从道具的状态变体里挑出本镜该用哪个 —— 判定逻辑在 shared 里，
   * 前端道具面板与首帧编排共用同一套规则，避免两边各判一套。
   */
  private matchPropVariant(
    variants: PropStateVariant[] | null | undefined,
    shotText: string,
  ): PropStateVariant | null {
    return matchPropVariantPure(variants, shotText);
  }

  /**
   * 从一段剧本文字里认出出场人物。
   * 这是「分镜绑资产」的第一步：旧实现给每场写死 `characterIds: []`，
   * 镜头和人物之间没有任何连线，首帧自然拿不到人物参考图。
   */
  private matchCastIds(index: Map<string, string>, texts: string[]): string[] {
    if (index.size === 0) return [];
    const haystack = texts.join('\n');
    const normalizedHay = this.normalizeName(haystack);
    const hits: { id: string; at: number }[] = [];
    for (const [name, id] of index) {
      if (!name) continue;
      // 原名直接出现，或归一化后包含（应对「林晚（女主）」「小林」这类写法）
      const at = haystack.includes(name) ? haystack.indexOf(name) : normalizedHay.indexOf(name);
      if (at < 0) continue;
      if (!hits.some((h) => h.id === id)) hits.push({ id, at });
    }
    // 按在文本中首次出现的位置排序，让参考图顺序与叙事顺序一致
    return hits.sort((a, b) => a.at - b.at).map((h) => h.id);
  }

  /**
   * 场标题/摘要 → locations.id。
   * 场景图是「同一空间跨镜不漂移」的唯一锚点，绑不上就等于没有场景一致性。
   * 三级宽松匹配：归一化精确 → 标题包含地点名（取最长）→ 地点名包含标题片段。
   */
  private async resolveSceneLocation(
    projectId: string,
    title: string | undefined,
    summary?: string,
    assetIndex?: AssetIndex,
  ): Promise<string | undefined> {
    const raw = [title ?? '', summary ?? ''].join(' ').trim();
    if (!raw) return undefined;
    // 分镜表明确写了地点名时先按它精确/包含匹配（比标题匹配可靠）
    if (assetIndex && summary) {
      const hint = this.normalizeName(summary);
      const direct = assetIndex.locations.find((l) => this.normalizeName(l.name) === hint);
      if (direct) return direct.id;
    }
    const rows = assetIndex?.locations.length
      ? assetIndex.locations
      : await this.db
          .select({ id: locations.id, name: locations.name })
          .from(locations)
          .where(eq(locations.projectId, projectId));
    if (rows.length === 0) return undefined;
    const t = this.normalizeName(raw);
    const exact = rows.find((r) => this.normalizeName(r.name) === t);
    if (exact) return exact.id;
    const contained = rows
      .filter((r) => {
        const n = this.normalizeName(r.name);
        return n.length >= 2 && t.includes(n);
      })
      .sort((a, b) => b.name.length - a.name.length);
    if (contained[0]) return contained[0].id;
    const reversed = rows
      .filter((r) => {
        const n = this.normalizeName(r.name);
        return n.length >= 2 && n.includes(t) && t.length >= 2;
      })
      .sort((a, b) => a.name.length - b.name.length);
    if (reversed[0]) return reversed[0].id;
    // 单场景项目兜底：剧本分析只识别出一个空间时，所有场都属于它
    if (rows.length === 1) return rows[0].id;
    return undefined;
  }

  /** 物化后统计「分镜真正挂上资产」的比例：给日志与 UI 一个可验证的连线证据 */
  private async countSceneBindings(
    projectId: string,
  ): Promise<{ withLocation: number; withCast: number }> {
    const rows = await this.db
      .select({ locationId: scenes.locationId, characterIds: scenes.characterIds })
      .from(scenes)
      .where(eq(scenes.projectId, projectId));
    return {
      withLocation: rows.filter((r) => Boolean(r.locationId)).length,
      withCast: rows.filter((r) => (r.characterIds ?? []).length > 0).length,
    };
  }

  // ========== 资产前置（asset-first）==========

  /**
   * `asset_prep`：把「人物 / 场景 / 道具必须先有定妆图」这条纪律落到流程里。
   *
   * 旧流程的断点：`script → parse_script` 之间什么都没有，`parse_script` 只用正则切场、
   * 一句台词一镜，从头到尾没有 characters / locations 的图 —— 所以每镜都是「凭文字
   * 重新想象一个人」，跨镜必然换脸换场景。三家的做法都是把资产阶段插进来并做成硬门。
   *
   * 这里的状态推进严格逐级：parsing → planning（清单与定妆规划）→ bible_ready（资产就绪）。
   * 旧代码在 parse_script 尾部明写「跳过 bible_ready」，正是流程错位的直接证据。
   */
  private async processAssetPrep(job: GenerationJob, providerName?: string): Promise<void> {
    if (!job.projectId) {
      await this.generationService.settleJobFailure(job.id, '资产前置任务缺少项目归属');
      return;
    }
    const projectId = job.projectId;
    const input = (job.inputData ?? {}) as Record<string, unknown>;
    const scriptText =
      (typeof input.prompt === 'string' && input.prompt.trim()) || this.inputPrompt(job);

    // 进入规划：资产清单与定妆计划在此阶段确定
    await this.advanceProjectStatus(projectId, 'parsing', 'planning');

    const prep = await this.assetPrep.prepareProjectAssets(projectId, { scriptText, providerName });
    if (prep.readiness.ready) {
      await this.advanceProjectStatus(projectId, 'planning', 'bible_ready');
    }

    // 链式物化：分镜必须建立在资产之上，所以资产未就绪时先挂 blockedReason，
    // 由 reconcileAssetGate 在定妆图到齐后解封 —— 绝不跳过资产直接拆分镜。
    //
    // 这里接的是 `boards`（LLM 分镜表）而不是 `parse_script`（正则一句台词一镜）：
    // 三家对标项目都是让模型按「场 → 片段 → 镜」做真正的分镜设计，我们旧流程
    // 用正则拆分是「前后不连贯」的第二大成因。boards 失败/空结果会自动降级到
    // parse_script，所以不会因为没配模型就把链走死。
    await this.db.insert(generationJobs).values({
      projectId,
      jobType: 'boards',
      targetType: 'project',
      targetId: projectId,
      status: 'pending',
      priority: 78,
      inputData: {
        scriptText,
        prompt: scriptText,
        ...(input.replaceExisting === true ? { replaceExisting: true } : {}),
        ...(typeof input.skillId === 'string' ? { skillId: input.skillId } : {}),
        ...(prep.readiness.ready ? {} : { blockedReason: 'waiting_assets' }),
      },
    });

    await this.generationService.settleJobSuccess(job.id, {
      assetReadiness: prep.readiness.summary,
      ready: prep.readiness.ready,
      readyCount: prep.readiness.readyCount,
      total: prep.readiness.total,
      blocking: prep.readiness.blockers.map((b) => `${b.name}:${b.missing.join('/')}`).slice(0, 12),
      bibleGenerated: prep.bibleGenerated,
      bibleSource: prep.bibleSource ?? null,
      enqueuedAssetJobs: prep.enqueued,
      ...(prep.note ? { note: prep.note } : {}),
    });
    this.logger.log(
      `资产前置完成 ${job.id}：${prep.readiness.summary}` +
        (prep.enqueued > 0 ? `，新排定妆图 ${prep.enqueued}` : '') +
        (prep.readiness.ready ? '，已接分镜物化' : '，分镜物化等待资产就绪'),
    );
  }

  /**
   * 资产门对账（每轮 tick）：
   * - 项目级（parse_script 被 blockedReason=waiting_assets 挂住）→ 资产就绪即解封并推进 bible_ready；
   * - 镜头级（首帧任务被挂住）→ 本镜引用的人物/场景都有图即解封。
   * 结构性问题（没有任何在途定妆任务、资产仍不全）不会无限等：重排两次后
   * 记 metadata.assetGate.degraded 放行，让 UI 明确显示「按文生图降级出片」。
   */
  private async reconcileAssetGate(): Promise<void> {
    const rows = await this.db
      .select({
        id: generationJobs.id,
        projectId: generationJobs.projectId,
        jobType: generationJobs.jobType,
        targetType: generationJobs.targetType,
        targetId: generationJobs.targetId,
        inputData: generationJobs.inputData,
      })
      .from(generationJobs)
      .where(
        and(
          eq(generationJobs.status, 'pending'),
          sql`${generationJobs.inputData} ->> 'blockedReason' = 'waiting_assets'`,
        ),
      )
      .orderBy(generationJobs.createdAt)
      .limit(40);

    for (const row of rows) {
      const input = (row.inputData ?? {}) as Record<string, unknown>;
      // eslint-disable-next-line no-await-in-loop
      const released = await this.assetGateSatisfied(row).catch((e: Error) => {
        this.logger.warn(`资产门判定失败 ${row.id}：${e.message}`);
        return null;
      });
      if (released === true) {
        // eslint-disable-next-line no-await-in-loop
        await this.clearFirstFrameBlock(row.id);
        if ((row.jobType === 'parse_script' || row.jobType === 'boards') && row.projectId) {
          // eslint-disable-next-line no-await-in-loop
          await this.advanceProjectStatus(row.projectId, 'planning', 'bible_ready');
        }
        this.logger.log(`资产门解封：任务 ${row.id}（${row.jobType}）`);
        continue;
      }
      if (released === null) continue;

      // 仍未就绪：区分「在等图」与「等不到图」
      if (!row.projectId) continue;
      // eslint-disable-next-line no-await-in-loop
      const inflight = await this.countInflightAssetJobs(row.projectId);
      if (inflight > 0) continue;

      const attempts = typeof input.assetGateAttempts === 'number' ? input.assetGateAttempts : 0;
      if (attempts < 2 && (row.jobType === 'parse_script' || row.jobType === 'boards')) {
        // 定妆任务已经跑完但资产仍不全（多为图片任务失败）→ 重排一次，最多两次
        const scriptText =
          (typeof input.prompt === 'string' && input.prompt) ||
          (typeof input.scriptText === 'string' ? input.scriptText : '');
        // eslint-disable-next-line no-await-in-loop
        const prep = await this.assetPrep
          .prepareProjectAssets(row.projectId, { scriptText })
          .catch(() => null);
        // eslint-disable-next-line no-await-in-loop
        await this.db
          .update(generationJobs)
          .set({
            inputData: sql`jsonb_set(coalesce(${generationJobs.inputData}, '{}'::jsonb), '{assetGateAttempts}', to_jsonb(${attempts + 1}::int), true)`,
            updatedAt: new Date(),
          })
          .where(eq(generationJobs.id, row.id));
        this.logger.warn(
          `资产门未通过（第 ${attempts + 1} 次重排）：任务 ${row.id} ${prep?.readiness.summary ?? ''}`,
        );
        continue;
      }

      // 结构性失败：放行但明确降级，不假装资产齐全
      // eslint-disable-next-line no-await-in-loop
      await this.clearFirstFrameBlock(row.id);
      // eslint-disable-next-line no-await-in-loop
      await this.markAssetGateDegraded(row.projectId, row.id);
      this.logger.warn(
        `资产门降级放行：项目 ${row.projectId} 任务 ${row.id}，资产仍不齐全，已按文生图降级出片`,
      );
    }
  }

  /** 资产门是否已满足：项目级看整体就绪度，镜头级只看本镜引用的人物/场景 */
  private async assetGateSatisfied(row: {
    jobType: string;
    targetType: string | null;
    targetId: string | null;
    projectId: string | null;
  }): Promise<boolean | null> {
    if (!row.projectId) return null;
    // 项目级物化任务（LLM 分镜表 / 启发式物化）都看整体就绪度
    if (row.jobType === 'parse_script' || row.jobType === 'boards') {
      const readiness = await this.assetPrep.readinessOf(row.projectId);
      return readiness.ready;
    }
    if (row.jobType === 'image' && row.targetType === 'shot' && row.targetId) {
      const refs = await this.loadShotAssetRefs(row.targetId);
      if (!refs) return null;
      const missing = await this.assetPrep.missingAssetsForShot(row.projectId, refs);
      return missing.length === 0;
    }
    // 其他类型没有资产依赖，直接放行，避免误挂住整条链
    return true;
  }

  /** 本镜引用的人物 id 与场景 locationId（资产门判定用） */
  private async loadShotAssetRefs(
    shotId: string,
  ): Promise<{ characterIds: string[]; locationId: string | null } | null> {
    const rows = await this.db
      .select({ characterIds: shots.characterIds, sceneId: shots.sceneId })
      .from(shots)
      .where(eq(shots.id, shotId))
      .limit(1);
    if (rows.length === 0) return null;
    const sceneId = rows[0].sceneId;
    let locationId: string | null = null;
    if (sceneId) {
      const sceneRows = await this.db
        .select({ locationId: scenes.locationId })
        .from(scenes)
        .where(eq(scenes.id, sceneId))
        .limit(1);
      locationId = sceneRows[0]?.locationId ?? null;
    }
    return { characterIds: rows[0].characterIds ?? [], locationId };
  }

  private async countInflightAssetJobs(projectId: string): Promise<number> {
    const rows = await this.db
      .select({ id: generationJobs.id })
      .from(generationJobs)
      .where(
        and(
          eq(generationJobs.projectId, projectId),
          eq(generationJobs.jobType, 'image'),
          inArray(generationJobs.status, ['pending', 'queued', 'running', 'retrying']),
          inArray(generationJobs.targetType, ['character', 'location', 'prop']),
        ),
      )
      .limit(50);
    return rows.length;
  }

  /** 降级标记写进 project.metadata.assetGate，UI 据此显示「资产未就绪 · 已降级」 */
  private async markAssetGateDegraded(projectId: string, jobId: string): Promise<void> {
    const rows = await this.db
      .select({ metadata: projects.metadata })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    if (rows.length === 0) return;
    const meta = (rows[0].metadata ?? {}) as Record<string, unknown>;
    const next = {
      ...meta,
      assetGate: {
        degraded: true,
        reason: '定妆图未能生成，已按文生图降级出片（跨镜一致性无法保证）',
        jobId,
        at: new Date().toISOString(),
      },
    };
    await this.db
      .update(projects)
      .set({ metadata: next, updatedAt: new Date() })
      .where(eq(projects.id, projectId));
  }

  private async processParseScript(job: GenerationJob): Promise<void> {
    if (!job.projectId) {
      await this.generationService.settleJobFailure(job.id, '解析任务缺少项目归属');
      return;
    }
    const scriptText = this.inputPrompt(job);
    if (!scriptText.trim()) {
      await this.generationService.settleJobFailure(job.id, '剧本内容为空');
      return;
    }

    // 技能链式物化：改写类任务先清空旧分镜，避免新旧堆积
    const replaceExisting =
      ((job.inputData ?? {}) as Record<string, unknown>).replaceExisting === true;
    if (replaceExisting && job.projectId) {
      await this.db.delete(segments).where(eq(segments.projectId, job.projectId));
      await this.db.delete(shots).where(eq(shots.projectId, job.projectId));
      await this.db.delete(scenes).where(eq(scenes.projectId, job.projectId));
      this.logger.log(`物化前已清空旧分镜（技能链 ${job.id}）`);
    }

    // P1 专业模式透传消费：目标总镜头数/单镜时长/景别/运镜/字幕开关来自 project.metadata；
    // 缺省时按片长估算（总时长/8s），与极速模式行为一致
    const projectRows = await this.db
      .select({
        durationSeconds: projects.durationSeconds,
        metadata: projects.metadata,
      })
      .from(projects)
      .where(eq(projects.id, job.projectId))
      .limit(1);
    const prefs = this.normalizePrefs(
      ((projectRows[0]?.metadata ?? {}) as { professional?: ProfessionalPrefs })
        .professional,
    );
    const totalDuration = projectRows[0]?.durationSeconds ?? 90;
    const targetShots =
      prefs.shotCount ??
      Math.max(4, Math.min(60, Math.round(totalDuration / prefs.shotDuration)));

    // 分镜必须建在资产之上：人物名 → characters.id、场标题 → locations.id、道具 → PROP 编号。
    // 旧实现给每场写死 characterIds: []，镜头与资产零连线，首帧必然拿不到参考图。
    const assetIndex = await this.loadAssetIndex(job.projectId);
    const cast = new Map(assetIndex.characters.map((c) => [this.normalizeName(c.name), c.id]));

    const blocks = this.splitScenes(scriptText);
    const perSceneTarget = Math.max(
      1,
      Math.min(6, Math.ceil(targetShots / Math.max(1, blocks.length))),
    );
    let shotTotal = 0;
    let segmentTotal = 0;
    const imageTargets: { shotId: string; prompt: string }[] = [];
    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      const blockCast = this.matchCastIds(cast, [
        block.title,
        block.summary,
        ...block.dialogues.map((d) => `${d.character}：${d.text ?? ''}`),
      ]);
      const locationId = await this.resolveSceneLocation(
        job.projectId,
        block.title,
        block.summary,
        assetIndex,
      );
      const sceneProps = await this.scenePropsFor(
        job.projectId,
        [block.title, block.summary, ...block.dialogues.map((d) => d.text ?? '')].join('\n'),
      );
      const [scene] = await this.db
        .insert(scenes)
        .values({
          projectId: job.projectId,
          sceneNumber: i + 1,
          title: block.title,
          summary: block.summary,
          dialogues: block.dialogues,
          actions: [],
          characterIds: blockCast,
          locationId,
          props: sceneProps,
          sortOrder: i + 1,
        })
        .returning({ id: scenes.id });

      const shotsToInsert = this.buildShots(block, prefs, perSceneTarget);
      /*
       * 确定性拆分没有片段概念，但下游（段内镜像链、轴线校验、视频续接）
       * 全都以片段为落点。这里按「≤15 秒、2-4 镜」自动归段，
       * 让启发式路径与 LLM 路径共用同一套三级结构，而不是长期两套数据。
       */
      const pieces = planPieces(
        shotsToInsert.map((s, j) => ({
          ...s,
          shotNumber: j + 1,
          duration: prefs.shotDuration,
        })),
      );
      for (const piece of pieces) {
        const head = piece.shots[0];
        segmentTotal += 1;
        // eslint-disable-next-line no-await-in-loop
        const [segment] = await this.db
          .insert(segments)
          .values({
            projectId: job.projectId,
            sceneId: scene.id,
            segmentNumber: piece.segmentNumber,
            // 标题取首镜画面描述前 12 字，比「片段 1」可读；无描述时才用序号兜底
            title: (head.visualPrompt ?? '').trim().slice(0, 12) || `第 ${piece.segmentNumber} 组`,
            summary: head.visualPrompt?.slice(0, 300),
            // 每场第一段承担定场功能，其余是推进；启发式不做更细的判断，不自称 turn/payoff
            intent: i === 0 && piece.segmentNumber === 1 ? 'establish' : 'develop',
            characterIds: blockCast,
            locationId: locationId ?? null,
            // 道具挂在首段：同场道具不变，段级重复挂会让参考图重复占名额
            props: piece.segmentNumber === 1 ? sceneProps : [],
            durationSeconds: piece.durationSeconds.toFixed(1),
            // 片段序号同样要全局递增，否则跨场重复
            sortOrder: segmentTotal,
          })
          .returning({ id: segments.id });

        for (const s of piece.shots) {
          shotTotal += 1;
          // 对白镜只锁说话者（避免把无关角色塞进参考图稀释权重），无人对白则带全场 cast
          const speakerId = s.speaker
            ? [...cast.entries()].find(([name]) => this.normalizeName(s.speaker ?? '') === name)?.[1]
            : undefined;
          const shotCast = speakerId ? [speakerId] : blockCast.slice(0, 2);
          // eslint-disable-next-line no-await-in-loop
          const [inserted] = await this.db
            .insert(shots)
            .values({
              projectId: job.projectId,
              sceneId: scene.id,
              segmentId: segment.id,
              shotNumber: shotTotal,
              duration: prefs.shotDuration.toFixed(1),
              shotSize: s.shotSize,
              cameraAngle: 'eye_level',
              lens: '50mm',
              movement: s.movement,
              beats: deriveBeats({
                duration: prefs.shotDuration,
                dialogue: s.dialogue,
                visualPrompt: s.visualPrompt,
                shotSize: s.shotSize,
              }),
              dialogue: s.dialogue,
              subtitleText: prefs.subtitleEnabled ? s.dialogue : undefined,
              visualPrompt: s.visualPrompt,
              subject: s.visualPrompt?.slice(0, 200),
              characterIds: shotCast,
              status: 'draft',
              // 全局序号：启发式物化这条链同样不能写场内镜号
              sortOrder: shotTotal,
            })
            .returning({ id: shots.id });
          imageTargets.push({
            shotId: inserted.id,
            prompt: s.visualPrompt || s.dialogue || '全景 establishing shot',
          });
        }
      }
    }

    // 门2 分镜确认：未过门不自动建首帧任务（分镜保持 draft，等 POST /approve(stage=storyboard)）；
    // 已过门（或任务显式带 autoSubmit，兼容既有调用方）则照旧批量建图
    const approvals = await this.pipelineApprovals(job.projectId);
    const autoSubmit =
      Boolean(approvals.storyboard) ||
      ((job.inputData ?? {}) as Record<string, unknown>).autoSubmit === true;
    if (job.projectId && imageTargets.length > 0 && autoSubmit) {
      await this.db.insert(generationJobs).values(
        imageTargets.map((t, i) => ({
          projectId: job.projectId as string,
          jobType: 'image' as const,
          targetType: 'shot' as const,
          targetId: t.shotId,
          status: 'pending' as const,
          priority: 65 - Math.min(30, i),
          inputData: { prompt: t.prompt },
        })),
      );
      this.logger.log(`物化后已创建 ${imageTargets.length} 个首帧任务`);
    } else if (imageTargets.length > 0) {
      this.logger.log(`分镜已物化，等待分镜确认门（项目 ${job.projectId}）：确认后自动批量生成`);
    }

    // 状态推进严格逐级：planning → bible_ready → storyboard_ready。
    // 旧实现在这里明写「跳过 bible_ready」，于是项目从未真正进入过资产阶段，
    // 这就是「人物一栏永远是空的、每镜都换脸」的流程级根因。
    await this.advanceProjectStatus(job.projectId, 'parsing', 'planning');
    // 能跑到这里说明资产门已放行（正常就绪，或 reconcileAssetGate 判定结构性失败后
    // 降级放行并在 metadata.assetGate 记了 degraded）。状态机只有一个资产态，
    // 卡在 planning 会让整条链无出口，所以照样推进，但把真实就绪度写进任务产物。
    const assetReadiness = await this.assetPrep.readinessOf(job.projectId);
    await this.advanceProjectStatus(job.projectId, 'planning', 'bible_ready');
    await this.advanceProjectStatus(job.projectId, 'bible_ready', 'storyboard_ready');
    if (autoSubmit && imageTargets.length > 0) {
      await this.advanceProjectStatus(job.projectId, 'storyboard_ready', 'assets_generating');
    }

    const bindings = await this.countSceneBindings(job.projectId);
    await this.generationService.settleJobSuccess(job.id, {
      scenesCount: blocks.length,
      segmentsCount: segmentTotal,
      shotsCount: shotTotal,
      voicePreset: prefs.voicePreset,
      imageJobs: imageTargets.length,
      assetReadiness: assetReadiness.summary,
      assetReady: assetReadiness.ready,
      scenesWithLocation: bindings.withLocation,
      scenesWithCast: bindings.withCast,
    });
    if (!assetReadiness.ready) {
      this.logger.warn(
        `剧本物化完成但资产未就绪（${assetReadiness.summary}）：项目 ${job.projectId} 按降级模式继续`,
      );
    }
    this.logger.log(
      `剧本物化完成 ${job.id}：${blocks.length} 场 ${segmentTotal} 片段 ${shotTotal} 镜，首帧任务 ${imageTargets.length}`,
    );
  }

  /** 专业参数收敛：非法值回落默认，保证物化永不崩 */
  private normalizePrefs(raw?: ProfessionalPrefs): {
    shotCount?: number;
    shotDuration: number;
    shotSizePref: string;
    movement: string;
    voicePreset?: string;
    subtitleEnabled: boolean;
  } {
    const shotDuration =
      typeof raw?.shotDuration === 'number' &&
      raw.shotDuration >= 1 &&
      raw.shotDuration <= 30
        ? raw.shotDuration
        : 8;
    const shotCount =
      typeof raw?.shotCount === 'number'
        ? Math.max(1, Math.min(120, Math.floor(raw.shotCount)))
        : undefined;
    const shotSizePref = ['mixed', 'closeup', 'wide'].includes(
      raw?.shotSizePref ?? '',
    )
      ? (raw?.shotSizePref as string)
      : 'mixed';
    const movement =
      raw?.cameraStyle === 'static'
        ? 'static'
        : raw?.cameraStyle === 'cinematic'
          ? 'dolly'
          : raw?.cameraStyle === 'dynamic'
            ? 'pan'
            : 'static';
    return {
      shotCount,
      shotDuration,
      shotSizePref,
      movement,
      voicePreset:
        typeof raw?.voicePreset === 'string' ? raw.voicePreset : undefined,
      subtitleEnabled: raw?.subtitleEnabled !== false,
    };
  }

  private splitScenes(scriptText: string): {
    title: string;
    summary: string;
    dialogues: { character: string; text: string; emotion: string }[];
  }[] {
    const lines = scriptText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    const blocks: { title?: string; lines: string[] }[] = [];
    let current: { title?: string; lines: string[] } = { lines: [] };
    // P1 修复：场标题允许带后缀（如“第一场 雨夜·外”），前缀匹配即可；
    // 旧正则要求行尾恰为场/集/幕，导致带后缀标题被当成正文。
    // 双模式扩展：广告技能输出“第X镜”标题，同样视为切分点（不影响旧文本）。
    const headingRe = /^(第.{1,6}[场集幕镜]|#{1,3}\s*.+|SCENE\s*\d+)/i;

    for (const line of lines) {
      if (headingRe.test(line) && current.lines.length > 0) {
        blocks.push(current);
        current = { title: line.replace(/^#{1,3}\s*/, ''), lines: [] };
      } else if (headingRe.test(line) && current.lines.length === 0) {
        current.title = line.replace(/^#{1,3}\s*/, '');
      } else {
        current.lines.push(line);
      }
    }
    if (current.lines.length > 0 || current.title) blocks.push(current);

    // 无标题时按 12 行一 chunk 切分，兜底 1 场
    let list = blocks.filter((b) => b.lines.length > 0);
    if (list.length === 0) list = [{ lines }];
    if (list.length === 1 && !list[0].title && list[0].lines.length > 12) {
      const chunked: typeof list = [];
      for (let i = 0; i < list[0].lines.length; i += 12) {
        chunked.push({ lines: list[0].lines.slice(i, i + 12) });
      }
      list = chunked;
    }
    list = list.slice(0, 12);

    return list.map((b, i) => {
      const dialogues: { character: string; text: string; emotion: string }[] = [];
      for (const line of b.lines) {
        // “角色：台词” / '角色:台词' / “台词” 三种常见写法
        const labeled = line.match(/^(.{1,12})[:：]\s*(.+)$/);
        const quoted = line.match(/^[“"]([^”"]+)[”"]$/);
        if (labeled && dialogues.length < 20) {
          dialogues.push({ character: labeled[1], text: labeled[2], emotion: '' });
        } else if (quoted && dialogues.length < 20) {
          dialogues.push({ character: '旁白', text: quoted[1], emotion: '' });
        }
      }
      return {
        title: b.title ?? `第 ${i + 1} 场`,
        summary: b.lines.slice(0, 3).join(' ').slice(0, 200),
        dialogues,
      };
    });
  }

  private buildShots(
    block: {
      summary: string;
      dialogues: { character: string; text: string }[];
    },
    prefs: { shotSizePref: string; movement: string },
    perSceneTarget: number,
  ): { shotSize: string; movement: string; dialogue?: string; speaker?: string; visualPrompt: string }[] {
    // 景别偏好：wide 全全景 / closeup 全特写 / mixed 默认（1 全景 + 对白特写）
    if (prefs.shotSizePref === 'wide') {
      return [
        {
          shotSize: 'wide',
          movement: prefs.movement,
          visualPrompt: block.summary || '全景 establishing shot',
        },
      ];
    }
    const result: {
      shotSize: string;
      movement: string;
      dialogue?: string;
      speaker?: string;
      visualPrompt: string;
    }[] = [];
    if (prefs.shotSizePref === 'mixed') {
      result.push({
        shotSize: 'wide',
        movement: prefs.movement,
        visualPrompt: block.summary || '全景 establishing shot',
      });
    }
    const dialogueShots = Math.max(
      0,
      Math.min(block.dialogues.length, perSceneTarget - result.length),
    );
    for (const d of block.dialogues.slice(0, dialogueShots)) {
      result.push({
        shotSize: 'closeup',
        movement: prefs.movement,
        dialogue: `${d.character}：${d.text}`,
        // speaker 用于把镜头绑到唯一人物：对白镜只锁说话者，参考图权重才不会被稀释
        speaker: d.character,
        visualPrompt: `${d.character}特写，${d.text.slice(0, 60)}`,
      });
    }
    // 保底 1 镜，避免空场
    if (result.length === 0) {
      result.push({
        shotSize: 'wide',
        movement: prefs.movement,
        visualPrompt: block.summary || '全景 establishing shot',
      });
    }
    return result;
  }

  private async advanceProjectStatus(
    projectId: string,
    from: string,
    to: string,
  ): Promise<void> {
    const rows = await this.db
      .select({ status: projects.status })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    if (rows.length === 0 || rows[0].status !== from) return;
    await this.db
      .update(projects)
      .set({ status: to, updatedAt: new Date() })
      .where(eq(projects.id, projectId));
  }

  // ========== 目标回写 ==========

  private async writebackToTarget(
    job: GenerationJob,
    urls: { imageUrl?: string; videoUrl?: string; voiceUrl?: string },
  ): Promise<void> {
    if (!job.targetId) return;
    const projectGuard = job.projectId
      ? { projectId: job.projectId }
      : undefined;
    // 本次产物是否来自 mock 演练通道：归档时打标，资产库/分镜页据此显示「演示」而非当真片
    const mock = await this.generationService.isMockJob(job);

    if (job.targetType === 'shot') {
      const patch: Record<string, unknown> = { updatedAt: new Date() };
      if (urls.imageUrl) patch.startFrameUrl = urls.imageUrl;
      if (urls.voiceUrl) patch.voiceUrl = urls.voiceUrl;
      // F7 变体谱系：变体任务成功不覆盖主成片（候选由 adopt 接口显式采纳），
      // 避免后完成的变体把主视频洗掉；变体输出保留在各自任务 outputData。
      const input = (job.inputData ?? {}) as Record<string, unknown>;
      if (urls.videoUrl && typeof input.variantGroup !== 'string') {
        patch.videoUrl = urls.videoUrl;
      }
      // V5 每镜状态机：有画面产出回写 → ready（变体不改主状态，由采纳时刷新）。
      // 修复：旧逻辑只数 patch 键数，配音任务也会把镜头标 ready；
      // 现在 ready 仅由图/视频回写触发，纯配音回写不改状态。
      if (
        typeof input.variantGroup !== 'string' &&
        (urls.imageUrl || urls.videoUrl)
      ) {
        patch.status = 'ready';
      } else if (typeof input.variantGroup !== 'string' && urls.voiceUrl) {
        // 配音回写：任务开跑时镜头被置 generating，成片已在（视频早于配音完成）时
        // 必须恢复 ready，否则镜头永久卡在 generating（状态机卡死修复）
        const shotRows = await this.db
          .select({ videoUrl: shots.videoUrl })
          .from(shots)
          .where(eq(shots.id, job.targetId))
          .limit(1);
        if (shotRows[0]?.videoUrl) patch.status = 'ready';
      }
      if (Object.keys(patch).length <= 1) return;
      const conditions = [eq(shots.id, job.targetId)];
      if (projectGuard) conditions.push(eq(shots.projectId, projectGuard.projectId));
      await this.db
        .update(shots)
        .set(patch)
        .where(and(...conditions));
      // 首帧回写成功：解除同镜视频的首帧阻断，并把依赖指向本次成功任务。
      // 少了这步，用户重试首帧成功后视频仍会因旧依赖任务失败而永久卡住。
      if (urls.imageUrl) await this.unblockVideosForShot(job, job.id);
      // 项目资产归档：生成的图/视频/配音同步登记 assets，「项目资产」页可见
      await this.archiveOutputAssets(job, urls, { mock });
      return;
    }

    const input = (job.inputData ?? {}) as Record<string, unknown>;

    // 人物形象包：kitView 指定这一张是主图还是某个视角，分别写入 identity_kit，
    // 不再把所有视角混进 reference_image_urls（网关只会吃到第一张）。
    const kitView = typeof input.kitView === 'string' ? input.kitView : '';
    if (job.targetType === 'character' && urls.imageUrl && kitView) {
      const rows = await this.db
        .select({
          projectId: characters.projectId,
          identityKit: characters.identityKit,
          referenceImageUrls: characters.referenceImageUrls,
        })
        .from(characters)
        .where(eq(characters.id, job.targetId))
        .limit(1);
      if (rows.length === 0) return;
      if (projectGuard && rows[0].projectId !== projectGuard.projectId) return;
      const kit: CharacterIdentityKit = {
        ...((rows[0].identityKit as CharacterIdentityKit | null) ?? { views: {} }),
      };
      kit.views = { ...(kit.views ?? {}) };
      if (kitView === 'portrait') kit.portraitUrl = urls.imageUrl;
      else if (kitView === 'front' || kitView === 'threeQuarter' || kitView === 'side' || kitView === 'back') {
        kit.views[kitView] = urls.imageUrl;
      }
      kit.updatedAt = new Date().toISOString();
      // 主图同时作为首帧注入的权威参考图，保持旧链路的一致性保障
      const existing = (rows[0].referenceImageUrls ?? []) as string[];
      const refPatch = kit.portraitUrl
        ? { referenceImageUrls: [kit.portraitUrl, ...existing.filter((u) => u !== kit.portraitUrl)].slice(0, 6) }
        : {};
      await this.db
        .update(characters)
        .set({ identityKit: kit, ...refPatch, updatedAt: new Date() })
        .where(eq(characters.id, job.targetId));
      await this.archiveOutputAssets(job, urls, { mock });
      return;
    }

    // 道具设定图：与人物/场景同构，回写 props.reference_image_urls
    if (job.targetType === 'prop' && urls.imageUrl) {
      const rows = await this.db
        .select({ projectId: props.projectId, referenceImageUrls: props.referenceImageUrls })
        .from(props)
        .where(eq(props.id, job.targetId))
        .limit(1);
      if (rows.length === 0) return;
      if (projectGuard && rows[0].projectId !== projectGuard.projectId) return;
      const existing = (rows[0].referenceImageUrls ?? []) as string[];
      const next = [urls.imageUrl, ...existing.filter((u) => u !== urls.imageUrl)].slice(0, 6);
      await this.db
        .update(props)
        .set({ referenceImageUrls: next, updatedAt: new Date() })
        .where(eq(props.id, job.targetId));
      await this.archiveOutputAssets(job, urls, { mock });
      return;
    }

    // 角色/场景：图片追加为参考图；V1 四视图定妆照（sheet 标记）插到首位当权威参考
    if ((job.targetType === 'character' || job.targetType === 'location') && urls.imageUrl) {
      const table = job.targetType === 'character' ? characters : locations;
      const rows = await this.db.select().from(table).where(eq(table.id, job.targetId)).limit(1);
      if (rows.length === 0) return;
      if (projectGuard && rows[0].projectId !== projectGuard.projectId) return;
      const existing = (rows[0].referenceImageUrls ?? []) as string[];
      const next = input.sheet === true
        ? [urls.imageUrl, ...existing.filter((u) => u !== urls.imageUrl)]
        : [...existing, urls.imageUrl];
      // 旧「整张四视图拼图」链路：登记为 identity_kit.sheetUrl，
      // 让 UI 能区分「拼图」与「四张独立视图」，不冒充已完成定义。
      const kitPatch: Record<string, unknown> = {};
      if (job.targetType === 'character' && input.sheet === true) {
        const curKit = (rows[0] as { identityKit?: CharacterIdentityKit | null }).identityKit;
        kitPatch.identityKit = {
          ...(curKit ?? { views: {} }),
          views: { ...(curKit?.views ?? {}) },
          sheetUrl: urls.imageUrl,
          updatedAt: new Date().toISOString(),
        };
      }
      await this.db
        .update(table)
        .set({
          referenceImageUrls: next,
          ...kitPatch,
          updatedAt: new Date(),
        })
        .where(eq(table.id, job.targetId));
      await this.archiveOutputAssets(job, urls, { mock });
    }
  }

  /**
   * 项目资产归档：镜头产出（首帧图/成片/配音）写入 assets，
   * 「项目资产」页（listByProject）直接可见。sourceId=job.id 幂等去重。
   * opts.mock：该产物来自演练通道时为 true —— 写 metadata.mock 打标，
   * 资产库与分镜页据此显示「演示」，避免占位内容被当成真片。
   */
  private async archiveOutputAssets(
    job: GenerationJob,
    urls: { imageUrl?: string; videoUrl?: string; voiceUrl?: string },
    opts?: { mock?: boolean },
  ): Promise<void> {
    if (!job.projectId) return;
    const input = (job.inputData ?? {}) as Record<string, unknown>;
    const prompt = typeof input.prompt === 'string' ? input.prompt : '';
    const entries: { assetType: string; url: string; mime: string; name: string }[] = [];
    if (urls.videoUrl && !urls.videoUrl.startsWith('data:')) {
      entries.push({ assetType: 'video', url: urls.videoUrl, mime: 'video/mp4', name: '成片' });
    }
    // data:（b64 兜底）也要归档，archiveLocalFile 负责解码落盘
    if (urls.imageUrl) {
      // 命名按产物归属：人物定妆照 / 场景概念图 / 镜头首帧，
      // 旧实现一律叫「首帧」，资产库里分不清是哪个人物或场景。
      let name = '首帧';
      if (job.targetType === 'character' && job.targetId) {
        const row = await this.db
          .select({ name: characters.name })
          .from(characters)
          .where(eq(characters.id, job.targetId))
          .limit(1);
        const who = row[0]?.name ?? '人物';
        const kitView = typeof input.kitView === 'string' ? input.kitView : '';
        const kitLabels: Record<string, string> = {
          portrait: '主图·正脸特写', front: '正面视图',
          threeQuarter: '3/4 侧视图', side: '侧面视图', back: '背面视图',
        };
        name = kitView && kitLabels[kitView]
          ? `${who}-${kitLabels[kitView]}`
          : input.sheet === true ? `${who}-四视图定妆照` : `${who}-人物参考图`;
      } else if (job.targetType === 'location' && job.targetId) {
        const row = await this.db
          .select({ name: locations.name })
          .from(locations)
          .where(eq(locations.id, job.targetId))
          .limit(1);
        name = `${row[0]?.name ?? '场景'}-场景概念图`;
      } else if (job.targetType === 'prop' && job.targetId) {
        const row = await this.db
          .select({ name: props.name, code: props.code })
          .from(props)
          .where(eq(props.id, job.targetId))
          .limit(1);
        name = `${row[0]?.code ? `${row[0].code} ` : ''}${row[0]?.name ?? '道具'}-道具设定图`;
      }
      entries.push({ assetType: 'image', url: urls.imageUrl, mime: 'image/png', name });
    }
    if (urls.voiceUrl && !urls.voiceUrl.startsWith('data:')) {
      entries.push({ assetType: 'audio', url: urls.voiceUrl, mime: 'audio/mpeg', name: '配音' });
    }
    if (entries.length === 0) return;

    let shotLabel = '';
    let shotId: string | undefined;
    if (job.targetType === 'shot' && job.targetId) {
      shotId = job.targetId;
      const shotRows = await this.db
        .select({ shotNumber: shots.shotNumber, duration: shots.duration })
        .from(shots)
        .where(eq(shots.id, job.targetId))
        .limit(1);
      if (shotRows[0]) {
        shotLabel = `镜${shotRows[0].shotNumber}-`;
        for (const e of entries) {
          if (e.assetType === 'video' && shotRows[0].duration) {
            e.name = `${e.name}-${shotLabel}${shotRows[0].duration}s`;
          } else {
            e.name = `${e.name}-${shotLabel}${e.assetType === 'video' ? '视频' : e.assetType === 'image' ? '图' : '音频'}`;
          }
        }
      }
    }

    for (const e of entries) {
      try {
        const existing = await this.db
          .select({ id: assets.id })
          .from(assets)
          .where(and(eq(assets.sourceId, job.id), eq(assets.assetType, e.assetType)))
          .limit(1);
        if (existing.length > 0) continue;
        // 优先落盘本地：远程 CDN（.cn）不稳定，资产库必须能直接打开
        const local = await this.archiveLocalFile(job.projectId, e.url, e.assetType, e.mime);
        // data: 未落盘时不入库（浏览器也打不开无路径的 data 行）；http 回退远程
        if (e.url.startsWith('data:') && !local) continue;

        // 镜头产物的版本链：同一镜同一类型多次生成，用稳定 sourceId 归组，
        // 新版本 parentAssetId 指向上一版本、version 递增，供「历史版本/回退」使用。
        let version = 1;
        let parentAssetId: string | undefined;
        let stableSourceId = job.id;
        if (shotId) {
          stableSourceId = `shot:${shotId}:${e.assetType}`;
          const chain = await this.db
            .select({ id: assets.id, version: assets.version })
            .from(assets)
            .where(
              and(
                eq(assets.sourceId, stableSourceId),
                eq(assets.assetType, e.assetType),
              ),
            )
            .orderBy(desc(assets.version))
            .limit(1);
          if (chain.length > 0) {
            parentAssetId = chain[0].id;
            version = (chain[0].version ?? 1) + 1;
          }
        }

        await this.db.insert(assets).values({
          projectId: job.projectId,
          assetType: e.assetType,
          // 名称前缀是资产库最直观的兜底标识（列表卡片即使不认 metadata 也不会误读成真片）
          name: `${opts?.mock ? '[演示] ' : ''}${e.name}`.slice(0, 120),
          fileUrl: local?.fileUrl ?? e.url,
          filePath: local?.filePath,
          fileSize: local?.fileSize,
          mimeType: e.mime,
          sourceType: 'generated',
          sourceId: stableSourceId,
          generationPrompt: prompt.slice(0, 2000) || undefined,
          version,
          parentAssetId,
          status: 'ready',
          ...(opts?.mock ? { metadata: { mock: true } } : {}),
        });
      } catch (err) {
        this.logger.warn(`资产归档失败 job=${job.id} type=${e.assetType}: ${(err as Error).message}`);
      }
    }
  }

  /** data:/远程 → 稳定本地 /uploads/ 路径；失败原样返回 http(s)。 */
  private async ensureLocalUrl(
    projectId: string | null,
    url: string,
    assetType: 'image' | 'video' | 'audio' = 'image',
  ): Promise<string> {
    if (!projectId || url.startsWith('/uploads/')) return url;
    if (!url.startsWith('data:') && !url.startsWith('http')) return url;
    // 修复（扩展名错配）：旧实现对所有 URL 硬传 'image' / 'image/png'，
    // 于是归档出来的视频会带 .png 名字 —— archiveLocalFile 的 ext 由入参 mime 猜，
    // 而不是由实际内容决定，资产库里点开就是个打不开的文件。
    // 现在由调用方声明真实类型；data: URL 仍优先用它自带的 MIME。
    const fallbackMime =
      assetType === 'video'
        ? 'video/mp4'
        : assetType === 'audio'
          ? 'audio/mpeg'
          : 'image/png';
    const local = await this.archiveLocalFile(
      projectId,
      url,
      assetType,
      url.startsWith('data:') ? (url.slice(5, url.indexOf(';')) || fallbackMime) : fallbackMime,
    );
    return local?.fileUrl ?? url;
  }

  /**
   * 把远程产出拉到 data/uploads/<projectId>/ 并返回本地 fileUrl。
   * data: base64 直接解码写入。失败则返回 null（调用方回退远程 URL）。
   */
  private async archiveLocalFile(
    projectId: string,
    remoteUrl: string,
    assetType: string,
    mime: string,
  ): Promise<{ fileUrl: string; filePath: string; fileSize: number } | null> {
    if (!remoteUrl) return null;
    if (remoteUrl.startsWith('/uploads/')) {
      return { fileUrl: remoteUrl, filePath: '', fileSize: 0 };
    }
    try {
      const dir = join(uploadDir(), projectId);
      await mkdir(dir, { recursive: true });
      const ext = mime.includes('png') ? 'png' : mime.includes('jpeg') || mime.includes('jpg') ? 'jpg' : mime.includes('webp') ? 'webp' : mime.includes('gif') ? 'gif' : mime.includes('mp4') || mime.includes('video') ? 'mp4' : assetType === 'video' ? 'mp4' : assetType === 'image' ? 'png' : 'bin';
      const name = `${assetType}_${randomUUID().slice(0, 8)}.${ext}`;
      const dest = join(dir, name);
      if (remoteUrl.startsWith('data:')) {
        const comma = remoteUrl.indexOf(',');
        if (comma < 0) return null;
        const b64 = remoteUrl.slice(comma + 1);
        const buf = Buffer.from(b64, 'base64');
        if (buf.length < 64) return null;
        await writeFile(dest, buf);
        return { fileUrl: `/uploads/${projectId}/${name}`, filePath: dest, fileSize: buf.length };
      }
      // 修复（死代码）：删除原本的
      // `if (remoteUrl.startsWith('data:') || remoteUrl.startsWith('/uploads/')) return null;`
      // —— data: 已在上面分支处理并 return，/uploads/ 在方法开头就已 return，
      // 这一行永远不可能为真，只会误导读者以为还存在第三种情况。
      const ok = await this.curlTo(remoteUrl, dest, 90_000, 4);
      if (!ok) return null;
      const st = await stat(dest).catch(() => null);
      if (!st || st.size < 64) return null;
      return { fileUrl: `/uploads/${projectId}/${name}`, filePath: dest, fileSize: st.size };
    } catch (err) {
      this.logger.warn(`本地归档失败 ${remoteUrl.slice(0, 80)}: ${(err as Error).message}`);
      return null;
    }
  }

  /** curl 下载：.cn/.space 互换镜像优先原域，退避重试 */
  private curlTo(url: string, dest: string, timeoutMs: number, retries: number): Promise<boolean> {
    const candidates = [url];
    if (url.includes('cos-platform-outputs.agnes-ai.cn')) {
      candidates.push(url.replace('cos-platform-outputs.agnes-ai.cn', 'platform-outputs.agnes-ai.space'));
    }
    if (url.includes('platform-outputs.agnes-ai.space')) {
      candidates.push(url.replace('platform-outputs.agnes-ai.space', 'cos-platform-outputs.agnes-ai.cn'));
    }
    const unique = [...new Set(candidates)];
    const timeoutSec = Math.max(15, Math.ceil(timeoutMs / 1000));
    // 修复（重试预算被镜像吃掉）：旧实现 `unique[attempt % unique.length]`
    // 让原域与镜像共用同一个 retries 预算，retries=1 时镜像根本没机会试。
    // 改为每个候选各自拥有 retries 次机会。
    const maxAttempts = Math.max(1, retries) * unique.length;
    return new Promise((resolve) => {
      let attempt = 0;
      const tryOnce = (): void => {
        const target = unique[attempt % unique.length];
        // 修复：不再硬编码 /usr/bin/curl。Alpine / distroless / 非标准前缀下
        // 该路径不存在，而 child.on('error') 会把「curl 没装」和网络抖动
        // 同等对待地重试 maxAttempts 次，最后只留一句「下载产出失败」。
        // 交给 PATH 解析；确实没装时下面单独识别 ENOENT 并立刻放弃。
        const child = spawn(
          'curl',
          ['-sS', '-f', '-L', '--connect-timeout', '10', '--max-time', String(timeoutSec), '-o', dest, target],
          { stdio: ['ignore', 'ignore', 'pipe'] },
        );
        let err = '';
        // 修复（无界累积）：stderr 原本 `err += d.toString()` 不设上限，
        // 一个持续报错的重定向循环可以把它撑得很大；排障只需要一小段。
        child.stderr.on('data', (d: Buffer) => {
          if (err.length < 4096) err += d.toString();
        });
        const fail = (spawnError?: Error): void => {
          // curl 不存在属于环境问题，重试无意义，立刻失败并给出可操作的提示
          if ((spawnError as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') {
            this.logger.error(
              '未找到 curl 可执行文件（PATH 中不可用），本地产出归档已跳过；' +
                '请安装 curl，否则资产库只能回退远程 CDN 链接',
            );
            resolve(false);
            return;
          }
          attempt += 1;
          if (attempt >= maxAttempts) {
            this.logger.warn(
              `下载产出失败（${attempt} 次，${unique.length} 个候选）: ${err.slice(-160)}`,
            );
            resolve(false);
            return;
          }
          // 退避封顶：旧的 400*attempt 在候选变多后会线性涨到数秒
          setTimeout(tryOnce, 400 * Math.min(attempt, 5));
        };
        child.on('error', (e: Error) => fail(e));
        child.on('close', (code) => {
          if (code === 0) resolve(true);
          else fail();
        });
      };
      tryOnce();
    });
  }
}
