/**
 * 时间线拖放落点计算（纯函数，可单测）
 * -------------------------------------------------------------
 * 拖素材到时间线时，剪映的行为是「落在鼠标那一行的那个时刻；如果那里已经被占，
 * 就自动在下方新建一条轨道」，而不是弹窗问「放哪条轨」。这里把这条规则抽成纯函数，
 * 组件只负责把「鼠标坐标 → 轨道/时间」和「落点 → 新建片段」两步接起来。
 *
 * 关键边界：
 *   · 首尾相接（end === start）不算重叠——把片段拖到另一段之后紧接着放，不该另开一轨；
 *   · 落点在最后一行下方（preferred 超过现有最大 lane）时直接新建；
 *   · 所有 lane 都占满时返回 maxLane + 1，保证拖放永远有结果。
 */

export interface OccupiedSpan {
  lane: number;
  /** 片段在时间线上的起点（秒） */
  start: number;
  /** 片段在时间线上的终点（秒），= start + span */
  end: number;
}

export interface LanePick {
  lane: number;
  /** true = 这个 lane 是本次拖放新开的（现有轨道里没有） */
  created: boolean;
}

/** 浮点比较容差：时间线全部按帧量化，1e-6 足够区分「相接」与「重叠」 */
const EPS = 1e-6;

const overlaps = (a: { start: number; end: number }, b: { start: number; end: number }): boolean =>
  a.start < b.end - EPS && b.start < a.end - EPS;

/**
 * 选一条放得下的轨道。
 *
 * @param occupied  同类型轨道上已有的片段（video 只看 video 轨，audio 只看 audio 轨）
 * @param preferred 鼠标所在行对应的 lane（鼠标在空白处/最后一行下方时由调用方给一个较大值）
 * @param start     片段将落在的时间线起点
 * @param end       片段将落在的时间线终点
 */
export function pickFreeLane(
  occupied: OccupiedSpan[],
  preferred: number,
  start: number,
  end: number,
): LanePick {
  const want = Number.isFinite(preferred) ? Math.max(0, Math.floor(preferred)) : 0;
  // lane 0 是每种轨道的默认行（rows 里恒存在），所以下限是 0 而不是 -1
  const maxLane = occupied.reduce((m, s) => Math.max(m, s.lane), 0);
  const taken = (lane: number): boolean =>
    occupied.some((s) => s.lane === lane && overlaps(s, { start, end }));

  if (!taken(want)) return { lane: want, created: want > maxLane };

  // 被占了：从最上面往下找第一个空档（剪映是往下新增，但优先复用已有空轨更省高度）
  for (let lane = 0; lane <= maxLane; lane += 1) {
    if (!taken(lane)) return { lane, created: false };
  }
  return { lane: maxLane + 1, created: true };
}

/**
 * 鼠标纵坐标 → 轨道 lane。
 *
 * @param rows      自上而下的行（含 track 与像素高度），顺序必须与画面一致
 * @param y         相对轨道画布顶部的偏移（px）
 * @param track     被拖素材的轨道类型（video / audio / subtitle / overlay）
 * @returns         命中行时返回该行 lane；落在最后一行下方（空白区）时返回该类型
 *                  最大 lane + 1 —— 即「拖到空白处 = 新建一条轨」
 */
export function laneFromY(
  rows: { track: string; lane: number; height: number }[],
  y: number,
  track: string,
): number {
  let acc = 0;
  let maxLaneOfTrack = -1;
  for (const r of rows) {
    if (r.track === track) maxLaneOfTrack = Math.max(maxLaneOfTrack, r.lane);
    if (y >= acc && y < acc + r.height) {
      // 命中不同类的轨道时，退回该类最上面一条（拖音频到画面行 = 放到音频轨首层）
      return r.track === track ? r.lane : firstLaneOf(rows, track);
    }
    acc += r.height;
  }
  // 空白区（最后一行以下）：新建
  return maxLaneOfTrack + 1;
}

const firstLaneOf = (
  rows: { track: string; lane: number }[],
  track: string,
): number => rows.filter((r) => r.track === track).map((r) => r.lane).sort((a, b) => a - b)[0] ?? 0;
