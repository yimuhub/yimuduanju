/* eslint-disable */
/** auto generated, do not edit */
import { sql } from 'drizzle-orm';
import { bigint, boolean, doublePrecision, foreignKey, integer, jsonb, numeric, pgTable, text, uuid, varchar, customType } from "drizzle-orm/pg-core"

export const customTimestamptz = customType<{
  data: Date;
  driverData: string;
  config: { precision?: number };
}>({
  dataType(config) {
    const precision = typeof config?.precision !== 'undefined'
      ? ` (${config.precision})`
      : '';
    return `timestamptz${precision}`;
  },
  toDriver(value: Date | string | number) {
    if (value == null) return value as any;
    if (typeof value === 'number') return new Date(value).toISOString();
    if (typeof value === 'string') return value;
    if (value instanceof Date) return value.toISOString();
    throw new Error('Invalid timestamp value');
  },
  fromDriver(value: string | Date): Date {
    if (value instanceof Date) return value;
    return new Date(value);
  },
});

export const userProfile = customType<{
  data: string;
  driverData: string;
}>({
  dataType() {
    return 'user_profile';
  },
  toDriver(value: string) {
    return sql`ROW(${value})::user_profile`;
  },
  fromDriver(value: string) {
    const [userId] = value.slice(1, -1).split(',');
    return userId.trim();
  },
});

export type FileAttachment = {
  bucket_id: string;
  file_path: string;
};

export const fileAttachment = customType<{
  data: FileAttachment;
  driverData: string;
}>({
  dataType() {
    return 'file_attachment';
  },
  toDriver(value: FileAttachment) {
    return sql`ROW(${value.bucket_id},${value.file_path})::file_attachment`;
  },
  fromDriver(value: string): FileAttachment {
    const [bucketId, filePath] = value.slice(1, -1).split(',');
    return { bucket_id: bucketId.trim(), file_path: filePath.trim() };
  },
});

export function escapeLiteral(str: string): string {
  return "'" + str.replace(/'/g, "''") + "'";
}

export const userProfileArray = customType<{
  data: string[];
  driverData: string;
}>({
  dataType() {
    return 'user_profile[]';
  },
  toDriver(value: string[]) {
    if (!value || value.length === 0) {
      return sql`'{}'::user_profile[]`;
    }
    const elements = value.map(id => `ROW(${escapeLiteral(id)})::user_profile`).join(',');
    return sql.raw(`ARRAY[${elements}]::user_profile[]`);
  },
  fromDriver(value: string): string[] {
    if (!value || value === '{}') return [];
    const inner = value.slice(1, -1);
    const matches = inner.match(/\([^)]*\)/g) || [];
    return matches.map(m => m.slice(1, -1).split(',')[0].trim());
  },
});

export const fileAttachmentArray = customType<{
  data: FileAttachment[];
  driverData: string;
}>({
  dataType() {
    return 'file_attachment[]';
  },
  toDriver(value: FileAttachment[]) {
    if (!value || value.length === 0) {
      return sql`'{}'::file_attachment[]`;
    }
    const elements = value.map(f =>
      `ROW(${escapeLiteral(f.bucket_id)},${escapeLiteral(f.file_path)})::file_attachment`
    ).join(',');
    return sql.raw(`ARRAY[${elements}]::file_attachment[]`);
  },
  fromDriver(value: string): FileAttachment[] {
    if (!value || value === '{}') return [];
    const inner = value.slice(1, -1);
    const matches = inner.match(/\([^)]*\)/g) || [];
    return matches.map(m => {
      const [bucketId, filePath] = m.slice(1, -1).split(',');
      return { bucket_id: bucketId.trim(), file_path: filePath.trim() };
    });
  },
});

