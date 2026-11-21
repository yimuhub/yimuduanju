/**
 * 时间线空隙闭合（纯函数，可单测）
 * -------------------------------------------------------------
 * 对齐 OpenMotion `studio/src/player/components/timelineGaps.ts` 的语义，
 * 实现「右键空白轨区 → 闭合此空隙 / 闭合全部空隙」（剪映/Premiere 同款）。
 *
 * 约定与边界：
 *   · 只处理「一条轨道行」内的片段集合——调用方按 track + lane 过滤后传入，
 *     跨轨行为不在本库范围内（OpenMotion 同样如此）；
 *   · 片段占据半开区间 [start, start + duration)；
 *   · 比较统一带 epsilon 容差，浮点漂移（8.4 + 2.7 = 11.1000…01）不会
 *     凭空造出一条发丝空隙；
 *   · 本项目时间全部按帧量化，输出的新起点再经 round3 保留毫秒精度；
 *   · 「闭合全部空隙」保留首个片段的起点（前导空隙是刻意的留黑，不吞），
 *     只收拢其后的所有空隙——画面轨从 0 排齐请用 packVideo。
 */

export const GAP_EPSILON_S = 1e-6;

export interface GapClip {
  id: string;
  /** 时间线起点（秒） */
  start: number;
  /** 时间线上的有效时长（秒）＝ (outPoint - inPoint) / speed */
  duration: number;
  /** 锁定片段不可移动（闭合空隙需要整体平移时会被拒绝） */
  locked?: boolean;
}

export interface GapInterval {
  start: number;
  end: number;
}

export interface GapAt {
  /** 空隙左边缘：指针左侧片段的最大末端（前导空隙为 0） */
  gapStart: number;
  /** 空隙右边缘：右侧第一个片段的起点 */
  gapEnd: number;
  /** 空隙右侧（含紧邻者）按起点排序的全部片段 id */
  followingIds: string[];
}

export interface GapShift {
  id: string;
  newStart: number;
}

const round3 = (v: number) => Math.round(v * 1000) / 1000;
const endOf = (c: GapClip) => c.start + c.duration;

/** 按起点排序（id 作稳定次序），闭合结果与片段输入顺序无关 */
export function sortedGapClips(clips: readonly GapClip[]): GapClip[] {
  return [...clips].sort(
    (a, b) => a.start - b.start || a.id.localeCompare(b.id),
  );
}

/**
 * 指针时刻所在行的空隙。
 * 返回 null 的三种情况：点在片段上 / 右侧没有片段（无从闭合）/ 相邻片段首尾相接。
 */
export function resolveGapAt(
  clips: readonly GapClip[],
  time: number,
  epsilon: number = GAP_EPSILON_S,
): GapAt | null {
  const sorted = sortedGapClips(clips);
  if (sorted.length === 0) return null;
  const occupied = sorted.some(
    (c) => time >= c.start - epsilon && time < endOf(c) - epsilon,
  );
  if (occupied) return null;
  const following = sorted.filter((c) => c.start > time - epsilon);
  if (following.length === 0) return null;
  const gapEnd = following[0].start;
  const gapStart = Math.max(
    0,
    ...sorted.filter((c) => c.start <= time - epsilon).map(endOf),
  );
  if (gapEnd - gapStart <= epsilon) return null;
  return { gapStart, gapEnd, followingIds: following.map((c) => c.id) };
}

/**
 * 当前行的全部空隙区间（含前导空隙），左到右排列；纯描述用途
 * （菜单置灰判断、hover 高亮）。重叠片段不会造出负区间。
 */
export function resolveGapIntervals(
  clips: readonly GapClip[],
  epsilon: number = GAP_EPSILON_S,
): GapInterval[] {
  const gaps: GapInterval[] = [];
  let cursor = 0;
  for (const clip of sortedGapClips(clips)) {
    if (clip.start - cursor > epsilon) gaps.push({ start: cursor, end: clip.start });
    cursor = Math.max(cursor, endOf(clip));
  }
  return gaps;
}

/**
 * 闭合一条空隙：空隙右侧（followingIds）的片段整体左移空隙宽度。
 * 新起点不会越过空隙自身左边缘（clamp 到 gapStart，只做浮点兜底）。
 */
export function resolveCloseGapShifts(
  clips: readonly GapClip[],
  gap: GapAt,
  epsilon: number = GAP_EPSILON_S,
): GapShift[] {
  const width = gap.gapEnd - gap.gapStart;
  const followSet = new Set(gap.followingIds);
  return sortedGapClips(clips)
    .filter((c) => followSet.has(c.id))
    .map((c) => ({
      id: c.id,
      newStart: Math.max(gap.gapStart, round3(c.start - width)),
    }))
    .filter((s, i, arr) => {
      const clip = clips.find((c) => c.id === s.id);
      return Boolean(clip) && Math.abs((clip?.start ?? 0) - s.newStart) > epsilon;
    });
}

/**
 * 收拢整行：保留首个片段的起点，其后每个片段按原顺序首尾相接
 * （OpenMotion 的 resolveAllTrackGaps 从 0 排齐；本项目把「从 0 排齐」
 * 留给 packVideo，这里不吞前导留黑）。只返回起点真正变化的片段。
 */
export function resolveCloseAllShifts(
  clips: readonly GapClip[],
  epsilon: number = GAP_EPSILON_S,
): GapShift[] {
  const sorted = sortedGapClips(clips);
  if (sorted.length === 0) return [];
  const shifts: GapShift[] = [];
  let cursor = sorted[0].start;
  for (const clip of sorted) {
    const newStart = round3(cursor);
    if (Math.abs(newStart - clip.start) > epsilon) {
      shifts.push({ id: clip.id, newStart });
    }
    cursor = newStart + clip.duration;
  }
  return shifts;
}

/** 是否存在「闭合全部空隙」能收拢的空隙（前导空隙不计） */
export function trackHasGaps(
  clips: readonly GapClip[],
  epsilon: number = GAP_EPSILON_S,
): boolean {
  return resolveCloseAllShifts(clips, epsilon).length > 0;
}
