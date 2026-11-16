/**
 * 时间线动作引擎（前后端共用，纯函数）
 * -------------------------------------------------------------
 * 设计目标：让「对话剪辑」不是一段提示词，而是一个可预演、可校验、可回滚的
 * 动作系统。所有 op 先 dry-run 出 diff，再由服务端在事务里应用。
 *
 * 硬约束：
 *   · 只用 clientKey 定位片段（保存会重建 id，id 不可跨保存引用）；
 *   · locked 片段/轨道一律拒绝；
 *   · lane 上限 20；同 lane 同时间不允许重叠（移动冲突时自动选空 lane）；
 *   · 任何一条 op 失败，整批不落库（返回 errors，doc 原样返回）。
 */
import type {
  TimelineClip,
  TimelineDocument,
  TimelineTextStyle,
  TimelineTrackMeta,
} from './api.interface';

export type TimelineTrackKind = 'video' | 'audio' | 'subtitle' | 'overlay';

/** 片段引用：优先 clientKey；也接受 code（V1#3）与历史 id */
export interface ClipRef {
  clientKey?: string;
  id?: string;
  code?: string;
}

export type TimelineOp =
  | { op: 'move'; target: ClipRef; toStart: number; toLane?: number }
  | { op: 'trim'; target: ClipRef; edge: 'left' | 'right'; deltaSec: number }
  | { op: 'split'; target: ClipRef; atSec: number }
  | { op: 'delete'; targets: ClipRef[] }
  | {
      op: 'subtitle';
      target?: ClipRef;
      text?: string;
      atSec?: number;
      durationSec?: number;
      lane?: number;
      style?: Partial<TimelineTextStyle>;
    }
  | { op: 'speed'; target: ClipRef; value: number }
  | { op: 'volume'; target: ClipRef; value: number }
  | { op: 'lock'; target: ClipRef; locked: boolean }
  | {
      op: 'track';
      action: 'create' | 'update';
      track: TimelineTrackKind;
      lane?: number;
      patch?: Partial<
        Pick<TimelineTrackMeta, 'name' | 'muted' | 'solo' | 'locked' | 'role' | 'exportEnabled'>
      >;
    };

export interface TimelineOpDiff {
  opIndex: number;
  op: string;
  target: string;
  before: string;
  after: string;
  note?: string;
}

export interface TimelineOpError {
  opIndex: number;
  message: string;
}

export interface ApplyTimelineOpsResult {
  doc: TimelineDocument;
  diffs: TimelineOpDiff[];
  errors: TimelineOpError[];
  durationDelta: number;
}

export const TIMELINE_OP_NAMES = [
  'move',
  'trim',
  'split',
  'delete',
  'subtitle',
  'speed',
  'volume',
  'lock',
  'track',
] as const;

export const MAX_LANE = 19;
const MIN_SPAN = 0.1;

const EPS = 1e-4;
const round3 = (n: number) => Math.round(n * 1000) / 1000;
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
const num = (v: unknown, fallback = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const newKey = (prefix: string): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? `${prefix}-${crypto.randomUUID()}`
    : `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

export const clipKey = (c: Pick<TimelineClip, 'id' | 'clientKey'>): string =>
  c.clientKey ?? c.id;

export const clipSpan = (c: Pick<TimelineClip, 'inPoint' | 'outPoint' | 'speed'>): number =>
  Math.max(0, (c.outPoint - c.inPoint) / (c.speed > 0 ? c.speed : 1));

/** 同类型轨道内按时间排序后的序号；code 形如 V1#2 / A1#1 / S1#1 */
export function clipCode(doc: TimelineDocument, clip: TimelineClip): string {
  const letter =
    clip.track === 'video' ? 'V' : clip.track === 'audio' ? 'A' : clip.track === 'subtitle' ? 'S' : 'O';
  const lane = clip.lane ?? 0;
  const siblings = doc.clips
    .filter((c) => c.track === clip.track && (c.lane ?? 0) === lane)
    .sort((a, b) => a.timelineStart - b.timelineStart || clipKey(a).localeCompare(clipKey(b)));
  const idx = siblings.findIndex((c) => clipKey(c) === clipKey(clip));
  return `${letter}${lane + 1}#${idx + 1}`;
}

