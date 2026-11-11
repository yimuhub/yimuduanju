/**
 * 镜头参考图编排（纯函数，前后端同源）
 *
 * 为什么必须有这一层：图像模型拿到的只是一个图片数组，它唯一能理解的指认方式是
 * 「图N」（第 N 张）。我们的旧实现把 `` `[图N]` `` 当字符串字面量写进提示词 ——
 * 模型看到的就是「图」「N」三个字符，多图时根本无法把「哪个角色」对应到「哪张图」，
 * 于是三张图全是同一个人、或人物长得像场景里随便一个路人。
 *
 * 对标依据：
 * - ArcReel `lib/prompts/reference_image_numbering.py`：编号即列表位置（从 1 起），
 *   由编排层**机械渲染**一行类型声明 + 把正文 `@[名称]` 替换成对应「图N」；
 *   声明行与真正发出去的参考图必须**等长同序**，否则声明会指认一张没发出去的图。
 *   上一分镜图的角色名固定为 `previous_storyboard`，约束句「只参考构图与色调」。
 * - 火宝 `prompt_generator`：`@角色名` 机械替换为 `@图片3角色名`，顺序固定
 *   场景图 → 角色图 → 道具图。
 * - Toonflow `storyboardImages`：生成前逐项核对「图片顺序与提示词中的引用标记一致」。
 *
 * 顺序约定（按「身份漂移风险」从高到低排）：
 *   角色主图 → 角色角度图 → 场景图 → 道具图 → 上一镜成帧
 * 现实约束：当前部分图片网关只真正透传第一张，所以第一张必须是面部唯一真相，
 * 绝不能是四视图拼图或场景图。
 */

export type ShotRefKind = 'character' | 'location' | 'prop' | 'previous_shot';

/** 默认参考图上限。超过上限时按顺序去尾（与多数后端内截断同序） */
export const SHOT_REF_MAX = 8;

export interface CharacterRefInput {
  id: string;
  name: string;
  /** identity_kit.portraitUrl：面部唯一真相，排第一 */
  primaryUrl?: string | null;
  /** 角度图，调用方按 3/4 侧 → 正 → 侧 → 背 排好 */
  viewUrls?: (string | null | undefined)[] | null;
  /** 身份锁文本（身份描述 / 服装 / 签名细节 / 禁改项 合并） */
  lock?: string;
}

export interface SceneRefInput {
  id: string;
  name: string;
  url?: string | null;
  /** 空间锁文本（建筑 / 陈设 / 光位 / 色调） */
  lock?: string;
}

export interface PropRefInput {
  id: string;
  code?: string | null;
  name: string;
  url?: string | null;
  /** 形制 / 尺度 / 连续性锁 */
  lock?: string;
}

export interface PreviousShotRefInput {
  shotNumber?: number;
  url?: string | null;
}

export interface ComposeShotReferencesInput {
  characters?: CharacterRefInput[];
  scene?: SceneRefInput | null;
  props?: PropRefInput[];
  previousShot?: PreviousShotRefInput | null;
  max?: number;
}

export interface ComposedRef {
  /** 「图1」起，等于在最终参考图数组中的位置 */
  label: string;
  url: string;
  kind: ShotRefKind;
  logicalId: string;
  name: string;
}

export interface ComposeShotReferencesResult {
  /** 与真正发给模型的参考图数组严格等长同序 */
  refs: ComposedRef[];
  /** 类型声明行：`图1、图2为角色「林晚」的参考图…；图4为上一分镜图，只参考构图与色调。` */
  declaration: string;
  /** 逐资产一致性锁块（每块已带真实图号），供拼进【一致性上下文 · 不可变】段 */
  blocks: string[];
  /** 被上限裁掉的数量（>0 时调用方应记 warning） */
  dropped: number;
}

/** 参考图在数组中的位置（从 0 起）对应的「图N」 */
export function referenceLabel(position: number): string {
  return `图${position + 1}`;
}

