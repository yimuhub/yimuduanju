/**
 * Studio · 多轨 EDL 编辑 Hook
 * -------------------------------------------------------------
 * 时间线唯一真源 = GET /timeline 的 EDL（timeline_clips），不再从 shots 现场拼装。
 * 所有操作（移动 / 修剪 / 删除 / 分割 / 字幕 / 加音轨）都走 commit()：
 *   1. 乐观更新 data.timeline（StudioData 持有时序）
 *   2. 400ms 防抖 PUT /timeline（整体替换，事务写入）
 *   3. 撤销 / 重做用 EDL 快照栈，不触碰生产镜头
 *
 * 片段 id 只在本地有效；落库时服务端重新生成 UUID，因此保存请求不带 id。
 * 音频 lane 约定：0 对白 / 1 配乐 / 2 音效，同 lane 与跨 lane 都允许重叠。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { SaveTimelineRequest, TimelineClip, TimelineDocument } from '@shared/api.interface';
import { saveTimeline } from '@client/src/api/timeline';
import { useStudio } from './StudioShell';
import { clipSpan } from './model';

const MIN_SPAN = 0.1;
const round3 = (n: number) => Math.round(n * 1000) / 1000;
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

let localSeq = 0;
const localId = (prefix: string) =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? `${prefix}-${crypto.randomUUID()}`
    : `${prefix}-${Date.now()}-${(localSeq += 1)}`;

interface HistoryEntry {
  label: string;
  before: TimelineClip[];
  after: TimelineClip[];
}

const toSaveClip = (c: TimelineClip): SaveTimelineRequest['clips'][number] => ({
  track: c.track,
  sourceShotId: c.sourceShotId ?? null,
  sourceUrl: c.sourceUrl ?? null,
  inPoint: c.inPoint,
  outPoint: c.outPoint,
  timelineStart: c.timelineStart,
  lane: c.lane ?? 0,
  speed: c.speed,
  volume: c.volume,
  transition: c.transition ?? null,
  text: c.text ?? null,
  locked: c.locked,
  sortOrder: c.sortOrder,
});

export interface EdlEditor {
  ready: boolean;
  saving: boolean;
  dirty: boolean;
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
  /** 横向移动片段（秒）；lane 传值时可同时换到同类型轨道的另一层 */
  moveClip: (id: string, timelineStart: number, lane?: number) => void;
  /** 边缘修剪：left 同时推进 inPoint 与 timelineStart，right 只改 outPoint */
  trimClip: (id: string, edge: 'left' | 'right', deltaSec: number) => void;
  removeClip: (id: string) => void;
  /** 在 at 秒把片段一分为二（同源素材，按入出点取段） */
  splitClip: (id: string, at: number) => string | null;
  /** 在播放头位置分割（未指定 id 时取覆盖播放头的视频/音频片段） */
  splitAtPlayhead: (at: number, id?: string) => string | null;
  editSubtitle: (id: string, text: string) => void;
  /** 在 at 秒新增字幕片段，返回新片段 id */
  addSubtitle: (at: number, lane?: number, text?: string) => string | null;
  /** 在 at 秒新增音频片段，返回新片段 id */
  addAudio: (
    asset: { name: string; url: string; durationSeconds?: number },
    at: number,
    lane?: number,
  ) => string | null;
  /** 视频轨按当前时间顺序重新首尾相接 */
  packVideo: () => void;
  /** 立即落库（导出前调用） */
  saveNow: () => Promise<boolean>;
}