export function resolveClip(doc: TimelineDocument, ref: ClipRef): TimelineClip | null {
  if (ref?.clientKey) {
    const hit = doc.clips.find((c) => clipKey(c) === ref.clientKey);
    if (hit) return hit;
  }
  if (ref?.id) {
    const hit = doc.clips.find((c) => c.id === ref.id || clipKey(c) === ref.id);
    if (hit) return hit;
  }
  if (ref?.code) {
    const m = /^([VAOS])(\d+)#(\d+)$/i.exec(ref.code.trim());
    if (!m) return null;
    const track: TimelineTrackKind =
      m[1].toUpperCase() === 'V'
        ? 'video'
        : m[1].toUpperCase() === 'A'
          ? 'audio'
          : m[1].toUpperCase() === 'S'
            ? 'subtitle'
            : 'overlay';
    const lane = Math.max(0, Number(m[2]) - 1);
    const list = doc.clips
      .filter((c) => c.track === track && (c.lane ?? 0) === lane)
      .sort((a, b) => a.timelineStart - b.timelineStart || clipKey(a).localeCompare(clipKey(b)));
    return list[Math.max(0, Number(m[3]) - 1)] ?? null;
  }
  return null;
}

function overlaps(
  doc: TimelineDocument,
  track: TimelineTrackKind,
  lane: number,
  start: number,
  span: number,
  exclude: Set<string>,
): TimelineClip | null {
  const end = start + span;
  return (
    doc.clips.find((c) => {
      if (c.track !== track) return false;
      if ((c.lane ?? 0) !== lane) return false;
      if (exclude.has(clipKey(c))) return false;
      const s = c.timelineStart;
      const e = s + clipSpan(c);
      return s < end - EPS && start < e - EPS;
    }) ?? null
  );
}

function freeLane(
  doc: TimelineDocument,
  track: TimelineTrackKind,
  preferred: number,
  start: number,
  span: number,
  exclude: Set<string>,
): number {
  for (let lane = preferred; lane <= MAX_LANE; lane += 1) {
    if (!overlaps(doc, track, lane, start, span, exclude)) return lane;
  }
  // 目标轨以下全满：从 0 再找一遍（可能上方有空洞）
  for (let lane = 0; lane < preferred; lane += 1) {
    if (!overlaps(doc, track, lane, start, span, exclude)) return lane;
  }
  return -1;
}

function trackOf(doc: TimelineDocument, track: TimelineTrackKind, lane: number): TimelineTrackMeta | undefined {
  return (doc.tracks ?? []).find((t) => t.track === track && (t.lane ?? 0) === lane);
}

function ensureTrack(doc: TimelineDocument, track: TimelineTrackKind, lane: number): void {
  if (trackOf(doc, track, lane)) return;
  const tracks = doc.tracks ?? [];
  doc.tracks = [
    ...tracks,
    {
      track,
      lane,
      ...(track === 'video' && lane > 0 ? { role: 'alt' as const, exportEnabled: false } : {}),
    },
  ];
}

const fmtSec = (n: number) => `${n.toFixed(3)}s`;
const fmtText = (t: string | null | undefined) => {
  const s = (t ?? '').replace(/\s+/g, ' ').trim();
  return s.length > 18 ? `“${s.slice(0, 18)}…”` : `“${s}”`;
};

/**
 * 应用一批 op。errors 非空时 doc 原样返回（整批拒绝，避免半截状态）。
 * 纯函数：不落库、不发网络请求，可在前端 dry-run 与服务端事务中复用。
 */
