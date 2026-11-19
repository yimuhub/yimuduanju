import type { CSSProperties } from 'react';
import { sampleVideoTransform, type TimelineVideoKeyframe } from './timeline-keyframes';

/**
 * 片段视觉增强（抠像 / 蒙版 / 美容 / 跟踪 / AI 风格）
 * -------------------------------------------------
 * 只放「预览与导出都能读」的字段；预览用 CSS/Canvas，导出用 ffmpeg 滤镜链。
 * track.points 是手动点跟踪路径：每个点有相对片段起点的秒数与归一化偏移。
 */
export interface TimelineVisualKeying {
  enabled: boolean;
  /** #RRGGBB；默认绿幕 */
  color: string;
  /** 0–1，越大删除范围越宽 */
  similarity: number;
  /** 0–1，边缘过渡 */
  smoothness: number;
  /** 0–1，去绿边 */
  spill: number;
}

export interface TimelineVisualMask {
  enabled: boolean;
  shape: 'linear' | 'circle' | 'rect';
  /** 归一化中心/尺寸，0–1 */
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  feather: number;
  invert: boolean;
}

export interface TimelineVisualBeauty {
  enabled: boolean;
  /** 0–100 磨皮 */
  smooth: number;
  /** 0–100 美白 */
  whiten: number;
  /** 0–100 红润 */
  rosy: number;
  /** 0–100 瘦脸（横向收紧） */
  faceSlim: number;
  /** 0–100 美体（横向收紧） */
  bodySlim: number;
}

export interface TimelineTrackingPoint {
  /** 相对片段起点的秒数 */
  time: number;
  /** 归一化偏移 -1..1 */
  x: number;
  y: number;
  /** 1 = 原尺寸 */
  scale?: number;
}

export interface TimelineVisualTracking {
  enabled: boolean;
  x: number;
  y: number;
  scale: number;
  points: TimelineTrackingPoint[];
}

export type TimelineAiPreset =
  | 'none'
  | 'anime'
  | 'sketch'
  | 'oil'
  | 'neon'
  | 'mono'
  | 'retro'
  | 'clean';

export interface TimelineVisualAi {
  preset: TimelineAiPreset;
  /** 0–100 */
  strength: number;
}

export interface TimelineClipVisual {
  /** 0–1 */
  opacity?: number;
  keying?: TimelineVisualKeying | null;
  mask?: TimelineVisualMask | null;
  beauty?: TimelineVisualBeauty | null;
  tracking?: TimelineVisualTracking | null;
  ai?: TimelineVisualAi | null;
}

export const DEFAULT_KEYING: TimelineVisualKeying = {
  enabled: false,
  color: '#00ff00',
  similarity: 0.35,
  smoothness: 0.12,
  spill: 0.15,
};

export const DEFAULT_MASK: TimelineVisualMask = {
  enabled: false,
  shape: 'circle',
  x: 0.5,
  y: 0.5,
  w: 0.55,
  h: 0.55,
  rotation: 0,
  feather: 0.18,
  invert: false,
};

export const DEFAULT_BEAUTY: TimelineVisualBeauty = {
  enabled: false,
  smooth: 35,
  whiten: 18,
  rosy: 10,
  faceSlim: 12,
  bodySlim: 0,
};

export const DEFAULT_TRACKING: TimelineVisualTracking = {
  enabled: false,
  x: 0,
  y: 0,
  scale: 1,
  points: [],
};

export const DEFAULT_AI: TimelineVisualAi = { preset: 'none', strength: 55 };

export const AI_PRESETS: Array<{ id: TimelineAiPreset; label: string; note: string }> = [
  { id: 'none', label: '原片', note: '关闭风格化' },
  { id: 'anime', label: '动漫', note: '高饱和 · 轻描边' },
  { id: 'sketch', label: '素描', note: '去色 · 高对比' },
  { id: 'oil', label: '油画', note: '厚涂 · 柔化' },
  { id: 'neon', label: '霓虹', note: '高饱和 · 冷色偏移' },
  { id: 'mono', label: '黑白', note: '去色 · 电影灰' },
  { id: 'retro', label: '复古', note: '暖黄 · 低对比' },
  { id: 'clean', label: '超清', note: '锐化 · 提亮' },
];

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/** 手动跟踪点插值；无点返回 0 偏移 */
export function sampleTracking(
  tracking: TimelineVisualTracking | null | undefined,
  time: number,
): { x: number; y: number; scale: number } {
  const points = [...(tracking?.points ?? [])]
    .filter((p) => Number.isFinite(p.time))
    .sort((a, b) => a.time - b.time);
  if (!tracking?.enabled || points.length === 0) {
    return { x: tracking?.x ?? 0, y: tracking?.y ?? 0, scale: tracking?.scale ?? 1 };
  }
  if (time <= points[0].time) return { x: points[0].x, y: points[0].y, scale: points[0].scale ?? 1 };
  if (time >= points[points.length - 1].time) {
    const p = points[points.length - 1];
    return { x: p.x, y: p.y, scale: p.scale ?? 1 };
  }
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    if (time >= a.time && time <= b.time) {
      const p = (time - a.time) / Math.max(1e-6, b.time - a.time);
      return {
        x: a.x + (b.x - a.x) * p,
        y: a.y + (b.y - a.y) * p,
        scale: (a.scale ?? 1) + ((b.scale ?? 1) - (a.scale ?? 1)) * p,
      };
    }
  }
  return { x: tracking.x ?? 0, y: tracking.y ?? 0, scale: tracking.scale ?? 1 };
}

