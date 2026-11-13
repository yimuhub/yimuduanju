/* eslint-disable */
/**
 * 计费与官方通道表定义（手写，非 gen:db-schema 生成物）。
 * 与 server/database/schema.ts（自动生成）分离，避免被覆盖。
 * 表结构以 server/database/migrations/*.sql 为准，此处仅为类型安全映射。
 */
import { sql } from 'drizzle-orm';
import { boolean, integer, numeric, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { customTimestamptz } from './schema';

export const officialChannel = pgTable('official_channel', {
  id: text('id').primaryKey().default('default'),
  enabled: boolean('enabled').notNull().default(false),
  displayName: text('display_name').notNull().default('官方直供通道'),
  baseUrl: text('base_url'),
  apiKey: text('api_key'),
  priceVersion: text('price_version').notNull().default('v1'),
  createdAt: customTimestamptz('created_at', { precision: 3 }).notNull(),
  updatedAt: customTimestamptz('updated_at', { precision: 3 }).notNull(),
});

export const modelPricing = pgTable('model_pricing', {
  id: uuid('id').primaryKey().defaultRandom(),
  modelKey: text('model_key').notNull().unique(),
  jobType: text('job_type').notNull(),
  tier: text('tier').notNull().default('balanced'),
  displayName: text('display_name').notNull(),
  unit: text('unit').notNull().default('call'),
  unitPriceCny: numeric('unit_price_cny').notNull().default('0'),
  marketPriceCny: numeric('market_price_cny'),
  isActive: boolean('is_active').notNull().default(true),
  updatedAt: customTimestamptz('updated_at', { precision: 3 }).notNull(),
});

export type OfficialChannelRow = typeof officialChannel.$inferSelect;
export type ModelPricingRow = typeof modelPricing.$inferSelect;

/**
 * 同一供应商的多 Key 密钥池（migration 0023）。
 *
 * 旧语义「is_active 最新一条生效」是单 Key 二选一，加 N 把也只跑 1 把；
 * 现在每把 Key 是一条独立「车道」：
 *  - enabled 控制是否参与调度；
 *  - concurrency 是该车道的并发额度（视频默认 1，自动探测会在其上下浮动）；
 *  - in_flight 在途计数（领 Key 时原子 +1，结束/冷却 -1）；
 *  - status + cooldown_until 做「按 Key 冷却」，限流只冻这一把；
 *  - is_active 保留为「历史激活标记」，不再作为调度依据。
 * 无任何 Key 行时回落 model_providers.apiKey（主 Key 列）。
 */
export const providerApiKeys = pgTable('provider_api_keys', {
  id: uuid('id').primaryKey().defaultRandom(),
  providerId: uuid('provider_id').notNull(),
  label: text('label').notNull().default('Key'),
  apiKey: text('api_key').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  /** 是否参与调度（false=停用，不参与领 Key） */
  enabled: boolean('enabled').notNull().default(true),
  /** 该 Key 的并发额度：视频默认 1；自动探测会在此值上下浮动 */
  concurrency: integer('concurrency').notNull().default(1),
  /** 当前在途任务数；领 Key 时原子 +1，结束/冷却时 -1 */
  inFlight: integer('in_flight').notNull().default(0),
  /** active=可用；cooldown=限流冷却中；invalid=鉴权失效 */
  status: text('status').notNull().default('active'),
  cooldownUntil: customTimestamptz('cooldown_until', { precision: 3 }),
  lastUsedAt: customTimestamptz('last_used_at', { precision: 3 }),
  lastError: text('last_error'),
  priority: integer('priority').notNull().default(0),
  createdAt: customTimestamptz('created_at', { precision: 3 }).notNull(),
});

export type ProviderApiKeyRow = typeof providerApiKeys.$inferSelect;

// 保留 sql 导出供调用方拼装聚合查询
export { sql };
