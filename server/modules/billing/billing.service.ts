import { Injectable, Inject, Logger, NotFoundException } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { modelPricing, officialChannel } from '@server/database/billing.schema';
import { modelProviders } from '@server/database/schema';
import { eq } from 'drizzle-orm';
// W1 安全修复：官方通道 Key 落库 AES-256-GCM 加密
import { encryptApiKey } from '../../common/crypto.util';
import type {
  CostEstimateItem,
  CostEstimateResponse,
  JobType,
  OfficialChannelInfo,
  OfficialChannelUpdateRequest,
  PriceItem,
  PricingUpdateRequest,
} from '@shared/api.interface';

/** 结算兜底单价（价格表缺失时使用，与 migration 基线一致） */
export const FALLBACK_UNIT_PRICE: Partial<Record<JobType, number>> = {
  text: 0.05,
  image: 0.3,
  video: 2.0,
  tts: 0.1,
  parse_script: 0.02,
  storyboard: 0.05,
  qc: 0.02,
  edit: 0.1,
  script: 0.1,
};

const TIER_ORDER = ['budget', 'balanced', 'flagship'];

/**
 * 计费中心：价格表单一可信源 + 官方通道配置 + 生成前预估。
 * 上游调价只需改表（管理后台），全网实时生效；Key 仅服务端持有。
 */
@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
  ) {}

  async listPricing(): Promise<PriceItem[]> {
    const rows = await this.db.select().from(modelPricing);
    return rows.map((r) => ({
      modelKey: r.modelKey,
      jobType: r.jobType ?? '',
      tier: r.tier ?? 'balanced',
      displayName: r.displayName,
      unit: r.unit ?? 'call',
      unitPriceCny: Number(r.unitPriceCny ?? 0),
      marketPriceCny: r.marketPriceCny === null ? null : Number(r.marketPriceCny),
      isActive: r.isActive ?? true,
    }));
  }

  async updatePricing(modelKey: string, dto: PricingUpdateRequest): Promise<PriceItem> {
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (dto.unitPriceCny !== undefined) patch.unitPriceCny = dto.unitPriceCny.toFixed(4);
    if (dto.marketPriceCny !== undefined)
      patch.marketPriceCny = dto.marketPriceCny === null ? null : dto.marketPriceCny.toFixed(4);
    if (dto.isActive !== undefined) patch.isActive = dto.isActive;
    const rows = await this.db
      .update(modelPricing)
      .set(patch)
      .where(eq(modelPricing.modelKey, modelKey))
      .returning();
    if (rows.length === 0) throw new NotFoundException('价格项不存在');
    const [item] = await this.listPricing().then((list) =>
      list.filter((i) => i.modelKey === modelKey),
    );
    return item;
  }

  /** 指定任务类型的结算单价（tier 缺省 balanced；表缺失时用兜底常量） */
  async getUnitPrice(jobType: string, tier = 'balanced'): Promise<number> {
    const rows = await this.db
      .select()
      .from(modelPricing)
      .where(eq(modelPricing.jobType, jobType));
    const active = rows.filter((r) => r.isActive);
    if (active.length === 0) {
      return FALLBACK_UNIT_PRICE[jobType as JobType] ?? 0.05;
    }
    const exact = active.find((r) => r.tier === tier);
    const row = exact ?? active[0];
    return Number(row.unitPriceCny ?? 0);
  }

  async getOfficialChannel(): Promise<OfficialChannelInfo> {
    const rows = await this.db
      .select()
      .from(officialChannel)
      .where(eq(officialChannel.id, 'default'))
      .limit(1);
    const row = rows[0];
    if (!row) {
      return {
        enabled: false,
        displayName: '官方直供通道',
        hasApiKey: false,
        priceVersion: 'v1',
      };
    }
    return {
      enabled: row.enabled ?? false,
      displayName: row.displayName ?? '官方直供通道',
      baseUrl: row.baseUrl ?? undefined,
      hasApiKey: Boolean(row.apiKey),
      priceVersion: row.priceVersion ?? 'v1',
    };
  }

  async updateOfficialChannel(dto: OfficialChannelUpdateRequest): Promise<OfficialChannelInfo> {
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (dto.enabled !== undefined) patch.enabled = dto.enabled;
    if (dto.displayName !== undefined) patch.displayName = dto.displayName;
    if (dto.baseUrl !== undefined) patch.baseUrl = dto.baseUrl;
    // W1 安全修复：落库前加密
    if (dto.apiKey !== undefined) patch.apiKey = encryptApiKey(dto.apiKey);
    await this.db
      .update(officialChannel)
      .set(patch)
      .where(eq(officialChannel.id, 'default'));
    // 联动影子 Provider 行：网关无需改造，路由选中官方即走此行（Key 服务端持有）
    const info = await this.getOfficialChannel();
    await this.syncOfficialProviderRow(info, dto.apiKey);
    return info;
  }

  /**
   * 官方影子 Provider 行（name='官方直供通道'，providerType='official'，系统托管）。
   * 用户不可手工创建该类型（表单无此选项）；禁用通道时同步禁用该行。
   */
  private async syncOfficialProviderRow(
    info: OfficialChannelInfo,
    apiKey?: string,
  ): Promise<void> {
    const existing = await this.db
      .select()
      .from(modelProviders)
      .where(eq(modelProviders.name, '官方直供通道'))
      .limit(1);
    const patch: Record<string, unknown> = {
      providerType: 'official',
      baseUrl: info.baseUrl,
      enabled: info.enabled,
      formatType: 'openai',
      capabilities: { text: true, image: true, video: true, tts: true },
      updatedAt: new Date(),
    };
    // W1 安全修复：落库前加密
    if (apiKey !== undefined) patch.apiKey = encryptApiKey(apiKey);
    if (existing.length === 0) {
      await this.db.insert(modelProviders).values({
        name: '官方直供通道',
        ...patch,
      } as typeof modelProviders.$inferInsert);
    } else {
      await this.db
        .update(modelProviders)
        .set(patch)
        .where(eq(modelProviders.id, existing[0].id));
    }
  }

  /** 生成前预估：按 tier 取各任务单价 × 数量，同时算出市场价与节省额 */
  async estimate(
    tier = 'balanced',
    counts: Partial<Record<string, number>>,
  ): Promise<CostEstimateResponse> {
    const normalizedTier = TIER_ORDER.includes(tier) ? tier : 'balanced';
    const prices = await this.listPricing();
    const items: CostEstimateItem[] = [];
    for (const [jobType, rawCount] of Object.entries(counts)) {
      const count = Math.max(0, Math.floor(Number(rawCount) || 0));
      if (count === 0) continue;
      const candidates = prices.filter(
        (p) => p.jobType === jobType && p.isActive,
      );
      if (candidates.length === 0) continue;
      const hit =
        candidates.find((p) => p.tier === normalizedTier) ?? candidates[0];
      items.push({
        jobType,
        displayName: hit.displayName,
        count,
        unitPriceCny: hit.unitPriceCny,
        marketPriceCny: hit.marketPriceCny,
        subtotal: Math.round(hit.unitPriceCny * count * 100) / 100,
      });
    }
    const total = Math.round(items.reduce((s, i) => s + i.subtotal, 0) * 100) / 100;
    const marketTotal =
      Math.round(
        items.reduce((s, i) => s + (i.marketPriceCny ?? i.unitPriceCny) * i.count, 0) * 100,
      ) / 100;
    return {
      tier: normalizedTier,
      items,
      total,
      marketTotal,
      saved: Math.round((marketTotal - total) * 100) / 100,
    };
  }
}