export const agentMessages = pgTable("agent_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id"),
  role: varchar("role", { length: 20 }).notNull(),
  content: text("content").notNull(),
  agentName: varchar("agent_name", { length: 50 }),
  /**
   * @type { type: string, id: string, name: string }[]
   */
  relatedObjects: jsonb("related_objects"),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
}, (table) => [
  foreignKey({
    columns: [table.projectId],
    foreignColumns: [projects.id],
    name: "agent_messages_project_id_fkey",
  }).onDelete("cascade"),
]);

export const templates = pgTable("templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 100 }).notNull(),
  templateType: varchar("template_type", { length: 30 }).notNull(),
  category: varchar("category", { length: 50 }),
  description: text("description"),
  thumbnailUrl: text("thumbnail_url"),
  durationSeconds: integer("duration_seconds").default(60),
  aspectRatio: varchar("aspect_ratio", { length: 20 }).default('9:16'),
  artStyle: varchar("art_style", { length: 50 }),
  genre: varchar("genre", { length: 50 }),
  /**
   * @type { shotCount: number, shotDuration: number, shotSizes: string[], cameraMovements: string[], voicePreset: string, subtitleEnabled: boolean }
   */
  config: jsonb("config"),
  isBuiltin: boolean("is_builtin").default(true),
  sortOrder: integer("sort_order").default(0),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const qcReports = pgTable("qc_reports", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull(),
  overallScore: integer("overall_score").default(0),
  characterConsistency: integer("character_consistency").default(0),
  sceneConsistency: integer("scene_consistency").default(0),
  motionQuality: integer("motion_quality").default(0),
  audioSync: integer("audio_sync").default(0),
  subtitleAccuracy: integer("subtitle_accuracy").default(0),
  storyCoherence: integer("story_coherence").default(0),
  technicalQuality: integer("technical_quality").default(0),
  /**
   * @type { severity: string, category: string, description: string, shotId: string }[]
   */
  issues: jsonb("issues"),
  /**
   * @type { category: string, suggestion: string }[]
   */
  recommendations: jsonb("recommendations"),
  pass: boolean("pass").default(false),
  thresholdPass: integer("threshold_pass").default(90),
  thresholdReview: integer("threshold_review").default(80),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
}, (table) => [
  foreignKey({
    columns: [table.projectId],
    foreignColumns: [projects.id],
    name: "qc_reports_project_id_fkey",
  }).onDelete("cascade"),
]);

export const modelProviders = pgTable("model_providers", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 100 }).notNull(),
  providerType: varchar("provider_type", { length: 30 }).notNull(),
  isDefault: boolean("is_default").default(false),
  baseUrl: text("base_url"),
  apiKey: text("api_key"),
  textModel: varchar("text_model", { length: 255 }),
  imageModel: varchar("image_model", { length: 255 }),
  videoModel: varchar("video_model", { length: 255 }),
  ttsModel: varchar("tts_model", { length: 255 }),
  ttsVoice: varchar("tts_voice", { length: 100 }),
  formatType: varchar("format_type", { length: 30 }).default('openai'),
  /**
   * @type { text: boolean, image: boolean, video: boolean, tts: boolean }
   */
  capabilities: jsonb("capabilities"),
  routingPriority: integer("routing_priority").default(10),
  enabled: boolean("enabled").default(true),
  // B2 附加提示词（migration 0011）：每次文本/图片/视频调用自动追加，自愿填写
  promptPrefix: text("prompt_prefix"),
  // V9 能力自描述（migration 0012）：{ videoDurations, videoSizes, imageSizes }
  modelParams: jsonb("model_params"),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
});

