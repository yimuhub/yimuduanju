/**
 * 时间线节拍分析：加载 / 缓存 / 模块级 store（W6 节拍吸附）
 * -------------------------------------------------------------
 * 数据流：工具条「分析节拍」→ loadBeats（G14 analyze-beats 接口）→ 本模块
 * store（beatsByAsset）→ ShenJianTimeline 把节拍换算到时间线坐标，
 * 参与磁吸（优先级：播放头 > 片段边缘 > 节拍 > 标记 > 网格）并画背景竖线。
 *
 * 参考 OpenMotion 的 playerStore.beatAnalysis + timelineSnapping：分析 → 吸附 →
 * 可视化，外加 beat 手动编辑覆盖层（R3：加/删/拖，独立撤销栈，OpenMotion
 * beatEditing 的 added/removed 语义）。
 *
 * 缓存策略（容量小，无清理需求）：
 *   · 模块级 Map 常驻 + localStorage（yimu:beats:<assetId>）持久化——
 *     分析是确定性计算，同一素材结果不变，刷新页面后不重复打接口；
 *   · in-flight 去重：同一 assetId 的并发调用共享同一个 Promise；
 *   · 失败 / 空结果返回 null，30s 短 TTL 静默，避免失败后重试风暴。
 */
import { useSyncExternalStore } from 'react';
import { analyzeBeats } from '@client/src/api/timeline';
import type { TimelineClip } from '@shared/api.interface';

export interface BeatInfo {
  /** 节拍时间点（源媒体内秒，升序） */
  beats: number[];
  /** 估计 BPM；0 = 未能估计 */
  bpm: number;
}

/** 失败记录：reason 用于 toast 展示，failedAt 用于 TTL 判定 */
export interface BeatFailure {
  reason: string;
  failedAt: number;
}

/** 失败后的静默期：期间 loadBeats 直接返回 null，不发新请求 */
export const BEAT_RETRY_TTL_MS = 30_000;

const LS_PREFIX = 'yimu:beats:';

/** useSyncExternalStore 的快照：字段引用在每次发布后都更换，便于 useMemo 感知 */
export interface BeatsSnapshot {
  /** assetId → 已分析的节拍（成功结果） */
  byAsset: ReadonlyMap<string, BeatInfo>;
  /** assetId → 失败原因（TTL 内不再重试） */
  failures: ReadonlyMap<string, BeatFailure>;
  /** 正在分析中的 assetId 集合 */
  loading: ReadonlySet<string>;
  /** assetId → 手动节拍覆盖（R3：加/删/拖，localStorage 持久） */
  manualEdits: ReadonlyMap<string, ManualBeatEdits>;
}

/* ============================ 模块级 store（最小侵入：不进 WorkbenchContext） ============================ */

const byAsset = new Map<string, BeatInfo>();
const failures = new Map<string, BeatFailure>();
const loading = new Set<string>();
/** in-flight 去重：同一 assetId 并发调用共享同一个 Promise */
const inFlight = new Map<string, Promise<BeatInfo | null>>();
/**
 * 清除代数：clearBeats 时 +1，in-flight 结果回来后发现代数变了就丢弃——
 * 否则「清除节拍」后迟到的响应会把节拍重新塞回来。
 */
const loadEpochs = new Map<string, number>();
/** 手动节拍覆盖（R3）：assetId → { added, removed }（源媒体秒） */
const manualByAsset = new Map<string, ManualBeatEdits>();

const listeners = new Set<() => void>();
let snapshot: BeatsSnapshot = { byAsset, failures, loading, manualEdits: manualByAsset };

const subscribeBeats = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
const getBeatsSnapshot = () => snapshot;

/** 状态变化后重建快照（新 Map/Set 引用）再广播，React 才能感知到更新 */
const publish = () => {
  snapshot = {
    byAsset: new Map(byAsset),
    failures: new Map(failures),
    loading: new Set(loading),
    manualEdits: new Map(manualByAsset),
  };
  for (const fn of listeners) fn();
};

