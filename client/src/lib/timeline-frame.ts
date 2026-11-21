/**
 * 时间线帧级工具（纯函数，可单测）
 * -------------------------------------------------------------
 * 这里收口三件事，时间线组件与编辑 Hook 共用同一套规则：
 *   1. 帧量化：显示帧时间码，编辑也必须落帧（之前显示帧、编辑到毫秒）；
 *   2. 时间码解析：可点击输入 00:MM:SS:FF 直接跳到指定帧；
 *   3. 吸附求解：候选点收集 + 片段首尾双向吸附 + 磁吸线位置。
 * 波形重采样也放在这里，保证「缩放不重新请求、按片段宽度切片」。
 */

export const DEFAULT_FPS = 24;
/** 吸附触发阈值（屏幕像素），随缩放换算成秒 */
export const SNAP_PX = 8;

export const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
export const round3 = (n: number) => Math.round(n * 1000) / 1000;

/* ============================ 帧量化 ============================ */

export const secToFrame = (sec: number, fps: number) => Math.round(sec * fps);
export const frameToSec = (frame: number, fps: number) => frame / fps;
/** 四舍五入到最近帧 */
export const quantizeToFrame = (sec: number, fps: number) =>
  frameToSec(secToFrame(sec, fps), Math.max(1, fps));
/** 向下取整到帧（trim 左边缘用，避免越过素材起点） */
export const floorToFrame = (sec: number, fps: number) =>
  frameToSec(Math.floor(sec * fps), Math.max(1, fps));
/** 向上取整到帧 */
export const ceilToFrame = (sec: number, fps: number) =>
  frameToSec(Math.ceil(sec * fps), Math.max(1, fps));

