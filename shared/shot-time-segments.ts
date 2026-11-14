/**
 * 分镜时间分段（timeSegments）纯函数库（前后端同源，对标 Pavo 截图 + huobao 分镜编辑）
 * ---------------------------------------------------------------------------
 * 每个镜头的 visualPrompt 按「时间段落」结构化：每段 = 景别 + 时长 + 画面描述
 * + 出场角色 + 场景引用。旧数据没有分段（shots.metadata.timeSegments 缺失）时
 * 一律走单段兼容模式——所有消费方（提示词拼接 / 视频节拍）对空数组零副作用。
 */

import type { ShotTimeSegment } from './api.interface';

/** 单段时长上限：与镜头节拍口径一致（≤15s 一段），超出按上限裁剪 */
const MAX_SEGMENT_SECONDS = 20;
const MIN_SEGMENT_SECONDS = 0.5;
/** 每镜分段数量上限：防 jsonb 膨胀与提示词失控 */
export const MAX_TIME_SEGMENTS = 12;

function clampSeconds(n: unknown, fallback: number): number {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return fallback;
  return Math.min(MAX_SEGMENT_SECONDS, Math.max(MIN_SEGMENT_SECONDS, Math.round(v * 10) / 10));
}

function cleanText(raw: unknown, maxLen: number): string {
  return typeof raw === 'string' ? raw.trim().slice(0, maxLen) : '';
}

/**
 * 归一化任意来源（前端编辑器 / LLM 输出 / 历史脏数据）的分段数组：
 * 丢弃无描述且无角色的空段、钳制时长、限制段数。非数组输入返回 []。
 */
export function normalizeTimeSegments(raw: unknown): ShotTimeSegment[] {
  if (!Array.isArray(raw)) return [];
  const out: ShotTimeSegment[] = [];
  for (const item of raw.slice(0, MAX_TIME_SEGMENTS)) {
    if (typeof item !== 'object' || item === null) continue;
    const s = item as Partial<ShotTimeSegment>;
    const description = cleanText(s.description, 500);
    const characters = Array.isArray(s.characters)
      ? s.characters
          .filter((c): c is string => typeof c === 'string')
          .map((c) => c.trim().slice(0, 60))
          .filter(Boolean)
          .slice(0, 8)
      : [];
    if (!description && characters.length === 0) continue;
    out.push({
      id: cleanText(s.id, 40) || `seg-${out.length + 1}`,
      shotType: cleanText(s.shotType, 30),
      duration: clampSeconds(s.duration, 3),
      description,
      characters,
      movement: cleanText(s.movement, 50),
      sceneRef: cleanText(s.sceneRef, 120),
    });
  }
  return out;
}

/** 从镜头 metadata（可能为 null / 无 timeSegments 键）安全取出分段 */
export function timeSegmentsOf(metadata: unknown): ShotTimeSegment[] {
  if (typeof metadata !== 'object' || metadata === null) return [];
  return normalizeTimeSegments((metadata as { timeSegments?: unknown }).timeSegments);
}

/** 分段总时长（秒） */
export function segmentsTotalSeconds(segments: ShotTimeSegment[]): number {
  return segments.reduce((sum, s) => sum + (Number(s.duration) || 0), 0);
}

/** 景别中文标签（与 ProjectStoryboardTab.shotSizeLabels 同一口径，供提示词拼接） */
const SHOT_TYPE_LABELS: Record<string, string> = {
  close_up: '特写',
  close_up_shot: '特写',
  medium_close_up: '近景',
  medium_shot: '中景',
  medium_long_shot: '全景',
  long_shot: '远景',
  wide_shot: '全景',
  extreme_close_up: '大特写',
  over_the_shoulder: '过肩',
};

export function shotTypeLabel(v: string | undefined): string {
  const key = (v ?? '').trim();
  if (!key) return '';
  return SHOT_TYPE_LABELS[key] ?? key;
}

