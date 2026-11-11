/**
 * 镜头接缝（continuity）规则 —— 移植 Toonflow「视频导演规则」里最硬的一条。
 * ------------------------------------------------------------------
 * 前提：视频模型每次只生成一段，生成时看不到上一段长什么样。
 * 两段独立生成的视频直接接上，很容易看起来像「画面跳了一下」。
 *
 * Toonflow 原规则：上一段最后一镜与下一段第一镜之间，以下三条至少满足一条
 *   1) 拍的主体不同（双人 → 单人）
 *   2) 景别差两档以上（中景 → 特写）
 *   3) 拍摄角度差 90 度以上
 * 一个动作要切成两个镜头完成的话，尽量放在同一段里，不要跨段。
 *
 * 他们的短板是「只写在文档里，靠模型自觉」。我们反过来做成程序判定 +
 * 物化时自动修复：分镜一旦落库就已经满足接缝，不指望下游模型守规矩。
 *
 * 为什么默认走「景别差两档」而不是「换角度」：
 * 同一主体连说两句时，正反打（换主体）不成立，而把机位甩到 90 度侧面对
 * 纯对话是反语法；中景 ↔ 特写才是对切的标准解法。角度留给显式配置。
 */

export const SEAM_MIN_SIZE_GAP = 2;
export const SEAM_MIN_ANGLE_GAP = 90;

/** 景别由远到近排序（数字越大越近）。establishing 与 wide 等价。 */
export const SHOT_SIZE_RANK: Record<string, number> = {
  extreme_long: 1,
  long: 2,
  wide: 3,
  establishing: 3,
  medium: 4,
  medium_closeup: 5,
  closeup: 6,
  extreme_closeup: 7,
};

/** rank → 代表景别（写库用；同 rank 取最常用那个） */
const RANK_TO_SIZE: Record<number, string> = {
  1: 'extreme_long',
  2: 'long',
  3: 'wide',
  4: 'medium',
  5: 'medium_closeup',
  6: 'closeup',
  7: 'extreme_closeup',
};

/** 机位角度归一到 0/45/90/180 四档（正打 / 三刻 / 侧 / 背） */
const ANGLE_BUCKET: Record<string, number> = {
  front: 0,
  eye_level: 0,
  pov: 0,
  over_shoulder: 45,
  three_quarter: 45,
  side: 90,
  profile: 90,
  back: 180,
  rear: 180,
};

export interface SeamShot {
  shotSize?: string | null;
  cameraAngle?: string | null;
  /** 稳定主体标识：优先角色 ID 串，无 ID 时用说话人/主体名 */
  subjectKey?: string | null;
}

export interface SeamVerdict {
  ok: boolean;
  sizeGap: number;
  angleGap: number;
  sameSubject: boolean;
  /** 命中的放行条件（便于日志/质检说明） */
  reason: 'subject_changed' | 'size_gap' | 'angle_gap' | 'broken';
}

export function shotSizeRank(size?: string | null): number {
  const key = (size ?? '').trim();
  return SHOT_SIZE_RANK[key] ?? 4;
}

export function sizeNameAtRank(rank: number): string {
  const clamped = Math.max(1, Math.min(7, Math.round(rank)));
  return RANK_TO_SIZE[clamped] ?? 'medium';
}

function angleOf(angle?: string | null): number {
  const key = (angle ?? '').trim();
  return ANGLE_BUCKET[key] ?? 0;
}

/** 角度差（环形取最短弧）：0 与 180 差 180，0 与 90 差 90 */
export function angleGap(a?: string | null, b?: string | null): number {
  const delta = Math.abs(angleOf(a) - angleOf(b));
  return Math.min(delta, 360 - delta);
}

/** 上一镜的收尾状态 → 下一镜的起手状态，三条至少满足一条 */
export function checkSeam(prev: SeamShot, next: SeamShot): SeamVerdict {
  const prevKey = (prev.subjectKey ?? '').trim();
  const nextKey = (next.subjectKey ?? '').trim();
  // 主体未知时不能算"换了主体"——宁可认为没换，逼出景别/角度差异
  const sameSubject = !prevKey || !nextKey || prevKey === nextKey;
  const sizeGap = Math.abs(shotSizeRank(next.shotSize) - shotSizeRank(prev.shotSize));
  const gap = angleGap(prev.cameraAngle, next.cameraAngle);

  if (!sameSubject) {
    return { ok: true, sizeGap, angleGap: gap, sameSubject, reason: 'subject_changed' };
  }
  if (sizeGap >= SEAM_MIN_SIZE_GAP) {
    return { ok: true, sizeGap, angleGap: gap, sameSubject, reason: 'size_gap' };
  }
  if (gap >= SEAM_MIN_ANGLE_GAP) {
    return { ok: true, sizeGap, angleGap: gap, sameSubject, reason: 'angle_gap' };
  }
  return { ok: false, sizeGap, angleGap: gap, sameSubject, reason: 'broken' };
}

/**
 * 把下一镜的景别拉到与上一镜相差两档（同主体、同角度时的兜底）。
 * 方向选择：上一镜已经很近（中近景/特写）就退远两档，否则推近两档——
 * 避免"特写再接大特写"这种越拍越糊的连续推近。
 */
export function sizeForSeam(prev: SeamShot, nextShotSize?: string | null): string {
  const prevRank = shotSizeRank(prev.shotSize);
  const nextRank = shotSizeRank(nextShotSize);
  const widen = prevRank >= 5 ? prevRank - SEAM_MIN_SIZE_GAP : prevRank + SEAM_MIN_SIZE_GAP;
  const target = Math.max(1, Math.min(7, widen));
  // 若原景别已经天然满足，保持原样（不为了修复而改掉已经对的镜头）
  if (Math.abs(nextRank - prevRank) >= SEAM_MIN_SIZE_GAP) return sizeNameAtRank(nextRank);
  return sizeNameAtRank(target);
}

/**
 * 批量修复一段有序镜头：返回每处修改，供日志与质检说明。
 * 纯函数，不改入参对象（返回新数组，元素浅拷贝）。
 */
export function repairSeams<T extends SeamShot>(
  ordered: T[],
  pickSubject: (s: T) => string,
): { shots: T[]; fixes: { index: number; from: string; to: string }[] } {
  const out: T[] = [];
  const fixes: { index: number; from: string; to: string }[] = [];
  for (let i = 0; i < ordered.length; i += 1) {
    const cur = { ...ordered[i] };
    const prev = out[out.length - 1];
    if (prev) {
      const verdict = checkSeam(
        { shotSize: prev.shotSize, cameraAngle: prev.cameraAngle, subjectKey: pickSubject(prev) },
        { shotSize: cur.shotSize, cameraAngle: cur.cameraAngle, subjectKey: pickSubject(cur) },
      );
      if (!verdict.ok) {
        const from = String(cur.shotSize ?? '');
        cur.shotSize = sizeForSeam(prev, cur.shotSize);
        fixes.push({ index: i, from, to: String(cur.shotSize) });
      }
    }
    out.push(cur);
  }
  return { shots: out, fixes };
}