/** 秒 → 00:MM:SS:FF（与 model.toTimecode 同格式，但 fps 可传） */
export function formatTimecode(sec: number, fps = DEFAULT_FPS): string {
  const f = Math.max(1, Math.round(fps));
  const totalFrames = Math.max(0, Math.round(sec * f));
  const ff = totalFrames % f;
  const totalSec = Math.floor(totalFrames / f);
  const ss = totalSec % 60;
  const mm = Math.floor(totalSec / 60) % 60;
  const hh = Math.floor(totalSec / 3600);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(hh)}:${p(mm)}:${p(ss)}:${p(ff)}`;
}

/**
 * 解析用户输入的时间码，返回秒；非法返回 null。
 * 支持：`12.5`（秒）、`0:12.5`（分:秒）、`00:12:08`（分:秒:帧）、`00:00:12:08`（时:分:秒:帧）。
 */
export function parseTimecode(input: string, fps = DEFAULT_FPS): number | null {
  const raw = input.trim();
  if (!raw) return null;
  const parts = raw.split(':');
  if (parts.length === 1) {
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : null;
  }
  if (parts.length === 2) {
    const [m, s] = parts.map((p) => Number(p));
    if (!Number.isFinite(m) || !Number.isFinite(s)) return null;
    return Math.max(0, m * 60 + s);
  }
  if (parts.length === 3) {
    const [m, s, f] = parts.map((p) => Number(p));
    if (![m, s, f].every((n) => Number.isFinite(n))) return null;
    return Math.max(0, m * 60 + s + f / Math.max(1, fps));
  }
  if (parts.length === 4) {
    const [h, m, s, f] = parts.map((p) => Number(p));
    if (![h, m, s, f].every((n) => Number.isFinite(n))) return null;
    return Math.max(0, h * 3600 + m * 60 + s + f / Math.max(1, fps));
  }
  return null;
}

/* ======================= 时间 / 帧显示模式 ======================= */

/**
 * 走带与时间线的读数模式（OpenMotion timeDisplayMode 对齐）：
 *   · time  = 00:MM:SS 时间码 / mm:ss.cs 标尺（默认）；
 *   · frame = 帧号读数，标尺显示帧计数。
 * 选择持久化到 localStorage，预览时间码、时间线状态栏、hover 与标尺共用。
 */
export type TimeDisplayMode = 'time' | 'frame';

export const TIME_DISPLAY_MODE_KEY = 'yimu:om:time-display';
/** 模式切换的跨组件广播事件（预览舞台与时间线互不依赖，靠它同步） */
export const TIME_DISPLAY_EVENT = 'yimu:time-display';

export const readTimeDisplayMode = (): TimeDisplayMode => {
  try {
    return localStorage.getItem(TIME_DISPLAY_MODE_KEY) === 'frame' ? 'frame' : 'time';
  } catch {
    return 'time';
  }
};

export const writeTimeDisplayMode = (mode: TimeDisplayMode) => {
  try {
    localStorage.setItem(TIME_DISPLAY_MODE_KEY, mode);
  } catch {
    /* 隐私模式忽略 */
  }
};

/** 秒 → 帧号（帧显示模式的读数；与 quantizeToFrame 同一取整规则） */
export const frameNumberOf = (sec: number, fps: number) =>
  Math.max(0, Math.round(sec * Math.max(1, fps)));

/* ============================ 吸附 ============================ */

export type SnapKind = 'zero' | 'playhead' | 'clip-start' | 'clip-end' | 'marker' | 'grid';

export interface SnapTarget {
  /** 目标时间（秒） */
  t: number;
  kind: SnapKind;
  /** 展示用标签（磁吸提示） */
  label?: string;
}

export interface SnapTargetInput {
  /** 参与吸附的片段首尾（排除正在拖动的片段自身） */
  clips: Array<{ id?: string; start: number; end: number; label?: string }>;
  playhead: number;
  markers?: number[];
  /** 是否吸附播放头 */
  includePlayhead?: boolean;
}

export function collectSnapTargets(input: SnapTargetInput): SnapTarget[] {
  const targets: SnapTarget[] = [{ t: 0, kind: 'zero', label: '起点' }];
  if (input.includePlayhead !== false) {
    targets.push({ t: input.playhead, kind: 'playhead', label: '播放头' });
  }
  for (const c of input.clips) {
    targets.push({ t: c.start, kind: 'clip-start', label: c.label ?? '片段起点' });
    targets.push({ t: c.end, kind: 'clip-end', label: c.label ?? '片段终点' });
  }
  for (const m of input.markers ?? []) {
    targets.push({ t: m, kind: 'marker', label: '标记' });
  }
  return targets;
}

export interface SnapResult {
  /** 吸附/量化后的片段起点 */
  start: number;
  /** 命中的吸附线位置（用于画磁吸线）；null 表示未吸附 */
  snapAt: number | null;
  /** 命中的目标类型 */
  kind: SnapKind | null;
}

/**
 * 片段拖动吸附：同时尝试「左边缘对齐目标」与「右边缘对齐目标」，取更近者。
 * 最后统一落帧，保证数据与显示一致。
 */
export function snapClipStart(
  start: number,
  span: number,
  targets: SnapTarget[],
  threshold: number,
  fps = DEFAULT_FPS,
): SnapResult {
  let best = Math.max(0, threshold);
  let snappedStart = start;
  let snapAt: number | null = null;
  let kind: SnapKind | null = null;
  for (const t of targets) {
    const dLeft = Math.abs(start - t.t);
    if (dLeft < best) {
      best = dLeft;
      snappedStart = t.t;
      snapAt = t.t;
      kind = t.kind;
    }
    const dRight = Math.abs(start + span - t.t);
    if (dRight < best) {
      best = dRight;
      snappedStart = t.t - span;
      snapAt = t.t;
      kind = t.kind;
    }
  }
  return {
    start: Math.max(0, quantizeToFrame(snappedStart, fps)),
    snapAt,
    kind,
  };
}

/** 修剪边缘吸附：只对单个时间点求解 */
export function snapPoint(
  t: number,
  targets: SnapTarget[],
  threshold: number,
  fps = DEFAULT_FPS,
): { t: number; snapAt: number | null; kind: SnapKind | null } {
  let best = Math.max(0, threshold);
  let out = t;
  let snapAt: number | null = null;
  let kind: SnapKind | null = null;
  for (const target of targets) {
    const d = Math.abs(t - target.t);
    if (d < best) {
      best = d;
      out = target.t;
      snapAt = target.t;
      kind = target.kind;
    }
  }
  return { t: Math.max(0, quantizeToFrame(out, fps)), snapAt, kind };
}

/* ============================ 波形重采样 ============================ */

/** 把任意长度 peaks 重采样到 count 点：放大用线性插值，缩小取窗口峰值 */
export function resamplePeaks(peaks: number[], count: number): number[] {
  if (peaks.length === 0 || count <= 0) return [];
  if (peaks.length === 1) return new Array(count).fill(peaks[0]);
  if (count >= peaks.length) {
    const out = new Array<number>(count);
    const last = peaks.length - 1;
    for (let i = 0; i < count; i += 1) {
      const x = count === 1 ? 0 : (i / (count - 1)) * last;
      const lo = Math.floor(x);
      const hi = Math.min(last, lo + 1);
      out[i] = peaks[lo] + (peaks[hi] - peaks[lo]) * (x - lo);
    }
    return out;
  }
  const out = new Array<number>(count);
  const step = peaks.length / count;
  for (let i = 0; i < count; i += 1) {
    const s = Math.floor(i * step);
    const e = Math.max(s + 1, Math.floor((i + 1) * step));
    let m = 0;
    for (let j = s; j < e && j < peaks.length; j += 1) {
      if (peaks[j] > m) m = peaks[j];
    }
    out[i] = m;
  }
  return out;
}

/**
 * 按片段在源媒体中的 [inPoint, outPoint] 切片，再重采样到 count 点。
 * 波形只请求一次整段 peaks，切片在前端做，缩放/修剪都不必再打后端。
 */
export function slicePeaks(
  peaks: number[],
  duration: number,
  inPoint: number,
  outPoint: number,
  count: number,
): number[] {
  if (peaks.length === 0 || duration <= 0 || count <= 0) return [];
  const a = clamp(inPoint / duration, 0, 1);
  const b = clamp(outPoint / duration, 0, 1);
  const s = Math.floor(a * peaks.length);
  const e = Math.max(s + 1, Math.ceil(b * peaks.length));
  return resamplePeaks(peaks.slice(s, Math.min(peaks.length, e)), count);
}

/* ============================ 轨道静音/独奏 ============================ */

export interface TrackMetaLike {
  track: string;
  lane?: number;
  muted?: boolean;
  solo?: boolean;
  locked?: boolean;
}

/** 某条轨是否发声：有 solo 时只认 solo，否则看 muted */
export function isTrackAudible(
  track: string,
  lane: number,
  metas: TrackMetaLike[],
): boolean {
  if (metas.length === 0) return true;
  const hasSolo = metas.some((m) => m.solo);
  const meta = metas.find((m) => m.track === track && (m.lane ?? 0) === lane);
  if (hasSolo) return meta?.solo === true;
  return meta?.muted !== true;
}

/** 某条轨是否被锁定（禁止编辑） */
export function isTrackLocked(
  track: string,
  lane: number,
  metas: TrackMetaLike[],
): boolean {
  return metas.some((m) => m.track === track && (m.lane ?? 0) === lane && m.locked === true);
}

/**
 * 轨道默认行高。
 * 视频轨要容得下帧缩略图（剪映同类工具普遍 56–80px），音频轨要看得清波形，
 * 字幕轨只有一行字，给 30px 就够。行高可被用户拖动改写，这里只是初值。
 */
export const ROW_HEIGHT_DEFAULT: Record<'video' | 'audio' | 'subtitle' | 'overlay', number> = {
  video: 62,
  audio: 46,
  subtitle: 30,
  overlay: 46,
};

export const ROW_HEIGHT_MIN = 22;
export const ROW_HEIGHT_MAX = 180;

/**
 * 绑定联动时的边界夹紧。
 * 拖动锚点片段，同组搭档跟着平移同样的 delta；但如果往左拖会把某个搭档推到
 * 负数（时间线没有负时间），就把锚点停在「最早搭档刚好到 0」的位置，
 * 而不是让搭档被 Math.max(0, …) 各自截断 —— 后者会把整组的相对间距压坏。
 *
 * @param anchorStart  锚点片段当前起点
 * @param desiredStart 期望的新起点
 * @param partnerStarts 同组搭档的当前起点（不含锚点自己）
 */
export function clampBoundMove(
  anchorStart: number,
  desiredStart: number,
  partnerStarts: number[],
): number {
  const delta = desiredStart - anchorStart;
  if (delta >= 0 || partnerStarts.length === 0) return desiredStart;
  const minPartner = Math.min(...partnerStarts);
  if (minPartner + delta >= 0) return desiredStart;
  return anchorStart - minPartner;
}