function rangeLabel(from: number, to: number): string {
  const fmt = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10));
  return `${fmt(from)}-${fmt(to)} 秒`;
}

/**
 * 生成时按分段拼接 visualPrompt 的时间分区块（含每段的景别/运镜/画面描述/角色）。
 * 拼进生成提示词而非覆盖原 visualPrompt：原句保留做整体构图锚点，分段块给出
 * 时间轴上的可见动作密度——与 shared/video-prompt.ts 的【分段动作】同一思想。
 */
export function composeTimeSegmentBlock(segments: ShotTimeSegment[]): string {
  const list = normalizeTimeSegments(segments);
  if (list.length === 0) return '';
  const lines = ['【时间分段】本镜按以下时间段落推进：'];
  let cursor = 0;
  for (const s of list) {
    const to = cursor + (Number(s.duration) || 0);
    const bits: string[] = [rangeLabel(cursor, to)];
    const shot = shotTypeLabel(s.shotType);
    if (shot) bits.push(shot);
    if (s.movement && s.movement !== 'static') bits.push(`运镜${s.movement}`);
    if (s.description) bits.push(s.description);
    let line = bits.join('：');
    if (s.characters.length > 0) line += `（出场：${s.characters.join('、')}）`;
    if (s.sceneRef) line += `〔场景 ${s.sceneRef}〕`;
    lines.push(line);
    cursor = to;
  }
  return lines.join('\n');
}

/**
 * 供首帧/视频生成消费的完整提示词：原描述在前，分段块在后（模型对靠后内容更敏感）。
 * 无分段时原样返回（旧数据零改动）。
 */
export function withTimeSegmentBlock(description: string | null | undefined, segments: ShotTimeSegment[]): string {
  const base = (description ?? '').trim();
  const block = composeTimeSegmentBlock(segments);
  if (!block) return base;
  return base ? `${base}\n${block}` : block;
}

/** 视频节拍（ShotBeat）最小结构 —— 只用 shared/api.interface 已有字段，避免循环依赖 */
export interface SegmentBeat {
  from: number;
  to: number;
  description: string;
  dialogue?: string;
}

/**
 * 分段 → 3 秒节拍（视频提示词按分段传）：把用户编排的时间段落直接映射成
 * buildSegmentedVideoPrompt 的 beats，段描述带景别/运镜/出场角色前缀。
 * 分段为空时返回 null（调用方回落 shot.beats，兼容单段模式）。
 */
export function timeSegmentsToBeats(segments: ShotTimeSegment[]): SegmentBeat[] | null {
  const list = normalizeTimeSegments(segments);
  if (list.length === 0) return null;
  const beats: SegmentBeat[] = [];
  let cursor = 0;
  for (const s of list) {
    const dur = Number(s.duration) || 0;
    const to = Math.round((cursor + dur) * 10) / 10;
    const parts: string[] = [];
    const shot = shotTypeLabel(s.shotType);
    if (shot) parts.push(shot);
    if (s.movement && s.movement !== 'static') parts.push(`运镜${s.movement}`);
    if (s.description) parts.push(s.description);
    const desc =
      parts.join('，') ||
      (s.characters.length > 0 ? `${s.characters.join('、')}继续表演` : '延续本镜构图，人物表演自然推进');
    beats.push({
      from: Math.round(cursor * 10) / 10,
      to,
      description: s.characters.length > 0 ? `${desc}（在场：${s.characters.join('、')}）` : desc,
    });
    cursor = to;
  }
  return beats;
}

/** 前端分段编辑器用：新建一个空白段（默认 3s 中景） */
export function blankTimeSegment(index: number): ShotTimeSegment {
  return {
    id: `seg-${Date.now().toString(36)}-${index}`,
    shotType: 'medium_shot',
    duration: 3,
    description: '',
    characters: [],
    movement: '',
    sceneRef: '',
  };
}