export const generationJobs = pgTable("generation_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id"),
  jobType: varchar("job_type", { length: 50 }).notNull(),
  targetType: varchar("target_type", { length: 30 }),
  targetId: uuid("target_id"),
  status: varchar("status", { length: 30 }).notNull().default('pending'),
  progress: integer("progress").default(0),
  priority: integer("priority").default(50),
  providerName: varchar("provider_name", { length: 100 }),
  modelName: varchar("model_name", { length: 255 }),
  /**
   * @type { prompt: string, negativePrompt: string, size: string, duration: number, references: string[] }
   */
  inputData: jsonb("input_data"),
  /**
   * @type { url: string, thumbnailUrl: string, width: number, height: number, duration: number }
   */
  outputData: jsonb("output_data"),
  errorMessage: text("error_message"),
  retryCount: integer("retry_count").default(0),
  maxRetries: integer("max_retries").default(3),
  cost: numeric("cost").default('0'),
  startedAt: customTimestamptz("started_at", { precision: 3 }),
  completedAt: customTimestamptz("completed_at", { precision: 3 }),
  externalTaskId: varchar("external_task_id", { length: 255 }),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
}, (table) => [
  foreignKey({
    columns: [table.projectId],
    foreignColumns: [projects.id],
    name: "generation_jobs_project_id_fkey",
  }).onDelete("cascade"),
]);

export const assets = pgTable("assets", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id"),
  assetType: varchar("asset_type", { length: 30 }).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  fileUrl: text("file_url"),
  filePath: text("file_path"),
  thumbnailUrl: text("thumbnail_url"),
  mimeType: varchar("mime_type", { length: 100 }),
  fileSize: bigint("file_size", { mode: 'number' }),
  durationSeconds: numeric("duration_seconds"),
  width: integer("width"),
  height: integer("height"),
  sourceType: varchar("source_type", { length: 30 }).default('generated'),
  sourceId: varchar("source_id", { length: 255 }),
  generationPrompt: text("generation_prompt"),
  generationModel: varchar("generation_model", { length: 255 }),
  generationSeed: varchar("generation_seed", { length: 50 }),
  /**
   * @type { size: string, steps: number, cfgScale: number, sampler: string }
   */
  generationParams: jsonb("generation_params"),
  version: integer("version").default(1),
  parentAssetId: uuid("parent_asset_id"),
  status: varchar("status", { length: 30 }).default('ready'),
  locked: boolean("locked").default(false),
  /**
   * @type { width: number, height: number, fps: number, codec: string }
   */
  metadata: jsonb("metadata"),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
}, (table) => [
  foreignKey({
    columns: [table.projectId],
    foreignColumns: [projects.id],
    name: "assets_project_id_fkey",
  }).onDelete("cascade"),
  foreignKey({
    columns: [table.parentAssetId],
    foreignColumns: [assets.id],
    name: "assets_parent_asset_id_fkey",
  }).onDelete("set null"),
]);

export const shots = pgTable("shots", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull(),
  sceneId: uuid("scene_id").notNull(),
  shotNumber: integer("shot_number").notNull().default(1),
  duration: numeric("duration").default('4.0'),
  // 线性剪辑（0015）：源媒体入/出点（秒）。NULL 语义：in=0，out=in+duration
  inPoint: numeric("in_point"),
  outPoint: numeric("out_point"),
  shotSize: varchar("shot_size", { length: 30 }).default('medium'),
  cameraAngle: varchar("camera_angle", { length: 30 }).default('eye_level'),
  lens: varchar("lens", { length: 20 }).default('50mm'),
  movement: varchar("movement", { length: 50 }).default('static'),
  subject: text("subject"),
  action: text("action"),
  emotion: varchar("emotion", { length: 50 }),
  dialogue: text("dialogue"),
  visualPrompt: text("visual_prompt"),
  negativePrompt: text("negative_prompt"),
  startFrameUrl: text("start_frame_url"),
  endFrameUrl: text("end_frame_url"),
  // 白模产线（0008）：镜头绑定的白模参考视频 URL + 元数据
  // { durationSeconds, rigId, movement, source, assetId, createdAt }
  whitemodelUrl: text("whitemodel_url"),
  whitemodelMeta: jsonb("whitemodel_meta"),
  referenceImageUrls: text("reference_image_urls").array().default([]),
  videoUrl: text("video_url"),
  voiceUrl: text("voice_url"),
  sfxUrls: text("sfx_urls").array().default([]),
  subtitleText: text("subtitle_text"),
  characterIds: uuid("character_ids").array().default([]),
  locked: boolean("locked").default(false),
  status: varchar("status", { length: 30 }).default('draft'),
  sortOrder: integer("sort_order").default(0),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
}, (table) => [
  foreignKey({
    columns: [table.projectId],
    foreignColumns: [projects.id],
    name: "shots_project_id_fkey",
  }).onDelete("cascade"),
  foreignKey({
    columns: [table.sceneId],
    foreignColumns: [scenes.id],
    name: "shots_scene_id_fkey",
  }).onDelete("cascade"),
]);

