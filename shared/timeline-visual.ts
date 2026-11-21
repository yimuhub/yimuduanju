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

/**
 * 源画面裁切（crop）：四边各裁掉的比例。
 * 与蒙版不同——蒙版是形状遮罩，crop 是把源画面本身切掉一部分再铺满项目画幅；
 * 导出滤镜链里 crop 插在最前（源空间），抠像/蒙版作用在裁切后的画面上。
 */
export interface TimelineVisualCrop {
  /** 左边裁掉比例 0–0.45 */
  left: number;
  /** 右边裁掉比例 0–0.45 */
  right: number;
  /** 上边裁掉比例 0–0.45 */
  top: number;
  /** 下边裁掉比例 0–0.45 */
  bottom: number;
}

export interface TimelineClipVisual {
  /** 0–1 */
  opacity?: number;
  keying?: TimelineVisualKeying | null;
  mask?: TimelineVisualMask | null;
  beauty?: TimelineVisualBeauty | null;
  tracking?: TimelineVisualTracking | null;
  ai?: TimelineVisualAi | null;
  /** .cube 3D 查找表（LUT）：预览 WebGL 查表、导出 ffmpeg lut3d，共用同一份数据 */
  lut?: TimelineVisualLut | null;
  /** 源画面裁切（C1）：null / 全零 = 不裁 */
  crop?: TimelineVisualCrop | null;
}

export interface TimelineVisualLut {
  /** .cube 资产地址（/uploads 本地路径或资产代理 URL） */
  url: string;
  /** 原始文件名（Inspector 展示用） */
  name?: string;
  /** 0–1 与原色混合的比例，默认 1（= 完全套用） */
  strength: number;
}

/**
 * clip.visual.lut 归一化：url 必须是非空字符串，strength 夹紧 0–1（缺省 1）。
 * url 非法的整体视为未设置（返回 null，等同没有 LUT），预览与导出按旧逻辑走。
 */
export function normalizeVisualLut(lut: TimelineVisualLut | null | undefined): TimelineVisualLut | null {
  const url = typeof lut?.url === 'string' ? lut.url.trim() : '';
  if (!url) return null;
  const raw = Number(lut?.strength);
  return {
    url,
    name: typeof lut?.name === 'string' ? lut.name.trim().slice(0, 120) || undefined : undefined,
    strength: Number.isFinite(raw) ? Math.max(0, Math.min(1, raw)) : 1,
  };
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

const round3 = (v: number) => Math.round(v * 1000) / 1000;

/* ----------------------------- 裁切（C1） ----------------------------- */

/** 单边裁切上限：最多切掉 45% */
export const CROP_EDGE_MAX = 0.45;
/** 两边合计上限（须 <0.9，至少留 10% 画面） */
export const CROP_SUM_MAX = 0.89;

/**
 * 归一化裁切：非法输入按 0 处理，单边夹到 0–0.45；
 * 两边合计超过上限时按比例回缩（保持居中意图）；全零返回 null（= 不裁）。
 */
export function normalizeCrop(crop: TimelineVisualCrop | null | undefined): TimelineVisualCrop | null {
  if (!crop) return null;
  const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  let left = clamp(num(crop.left), 0, CROP_EDGE_MAX);
  let right = clamp(num(crop.right), 0, CROP_EDGE_MAX);
  let top = clamp(num(crop.top), 0, CROP_EDGE_MAX);
  let bottom = clamp(num(crop.bottom), 0, CROP_EDGE_MAX);
  const capSum = (a: number, b: number): [number, number] => {
    const sum = a + b;
    if (sum <= CROP_SUM_MAX) return [a, b];
    const f = CROP_SUM_MAX / sum;
    return [round3(a * f), round3(b * f)];
  };
  [left, right] = capSum(left, right);
  [top, bottom] = capSum(top, bottom);
  if (left + right + top + bottom <= 0) return null;
  return { left: round3(left), right: round3(right), top: round3(top), bottom: round3(bottom) };
}

/**
 * 预览裁切 transform：追加到媒体 transform 末尾（= 源空间最先裁切，与导出滤镜
 * 链 crop 在最前同序），运镜/美容/旋转作用在裁切后的画面上。
 * 映射：裁切区域 [l,1-r]×[t,1-b] 放大平移后铺满整个画幅（object-fit 行为不变）。
 * 无裁切返回空串，调用方原样保留既有 transform。
 */
export function cropTransform(crop: TimelineVisualCrop | null | undefined): string {
  const c = normalizeCrop(crop);
  if (!c) return '';
  const sx = 1 / (1 - c.left - c.right);
  const sy = 1 / (1 - c.top - c.bottom);
  // 平移把裁切区中心对到画幅中心（平移发生在 scale 之内，量与缩放无关）
  const tx = ((c.right - c.left) / 2) * 100;
  const ty = ((c.bottom - c.top) / 2) * 100;
  return `scale(${sx.toFixed(4)}, ${sy.toFixed(4)}) translate(${tx.toFixed(3)}%, ${ty.toFixed(3)}%)`;
}

/**
 * 导出裁切滤镜（ffmpeg crop，源空间）：`crop=iw*(1-l-r):ih*(1-t-b):iw*l:ih*t`。
 * 放在视频滤镜链最前面（crop 最前 = 源空间），后续 chromakey / 蒙版 / scale-pad
 * 都作用在裁切后的画面上，与预览层序一致。无裁切返回空串（调用方不追加）。
 */
export function buildCropFilterArgs(crop: TimelineVisualCrop | null | undefined): string {
  const c = normalizeCrop(crop);
  if (!c) return '';
  const w = 1 - c.left - c.right;
  const h = 1 - c.top - c.bottom;
  return `crop=iw*${w.toFixed(3)}:ih*${h.toFixed(3)}:iw*${c.left.toFixed(3)}:ih*${c.top.toFixed(3)}`;
}

/**
 * 「居中 2.35:1 电影感」预设：按项目画幅算上下各裁多少（左右不动）。
 * 假设素材与项目画幅同比例（生成的镜头视频即如此）；素材异形时结果以预览为准微调。
 * 画幅本身比 2.35:1 更宽（不需要裁）时返回 null。
 */
export function cinematicCropPreset(width: number, height: number): TimelineVisualCrop | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  const cut = (1 - width / 2.35 / height) / 2;
  if (cut <= 0) return null;
  return normalizeCrop({ left: 0, right: 0, top: cut, bottom: cut });
}

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
