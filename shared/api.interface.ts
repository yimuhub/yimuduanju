export type ProjectStatus =
  | 'draft'
  | 'parsing'
  | 'planning'
  | 'bible_ready'
  | 'storyboard_ready'
  | 'assets_generating'
  | 'video_generating'
  | 'audio_generating'
  | 'editing'
  | 'qc'
  | 'ready'
  | 'exported'
  | 'failed';

export type CreationMode = 'quick' | 'script' | 'professional';
/** 内容模式：general 通用 / drama AI短剧 / ads AI广告片（与创建模式正交） */
export type ContentMode = 'general' | 'drama' | 'ads';
export type { WhitemodelSource } from './content-modes';
export type BudgetMode = 'quality_first' | 'balanced' | 'cost_first' | 'fast_first';
export type ArtStyle =
  | 'realistic'
  | 'live_action'
  | 'anime_2d'
  | 'manhwa'
  | 'chinese_comic'
  | 'otome'
  | 'guofeng_3d'
  | 'xianxia'
  | 'cartoon'
  | 'cg_cyberpunk'
  // S1 ToonFlow 画风移植（11 个全收；traditional_3d 走 PBR 传统色，
  // 与 guofeng_3d 的 UE 华丽路线并存）
  | 'guofeng_2d'
  | 'flat_2d'
  | 'anime_90s'
  | 'urban_romance'
  | 'anime_3d'
  | 'traditional_3d'
  | 'clay_stopmotion'
  | 'guofeng_cyber'
  | 'ancient_real'
  | 'modern_city_real'
  | 'urban_sweet_real';

export type AspectRatio = '9:16' | '16:9' | '4:3' | '3:4' | '21:9' | '1:1';

export interface WorldView {
  era: string;
  geography: string;
  socialRules: string;
  artStyle: string;
  colorSystem: string;
}

export interface StyleBible {
  visualStyle: string;
  cameraLanguage: string;
  colorPalette: string;
  lighting: string;
  texture: string;
  motionLanguage: string;
  subtitleStyle: string;
}

export interface ProjectMetadata {
  totalShots: number;
  totalScenes: number;
  totalCharacters: number;
  estimatedCost: number;
  estimatedTime: number;
  /**
   * 流水线阶段确认门（docs/流程重构方案-v2.md 三道门）：
   * script=剧本确认（过门后物化分镜）、storyboard=分镜确认（过门后批量首帧并
   * 自动连跑 图→视频→配音→剪辑→质检）、final=质检确认（过门后 qc→ready 成片）。
   * 值为通过时间 ISO 字符串；存 metadata 免迁移。
   */
  pipeline?: {
    approvals?: {
      script?: string;
      storyboard?: string;
      final?: string;
    };
  };
}

/**
 * P2-1 系列记忆账本（移植 Dramake series-memory 思想的 v1 简化版）：
 * 人物/场景/关系由现有表实时派生（不存快照，不漂移），不可逆事实（如伤势、
 * 死亡、关系破裂）由人工维护 facts 数组。存于 projects.metadata.series，
 * 免迁移；剧本技能后续可消费（预留）。
 */
export interface SeriesLedger {
  facts: string[];
  updatedAt?: string;
}

export interface Project {
  id: string;
  title: string;
  description?: string;
  status: ProjectStatus;
  mode: CreationMode;
  /** 内容模式：general 通用 / drama 短剧 / ads 广告片（与创建模式正交） */
  contentMode: ContentMode;
  durationSeconds: number;
  aspectRatio: AspectRatio;
  artStyle: ArtStyle;
  genre?: string;
  budgetMode: BudgetMode;
  totalCost: number;
  thumbnailUrl?: string;
  scriptText?: string;
  worldView?: WorldView;
  styleBible?: StyleBible;
  metadata?: ProjectMetadata;
  /** 项目级供应商覆盖（覆盖全局默认；空表示跟随全局） */
  providerOverride?: ProviderOverride | null;
  createdAt: string;
  updatedAt: string;
}

/** 项目级供应商覆盖：指定本项目优先使用的供应商（按名称匹配） */
export interface ProviderOverride {
  providerName?: string;
}