export const scenes = pgTable("scenes", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull(),
  sceneNumber: integer("scene_number").notNull().default(1),
  title: varchar("title", { length: 255 }),
  locationId: uuid("location_id"),
  timeOfDay: varchar("time_of_day", { length: 20 }),
  summary: text("summary"),
  emotion: varchar("emotion", { length: 50 }),
  characterIds: uuid("character_ids").array().default([]),
  /**
   * @type { character: string, text: string, emotion: string }[]
   */
  dialogues: jsonb("dialogues"),
  /**
   * @type { description: string, character: string, duration: number }[]
   */
  actions: jsonb("actions"),
  props: text("props").array().default([]),
  sortOrder: integer("sort_order").default(0),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
}, (table) => [
  foreignKey({
    columns: [table.projectId],
    foreignColumns: [projects.id],
    name: "scenes_project_id_fkey",
  }).onDelete("cascade"),
  foreignKey({
    columns: [table.locationId],
    foreignColumns: [locations.id],
    name: "scenes_location_id_fkey",
  }).onDelete("set null"),
]);

export const locations = pgTable("locations", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull(),
  name: varchar("name", { length: 100 }).notNull(),
  locationType: varchar("location_type", { length: 30 }).default('interior'),
  timeOfDay: varchar("time_of_day", { length: 20 }).default('day'),
  weather: varchar("weather", { length: 30 }),
  architecture: text("architecture"),
  furniture: text("furniture"),
  lighting: text("lighting"),
  colorPalette: text("color_palette"),
  description: text("description"),
  referenceImageUrls: text("reference_image_urls").array().default([]),
  locked: boolean("locked").default(false),
  sortOrder: integer("sort_order").default(0),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
}, (table) => [
  foreignKey({
    columns: [table.projectId],
    foreignColumns: [projects.id],
    name: "locations_project_id_fkey",
  }).onDelete("cascade"),
]);

export const characters = pgTable("characters", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull(),
  name: varchar("name", { length: 100 }).notNull(),
  roleType: varchar("role_type", { length: 30 }).default('supporting'),
  age: integer("age"),
  gender: varchar("gender", { length: 20 }),
  height: varchar("height", { length: 20 }),
  bodyType: varchar("body_type", { length: 50 }),
  faceFeatures: text("face_features"),
  hairstyle: text("hairstyle"),
  costume: text("costume"),
  accessories: text("accessories"),
  personality: text("personality"),
  voiceType: varchar("voice_type", { length: 50 }),
  voiceId: varchar("voice_id", { length: 100 }),
  canonicalDescription: text("canonical_description"),
  forbiddenChanges: text("forbidden_changes"),
  referenceImageUrls: text("reference_image_urls").array().default([]),
  locked: boolean("locked").default(false),
  sortOrder: integer("sort_order").default(0),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
}, (table) => [
  foreignKey({
    columns: [table.projectId],
    foreignColumns: [projects.id],
    name: "characters_project_id_fkey",
  }).onDelete("cascade"),
]);

