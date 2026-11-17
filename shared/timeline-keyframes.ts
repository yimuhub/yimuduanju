/**
 * 运镜关键帧（缩放 / 平移 / 旋转）
 * -------------------------------------------------------------
 * 只做「预览与导出都能真生效」的四个属性，不做无法落地的假面板：
 *   scale  1 = 原始铺满，0.5–3
 *   x/y    画面偏移，-1..1（相对画幅宽/高）
 *   rotate 旋转角度，-180..180
 *
 * 时间 `time` 是相对片段可见起点的秒数（变速后的时间轴时间）。
 * 片段被裁剪时不会自动搬移关键帧，超出可见时长的部分不参与导出。
 */
export interface TimelineVideoKeyframe {
  /** 相对片段起点的秒数 */
  time: number;
  scale?: number;
  x?: number;
  y?: number;
  rotate?: number;
  easing?: 'linear' | 'ease-in' | 'ease-out';
}

export interface VideoTransform {
  scale: number;
  x: number;
  y: number;
  rotate: number;
}

export const DEFAULT_VIDEO_TRANSFORM: VideoTransform = {
  scale: 1,
  x: 0,
  y: 0,
  rotate: 0,
};

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

const ease = (p: number, mode: TimelineVideoKeyframe['easing']): number => {
  const t = clamp(p, 0, 1);
  if (mode === 'ease-in') return t * t;
  if (mode === 'ease-out') return 1 - (1 - t) * (1 - t);
  return t;
};

/** 规范化关键帧：时间升序、去重、数值夹紧 */
export function normalizeVideoKeyframes(
  frames: TimelineVideoKeyframe[] | null | undefined,
): TimelineVideoKeyframe[] {
  if (!Array.isArray(frames)) return [];
  const clean = frames
    .filter((f) => f && Number.isFinite(Number(f.time)))
    .map((f): TimelineVideoKeyframe => ({
      time: Math.max(0, Number(f.time)),
      scale: Number.isFinite(Number(f.scale)) ? clamp(Number(f.scale), 0.5, 3) : undefined,
      x: Number.isFinite(Number(f.x)) ? clamp(Number(f.x), -1, 1) : undefined,
      y: Number.isFinite(Number(f.y)) ? clamp(Number(f.y), -1, 1) : undefined,
      rotate: Number.isFinite(Number(f.rotate)) ? clamp(Number(f.rotate), -180, 180) : undefined,
      easing: f.easing === 'ease-in' || f.easing === 'ease-out' ? f.easing : 'linear',
    }))
    .sort((a, b) => a.time - b.time);
  // 同一时间只保留最后一个，避免用户连续点两次产生两个重叠关键帧
  const out: TimelineVideoKeyframe[] = [];
  for (const f of clean) {
    if (out.length && Math.abs(out[out.length - 1].time - f.time) < 1e-3) out[out.length - 1] = f;
    else out.push(f);
  }
  return out;
}

/** 取某个时间点的运镜值；无关键帧时返回默认值 */
export function sampleVideoTransform(
  frames: TimelineVideoKeyframe[] | null | undefined,
  time: number,
): VideoTransform {
  const list = normalizeVideoKeyframes(frames);
  if (list.length === 0) return { ...DEFAULT_VIDEO_TRANSFORM };
  if (time <= list[0].time) return resolveFrame(list[0], DEFAULT_VIDEO_TRANSFORM);
  if (time >= list[list.length - 1].time) {
    return resolveFrame(list[list.length - 1], resolveFrame(list[0], DEFAULT_VIDEO_TRANSFORM));
  }
  for (let i = 0; i < list.length - 1; i += 1) {
    const a = list[i];
    const b = list[i + 1];
    if (time >= a.time && time <= b.time) {
      const span = Math.max(1e-6, b.time - a.time);
      const p = ease((time - a.time) / span, b.easing);
      const base = resolveFrame(a, DEFAULT_VIDEO_TRANSFORM);
      const from = resolveFrame(a, DEFAULT_VIDEO_TRANSFORM);
      const to = resolveFrame(b, base);
      return {
        scale: from.scale + (to.scale - from.scale) * p,
        x: from.x + (to.x - from.x) * p,
        y: from.y + (to.y - from.y) * p,
        rotate: from.rotate + (to.rotate - from.rotate) * p,
      };
    }
  }
  return resolveFrame(list[list.length - 1], DEFAULT_VIDEO_TRANSFORM);
}

/** 单帧缺省属性继承前一帧（首个关键帧继承默认值） */
function resolveFrame(
  frame: TimelineVideoKeyframe,
  prev: VideoTransform,
): VideoTransform {
  return {
    scale: frame.scale ?? prev.scale,
    x: frame.x ?? prev.x,
    y: frame.y ?? prev.y,
    rotate: frame.rotate ?? prev.rotate,
  };
}

