/**
 * 资产就绪度判定（纯函数，前后端同源）
 *
 * 三家对标项目的共同硬门：**人物 / 场景必须先有定妆图，才允许拆分镜、出首帧**
 * - 火宝（huobao-drama）：`episode.vue` 里 `assetReadyCount === assetTotalCount`
 *   才算资产阶段完成，否则视频阶段不解锁。
 * - ArcReel：`referenced_assets_without_sheet` 非空即阻塞分镜生成。
 * - Toonflow：`baseAssets`（清单，不出图）→ `generateAssets`（出图）→
 *   `storyboardTable`（分镜表）→ `storyboardImages`（分镜图），阶段顺序固定，
 *   清单确认不等同于图片验收，未出图不得进分镜图阶段。
 *
 * 我们的旧实现之所以「前后不连贯」，根因就在这里：
 * 1. `ensureSpeakerCharacters` 只建一张「仅含姓名」的骨架卡，没有任何图；
 * 2. 快速通道注释明写「跳过 bible_ready」，从来没有 characters / locations；
 * 3. 校验用的是 `every()` —— 空数组返回 true，于是「一个人物都没有」也能通过就出片。
 *
 * 本模块把这条判定收敛成唯一真源，Gap 卡 / 圣经页预检 / 分镜放行 / 任务门控共用。
 */

// 视图键与文案的唯一真源在 api.interface，这里只复用不复制，避免两处漂移
import { CHARACTER_VIEW_KEYS, CHARACTER_VIEW_LABELS } from './api.interface';

export type AssetKind = 'character' | 'location' | 'prop';

export interface CharacterAssetFacts {
  id: string;
  name: string;
  roleType?: string | null;
  /** identity_kit.portraitUrl：面部唯一真相 */
  portraitUrl?: string | null;
  /** identity_kit.views：正面 / 3-4 侧 / 侧面 / 背面 四张独立视角 */
  views?: {
    front?: string | null;
    threeQuarter?: string | null;
    side?: string | null;
    back?: string | null;
  } | null;
  /** 旧四视图拼图：只作兼容锚点，不能冒充 4 张独立视角 */
  sheetUrl?: string | null;
  referenceImageUrls?: string[] | null;
}

export interface LocationAssetFacts {
  id: string;
  name: string;
  referenceImageUrls?: string[] | null;
}

export interface PropAssetFacts {
  id: string;
  name: string;
  code?: string | null;
  category?: string | null;
  referenceImageUrls?: string[] | null;
}

export interface AssetReadinessItem {
  kind: AssetKind;
  id: string;
  name: string;
  /** 是否具备出片所需的最低参考图（硬门口径：至少一张能用的图） */
  ready: boolean;
  /** 是否达到完整一致性规格（人物＝主图＋四视角；其余与 ready 同义） */
  complete: boolean;
  /** 缺项的人类可读描述，如 ['主图', '侧面图'] */
  missing: string[];
  /** 只有 blocking 的项才会真正拦住出片（道具默认不拦） */
  blocking: boolean;
}

export interface AssetReadinessSummary {
  total: number;
  readyCount: number;
  blockingCount: number;
  /** 硬门：必须显式有资产、且全部具备最低参考图。空集合返回 false */
  ready: boolean;
  items: AssetReadinessItem[];
  /** 未就绪且会拦路的项 */
  blockers: AssetReadinessItem[];
  /** 未就绪但不拦路的项（如道具缺图） */
  warnings: AssetReadinessItem[];
  /** 一句话人话摘要，直接给 UI 与日志用 */
  summary: string;
}

const VIEW_MISSING_LABELS: Record<string, string> = {
  ...Object.fromEntries(
    Object.entries(CHARACTER_VIEW_LABELS).map(([k, v]) => [k, `${v}图`]),
  ),
};

function urlOf(v?: string | null): string {
  return typeof v === 'string' ? v.trim() : '';
}

function firstUrl(list?: string[] | null): string {
  if (!Array.isArray(list)) return '';
  for (const u of list) if (urlOf(u)) return urlOf(u);
  return '';
}

/**
 * 人物：硬门只看「有没有一张能用的脸」，完整性另算。
 * 之所以不把四视角当硬门 —— 存量项目只有拼图/单图，一刀切会把所有老项目冻死；
 * 而四视角缺失作为 warning 暴露在 Gap 卡里，用户看得到、能补齐。
 */
export function evaluateCharacterAsset(
  input: CharacterAssetFacts,
  opts?: { blocking?: boolean },
): AssetReadinessItem {
  const portrait = urlOf(input.portraitUrl);
  const legacy = urlOf(input.sheetUrl);
  const ref = firstUrl(input.referenceImageUrls);
  const primary = portrait || ref || legacy;
  const missing: string[] = [];
  if (!primary) missing.push('形象主图');
  for (const v of CHARACTER_VIEW_KEYS) {
    if (!urlOf(input.views?.[v])) missing.push(VIEW_MISSING_LABELS[v] ?? v);
  }
  const complete = Boolean(portrait) && CHARACTER_VIEW_KEYS.every((v) => Boolean(urlOf(input.views?.[v])));
  return {
    kind: 'character',
    id: input.id,
    name: input.name,
    ready: Boolean(primary),
    complete,
    missing,
    blocking: opts?.blocking !== false,
  };
}

