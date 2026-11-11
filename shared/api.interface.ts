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
  /**
   * 视频画面内是否生成字幕/文字（默认 false）。
   * 关闭时提交视频任务会追加“画面无文字”约束，字幕统一由时间线后期烧录。
   */
  videoSubtitles?: boolean;
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

/**
 * 人物视觉资产包 · 行业标准「1 张主图 + 四视图」。
 *
 * 参考 GitHub 上 AI 短剧/漫剧流水线的共识（billpar/ai-cinematic-pipeline 的
 * 7-panel turnaround、siyuan-liu31/agentic-comic-drama-studio 的 visual sheet、
 * worldwonderer/drama-skills 的身份/状态拆分）：
 *  · portraitUrl 是「面部唯一真相」——高清 3/4 正脸特写，纯中性灰背景、平光；
 *  · views 四个独立视角（正 / 3-4 / 侧 / 背）锁轮廓、比例、服装与鞋型；
 *  · sheetUrl 保留旧的「一整张四视图拼图」链路，作为快速定妆的兼容锚点；
 *  · 文本锁（身份描述 / 服装 / 声线 / 签名细节 / 禁改项）逐字复用到每个镜头提示词。
 * 只有 portraitUrl + 四个 views 全部就位，人物才算「完成定义」。
 */
export type CharacterViewKey = 'front' | 'threeQuarter' | 'side' | 'back';

export const CHARACTER_VIEW_KEYS: CharacterViewKey[] = [
  'front',
  'threeQuarter',
  'side',
  'back',
];

export const CHARACTER_VIEW_LABELS: Record<CharacterViewKey, string> = {
  front: '正面全身',
  threeQuarter: '3/4 侧',
  side: '正侧面',
  back: '背面全身',
};

export interface CharacterIdentityKit {
  /** 面部唯一真相：高清 3/4 正脸特写 */
  portraitUrl?: string;
  /** 四个独立视角，可逐张上传 / 生成 / 替换 */
  views: Partial<Record<CharacterViewKey, string>>;
  /** 旧链路兼容：整张四视图拼图 */
  sheetUrl?: string;
  /** 逐字复用的身份锁：脸型、肤色、体态、发型、稳定配色 */
  identityDescriptor?: string;
  /** 服装标识（衣柜基线，换装另建变体） */
  wardrobe?: string;
  /** 声线锁：口音、音色、语速、压力下的变化 */
  voiceLock?: string;
  /** 至少两个不可变签名细节（如银戒、眉骨疤） */
  signatureDetails?: string;
  updatedAt?: string;
}

export const emptyIdentityKit = (): CharacterIdentityKit => ({ views: {} });

/** 人物是否完成定义：一张主图 + 四视图齐全（拼图不算四张独立视图） */
export const isCharacterFullyDefined = (c: Pick<Character, 'identityKit'>): boolean => {
  const kit = c.identityKit;
  if (!kit?.portraitUrl) return false;
  return CHARACTER_VIEW_KEYS.every((k) => !!kit.views?.[k]);
};

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
  /** 人物视觉资产包（主图 + 四视图 + 文本锁） */
  identityKit?: CharacterIdentityKit;
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
  identityKit?: CharacterIdentityKit;
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
  identityKit?: CharacterIdentityKit;
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

/* ==================================================================
 * 道具资产（Prop）· 长篇短剧的第三类可寻址一致性实体
 * ------------------------------------------------------------------
 * 参考 GitHub 项目：
 *  · worldwonderer/drama-skills —— 持续身份(Prop) vs 可变状态(State)、
 *    可读文字政策、持物归属、连续性锁；禁止把「开/关、完好/破损」
 *    拆成两个假道具。
 *  · billpar/ai-cinematic-pipeline —— 跨镜出现的物件必须有独立参考图
 *    和明确的尺度描述（scale reference），否则模型会丢失比例。
 *  · ahang1598/doubao-...-skills —— 只有「关键 / 复现」道具升级为 PROP，
 *    生成前先查 asset_registry，approved 的复用而非重新生成。
 *  · NINKCH/dsh-infinite_canvas —— 设定集里角色/场景/道具卡各有 @tag，
 *    分镜生成后检查未登记实体并自动补全。
 * ================================================================== */
