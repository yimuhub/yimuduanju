import { Inject, Injectable, Logger } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { and, eq, sql } from 'drizzle-orm';
import { providerApiKeys } from '@server/database/billing.schema';

export type KeyLeaseResult =
  /** 成功领到一把 Key */
  | { status: 'leased'; keyId: string; label: string }
  /** 该供应商没有任何 Key 行 —— 调用方应回落 model_providers.api_key 主 Key */
  | { status: 'no_keys' }
  /** 有 Key 行但当前全部在途/冷却/失效 —— 调用方应把任务放回队列稍后再试 */
  | { status: 'busy' };

/**
 * 视频联邦池的租约结果：比单供应商租约多带「这把 Key 属于哪个供应商」。
 * 建单必须用该供应商的 base_url / format_type，轮询也要按它落盘，
 * 否则跨账号查询会 404 task not found。
 */
export type FederatedLeaseResult =
  | {
      status: 'leased';
      keyId: string;
      label: string;
      providerId: string;
      providerName: string;
    }
  | { status: 'no_keys' }
  | { status: 'busy' };

/**
 * 供应商密钥池（migration 0023）。
 *
 * 旧实现「同一时刻只有一把 Key 生效」无法并行：用户加 10 把 Key，
 * 实际只有 1 把在工作，供应商侧永远是单账号排队。这里把每把 Key 当成
 * 一条独立车道：
 *
 *   - lease()   原子领一把可用 Key（in_flight + 1），并发额度由每把 Key 的
 *               concurrency 控制；
 *   - cooldown() 只冻结这一把（status=cooldown + cooldown_until），
 *               其它车道继续跑 —— 这是「一个号限流不再拖死整条视频链」的关键；
 *   - release() 任务结束后归还车道；
 *   - recoverStaleLeases() 启动时按 key_leases 实际租约重算 in_flight，
 *               进程崩溃/重启不会把车道永久占死。
 *
 * 车道选择：in_flight 最少 → priority 高 → 最久未用（last_used_at NULL 优先），
 * 即最空闲优先，天然把负载摊到所有 Key 上。
 */
