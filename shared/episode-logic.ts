/**
 * 长篇多集纯逻辑（migration 0024，方案②③）。
 * 与数据库解耦的判定函数统一放这里，episodes.service 只做取数/落库，
 * 保证「创建/排序上限/删除保护/账本规范化」的口径可以被单测直接覆盖
 * （移植 ArcReel「晋升/确认/产出同一份代码」纪律，防口径分叉）。
 */
import type {
  EpisodeStatus,
  HandoffProp,
  HandoffRelation,
  HandoffState,
} from './api.interface';

/** 单季集数上限：长篇数百集的规模按 500 封顶（创建时超限直接拒绝） */
export const EPISODE_MAX_PER_SEASON = 500;

export const EPISODE_STATUSES: readonly EpisodeStatus[] = [
  'draft',
  'script_ready',
  'shots_ready',
  'video_generating',
  'completed',
];

export const isEpisodeStatus = (v: unknown): v is EpisodeStatus =>
  typeof v === 'string' && (EPISODE_STATUSES as readonly string[]).includes(v);

/**
 * 创建集的集号：季内自动递增 = 当前最大集号 + 1。
 * maxNumber 传「该季现有最大 number」（无集传 0）。
 */
export function nextEpisodeNumber(maxNumber: number): number {
  return Math.max(0, Math.trunc(maxNumber) || 0) + 1;
}

/**
 * 创建集的上限校验：超过 EPISODE_MAX_PER_SEASON 直接拒绝。
 * count 传「该季现有集数」（含软删除外的全部行）。
 */
export function assertEpisodeQuota(count: number): void {
  if (Math.trunc(count) >= EPISODE_MAX_PER_SEASON) {
    throw new Error(
      `该季集数已达上限（${EPISODE_MAX_PER_SEASON} 集）：长篇分卷或开新一季后继续`,
    );
  }
}

/**
 * 删除保护：
 * - locked 的集不可删（先解锁再删，防止误删交接账本已冻结的集）；
 * - 有成片的集不可直接删（确认删该集 shots/scenes 属高危操作，交由显式 force 参数走应用层级联）。
 * 返回 null 表示允许删除；返回字符串 = 拒绝原因。
 */
export function episodeDeleteGuard(
  episode: { locked?: boolean | null; status?: string | null },
  counts: { shots: number; scenes: number },
  force?: boolean,
): string | null {
  if (episode.locked === true) {
    return '该集已锁定：请先解锁再删除（防止误删交接账本）';
  }
  const hasProducts = counts.shots > 0 || counts.scenes > 0;
  if (hasProducts && force !== true) {
    return `该集仍挂着 ${counts.scenes} 个场景 / ${counts.shots} 个镜头：确认删除请带 force=true（将连带删除该集场景与镜头）`;
  }
  return null;
}

/**
 * 集状态推进合法性：只允许沿 draft → script_ready → shots_ready →
 * video_generating → completed 单向推进；回退一律拒绝（回退走删除/重建）。
 */
export function canAdvanceEpisode(from: EpisodeStatus, to: EpisodeStatus): boolean {
  const order = EPISODE_STATUSES as readonly string[];
  return order.indexOf(to) > order.indexOf(from);
}

/** 集内 shots 聚合 → 集状态（A4 按集聚合的派生口径；不自动写库，仅供推进时参考） */
export function deriveEpisodeStatus(aggregate: {
  hasScript?: boolean;
  totalShots: number;
  withFirstFrame: number;
  withVideo: number;
  activeVideoJobs?: number;
}): EpisodeStatus {
  const { hasScript, totalShots, withFirstFrame, withVideo, activeVideoJobs } = aggregate;
  if (totalShots === 0) return hasScript ? 'script_ready' : 'draft';
  if (withVideo >= totalShots) return 'completed';
  if ((activeVideoJobs ?? 0) > 0 || withVideo > 0) return 'video_generating';
  if (withFirstFrame >= totalShots) return 'shots_ready';
  return hasScript ? 'script_ready' : 'draft';
}

/**
 * 交接账本规范化（B2）：无论库里存的是 '{}'、缺字段还是旧结构，
 * 读出来一定是 { facts, props, relations } 三个数组齐全。
 */