/** 场景：至少一张空间参考图（构图 / 陈设 / 光位 / 色调的锚点） */
export function evaluateLocationAsset(
  input: LocationAssetFacts,
  opts?: { blocking?: boolean },
): AssetReadinessItem {
  const primary = firstUrl(input.referenceImageUrls);
  return {
    kind: 'location',
    id: input.id,
    name: input.name,
    ready: Boolean(primary),
    complete: Boolean(primary),
    missing: primary ? [] : ['场景参考图'],
    blocking: opts?.blocking !== false,
  };
}

/**
 * 道具：**默认不拦路**。
 * 道具常是可选的装饰性陈设，把它做成硬门会让「一个水杯没图」卡住整集；
 * 只有显式声明 blocking 的关键剧情道具（带状态变体 / 转手 / 消耗）才参与硬门。
 */
export function evaluatePropAsset(
  input: PropAssetFacts,
  opts?: { blocking?: boolean },
): AssetReadinessItem {
  const primary = firstUrl(input.referenceImageUrls);
  return {
    kind: 'prop',
    id: input.id,
    name: input.name,
    ready: Boolean(primary),
    complete: Boolean(primary),
    missing: primary ? [] : ['道具设定图'],
    blocking: opts?.blocking === true,
  };
}

export function evaluateAssetReadiness(items: AssetReadinessItem[]): AssetReadinessSummary {
  const total = items.length;
  const readyCount = items.filter((i) => i.ready).length;
  const blockers = items.filter((i) => !i.ready && i.blocking);
  const warnings = items.filter((i) => !i.ready && !i.blocking);
  // 关键：空集合必须判为未就绪。旧实现 `every()` 对空数组返回 true，
  // 于是「项目里一个人物都没有」也能通过校验直接出片 —— 这是最贵的一个 bug。
  const ready = total > 0 && blockers.length === 0;
  const summary = total === 0
    ? '尚无任何一致性资产，需先完成资产定妆'
    : ready
      ? warnings.length > 0
        ? `资产就绪 ${readyCount}/${total}，${warnings.length} 项可后续补齐`
        : `资产全部就绪 ${readyCount}/${total}`
      : `资产未就绪 ${readyCount}/${total}，${blockers.length} 项阻塞出片`;
  return { total, readyCount, blockingCount: blockers.length, ready, items, blockers, warnings, summary };
}

/** 出片链路的阶段顺序：任何跳级都是流程 bug，不允许再用 priority 变通 */
export const PIPELINE_STAGE_ORDER = [
  'script',
  'assets',
  'storyboard',
  'frames',
  'video',
  'audio',
  'edit',
  'qc',
] as const;

export type PipelineStage = (typeof PIPELINE_STAGE_ORDER)[number];

/** 阶段是否允许进入（前置阶段必须就绪） */
export function canEnterStage(stage: PipelineStage, readyStages: PipelineStage[]): boolean {
  const idx = PIPELINE_STAGE_ORDER.indexOf(stage);
  if (idx <= 0) return true;
  return PIPELINE_STAGE_ORDER.slice(0, idx).every((s) => readyStages.includes(s));
}

/**
 * 单镜放行判定：本镜引用的人物 / 场景是否都具备参考图。
 * 只判 blocking 项，道具缺图不拦（除非调用方显式把它标成关键道具）。
 */
export function shotAssetGate(
  characterIds: string[],
  sceneLocationId: string | null | undefined,
  items: AssetReadinessItem[],
): { ok: boolean; missing: AssetReadinessItem[] } {
  const byId = new Map(items.map((i) => [`${i.kind}:${i.id}`, i]));
  const missing: AssetReadinessItem[] = [];
  for (const cid of characterIds) {
    const hit = byId.get(`character:${cid}`);
    if (!hit || (!hit.ready && hit.blocking)) {
      missing.push(
        hit ?? { kind: 'character', id: cid, name: cid, ready: false, complete: false, missing: ['形象主图'], blocking: true },
      );
    }
  }
  if (sceneLocationId) {
    const hit = byId.get(`location:${sceneLocationId}`);
    if (!hit || (!hit.ready && hit.blocking)) {
      missing.push(
        hit ?? { kind: 'location', id: sceneLocationId, name: sceneLocationId, ready: false, complete: false, missing: ['场景参考图'], blocking: true },
      );
    }
  }
  return { ok: missing.length === 0, missing };
}