export interface ProjectListItem extends Pick<
  Project,
  'id' | 'title' | 'description' | 'status' | 'mode' | 'durationSeconds' | 'artStyle' | 'thumbnailUrl' | 'totalCost' | 'createdAt' | 'updatedAt'
> {}

export interface CreateProjectRequest {
  title: string;
  description?: string;
  mode: CreationMode;
  contentMode?: ContentMode;
  durationSeconds?: number;
  aspectRatio?: AspectRatio;
  artStyle?: ArtStyle;
  genre?: string;
  budgetMode?: BudgetMode;
  scriptText?: string;
  templateId?: string;
}

export interface UpdateProjectRequest {
  title?: string;
  description?: string;
  status?: ProjectStatus;
  contentMode?: ContentMode;
  durationSeconds?: number;
  aspectRatio?: AspectRatio;
  artStyle?: ArtStyle;
  genre?: string;
  budgetMode?: BudgetMode;
  scriptText?: string;
  worldView?: WorldView;
  styleBible?: StyleBible;
  thumbnailUrl?: string;
  metadata?: ProjectMetadata;
  providerOverride?: ProviderOverride | null;
}

export interface ProjectListParams {
  page?: number;
  pageSize?: number;
  status?: ProjectStatus;
  keyword?: string;
}