export function useEdlEditor(): EdlEditor {
  const { data } = useStudio();
  const doc = data.timeline;
  const clips = useMemo(() => doc?.clips ?? [], [doc]);

  const clipsRef = useRef(clips);
  clipsRef.current = clips;
  const docRef = useRef<TimelineDocument | null>(doc);
  docRef.current = doc;
  const projectId = data.projectId;

  const undoStack = useRef<HistoryEntry[]>([]);
  const redoStack = useRef<HistoryEntry[]>([]);
  const [histVer, setHistVer] = useState(0);
  void histVer;

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const applyDoc = useCallback(
    (nextClips: TimelineClip[], base?: TimelineDocument | null) => {
      const source = base ?? docRef.current;
      if (!source) return;
      const nextDoc: TimelineDocument = {
        ...source,
        clips: nextClips,
        updatedAt: new Date().toISOString(),
      };
      docRef.current = nextDoc;
      data.commitTimeline(nextDoc);
    },
    [data],
  );

  const flush = useCallback(async (): Promise<boolean> => {
    if (!pendingRef.current || !projectId) return true;
    const target = docRef.current;
    if (!target) return true;
    pendingRef.current = false;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setSaving(true);
    try {
      await saveTimeline(projectId, {
        fps: target.fps,
        width: target.width,
        height: target.height,
        clips: target.clips.map(toSaveClip),
      });
      if (!pendingRef.current) setDirty(false);
      return true;
    } catch (err) {
      pendingRef.current = true;
      setDirty(true);
      const msg =
        (err as { response?: { data?: { message?: string | string[] } } })?.response?.data
          ?.message ?? (err as Error)?.message;
      toast.error('时间线保存失败', {
        description: Array.isArray(msg) ? msg.join('；') : String(msg ?? '网络错误'),
      });
      return false;
    } finally {
      setSaving(false);
    }
  }, [projectId]);

  const schedule = useCallback(() => {
    pendingRef.current = true;
    setDirty(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      void flush();
    }, 400);
  }, [flush]);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  const commit = useCallback(
    (next: TimelineClip[], label: string, before: TimelineClip[]) => {
      if (!docRef.current) return;
      applyDoc(next);
      undoStack.current.push({ label, before, after: next });
      if (undoStack.current.length > 80) undoStack.current.shift();
      redoStack.current = [];
      setHistVer((v) => v + 1);
      schedule();
    },
    [applyDoc, schedule],
  );

  const travel = useCallback(
    (direction: 'undo' | 'redo') => {
      const from = direction === 'undo' ? undoStack.current : redoStack.current;
      const entry = from[from.length - 1];
      if (!entry || !docRef.current) return;
      const target = direction === 'undo' ? entry.before : entry.after;
      applyDoc(target);
      from.pop();
      (direction === 'undo' ? redoStack.current : undoStack.current).push(entry);
      setHistVer((v) => v + 1);
      schedule();
      if (direction === 'undo') {
        toast.success(`已撤销：${entry.label}`, { duration: 1400 });
      } else {
        toast.success(`已重做：${entry.label}`, { duration: 1400 });
      }
    },
    [applyDoc, schedule],
  );

  const moveClip = useCallback(
    (id: string, timelineStart: number, lane?: number) => {
      const before = clipsRef.current;
      const src = before.find((c) => c.id === id);
      if (!src || src.locked) return;
      const nextStart = round3(Math.max(0, timelineStart));
      const nextLane = lane != null && lane >= 0 ? Math.round(lane) : (src.lane ?? 0);
      if (Math.abs(nextStart - src.timelineStart) < 0.005 && nextLane === (src.lane ?? 0)) return;
      const next = before.map((c) =>
        c.id === id ? { ...c, timelineStart: nextStart, lane: nextLane } : c,
      );
      commit(next, nextLane === (src.lane ?? 0) ? '移动片段' : '移动到其它轨', before);
    },
    [commit],
  );

  const trimClip = useCallback(
    (id: string, edge: 'left' | 'right', deltaSec: number) => {
      const before = clipsRef.current;
      const src = before.find((c) => c.id === id);
      if (!src || src.locked || !Number.isFinite(deltaSec) || Math.abs(deltaSec) < 0.001) return;
      const speed = src.speed > 0 ? src.speed : 1;
      const span = clipSpan(src);
      let nextClip: TimelineClip;
      if (edge === 'left') {
        const d = clamp(deltaSec, -src.inPoint / speed, span - MIN_SPAN);
        const newIn = round3(src.inPoint + d * speed);
        const newStart = round3(Math.max(0, src.timelineStart + d));
        nextClip = { ...src, inPoint: newIn, timelineStart: newStart };
        if (span - d < MIN_SPAN) return;
      } else {
        const newOut = round3(src.outPoint + deltaSec * speed);
        if ((newOut - src.inPoint) / speed < MIN_SPAN) return;
        nextClip = { ...src, outPoint: newOut };
      }
      const next = before.map((c) => (c.id === id ? nextClip : c));
      commit(next, '修剪片段', before);
    },
    [commit],
  );

  const removeClip = useCallback(
    (id: string) => {
      const before = clipsRef.current;
      if (!before.some((c) => c.id === id)) return;
      const next = before.filter((c) => c.id !== id);
      commit(next, '删除片段', before);
    },
    [commit],
  );

  const splitClip = useCallback(
    (id: string, at: number): string | null => {
      const before = clipsRef.current;
      const src = before.find((c) => c.id === id);
      if (!src || src.locked) return null;
      const span = clipSpan(src);
      const offset = at - src.timelineStart;
      if (offset <= 0.05 || offset >= span - 0.05) return null;
      const speed = src.speed > 0 ? src.speed : 1;
      const cut = round3(src.inPoint + offset * speed);
      const idx = before.findIndex((c) => c.id === id);
      const left: TimelineClip = { ...src, outPoint: cut };
      const right: TimelineClip = {
        ...src,
        id: localId('local-split'),
        inPoint: cut,
        timelineStart: round3(at),
      };
      const next = [...before.slice(0, idx), left, right, ...before.slice(idx + 1)];
      commit(next, '分割片段', before);
      return right.id;
    },
    [commit],
  );

  const splitAtPlayhead = useCallback(
    (at: number, id?: string): string | null => {
      const before = clipsRef.current;
      const target =
        (id ? before.find((c) => c.id === id) : undefined) ??
        before.find(
          (c) =>
            c.track !== 'subtitle' &&
            at > c.timelineStart + 0.05 &&
            at < c.timelineStart + clipSpan(c) - 0.05,
        );
      if (!target) {
        toast.info('请把播放头移到画面或音频片段内部再分割');
        return null;
      }
      const created = splitClip(target.id, at);
      if (!created) toast.info('分割点太靠近片段边缘');
      return created;
    },
    [splitClip],
  );

  const editSubtitle = useCallback(
    (id: string, text: string) => {
      const before = clipsRef.current;
      const src = before.find((c) => c.id === id);
      if (!src || src.track !== 'subtitle' || (src.text ?? '') === text) return;
      const next = before.map((c) => (c.id === id ? { ...c, text } : c));
      commit(next, '编辑字幕', before);
    },
    [commit],
  );

  const addSubtitle = useCallback(
    (at: number, lane = 0, text = '新字幕'): string | null => {
      const before = clipsRef.current;
      if (!docRef.current) return null;
      const duration = 3;
      const clip: TimelineClip = {
        id: localId('local-sub'),
        projectId: projectId ?? '',
        track: 'subtitle',
        sourceShotId: null,
        sourceUrl: null,
        inPoint: 0,
        outPoint: duration,
        timelineStart: round3(Math.max(0, at)),
        lane,
        speed: 1,
        volume: 1,
        transition: { type: 'none', duration: 0 },
        text,
        locked: false,
        sortOrder: before.length,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      commit([...before, clip], '新增字幕', before);
      return clip.id;
    },
    [commit, projectId],
  );

  const addAudio = useCallback(
    (
      asset: { name: string; url: string; durationSeconds?: number },
      at: number,
      lane = 1,
    ): string | null => {
      const before = clipsRef.current;
      if (!docRef.current) return null;
      const duration = asset.durationSeconds && asset.durationSeconds > 0 ? asset.durationSeconds : 10;
      const clip: TimelineClip = {
        id: localId('local-audio'),
        projectId: projectId ?? '',
        track: 'audio',
        sourceShotId: null,
        sourceUrl: asset.url,
        inPoint: 0,
        outPoint: round3(duration),
        timelineStart: round3(Math.max(0, at)),
        lane,
        speed: 1,
        volume: 1,
        transition: { type: 'none', duration: 0 },
        // 音频片段用 text 存显示名（字幕逻辑只读 track=subtitle，不冲突）
        text: asset.name.slice(0, 120),
        locked: false,
        sortOrder: before.length,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      commit([...before, clip], '新增音频', before);
      return clip.id;
    },
    [commit, projectId],
  );

  const packVideo = useCallback(() => {
    const before = clipsRef.current;
    const videos = before
      .filter((c) => c.track === 'video')
      .sort((a, b) => a.timelineStart - b.timelineStart || a.sortOrder - b.sortOrder);
    if (videos.length === 0) return;
    const starts = new Map<string, number>();
    let cursor = 0;
    for (const v of videos) {
      starts.set(v.id, round3(cursor));
      cursor += clipSpan(v);
    }
    const next = before.map((c) =>
      c.track === 'video' ? { ...c, timelineStart: starts.get(c.id) ?? c.timelineStart } : c,
    );
    commit(next, '画面轨排齐', before);
  }, [commit]);

  return {
    ready: Boolean(doc),
    saving,
    dirty,
    canUndo: undoStack.current.length > 0,
    canRedo: redoStack.current.length > 0,
    undo: () => travel('undo'),
    redo: () => travel('redo'),
    moveClip,
    trimClip,
    removeClip,
    splitClip,
    splitAtPlayhead,
    editSubtitle,
    addSubtitle,
    addAudio,
    packVideo,
    saveNow: flush,
  };
}
