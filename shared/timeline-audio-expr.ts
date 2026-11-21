/**
 * 音量包络（volume automation）· 预览与导出共用
 * -------------------------------------------------------------
 * 数据形态：clip.volumeAutomation = { points: [{ t, v }] }
 *   t  片段内相对秒（升序、0 ≤ t ≤ 片段时长，帧量化）
 *   v  音量倍率 0–2（1 = 原始音量，与 clip.volume 相乘后是最终增益）
 *
 * 插值语义（预览 volumeAt 与导出 ffmpeg volume 表达式共用）：
 *   两点之间线性；首点之前保持首点值，末点之后保持末点值；
 *   无包络时音量 = clip.volume 本身。
 */

export interface TimelineVolumePoint {
  /** 片段内相对秒（帧量化） */
  t: number;
  /** 音量倍率 0–2 */
  v: number;
}

export interface TimelineVolumeAutomation {
  points: TimelineVolumePoint[];
}

export const VOLUME_MIN = 0;
export const VOLUME_MAX = 2;

const clampNum = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const fmt = (n: number) => {
  const out = Number(n.toFixed(4));
  // toFixed 会丢掉「-0」以外的细节，这里只保证没有 NaN/Infinity 混进表达式
  return Number.isFinite(out) ? String(out) : '0';
};

/**
 * 归一化包络点：过滤非法值 → 数值夹紧 → 帧量化 → 时间升序 → 同一帧只保留一个点。
 * 同帧冲突保留 v 更小的那个：包络语义下「压得更低」是用户意图（避让 / 手动压低）。
 * span 是片段有效时长（秒），超出的点按 clip 端点夹紧。
 */
export function normalizeVolumePoints(
  points: TimelineVolumePoint[] | null | undefined,
  span: number,
  fps = 24,
): TimelineVolumePoint[] {
  if (!Array.isArray(points)) return [];
  const safeFps = Math.max(1, fps);
  const safeSpan = Math.max(0, Number(span) || 0);
  const clean = points
    .filter((p) => p && Number.isFinite(Number(p.t)) && Number.isFinite(Number(p.v)))
    .map((p) => {
      const t = clampNum(Math.round(Number(p.t) * safeFps) / safeFps, 0, safeSpan);
      const v = clampNum(Number(p.v), VOLUME_MIN, VOLUME_MAX);
      return { t, v };
    })
    .sort((a, b) => a.t - b.t || a.v - b.v);
  const out: TimelineVolumePoint[] = [];
  for (const p of clean) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.t - p.t) < 1e-6) {
      if (p.v < last.v) out[out.length - 1] = p;
    } else {
      out.push(p);
    }
  }
  return out;
}

/**
 * 取片段内相对时间 t 的包络值（线性插值，首末点之外保持端点值）。
 * ShenJianStage 预览每帧/每 seek 调它；导出端用 buildVolumeAutomationExpr 生成同语义表达式。
 */
export function volumeAt(
  points: TimelineVolumePoint[] | null | undefined,
  t: number,
): number {
  if (!Array.isArray(points) || points.length === 0) return 1;
  const x = Number(t);
  if (!Number.isFinite(x)) return 1;
  if (points.length === 1) return points[0].v;
  if (x <= points[0].t) return points[0].v;
  const last = points[points.length - 1];
  if (x >= last.t) return last.v;
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    if (x >= a.t && x <= b.t) {
      const spanT = b.t - a.t;
      if (spanT < 1e-9) return b.v;
      return a.v + ((b.v - a.v) * (x - a.t)) / spanT;
    }
  }
  return last.v;
}

/**
 * 生成 ffmpeg volume 滤镜的逐帧表达式（eval=frame）：
 *   volume='if(lte(t,B),A+K*(t-a),…)…':eval=frame
 * baseVolume 是 clip.volume，包络值与它相乘得到最终增益。
 * 无有效包络点返回 null（调用方回退常数 volume 滤镜）。
 */
export function buildVolumeAutomationExpr(
  points: TimelineVolumePoint[] | null | undefined,
  baseVolume = 1,
): string | null {
  // 这里的点已由客户端按项目 fps 帧量化（normalizeVolumePoints），
  // 只做防御性过滤：丢非法值、夹紧倍率、升序、同刻取更低值；不做二次量化。
  const safe = Array.isArray(points)
    ? points
        .filter((p) => p && Number.isFinite(Number(p.t)) && Number.isFinite(Number(p.v)))
        .map((p) => ({ t: Math.max(0, Number(p.t)), v: clampNum(Number(p.v), VOLUME_MIN, VOLUME_MAX) }))
        .sort((a, b) => a.t - b.t || a.v - b.v)
    : [];
  const list: TimelineVolumePoint[] = [];
  for (const p of safe) {
    const last = list[list.length - 1];
    if (last && Math.abs(last.t - p.t) < 1e-9) {
      if (p.v < last.v) list[list.length - 1] = p;
    } else {
      list.push(p);
    }
  }
  if (list.length === 0) return null;
  // 最终增益 = 包络倍率 × 片段音量；折叠进每个点的值，表达式少一层括号
  const base = clampNum(Number.isFinite(baseVolume) ? baseVolume : 1, 0, VOLUME_MAX);
  let expr: string;
  if (list.length === 1) {
    expr = fmt(list[0].v * base);
  } else {
    // 补一个 t=0 基准：首点之前预览保持首点值，表达式也要保持（否则线性外推会跑偏）
    if (list[0].t > 0) list.unshift({ t: 0, v: list[0].v });
    const vals = list.map((p) => p.v * base);
    // 从末段往前包 if：t 落在 [a, b) 用线性段，之后保持末点值
    expr = fmt(vals[vals.length - 1]);
    for (let i = list.length - 2; i >= 0; i -= 1) {
      const aT = list[i].t;
      const bT = list[i + 1].t;
      const aV = vals[i];
      const bV = vals[i + 1];
      const k = (bV - aV) / Math.max(1e-9, bT - aT);
      const line = `${fmt(aV)}+(${fmt(k)})*(t-${fmt(aT)})`;
      expr = `if(lt(t,${fmt(bT)}),${line},${expr})`;
    }
  }
  return `(${expr})`;
}