function clean(v?: string | null): string {
  return typeof v === 'string' ? v.trim() : '';
}

/** 同一个 URL 只允许进一次参考图数组（同一张图出现两次会让图号全部错位） */
function claimUnique(seen: Set<string>, url?: string | null): string | null {
  const u = clean(url);
  if (!u || seen.has(u)) return null;
  seen.add(u);
  return u;
}

/** 按类型分组把图号写成一句人话声明；无参考图时返回空串 */
export function renderReferenceDeclaration(refs: ComposedRef[]): string {
  if (refs.length === 0) return '';
  const parts: string[] = [];
  const characterGroups = new Map<string, { labels: string[]; name: string }>();
  const sceneLabels: string[] = [];
  const sceneNames: string[] = [];
  const propGroups = new Map<string, { labels: string[]; name: string }>();
  const prevLabels: string[] = [];

  for (const r of refs) {
    if (r.kind === 'character') {
      const g = characterGroups.get(r.logicalId) ?? { labels: [], name: r.name };
      g.labels.push(r.label);
      characterGroups.set(r.logicalId, g);
    } else if (r.kind === 'location') {
      if (!sceneNames.includes(r.name)) sceneNames.push(r.name);
      sceneLabels.push(r.label);
    } else if (r.kind === 'prop') {
      const g = propGroups.get(r.logicalId) ?? { labels: [], name: r.name };
      g.labels.push(r.label);
      propGroups.set(r.logicalId, g);
    } else {
      prevLabels.push(r.label);
    }
  }

  for (const g of characterGroups.values()) {
    parts.push(`${g.labels.join('、')}为角色「${g.name}」的参考图（长相、发型、服装逐字一致）`);
  }
  if (sceneLabels.length > 0) {
    parts.push(`${sceneLabels.join('、')}为场景「${sceneNames.join('、')}」的参考图（空间结构、固定陈设、光位与色调一致）`);
  }
  for (const g of propGroups.values()) {
    parts.push(`${g.labels.join('、')}为道具「${g.name}」的参考图（形制、材质与尺度一致）`);
  }
  if (prevLabels.length > 0) {
    parts.push(`${prevLabels.join('、')}为上一分镜图，只参考构图与色调`);
  }
  return `${parts.join('；')}。`;
}

/**
 * 编排一个镜头的参考图：去重、排序、编号、声明、锁块一次算清。
 * 纯函数，不碰数据库，便于单测与前端预演。
 */
