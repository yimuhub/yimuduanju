/* eslint-disable */
/**
 * 计费与官方通道表定义（手写，非 gen:db-schema 生成物）。
 * 与 server/database/schema.ts（自动生成）分离，避免被覆盖。
 * 表结构以 server/database/migrations/*.sql 为准，此处仅为类型安全映射。
 */
import { sql } from 'drizzle-orm';
import { boolean, numeric, pgTable, text, uuid } from 'drizzle-orm/pg-core';
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
 * 同一供应商的多 Key 管理（对标 ArcReel 多 Key：隔离项目/测试生产分离/轮换）。
 * 生效 Key = 该供应商下 is_active 的最新一条；无行时回落 model_providers.apiKey。
 */
export const providerApiKeys = pgTable('provider_api_keys', {
  id: uuid('id').primaryKey().defaultRandom(),
  providerId: uuid('provider_id').notNull(),
  label: text('label').notNull().default('Key'),
  apiKey: text('api_key').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: customTimestamptz('created_at', { precision: 3 }).notNull(),
});

export type ProviderApiKeyRow = typeof providerApiKeys.$inferSelect;

// 保留 sql 导出供调用方拼装聚合查询
export { sql };