export interface ProjectListResponse {
  items: ProjectListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface Dialogue {
  character: string;
  text: string;
  emotion: string;
}

export interface SceneAction {
  description: string;
  character: string;
  duration: number;
}

export interface Character {
  id: string;
  projectId: string;
  name: string;
  roleType: string;
  age?: number;
  gender?: string;
  height?: string;
  bodyType?: string;
  faceFeatures?: string;
  hairstyle?: string;
  costume?: string;
  accessories?: string;
  personality?: string;
  voiceType?: string;
  voiceId?: string;
  canonicalDescription?: string;
  forbiddenChanges?: string;
  referenceImageUrls: string[];
  locked: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCharacterRequest {
  name: string;
  roleType?: string;
  age?: number;
  gender?: string;
  canonicalDescription?: string;
  referenceImageUrls?: string[];
}

export interface UpdateCharacterRequest {
  name?: string;
  roleType?: string;
  age?: number;
  gender?: string;
  height?: string;
  bodyType?: string;
  faceFeatures?: string;
  hairstyle?: string;
  costume?: string;
  accessories?: string;
  personality?: string;
  voiceType?: string;
  voiceId?: string;
  canonicalDescription?: string;
  forbiddenChanges?: string;
  referenceImageUrls?: string[];
  locked?: boolean;
}

export interface Location {
  id: string;
  projectId: string;
  name: string;
  locationType: string;
  timeOfDay: string;
  weather?: string;
  architecture?: string;
  furniture?: string;
  lighting?: string;
  colorPalette?: string;
  description?: string;
  referenceImageUrls: string[];
  locked: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateLocationRequest {
  name: string;
  locationType?: string;
  timeOfDay?: string;
  description?: string;
  referenceImageUrls?: string[];
}

export interface UpdateLocationRequest {
  name?: string;
  locationType?: string;
  timeOfDay?: string;
  weather?: string;
  architecture?: string;
  furniture?: string;
  lighting?: string;
  colorPalette?: string;
  description?: string;
  referenceImageUrls?: string[];
  locked?: boolean;
}

export interface Scene {
  id: string;
  projectId: string;
  sceneNumber: number;
  title?: string;
  locationId?: string;
  timeOfDay?: string;
  summary?: string;
  emotion?: string;
  characterIds: string[];
  dialogues: Dialogue[];
  actions: SceneAction[];
  props: string[];
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface Shot {
  id: string;
  projectId: string;
  sceneId: string;
  shotNumber: number;
  duration: number;
  shotSize: string;
  cameraAngle: string;
  lens: string;
  movement: string;
  subject?: string;
  action?: string;
  emotion?: string;
  dialogue?: string;
  visualPrompt?: string;
  negativePrompt?: string;
  startFrameUrl?: string;
  endFrameUrl?: string;
  /** 白模产线：镜头绑定的白模参考视频（空间关系/运镜路径/时间节奏以此为准） */
  whitemodelUrl?: string;
  /** 白模元数据 { durationSeconds, rigId, movement, source, assetId, createdAt } */
  whitemodelMeta?: WhitemodelMeta;
  referenceImageUrls: string[];
  videoUrl?: string;
  voiceUrl?: string;
  sfxUrls: string[];
  subtitleText?: string;
  characterIds: string[];
  locked: boolean;
  status: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface WhitemodelMeta {
  durationSeconds?: number;
  rigId?: string;
  movement?: string;
  source?: string;
  assetId?: string;
  createdAt?: string;
}

export interface Asset {
  id: string;
  projectId?: string;
  assetType: string;
  name: string;
  fileUrl?: string;
  filePath?: string;
  thumbnailUrl?: string;
  mimeType?: string;
  fileSize?: number;
  durationSeconds?: number;
  width?: number;
  height?: number;
  sourceType: string;
  sourceId?: string;
  generationPrompt?: string;
  generationModel?: string;
  generationSeed?: string;
  version: number;
  parentAssetId?: string;
  status: string;
  locked: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AssetListParams {
  projectId?: string;
  assetType?: string;
  keyword?: string;
  page?: number;
  pageSize?: number;
}

export interface AssetListResponse {
  items: Asset[];
  total: number;
  page: number;
  pageSize: number;
}

export type JobStatus = 'pending' | 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'retrying';
export type JobType = 'text' | 'image' | 'video' | 'tts' | 'parse_script' | 'storyboard' | 'qc' | 'edit' | 'script' | 'boards';

export interface GenerationJob {
  id: string;
  projectId?: string;
  jobType: JobType;
  targetType?: string;
  targetId?: string;
  status: JobStatus;
  progress: number;
  priority: number;
  providerName?: string;
  modelName?: string;
  errorMessage?: string;
  retryCount: number;
  maxRetries: number;
  inputData?: Record<string, unknown>;
  outputData?: Record<string, unknown>;
  cost: number;
  startedAt?: string;
  completedAt?: string;
  externalTaskId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface JobListParams {
  projectId?: string;
  status?: JobStatus;
  jobType?: JobType;
  page?: number;
  pageSize?: number;
}

export interface JobListResponse {
  items: GenerationJob[];
  total: number;
  page: number;
  pageSize: number;
}

export type ProviderType = 'volcengine_ark' | 'openai_proxy' | 'custom' | 'official';
export type FormatType = 'openai' | 'volcengine_ark' | 'mock' | 'agnes';

export interface ModelCapabilities {
  text: boolean;
  image: boolean;
  video: boolean;
  tts: boolean;
  /**
   * 参考视频直喂（R2V）：供应商视频接口是否接受白模/参考视频参数。
   * 默认关闭；开启后视频任务才会把镜头白模（公网 URL）透传给模型，
   * 字段名按 formatType 约定（ark: reference_video_url，其余: reference_video），
   * Key 到位后首次联调时以官方文档为准核对。
   */
  videoReference?: boolean;
}

/** V9 供应商能力自描述：模型支持的时长/尺寸/图片尺寸 */
export interface ProviderModelParams {
  videoDurations?: number[];
  videoSizes?: string[];
  imageSizes?: string[];
  /**
   * Agnes mode 方言映射（默认官方口径 text/keyframe/reference；
   * 部分中转实现方言如 ti2vid/keyframes/multi_reference，按此覆盖）。
   */
  agnesModes?: { text?: string; keyframe?: string; reference?: string };
  /**
   * Agnes keyframes 字段方言：official=first_frame/last_frame（默认），
   * relay=image 数组（≥2 项，不足时首帧重复垫）。
   */
  agnesSchema?: 'official' | 'relay';
}

export interface ModelProvider {
  id: string;
  name: string;
  providerType: ProviderType;
  isDefault: boolean;
  baseUrl?: string;
  textModel?: string;
  imageModel?: string;
  videoModel?: string;
  ttsModel?: string;
  ttsVoice?: string;
  formatType: FormatType;
  capabilities: ModelCapabilities;
  routingPriority: number;
  enabled: boolean;
  /** 附加提示词：每次文本/图片/视频调用自动追加 */
  promptPrefix?: string;
  /**
   * V9 能力自描述：{ videoDurations?: number[], videoSizes?: string[], imageSizes?: string[] }。
   * 生成侧按能力校验（不支持就 fail fast），表单按能力动态渲染。
   */
  modelParams?: ProviderModelParams;
  /** 是否已配置 API Key（Key 本身永不返回前端） */
  hasApiKey: boolean;
  /** 生效 Key 数量（含主 Key 行） */
  activeKeyCount?: number;
  createdAt: string;
  updatedAt: string;
}

/** 供应商 API Key 条目（Key 本身永不返回前端，只返回脱敏标识） */
export interface ProviderApiKeyItem {
  id: string;
  label: string;
  maskedKey: string;
  isActive: boolean;
  createdAt: string;
}

export interface CreateProviderRequest {
  name: string;
  providerType: ProviderType;
  baseUrl?: string;
  apiKey?: string;
  textModel?: string;
  imageModel?: string;
  videoModel?: string;
  ttsModel?: string;
  ttsVoice?: string;
  formatType?: FormatType;
  capabilities?: ModelCapabilities;
  isDefault?: boolean;
  promptPrefix?: string;
  modelParams?: ProviderModelParams;
}

export interface UpdateProviderRequest {
  name?: string;
  baseUrl?: string;
  apiKey?: string;
  textModel?: string;
  imageModel?: string;
  videoModel?: string;
  ttsModel?: string;
  ttsVoice?: string;
  formatType?: FormatType;
  capabilities?: ModelCapabilities;
  isDefault?: boolean;
  enabled?: boolean;
  routingPriority?: number;
  promptPrefix?: string;
  modelParams?: ProviderModelParams;
}

export interface ProviderTestResult {
  success: boolean;
  message: string;
  latencyMs?: number;
  /** 实际命中的请求地址（用户可见，出问题先对这个地址） */
  url?: string;
  /** 请求预览（mode=preview 时返回，不含密钥明文） */
  preview?: {
    url: string;
    method: string;
    headers: Record<string, string>;
    body?: unknown;
  };
}

/** 测试连通性 / 获取模型列表的请求体（不保存，直接用表单参数） */
export interface ProviderConnectionRequest {
  baseUrl: string;
  apiKey?: string;
  formatType?: FormatType;
  /** offline=仅格式校验（零成本）/ preview=渲染将发送的请求（零成本）/ live=真实请求 */
  mode?: 'offline' | 'preview' | 'live';
  /**
   * 已保存的供应商 ID：apiKey 为空时，用该供应商的生效 Key
   * （多 Key 行优先，主 Key 列回落）发起真实请求，前端编辑态透传。
   */
  providerId?: string;
  /** 文本模型名：/models 不可用（404）时，用它做最小文本调用验证连通 */
  model?: string;
}

/** 单个模型条目（OpenAI /models 兼容格式） */
export interface ProviderModelItem {
  id: string;
  object?: string;
  created?: number;
  owned_by?: string;
  /** 启发式归类（按模型名猜：text/image/video/tts/unknown，仅供自动归类参考） */
  kind?: string;
}

/** 获取模型列表结果 */
export interface ProviderFetchModelsResult {
  success: boolean;
  message?: string;
  models?: ProviderModelItem[];
  latencyMs?: number;
}

export interface QcIssue {
  severity: string;
  category: string;
  description: string;
  shotId?: string;
}

export interface QcRecommendation {
  category: string;
  suggestion: string;
}

export interface QcReport {
  id: string;
  projectId: string;
  overallScore: number;
  characterConsistency: number;
  sceneConsistency: number;
  motionQuality: number;
  audioSync: number;
  subtitleAccuracy: number;
  storyCoherence: number;
  technicalQuality: number;
  issues: QcIssue[];
  recommendations: QcRecommendation[];
  pass: boolean;
  thresholdPass: number;
  thresholdReview: number;
  createdAt: string;
}

export type TemplateType = 'duration' | 'genre' | 'style' | 'full';

export interface TemplateConfig {
  shotCount: number;
  shotDuration: number;
  shotSizes: string[];
  cameraMovements: string[];
  voicePreset: string;
  subtitleEnabled: boolean;
}

export interface Template {
  id: string;
  name: string;
  templateType: TemplateType;
  category?: string;
  description?: string;
  thumbnailUrl?: string;
  durationSeconds: number;
  aspectRatio: AspectRatio;
  artStyle?: string;
  genre?: string;
  config?: TemplateConfig;
  isBuiltin: boolean;
  sortOrder: number;
  /** 被使用次数（模板市场运营字段，migration 0002） */
  useCount?: number;
  likeCount?: number;
  reviewStatus?: string;
  createdAt: string;
}

export interface AgentRelatedObject {
  type: string;
  id: string;
  name: string;
}

export interface AgentMessage {
  id: string;
  projectId?: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  agentName?: string;
  relatedObjects?: AgentRelatedObject[];
  createdAt: string;
}

export interface SendAgentMessageRequest {
  content: string;
  agentName?: string;
}

/** 全局助手（无项目上下文，直调文本网关） */
export interface AssistantChatRequest {
  message: string;
}

export interface AssistantChatResponse {
  reply: string;
}

export interface QuickCreateRequest {
  prompt: string;
  durationSeconds: number;
  aspectRatio: AspectRatio;
  artStyle: ArtStyle;
  genre?: string;
  budgetMode: BudgetMode;
  /** 创建模式（默认 quick；专业模式透传 professional） */
  mode?: CreationMode;
  /** 内容模式（默认 general；drama 短剧 / ads 广告片） */
  contentMode?: ContentMode;
  /** 专业模式参数（存入 project.metadata，供剧本物化与后续生成消费） */
  professional?: ProfessionalPrefs;
  /** 一句话模式是否经 LLM 扩写成剧本（默认 true；false 则走离线启发式拆分） */
  expandScript?: boolean;
  /** S2 题材 id：透传给 one_sentence_expand 技能 */
  genreId?: string;
}

/** 专业模式导演参数 */
export interface ProfessionalPrefs {
  /** 目标总镜头数 */
  shotCount?: number;
  /** 单镜头时长（秒） */
  shotDuration?: number;
  /** 景别偏好：mixed（默认）/ closeup / wide */
  shotSizePref?: string;
  /** 运镜风格：static / dynamic / cinematic */
  cameraStyle?: string;
  /** 配音预设 */
  voicePreset?: string;
  /** 是否生成字幕 */
  subtitleEnabled?: boolean;
  /** 剧本改造总开关：false = 忠实转换/启发式拆分，不做吸引力改写（默认 true） */
  rewriteEnabled?: boolean;
  /** 故事风格预设 id（见 GET /api/story-skills），缺省按项目 artStyle 映射 */
  storyStyleId?: string;
}

export interface QuickCreateResponse {
  projectId: string;
  jobId: string;
  status: ProjectStatus;
}

export interface ParseScriptRequest {
  scriptText: string;
  projectId: string;
}

export interface ParseScriptResponse {
  jobId: string;
  status: string;
  charactersCount: number;
  scenesCount: number;
}

/** 剧本技能 id（版本化，见 GET /api/story-skills） */
export type StorySkillId = 'novel_to_script' | 'script_rewrite' | 'one_sentence_expand' | 'ad_creative' | 'scene_to_rig' | 'character_design' | 'script_to_boards';

/** 故事风格预设（visual/negative 直接拼进图片·视频提示词） */
export interface StoryStylePreset {
  id: string;
  artStyle: ArtStyle;
  label: string;
  description: string;
  visual: string;
  negative: string;
  tone: string;
  camera: string;
}

export interface StorySkillInfo {
  id: StorySkillId;
  name: string;
  description: string;
  version: string;
  needsProvider: true;
}

/** S2 题材预设（前端下拉数据源，随 listSkills 返回） */
export interface StoryGenreInfo {
  id: string;
  label: string;
  description: string;
  rules: string[];
}

export interface AdaptNovelRequest {
  novelText: string;
  styleId?: string;
  rewriteEnabled?: boolean;
}

export interface RewriteScriptRequest {
  scriptText?: string;
  directives?: string;
  styleId?: string;
}

export interface ScriptJobResponse {
  jobId: string;
  status: string;
  skillId: StorySkillId;
}

export interface DashboardStats {
  totalProjects: number;
  totalShots: number;
  totalAssets: number;
  totalCost: number;
  runningJobs: number;
  completedToday: number;
}

/** 费用汇总（全部来自 generationJobs.cost 真实落库求和，无估算编造） */
export interface CostSummary {
  /** 历史累计费用（元） */
  totalCost: number;
  /** 本月累计费用（元） */
  monthlyCost: number;
  /** 本月任务总数 */
  monthlyJobs: number;
  /** 按任务类型聚合的本月用量 */
  jobsByType: { jobType: string; count: number; cost: number }[];
  /** 月度预算上限（元，未设置 MONTHLY_BUDGET_CAP_CNY 则为 null 即不限） */
  budgetCap: number | null;
}

/** 价格项（公开信息，不含任何 Key） */
export interface PriceItem {
  modelKey: string;
  jobType: string;
  tier: string;
  displayName: string;
  unit: string;
  unitPriceCny: number;
  marketPriceCny: number | null;
  isActive: boolean;
}

export interface PricingUpdateRequest {
  unitPriceCny?: number;
  marketPriceCny?: number | null;
  isActive?: boolean;
}

/** 官方通道公开信息（apiKey 永不返回） */
export interface OfficialChannelInfo {
  enabled: boolean;
  displayName: string;
  baseUrl?: string;
  hasApiKey: boolean;
  priceVersion: string;
}

export interface OfficialChannelUpdateRequest {
  enabled?: boolean;
  displayName?: string;
  baseUrl?: string;
  apiKey?: string;
}

/** 生成前费用预估 */
export interface CostEstimateRequest {
  tier?: string;
  counts: Partial<Record<JobType, number>>;
}

export interface CostEstimateItem {
  jobType: string;
  displayName: string;
  count: number;
  unitPriceCny: number;
  marketPriceCny: number | null;
  subtotal: number;
}

export interface CostEstimateResponse {
  tier: string;
  items: CostEstimateItem[];
  total: number;
  marketTotal: number;
  saved: number;
}

/** 运维指标（JSON 版 v1，供管理后台/告警消费） */
export interface OpsMetrics {
  jobsByStatus: { status: string; count: number }[];
  last24h: {
    total: number;
    succeeded: number;
    failed: number;
    successRate: number;
    avgCompletionMinutes: number | null;
  };
  monthlySpend: number;
  worker: {
    enabled: boolean;
    mode: string;
    intervalMs: number;
    concurrency: number;
  };
}

export interface GenerationProgress {
  step: string;
  stepLabel: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  progress: number;
  message?: string;
}

export interface ProjectProgressResponse {
  projectId: string;
  overallStatus: ProjectStatus;
  overallProgress: number;
  steps: GenerationProgress[];
  currentStep?: string;
  /** 三道阶段确认门的通过状态（true=已通过） */
  gates?: { script: boolean; storyboard: boolean; final: boolean };
  /** 当前等待用户确认的门（null=无门可过，流水线自动段进行中） */
  nextGate?: 'script' | 'storyboard' | 'final' | null;
}

export interface GenerateImageRequest {
  projectId: string;
  targetType: 'character' | 'location' | 'shot';
  targetId: string;
  prompt?: string;
}

export interface GenerateVideoRequest {
  projectId: string;
  shotId: string;
}

export interface GenerateTTSRequest {
  projectId: string;
  shotId: string;
  text?: string;
  voiceId?: string;
}

export interface RerunShotRequest {
  shotId: string;
  type: 'image' | 'video' | 'voice';
}