export function normalizeHandoffState(raw: unknown): HandoffState {
  const obj = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const facts = Array.isArray(obj.facts) ? obj.facts : [];
  const props = Array.isArray(obj.props) ? obj.props : [];
  const relations = Array.isArray(obj.relations) ? obj.relations : [];
  return {
    facts: facts
      .filter((f): f is { text?: unknown; createdAt?: unknown } => f != null && typeof f === 'object')
      .map((f) => ({
        text: typeof f.text === 'string' ? f.text : String((f as { text?: unknown }).text ?? ''),
        createdAt: typeof f.createdAt === 'string' ? f.createdAt : '',
      }))
      .filter((f) => f.text.trim().length > 0),
    props: props
      .filter((p): p is { name?: unknown; holder?: unknown } => p != null && typeof p === 'object')
      .map((p) => ({
        name: String(p.name ?? ''),
        holder: String(p.holder ?? ''),
        updatedAt: typeof (p as { updatedAt?: unknown }).updatedAt === 'string'
          ? (p as { updatedAt: string }).updatedAt
          : undefined,
      }))
      .filter((p) => p.name.trim().length > 0),
    relations: relations
      .filter((r): r is { a?: unknown; b?: unknown; status?: unknown } => r != null && typeof r === 'object')
      .map((r) => ({
        a: String(r.a ?? ''),
        b: String(r.b ?? ''),
        status: String(r.status ?? ''),
      }))
      .filter((r) => r.a.trim().length > 0 && r.b.trim().length > 0),
  };
}

/** 追加不可逆事实（B2 appendFact 纯函数）：去重（同文本不重复记），时间戳由调用方传入 */
export function appendFact(
  state: HandoffState,
  text: string,
  now: string,
): { facts: HandoffState['facts']; changed: boolean } {
  const trimmed = text.trim();
  if (!trimmed) return { facts: state.facts, changed: false };
  if (state.facts.some((f) => f.text === trimmed)) {
    return { facts: state.facts, changed: false };
  }
  return { facts: [...state.facts, { text: trimmed, createdAt: now }], changed: true };
}

/** 道具归属落账（B2 resolveProp 纯函数）：同名道具覆盖 holder，其余保持插入序 */
export function resolveProp(
  state: HandoffState,
  name: string,
  holder: string,
  now: string,
): { props: HandoffProp[]; changed: boolean } {
  const trimmedName = name.trim();
  const trimmedHolder = holder.trim();
  if (!trimmedName) return { props: state.props, changed: false };
  const existing = state.props.findIndex((p) => p.name === trimmedName);
  if (existing >= 0) {
    if (state.props[existing].holder === trimmedHolder) {
      return { props: state.props, changed: false };
    }
    const next = state.props.map((p, i) =>
      i === existing ? { ...p, holder: trimmedHolder, updatedAt: now } : p,
    );
    return { props: next, changed: true };
  }
  const next: HandoffProp[] = [...state.props, { name: trimmedName, holder: trimmedHolder, updatedAt: now }];
  return { props: next, changed: true };
}

/** 关系变化落账（B2）：(a,b) 无序对唯一，同对覆盖 status */
export function upsertRelation(
  state: HandoffState,
  a: string,
  b: string,
  status: string,
): { relations: HandoffRelation[]; changed: boolean } {
  const pair = [a.trim(), b.trim()].sort().join('↔');
  if (!pair || !status.trim()) return { relations: state.relations, changed: false };
  const keyOf = (r: HandoffRelation) => [r.a, r.b].sort().join('↔');
  const existing = state.relations.findIndex((r) => keyOf(r) === pair);
  if (existing >= 0) {
    if (state.relations[existing].status === status) {
      return { relations: state.relations, changed: false };
    }
    const next = state.relations.map((r, i) => (i === existing ? { a: a.trim(), b: b.trim(), status } : r));
    return { relations: next, changed: true };
  }
  return { relations: [...state.relations, { a: a.trim(), b: b.trim(), status }], changed: true };
}

/**
 * 按集门顺序校验（复用 project 级 approve 语义的按集版本）：
 * script → storyboard → preview → final 依次通过；乱序确认拒绝。
 * approvals 为该集当前已过的门。返回 null = 允许；字符串 = 拒绝原因。
 */
export function episodeGateGuard(
  stage: 'script' | 'storyboard' | 'preview' | 'final',
  approvals: Record<string, string | undefined>,
): string | null {
  if (stage === 'storyboard' && !approvals.script) {
    return '确认门顺序错误：请先通过「剧本确认」再确认本集分镜（script → storyboard → preview → final）';
  }
  if (stage === 'preview' && !approvals.storyboard) {
    return '确认门顺序错误：请先通过「分镜确认」再确认本集预览';
  }
  if (stage === 'final' && !approvals.storyboard) {
    return '确认门顺序错误：请先通过「分镜确认」再确认本集成片';
  }
  return null;
}
