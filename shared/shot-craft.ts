/**
 * 镜头工艺（纯函数，前后端同源）
 *
 * 解决的是「分镜之间接不住」这件事：跳轴、光位跳变、景别原地踏步、
 * 上一个动作没做完就切下一个。三家源码的共同结论是——这些不是模型能力问题，
 * 而是**分镜阶段没有把空间与连续性写清楚**，到生成阶段再补救已经来不及。
 *
 * 对标依据：
 * - Toonflow `references/knowledge/shotCraft.md`：
 *   · 空间基准用「左/中/右 × 前/中/后」九格表述，先建立基准再谈运镜；
 *   · 普通反打「左侧人物向右看，右侧人物向左看」，不能因为想都露正脸就让两人
 *     无理由面朝镜头；
 *   · 180° 连续性约束的是观众能理解的空间，不是禁止走位；
 *   · 相邻镜必须核对角色位置、动作完成度、持物手、道具归属、眼线、服装状态；
 *   · 「连续三个同景别而无信息或关系变化」需要检查；
 *   · 动作密度 2~3s ≈ 1 拍，4~6s ≈ 2 拍，7s+ ≈ 3 拍；
 *   · 片段时长 ≤15s（与模型上限取较小者），片段边界靠动作/情绪/视线/声源衔接，
 *     且要记录「前段结束状态 → 本段开始状态」。
 * - Toonflow `references/storyboardTable.md`：「场 → 片段 → 镜」三级，资产引用挂片段级。
 * - 火宝 `video-prompts.ts`：视频提示词按 3 秒分段，每段写画面 + 台词。
 */

import type {
  AxisDirection,
  PropStateVariant,
  ScreenDirection,
  ShotBeat,
  SpaceAnchor,
} from './api.interface';

/** 空间九宫格中文表述（与「左前/中前/…」一一对应） */
export const SPACE_ANCHOR_LABELS: Record<SpaceAnchor, string> = {
  left_front: '左前',
  mid_front: '中前',
  right_front: '右前',
  left_mid: '左中',
  mid_mid: '中中',
  right_mid: '右中',
  left_back: '左后',
  mid_back: '中后',
  right_back: '右后',
};

export const SPACE_ANCHORS = Object.keys(SPACE_ANCHOR_LABELS) as SpaceAnchor[];

export const AXIS_LABELS: Record<AxisDirection, string> = {
  left_to_right: '左 → 右（画面内向右移动/向右看）',
  right_to_left: '右 → 左（画面内向左移动/向左看）',
  frontal: '正对镜头（轴线垂直于画面）',
  depth: '纵深（朝向或背离镜头移动）',
};

/** 一句话的镜头工艺约束，直接拼进分镜表提示词 */
export const SHOT_GRAMMAR_RULES = [
  '先问「本镜给观众什么新信息」，再选景别、角度与运镜；没有新信息就不要切镜。',
  '定场用 1-2 镜完成：远景缓推交代环境与主体，或环境全貌接主体全景。',
  '连续三个同景别而没有信息或关系变化，必须改景别或合并。',
  '动作密度：2-3 秒约 1 拍，4-6 秒约 2 拍，7 秒以上约 3 拍；一拍 = 一项物理动作 / 一次主要运镜 / 一句短台词。',
  '同镜只安排一个主要运镜，不要推、拉、摇、环绕无依据地堆在一起。',
  '台词按约 4 字/秒估算：字数÷4 向上取整 + 每处停顿 0.3~0.5 秒 + 首尾余量约 1 秒；超 20 字必须在语义停顿处拆镜或切听者反应镜，声音仍归原说话者。',
  'visualPrompt 只写摄影机能记录的物理现象（位置/动作/表情/光影），抽象情绪必须外化成可见依据。',
].join('\n');

/** 空间与轴线约束，直接拼进分镜表提示词 */
export const SPATIAL_CONTINUITY_RULES = [
  '空间基准用「左/中/右 × 前/中/后」九格表述；每场第一次交代空间后必须给出基准，后续镜沿用，走位变化要写「变化点」。',
  '对话/对峙先定互动轴线：普通反打保持「左侧人物向右看，右侧人物向左看」；不得为了都露正脸让两人同时面朝镜头。',
  '同一片段内 axisDirection 不得翻转；跨轴必须在本片段内看见建立过程（运镜跨越或人物走位），并显式标注。',
  '相邻镜核对角色位置、动作完成度、持物手、道具归属、眼线与服装状态；上一镜手臂抬到半空，下一镜不能没有过渡就回到身侧。',
  '片段边界靠动作/情绪/视线/声源衔接；记录「前段结束状态 → 本段开始状态」，动接承接动作进度，静接承接终态。',
].join('\n');