@Injectable()
export class ProviderKeyPoolService {
  private readonly logger = new Logger(ProviderKeyPoolService.name);

  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase) {}

  /** 领一把可用 Key。jobId 仅用于租约追溯；pinnedKeyId 用于「项目独占某把 Key」。 */
  async lease(
    providerId: string,
    jobId?: string | null,
    ttlMs = 30 * 60 * 1000,
    pinnedKeyId?: string | null,
  ): Promise<KeyLeaseResult> {
    // 先看这个供应商到底有没有 Key 行：没有则让调用方回落主 Key 列
    const total = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(providerApiKeys)
      .where(eq(providerApiKeys.providerId, providerId));
    if ((total[0]?.n ?? 0) === 0) return { status: 'no_keys' };

    // 原子领 Key：子查询挑一条可用车道并 FOR UPDATE SKIP LOCKED，
    // 外层 UPDATE 直接把 in_flight + 1 —— 多进程并发下也不会超发。
    const rows = await this.db.execute(sql`
      UPDATE provider_api_keys
      SET in_flight = in_flight + 1, last_used_at = now()
      WHERE id = (
        SELECT id FROM provider_api_keys
        WHERE provider_id = ${providerId}
          AND enabled = true
          AND status <> 'invalid'
          AND (cooldown_until IS NULL OR cooldown_until < now())
          AND in_flight < GREATEST(concurrency, 1)
          AND (${pinnedKeyId ?? null}::uuid IS NULL OR id = ${pinnedKeyId ?? null}::uuid)
        ORDER BY in_flight ASC, priority DESC, last_used_at ASC NULLS FIRST
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id, label
    `);
    const row = (rows as unknown as Array<{ id: string; label: string }>)[0];
    if (!row) return { status: 'busy' };

    const expiresAt = new Date(Date.now() + ttlMs);
    // 必须显式 toISOString() + ::timestamptz：这条链路的驱动（postgres-js）只接受
    // string/Buffer 参数，直接塞 Date 会抛
    // ERR_INVALID_ARG_TYPE: Received an instance of Date。
    // 曾经就是因为这个，每一次「领 Key」都在最后一步炸掉、被 .catch 静默吞掉，
    // 任务退回供应商主 Key —— 密钥池形同不存在，多 Key 并行从未真正生效。
    await this.db.execute(sql`
      INSERT INTO key_leases (key_id, job_id, provider_id, expires_at)
      VALUES (${row.id}, ${jobId ?? null}, ${providerId}, ${expiresAt.toISOString()}::timestamptz)
    `);
    return { status: 'leased', keyId: row.id, label: row.label ?? 'Key' };
  }

  /**
   * 自动探测：连续成功 5 次且当前并发 < 3 时，把该车道并发 +1。
   * 起始并发 1（migration 默认），只有稳定成功才升档；一旦限流立刻冷回原额度。
   * 这样既不会一上来就打爆账号，又能逐渐吃满每个号的实际承载。
   */
  private readonly successStreak = new Map<string, number>();

  /** 任务成功：归还车道、清除冷却/错误状态，并按成功次数自动探测升并发 */
  async release(keyId: string | null | undefined): Promise<void> {
    if (!keyId) return;
    const streak = (this.successStreak.get(keyId) ?? 0) + 1;
    if (streak >= 5) {
      this.successStreak.set(keyId, 0);
      await this.db.execute(sql`
        UPDATE provider_api_keys
        SET in_flight = GREATEST(in_flight - 1, 0),
            status = CASE WHEN status = 'invalid' THEN 'invalid' ELSE 'active' END,
            cooldown_until = NULL,
            last_error = NULL,
            concurrency = LEAST(concurrency + 1, 3)
        WHERE id = ${keyId}
      `);
    } else {
      this.successStreak.set(keyId, streak);
      await this.db.execute(sql`
        UPDATE provider_api_keys
        SET in_flight = GREATEST(in_flight - 1, 0),
            status = CASE WHEN status = 'invalid' THEN 'invalid' ELSE 'active' END,
            cooldown_until = NULL,
            last_error = NULL
        WHERE id = ${keyId}
      `);
    }
    await this.db.execute(sql`DELETE FROM key_leases WHERE key_id = ${keyId} AND expires_at > now()`);
  }

  /** 中性归还（非成功、非限流，如参数错误）：只减在途，不动状态与成功率 */
  async releaseSlot(keyId: string | null | undefined): Promise<void> {
    if (!keyId) return;
    await this.db.execute(sql`
      UPDATE provider_api_keys SET in_flight = GREATEST(in_flight - 1, 0) WHERE id = ${keyId}
    `);
    await this.db.execute(sql`DELETE FROM key_leases WHERE key_id = ${keyId} AND expires_at > now()`);
  }

  /** 限流/池饱和：只冻结这一把 Key，其它车道不受影响；并把探测到的并发降回一档 */
  async cooldown(keyId: string | null | undefined, ms: number, reason: string): Promise<void> {
    if (!keyId) return;
    this.successStreak.delete(keyId);
    const until = new Date(Date.now() + ms);
    // 同 lease()：Date 必须转 ISO 字符串，否则驱动抛 ERR_INVALID_ARG_TYPE
    await this.db.execute(sql`
      UPDATE provider_api_keys
      SET in_flight = GREATEST(in_flight - 1, 0),
          status = 'cooldown',
          cooldown_until = ${until.toISOString()}::timestamptz,
          last_error = ${reason.slice(0, 300)},
          concurrency = GREATEST(1, concurrency - 1)
      WHERE id = ${keyId}
    `);
    await this.db.execute(sql`DELETE FROM key_leases WHERE key_id = ${keyId} AND expires_at > now()`);
    this.logger.warn(`Key ${keyId} 冷却 ${Math.round(ms / 1000)}s：${reason.slice(0, 120)}`);
  }

  /** 鉴权失效：标记 invalid，不再参与调度，需用户重新启用 */
  async markInvalid(keyId: string | null | undefined, reason: string): Promise<void> {
    if (!keyId) return;
    this.successStreak.delete(keyId);
    await this.db.execute(sql`
      UPDATE provider_api_keys
      SET in_flight = GREATEST(in_flight - 1, 0),
          status = 'invalid',
          last_error = ${reason.slice(0, 300)}
      WHERE id = ${keyId}
    `);
    await this.db.execute(sql`DELETE FROM key_leases WHERE key_id = ${keyId} AND expires_at > now()`);
    this.logger.error(`Key ${keyId} 鉴权失效，已停用：${reason.slice(0, 120)}`);
  }

  /**
   * 按任务释放租约（任务放回 pending 时调用）。
   *
   * 为什么必须有这条：车道额度（in_flight）只有两条归还路径 —— 成功 release、
   * 限流 cooldown。一旦失败路径漏掉一步（历史上出现过：503 被别的分支先接住、
   * 异常在结算前抛出），租约就会一直挂到 30 分钟 TTL 到期，
   * 而 `recoverStaleLeases` 是「让 in_flight 对齐未过期租约」——
   * 它只会把一个泄漏的租约当真，于是 concurrency=1 的车道直接卡死半小时，
   * 用户看到的是「队列一动不动」。任务都已经放回队列了，租约没有任何理由留着。
   */
  async releaseByJob(jobId: string): Promise<void> {
    if (!jobId) return;
    try {
      await this.db.execute(sql`
        WITH gone AS (
          DELETE FROM key_leases WHERE job_id = ${jobId} RETURNING key_id
        ), dec AS (
          SELECT key_id, count(*)::int AS n FROM gone GROUP BY key_id
        )
        UPDATE provider_api_keys p
        SET in_flight = GREATEST(p.in_flight - d.n, 0)
        FROM dec d
        WHERE p.id = d.key_id
      `);
    } catch (e) {
      this.logger.warn(`按任务释放 Key 租约失败 ${jobId}：${(e as Error).message}`);
    }
  }

  /** 启动/周期调用：按实际租约重算 in_flight，回收过期租约（防车道泄漏） */
  async recoverStaleLeases(): Promise<void> {
    try {
      await this.db.execute(sql`DELETE FROM key_leases WHERE expires_at < now()`);
      // 自愈：in_flight 直接对齐到「未过期的实际租约数」，任何历史泄漏一次归零
      await this.db.execute(sql`
        UPDATE provider_api_keys p
        SET in_flight = COALESCE(l.n, 0)
        FROM (
          SELECT k.id, (SELECT count(*) FROM key_leases kl WHERE kl.key_id = k.id AND kl.expires_at > now()) AS n
          FROM provider_api_keys k
        ) l
        WHERE p.id = l.id AND p.in_flight <> COALESCE(l.n, 0)
      `);
      // 冷却到期的 Key 自动回到 active
      await this.db.execute(sql`
        UPDATE provider_api_keys
        SET status = 'active'
        WHERE status = 'cooldown' AND cooldown_until IS NOT NULL AND cooldown_until < now()
      `);
    } catch (e) {
      this.logger.warn(`回收 Key 租约失败：${(e as Error).message}`);
    }
  }

  /**
   * 视频专用：跨 Agnes 供应商的「联邦密钥池」。
   * ------------------------------------------------------------------
   * 为什么必须有：原 lease() / leaseByProviderName() 的 SQL 写死
   * `WHERE provider_id = 当前供应商`，而视频阶段绑定（stage_model_bindings）
   * 只会指向**一个**供应商。于是用户把 4 个账号分散在两个 Agnes 供应商下时，
   * 另一个供应商的 Key 从创建起就一次都租不到 —— 界面显示 4 条车道，
   * 实际只有 1~2 个账号在轮询上游。这与「一把 Key 一条车道、多号并行」
   * 的设计目标直接冲突。
   *
   * 这里把候选 Key 放宽到**所有启用的、明确属于 Agnes 视频通道的供应商**
   * （官方端点或 agnes- 开头的视频模型），全局按最空闲优先挑一把，
   * 并把 Key 所属供应商一并返回，由调用方用它建单和落盘，保证轮询同账号。
   * 非 Agnes 通道（火山方舟 / mock / relay）不会进入候选集合，
   * 联邦池返回 no_keys 时调用方自然回落到原单供应商逻辑，行为不变。
   */
  async leaseForVideo(
    jobId?: string | null,
    projectId?: string | null,
  ): Promise<FederatedLeaseResult> {
    // 用 SQL 子查询而不是把 id 数组当参数传，避开 drizzle / postgres-js
    // 数组绑定的兼容坑；同时天然把异构供应商挡在外面。
    const agnesProviderIds = sql`(
      SELECT id FROM model_providers
      WHERE enabled = true
        AND (base_url ILIKE '%agnes-ai.com%' OR video_model ILIKE 'agnes-%')
    )`;

    // 项目钉 Key：只有当钉的 Key 也属于某个 Agnes 供应商时才生效。
    // 不校验的话，钉到火山方舟之类的 Key 会让候选集合恒为空、通道卡死。
    let pinnedKeyId: string | null = null;
    if (projectId) {
      const pinned = await this.db.execute(sql`
        SELECT k.id::text AS id
        FROM projects p
        JOIN provider_api_keys k ON k.id = p.pinned_key_id
        WHERE p.id = ${projectId}
          AND k.enabled = true
          AND k.provider_id IN ${agnesProviderIds}
        LIMIT 1
      `);
      pinnedKeyId = (pinned as unknown as Array<{ id: string }>)[0]?.id ?? null;
    }

    const total = await this.db.execute(sql`
      SELECT count(*)::int AS n FROM provider_api_keys
      WHERE provider_id IN ${agnesProviderIds}
    `);
    if (((total as unknown as Array<{ n: number }>)[0]?.n ?? 0) === 0) {
      return { status: 'no_keys' };
    }

    /*
     * status 不能写死 'active'：cooldown() 把 status 置为 'cooldown' 后，
     * 只有每 60s 一次的 recoverStaleLeases() 才会改回 active。于是
     * cooldown_until 明明已经过期、这把 Key 却仍租不到，形成几十秒的
     * 假性「所有车道都在冷却」。这里以「冷却时间是否真的过了」为准。
     */
    const tryLease = async (pinned: string | null) => {
      const rows = await this.db.execute(sql`
        UPDATE provider_api_keys
        SET in_flight = in_flight + 1, last_used_at = now()
        WHERE id = (
          SELECT id FROM provider_api_keys
          WHERE provider_id IN ${agnesProviderIds}
            AND enabled = true
            AND status <> 'invalid'
            AND (cooldown_until IS NULL OR cooldown_until < now())
            AND in_flight < GREATEST(concurrency, 1)
            AND (${pinned}::uuid IS NULL OR id = ${pinned}::uuid)
          ORDER BY in_flight ASC, priority DESC, last_used_at ASC NULLS FIRST
          LIMIT 1
          FOR UPDATE SKIP LOCKED
        )
        RETURNING id, label, provider_id
      `);
      return (rows as unknown as Array<{ id: string; label: string; provider_id: string }>)[0];
    };

    let row = await tryLease(pinnedKeyId);
    if (!row && pinnedKeyId) {
      /*
       * 钉 Key 是「优先偏好」，不是硬锁。旧实现把候选集合直接缩到这一把，
       * 于是一旦它被 503 冷却，整个项目所有镜头全部 busy —— 用户看到的
       * 「4 个账号实际只有 2 个在跑」就是这里：两个项目各自钉了一把 Key。
       * 钉 Key 忙/冷却时回落到全部 Agnes 车道，既保留偏好又不牺牲产能。
       */
      row = await tryLease(null);
    }
    if (!row) return { status: 'busy' };

    const names = await this.db.execute(sql`
      SELECT name FROM model_providers WHERE id = ${row.provider_id} LIMIT 1
    `);
    const providerName = (names as unknown as Array<{ name: string }>)[0]?.name ?? '';

    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
    await this.db.execute(sql`
      INSERT INTO key_leases (key_id, job_id, provider_id, expires_at)
      VALUES (${row.id}, ${jobId ?? null}, ${row.provider_id}, ${expiresAt.toISOString()}::timestamptz)
    `);
    return {
      status: 'leased',
      keyId: row.id,
      label: row.label ?? 'Key',
      providerId: row.provider_id,
      providerName,
    };
  }

  /** 按 provider 名称领 Key（worker 里只有名字）；projectId 用于项目独占 Key */
  async leaseByProviderName(
    providerName: string,
    jobId?: string | null,
    projectId?: string | null,
  ): Promise<KeyLeaseResult | null> {
    const rows = await this.db.execute(sql`
      SELECT id FROM model_providers WHERE name = ${providerName} LIMIT 1
    `);
    const providerId = (rows as unknown as Array<{ id: string }>)[0]?.id;
    if (!providerId) return null;

    // 项目独占：只有当钉选的 Key 确实属于当前供应商时才生效，
    // 否则（钉的是别的供应商的 Key）忽略，避免本通道永远 lease 不到而卡死。
    let pinnedKeyId: string | null = null;
    if (projectId) {
      const pinned = await this.db.execute(sql`
        SELECT k.provider_id AS key_provider, p.pinned_key_id AS pinned
        FROM projects p
        LEFT JOIN provider_api_keys k ON k.id = p.pinned_key_id
        WHERE p.id = ${projectId}
        LIMIT 1
      `);
      const row = (pinned as unknown as Array<{ key_provider: string | null; pinned: string | null }>)[0];
      if (row?.pinned && row.key_provider === providerId) pinnedKeyId = row.pinned;
    }
    return this.lease(providerId, jobId, 30 * 60 * 1000, pinnedKeyId);
  }

  /** 供应商当前车道状态（供队列页/设置页展示） */
  async statusByProvider(providerId: string): Promise<
    Array<{
      id: string;
      label: string;
      enabled: boolean;
      concurrency: number;
      inFlight: number;
      status: string;
      cooldownUntil: Date | null;
      lastError: string | null;
    }>
  > {
    const rows = await this.db
      .select({
        id: providerApiKeys.id,
        label: providerApiKeys.label,
        enabled: providerApiKeys.enabled,
        concurrency: providerApiKeys.concurrency,
        inFlight: providerApiKeys.inFlight,
        status: providerApiKeys.status,
        cooldownUntil: providerApiKeys.cooldownUntil,
        lastError: providerApiKeys.lastError,
      })
      .from(providerApiKeys)
      .where(and(eq(providerApiKeys.providerId, providerId)));
    return rows;
  }
}