/* ============================ localStorage 持久缓存 ============================ */

const readLocalStorage = (assetId: string): BeatInfo | null => {
  try {
    const raw = localStorage.getItem(LS_PREFIX + assetId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { beats?: unknown; bpm?: unknown };
    if (!Array.isArray(parsed.beats) || !parsed.beats.length) return null;
    if (!parsed.beats.every((t) => typeof t === 'number' && Number.isFinite(t))) return null;
    return { beats: parsed.beats as number[], bpm: typeof parsed.bpm === 'number' ? parsed.bpm : 0 };
  } catch {
    // 解析失败 / 隐私模式 / 无 localStorage：当无缓存处理
    return null;
  }
};

const writeLocalStorage = (assetId: string, info: BeatInfo) => {
  try {
    localStorage.setItem(LS_PREFIX + assetId, JSON.stringify(info));
  } catch {
    // 写不进（容量/隐私模式）只影响刷新后的缓存，会话内照常生效
  }
};

/* ============================ 加载（去重 + 失败静默） ============================ */

/**
 * 加载一个素材的节拍（带三层缓存：内存 Map → localStorage → 接口）。
 * 失败 / 空结果返回 null（原因记录在 failures，TTL 内不重试）；
 * 成功返回 BeatInfo 并写入 store，订阅组件自动拿到新快照。
 */
export const loadBeats = async (projectId: string, assetId: string): Promise<BeatInfo | null> => {
  if (!projectId || !assetId) return null;
  const cached = byAsset.get(assetId);
  if (cached) return cached;
  const failure = failures.get(assetId);
  if (failure && Date.now() - failure.failedAt < BEAT_RETRY_TTL_MS) return null;
  const flight = inFlight.get(assetId);
  if (flight) return flight;

  // localStorage 持久缓存命中：直接进 store，不发请求
  const stored = readLocalStorage(assetId);
  if (stored) {
    byAsset.set(assetId, stored);
    publish();
    return stored;
  }

  const promise = (async () => {
    loading.add(assetId);
    publish();
    const epoch = loadEpochs.get(assetId) ?? 0;
    try {
      const res = await analyzeBeats(projectId, assetId);
      if (loadEpochs.get(assetId) !== epoch) return null; // 期间被清除：结果作废
      if (!res.beats.length) {
        // 降级响应（beats 空 + error 说明）与「确实没测到节拍」同语义：
        // 记失败原因 + 短 TTL 静默，避免反复点击反复打接口
        failures.set(assetId, { reason: res.error || '未检测到节拍', failedAt: Date.now() });
        return null;
      }
      const info: BeatInfo = { beats: res.beats, bpm: res.bpm };
      byAsset.set(assetId, info);
      writeLocalStorage(assetId, info);
      return info;
    } catch (err) {
      if (loadEpochs.get(assetId) !== epoch) return null; // 期间被清除：失败也不再记录
      failures.set(assetId, { reason: (err as Error)?.message || '节拍分析失败', failedAt: Date.now() });
      return null;
    } finally {
      loading.delete(assetId);
      inFlight.delete(assetId);
      publish();
    }
  })();
  inFlight.set(assetId, promise);
  return promise;
};

/** 清除一个素材的节拍（内存 + localStorage + 失败记录），工具条「清除节拍」用 */
export const clearBeats = (assetId: string) => {
  byAsset.delete(assetId);
  failures.delete(assetId);
  inFlight.delete(assetId);
  loadEpochs.set(assetId, (loadEpochs.get(assetId) ?? 0) + 1);
  try {
    localStorage.removeItem(LS_PREFIX + assetId);
  } catch {
    // 无 localStorage：内存已清，足够
  }
  publish();
};

/** 读一个素材的失败原因（工具条失败 toast 用，无需等 loadBeats 返回） */
export const beatFailureOf = (assetId: string) => failures.get(assetId)?.reason ?? null;

/** 订阅节拍 store（ShenJianTimeline 吸附与竖线消费，OpenMotion useSyncExternalStore 同款） */
export const useBeatsSnapshot = () =>
  useSyncExternalStore(subscribeBeats, getBeatsSnapshot, getBeatsSnapshot);

/* ============================ 节拍 → 时间线坐标（纯函数，可单测） ============================ */

/** 节拍映射用到的最小片段形状（与 TimelineClip 结构兼容） */
export type BeatSourceClip = Pick<
  TimelineClip,
  'id' | 'track' | 'sourceAssetId' | 'inPoint' | 'outPoint' | 'speed' | 'timelineStart'
>;

/**
 * 把一个片段引用的节拍换算到时间线坐标：
 *   timeline = timelineStart + (beat - inPoint) / speed
 * speed=1 时即「timelineStart - inPoint + beat」。只保留片段范围内的节拍。
 * 倒放（reverse）片段映射语义不同，本版不参与（配乐极少倒放）。
 */
export const mapBeatsToClip = (clip: BeatSourceClip, beats: readonly number[]): number[] => {
  const speed = clip.speed > 0 ? clip.speed : 1;
  const span = Math.max(0, (clip.outPoint - clip.inPoint) / speed);
  const end = clip.timelineStart + span;
  const out: number[] = [];
  for (const beat of beats) {
    const at = clip.timelineStart + (beat - clip.inPoint) / speed;
    if (at >= clip.timelineStart - 1e-6 && at <= end + 1e-6) {
      out.push(Math.round(at * 1000) / 1000);
    }
  }
  return out;
};

/**
 * 当前吸附使用的节拍：时间线上「第一个命中已分析素材」的音频片段
 * （按 timelineStart 升序取首个，OpenMotion 同款「音乐轨节拍即全局节拍」），
 * 把它的节拍映射成时间线坐标。没有命中的已分析素材时返回空数组。
 * 有手动覆盖（R3）时先与 analyzed 合并再映射。
 *
 * excludeId：拖动中的片段自己的节拍会跟着移动，旧位置的一组不参与吸附。
 */
export const activeBeatTimes = (
  clips: readonly BeatSourceClip[],
  beatsByAsset: ReadonlyMap<string, BeatInfo>,
  excludeId?: string | null,
  manualEdits?: ReadonlyMap<string, ManualBeatEdits>,
): number[] => {
  const clip = activeBeatClip(clips, beatsByAsset, excludeId);
  if (!clip) return [];
  const info = beatsByAsset.get(clip.sourceAssetId as string);
  if (!info?.beats.length) return [];
  const edits = manualEdits?.get(clip.sourceAssetId as string);
  return mapBeatsToClip(clip, mergeManualBeats(info.beats, edits));
};

/** 与 activeBeatTimes 同一条选段规则，但返回片段本身（节拍编辑定位源时间用） */
export const activeBeatClip = (
  clips: readonly BeatSourceClip[],
  beatsByAsset: ReadonlyMap<string, BeatInfo>,
  excludeId?: string | null,
): BeatSourceClip | null => {
  const audio = clips
    .filter((c) => c.track === 'audio' && c.sourceAssetId && c.id !== excludeId)
    .sort((a, b) => a.timelineStart - b.timelineStart);
  for (const clip of audio) {
    const info = beatsByAsset.get(clip.sourceAssetId as string);
    if (info?.beats.length) return clip;
  }
  return null;
};

/** 时间线坐标 → 源媒体节拍秒（mapBeatsToClip 的逆运算） */
export const timelineToSourceBeat = (clip: BeatSourceClip, timelineTime: number): number => {
  const speed = clip.speed > 0 ? clip.speed : 1;
  return clip.inPoint + (timelineTime - clip.timelineStart) * speed;
};

/** 源媒体节拍秒 → 时间线坐标（mapBeatsToClip 单点版） */
export const sourceBeatToTimeline = (clip: BeatSourceClip, sourceTime: number): number => {
  const speed = clip.speed > 0 ? clip.speed : 1;
  return clip.timelineStart + (sourceTime - clip.inPoint) / speed;
};

/* ============================ 手动节拍覆盖（R3，OpenMotion beatEditing 对齐） ============================
 * analyzed 是确定性计算结果，用户的加/删/拖记成「覆盖层」，两者合并才是生效节拍：
 *   finalBeats = analyzed（去掉 removed）⊕ added
 * 覆盖按「源媒体秒」存储（与 analyzeBeats 同坐标系），片段挪动 / 修剪后依然成立。
 * localStorage 键：yimu:manual-beats:<assetId>。
 */

export interface ManualBeatEdits {
  /** 手动加的节拍（源媒体秒，升序由 merge 保证） */
  added: number[];
  /** 被手动删掉的 analyzed 节拍（源媒体秒） */
  removed: number[];
}

/** 两个节拍时间差小于该值视为同一个（OpenMotion MATCH_EPS 同款） */
export const BEAT_MATCH_EPS = 0.015;

const MANUAL_LS_PREFIX = 'yimu:manual-beats:';
const EMPTY_EDITS: ManualBeatEdits = { added: [], removed: [] };

const near = (a: number, b: number) => Math.abs(a - b) < BEAT_MATCH_EPS;

/**
 * analyzed ⊕ 手动覆盖 → 生效节拍（纯函数）：
 * analyzed 先剔除 removed，再并入 added（落在已有节拍附近的 added 视为重复丢弃），
 * 结果升序去重、按毫秒取整。
 */
export const mergeManualBeats = (
  analyzed: readonly number[],
  edits?: ManualBeatEdits | null,
): number[] => {
  const removed = edits?.removed ?? [];
  const added = edits?.added ?? [];
  const out: number[] = [];
  for (const t of analyzed) {
    if (removed.some((r) => near(r, t))) continue;
    out.push(Math.round(t * 1000) / 1000);
  }
  for (const t of added) {
    if (out.some((x) => near(x, t))) continue;
    out.push(Math.round(t * 1000) / 1000);
  }
  return out.sort((a, b) => a - b);
};

type EditOp = { edits: ManualBeatEdits; changed: boolean };

/** 在覆盖层上加一个节拍：已有生效节拍附近不加（避免近重复），返回 changed */
export const addBeatToEdits = (edits: ManualBeatEdits | null, time: number, analyzed: readonly number[]): EditOp => {
  const base = edits ?? EMPTY_EDITS;
  const live = mergeManualBeats(analyzed, base);
  if (live.some((t) => near(t, time))) return { edits: base, changed: false };
  return {
    edits: { added: [...base.added, Math.round(time * 1000) / 1000], removed: [...base.removed] },
    changed: true,
  };
};

/** 在覆盖层上删一个节拍：added 直接移除，analyzed 记入 removed；两者都不是则不动 */
export const removeBeatFromEdits = (edits: ManualBeatEdits | null, time: number, analyzed: readonly number[]): EditOp => {
  const base = edits ?? EMPTY_EDITS;
  const at = Math.round(time * 1000) / 1000;
  if (base.added.some((t) => near(t, at))) {
    return { edits: { added: base.added.filter((t) => !near(t, at)), removed: [...base.removed] }, changed: true };
  }
  if ((analyzed ?? []).some((t) => near(t, at))) {
    return { edits: { added: [...base.added], removed: [...base.removed, at] }, changed: true };
  }
  return { edits: base, changed: false };
};

/** 拖动节拍 = 一次覆盖层变更（从 from 挪到 to），撤销时整体还原 */
export const moveBeatInEdits = (
  edits: ManualBeatEdits | null,
  from: number,
  to: number,
  analyzed: readonly number[],
): EditOp => {
  const base = edits ?? EMPTY_EDITS;
  const wasAdded = base.added.some((t) => near(t, from));
  const wasAnalyzed = (analyzed ?? []).some((t) => near(t, from)) && !base.removed.some((t) => near(t, from));
  if (!wasAdded && !wasAnalyzed) {
    // 拖的不是已知节拍：退化为「在 to 加一个」
    return addBeatToEdits(base, to, analyzed);
  }
  const removedFrom = wasAdded
    ? { added: base.added.filter((t) => !near(t, from)), removed: [...base.removed] }
    : { added: [...base.added], removed: [...base.removed, Math.round(from * 1000) / 1000] };
  const op = addBeatToEdits(removedFrom, to, analyzed);
  // 落点被拒（to 与已有生效节拍重合）：整次拖动作废，原样返回，调用方不会提交
  if (!op.changed) return { edits: base, changed: false };
  return op;
};

/* ---------------- 覆盖层读写（内存 + localStorage，全部容错） ---------------- */

const readManualEdits = (assetId: string): ManualBeatEdits | null => {
  try {
    const raw = localStorage.getItem(MANUAL_LS_PREFIX + assetId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { added?: unknown; removed?: unknown };
    const num = (v: unknown) => Array.isArray(v) && v.every((t) => typeof t === 'number' && Number.isFinite(t));
    if (!num(parsed.added) || !num(parsed.removed)) return null;
    return { added: parsed.added as number[], removed: parsed.removed as number[] };
  } catch {
    // 解析失败 / 隐私模式 / node 环境：当无覆盖处理
    return null;
  }
};

const writeManualEdits = (assetId: string, edits: ManualBeatEdits) => {
  try {
    if (!edits.added.length && !edits.removed.length) localStorage.removeItem(MANUAL_LS_PREFIX + assetId);
    else localStorage.setItem(MANUAL_LS_PREFIX + assetId, JSON.stringify(edits));
  } catch {
    // 写不进只影响刷新后的持久化，会话内照常生效
  }
};

const setManualEdits = (assetId: string, edits: ManualBeatEdits) => {
  manualByAsset.set(assetId, edits);
  writeManualEdits(assetId, edits);
  publish();
};

/** 模块加载时把持久化的手动覆盖读回内存（localStorage 不可用时静默跳过） */
try {
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (!key?.startsWith(MANUAL_LS_PREFIX)) continue;
    const edits = readManualEdits(key.slice(MANUAL_LS_PREFIX.length));
    if (edits && (edits.added.length || edits.removed.length)) manualByAsset.set(key.slice(MANUAL_LS_PREFIX.length), edits);
  }
} catch {
  /* node 环境 / 无 localStorage */
}

/* ---------------- 独立撤销栈（模块级，20 条上限，⌘Z 由工作台路由进来） ---------------- */

export interface BeatHistoryEntry {
  label: string;
  at: number;
  changes: Array<{ assetId: string; before: ManualBeatEdits; after: ManualBeatEdits }>;
}

const beatUndoStack: BeatHistoryEntry[] = [];
const beatRedoStack: BeatHistoryEntry[] = [];
/** 节拍编辑的活动窗口：最后一次节拍操作（编辑/撤销/重做）后 5s 内 ⌘Z 归节拍栈 */
export const BEAT_UNDO_WINDOW_MS = 5_000;
export const BEAT_UNDO_LIMIT = 20;
let beatActiveUntil = 0;

const touchBeatActivity = () => {
  beatActiveUntil = Date.now() + BEAT_UNDO_WINDOW_MS;
};

/** ⌘Z 是否该走节拍撤销（有栈 + 在活动窗口内）；工作台键盘层用它做路由 */
export const beatUndoReady = (): boolean =>
  beatUndoStack.length > 0 && Date.now() < beatActiveUntil;
export const beatRedoReady = (): boolean =>
  beatRedoStack.length > 0 && Date.now() < beatActiveUntil;

const pushHistory = (entry: BeatHistoryEntry) => {
  beatUndoStack.push(entry);
  if (beatUndoStack.length > BEAT_UNDO_LIMIT) beatUndoStack.shift();
  beatRedoStack.length = 0;
  touchBeatActivity();
};

const applyHistory = (
  from: BeatHistoryEntry[],
  to: BeatHistoryEntry[],
  pick: (c: BeatHistoryEntry['changes'][number]) => ManualBeatEdits,
): boolean => {
  const entry = from[from.length - 1];
  if (!entry) return false;
  from.pop();
  // 一条历史可含多个素材的变更（重置全部）：整体回滚/前滚
  for (const ch of entry.changes) setManualEdits(ch.assetId, pick(ch));
  to.push(entry);
  touchBeatActivity();
  return true;
};

/** ⌘Z：撤销最近一次节拍编辑（不在窗口内 / 空栈时返回 false，调用方回落到 EDL 撤销） */
export const applyBeatUndo = (): boolean =>
  applyHistory(beatUndoStack, beatRedoStack, (ch) => ch.before);

/** ⌘⇧Z：重做节拍编辑 */
export const applyBeatRedo = (): boolean =>
  applyHistory(beatRedoStack, beatUndoStack, (ch) => ch.after);

/* ---------------- 节拍编辑入口（ShenJianTimeline 调用，立即发布 + 记撤销） ---------------- */

/** 某素材当前生效节拍（analyzed ⊕ 手动覆盖）；没分析过时只有手动加的节拍 */
export const finalBeatTimes = (assetId: string): number[] => {
  const info = byAsset.get(assetId);
  return mergeManualBeats(info?.beats ?? [], manualByAsset.get(assetId));
};

const analyzedOf = (assetId: string): number[] => byAsset.get(assetId)?.beats ?? [];

const commitEdit = (assetId: string, op: EditOp, label: string) => {
  if (!op.changed) return false;
  const before = manualByAsset.get(assetId) ?? EMPTY_EDITS;
  setManualEdits(assetId, op.edits);
  pushHistory({
    label,
    at: Date.now(),
    changes: [{ assetId, before, after: op.edits }],
  });
  return true;
};

/** 在源媒体 time 处加一个节拍（Timeline Alt+单击空白） */
export const addManualBeat = (assetId: string, time: number): boolean =>
  commitEdit(assetId, addBeatToEdits(manualByAsset.get(assetId) ?? null, time, analyzedOf(assetId)), '添加节拍');

/** 删除源媒体 time 处的节拍（右键 beat 点 / Alt+单击 beat 点） */
export const removeManualBeat = (assetId: string, time: number): boolean =>
  commitEdit(assetId, removeBeatFromEdits(manualByAsset.get(assetId) ?? null, time, analyzedOf(assetId)), '删除节拍');

/** 拖动节拍：from → to（源媒体秒，一次撤销） */
export const moveManualBeat = (assetId: string, from: number, to: number): boolean =>
  commitEdit(assetId, moveBeatInEdits(manualByAsset.get(assetId) ?? null, from, to, analyzedOf(assetId)), '移动节拍');

/** 重置手动节拍：清掉覆盖层只留 analyzed（可整体撤销）；不传 assetId 时清全部 */
export const resetManualBeats = (assetId?: string): boolean => {
  const targets = assetId
    ? [assetId]
    : [...new Set([...manualByAsset.keys()])].filter((id) => {
        const e = manualByAsset.get(id);
        return Boolean(e && (e.added.length || e.removed.length));
      });
  const changes = targets
    .filter((id) => {
      const e = manualByAsset.get(id);
      return Boolean(e && (e.added.length || e.removed.length));
    })
    .map((id) => ({ assetId: id, before: manualByAsset.get(id) as ManualBeatEdits, after: EMPTY_EDITS }));
  if (!changes.length) return false;
  for (const ch of changes) setManualEdits(ch.assetId, EMPTY_EDITS);
  pushHistory({ label: '重置手动节拍', at: Date.now(), changes });
  return true;
};

/** 手动覆盖是否有内容（工具条「重置手动节拍」置灰用） */
export const hasManualBeats = (): boolean =>
  [...manualByAsset.values()].some((e) => e.added.length || e.removed.length);
