/**
 * Studio · 多轨 EDL 编辑 Hook（生产级）
 * -------------------------------------------------------------
 * 时间线唯一真源 = GET /timeline 的 EDL（timeline_clips）。
 * 所有编辑走 commit()：
 *   1. 乐观更新 docRef + data.timeline，界面立即响应；
 *   2. 400ms 防抖 PUT /timeline（整体替换 + 事务写入 + 乐观锁）；
 *   3. 撤销/重做用 EDL 快照栈，并持久化到 IndexedDB（刷新仍可撤销）。
 *
 * 生产级约束：
 *   · 所有时间编辑按项目 fps 落帧，与时间码显示一致；
 *   · 波纹删除 / 变速会把同轨后续片段整体前移，保持首尾相接；
 *   · 保存携带 expectedVersion，冲突返回 409 时不覆盖，交给用户重新载入；
 *   · 轨道静音/独奏/锁定/重命名随 EDL 一起保存，导出按规则过滤。
 *
 * 片段 id 只在本地有效；落库时服务端重新生成 UUID，因此保存请求不带 id。
 * 音频 lane 约定：0 对白 / 1 配乐 / 2 音效。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import type {
  SaveTimelineRequest,
  TimelineClip,
  TimelineDocument,
  TimelineTextStyle,
  TimelineTrackMeta,
} from '@shared/api.interface';
import { applyTimelineAgentOps, getTimeline, saveTimeline } from '@client/src/api/timeline';
import type { StudioData } from './useStudioData';
import {
  applyTimelineOps,
  clipKey,
  type TimelineOp,
  type TimelineOpDiff,
} from '@shared/timeline-ops';
import { clipSpan, sameOrigin } from './model';
import {
  clamp,
  clampBoundMove,
  quantizeToFrame,
  ROW_HEIGHT_DEFAULT,
  round3,
} from '@client/src/lib/timeline-frame';
import { pickFreeLane } from '@client/src/lib/timeline-drop';
import {
  HISTORY_LIMIT,
  loadHistory,
  saveHistory,
  type HistoryEntry,
} from '@client/src/lib/timeline-history';

const MIN_SPAN = 0.1;

let localSeq = 0;
const localId = (prefix: string) =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? `${prefix}-${crypto.randomUUID()}`
    : `${prefix}-${Date.now()}-${(localSeq += 1)}`;

/** 新片段同时生成 id 与 clientKey：保存后 id 会变，clientKey 不变 */
const newClipIdentity = (prefix: string): { id: string; clientKey: string } => {
  const key = localId(prefix);
  return { id: key, clientKey: key };
};

/** 保存后服务端重建 id：按 clientKey 把选中态映射到新 id，避免属性条「自己消失」 */
const remapIds = (ids: string[], from: TimelineClip[], to: TimelineClip[]): string[] => {
  const keyOfOld = new Map(from.map((c) => [c.id, clipKey(c)]));
  const idOfNew = new Map(to.map((c) => [clipKey(c), c.id]));
  return ids
    .map((id) => {
      const key = keyOfOld.get(id);
      return key ? (idOfNew.get(key) ?? id) : id;
    })
    .filter((id, i, arr) => Boolean(id) && arr.indexOf(id) === i);
};

const toSaveClip = (c: TimelineClip): SaveTimelineRequest['clips'][number] => ({
  // 稳定业务标识：服务端重建 id 后，前后端仍能指向同一片段
  clientKey: c.clientKey ?? c.id,
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
  // 绑定组与字幕样式必须一起落库，否则一保存就「解绑」、样式回默认
  bindGroup: c.bindGroup ?? null,
  textStyle: c.textStyle ?? null,
  locked: c.locked,
  enabled: c.enabled !== false,
  sortOrder: c.sortOrder,
});

const markerKey = (projectId: string) => `yimu.timeline.markers.${projectId}`;

const readMarkers = (projectId: string | undefined): number[] => {
  if (!projectId) return [];
  try {
    const raw = localStorage.getItem(markerKey(projectId));
    const arr = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(arr)
      ? arr.filter((n): n is number => typeof n === 'number' && Number.isFinite(n)).sort((a, b) => a - b)
      : [];
  } catch {
    return [];
  }
};

export interface EdlEditor {
  ready: boolean;
  saving: boolean;
  dirty: boolean;
  /** 与服务器版本冲突（409）：需用户确认后重新载入 */
  conflict: boolean;
  version: number;
  fps: number;
  /** 轨道元信息（名称/静音/独奏/锁定/行高） */
  tracks: TimelineTrackMeta[];
  markers: number[];
  /** 当前多选片段 id */
  selectedIds: string[];

  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;

  setSelection: (ids: string[]) => void;
  toggleSelection: (id: string, additive: boolean) => void;

