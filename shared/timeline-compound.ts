/**
 * 真复合片段：把一个连续区间内的画面片段收成一个可移动/裁剪的整体。
 * 复合片段本身不复制媒体，只在 `TimelineClip.compound.children` 里保存
 * 子片段相对复合起点的时间偏移；导出时展开回真实片段，预览按播放头取子片段。
 */
import type { TimelineClip, TimelineCompoundChild } from './api.interface';

const MIN_SPAN = 0.05;

export interface CompoundChildView {
  child: TimelineCompoundChild;
  /** 在复合片段可见时间轴上的起点（秒） */
  start: number;
  span: number;
}

/** 复合片段内某个绝对时间命中的子片段；不在任何子片段内返回 null */
export function compoundChildAt(
  clip: TimelineClip,
  timelineT: number,
): CompoundChildView | null {
  const children = clip.compound?.children ?? [];
  const speed = clip.speed > 0 ? clip.speed : 1;
  const local = clip.inPoint + Math.max(0, timelineT - clip.timelineStart) * speed;
  for (const child of children) {
    const childSpeed = child.speed > 0 ? child.speed : 1;
    const span = Math.max(MIN_SPAN, (child.outPoint - child.inPoint) / childSpeed);
    if (local >= child.offset - 1e-6 && local < child.offset + span - 1e-6) {
      return {
        child,
        start: clip.timelineStart + (child.offset - clip.inPoint) / speed,
        span,
      };
    }
  }
  return null;
}

/** 预览用：把复合片段虚拟成当前命中的子片段（id 带 ::key，换段会重置播放器） */
export function virtualCompoundClip(
  clip: TimelineClip,
  timelineT: number,
): TimelineClip | null {
  const hit = compoundChildAt(clip, timelineT);
  if (!hit) return null;
  const { child } = hit;
  const parentSpeed = clip.speed > 0 ? clip.speed : 1;
  return {
    ...clip,
    id: `${clip.id}::${child.key}`,
    clientKey: `${clip.clientKey}::${child.key}`,
    sourceUrl: child.sourceUrl,
    sourceShotId: child.sourceShotId ?? null,
    text: child.text ?? clip.text,
    inPoint: child.inPoint,
    outPoint: child.outPoint,
    timelineStart: hit.start,
    speed: child.speed * parentSpeed,
    volume: child.volume ?? clip.volume,
    reverse: Boolean(child.reverse),
    keyframes: child.keyframes ?? null,
    transition: child.transition ?? null,
    enabled: child.enabled !== false,
    compound: null,
  };
}

/**
 * 导出用：把复合片段展开成真实子片段，并按复合片段的 trim 裁剪。
 * 子片段重叠时保留原样，后续 concat/overlay 逻辑照旧。
 */
export function expandCompoundClip(clip: TimelineClip): TimelineClip[] {
  const children = clip.compound?.children ?? [];
  if (children.length === 0) return [clip];
  const paintStart = clip.inPoint;
  const paintEnd = clip.outPoint;
  const parentSpeed = clip.speed > 0 ? clip.speed : 1;
  const out: TimelineClip[] = [];
  for (const child of children) {
    const childSpeed = child.speed > 0 ? child.speed : 1;
    const span = Math.max(MIN_SPAN, (child.outPoint - child.inPoint) / childSpeed);
    const from = Math.max(paintStart, child.offset);
    const to = Math.min(paintEnd, child.offset + span);
    if (to - from <= 1e-6) continue;
    const trimIn = (from - child.offset) * childSpeed;
    const trimOut = (to - child.offset) * childSpeed;
    out.push({
      ...clip,
      id: `${clip.id}::${child.key}`,
      clientKey: `${clip.clientKey}::${child.key}`,
      sourceUrl: child.sourceUrl,
      sourceShotId: child.sourceShotId ?? null,
      text: child.text ?? clip.text,
      inPoint: child.inPoint + trimIn,
      outPoint: child.inPoint + trimOut,
      timelineStart: clip.timelineStart + (from - paintStart) / parentSpeed,
      speed: child.speed * parentSpeed,
      volume: child.volume ?? clip.volume,
      reverse: Boolean(child.reverse),
      keyframes: child.keyframes ?? null,
      transition: child.transition ?? null,
      compound: null,
    });
  }
  return out;
}

export function expandCompounds(clips: TimelineClip[]): TimelineClip[] {
  return clips.flatMap((c) => (c.compound?.children?.length ? expandCompoundClip(c) : [c]));
}
