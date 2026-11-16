/**
 * 转场规划（纯函数）
 * ------------------------------------------------------------------
 * 「叠化」不是给单段加个 fade 滤镜就能出来的——fade 只是自己变黑，
 * 真正的叠化需要前后两段**同时有画面**并互相混合（ffmpeg 的 xfade）。
 * 这带来两个必须在上游算清楚的问题：
 *
 * 1) 每段要渲染多长？
 *    叠化窗口落在 A 的末尾 + B 的开头。若 A 只渲染到自己的出点，
 *    xfade 就没有足够的素材可混（offset + duration 超过 A 的长度会直接报错）。
 *    所以叠化出场的段要多渲染 `d` 秒「尾巴」——优先用源文件出点之后的真实内容
 *    （剪辑软件里的 handle），源不够时由 tpad 克隆末帧兜底。
 *
 * 2) 接缝处的时间点怎么算？
 *    所有片段在成片里仍按「硬切顺序」首尾相接，成片总时长 = 各段 span 之和。
 *    叠化不缩短成片：A 的尾巴与 B 的开头在 `[offset, offset+d]` 重叠，
 *    这段属于 A 的尾巴（不占总时间轴），因此下游音频的 adelay 不受影响。
 *    这条是硬约束——一旦叠化缩短总时长，所有按 timelineStart 混音的音频会整体错位。
 *
 * 因此本模块只回答三件事：每段渲染多长、每条接缝是硬切还是叠化、成片多长。
 * 渲染与滤镜组装留给 timeline.service，便于这里的规则被单测穷举。
 */

export type TransitionKind = 'none' | 'crossfade' | 'fade';

export interface TransitionPlanClip {
  /** 该片段在成片里应占的时长（已按 speed 折算） */
  span: number;
  /** 出点转场（本段 → 下一段） */
  transition?: { type?: string | null; duration?: number | null } | null;
}

export interface TransitionJoin {
  kind: 'cut' | 'xfade';
  /** xfade：在累积流上的起点（秒）；cut 固定为「上一段结束处」 */
  offset: number;
  /** xfade：叠化时长（cut 为 0） */
  duration: number;
}

export interface TransitionPlan {
  /** 每段实际渲染时长（含叠化尾巴），与输入一一对应 */
  renderSpan: number[];
  /** n-1 条接缝 */
  joins: TransitionJoin[];
  /** 成片总时长：各段 span 之和，叠化不改变它 */
  total: number;
  /** 是否真的存在叠化（决定要不要走 filter_complex 重编码） */
  hasCrossfade: boolean;
}

/** 叠化下限：再短就跟硬切没区别，还会因为帧对齐抖一下 */
export const XFADE_MIN = 0.1;
/** 叠化上限：超过 3 秒的叠化在短剧里通常只是「拖时间」 */
export const XFADE_MAX = 3;
/** 渲染余量：抵消编码后时长与标称值之间的毫秒级误差（xfade 会丢掉它，不影响对齐） */
const EPS = 0.05;

const round3 = (n: number): number => Math.round(n * 1000) / 1000;

/**
 * 叠化时长夹紧：不能超过任一侧时长的一半。
 * 超过一半意味着整段都在混，等于两段都看不见，且 xfade 会因 offset+duration
 * 超出第一段长度而报错。
 */
export function clampXfadeDuration(requested: number, spanA: number, spanB: number): number {
  const half = Math.min(spanA, spanB) / 2;
  const d = Math.min(XFADE_MAX, Math.min(Number.isFinite(requested) ? requested : 0, half));
  return d >= XFADE_MIN ? round3(d) : 0;
}

export function planTransitions(clips: TransitionPlanClip[]): TransitionPlan {
  const spans = clips.map((c) => {
    const s = Number.isFinite(c.span) && c.span > 0 ? c.span : 0.05;
    return round3(s);
  });
  const n = spans.length;
  const durs: number[] = new Array(Math.max(0, n - 1)).fill(0);
  for (let i = 0; i < n - 1; i += 1) {
    const t = clips[i]?.transition;
    if (!t || t.type !== 'crossfade') continue;
    durs[i] = clampXfadeDuration(Number(t.duration ?? 0) || 0, spans[i], spans[i + 1]);
  }

  const renderSpan = spans.map((s, i) => round3(s + (durs[i] ?? 0) + ((durs[i] ?? 0) > 0 ? EPS : 0)));

  const joins: TransitionJoin[] = [];
  let acc = spans[0] ?? 0; // 下一段在成片里的起点
  for (let i = 0; i < n - 1; i += 1) {
    const d = durs[i] ?? 0;
    joins.push({ kind: d > 0 ? 'xfade' : 'cut', offset: round3(acc), duration: d });
    acc = round3(acc + spans[i + 1]);
  }

  return {
    renderSpan,
    joins,
    total: round3(spans.reduce((a, b) => a + b, 0)),
    hasCrossfade: joins.some((j) => j.kind === 'xfade'),
  };
}

/**
 * 把计划拼成 ffmpeg filter_complex（不含输入/输出参数）。
 *
 * 约定：输入标签 [0:v]…[n-1:v]，输出标签 [vout]。
 * 硬切用 concat 滤镜（不是 concat 协议）—— 因为要与 xfade 串在同一条图里，
 * 只有滤镜链能保证时间戳连续、且各段参数已被前置步骤统一过。
 *
 * 两个踩过的坑（删掉就废）：
 * 1) 每个输入必须先 `settb=1/fps` 统一时间基。直接用文件默认时间基去 xfade，
 *    会报 `timebase (1/12288) do not match` 然后整条图配置失败。
 * 2) concat 滤镜的输出时间基会被 ffmpeg 改成 1/1000000，**每接一次硬切都要重新 settb**，
 *    否则「硬切 + 叠化」混排时 xfade 一样报时间基不匹配（实测报错，
 *    报错文本叫 `First input link main timebase (1/1000000) do not match`）。
 */
export function buildTransitionFilter(plan: TransitionPlan, fps: number): string {
  const fpsInt = Math.max(1, Math.round(fps > 0 ? fps : 24));
  const tb = `settb=1/${fpsInt}`;
  const n = plan.renderSpan.length;
  if (n === 0) return '';
  const parts: string[] = [];
  for (let i = 0; i < n; i += 1) {
    parts.push(`[${i}:v]${tb},setpts=PTS-STARTPTS[in${i}]`);
  }
  if (plan.joins.length === 0) {
    parts.push(`[in0]null[vout]`);
    return parts.join(';');
  }
  let prev = '[in0]';
  for (let i = 0; i < plan.joins.length; i += 1) {
    const j = plan.joins[i];
    const last = i === plan.joins.length - 1;
    const raw = `[r${i}]`;
    if (j.kind === 'xfade') {
      parts.push(
        `${prev}[in${i + 1}]xfade=transition=fade:duration=${j.duration}:offset=${j.offset}${raw}`,
      );
    } else {
      parts.push(`${prev}[in${i + 1}]concat=n=2:v=1:a=0${raw}`);
    }
    const settled = last ? '[vout]' : `[j${i}]`;
    parts.push(`${raw}${tb}${settled}`);
    prev = settled;
  }
  return parts.join(';');
}