/** 把手动跟踪路径合并成运镜关键帧，导出与预览共用同一套运动 */
export function mergeTrackingKeyframes(
  base: TimelineVideoKeyframe[] | null | undefined,
  tracking: TimelineVisualTracking | null | undefined,
): TimelineVideoKeyframe[] | null {
  if (!tracking?.enabled || !tracking.points?.length) return base ?? null;
  const times = new Set<number>([0]);
  for (const f of base ?? []) times.add(Number(f.time));
  for (const p of tracking.points) times.add(Number(p.time));
  const frames = [...times]
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => a - b)
    .map((time) => {
      const tr = sampleVideoTransform(base, time);
      const tk = sampleTracking(tracking, time);
      return {
        time,
        scale: tr.scale * tk.scale,
        x: Math.min(1, Math.max(-1, tr.x + tk.x)),
        y: Math.min(1, Math.max(-1, tr.y + tk.y)),
        rotate: tr.rotate,
        easing: 'linear' as const,
      };
    });
  return frames;
}

/** 蒙版 -> CSS clip-path；羽化用 mask-image 近似 */
export function maskStyle(mask: TimelineVisualMask | null | undefined): CSSProperties {
  if (!mask?.enabled) return {};
  const x = clamp(mask.x, 0, 1);
  const y = clamp(mask.y, 0, 1);
  const w = clamp(mask.w, 0.01, 1);
  const h = clamp(mask.h, 0.01, 1);
  const inset = mask.invert;
  const base: CSSProperties = { transform: `rotate(${mask.rotation}deg)` };
  if (mask.shape === 'rect') {
    const left = clamp(x - w / 2, 0, 1) * 100;
    const right = (1 - clamp(x + w / 2, 0, 1)) * 100;
    const top = clamp(y - h / 2, 0, 1) * 100;
    const bottom = (1 - clamp(y + h / 2, 0, 1)) * 100;
    if (!inset) base.clipPath = `inset(${top}% ${right}% ${bottom}% ${left}%)`;
    else {
      // 反向矩形：用遮罩挖洞
      base.maskImage = `linear-gradient(#000,#000), linear-gradient(#000,#000)`;
      base.maskClip = 'content-box';
    }
    return base;
  }
  if (mask.shape === 'circle') {
    base.clipPath = `ellipse(${(w / 2) * 100}% ${(h / 2) * 100}% at ${x * 100}% ${y * 100}%)`;
    if (inset) base.clipPath = `polygon(0 0,100% 0,100% 100%,0 100%,0 0,${x * 100}% ${y * 100}%)`;
    if (mask.feather > 0) {
      const f = clamp(mask.feather, 0, 1) * 100;
      base.maskImage = `radial-gradient(ellipse ${(w / 2) * 100}% ${(h / 2) * 100}% at ${x * 100}% ${y * 100}%, #000 ${100 - f}%, transparent 100%)`;
    }
    return base;
  }
  // 线性：按 y 位置做上下渐变遮罩
  const soft = clamp(mask.feather, 0.001, 0.9);
  base.maskImage = `linear-gradient(${mask.rotation}deg, transparent ${Math.max(0, y - soft) * 100}%, #000 ${y * 100}%, transparent ${Math.min(1, y + soft) * 100}%)`;
  if (inset) base.maskImage = `linear-gradient(${mask.rotation}deg, #000 ${Math.max(0, y - soft) * 100}%, transparent ${y * 100}%, #000 ${Math.min(1, y + soft) * 100}%)`;
  return base;
}

/** AI 风格 -> CSS filter（预览近似；导出用 ffmpeg 对应滤镜） */
export function aiFilter(ai: TimelineVisualAi | null | undefined): string {
  if (!ai || ai.preset === 'none') return '';
  const s = clamp((ai.strength ?? 55) / 100, 0.1, 1);
  switch (ai.preset) {
    case 'anime':
      return `saturate(${1 + 0.7 * s}) contrast(${1 + 0.25 * s})`;
    case 'sketch':
      return `grayscale(${s}) contrast(${1 + 0.8 * s})`;
    case 'oil':
      return `saturate(${1 + 0.45 * s}) contrast(${1 + 0.35 * s}) blur(${0.3 * s}px)`;
    case 'neon':
      return `saturate(${1 + 1.2 * s}) hue-rotate(${-18 * s}deg) contrast(${1 + 0.3 * s})`;
    case 'mono':
      return `grayscale(${s}) contrast(${1 + 0.3 * s})`;
    case 'retro':
      return `sepia(${0.75 * s}) saturate(${1 - 0.25 * s}) contrast(${1 - 0.1 * s})`;
    case 'clean':
      return `brightness(${1 + 0.08 * s}) contrast(${1 + 0.2 * s}) saturate(${1 + 0.1 * s})`;
    default:
      return '';
  }
}

/** 美容 -> CSS filter + 横向收紧比例 */
export function beautyStyle(beauty: TimelineVisualBeauty | null | undefined): {
  filter: string;
  scaleX: number;
} {
  if (!beauty?.enabled) return { filter: '', scaleX: 1 };
  const smooth = clamp(beauty.smooth, 0, 100) / 100;
  const whiten = clamp(beauty.whiten, 0, 100) / 100;
  const rosy = clamp(beauty.rosy, 0, 100) / 100;
  const slim = Math.max(beauty.faceSlim, beauty.bodySlim) / 100;
  return {
    filter: `brightness(${1 + whiten * 0.12}) saturate(${1 + rosy * 0.18}) blur(${smooth * 0.45}px)`,
    scaleX: 1 - clamp(slim, 0, 0.3) * 0.18,
  };
}
