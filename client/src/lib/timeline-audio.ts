/**
 * 时间线音频纯函数（可单测）
 * -------------------------------------------------------------
 * 这里收口两件事，时间线 UI / 预览 / 导出共用同一套语义：
 *   1. 音量包络取值：volumeAt 按片段内相对时间线性插值（预览每帧调用）；
 *   2. 人声避让：collectVoiceRegions 找出「人声语义」的片段区间，
 *      buildDuckEnvelope 把它们换算成音乐片段的压低包络（G15）。
 *
 * 包络数据模型与导出表达式构建在 @shared/timeline-audio-expr（客户端与
 * 服务端共用），这里只做客户端侧的派生。
 */
import {
  normalizeVolumePoints,
  volumeAt as volumeAtShared,
  type TimelineVolumePoint,
} from '@shared/timeline-audio-expr';
import type { TimelineClip } from '@shared/api.interface';

export { normalizeVolumePoints, volumeAt } from '@shared/timeline-audio-expr';
export type { TimelineVolumePoint, TimelineVolumeAutomation } from '@shared/timeline-audio-expr';

/** 片段在时间线上的有效时长（与 model.clipSpan 同式；lib 不反向依赖组件层） */
const spanOf = (c: Pick<TimelineClip, 'inPoint' | 'outPoint' | 'speed'>) =>
  Math.max(0, (c.outPoint - c.inPoint) / (c.speed > 0 ? c.speed : 1));

/**
 * 音频角色（与 model.audioRoleOf 同约定）：lane 0 对白 / 1 配乐 / 2 音效。
 * lib 层不反向 import 组件层，这里按同一约定内联一份最小判定。
 */
const roleOf = (clip: Pick<TimelineClip, 'track' | 'lane'>): 'voice' | 'music' | 'sfx' | null => {
  if (clip.track !== 'audio') return null;
  const lane = clip.lane ?? 0;
  if (lane <= 0) return 'voice';
  if (lane === 1) return 'music';
  return 'sfx';
};

/* ============================ 人声避让（G15） ============================ */

/** 人声活跃区间（时间线绝对秒） */
export interface VoiceRegion {
  start: number;
  end: number;
}

/** 文本里带这些词的音频片段按人声算（「♪ 人声 ·」是人声分离写的标记） */
export const VOICE_TEXT_RE = /人声|旁白|配音|对白|独白|voice|narration/i;

/** 避让参数：人声区间内压到 25%，起 0.15s 淡入、终 0.3s 淡出 */
export const DUCK_LEVEL = 0.25;
export const DUCK_FADE_IN = 0.15;
export const DUCK_FADE_OUT = 0.3;

/** 判定一条音频片段是否「人声语义」：lane 0 对白轨，或文本带人声关键词 */
export function isVoiceClip(clip: Pick<TimelineClip, 'track' | 'lane' | 'text'>): boolean {
  if (clip.track !== 'audio') return false;
  if (clip.text && VOICE_TEXT_RE.test(clip.text)) return true;
  return roleOf(clip) === 'voice';
}

/**
 * 收集时间线上所有「人声语义」片段的活跃区间（时间线绝对秒）。
 * 语义（实现说明）：
 *   · 项目已有音频角色分类（audioRoleOf：lane 0 对白 / 1 配乐 / 2 音效），
 *     所以人声 = 对白轨片段 ∪ 文本带人声/旁白/配音关键词的片段；
 *   · 内嵌原声（auto: 音频片段）与音画分离后的 av: 片段都是普通音频片段，
 *     落在对白轨时天然参与；
 *   · 配乐轨（music）不参与——避让的对象就是配乐自己；
 *   · 停用片段不发声，跳过。
 */
export function collectVoiceRegions(
  clips: Pick<TimelineClip, 'id' | 'track' | 'lane' | 'text' | 'timelineStart' | 'inPoint' | 'outPoint' | 'speed' | 'enabled'>[],
  excludeId?: string,
): VoiceRegion[] {
  const raw: VoiceRegion[] = [];
  for (const clip of clips) {
    if (excludeId && clip.id === excludeId) continue;
    if (clip.enabled === false) continue;
    if (!isVoiceClip(clip)) continue;
    const span = spanOf(clip);
    if (span <= 0) continue;
    raw.push({ start: clip.timelineStart, end: clip.timelineStart + span });
  }
  // 排序 + 合并重叠/相邻区间（间隙小于淡入+淡出时合一段，包络不会来回抖）
  const sorted = [...raw].sort((a, b) => a.start - b.start);
  const merged: VoiceRegion[] = [];
  const mergeGap = DUCK_FADE_IN + DUCK_FADE_OUT;
  for (const r of sorted) {
    const last = merged[merged.length - 1];
    if (last && r.start - last.end < mergeGap) {
      last.end = Math.max(last.end, r.end);
    } else {
      merged.push({ ...r });
    }
  }
  return merged;
}

