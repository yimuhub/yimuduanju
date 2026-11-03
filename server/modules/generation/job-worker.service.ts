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
  scenes,
  shots,
} from '@server/database/schema';
// 修复：新增 isNull / lt / notInArray / or，供「陈旧 queued 回收」与
// 「按 provider 维度限流冷却」的条件构造使用；desc 用于任务列表按时间倒序；
// sql 用于首帧质量门的 JSONB 列运算与按 updatedAt 轮转
import { and, desc, eq, inArray, isNull, lt, notInArray, or, sql } from 'drizzle-orm';
import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import { mkdir, stat, writeFile } from 'fs/promises';
import { join } from 'path';
import type { GenerationJob, ProfessionalPrefs } from '@shared/api.interface';
import { stageOfJobType, type StageKey } from '@shared/stage-bindings';
import { StageBindingsService } from '../providers/stage-bindings.service';
import { GenerationService } from './generation.service';
import { ModelGatewayService } from './model-gateway.service';
import { BudgetCapService } from './budget-cap.service';
import { RoutingService } from './routing.service';
import { StorySkillsService } from '../story-skills/story-skills.service';
import { StoryboardService } from '../storyboard/storyboard.service';
import { ExportService } from '../export/export.service';
import { QcService } from '../qc/qc.service';
// 修复（分层）：uploadDir 直接从工具模块导入。
// 旧写法依赖 uploads.controller 里的再导出，使消费器在模块加载期
// 就被迫拉起整条 Controller → Service → DI 依赖链。
import { uploadDir } from '../assets/upload-dir';
import { Queue, Worker, type Job } from 'bullmq';
import IORedis from 'ioredis';

/** 上游限流冷却时长（按 provider 维度，见 providerHoldUntil） */
const RATE_LIMIT_COOLDOWN_MS = 20_000;
/** 未被路由到具体 provider 的任务在冷却表里的占位键 */
const DEFAULT_PROVIDER_KEY = '__default__';
/**
 * queued 滞留回收阈值。
 * 修复：claimForQueue 先置 status='queued' 再 queue.add()，两步之间崩溃、
 * 或 Redis 启动后掉线，任务会永远停在 queued —— tick() 只认领 pending，
 * 而 running 回收原本只在 onModuleInit 跑一次，queued 态没有任何回收路径。
 */
const STALE_QUEUED_MS = 5 * 60 * 1000;

/**
 * 上游限流 / 瞬时故障判定。
 * 说明：这仍是基于错误文案的匹配 —— 网关抛的是 BadRequestException(message)，
 * 没有携带结构化 code。彻底修复需要让 ModelGatewayService 抛带 code 的类型化错误，
 * 那是一次跨模块重构；此处先把判定集中到一处并收紧正则：
 * 旧的 /\b503\b/ 会命中被回显的用户 prompt 文本（例如剧本里出现「503」），
 * 把一次真实的业务失败误判成限流，从而无限重试且不消耗重试次数。
 */
const RATE_LIMIT_PATTERNS: RegExp[] = [
  /pool saturated/i,
  /rate[_\s-]?limit/i,
  /too many requests/i,
  /\b429\b/,
  /\(\s*503\s*[,)]/, // 网关错误文案形如「视频生成失败 (503, https://…)」
  /HTTP\s*503\b/i,
  /status(?:\s*code)?[:=]?\s*503\b/i,
];

function isRateLimitMessage(message: string): boolean {
  return RATE_LIMIT_PATTERNS.some((re) => re.test(message));
}

/**
 * Provider / API Key 未配置：确定性配置缺失，重试不会改变结果，
 * 保持 pending 等人工配置，且不消耗重试次数。
 */
const MISSING_PROVIDER_PATTERNS: RegExp[] = [
  /API Key/i,
  /未配置/,
  /不存在或已禁用/,
];