  /** 横向移动片段（秒）；lane 传值时可同时换到同类型轨道的另一层 */
  moveClip: (id: string, timelineStart: number, lane?: number) => void;
  /** 跨轨拖拽落库：移动 + 必要时建轨，clips/tracks 一次提交，可一次撤销 */
  moveClipToLane: (id: string, timelineStart: number, lane: number, createTrack: boolean) => void;
  /** 多选编组横向移动（秒） */
  moveClips: (ids: string[], deltaSec: number) => void;
  /** 边缘修剪：left 同时推进 inPoint 与 timelineStart，right 只改 outPoint */
  trimClip: (id: string, edge: 'left' | 'right', deltaSec: number) => void;
  /** 普通删除（保留空隙） */
  removeClip: (id: string) => void;
  /** 波纹删除：删除后同轨后续片段自动前移，闭合空隙 */
  rippleDelete: (ids: string[]) => void;
  splitClip: (id: string, at: number) => string | null;
  splitAtPlayhead: (at: number, id?: string) => string | null;
  editSubtitle: (id: string, text: string) => void;
  addSubtitle: (at: number, lane?: number, text?: string) => string | null;
  addAudio: (
    asset: { name: string; url: string; durationSeconds?: number },
    at: number,
    lane?: number,
  ) => string | null;
  /** 落一个新画面片段（拖素材/镜头进时间线用）：落点已被占时由调用方先算好 lane */
  addVideo: (
    asset: {
      name: string;
      url: string;
      durationSeconds?: number;
      shotId?: string | null;
    },
    at: number,
    lane?: number,
  ) => string | null;
  /**
   * 音画分离：把画面片段自带的声音抽成同轨位置的独立音频片段，画面本身静音。
   * 返回新音频片段 id；已经在分离状态/没有源媒体时返回 null。
   */
  detachAudio: (id: string) => string | null;
  /** 音画合并：删掉分离出去的那条音频，画面恢复原声。返回被删的音频片段数 */
  attachAudio: (id: string) => number;
  packVideo: () => void;

  /** 变速：同轨后续片段随长度变化整体平移 */
  setClipSpeed: (id: string, speed: number) => void;
  setClipVolume: (id: string, volume: number) => void;
  setClipTransition: (id: string, transition: TimelineClip['transition']) => void;
  setClipLocked: (id: string, locked: boolean) => void;
  /** 启用/停用片段（剪映 V）：保留在时间线，但预览与导出跳过 */
  setClipEnabled: (id: string, enabled: boolean) => void;

  /** 绑定：把选中片段绑成一组，此后拖动任一片段整组一起走 */
  bindSelection: () => void;
  /** 解绑：清空选中片段的绑定组 */
  unbindSelection: () => void;
  /** 字幕样式：只写用户改过的键 */
  updateTextStyle: (id: string, patch: Partial<TimelineTextStyle>) => void;
  /** 字幕文本 */
  setClipText: (id: string, text: string) => void;

  /** 新建同类型轨道（返回新 lane，失败返回 null） */
  addTrack: (track: TimelineTrackMeta['track']) => number | null;
  /** 删除空轨道（该 lane 上还有片段则拒绝并返回原因） */
  removeTrack: (track: TimelineTrackMeta['track'], lane: number) => string | null;

  /** 轨道属性：重命名 / 静音 / 独奏 / 锁定 / 行高 */
  updateTrack: (
    track: TimelineTrackMeta['track'],
    lane: number,
    patch: Partial<TimelineTrackMeta>,
  ) => void;

  addMarker: (at: number) => void;
  removeMarker: (at: number) => void;

  copySelection: (ids: string[]) => void;
  cutSelection: (ids: string[]) => void;
  pasteAt: (at: number) => string[];

  /** 立即落库（导出前调用） */
  saveNow: () => Promise<boolean>;

  /**
   * 对话驱动的剪辑：先干跑校验，再交给服务端事务应用，入撤销栈。
   * 以当前编辑器版本为准，片段靠 clientKey 解析（提案过期也能安全应用）。
   */
  applyAgentOps: (
    ops: TimelineOp[],
    summary: string,
  ) => Promise<{ doc: TimelineDocument; diffs: TimelineOpDiff[]; auditId: string }>;

  /** 只干跑：卡片在应用前展示 diff / 错误，不落库 */
  previewAgentOps: (ops: TimelineOp[]) => {
    diffs: TimelineOpDiff[];
    errors: { opIndex: number; message: string }[];
    durationDelta: number;
  };

  /** 冲突后强制重新载入服务器版本（清空本地撤销栈） */
  reloadAfterConflict: () => Promise<void>;
}