export type PropCategory = 'hero' | 'recurring' | 'stateful' | 'set_dressing';
export const PROP_CATEGORIES: { key: PropCategory; label: string; hint: string }[] = [
  { key: 'hero', label: '关键道具', hint: '推动剧情 / 承担身份或功能，必须出参考图' },
  { key: 'recurring', label: '复现道具', hint: '跨镜多次出现，观众看得出不一致' },
  { key: 'stateful', label: '状态道具', hint: '开合 / 破损 / 内容物 / 转手会变化' },
  { key: 'set_dressing', label: '背景陈设', hint: '仅作环境，通常文字描述即可' },
];

/** 可读文字政策：带文字/标识的道具必须明确选一项，避免下游提示词互相打架 */
export type PropTextPolicy =
  | 'exact_readable'
  | 'graphic_only'
  | 'no_readable_text'
  | 'pending_creator_text';

export const PROP_TEXT_POLICIES: { key: PropTextPolicy; label: string }[] = [
  { key: 'exact_readable', label: '精确可读（保存准确文字）' },
  { key: 'graphic_only', label: '仅留图形轮廓' },
  { key: 'no_readable_text', label: '表面无可读文字' },
  { key: 'pending_creator_text', label: '文字待定（阻断依赖）' },
];

/** 状态变体：同一道具的身份不变，只有状态变化。每个变体有独立 ID 与图。 */
export interface PropStateVariant {
  id: string;
  name: string;
  description: string;
  imageUrl?: string;
}