/** 片段规约：一段 = 同一空间内一段连续动作 */
export const SEGMENT_MAX_SECONDS = 15;
export const SEGMENT_MAX_SHOTS = 4;
export const SEGMENT_MIN_SHOTS = 2;

export interface PieceableShot {
  id?: string;
  shotNumber: number;
  duration: number;
  dialogue?: string | null;
  shotSize?: string | null;
  /** 分镜表给出的片段号；缺失表示需要自动归段 */
  segment?: number | null;
}

export interface ShotPiece<T extends PieceableShot = PieceableShot> {
  /** 段内序号，从 1 起 */
  segmentNumber: number;
  shots: T[];
  durationSeconds: number;
}

/**
 * 按「≤15 秒且 2-4 镜」把同一场的镜头归段（确定性兜底）。
 *
 * LLM 分镜表若已给出片段就按它建；这条路径用于历史数据补段、
 * 以及 `parse_script` 确定性拆分 —— 否则新老数据会长期两套结构并存。
 * 归段只在**同一场**内进行，换场由调用方分别调用，绝不跨地点强接一个物理动作。
 */
export function groupShotsIntoPieces<T extends PieceableShot>(
  shots: T[],
  opts?: { maxSeconds?: number; maxShots?: number },
): ShotPiece<T>[] {
  const maxSeconds = opts?.maxSeconds ?? SEGMENT_MAX_SECONDS;
  const maxShots = opts?.maxShots ?? SEGMENT_MAX_SHOTS;
  const sorted = [...shots].sort((a, b) => a.shotNumber - b.shotNumber);
  const pieces: ShotPiece<T>[] = [];
  let buf: T[] = [];
  let seconds = 0;

  const flush = () => {
    if (buf.length === 0) return;
    pieces.push({ segmentNumber: pieces.length + 1, shots: buf, durationSeconds: seconds });
    buf = [];
    seconds = 0;
  };

  for (const s of sorted) {
    const d = Number.isFinite(s.duration) && s.duration > 0 ? s.duration : 0;
    if (buf.length >= maxShots) {
      // 满 4 镜必须收段
      flush();
    } else if (
      // 当前段本身已经超时（单镜 20 秒这类）→ 下一个镜必须另起
      seconds >= maxSeconds ||
      // 已满足「至少 2 镜」且再加就超 15 秒才切
      (buf.length >= SEGMENT_MIN_SHOTS && seconds + d > maxSeconds)
    ) {
      /*
       * 已满足「至少 2 镜」且再加就超 15 秒才切。
       * 不能在只有 1 镜时就按 15 秒切：默认单镜 8 秒，两镜 16 秒 ——
       * 那样每个片段都只剩一个镜头，片段这个概念就等于消失了。
       * 片段是「同一空间连续动作」的编组单位，不是一次生成单位，
       * 超长由上层 warn，不在这里强行切碎。
       */
      flush();
    }
    buf.push(s);
    seconds += d;
  }
  flush();
  return pieces;
}

/**
 * 规划片段：优先尊重分镜表给出的片段号，缺失的镜头按「≤15 秒 / 2-4 镜」自动归段。
 *
 * 为什么两种都要支持：LLM 有时会给片段号（叙事边界更准），有时只给扁平镜头
 * （确定性拆分、旧数据）。如果只认一种，就会出现「新数据有段、老数据没段」，
 * 下游的段内镜像链与轴线校验全部失效。
 */
export function planPieces<T extends PieceableShot>(
  shots: T[],
  opts?: { maxSeconds?: number; maxShots?: number },
): ShotPiece<T>[] {
  const sorted = [...shots].sort((a, b) => a.shotNumber - b.shotNumber);
  const numbered = sorted.filter((s) => typeof s.segment === 'number' && (s.segment as number) > 0);
  if (numbered.length === 0) return groupShotsIntoPieces(sorted, opts);

  const maxSeconds = opts?.maxSeconds ?? SEGMENT_MAX_SECONDS;
  const maxShots = opts?.maxShots ?? SEGMENT_MAX_SHOTS;
  const groups = new Map<number, T[]>();
  let current = 1;
  for (const s of sorted) {
    if (typeof s.segment === 'number' && s.segment > 0) current = s.segment;
    const list = groups.get(current) ?? [];
    list.push(s);
    groups.set(current, list);
  }

  const pieces: ShotPiece<T>[] = [];
  for (const [, list] of [...groups.entries()].sort((a, b) => a[0] - b[0])) {
    // 单段超长/超镜数时再按规约切开，但段号保持连续（拆出来的后半段顺延）
    if (list.length <= maxShots && sumDuration(list) <= maxSeconds) {
      pieces.push({ segmentNumber: pieces.length + 1, shots: list, durationSeconds: sumDuration(list) });
      continue;
    }
    for (const sub of groupShotsIntoPieces(list, opts)) {
      pieces.push({ segmentNumber: pieces.length + 1, shots: sub.shots, durationSeconds: sub.durationSeconds });
    }
  }
  return pieces;
}