export function useEdlEditor(data: StudioData): EdlEditor {
  const doc = data.timeline;
  const clips = useMemo(() => doc?.clips ?? [], [doc]);
  const fps = doc?.fps && doc.fps > 0 ? doc.fps : 24;

  const clipsRef = useRef(clips);
  clipsRef.current = clips;
  const docRef = useRef(doc);
  docRef.current = doc;
  const fpsRef = useRef(fps);
  fpsRef.current = fps;
  const projectId = data.projectId;

  const undoStack = useRef<HistoryEntry[]>([]);
  const redoStack = useRef<HistoryEntry[]>([]);
  const [histVer, setHistVer] = useState(0);
  void histVer;

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [markers, setMarkers] = useState<number[]>(() => readMarkers(projectId));
  const [conflict, setConflict] = useState(false);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const persistHistory = useCallback(() => {
    if (!projectId) return;
    if (persistTimer.current) clearTimeout(persistTimer.current);
    persistTimer.current = setTimeout(() => {
      persistTimer.current = null;
      void saveHistory(projectId, {
        undo: undoStack.current,
        redo: redoStack.current,
      });
    }, 400);
  }, [projectId]);

  // 切项目：恢复该项目历史与标记点
  useEffect(() => {
    setMarkers(readMarkers(projectId));
    setSelectedIds([]);
    setConflict(false);
    undoStack.current = [];
    redoStack.current = [];
    setHistVer((v) => v + 1);
    if (!projectId) return undefined;
    let alive = true;
    void loadHistory(projectId).then((snap) => {
      if (!alive || !snap) return;
      undoStack.current = snap.undo ?? [];
      redoStack.current = snap.redo ?? [];
      setHistVer((v) => v + 1);
    });
    return () => {
      alive = false;
    };
  }, [projectId]);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (persistTimer.current) clearTimeout(persistTimer.current);
    },
    [],
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
      const saved = await saveTimeline(projectId, {
        fps: target.fps,
        width: target.width,
        height: target.height,
        clips: target.clips.map(toSaveClip),
        tracks: target.tracks,
        expectedVersion: target.version ?? 0,
      });
      if (pendingRef.current) {
        // 保存期间又改了：只同步版本号，保留本地 clips，稍后自动再存
        docRef.current = { ...(docRef.current ?? target), version: saved.version };
        setConflict(false);
        return true;
      }
      docRef.current = { ...saved };
      data.commitTimeline(saved);
      setSelectedIds((prev) => remapIds(prev, target.clips, saved.clips));
      setDirty(false);
      setConflict(false);
      return true;
    } catch (err) {
      pendingRef.current = true;
      setDirty(true);
      const status = (err as { response?: { status?: number } })?.response?.status;
      const msg =
        (err as { response?: { data?: { message?: string | string[] } } })?.response?.data
          ?.message ?? (err as Error)?.message;
      if (status === 409) {
        setConflict(true);
        toast.error('时间线已在别处更新', {
          description: '点「重新载入」获取最新版本，避免覆盖其他窗口的修改',
          duration: 6000,
        });
        return false;
      }
      toast.error('时间线保存失败', {
        description: Array.isArray(msg) ? msg.join('；') : String(msg ?? '网络错误'),
      });
      return false;
    } finally {
      setSaving(false);
    }
  }, [projectId, data]);

  const schedule = useCallback(() => {
    pendingRef.current = true;
    setDirty(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      void flush();
    }, 400);
  }, [flush]);

  /** 写入新 clips（可同时写 tracks）+ 入撤销栈 + 触发保存 */
  const commit = useCallback(
    (
      next: TimelineClip[],
      label: string,
      before: TimelineClip[],
      tracks?: { next: TimelineTrackMeta[]; before: TimelineTrackMeta[] },
    ) => {
      if (!docRef.current) return;
      const nextDoc = {
        ...docRef.current,
        clips: next,
        ...(tracks ? { tracks: tracks.next } : {}),
        updatedAt: new Date().toISOString(),
      };
      docRef.current = nextDoc;
      data.commitTimeline(nextDoc);
      undoStack.current.push({
        label,
        before,
        after: next,
        ...(tracks
          ? { tracksBefore: tracks.before, tracksAfter: tracks.next }
          : {}),
      });
      if (undoStack.current.length > HISTORY_LIMIT) undoStack.current.shift();
      redoStack.current = [];
      setHistVer((v) => v + 1);
      persistHistory();
      schedule();
    },
    [data, schedule, persistHistory],
  );

  const travel = useCallback(
    (direction: 'undo' | 'redo') => {
      const from = direction === 'undo' ? undoStack.current : redoStack.current;
      const entry = from[from.length - 1];
      if (!entry || !docRef.current) return;
      const target = direction === 'undo' ? entry.before : entry.after;
      const targetTracks =
        direction === 'undo' ? entry.tracksBefore : entry.tracksAfter;
      const nextDoc = {
        ...docRef.current,
        clips: target,
        ...(targetTracks ? { tracks: targetTracks } : {}),
        updatedAt: new Date().toISOString(),
      };
      docRef.current = nextDoc;
      data.commitTimeline(nextDoc);
      from.pop();
      (direction === 'undo' ? redoStack.current : undoStack.current).push(entry);
      setHistVer((v) => v + 1);
      persistHistory();
      schedule();
      toast.success(`${direction === 'undo' ? '已撤销' : '已重做'}：${entry.label}`, {
        duration: 1400,
      });
    },
    [data, schedule, persistHistory],
  );

  /**
   * 对话剪辑落地：本地先干跑（错误立刻可见）→ 服务端事务应用 → 入撤销栈。
   * 版本以当前编辑器为准：提案只是「意图」，片段靠 clientKey 解析，
   * 用户在提案后又手动改过也能安全应用。
   */
  const applyAgentOps = useCallback(
    async (
      ops: TimelineOp[],
      summary: string,
    ): Promise<{ doc: TimelineDocument; diffs: TimelineOpDiff[]; auditId: string }> => {
      if (!projectId) throw new Error('当前没有绑定项目');
      if (!docRef.current) throw new Error('时间线尚未就绪');
      const dry = applyTimelineOps(docRef.current, ops);
      if (dry.errors.length > 0) {
        throw new Error(dry.errors.map((e) => `#${e.opIndex + 1} ${e.message}`).join('；'));
      }
      if (pendingRef.current) {
        const ok = await flush();
        if (!ok) throw new Error('本地还有未保存的修改或版本冲突，请先处理后再应用');
      }
      if (!docRef.current) throw new Error('时间线尚未就绪');
      const baseVersion = docRef.current.version ?? 0;
      const tracksBefore = docRef.current.tracks ?? [];
      const before = clipsRef.current;
      const res = await applyTimelineAgentOps(projectId, {
        baseVersion,
        ops,
        summary,
        idempotencyKey: `agent-${localId('op')}`,
      });
      const nextDoc = { ...res.doc };
      docRef.current = nextDoc;
      data.commitTimeline(nextDoc);
      undoStack.current.push({
        label: `Agent 剪辑：${summary || '应用动作'}`,
        before,
        after: nextDoc.clips,
        tracksBefore,
        tracksAfter: nextDoc.tracks ?? [],
      });
      if (undoStack.current.length > HISTORY_LIMIT) undoStack.current.shift();
      redoStack.current = [];
      setHistVer((v) => v + 1);
      persistHistory();
      setSelectedIds((prev) => remapIds(prev, before, nextDoc.clips));
      setDirty(false);
      setConflict(false);
      return res;
    },
    [projectId, flush, data, persistHistory],
  );

  const previewAgentOps = useCallback((ops: TimelineOp[]) => {
    if (!docRef.current) {
      return { diffs: [], errors: [{ opIndex: 0, message: '时间线尚未就绪' }], durationDelta: 0 };
    }
    const dry = applyTimelineOps(docRef.current, ops);
    return { diffs: dry.diffs, errors: dry.errors, durationDelta: dry.durationDelta };
  }, []);

  const setSelection = useCallback((ids: string[]) => setSelectedIds([...new Set(ids)]), []);

  const toggleSelection = useCallback((id: string, additive: boolean) => {
    setSelectedIds((prev) => {
      if (!additive) return [id];
      return prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id];
    });
  }, []);

  /* ------------------------- 移动 / 修剪 ------------------------- */

  /** 同绑定组、可一起移动的搭档（不含自己） */
  const boundPartners = useCallback((clip: TimelineClip, all: TimelineClip[]): TimelineClip[] => {
    const group = clip.bindGroup;
    if (!group) return [];
    return all.filter((c) => c.id !== clip.id && c.bindGroup === group && !c.locked);
  }, []);

  const moveClip = useCallback(
    (id: string, timelineStart: number, lane?: number) => {
      const before = clipsRef.current;
      const src = before.find((c) => c.id === id);
      if (!src || src.locked) return;
      const fpsNow = fpsRef.current;
      let nextStart = quantizeToFrame(Math.max(0, timelineStart), fpsNow);
      const nextLane = lane != null && lane >= 0 ? Math.round(lane) : (src.lane ?? 0);
      if (Math.abs(nextStart - src.timelineStart) < 1e-6 && nextLane === (src.lane ?? 0)) return;

      // 绑定联动：整组一起平移。向左推时先卡住「最早的那个搭档」，
      // 否则会出现「主角停在 0、对白跑到 -3s」这种脏数据。
      const partners = boundPartners(src, before);
      if (partners.length > 0) {
        nextStart = quantizeToFrame(
          clampBoundMove(
            src.timelineStart,
            nextStart,
            partners.map((c) => c.timelineStart),
          ),
          fpsNow,
        );
      }
      const delta = nextStart - src.timelineStart;
      const partnerIds = new Set(partners.map((c) => c.id));
      const next = before.map((c) => {
        if (c.id === id) return { ...c, timelineStart: nextStart, lane: nextLane };
        if (partnerIds.has(c.id)) {
          return { ...c, timelineStart: round3(Math.max(0, c.timelineStart + delta)) };
        }
        return c;
      });
      const base = nextLane === (src.lane ?? 0) ? '移动片段' : '移动到其它轨';
      commit(next, partners.length > 0 ? `${base}（联动 ${partners.length + 1} 个）` : base, before);
    },
    [boundPartners, commit],
  );

  const moveClips = useCallback(
    (ids: string[], deltaSec: number) => {
      const before = clipsRef.current;
      // 选中集合自动扩展到「选中片段的全部绑定搭档」：绑了就该一起走
      const picked = new Set(ids);
      const groups = new Set(
        before.filter((c) => picked.has(c.id) && c.bindGroup).map((c) => c.bindGroup as string),
      );
      for (const c of before) {
        if (c.bindGroup && groups.has(c.bindGroup)) picked.add(c.id);
      }
      const movables = before.filter((c) => picked.has(c.id) && !c.locked);
      if (movables.length === 0) return;
      const minStart = Math.min(...movables.map((c) => c.timelineStart));
      const applied = quantizeToFrame(Math.max(deltaSec, -minStart), fpsRef.current);
      if (Math.abs(applied) < 1e-6) return;
      const next = before.map((c) =>
        picked.has(c.id) && !c.locked
          ? { ...c, timelineStart: round3(Math.max(0, c.timelineStart + applied)) }
          : c,
      );
      commit(next, `移动 ${movables.length} 个片段`, before);
    },
    [commit],
  );

  const trimClip = useCallback(
    (id: string, edge: 'left' | 'right', deltaSec: number) => {
      const before = clipsRef.current;
      const src = before.find((c) => c.id === id);
      if (!src || src.locked || !Number.isFinite(deltaSec)) return;
      const fpsNow = fpsRef.current;
      const speed = src.speed > 0 ? src.speed : 1;
      const span = clipSpan(src);
      let nextClip: TimelineClip;
      if (edge === 'left') {
        const d = clamp(quantizeToFrame(deltaSec, fpsNow), -src.inPoint / speed, span - MIN_SPAN);
        if (Math.abs(d) < 1 / fpsNow / 2) return;
        const newIn = round3(quantizeToFrame(Math.max(0, src.inPoint + d * speed), fpsNow));
        const newStart = round3(quantizeToFrame(Math.max(0, src.timelineStart + d), fpsNow));
        if ((src.outPoint - newIn) / speed < MIN_SPAN) return;
        nextClip = { ...src, inPoint: newIn, timelineStart: newStart };
      } else {
        const d = quantizeToFrame(deltaSec, fpsNow);
        if (Math.abs(d) < 1 / fpsNow / 2) return;
        const newOut = round3(quantizeToFrame(src.outPoint + d * speed, fpsNow));
        if ((newOut - src.inPoint) / speed < MIN_SPAN) return;
        nextClip = { ...src, outPoint: newOut };
      }
      const next = before.map((c) => (c.id === id ? nextClip : c));
      commit(next, '修剪片段', before);
    },
    [commit],
  );

  /* ------------------------- 删除 / 分割 ------------------------- */

  const removeClip = useCallback(
    (id: string) => {
      const before = clipsRef.current;
      if (!before.some((c) => c.id === id)) return;
      commit(
        before.filter((c) => c.id !== id),
        '删除片段',
        before,
      );
      setSelectedIds((prev) => prev.filter((v) => v !== id));
    },
    [commit],
  );

  const rippleDelete = useCallback(
    (ids: string[]) => {
      const before = clipsRef.current;
      const set = new Set(ids);
      const removed = before.filter((c) => set.has(c.id) && !c.locked);
      if (removed.length === 0) return;
      const removedSet = new Set(removed.map((c) => c.id));
      const rest = before.filter((c) => !removedSet.has(c.id));

      // 每个剩余片段前面「同轨已删除片段」的总时长 = 需要前移的量
      const byRow = new Map<string, Array<{ start: number; span: number }>>();
      for (const r of removed) {
        const key = `${r.track}:${r.lane ?? 0}`;
        const list = byRow.get(key) ?? [];
        list.push({ start: r.timelineStart, span: clipSpan(r) });
        byRow.set(key, list);
      }
      const next = rest.map((c) => {
        const list = byRow.get(`${c.track}:${c.lane ?? 0}`);
        if (!list || list.length === 0) return c;
        let shift = 0;
        for (const r of list) {
          if (r.start + r.span <= c.timelineStart + 1e-6) shift += r.span;
        }
        return shift > 0
          ? { ...c, timelineStart: round3(Math.max(0, c.timelineStart - shift)) }
          : c;
      });
      commit(next, `波纹删除 ${removed.length} 个片段`, before);
      setSelectedIds([]);
    },
    [commit],
  );

  const splitClip = useCallback(
    (id: string, at: number): string | null => {
      const before = clipsRef.current;
      const src = before.find((c) => c.id === id);
      if (!src || src.locked) return null;
      const fpsNow = fpsRef.current;
      const cutAt = quantizeToFrame(at, fpsNow);
      const span = clipSpan(src);
      const offset = cutAt - src.timelineStart;
      if (offset <= 1 / fpsNow || offset >= span - 1 / fpsNow) return null;
      const speed = src.speed > 0 ? src.speed : 1;
      const cut = round3(quantizeToFrame(src.inPoint + offset * speed, fpsNow));
      const idx = before.findIndex((c) => c.id === id);
      const left: TimelineClip = { ...src, outPoint: cut };
      const right: TimelineClip = {
        ...src,
        ...newClipIdentity('local-split'),
        inPoint: cut,
        timelineStart: round3(cutAt),
        sortOrder: src.sortOrder + 1,
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
        before
          .filter(
            (c) =>
              c.track !== 'subtitle' &&
              !c.locked &&
              at > c.timelineStart + 0.02 &&
              at < c.timelineStart + clipSpan(c) - 0.02,
          )
          .sort((a, b) => a.timelineStart - b.timelineStart)
          .pop();
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

  /* ------------------------- 字幕 / 音频 ------------------------- */

  const editSubtitle = useCallback(
    (id: string, text: string) => {
      const before = clipsRef.current;
      const src = before.find((c) => c.id === id);
      if (!src || src.track !== 'subtitle' || (src.text ?? '') === text) return;
      commit(
        before.map((c) => (c.id === id ? { ...c, text } : c)),
        '编辑字幕',
        before,
      );
    },
    [commit],
  );

  const addSubtitle = useCallback(
    (at: number, lane = 0, text = '新字幕'): string | null => {
      const before = clipsRef.current;
      if (!docRef.current) return null;
      const duration = 3;
      const startAt = quantizeToFrame(Math.max(0, at), fpsRef.current);
      const clip: TimelineClip = {
        ...newClipIdentity('local-sub'),
        projectId: projectId ?? '',
        track: 'subtitle',
        sourceShotId: null,
        sourceUrl: null,
        inPoint: 0,
        outPoint: duration,
        timelineStart: startAt,
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
      const duration =
        asset.durationSeconds && asset.durationSeconds > 0 ? asset.durationSeconds : 10;
      const clip: TimelineClip = {
        ...newClipIdentity('local-audio'),
        projectId: projectId ?? '',
        track: 'audio',
        sourceShotId: null,
        sourceUrl: asset.url,
        inPoint: 0,
        outPoint: round3(duration),
        timelineStart: quantizeToFrame(Math.max(0, at), fpsRef.current),
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

  const addVideo = useCallback(
    (
      asset: {
        name: string;
        url: string;
        durationSeconds?: number;
        shotId?: string | null;
      },
      at: number,
      lane = 0,
    ): string | null => {
      const before = clipsRef.current;
      if (!docRef.current) return null;
      const duration =
        asset.durationSeconds && asset.durationSeconds > 0
          ? round3(asset.durationSeconds)
          : 5;
      const clip: TimelineClip = {
        ...newClipIdentity('local-video'),
        projectId: projectId ?? '',
        track: 'video',
        sourceShotId: asset.shotId ?? null,
        sourceUrl: asset.url,
        inPoint: 0,
        outPoint: duration,
        timelineStart: quantizeToFrame(Math.max(0, at), fpsRef.current),
        lane,
        speed: 1,
        volume: 1,
        transition: { type: 'none', duration: 0 },
        text: asset.name.slice(0, 120),
        locked: false,
        sortOrder: before.length,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      commit([...before, clip], '拖入画面', before);
      return clip.id;
    },
    [commit, projectId],
  );

  /**
   * 音画分离 / 合并
   * -------------------------------------------------------------
   * 片段 id 每次落库都会重新生成，所以「这条音频是哪个画面抽出来的」不能靠 id 记，
   * 只能靠 (sourceUrl, timelineStart, in/out) 这套业务特征对上——这也正是分离后的语义：
   * 同一份源媒体、同一段时间，只是拆成两条可以各自移动/修剪的片段。
   * 判重和合并都用 `sameOrigin()`，不要在这里另写一套比较。
   */
  const detachAudio = useCallback(
    (id: string): string | null => {
      const before = clipsRef.current;
      if (!docRef.current) return null;
      const src = before.find((c) => c.id === id);
      if (!src || src.track !== 'video' || !src.sourceUrl) return null;
      const already = before.some((c) => c.track === 'audio' && sameOrigin(c, src, fpsRef.current));
      if (already) return null;
      const occupied = before
        .filter((c) => c.track === 'audio')
        .map((c) => ({ lane: c.lane ?? 0, start: c.timelineStart, end: c.timelineStart + clipSpan(c) }));
      const { lane } = pickFreeLane(occupied, 0, src.timelineStart, src.timelineStart + clipSpan(src));
      const label = src.text?.trim() || '画面原声';
      const clip: TimelineClip = {
        ...src,
        ...newClipIdentity('local-audio'),
        track: 'audio',
        lane,
        speed: 1,
        volume: 1,
        transition: { type: 'none', duration: 0 },
        // 分离出来的音频保留 sourceShotId，时间线上可以显示「♪ 镜号」而不是一串文件名
        text: `♪ ${label}`.slice(0, 120),
        locked: false,
        bindGroup: null,
        textStyle: null,
        sortOrder: before.length,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      commit([...before, clip], '音画分离', before);
      return clip.id;
    },
    [commit],
  );

  const attachAudio = useCallback(
    (id: string): number => {
      const before = clipsRef.current;
      const src = before.find((c) => c.id === id);
      if (!src || src.track !== 'video') return 0;
      const victims = before.filter((c) => c.track === 'audio' && sameOrigin(c, src, fpsRef.current));
      if (victims.length === 0) return 0;
      const gone = new Set(victims.map((v) => v.id));
      commit(
        before.filter((c) => !gone.has(c.id)),
        '音画合并',
        before,
      );
      return victims.length;
    },
    [commit],
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
    commit(
      before.map((c) =>
        c.track === 'video' ? { ...c, timelineStart: starts.get(c.id) ?? c.timelineStart } : c,
      ),
      '画面轨排齐',
      before,
    );
  }, [commit]);

  /* ------------------------- 片段属性 ------------------------- */

  const setClipSpeed = useCallback(
    (id: string, speed: number) => {
      const before = clipsRef.current;
      const src = before.find((c) => c.id === id);
      if (!src || src.locked) return;
      const s = Math.round(clamp(speed, 0.25, 4) * 100) / 100;
      if (Math.abs(s - src.speed) < 1e-3) return;
      const oldSpan = clipSpan(src);
      const newSpan = (src.outPoint - src.inPoint) / s;
      const delta = newSpan - oldSpan;
      const end = src.timelineStart + oldSpan;
      const next = before.map((c) => {
        if (c.id === id) return { ...c, speed: s };
        if (
          c.track === src.track &&
          (c.lane ?? 0) === (src.lane ?? 0) &&
          c.timelineStart >= end - 1e-6
        ) {
          return { ...c, timelineStart: round3(Math.max(0, c.timelineStart + delta)) };
        }
        return c;
      });
      commit(next, `变速 ${s.toFixed(2)}×`, before);
    },
    [commit],
  );

  const setClipVolume = useCallback(
    (id: string, volume: number) => {
      const before = clipsRef.current;
      const src = before.find((c) => c.id === id);
      if (!src) return;
      const v = clamp(volume, 0, 1);
      if (Math.abs(v - src.volume) < 1e-3) return;
      commit(
        before.map((c) => (c.id === id ? { ...c, volume: v } : c)),
        '调整音量',
        before,
      );
    },
    [commit],
  );

  const setClipTransition = useCallback(
    (id: string, transition: TimelineClip['transition']) => {
      const before = clipsRef.current;
      if (!before.some((c) => c.id === id)) return;
      commit(
        before.map((c) => (c.id === id ? { ...c, transition } : c)),
        '设置转场',
        before,
      );
    },
    [commit],
  );

  const setClipLocked = useCallback(
    (id: string, locked: boolean) => {
      const before = clipsRef.current;
      if (!before.some((c) => c.id === id)) return;
      commit(
        before.map((c) => (c.id === id ? { ...c, locked } : c)),
        locked ? '锁定片段' : '解锁片段',
        before,
      );
    },
    [commit],
  );

  const setClipEnabled = useCallback(
    (id: string, enabled: boolean) => {
      const before = clipsRef.current;
      const src = before.find((c) => c.id === id);
      if (!src) return;
      if ((src.enabled !== false) === enabled) return;
      commit(
        before.map((c) => (c.id === id ? { ...c, enabled } : c)),
        enabled ? '启用片段' : '停用片段',
        before,
      );
    },
    [commit],
  );

  /* ------------------------- 绑定 / 字幕样式 ------------------------- */

  const bindSelection = useCallback(() => {
    const before = clipsRef.current;
    const picked = before.filter((c) => selectedIds.includes(c.id) && !c.locked);
    if (picked.length < 2) return;
    const group = `bg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const ids = new Set(picked.map((c) => c.id));
    commit(
      before.map((c) => (ids.has(c.id) ? { ...c, bindGroup: group } : c)),
      `绑定 ${picked.length} 个片段`,
      before,
    );
  }, [commit, selectedIds]);

  const unbindSelection = useCallback(() => {
    const before = clipsRef.current;
    const ids = new Set(selectedIds);
    const targets = before.filter((c) => ids.has(c.id) && c.bindGroup);
    if (targets.length === 0) return;
    const hit = new Set(targets.map((c) => c.id));
    commit(
      before.map((c) => (hit.has(c.id) ? { ...c, bindGroup: null } : c)),
      `解绑 ${targets.length} 个片段`,
      before,
    );
  }, [commit, selectedIds]);

  /** 字幕样式：只写用户改过的键，未改的继续继承默认 */
  const updateTextStyle = useCallback(
    (id: string, patch: Partial<TimelineTextStyle>) => {
      const before = clipsRef.current;
      const src = before.find((c) => c.id === id);
      if (!src) return;
      const merged: TimelineTextStyle = { ...(src.textStyle ?? {}), ...patch };
      commit(
        before.map((c) => (c.id === id ? { ...c, textStyle: merged } : c)),
        '调整字幕样式',
        before,
      );
    },
    [commit],
  );

  const setClipText = useCallback(
    (id: string, text: string) => {
      const before = clipsRef.current;
      const src = before.find((c) => c.id === id);
      if (!src || (src.text ?? '') === text) return;
      commit(
        before.map((c) => (c.id === id ? { ...c, text } : c)),
        '修改字幕文本',
        before,
      );
    },
    [commit],
  );

  /* ------------------------- 轨道属性 ------------------------- */

  const updateTrack = useCallback(
    (
      track: TimelineTrackMeta['track'],
      lane: number,
      patch: Partial<TimelineTrackMeta>,
    ) => {
      if (!docRef.current) return;
      const current = docRef.current.tracks ?? [];
      const idx = current.findIndex(
        (t) => t.track === track && (t.lane ?? 0) === lane,
      );
      const merged: TimelineTrackMeta =
        idx >= 0 ? { ...current[idx], ...patch } : { track, lane, ...patch };
      const nextTracks =
        idx >= 0
          ? current.map((t, i) => (i === idx ? merged : t))
          : [...current, merged];
      const nextDoc = { ...docRef.current, tracks: nextTracks };
      docRef.current = nextDoc;
      data.commitTimeline(nextDoc);
      schedule();
    },
    [data, schedule],
  );

  /* ------------------------- 轨道增删 ------------------------- */

  const addTrack = useCallback(
    (track: TimelineTrackMeta['track']): number | null => {
      if (!docRef.current) return null;
      const trackClips = clipsRef.current.filter((c) => c.track === track);
      const meta = docRef.current.tracks ?? [];
      const lane =
        Math.max(
          -1,
          ...trackClips.map((c) => c.lane ?? 0),
          ...meta.filter((t) => t.track === track).map((t) => t.lane ?? 0),
        ) + 1;
      if (lane > 19) return null;
      updateTrack(track, lane, { height: ROW_HEIGHT_DEFAULT[track] });
      return lane;
    },
    [updateTrack],
  );

  /**
   * 跨轨拖拽的落库：移动片段到目标 lane，必要时新建一条轨道元信息，
   * clips 与 tracks 一次提交（不会「轨建了但片段没过去」）。
   *
   * 只动被拖片段自己；绑定搭档纵向不联动（绑定只保证横向一起走）；
   * 原轨其余片段保持原位 —— 这正是用户要的「拖一个出去，其余不动，留空位」。
   */
  const moveClipToLane = useCallback(
    (id: string, timelineStart: number, lane: number, createTrack: boolean): void => {
      const before = clipsRef.current;
      const src = before.find((c) => c.id === id);
      if (!src || src.locked || lane < 0 || lane > 19) return;
      const fpsNow = fpsRef.current;
      const nextStart = quantizeToFrame(Math.max(0, timelineStart), fpsNow);
      if (Math.abs(nextStart - src.timelineStart) < 1e-6 && lane === (src.lane ?? 0)) return;

      const curTracks = docRef.current?.tracks ?? [];
      const hasMeta = curTracks.some((t) => t.track === src.track && (t.lane ?? 0) === lane);
      const nextTracks =
        createTrack && !hasMeta
          ? [
              ...curTracks,
              {
                track: src.track,
                lane,
                height: ROW_HEIGHT_DEFAULT[src.track],
              } as TimelineTrackMeta,
            ]
          : curTracks;
      const next = before.map((c) =>
        c.id === id ? { ...c, timelineStart: nextStart, lane } : c,
      );
      const label = createTrack
        ? `移动到新轨道（${src.track} ${lane + 1}）`
        : `移动到 ${src.track} ${lane + 1}`;
      commit(next, label, before,
        nextTracks !== curTracks ? { next: nextTracks, before: curTracks } : undefined);
    },
    [commit],
  );

  const removeTrack = useCallback(
    (track: TimelineTrackMeta['track'], lane: number): string | null => {
      if (!docRef.current) return '时间线尚未就绪';
      const used = clipsRef.current.filter(
        (c) => c.track === track && (c.lane ?? 0) === lane,
      ).length;
      if (used > 0) return `该轨道上还有 ${used} 个片段，先清空再删除`;
      if ((docRef.current.tracks ?? []).length === 0 && lane === 0) return '这是唯一的基础轨道，不能删除';
      const nextTracks = (docRef.current.tracks ?? []).filter(
        (t) => !(t.track === track && (t.lane ?? 0) === lane),
      );
      const nextDoc = { ...docRef.current, tracks: nextTracks };
      docRef.current = nextDoc;
      data.commitTimeline(nextDoc);
      schedule();
      return null;
    },
    [data, schedule],
  );

  /* ------------------------- 标记点 ------------------------- */

  const persistMarkers = useCallback(
    (next: number[]) => {
      if (!projectId) return;
      try {
        localStorage.setItem(markerKey(projectId), JSON.stringify(next));
      } catch {
        /* 隐私模式忽略 */
      }
      setMarkers(next);
    },
    [projectId],
  );

  const addMarker = useCallback(
    (at: number) => {
      const t = round3(quantizeToFrame(Math.max(0, at), fpsRef.current));
      if (markers.some((m) => Math.abs(m - t) < 0.02)) return;
      persistMarkers([...markers, t].sort((a, b) => a - b));
    },
    [markers, persistMarkers],
  );

  const removeMarker = useCallback(
    (at: number) => {
      persistMarkers(markers.filter((m) => Math.abs(m - at) > 0.02));
    },
    [markers, persistMarkers],
  );

  /* ------------------------- 复制 / 粘贴 ------------------------- */

  const clipboardRef = useRef<TimelineClip[]>([]);

  const copySelection = useCallback((ids: string[]) => {
    const set = new Set(ids);
    const picked = clipsRef.current.filter((c) => set.has(c.id)).map((c) => ({ ...c }));
    if (picked.length === 0) return;
    clipboardRef.current = picked;
    toast.success(`已复制 ${picked.length} 个片段`, { duration: 1200 });
  }, []);

  const cutSelection = useCallback(
    (ids: string[]) => {
      copySelection(ids);
      rippleDelete(ids);
    },
    [copySelection, rippleDelete],
  );

  const pasteAt = useCallback(
    (at: number): string[] => {
      const src = clipboardRef.current;
      if (src.length === 0 || !docRef.current) {
        toast.info('剪贴板为空：先选中片段再复制（⌘C）');
        return [];
      }
      const base = Math.min(...src.map((c) => c.timelineStart));
      const targetAt = quantizeToFrame(Math.max(0, at), fpsRef.current);
      const now = new Date().toISOString();
      const before = clipsRef.current;
      // 粘贴要保留「副本内部」的绑定关系，但不能继续挂在原组上 ——
      // 否则拖原来的片段，刚粘贴的也跟着跑。所以按原组 id 重新发一批组 id。
      const groupRemap = new Map<string, string>();
      const remap = (g: string | null | undefined): string | null => {
        if (!g) return null;
        const hit = groupRemap.get(g);
        if (hit) return hit;
        const fresh = `bg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
        groupRemap.set(g, fresh);
        return fresh;
      };
      const created: TimelineClip[] = src.map((c, i) => ({
        ...c,
        ...newClipIdentity('local-paste'),
        projectId: projectId ?? '',
        timelineStart: round3(Math.max(0, c.timelineStart - base + targetAt)),
        bindGroup: remap(c.bindGroup),
        sortOrder: before.length + i,
        createdAt: now,
        updatedAt: now,
      }));
      commit([...before, ...created], `粘贴 ${created.length} 个片段`, before);
      return created.map((c) => c.id);
    },
    [commit, projectId],
  );

  /* ------------------------- 冲突恢复 ------------------------- */

  const reloadAfterConflict = useCallback(async () => {
    if (!projectId) return;
    try {
      const server = await getTimeline(projectId);
      docRef.current = server;
      data.commitTimeline(server);
      undoStack.current = [];
      redoStack.current = [];
      setHistVer((v) => v + 1);
      setConflict(false);
      setDirty(false);
      toast.success('已载入服务器最新版本');
    } catch (err) {
      toast.error('重新载入失败', { description: (err as Error)?.message ?? '网络错误' });
    }
  }, [projectId, data]);

  return {
    ready: Boolean(doc),
    saving,
    dirty,
    conflict,
    version: doc?.version ?? 0,
    fps,
    tracks: doc?.tracks ?? [],
    markers,
    selectedIds,
    canUndo: undoStack.current.length > 0,
    canRedo: redoStack.current.length > 0,
    undo: () => travel('undo'),
    redo: () => travel('redo'),
    setSelection,
    toggleSelection,
    moveClip,
    moveClipToLane,
    moveClips,
    trimClip,
    removeClip,
    rippleDelete,
    splitClip,
    splitAtPlayhead,
    editSubtitle,
    addSubtitle,
    addAudio,
    addVideo,
    detachAudio,
    attachAudio,
    packVideo,
    setClipSpeed,
    setClipVolume,
    setClipTransition,
    setClipLocked,
    setClipEnabled,
    bindSelection,
    unbindSelection,
    updateTextStyle,
    setClipText,
    addTrack,
    removeTrack,
    updateTrack,
    addMarker,
    removeMarker,
    copySelection,
    cutSelection,
    pasteAt,
    applyAgentOps,
    previewAgentOps,
    saveNow: flush,
    reloadAfterConflict,
  };
}