export const projects = pgTable("projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description"),
  status: varchar("status", { length: 50 }).notNull().default('draft'),
  mode: varchar("mode", { length: 30 }).notNull().default('quick'),
  // 双模式产线（0009）：内容模式 general/drama/ads，与创建模式正交
  contentMode: varchar("content_mode", { length: 20 }).notNull().default('general'),
  durationSeconds: integer("duration_seconds").default(90),
  aspectRatio: varchar("aspect_ratio", { length: 20 }).default('9:16'),
  artStyle: varchar("art_style", { length: 50 }).default('realistic'),
  genre: varchar("genre", { length: 50 }),
  budgetMode: varchar("budget_mode", { length: 30 }).default('balanced'),
  totalCost: numeric("total_cost").default('0'),
  thumbnailUrl: text("thumbnail_url"),
  scriptText: text("script_text"),
  /**
   * @type { era: string, geography: string, socialRules: string, artStyle: string, colorSystem: string }
   */
  worldView: jsonb("world_view"),
  /**
   * @type { visualStyle: string, cameraLanguage: string, colorPalette: string, lighting: string, texture: string, motionLanguage: string, subtitleStyle: string }
   */
  styleBible: jsonb("style_bible"),
  /**
   * @type { totalShots: number, totalScenes: number, totalCharacters: number, estimatedCost: number, estimatedTime: number }
   */
  metadata: jsonb("metadata"),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
});

// table aliases
export const agentMessagesTable = agentMessages;
export const assetsTable = assets;
export const charactersTable = characters;
export const generationJobsTable = generationJobs;
export const locationsTable = locations;
export const modelProvidersTable = modelProviders;
export const projectsTable = projects;
export const qcReportsTable = qcReports;
export const scenesTable = scenes;
export const shotsTable = shots;
export const templatesTable = templates;

// F2 本地向量记忆（migration 0010）：MiniLM 384 维，无 Key 可用
export const memoryChunks = pgTable("memory_chunks", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull(),
  kind: varchar("kind", { length: 30 }).notNull().default('fact'),
  text: text("text").notNull(),
  embedding: doublePrecision("embedding").array(),
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  foreignKey({
    columns: [table.projectId],
    foreignColumns: [projects.id],
    name: "memory_chunks_project_id_fkey",
  }).onDelete("cascade"),
]);
export const memoryChunksTable = memoryChunks;

// B1 分环节模型绑定（migration 0011）：stage 主键，未绑定回落供应商默认
export const stageModelBindings = pgTable("stage_model_bindings", {
  stage: varchar("stage", { length: 20 }).primaryKey(),
  providerId: uuid("provider_id"),
  model: varchar("model", { length: 200 }),
  temperature: numeric("temperature", { precision: 3, scale: 2 }),
  maxTokens: integer("max_tokens"),
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  foreignKey({
    columns: [table.providerId],
    foreignColumns: [modelProviders.id],
    name: "stage_model_bindings_provider_id_fkey",
  }).onDelete("set null"),
]);
export const stageModelBindingsTable = stageModelBindings;

// W6 企业版审计（migration 0003_audit.sql）：AuditInterceptor 写变更操作；
// 表已存在（无需新迁移），此处仅补 drizzle 类型安全映射。注意：schema.ts 标注为自动生成，
// 若后续重新执行 gen:db-schema，本段手工映射可能被覆盖，请检查。
export const auditLogs = pgTable("audit_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  actor: text("actor"),
  action: text("action").notNull(),
  resourceType: text("resource_type"),
  resourceId: text("resource_id"),
  detail: jsonb("detail"),
  createdAt: customTimestamptz("created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
});
export const auditLogsTable = auditLogs;

/* ================= 3.0 harness 化：skill 注册表 + Agent 注册表 ================= */

export const skills = pgTable("skills", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  line: text("line").notNull().default("common"),
  slot: text("slot").notNull().default("common"),
  description: text("description").notNull().default(""),
  body: text("body").notNull().default(""),
  enabled: boolean("enabled").notNull().default(true),
  version: integer("version").notNull().default(1),
  source: text("source").notNull().default("builtin"),
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const agentRegistry = pgTable("agents", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  avatar: text("avatar").notNull().default("🤖"),
  persona: text("persona").notNull().default(""),
  skillSlugs: jsonb("skill_slugs").notNull().default([]),
  tools: jsonb("tools").notNull().default([]),
  sort: integer("sort").notNull().default(100),
  enabled: boolean("enabled").notNull().default(true),
  source: text("source").notNull().default("builtin"),
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
});