function sumDuration(shots: { duration: number }[]): number {
  return shots.reduce((n, s) => n + (Number.isFinite(s.duration) && s.duration > 0 ? s.duration : 0), 0);
}

/** 台词时长估算：4 字/秒 + 每处标点停顿 + 首尾余量（Toonflow 的规划口径） */export function estimateDialogueSeconds(text: string | null | undefined): number {
  const t = typeof text === 'string' ? text.trim() : '';
  if (!t) return 0;
  // 只数「要念出来的字」：去掉角色前缀、括号提示、标点
  const spoken = t
    .replace(/^[^：:]{1,12}[：:]/, '')
    .replace(/（[^）]*）|\([^)]*\)|【[^】]*】/g, '')
    .replace(/[\s\p{P}\p{S}]/gu, '');
  const chars = [...spoken].length;
  if (chars === 0) return 0;
  const pauses = (t.match(/[，。！？；、,.!?;]/g) ?? []).length;
  return Math.ceil(chars / 4) + Math.min(2, pauses * 0.4) + 1;
}

/**
 * 反打时应有的画面方向（Toonflow 的「左者右看，右者左看」）。
 *
 * 输入本方与对方的空间锚点：本方在左、对方在右 → 本方必须向右看
 * （screenDirection = left_to_right），否则观众读到的是「两个人在各看各的」。
 */
export function reverseAngleScreenDirection(
  selfAnchor: SpaceAnchor,
  otherAnchor: SpaceAnchor,
): ScreenDirection {
  const col = (a: SpaceAnchor) => (a.startsWith('left') ? -1 : a.startsWith('right') ? 1 : 0);
  const delta = col(otherAnchor) - col(selfAnchor);
  if (delta > 0) return 'left_to_right';
  if (delta < 0) return 'right_to_left';
  // 同在中间列：只能正打或纵深，交给轴向决定
  return 'toward_camera';
}

/** 轴线方向与画面方向的相容性：用于检测「跳轴」 */
export function axisConsistent(axis: AxisDirection | null | undefined, dir: ScreenDirection | null | undefined): boolean {
  if (!axis || !dir || dir === 'static') return true;
  if (axis === 'frontal') return dir === 'toward_camera' || dir === 'away_from_camera';
  if (axis === 'depth') return dir === 'toward_camera' || dir === 'away_from_camera';
  return dir === axis;
}

export interface AxisCheckShot {
  shotNumber: number;
  axisDirection?: AxisDirection | null;
  screenDirection?: ScreenDirection | null;
}

export interface AxisViolation {
  shotNumber: number;
  axis?: AxisDirection | null;
  screenDirection?: ScreenDirection | null;
  message: string;
}

/**
 * 检查同一片段内的跳轴。返回空数组 = 没有明显问题。
 * 只报「同一段内方向与轴线矛盾」和「段内朝向凭空翻转」，不禁止剧情性走位
 * （走位本身是合法创作，前提是段内有建立过程，那属于人工审阅范围）。
 */
export function checkAxisContinuity(shots: AxisCheckShot[]): AxisViolation[] {
  const out: AxisViolation[] = [];
  let lastDir: ScreenDirection | null = null;
  for (const s of shots) {
    if (s.axisDirection && s.screenDirection && !axisConsistent(s.axisDirection, s.screenDirection)) {
      out.push({
        shotNumber: s.shotNumber,
        axis: s.axisDirection,
        screenDirection: s.screenDirection,
        message: `镜 ${s.shotNumber} 的画面方向（${s.screenDirection}）与本段轴线（${s.axisDirection}）矛盾`,
      });
    }
    const dir = s.screenDirection ?? null;
    const flippable: ScreenDirection[] = ['left_to_right', 'right_to_left'];
    if (dir && lastDir && flippable.includes(dir) && flippable.includes(lastDir) && dir !== lastDir) {
      out.push({
        shotNumber: s.shotNumber,
        screenDirection: dir,
        message: `镜 ${s.shotNumber} 相对上一镜翻转了画面方向（${lastDir} → ${dir}），疑似跳轴`,
      });
    }
    if (dir && dir !== 'static') lastDir = dir;
  }
  return out;
}

/** 景别节奏：连续三个同景别返回需要检查的镜号 */
export function repetitiveShotSizes(shots: { shotNumber: number; shotSize?: string | null }[]): number[] {
  const out: number[] = [];
  for (let i = 2; i < shots.length; i++) {
    const a = shots[i - 2]?.shotSize;
    const b = shots[i - 1]?.shotSize;
    const c = shots[i]?.shotSize;
    if (a && a === b && b === c) out.push(shots[i].shotNumber);
  }
  return out;
}