export function composeShotReferences(
  input: ComposeShotReferencesInput,
): ComposeShotReferencesResult {
  const max = Math.max(1, Math.min(input.max ?? SHOT_REF_MAX, 16));
  const seen = new Set<string>();
  const entries: { url: string; kind: ShotRefKind; logicalId: string; name: string; lock?: string }[] = [];

  for (const c of input.characters ?? []) {
    const primary = claimUnique(seen, c.primaryUrl);
    if (primary) {
      entries.push({ url: primary, kind: 'character', logicalId: c.id, name: c.name, lock: c.lock });
    }
    for (const v of c.viewUrls ?? []) {
      const angle = claimUnique(seen, v);
      if (angle) {
        entries.push({ url: angle, kind: 'character', logicalId: c.id, name: c.name, lock: c.lock });
      }
    }
  }

  if (input.scene) {
    const sceneUrl = claimUnique(seen, input.scene.url);
    if (sceneUrl) {
      entries.push({
        url: sceneUrl,
        kind: 'location',
        logicalId: input.scene.id,
        name: input.scene.name,
        lock: input.scene.lock,
      });
    }
  }

  for (const p of input.props ?? []) {
    const propUrl = claimUnique(seen, p.url);
    if (!propUrl) continue;
    entries.push({
      url: propUrl,
      kind: 'prop',
      logicalId: p.id,
      name: [clean(p.code), p.name].filter(Boolean).join(' '),
      lock: p.lock,
    });
  }

  if (input.previousShot) {
    const prevUrl = claimUnique(seen, input.previousShot.url);
    if (prevUrl) {
      entries.push({
        url: prevUrl,
        kind: 'previous_shot',
        logicalId: `shot:${input.previousShot.shotNumber ?? ''}`,
        name: input.previousShot.shotNumber ? `镜 ${input.previousShot.shotNumber}` : '上一分镜',
      });
    }
  }

  const dropped = Math.max(0, entries.length - max);
  const kept = entries.slice(0, max);
  const refs: ComposedRef[] = kept.map((e, i) => ({
    label: referenceLabel(i),
    url: e.url,
    kind: e.kind,
    logicalId: e.logicalId,
    name: e.name,
  }));

  // 逐资产锁块：把该资产占用的**全部**图号一起列出（主图 + 角度图同属一人）
  const blocks: string[] = [];
  const byAsset = new Map<string, { kind: ShotRefKind; name: string; labels: string[]; lock?: string }>();
  for (const [i, e] of kept.entries()) {
    const key = `${e.kind}:${e.logicalId}`;
    const g = byAsset.get(key) ?? { kind: e.kind, name: e.name, labels: [], lock: e.lock };
    g.labels.push(referenceLabel(i));
    if (!g.lock && e.lock) g.lock = e.lock;
    byAsset.set(key, g);
  }
  for (const g of byAsset.values()) {
    const labels = g.labels.join('、');
    if (g.kind === 'previous_shot') {
      blocks.push(`${labels} 上一分镜成帧 —— 只参考构图、机位高度与色调，禁止复制人物姿态与表情`);
      continue;
    }
    const kindText = g.kind === 'character' ? '角色' : g.kind === 'location' ? '场景' : '道具';
    const lock = clean(g.lock);
    blocks.push(
      lock
        ? `${labels} ${kindText}「${g.name}」 —— ${lock}（跨镜逐字保持一致，不得改款、改色、改形制）`
        : `${labels} ${kindText}「${g.name}」 —— 严格沿用参考图，不得改款、改色、改形制`,
    );
  }

  return { refs, declaration: renderReferenceDeclaration(refs), blocks, dropped };
}

/**
 * 把正文里的 `@名称` 替换成真实图号（ArcReel / 火宝共同的机械替换）。
 * 对不上参考图的 mention 原样保留裸名，不编造图号 —— 指认一张没发出去的图
 * 会让模型把别的东西当成本资产，比不指认更糟。
 */
export function renderShotMentions(text: string, refs: ComposedRef[]): string {
  if (!text.includes('@') || refs.length === 0) return text;
  const map = new Map<string, string>();
  for (const r of refs) {
    // 同一资产的后续图不覆盖首个图号：指认一律指向第一张
    if (!map.has(r.name)) map.set(r.name, r.label);
    // 道具的 name 是「PROP001 怀表」这种合成串，正文里往往只写 @PROP001 或 @怀表，
    // 所以按空格拆词分别登记别名，否则道具 mention 永远替换不掉。
    for (const token of r.name.split(/\s+/)) {
      const t = token.trim();
      if (t && !map.has(t)) map.set(t, r.label);
    }
  }
  const names = [...map.keys()].sort((a, b) => b.length - a.length);
  if (names.length === 0) return text;
  const escaped = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return text.replace(new RegExp(`@(${escaped.join('|')})`, 'g'), (whole, hit: string) => {
    const label = map.get(hit);
    return label ? `@${label}` : whole;
  });
}

/** 拼装最终提示词：【一致性上下文 · 不可变】+【本镜画面 · 可变】 */
export function buildShotPrompt(variablePart: string, result: ComposeShotReferencesResult): string {
  if (result.refs.length === 0) return variablePart;
  const head: string[] = ['【一致性上下文 · 不可变】'];
  if (result.declaration) head.push(result.declaration);
  head.push(...result.blocks);
  return [head.join('\n'), '', '【本镜画面 · 可变】', renderShotMentions(variablePart, result.refs)].join('\n');
}