export interface Prop {
  id: string;
  projectId: string;
  /** 稳定编号 PROP001…，分镜提示词用它做 @tag，改名不会断链 */
  code: string;
  name: string;
  category: PropCategory;
  /** 识别锚点：基本形制、部件关系、主要材料与工艺、永久唯一标记 */
  identityAnchors: string;
  /** 外观：形状 / 颜色 / 材质 / 磨损细节 */
  appearance: string;
  /** 尺度参照：与人体或熟悉物件的可比尺寸，防止模型缩放错锚点 */
  scaleReference: string;
  /** 原本功能与操作方式 */
  functionDesc: string;
  /** 剧情作用 */
  storyRole: string;
  /** 当前持有人 / 归属角色 id */
  ownerCharacterId?: string;
  /** 连续性锁：跨镜不可改变的最小名词短语 */
  continuityLock: string;
  forbiddenChanges: string;
  textPolicy: PropTextPolicy;
  /** textPolicy=exact_readable 时的准确文字 */
  readableText?: string;
  stateVariants: PropStateVariant[];
  referenceImageUrls: string[];
  locked: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePropRequest {
  name: string;
  category?: PropCategory;
  code?: string;
  identityAnchors?: string;
  appearance?: string;
  scaleReference?: string;
  functionDesc?: string;
  storyRole?: string;
  ownerCharacterId?: string;
  continuityLock?: string;
  forbiddenChanges?: string;
  textPolicy?: PropTextPolicy;
  readableText?: string;
  stateVariants?: PropStateVariant[];
  referenceImageUrls?: string[];
}

export interface UpdatePropRequest extends Partial<CreatePropRequest> {
  locked?: boolean;
}

/** 道具是否「可进片」：关键/复现/状态道具必须有参考图与识别锚点 */
export const isPropReady = (p: Prop): boolean =>
  !!p.identityAnchors?.trim() && p.referenceImageUrls.length > 0;

/**
 * 一键生成制作圣经。
 * 剧本来源优先级：请求体 scriptText → projects.scriptText → scenes 汇总 → projects.description。
 * fill（默认）只补空白，保护用户已编辑内容与 locked 设定；overwrite 覆盖文本字段。
 */
export interface GenerateBibleRequest {
  scriptText?: string;
  mode?: 'fill' | 'overwrite';
  providerName?: string;
}

export interface GenerateBibleCounts {
  worldViewFields: number;
  styleFields: number;
  charactersCreated: number;
  charactersUpdated: number;
  locationsCreated: number;
  locationsUpdated: number;
  propsCreated: number;
  propsUpdated: number;
}

export interface GenerateBibleResponse {
  worldView: WorldView;
  styleBible: StyleBible;
  characters: Character[];
  locations: Location[];
  props: Prop[];
  counts: GenerateBibleCounts;
  /** llm = 模型生成；fallback = 无 Key / 模型失败时的确定性草稿 */
  source: 'llm' | 'fallback';
  note?: string;
}

/** 道具页「AI 生成道具」：只从剧本抽道具，不改动世界观/人物/场景 */
export interface GeneratePropsResponse {
  props: Prop[];
  created: number;
  updated: number;
  source: 'llm' | 'fallback';
  note?: string;
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
  /** 线性剪辑：源媒体入点（秒）。分割/修剪时定义取段起点；缺省 0 */
  inPoint?: number;
  /** 线性剪辑：源媒体出点（秒）。缺省 inPoint + duration */
  outPoint?: number;
  /** 当前首帧/成片是否来自 mock 演练通道（占位内容，不计费，导出前需替换） */
  mock?: boolean;
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

/** 因首帧未就绪而被暂停的视频任务（按镜头聚合，供分镜页「一键修复」展示） */
export interface BlockedVideoShot {
  shotId: string;
  shotNumber: number;
  /** waiting=首帧仍在生成；failed=首帧任务失败；missing=首帧任务缺失或产物不可用 */
  reason: 'waiting_first_frame' | 'first_frame_failed' | 'first_frame_missing';
  /** 该镜被暂停的视频任务数 */
  jobCount: number;
  /** 该镜是否已有在途的首帧图片任务（有则不重复发起，避免重复扣费） */
  hasActiveImageJob: boolean;
}

export interface BlockedVideoSummary {
  items: BlockedVideoShot[];
  /** 被暂停的视频任务总数 */
  totalJobs: number;
  /** 需要用户介入（首帧失败/缺失）的镜头数；纯等待中的不计入 */
  needAction: number;
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
  /** 来自 mock 演练通道的占位产物（不计费，不应作为成片交付） */
  mock?: boolean;
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
/**
 * 任务类型：
 * - `asset_prep`：资产前置（清单补齐 + 定妆图排产）。剧本确认后第一个跑，
 *   资产未全就绪时把后续 parse_script 任务置 `blockedReason=waiting_assets`，
 *   由 worker 对账解封 —— 这是「人物/场景必须先有图才出片」的落点。
 */
export type JobType =
  | 'text'
  | 'image'
  | 'video'
  | 'tts'
  | 'parse_script'
  | 'storyboard'
  | 'qc'
  | 'edit'
  | 'script'
  | 'boards'
  | 'asset_prep';

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

/** 对话附件元数据（正文已并入消息 content，供模型与追溯使用） */
export interface ChatAttachmentMeta {
  name: string;
  size?: number;
  chars?: number;
}

export type ChatRole = 'user' | 'agent' | 'system';

export interface ChatMessage {
  id: string;
  sessionId: string;
  role: ChatRole;
  content: string;
  attachments: ChatAttachmentMeta[];
  createdAt: string;
  /** 追溯信息：用户消息的附件正文、助手消息的生成模型 */
  metadata?: {
    attachments?: { name?: string; text?: string }[];
    model?: string;
  } | null;
}

export interface ChatSession {
  id: string;
  projectId: string | null;
  title: string | null;
  kind: 'draft' | 'project';
  createdAt: string;
  updatedAt: string;
}

export interface ChatSessionDetail {
  session: ChatSession;
  messages: ChatMessage[];
}

export interface CreateChatSessionRequest {
  projectId?: string;
  title?: string;
}

export interface LinkChatSessionRequest {
  projectId: string;
  title?: string;
}

/** 流式对话请求：message 已包含用户输入；附件正文由服务端拼接进上下文 */
export interface StreamChatRequest {
  message: string;
  attachments?: { name: string; text?: string; size?: number }[];
}

export interface QuickCreateRequest {
  prompt: string;
  /** 作品名（对话中确认的标题）；缺省用 prompt 截断 */
  title?: string;
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
  /** 视频画面内是否生成字幕/文字（默认 false，字幕后期统一添加） */
  videoSubtitles?: boolean;
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
  /** 最新一次剧本技能任务状态：用于区分「仍在生成 / 已生成待确认 / 生成失败」 */
  scriptJob?: { status: JobStatus; errorMessage?: string } | null;
}

export interface GenerateImageRequest {
  projectId: string;
  targetType: 'character' | 'location' | 'shot' | 'prop';
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

// ============================================================================
// 线性剪辑（Linear Edit）共享契约 —— 前后端共同遵守，勿单方面改动
// ----------------------------------------------------------------------------
// 路由约定（后端实现 / 前端调用）：
//   POST /api/projects/:projectId/storyboard/shots/reorder      ReorderShotsRequest → Shot[]
//   POST /api/projects/:projectId/storyboard/shots/:id/split    SplitShotRequest    → SplitShotResult
//   GET  /api/projects/:projectId/timeline                      → TimelineDocument
//   PUT  /api/projects/:projectId/timeline                      SaveTimelineRequest → TimelineDocument
//   POST /api/projects/:projectId/timeline/export               ExportTimelineRequest → { asset; clips; durationSeconds }
// 片段有效时长 = (outPoint - inPoint) / speed。时间线位置由 timelineStart 显式给出。
// ============================================================================

/** P2 镜头清单：批量重排（按数组顺序重编 sortOrder/shotNumber） */
export interface ReorderShotsRequest {
  shotIds: string[];
}

/** P2 镜头清单：在镜头内某秒处分割成两条（视频文件不切，按入出点取段） */
export interface SplitShotRequest {
  /** 分割点（相对镜头起始的秒数，须 ∈ (0, duration)） */
  atSecond: number;
}

export interface SplitShotResult {
  original: Shot;
  created: Shot;
}

/** P3 EDL 轨道类型 */
export type TimelineTrackKind = 'video' | 'audio' | 'subtitle' | 'overlay';

/** P3 EDL 片段（与生产 shots 解耦的剪辑决策表） */
export interface TimelineClip {
  id: string;
  projectId: string;
  track: TimelineTrackKind;
  /** 来源镜头 id（外部导入素材为空） */
  sourceShotId?: string | null;
  /** 媒体地址（视频/音频/图片） */
  sourceUrl?: string | null;
  /** 素材入点（源媒体内起始秒） */
  inPoint: number;
  /** 素材出点（源媒体内结束秒） */
  outPoint: number;
  /** 时间线上的起始秒 */
  timelineStart: number;
  /**
   * 同类型轨道内的分层下标（0 起）。音频 lane 约定：0 对白 / 1 配乐 / 2 音效；
   * 不同 lane 可同时重叠播出，同 lane 也允许重叠（导出按时间混流）。
   */
  lane?: number;
  /** 播放速率 0.25–4，默认 1 */
  speed: number;
  /** 音量 0–1（音频轨），默认 1 */
  volume: number;
  /** 与下一片段间的转场 */
  transition?: { type: 'none' | 'crossfade' | 'fade'; duration: number } | null;
  /** 字幕文本（字幕轨） */
  text?: string | null;
  locked: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

/** P3 剪辑工程文档 */
export interface TimelineDocument {
  projectId: string;
  fps: number;
  width: number;
  height: number;
  clips: TimelineClip[];
  updatedAt?: string;
}

/** P3 保存工程（整体替换，事务写入）；clip 缺省 id 视为新建 */
export interface SaveTimelineRequest {
  fps?: number;
  width?: number;
  height?: number;
  clips: Array<
    Omit<TimelineClip, 'id' | 'projectId' | 'createdAt' | 'updatedAt'> & { id?: string }
  >;
}

/** P4 按 EDL 导出 */
export interface ExportTimelineRequest {
  width?: number;
  height?: number;
  /** 是否烧录字幕轨，默认 true */
  burnSubtitles?: boolean;
}

export interface ExportTimelineResult {
  asset: Asset;
  clips: number;
  durationSeconds: number;
}