/**
 * 空间基准块（拼进片段说明/首帧上下文）：
 * `角色A：左前，3/4 正面朝右，注视角色B；角色B：右后…`
 */
export function describeSpatialBaseline(
  actors: { name: string; anchor?: SpaceAnchor | null; facing?: string; note?: string }[],
): string {
  if (actors.length === 0) return '';
  return actors
    .map((a) => {
      const where = a.anchor ? SPACE_ANCHOR_LABELS[a.anchor] : '';
      const bits = [where, a.facing, a.note].filter((v): v is string => Boolean(v && v.trim()));
      return bits.length > 0 ? `${a.name}：${bits.join('，')}` : a.name;
    })
    .join('；');
}

/** 视频分段长度（火宝按 3 秒切分；短视频模型普遍以 3-5 秒为一段理解动作） */
export const VIDEO_BEAT_SECONDS = 3;

/**
 * 归一化节拍到「每段 ≤3 秒、覆盖整镜时长」。
 *
 * - 有 beats 时：按 3 秒切分边界重切，保留原描述文字；
 * - 无 beats 时：返回空数组，由调用方决定是否退回单段描述（不编造画面内容）。
 */
export function normalizeBeats(
  beats: ShotBeat[] | null | undefined,
  duration: number,
  beatSeconds = VIDEO_BEAT_SECONDS,
): ShotBeat[] {
  const total = Number.isFinite(duration) && duration > 0 ? duration : 0;
  if (total <= 0) return [];
  const src = (beats ?? []).filter(
    (b) => b && Number.isFinite(b.from) && Number.isFinite(b.to) && b.to > b.from,
  );
  if (src.length === 0) return [];
  const out: ShotBeat[] = [];
  for (let from = 0; from < total - 1e-6; from += beatSeconds) {
    const to = Math.min(total, from + beatSeconds);
    // 取与该时间窗重叠最大的源节拍，避免把一句台词拆成两半念
    let best: ShotBeat | null = null;
    let bestOverlap = 0;
    for (const b of src) {
      const overlap = Math.min(to, b.to) - Math.max(from, b.from);
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        best = b;
      }
    }
    if (!best) continue;
    out.push({
      from: round1(from),
      to: round1(to),
      description: best.description,
      dialogue: best.dialogue,
    });
  }
  return out;
}

/** 从台词与镜头信息兜底生成节拍（无 LLM 参与时的确定性路径） */
export function deriveBeats(
  input: { duration: number; dialogue?: string | null; visualPrompt?: string | null; shotSize?: string | null },
  beatSeconds = VIDEO_BEAT_SECONDS,
): ShotBeat[] {
  const total = Number.isFinite(input.duration) && input.duration > 0 ? input.duration : 0;
  if (total <= 0) return [];
  const desc = (input.visualPrompt ?? '').trim() || '画面保持本镜构图，人物微表情与呼吸变化';
  const dialogue = (input.dialogue ?? '').trim();
  const out: ShotBeat[] = [];
  const segments = Math.max(1, Math.ceil(total / beatSeconds));
  for (let i = 0; i < segments; i++) {
    const from = i * beatSeconds;
    const to = Math.min(total, from + beatSeconds);
    out.push({
      from: round1(from),
      to: round1(to),
      description: i === 0 ? desc : `延续上一段动作，${desc}`,
      // 台词按段均分会让语速失真，宁可只挂首段，剩余由配音对齐
      dialogue: dialogue && i === 0 ? dialogue : undefined,
    });
  }
  return out;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * 从道具状态变体里挑出本镜该用哪个（开 / 合 / 破损 / 递出 …）。
 *
 * 「道具是持续身份，状态是变体」—— 只锁身份不锁状态，模型每镜都会重新
 * 决定这个道具此刻是什么形态，于是「已经打开的怀表」下一镜又合上了。
 * 判据是本镜的文字里出现了变体名，或描述的前 12 字片段。
 * 匹配不到返回 null：不猜，避免把途中状态硬套到每一镜。
 */
export function matchPropVariant(
  variants: PropStateVariant[] | null | undefined,
  shotText: string,
): PropStateVariant | null {
  const list = (variants ?? []).filter((v) => v && typeof v.name === 'string' && v.name.trim());
  if (list.length === 0 || !shotText.trim()) return null;
  const hay = shotText.toLowerCase();
  const byName = list.find((v) => hay.includes(v.name.trim().toLowerCase()));
  if (byName) return byName;
  for (const v of list) {
    const desc = (v.description ?? '').trim();
    if (desc.length < 4) continue;
    const key = desc.slice(0, 12).toLowerCase();
    if (key.length >= 4 && hay.includes(key)) return v;
  }
  return null;
}