export interface DuckEnvelopeInput {
  /** 目标片段在时间线上的起点（秒） */
  clipStart: number;
  /** 片段有效时长（秒，clipSpan） */
  span: number;
  /** 人声活跃区间（时间线绝对秒，collectVoiceRegions 的输出） */
  voiceRegions: VoiceRegion[];
  fps: number;
  /** 压低后的音量倍率，默认 0.25 */
  duckLevel?: number;
}

/**
 * 生成音乐片段的避让包络点（片段内相对秒，帧量化）：
 * 人声活跃区间内压到 duckLevel，区间外保持 1.0；
 * 起点前 0.15s 淡入、终点后 0.3s 淡出，贴着片段端点时按线性斜率截断。
 * 没有落在片段内的人声区间返回 null（调用方提示「没有人声」）。
 */
export function buildDuckEnvelope(input: DuckEnvelopeInput): TimelineVolumePoint[] | null {
  const { clipStart, span, voiceRegions, fps } = input;
  const duck = Math.max(0, Math.min(1, input.duckLevel ?? DUCK_LEVEL));
  const safeSpan = Math.max(0, Number(span) || 0);
  if (safeSpan <= 0) return null;
  // 换算成片段内相对区间，并丢弃不落在片段内的
  const rel: VoiceRegion[] = [];
  for (const r of voiceRegions) {
    const a = Math.max(0, r.start - clipStart);
    const b = Math.min(safeSpan, r.end - clipStart);
    if (b - a < 1 / Math.max(1, fps)) continue;
    rel.push({ start: a, end: b });
  }
  if (rel.length === 0) return null;
  const points: TimelineVolumePoint[] = [];
  for (const r of rel) {
    // 淡入：起点前 0.15s 从 1.0 降到 duck；贴着片段开头时沿斜率截断，不在端点跳变
    const fadeInStart = r.start - DUCK_FADE_IN;
    if (fadeInStart >= 0) points.push({ t: fadeInStart, v: 1 });
    else points.push({ t: 0, v: 1 + (duck - 1) * Math.max(0, Math.min(1, -fadeInStart / DUCK_FADE_IN)) });
    points.push({ t: r.start, v: duck });
    points.push({ t: r.end, v: duck });
    // 淡出：终点后 0.3s 从 duck 回到 1.0；超出片段时同样沿斜率截断
    const fadeOutEnd = r.end + DUCK_FADE_OUT;
    if (fadeOutEnd <= safeSpan) points.push({ t: fadeOutEnd, v: 1 });
    else points.push({ t: safeSpan, v: duck + (1 - duck) * Math.max(0, Math.min(1, (safeSpan - r.end) / DUCK_FADE_OUT)) });
  }
  return normalizeVolumePoints(points, safeSpan, fps);
}

/** 片段当前是否挂了包络（≥2 点才有形状；1 点视为无） */
export function hasVolumeAutomation(
  clip: Pick<TimelineClip, 'volumeAutomation'> | undefined,
): boolean {
  const points = clip?.volumeAutomation?.points;
  return Array.isArray(points) && points.length >= 2;
}

/** 片段在相对时间 t 的最终音量倍率：包络 × clip.volume（无包络即 clip.volume） */
export function clipGainAt(clip: TimelineClip, clipRelativeT: number): number {
  const base = Math.max(0, Math.min(2, clip.volume ?? 1));
  const env = volumeAtShared(clip.volumeAutomation?.points ?? null, clipRelativeT);
  return Math.max(0, Math.min(2, base * env));
}

/* ============================ 片段淡入淡出（G11） ============================ */

/**
 * 片段头/尾线性淡变倍率（0→1 / 1→0），t 为片段内相对秒。
 * 与包络叠乘：最终增益 = clipGainAt × fadeFactorAt（fade 乘在包络结果之上），
 * 预览（ShenJianStage）与导出（afade/fade 滤镜）共用同一语义。
 */
export function fadeFactorAt(
  clip: Pick<TimelineClip, 'fadeIn' | 'fadeOut'>,
  clipRelativeT: number,
  span: number,
): number {
  const spanSafe = Math.max(0, span);
  if (spanSafe <= 0) return 0;
  let factor = 1;
  const dIn = clip.fadeIn != null && clip.fadeIn > 0 ? Math.min(clip.fadeIn, spanSafe) : 0;
  const dOut = clip.fadeOut != null && clip.fadeOut > 0 ? Math.min(clip.fadeOut, spanSafe) : 0;
  if (dIn > 0 && clipRelativeT < dIn) factor *= Math.max(0, clipRelativeT / dIn);
  if (dOut > 0 && clipRelativeT > spanSafe - dOut) {
    factor *= Math.max(0, (spanSafe - clipRelativeT) / dOut);
  }
  return Math.max(0, Math.min(1, factor));
}