/* ================= 线性剪辑 EDL（migration 0016） =================
 * 注意：schema.ts 标注为自动生成，若后续重新执行 gen:db-schema，
 * 本段手工映射可能被覆盖，请检查（同 auditLogs 段的约定）。 */

// 时间线文档：有行 = 项目已保存过 EDL（哪怕 0 条片段）；fps/画幅持久化在此
export const timelineDocuments = pgTable("timeline_documents", {
  projectId: uuid("project_id").primaryKey(),
  fps: integer("fps").notNull().default(24),
  width: integer("width").notNull().default(1080),
  height: integer("height").notNull().default(1920),
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  createdBy: userProfile("_created_by"),
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedBy: userProfile("_updated_by"),
}, (table) => [
  foreignKey({
    columns: [table.projectId],
    foreignColumns: [projects.id],
    name: "timeline_documents_project_id_fkey",
  }).onDelete("cascade"),
]);
export const timelineDocumentsTable = timelineDocuments;

// EDL 片段：与生产 shots 解耦的剪辑决策表；有效时长 = (outPoint-inPoint)/speed
export const timelineClips = pgTable("timeline_clips", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull(),
  track: varchar("track", { length: 20 }).notNull().default('video'),
  sourceShotId: uuid("source_shot_id"),
  sourceUrl: text("source_url"),
  inPoint: numeric("in_point").notNull().default('0'),
  outPoint: numeric("out_point").notNull().default('0'),
  timelineStart: numeric("timeline_start").notNull().default('0'),
  // 同类型轨道内的分层（音频 0=对白/1=配乐/2=音效），不同 lane 可重叠
  lane: integer("lane").notNull().default(0),
  speed: numeric("speed").notNull().default('1'),
  volume: numeric("volume").notNull().default('1'),
  /**
   * @type { type: 'none' | 'crossfade' | 'fade', duration: number } | null
   */
  transition: jsonb("transition"),
  text: text("text"),
  locked: boolean("locked").notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  createdBy: userProfile("_created_by"),
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedBy: userProfile("_updated_by"),
}, (table) => [
  foreignKey({
    columns: [table.projectId],
    foreignColumns: [projects.id],
    name: "timeline_clips_project_id_fkey",
  }).onDelete("cascade"),
  foreignKey({
    columns: [table.sourceShotId],
    foreignColumns: [shots.id],
    name: "timeline_clips_source_shot_id_fkey",
  }).onDelete("set null"),
]);
export const timelineClipsTable = timelineClips;

// 0018 对话持久化：草稿会话（project_id 为空）+ 项目会话；消息只增不改，保证可追溯
export const chatSessions = pgTable("chat_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id"),
  title: varchar("title", { length: 255 }),
  kind: varchar("kind", { length: 20 }).notNull().default('draft'),
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  foreignKey({
    columns: [table.projectId],
    foreignColumns: [projects.id],
    name: "chat_sessions_project_id_fkey",
  }).onDelete("cascade"),
]);
export const chatSessionsTable = chatSessions;

export const chatMessages = pgTable("chat_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  sessionId: uuid("session_id").notNull(),
  role: varchar("role", { length: 20 }).notNull(),
  content: text("content").notNull(),
  attachments: jsonb("attachments").default([]),
  metadata: jsonb("metadata"),
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  foreignKey({
    columns: [table.sessionId],
    foreignColumns: [chatSessions.id],
    name: "chat_messages_session_id_fkey",
  }).onDelete("cascade"),
]);
export const chatMessagesTable = chatMessages;