/** 在指定时间插入/更新关键帧（保留未填属性） */
export function upsertVideoKeyframe(
  frames: TimelineVideoKeyframe[] | null | undefined,
  time: number,
  patch: Partial<Omit<TimelineVideoKeyframe, 'time'>>,
): TimelineVideoKeyframe[] {
  const list = normalizeVideoKeyframes(frames);
  const at = Math.max(0, time);
  const existing = list.find((f) => Math.abs(f.time - at) < 1e-3);
  if (existing) {
    return normalizeVideoKeyframes(
      list.map((f) => (Math.abs(f.time - at) < 1e-3 ? { ...f, ...patch, time: at } : f)),
    );
  }
  return normalizeVideoKeyframes([...list, { time: at, ...patch }]);
}

export function removeVideoKeyframe(
  frames: TimelineVideoKeyframe[] | null | undefined,
  time: number,
): TimelineVideoKeyframe[] {
  return normalizeVideoKeyframes(frames).filter((f) => Math.abs(f.time - time) >= 1e-3);
}

const fmt = (n: number) => Number(n.toFixed(4));

/**
 * 生成 ffmpeg zoompan 的 z/x/y 表达式（按输出帧 on 线性插值）。
 * 只用于导出；预览用 CSS transform，同一套关键帧数据。
 */
export function buildZoompanExpressions(
  frames: TimelineVideoKeyframe[] | null | undefined,
  fps: number,
  visibleSpan: number,
): { z: string; x: string; y: string; rotate: string; hasKeyframes: boolean } {
  const list = normalizeVideoKeyframes(frames).filter((f) => f.time <= visibleSpan + 1e-3);
  const defaultZ = '1';
  const defaultX = '(iw-iw/zoom)/2';
  const defaultY = '(ih-ih/zoom)/2';
  const defaultR = '0';
  if (list.length === 0) {
    return { z: defaultZ, x: defaultX, y: defaultY, rotate: defaultR, hasKeyframes: false };
  }
  const framesAt = list.map((f) => ({ ...f, frame: Math.round(f.time * fps) }));
  const piecewise = (
    pick: (f: TimelineVideoKeyframe) => number | undefined,
    fallback: number,
  ): string => {
    // 补一个 0 秒基准，避免第一帧之前跳变；再补最后一个关键帧的值
    const points = [...framesAt];
    if (points[0].frame > 0) {
      points.unshift({ ...points[0], time: 0, frame: 0 });
    }
    const resolved = points.map((p, i) => {
      const v = pick(p);
      if (v != null) return v;
      // 继承前一个已知值
      for (let j = i - 1; j >= 0; j -= 1) {
        const pv = pick(points[j]);
        if (pv != null) return pv;
      }
      return fallback;
    });
    if (resolved.length === 1) return fmt(resolved[0]).toString();
    let expr = fmt(resolved[resolved.length - 1]).toString();
    for (let i = resolved.length - 2; i >= 0; i -= 1) {
      const aFrame = points[i].frame;
      const bFrame = points[i + 1].frame;
      const aVal = resolved[i];
      const bVal = resolved[i + 1];
      const k = (bVal - aVal) / Math.max(1, bFrame - aFrame);
      const line = `${fmt(aVal)}+(${fmt(k)})*(on-${aFrame})`;
      expr = `if(lte(on,${bFrame}),${line},${expr})`;
    }
    return expr;
  };
  const piecewiseTime = (
    pick: (f: TimelineVideoKeyframe) => number | undefined,
    fallback: number,
  ): string => {
    const points = [...framesAt];
    if (points[0].time > 0) {
      points.unshift({ ...points[0], time: 0, frame: 0 });
    }
    const resolved = points.map((p, i) => {
      const v = pick(p);
      if (v != null) return v;
      for (let j = i - 1; j >= 0; j -= 1) {
        const pv = pick(points[j]);
        if (pv != null) return pv;
      }
      return fallback;
    });
    if (resolved.length === 1) return fmt(resolved[0]).toString();
    let expr = fmt(resolved[resolved.length - 1]).toString();
    for (let i = resolved.length - 2; i >= 0; i -= 1) {
      const aT = points[i].time;
      const bT = points[i + 1].time;
      const aVal = resolved[i];
      const bVal = resolved[i + 1];
      const k = (bVal - aVal) / Math.max(1e-6, bT - aT);
      const line = `${fmt(aVal)}+(${fmt(k)})*(t-${fmt(aT)})`;
      expr = `if(lte(t,${fmt(bT)}),${line},${expr})`;
    }
    return expr;
  };
  const z = piecewise((f) => f.scale, DEFAULT_VIDEO_TRANSFORM.scale);
  const dx = piecewise((f) => f.x, 0);
  const dy = piecewise((f) => f.y, 0);
  // rotate 滤镜的时间变量是 t（秒），不是 zoompan 的 on（帧号），分开生成
  const deg = piecewiseTime((f) => f.rotate, 0);
  return {
    z,
    x: `max(0,min(iw-iw/zoom,(iw-iw/zoom)/2+(${dx})*iw/zoom))`,
    y: `max(0,min(ih-ih/zoom,(ih-ih/zoom)/2+(${dy})*ih/zoom))`,
    rotate: `(${deg})*PI/180`,
    hasKeyframes: true,
  };
}