export function applyTimelineOps(
  doc: TimelineDocument,
  ops: TimelineOp[],
): ApplyTimelineOpsResult {
  const original = doc;
  const next: TimelineDocument = {
    ...doc,
    clips: doc.clips.map((c) => ({ ...c })),
    tracks: (doc.tracks ?? []).map((t) => ({ ...t })),
  };
  const diffs: TimelineOpDiff[] = [];
  const errors: TimelineOpError[] = [];
  const beforeDuration = timelineDuration(original);

  const fail = (i: number, message: string) => {
    errors.push({ opIndex: i, message });
  };

  if (!Array.isArray(ops) || ops.length === 0) {
    return { doc: original, diffs: [], errors: [{ opIndex: 0, message: '没有可执行的动作' }], durationDelta: 0 };
  }
  if (ops.length > 40) {
    return {
      doc: original,
      diffs: [],
      errors: [{ opIndex: 0, message: `单次动作过多（${ops.length}），请分批执行` }],
      durationDelta: 0,
    };
  }

  ops.forEach((rawOp, i) => {
    const op = rawOp as TimelineOp;
    if (!op || typeof op !== 'object' || !TIMELINE_OP_NAMES.includes(op.op as never)) {
      fail(i, `不支持的动作：${String((op as { op?: string } | null)?.op ?? '空')}`);
      return;
    }
    try {
      switch (op.op) {
        case 'move': {
          const c = resolveClip(next, op.target);
          if (!c) return fail(i, '找不到目标片段（clientKey/code 无效）');
          if (c.locked) return fail(i, '目标片段已锁定');
          if (trackOf(next, c.track, c.lane ?? 0)?.locked) return fail(i, '目标片段所在轨道已锁定');
          const start = Math.max(0, round3(num(op.toStart, c.timelineStart)));
          if (!Number.isFinite(start)) return fail(i, 'toStart 非法');
          const span = clipSpan(c);
          const exclude = new Set([clipKey(c)]);
          const requestedLane =
            op.toLane != null ? clamp(Math.round(num(op.toLane, c.lane ?? 0)), 0, MAX_LANE) : (c.lane ?? 0);
          let lane = requestedLane;
          const conflict = overlaps(next, c.track, lane, start, span, exclude);
          if (conflict) {
            if (op.toLane != null) {
              return fail(i, `目标轨 ${lane + 1} 在该时段已被占用（${clipCode(next, conflict)}）`);
            }
            const found = freeLane(next, c.track, lane, start, span, exclude);
            if (found < 0) return fail(i, `没有空闲轨道可放（最多 ${MAX_LANE + 1} 条）`);
            lane = found;
          }
          ensureTrack(next, c.track, lane);
          const before = `${fmtSec(c.timelineStart)} / ${clipCode(next, c)}`;
          c.timelineStart = start;
          c.lane = lane;
          diffs.push({
            opIndex: i,
            op: 'move',
            target: clipKey(c),
            before,
            after: `${fmtSec(start)} / ${clipCode(next, c)}`,
            note: lane !== requestedLane ? `自动落到 ${lane + 1} 轨避免重叠` : undefined,
          });
          return;
        }
        case 'trim': {
          const c = resolveClip(next, op.target);
          if (!c) return fail(i, '找不到目标片段');
          if (c.locked) return fail(i, '目标片段已锁定');
          const delta = num(op.deltaSec, 0);
          const speed = c.speed > 0 ? c.speed : 1;
          const span = clipSpan(c);
          const before = `${fmtSec(c.timelineStart)}–${fmtSec(c.timelineStart + span)}`;
          if (op.edge === 'left') {
            const d = clamp(delta, -c.inPoint / speed, span - MIN_SPAN);
            const newIn = round3(Math.max(0, c.inPoint + d * speed));
            const newStart = round3(Math.max(0, c.timelineStart + d));
            if ((c.outPoint - newIn) / speed < MIN_SPAN) return fail(i, '修剪后片段过短（<0.1s）');
            c.inPoint = newIn;
            c.timelineStart = newStart;
          } else {
            const d = clamp(delta, MIN_SPAN - span, 3600);
            const newOut = round3(c.outPoint + d * speed);
            if ((newOut - c.inPoint) / speed < MIN_SPAN) return fail(i, '修剪后片段过短（<0.1s）');
            c.outPoint = newOut;
          }
          diffs.push({
            opIndex: i,
            op: 'trim',
            target: clipKey(c),
            before,
            after: `${fmtSec(c.timelineStart)}–${fmtSec(c.timelineStart + clipSpan(c))}`,
          });
          return;
        }
        case 'split': {
          const c = resolveClip(next, op.target);
          if (!c) return fail(i, '找不到目标片段');
          if (c.locked) return fail(i, '目标片段已锁定');
          const at = round3(num(op.atSec, -1));
          const offset = at - c.timelineStart;
          const span = clipSpan(c);
          if (offset <= MIN_SPAN || offset >= span - MIN_SPAN) return fail(i, '分割点太靠近片段边缘');
          const speed = c.speed > 0 ? c.speed : 1;
          const cut = round3(c.inPoint + offset * speed);
          const right: TimelineClip = {
            ...c,
            id: newKey('agent-split'),
            clientKey: newKey('agent-split'),
            inPoint: cut,
            timelineStart: at,
            sortOrder: c.sortOrder + 1,
          };
          c.outPoint = cut;
          next.clips.push(right);
          diffs.push({
            opIndex: i,
            op: 'split',
            target: clipKey(c),
            before: `${fmtSec(c.timelineStart)}–${fmtSec(c.timelineStart + span)}`,
            after: `在 ${fmtSec(at)} 分割为两段`,
          });
          return;
        }
        case 'delete': {
          const targets = Array.isArray(op.targets) ? op.targets : [];
          for (const ref of targets) {
            const c = resolveClip(next, ref);
            if (!c) {
              fail(i, `找不到待删除片段 ${ref?.code ?? ref?.clientKey ?? ''}`);
              continue;
            }
            if (c.locked) {
              fail(i, `片段 ${clipCode(next, c)} 已锁定，不能删除`);
              continue;
            }
            const k = clipKey(c);
            const before = `${clipCode(next, c)} ${fmtSec(c.timelineStart)}`;
            next.clips = next.clips.filter((x) => clipKey(x) !== k);
            diffs.push({ opIndex: i, op: 'delete', target: k, before, after: '已删除' });
          }
          return;
        }
        case 'subtitle': {
          const style = op.style && typeof op.style === 'object' ? op.style : undefined;
          if (op.target) {
            const c = resolveClip(next, op.target);
            if (!c) return fail(i, '找不到目标字幕片段');
            if (c.track !== 'subtitle') return fail(i, '目标片段不是字幕');
            if (c.locked) return fail(i, '字幕已锁定');
            const beforeText = c.text ?? '';
            if (typeof op.text === 'string') {
              if (op.text.length > 200) return fail(i, '字幕超过 200 字');
              c.text = op.text;
            }
            if (style) c.textStyle = { ...(c.textStyle ?? {}), ...style };
            diffs.push({
              opIndex: i,
              op: 'subtitle',
              target: clipKey(c),
              before: fmtText(beforeText),
              after: fmtText(c.text),
            });
            return;
          }
          const text = typeof op.text === 'string' ? op.text.trim() : '';
          if (!text) return fail(i, '新增字幕必须给 text');
          if (text.length > 200) return fail(i, '字幕超过 200 字');
          const at = Math.max(0, round3(num(op.atSec, 0)));
          const duration = clamp(num(op.durationSec, 3), MIN_SPAN, 30);
          const lane = clamp(Math.round(num(op.lane, 0)), 0, MAX_LANE);
          const trackLocked = trackOf(next, 'subtitle', lane)?.locked;
          if (trackLocked) return fail(i, `S${lane + 1} 轨道已锁定`);
          const key = newKey('agent-sub');
          const clip: TimelineClip = {
            id: key,
            clientKey: key,
            projectId: next.projectId,
            track: 'subtitle',
            sourceShotId: null,
            sourceUrl: null,
            inPoint: 0,
            outPoint: duration,
            timelineStart: at,
            lane,
            speed: 1,
            volume: 1,
            transition: { type: 'none', duration: 0 },
            text,
            textStyle: style ?? null,
            locked: false,
            sortOrder: next.clips.length,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
          ensureTrack(next, 'subtitle', lane);
          next.clips.push(clip);
          diffs.push({
            opIndex: i,
            op: 'subtitle',
            target: key,
            before: '（无）',
            after: `${fmtSec(at)}–${fmtSec(at + duration)} ${fmtText(text)}`,
          });
          return;
        }
        case 'speed': {
          const c = resolveClip(next, op.target);
          if (!c) return fail(i, '找不到目标片段');
          if (c.locked) return fail(i, '目标片段已锁定');
          const value = clamp(num(op.value, 1), 0.25, 4);
          if (Math.abs(value - c.speed) < 1e-3) return fail(i, '速度未变化');
          const before = `${c.speed}×`;
          c.speed = round3(value);
          diffs.push({ opIndex: i, op: 'speed', target: clipKey(c), before, after: `${c.speed}×` });
          return;
        }
        case 'volume': {
          const c = resolveClip(next, op.target);
          if (!c) return fail(i, '找不到目标片段');
          if (c.locked) return fail(i, '目标片段已锁定');
          const value = clamp(num(op.value, 1), 0, 1);
          const before = `${Math.round(c.volume * 100)}%`;
          c.volume = round3(value);
          diffs.push({ opIndex: i, op: 'volume', target: clipKey(c), before, after: `${Math.round(value * 100)}%` });
          return;
        }
        case 'lock': {
          const c = resolveClip(next, op.target);
          if (!c) return fail(i, '找不到目标片段');
          const before = c.locked ? '已锁定' : '未锁定';
          c.locked = Boolean(op.locked);
          diffs.push({ opIndex: i, op: 'lock', target: clipKey(c), before, after: c.locked ? '已锁定' : '未锁定' });
          return;
        }
        case 'track': {
          const track = op.track;
          if (!['video', 'audio', 'subtitle', 'overlay'].includes(track)) {
            return fail(i, `未知轨道类型 ${String(track)}`);
          }
          if (op.action === 'create') {
            const used = [...next.clips.filter((c) => c.track === track).map((c) => c.lane ?? 0),
              ...(next.tracks ?? []).filter((t) => t.track === track).map((t) => t.lane ?? 0)];
            const lane = Math.max(-1, ...used) + 1;
            if (lane > MAX_LANE) return fail(i, `轨道已达上限（${MAX_LANE + 1} 条）`);
            ensureTrack(next, track, lane);
            const meta = trackOf(next, track, lane);
            if (meta && op.patch) Object.assign(meta, op.patch);
            diffs.push({
              opIndex: i,
              op: 'track',
              target: `${track}:${lane}`,
              before: '（无）',
              after: `新建 ${track === 'video' ? 'V' : track === 'audio' ? 'A' : track === 'subtitle' ? 'S' : 'O'}${lane + 1}`,
            });
            return;
          }
          const lane = op.lane != null ? clamp(Math.round(num(op.lane, 0)), 0, MAX_LANE) : 0;
          const meta = trackOf(next, track, lane);
          if (!meta) return fail(i, `轨道 ${track}:${lane} 不存在`);
          if (op.patch?.locked === false && meta.locked) {
            // 允许显式解锁
          }
          const before = `name=${meta.name ?? '默认'} muted=${Boolean(meta.muted)} locked=${Boolean(meta.locked)}`;
          Object.assign(meta, op.patch ?? {});
          diffs.push({
            opIndex: i,
            op: 'track',
            target: `${track}:${lane}`,
            before,
            after: `name=${meta.name ?? '默认'} muted=${Boolean(meta.muted)} locked=${Boolean(meta.locked)}`,
          });
          return;
        }
        default:
          fail(i, '未知动作');
      }
    } catch (err) {
      fail(i, (err as Error)?.message ?? '动作执行失败');
    }
  });

  if (errors.length > 0) {
    return { doc: original, diffs: [], errors, durationDelta: 0 };
  }
  next.updatedAt = new Date().toISOString();
  return {
    doc: next,
    diffs,
    errors: [],
    durationDelta: round3(timelineDuration(next) - beforeDuration),
  };
}

/** 时间线总时长（所有轨道的最大出点） */
export function timelineDuration(doc: TimelineDocument | null): number {
  if (!doc || doc.clips.length === 0) return 0;
  return round3(
    Math.max(...doc.clips.map((c) => c.timelineStart + clipSpan(c)), 0),
  );
}

/** 给 Agent 的紧凑 EDL 文本（服务端注入；不含 id，只给 clientKey 与人读引用） */
export function describeTimelineForAgent(doc: TimelineDocument, maxClips = 40): string {
  const tracks = (doc.tracks ?? []).map((t) => {
    const letter =
      t.track === 'video' ? 'V' : t.track === 'audio' ? 'A' : t.track === 'subtitle' ? 'S' : 'O';
    const flags = [
      t.locked ? '已锁定' : '',
      t.muted ? '静音' : '',
      t.solo ? '独奏' : '',
      t.role === 'alt' ? '备选不参与成片' : '',
    ].filter(Boolean);
    return `${letter}${(t.lane ?? 0) + 1}${flags.length ? `(${flags.join('，')})` : ''}`;
  });
  const clips = [...doc.clips]
    .sort((a, b) => a.timelineStart - b.timelineStart)
    .slice(0, maxClips)
    .map((c) => {
      const parts = [
        `key=${clipKey(c)}`,
        clipCode(doc, c),
        c.sourceShotId ? `shot=${c.sourceShotId}` : '外部素材',
        `${c.timelineStart.toFixed(3)}–${(c.timelineStart + clipSpan(c)).toFixed(3)}s`,
        c.track === 'subtitle' ? `文本=${fmtText(c.text)}` : '',
        c.locked ? '锁定' : '',
      ].filter(Boolean);
      return `- ${parts.join(' | ')}`;
    });
  return [
    `# 时间线（版本 v${doc.version ?? 0}，${doc.width}x${doc.height} @${doc.fps}fps，总长 ${timelineDuration(doc)}s）`,
    tracks.length ? `轨道：${tracks.join('，')}` : '轨道：V1（默认）',
    `片段（最多展示 ${maxClips} 条，按时间排序）：`,
    ...(clips.length ? clips : ['- （空）']),
  ].join('\n');
}