function isMissingProviderMessage(message: string): boolean {
  return MISSING_PROVIDER_PATTERNS.some((re) => re.test(message));
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
    reason: 'waiting_first_frame' | 'first_frame_failed' | 'first_frame_missing',
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
    // 有 blockedReason 的视频在等首帧，必须跳过，避免队头阻塞整条队列。
    const dependencyReady = sql`${generationJobs.inputData} ->> 'blockedReason' IS NULL`;
    const where =
      cooling.length > 0
        ? and(
            eq(generationJobs.status, 'pending'),
            dependencyReady,
            or(
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
    // 修复（按 provider 冷却）：冷却期内不触碰该通道，直接放回 pending 等下一轮，
    // 避免继续打爆对端池；其他 provider 的任务不受影响。
    const holdKey = providerName ?? DEFAULT_PROVIDER_KEY;
    const holdUntil = this.providerHoldUntil.get(holdKey) ?? 0;
    if (holdUntil > Date.now()) {
      await this.releaseToPending(job.id);
      return;
    }
    this.providerHoldUntil.delete(holdKey);
    try {
      switch (job.jobType) {
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
        this.providerHoldUntil.set(key, Date.now() + RATE_LIMIT_COOLDOWN_MS);
        this.logger.warn(
          `任务 ${job.id} 上游限流（provider=${key}），冷却 ${RATE_LIMIT_COOLDOWN_MS / 1000}s 后重试：${message.slice(0, 160)}`,
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
    // 收集参考图：优先使用 input.references，若为镜头生图且未传参考图则自动关联镜头绑定角色的参考图以保持角色一致性
    const refList: string[] = Array.isArray(input.references)
      ? (input.references as unknown[]).filter((r): r is string => typeof r === 'string' && r.length > 0)
      : [];
    if (refList.length === 0 && job.targetType === 'shot' && job.targetId && job.projectId) {
      const shotRows = await this.db
        .select({ characterIds: shots.characterIds, referenceImageUrls: shots.referenceImageUrls })
        .from(shots)
        .where(eq(shots.id, job.targetId))
        .limit(1);
      const shotRefs = shotRows[0]?.referenceImageUrls ?? [];
      for (const r of shotRefs) {
        if (r) refList.push(r);
      }
      const charIds = shotRows[0]?.characterIds ?? [];
      if (refList.length === 0 && charIds.length > 0) {
        const charRows = await this.db
          .select({ id: characters.id, referenceImageUrls: characters.referenceImageUrls })
          .from(characters)
          .where(eq(characters.projectId, job.projectId));
        for (const c of charRows) {
          if (charIds.includes(c.id) && c.referenceImageUrls && c.referenceImageUrls.length > 0) {
            refList.push(c.referenceImageUrls[0]);
          }
        }
      }
    }
    const seed = typeof input.seed === 'number' && Number.isFinite(input.seed) ? input.seed : undefined;
    const images = await this.modelGateway.generateImage(
      {
        prompt,
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

  private async processVideo(job: GenerationJob, providerName?: string, opts?: { model?: string }): Promise<void> {
    const input = (job.inputData ?? {}) as Record<string, unknown>;
    const prompt = this.inputPrompt(job);
    if (!prompt.trim()) {
      await this.generationService.settleJobFailure(job.id, '视频任务缺少 prompt');
      return;
    }
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
          typeof input.duration === 'number' ? input.duration : 5,
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
    this.logger.log(`视频远端任务已创建 ${job.id} → ${taskId}`);
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
        inArray(projects.status, [
          'assets_generating',
          'video_generating',
          'audio_generating',
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

    // 2) 自动建 video：有首帧、无成片、无在途也无成功记录的镜头（失败镜不自动重投）
    const needVideo = shotRows.filter(
      (s) =>
        s.startFrameUrl &&
        !s.videoUrl &&
        !doneVideoTargets.has(s.id) &&
        !activeVideoTargets.has(s.id) &&
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

    // 4) 自动建 tts：有对白、无配音、无在途 tts 的镜头
    const activeTtsTargets = new Set(activeJobsOf('tts').map((j) => j.targetId as string));
    const doneTtsTargets = new Set(
      jobRows
        .filter((j) => j.jobType === 'tts' && j.status === 'succeeded' && j.targetId)
        .map((j) => j.targetId as string),
    );
    const needTts = shotRows.filter(
      (s) =>
        (s.dialogue ?? '').trim().length > 0 &&
        !s.voiceUrl &&
        !doneTtsTargets.has(s.id) &&
        !activeTtsTargets.has(s.id) &&
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
      await this.advanceProjectStatus(projectId, 'assets_generating', 'video_generating');
      await this.advanceProjectStatus(projectId, 'video_generating', 'audio_generating');
      return;
    }

    // 5) 配音未跑完不推进
    if (activeJobsOf('tts').length > 0) {
      await this.advanceProjectStatus(projectId, 'assets_generating', 'video_generating');
      await this.advanceProjectStatus(projectId, 'video_generating', 'audio_generating');
      return;
    }

    // 6) 全段完成 → editing + 建 edit 任务（服务端合成，幂等去重）
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
      this.logger.log(`自动链：项目 ${projectId} 全部镜头就绪，已创建剪辑合成任务`);
    }
    await this.advanceProjectStatus(projectId, 'video_generating', 'audio_generating');
    await this.advanceProjectStatus(projectId, 'audio_generating', 'editing');
  }

  // ========== edit 服务端合成 / qc 质检任务（激活状态机 editing/qc 死区） ==========

  /** edit 任务：复用 export/assemble 的 ffmpeg 合成 → editing → qc，自动建质检任务 */
  private async processEdit(job: GenerationJob): Promise<void> {
    if (!job.projectId) {
      await this.generationService.settleJobFailure(job.id, '剪辑任务缺少项目归属');
      return;
    }
    try {
      const result = await this.exportService.assembleFinalVideo(job.projectId);
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
      // 可预见的业务性失败（如无成片可拼）直接终结，不烧 3 次重试
      if ((e as Error).message.includes('暂无镜头成片')) {
        await this.generationService.settleJobFailure(job.id, (e as Error).message);
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
    await this.generationService.settleJobSuccess(job.id, {
      reportId: report.id,
      overallScore: report.overallScore,
      pass: report.pass,
      issueCount: report.issues.length,
    });
    this.logger.log(`质检完成 ${job.id}：得分 ${report.overallScore}，等待成片确认门`);
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
    let styleId = input.styleId;
    if (!styleId) {
      const artRows = await this.db
        .select({ artStyle: projects.artStyle })
        .from(projects)
        .where(eq(projects.id, job.projectId))
        .limit(1);
      styleId = artRows[0]?.artStyle ?? undefined;
    }
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
    });
    if (!result.scriptText.trim()) {
      await this.generationService.settleJobFailure(job.id, '技能未产出可用剧本');
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
    });
    // 链式物化：改写类任务替换旧分镜，避免重复堆积
    await this.db.insert(generationJobs).values({
      projectId: job.projectId,
      jobType: 'parse_script',
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
    this.logger.log(`剧本技能 ${result.skillId} 完成，已链式创建物化任务`);
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
      styleId?: string;
      genreId?: string;
      replaceExisting?: boolean;
    };
    const scriptText = (input.scriptText ?? '').trim();
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
    let boards: { scene: string; shotSize: string; movement: string; durationSeconds: number; dialogue?: string; visualPrompt?: string }[];
    try {
      // 目标总时长：项目 durationSeconds 传入分镜技能，镜头时长之和贴齐（如 90s）
      const projDurRows = await this.db
        .select({ durationSeconds: projects.durationSeconds })
        .from(projects)
        .where(eq(projects.id, job.projectId))
        .limit(1);
      const targetSeconds = Number(projDurRows[0]?.durationSeconds) || undefined;
      const result = await this.storySkills.runBoards({
        scriptText,
        styleId,
        genreId: typeof input.genreId === 'string' ? input.genreId : undefined,
        model: opts?.model,
        temperature: opts?.temperature,
        providerName: providerName ?? job.providerName,
        targetSeconds,
      });
      boards = result.shots;
    } catch (e) {
      await this.generationService.settleJobFailure(job.id, (e as Error).message);
      return;
    }
    if (boards.length === 0) {
      // 降级：LLM 没产出可用 JSON，转 parse_script 启发式拆分
      this.logger.warn(`分镜表空结果 ${job.id}，降级走 parse_script`);
      await this.db.insert(generationJobs).values({
        projectId: job.projectId,
        jobType: 'parse_script',
        targetType: 'project',
        targetId: job.projectId,
        status: 'pending',
        priority: 80,
        inputData: { prompt: scriptText, replaceExisting: input.replaceExisting === true },
      });
      await this.generationService.settleJobSuccess(job.id, { fallback: 'parse_script', shotsCount: 0 });
      return;
    }
    if (input.replaceExisting) {
      await this.db.delete(shots).where(eq(shots.projectId, job.projectId));
      await this.db.delete(scenes).where(eq(scenes.projectId, job.projectId));
    }
    // 按 scene 分组建场（保持出现顺序），镜号场内递增
    const groups = new Map<string, typeof boards>();
    for (const b of boards) {
      const list = groups.get(b.scene) ?? [];
      list.push(b);
      groups.set(b.scene, list);
    }
    let sceneNumber = 0;
    let shotTotal = 0;
    for (const [title, list] of groups) {
      sceneNumber += 1;
      // eslint-disable-next-line no-await-in-loop
      const [scene] = await this.db
        .insert(scenes)
        .values({
          projectId: job.projectId,
          sceneNumber,
          title: title.slice(0, 200),
          summary: list[0]?.visualPrompt?.slice(0, 200),
          dialogues: [],
          actions: [],
          characterIds: [],
          props: [],
          sortOrder: sceneNumber,
        })
        .returning({ id: scenes.id });
      let n = 0;
      for (const b of list) {
        n += 1;
        shotTotal += 1;
        // eslint-disable-next-line no-await-in-loop
        await this.db.insert(shots).values({
          projectId: job.projectId,
          sceneId: scene.id,
          shotNumber: n,
          duration: b.durationSeconds.toFixed(1),
          shotSize: b.shotSize,
          cameraAngle: 'eye_level',
          lens: '50mm',
          movement: b.movement,
          dialogue: b.dialogue,
          subtitleText: b.dialogue,
          visualPrompt: b.visualPrompt,
          subject: b.visualPrompt?.slice(0, 200),
          status: 'draft',
          sortOrder: n,
        });
      }
    }
    await this.generationService.settleJobSuccess(job.id, {
      scenesCount: groups.size,
      shotsCount: shotTotal,
    });
    this.logger.log(`分镜表物化完成 ${job.id}：${groups.size} 场 ${shotTotal} 镜`);
  }

  // ========== parse_script 启发式物化 ==========

  /**
   * 无需 LLM 的确定性剧本物化：按“第X场”标题或空行分块拆场景，
   * 每场景 1 个全景 + 最多 3 个对白特写。产物为 draft 状态分镜，
   * 用户可在分镜/导演台继续调整后发起真实生成。
   */
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
      await this.db.delete(shots).where(eq(shots.projectId, job.projectId));
      await this.db.delete(scenes).where(eq(scenes.projectId, job.projectId));
      this.logger.log(`物化前已清空旧分镜（技能链 ${job.id}）`);
    }

    // P1 专业模式透传消费：目标总镜头数/单镜时长/景别/运镜/字幕开关来自 project.metadata；
    // 缺省时按片长估算（总时长/4s），与极速模式行为一致
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
      Math.max(4, Math.min(60, Math.round(totalDuration / 4)));

    const blocks = this.splitScenes(scriptText);
    const perSceneTarget = Math.max(
      1,
      Math.min(6, Math.ceil(targetShots / Math.max(1, blocks.length))),
    );
    let shotTotal = 0;
    const imageTargets: { shotId: string; prompt: string }[] = [];
    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      const [scene] = await this.db
        .insert(scenes)
        .values({
          projectId: job.projectId,
          sceneNumber: i + 1,
          title: block.title,
          summary: block.summary,
          dialogues: block.dialogues,
          actions: [],
          characterIds: [],
          props: [],
          sortOrder: i + 1,
        })
        .returning({ id: scenes.id });

      const shotsToInsert = this.buildShots(block, prefs, perSceneTarget);
      for (let j = 0; j < shotsToInsert.length; j++) {
        const s = shotsToInsert[j];
        const [inserted] = await this.db
          .insert(shots)
          .values({
            projectId: job.projectId,
            sceneId: scene.id,
            shotNumber: j + 1,
            duration: prefs.shotDuration.toFixed(1),
            shotSize: s.shotSize,
            cameraAngle: 'eye_level',
            lens: '50mm',
            movement: s.movement,
            dialogue: s.dialogue,
            subtitleText: prefs.subtitleEnabled ? s.dialogue : undefined,
            visualPrompt: s.visualPrompt,
            subject: s.visualPrompt?.slice(0, 200),
            status: 'draft',
            sortOrder: j + 1,
          })
          .returning({ id: shots.id });
        imageTargets.push({
          shotId: inserted.id,
          prompt: s.visualPrompt || s.dialogue || '全景 establishing shot',
        });
        shotTotal += 1;
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

    // 快速通道推进：parsing → planning → storyboard_ready（→ assets_generating，仅在已建图时）
    // （跳过 bible_ready；状态机 PATCH 白名单仅约束外部写入，此处为系统推进）
    await this.advanceProjectStatus(job.projectId, 'parsing', 'planning');
    await this.advanceProjectStatus(job.projectId, 'planning', 'storyboard_ready');
    if (autoSubmit && imageTargets.length > 0) {
      await this.advanceProjectStatus(job.projectId, 'storyboard_ready', 'assets_generating');
    }

    await this.generationService.settleJobSuccess(job.id, {
      scenesCount: blocks.length,
      shotsCount: shotTotal,
      voicePreset: prefs.voicePreset,
      imageJobs: imageTargets.length,
    });
    this.logger.log(
      `剧本物化完成 ${job.id}：${blocks.length} 场 ${shotTotal} 镜，首帧任务 ${imageTargets.length}`,
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
        : 4;
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
  ): { shotSize: string; movement: string; dialogue?: string; visualPrompt: string }[] {
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

    // 角色/场景：图片追加为参考图；V1 四视图定妆照（sheet 标记）插到首位当权威参考
    if ((job.targetType === 'character' || job.targetType === 'location') && urls.imageUrl) {
      const table = job.targetType === 'character' ? characters : locations;
      const rows = await this.db.select().from(table).where(eq(table.id, job.targetId)).limit(1);
      if (rows.length === 0) return;
      if (projectGuard && rows[0].projectId !== projectGuard.projectId) return;
      const existing = (rows[0].referenceImageUrls ?? []) as string[];
      const input = (job.inputData ?? {}) as Record<string, unknown>;
      const next = input.sheet === true
        ? [urls.imageUrl, ...existing.filter((u) => u !== urls.imageUrl)]
        : [...existing, urls.imageUrl];
      await this.db
        .update(table)
        .set({
          referenceImageUrls: next,
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
      entries.push({ assetType: 'image', url: urls.imageUrl, mime: 'image/png', name: '首帧' });
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
