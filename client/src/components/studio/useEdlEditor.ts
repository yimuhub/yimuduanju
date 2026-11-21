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
import type { TimelineVolumePoint } from '@shared/timeline-audio-expr';
import type { TimelineClipAudioFxNode } from '@shared/timeline-audio-fx';
import { normalizeAudioFxNodes } from '@shared/timeline-audio-fx';
import { applyTimelineAgentOps, getTimeline, saveTimeline } from '@client/src/api/timeline';
import type { StudioData } from './useStudioData';
import {
  applyTimelineOps,
  clipKey,
  type TimelineOp,
  type TimelineOpDiff,
} from '@shared/timeline-ops';
import { expandCompoundClip } from '@shared/timeline-compound';
import { clipSpan, sameOrigin } from './model';
import {
  clamp,
  clampBoundMove,
  floorToFrame,
  quantizeToFrame,
  ROW_HEIGHT_DEFAULT,
  round3,
} from '@client/src/lib/timeline-frame';
import { pickFreeLane } from '@client/src/lib/timeline-drop';
import { buildDuckEnvelope, collectVoiceRegions, normalizeVolumePoints } from '@client/src/lib/timeline-audio';
import {
  resolveCloseAllShifts,
  resolveCloseGapShifts,
  resolveGapAt,
  type GapClip,
} from '@client/src/lib/timeline-gaps';
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
  sourceDuration: c.sourceDuration,
  timelineStart: c.timelineStart,
  lane: c.lane ?? 0,
  speed: c.speed,
  volume: c.volume,
  pitch: c.pitch ?? 1,
  transition: c.transition ?? null,
  text: c.text ?? null,
  // 绑定组与字幕样式必须一起落库，否则一保存就「解绑」、样式回默认
  bindGroup: c.bindGroup ?? null,
  textStyle: c.textStyle ?? null,
  // 运镜关键帧/倒放/复合/转写同样必须随保存落库，漏传会被服务端清空
  keyframes: c.keyframes ?? null,
  // 音量包络与人声避让标记同理：漏传会在整体替换保存时被服务端清空
  volumeAutomation: c.volumeAutomation ?? null,
  // 音频效果链（FX rack）同理：漏传会在整体替换保存时被服务端清空
  audioFx: c.audioFx ?? null,
  // 淡入淡出（G11）同样必须随保存落库，漏传会在整体替换保存时被服务端清空
  fadeIn: c.fadeIn,
  fadeOut: c.fadeOut,
  duckUnderVoice: c.duckUnderVoice ?? null,
  visual: c.visual ?? null,
  reverse: c.reverse ?? null,
  compound: c.compound ?? null,
  transcript: c.transcript ?? null,
  locked: c.locked,
  enabled: c.enabled !== false,
  sortOrder: c.sortOrder,
});

const markerKey = (projectId: string) => `yimu.timeline.markers.${projectId}`;

/**
 * 音量包络的同步范围：画面片段 ↔ 它的 auto: 内嵌音频（与 setClipVolume 同规则）。
 * bindGroup 里存的是片段 id/clientKey，落库重建 id 后两种都可能存在，两种都认。
 */
const volumeSyncIds = (clips: TimelineClip[], src: TimelineClip): Set<string> => {
  const ids = new Set<string>([src.id]);
  const ownerKeys = [src.id, src.clientKey].filter(Boolean) as string[];
  if (src.track === 'video') {
    for (const c of clips) {
      if (c.track !== 'audio') continue;
      if (ownerKeys.some((k) => c.bindGroup === `auto:${k}`)) ids.add(c.id);
    }
  } else if (src.track === 'audio') {
    const m = /^auto:(.+)$/.exec(src.bindGroup ?? '');
    if (m) {
      for (const c of clips) {
        if (c.track !== 'video') continue;
        if (c.id === m[1] || c.clientKey === m[1]) ids.add(c.id);
      }
    }
  }
  return ids;
};

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
  /**
   * 剪映 Q/W 的波纹修剪：在 atSec 处裁掉左/右半段，并把同轨后续片段整体前移。
   * 与 trimClip 的区别是「闭合空隙」，不是留下黑场。
   */
  rippleTrimAt: (id: string, edge: 'left' | 'right', atSec: number) => void;
  /**
   * 修剪到播放头（非波纹，OpenMotion TimelineTrimButtons 对齐）：
   * 把片段左/右边缘直接修到播放头时刻，后续片段保持原位（留出的空隙不闭合）。
   * 目标片段 = 显式 id > 播放头命中的选中片段 > 播放头命中的片段；
   * 播放头必须在片段内部，结果时长不足一帧时拒绝。成功返回 true。
   */
  trimClipToPlayhead: (side: 'left' | 'right', at: number, id?: string) => boolean;
  /**
   * 闭合单条空隙（右键空白轨区）：把该行空隙之后的片段整体左移空隙宽度。
   * 一次 commit 可撤销；失败返回原因，成功返回 null。
   */
  closeGap: (track: TimelineClip['track'], lane: number, atSec: number) => string | null;
  /** 闭合该行全部空隙（保留首个片段起点，前导留黑不吞）。失败返回原因。 */
  closeAllGaps: (track: TimelineClip['track'], lane: number) => string | null;
  /**
   * 冻结帧插入：在切点切开源片段并插入一张图片片段（默认 1s，可拖拽调整），
   * 切点之后同轨片段整体后移。一次 commit，可整体撤销。
   */
  insertFreezeFrame: (
    id: string,
    at: number,
    image: { name: string; url: string; durationSec?: number },
  ) => boolean;
  splitClip: (id: string, at: number) => string | null;
  /** 批量分割：同一时刻切开多个片段（缺省 = 全部可切片段），返回实际切开的数量 */
  splitManyAt: (at: number, ids?: string[]) => number;
  splitAtPlayhead: (at: number, id?: string) => string | null;
  editSubtitle: (id: string, text: string) => void;
  addSubtitle: (at: number, lane?: number, text?: string, style?: TimelineClip['textStyle'], durationSec?: number) => string | null;
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
      hasAudio?: boolean;
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
  /** 曲线变速：把选中画面按等长源片段拆成 N 段，逐段速度形成折线曲线（真实可导出） */
  setClipSpeedCurve: (id: string, speeds: number[]) => boolean;
  /** 倒放开关（画面与独立音频） */
  toggleClipReverse: (id: string) => void;
  /** 新建真复合片段：同轨相邻画面收成一个整体，失败返回原因 */
  createCompound: (ids: string[]) => string | null;
  /** 解除真复合片段，按子片段还原 */
  ungroupCompound: (id: string) => string[];
  setClipVolume: (id: string, volume: number) => void;
  /** 音量包络（G12）：整组替换（帧量化、升序去重）；少于 2 点视为清除 */
  setClipVolumeAutomation: (id: string, points: TimelineVolumePoint[]) => void;
  /**
   * 淡入淡出（G11）：头/尾线性斜坡（秒，帧量化、≥0、各自 ≤ 片段时长且相加不超时长）。
   * 画面片段与其 auto: 内嵌音频互相镜像（与音量包络同规则）；0 = 清除该侧淡变。
   */
  setClipFades: (id: string, fades: { fadeIn?: number; fadeOut?: number }) => void;
  /** 清除音量包络：恢复 volume 直线（白色增益线重新出现） */
  clearClipVolumeAutomation: (id: string) => void;
  /**
   * 人声避让（G15）：收集对白轨/人声语义片段的活跃区间，为目标音频片段
   * 生成压低包络（0.25 / 淡入 0.15s / 淡出 0.3s，帧量化）并打 duckUnderVoice 标记。
   * 一次提交可整体撤销；没有人声区间返回 false。
   */
  applyDuckUnderVoice: (id: string) => boolean;
  /**
   * 音频效果链（FX rack）：整组替换（服务端落库前再归一化夹紧）；null/空 = 清除。
   * 画面片段 ↔ 它的 auto: 内嵌音频互相镜像——导出的 auto 音频 part 读的是
   * auto: 音频片段，预览响的也是它，画面上挂的 FX 必须镜像过去才听得到/导得出
   * （与音量包络同一规则）；独立音频片段各自独立。
   */
  setClipAudioFx: (id: string, nodes: TimelineClipAudioFxNode[] | null) => void;
  /** 音高倍率 0.5–2（1=原音）；预览/导出共用 */
  setClipPitch: (id: string, pitch: number) => void;
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
  /** 运镜关键帧：整组替换（内部已排序去重） */
  setClipKeyframes: (id: string, keyframes: TimelineClip['keyframes']) => void;
  /** 写入视觉增强：抠像/蒙版/美容/跟踪/AI 风格 */
  setClipVisual: (id: string, visual: TimelineClip['visual']) => void;

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
      const curTracks = docRef.current.tracks ?? [];
      const requestedTracks = tracks ? tracks.next : curTracks;
      const used = new Set(next.map((c) => `${c.track}:${c.lane ?? 0}`));
      // 空轨自动回收：任何没有素材的轨道都移除（主轨也不常驻，杜绝空轨道残留）
      const nextTracks = requestedTracks.filter(
        (t) => used.has(`${t.track}:${t.lane ?? 0}`),
      );
      const beforeTracks = tracks ? tracks.before : curTracks;
      const tracksChanged =
        nextTracks.length !== curTracks.length ||
        nextTracks.some((t, i) => t.track !== curTracks[i]?.track || (t.lane ?? 0) !== (curTracks[i]?.lane ?? 0));
      const nextDoc = {
        ...docRef.current,
        clips: next,
        tracks: nextTracks,
        updatedAt: new Date().toISOString(),
      };
      docRef.current = nextDoc;
      data.commitTimeline(nextDoc);
      undoStack.current.push({
        label,
        before,
        after: next,
        ...(tracksChanged
          ? { tracksBefore: beforeTracks, tracksAfter: nextTracks }
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
    // av: 只是「音画并排」的稳定关联标记，不是同步拖动组；分离后两条轨各自可独立移动。
    if (!group || group.startsWith('av:')) return [];
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
        before
          .filter((c) => picked.has(c.id) && c.bindGroup && !c.bindGroup.startsWith('av:'))
          .map((c) => c.bindGroup as string),
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
        const sourceDuration = src.sourceDuration ?? src.outPoint;
        const newOut = Math.min(
          sourceDuration,
          round3(quantizeToFrame(src.outPoint + d * speed, fpsNow)),
        );
        if ((newOut - src.inPoint) / speed < MIN_SPAN) return;
        if (Math.abs(newOut - src.outPoint) < 1e-4) return;
        nextClip = { ...src, outPoint: newOut };
      }
      const next = before.map((c) => (c.id === id ? nextClip : c));
      commit(next, '修剪片段', before);
    },
    [commit],
  );

  /**
   * 修剪到播放头（非波纹）：边缘直接落到播放头所在帧，右侧片段一律不动，
   * 留出的空隙交给「空隙闭合」或用户手动处理（OpenMotion TimelineTrimButtons 语义）。
   * 左边缘与 trimClip 一样同步推进 inPoint（变速时按源时间补偿）。
   */
  const trimClipToPlayhead = useCallback(
    (side: 'left' | 'right', at: number, id?: string): boolean => {
      const before = clipsRef.current;
      const fpsNow = fpsRef.current;
      const cutAt = quantizeToFrame(Math.max(0, at), fpsNow);
      // 播放头必须在片段内部（留出半帧容差，压在边缘上不裁）
      const inside = (c: TimelineClip) =>
        cutAt > c.timelineStart + 1 / fpsNow / 2 &&
        cutAt < c.timelineStart + clipSpan(c) - 1 / fpsNow / 2;
      let src: TimelineClip | undefined;
      if (id) {
        src = before.find((c) => c.id === id);
        if (!src) return false;
      } else {
        const sel = before.find((c) => c.id === (selectedIds[selectedIds.length - 1] ?? ''));
        src = (sel && inside(sel) ? sel : undefined)
          ?? before
            .filter(inside)
            .sort((a, b) => (b.lane ?? 0) - (a.lane ?? 0) || a.timelineStart - b.timelineStart)[0];
      }
      if (!src || src.locked) {
        if (id) toast.info(src?.locked ? '片段已锁定' : '播放头不在片段内，无法修剪');
        else toast.info('先把播放头移到要修剪的片段内部');
        return false;
      }
      if (!inside(src)) {
        toast.info('播放头不在片段内，无法修剪到播放头');
        return false;
      }
      const target = src;
      const speed = target.speed > 0 ? target.speed : 1;
      if (side === 'left') {
        const removed = cutAt - target.timelineStart;
        if (removed < 1 / fpsNow / 2) {
          toast.info('播放头太靠近片段左边缘');
          return false;
        }
        const newIn = round3(quantizeToFrame(target.inPoint + removed * speed, fpsNow));
        if ((target.outPoint - newIn) / speed < MIN_SPAN) {
          toast.info('修剪后时长不足一帧');
          return false;
        }
        commit(
          before.map((c) =>
            c.id === target.id ? { ...c, inPoint: newIn, timelineStart: round3(cutAt) } : c,
          ),
          '修剪到播放头（左）',
          before,
        );
      } else {
        const removed = target.timelineStart + clipSpan(target) - cutAt;
        if (removed < 1 / fpsNow / 2) {
          toast.info('播放头太靠近片段右边缘');
          return false;
        }
        const newOut = round3(quantizeToFrame(target.outPoint - removed * speed, fpsNow));
        if ((newOut - target.inPoint) / speed < MIN_SPAN) {
          toast.info('修剪后时长不足一帧');
          return false;
        }
        commit(
          before.map((c) => (c.id === target.id ? { ...c, outPoint: newOut } : c)),
          '修剪到播放头（右）',
          before,
        );
      }
      return true;
    },
    [commit, selectedIds],
  );

  /* ------------------------- 删除 / 分割 ------------------------- */

  const rippleTrimAt = useCallback(
    (id: string, edge: 'left' | 'right', atSec: number) => {
      const before = clipsRef.current;
      const src = before.find((c) => c.id === id);
      if (!src || src.locked || !Number.isFinite(atSec)) return;
      const fpsNow = fpsRef.current;
      const speed = src.speed > 0 ? src.speed : 1;
      const span = clipSpan(src);
      const srcEnd = src.timelineStart + span;
      const removed = edge === 'left' ? atSec - src.timelineStart : srcEnd - atSec;
      if (removed < MIN_SPAN) return;

      let nextClip: TimelineClip;
      let appliedRemoved = removed;
      if (edge === 'left') {
        const d = clamp(quantizeToFrame(removed, fpsNow), -src.inPoint / speed, span - MIN_SPAN);
        appliedRemoved = d;
        const newIn = round3(quantizeToFrame(Math.max(0, src.inPoint + d * speed), fpsNow));
        // 剪映 Q 是波纹：片段起点留在原位，只把入点向右推，后续片段再整体前移。
        const newStart = src.timelineStart;
        if ((src.outPoint - newIn) / speed < MIN_SPAN) return;
        nextClip = { ...src, inPoint: newIn, timelineStart: newStart };
      } else {
        const d = quantizeToFrame(atSec - srcEnd, fpsNow);
        appliedRemoved = -d;
        const newOut = round3(quantizeToFrame(src.outPoint + d * speed, fpsNow));
        if ((newOut - src.inPoint) / speed < MIN_SPAN) return;
        nextClip = { ...src, outPoint: newOut };
      }

      // 只前移同一条轨道行里「原片段之后」的片段，避免跨轨道误伤；
      // 间距会被保留（移动同等 removed），不会把原本的空白吃掉。
      const next = before.map((c) => {
        if (c.id === id) return nextClip;
        if (c.track !== src.track || (c.lane ?? 0) !== (src.lane ?? 0)) return c;
        if (c.timelineStart >= srcEnd - 1e-6) {
          return { ...c, timelineStart: round3(Math.max(0, c.timelineStart - appliedRemoved)) };
        }
        return c;
      });
      commit(next, edge === 'left' ? '波纹裁左' : '波纹裁右', before);
    },
    [commit],
  );

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

  /* ------------------------- 空隙闭合 ------------------------- */

  /**
   * 一条轨道行的片段集合。与时间线行渲染同一规则：
   * 内嵌原声（bindGroup auto:）不占音频行，也不参与该行空隙计算——
   * 它跟着自己的画面片段走，闭合音频行空隙时不能把它单独挪走。
   */
  const rowGapClips = useCallback(
    (track: TimelineClip['track'], lane: number): GapClip[] =>
      clipsRef.current
        .filter(
          (c) =>
            c.track === track &&
            (c.lane ?? 0) === lane &&
            !(track === 'audio' && c.bindGroup?.startsWith('auto:')),
        )
        .map((c) => ({
          id: c.id,
          start: c.timelineStart,
          duration: clipSpan(c),
          locked: c.locked === true,
        })),
    [],
  );

  /** 空隙闭合的公共校验：行内是否有片段、轨道是否锁定。返回原因或 null */
  const gapGuard = useCallback(
    (track: TimelineClip['track'], lane: number, minClips: number): string | null => {
      const rowClips = rowGapClips(track, lane);
      if (rowClips.length < minClips) {
        return rowClips.length === 0 ? '该轨道还没有片段' : '该轨道只有一个片段，没有可闭合的空隙';
      }
      const lockedTrack = (docRef.current?.tracks ?? []).some(
        (t) => t.track === track && (t.lane ?? 0) === lane && t.locked === true,
      );
      if (lockedTrack) return '轨道已锁定，先解锁再闭合空隙';
      return null;
    },
    [rowGapClips],
  );

  /** 把平移计划落成一次 commit（新起点统一落帧，浮点漂移不进 EDL） */
  const applyGapShifts = useCallback(
    (shifts: { id: string; newStart: number }[], label: string, before: TimelineClip[]) => {
      const shiftMap = new Map(shifts.map((s) => [s.id, s.newStart]));
      commit(
        before.map((c) =>
          shiftMap.has(c.id)
            ? {
                ...c,
                timelineStart: round3(
                  quantizeToFrame(shiftMap.get(c.id) as number, fpsRef.current),
                ),
              }
            : c,
        ),
        label,
        before,
      );
    },
    [commit],
  );

  /**
   * 闭合单条空隙（OpenMotion TrackGapContextMenu 对齐）：
   * atSec 时刻该行空隙之后的片段整体左移空隙宽度，一次 commit 可撤销。
   * 返回 null 表示成功，否则为给用户看的失败原因。
   */
  const closeGap = useCallback(
    (track: TimelineClip['track'], lane: number, atSec: number): string | null => {
      const before = clipsRef.current;
      const guard = gapGuard(track, lane, 2);
      if (guard) return guard;
      const rowClips = rowGapClips(track, lane);
      const gap = resolveGapAt(rowClips, quantizeToFrame(Math.max(0, atSec), fpsRef.current));
      if (!gap) return '这里没有可闭合的空隙';
      const byId = new Map(rowClips.map((c) => [c.id, c]));
      if (gap.followingIds.some((cid) => byId.get(cid)?.locked)) {
        return '该轨道上有锁定片段，无法闭合空隙';
      }
      const shifts = resolveCloseGapShifts(rowClips, gap);
      if (shifts.length === 0) return '这里没有可闭合的空隙';
      applyGapShifts(shifts, '闭合空隙', before);
      return null;
    },
    [applyGapShifts, gapGuard, rowGapClips],
  );

  /**
   * 闭合该行全部空隙：保留首个片段的起点（前导留黑不吞），其后片段
   * 按原顺序首尾相接。画面轨从 0 排齐请用 packVideo。失败返回原因。
   */
  const closeAllGaps = useCallback(
    (track: TimelineClip['track'], lane: number): string | null => {
      const before = clipsRef.current;
      const guard = gapGuard(track, lane, 2);
      if (guard) return guard;
      const rowClips = rowGapClips(track, lane);
      const shifts = resolveCloseAllShifts(rowClips);
      if (shifts.length === 0) return '该轨道没有可闭合的空隙';
      const byId = new Map(rowClips.map((c) => [c.id, c]));
      if (shifts.some((s) => byId.get(s.id)?.locked)) {
        return '该轨道上有锁定片段，无法闭合空隙';
      }
      applyGapShifts(shifts, '闭合全部空隙', before);
      return null;
    },
    [applyGapShifts, gapGuard, rowGapClips],
  );

  /**
   * 在片段数组里把一条片段按帧切开：返回 [新数组, 右片段 id]。
   * 纯数组变换，供 splitClip / splitManyAt 共用（批量切必须在同一份
   * 数组上累积，否则每次 commit 之间 clipsRef 还是旧值，前一刀会被后一刀吃掉）。
   */
  const splitInArray = useCallback(
    (all: TimelineClip[], id: string, at: number, fpsNow: number): [TimelineClip[], string] | null => {
      const idx = all.findIndex((c) => c.id === id);
      if (idx < 0) return null;
      const src = all[idx];
      if (src.locked) return null;
      const cutAt = quantizeToFrame(at, fpsNow);
      const span = clipSpan(src);
      const offset = cutAt - src.timelineStart;
      if (offset <= 1 / fpsNow || offset >= span - 1 / fpsNow) return null;
      const speed = src.speed > 0 ? src.speed : 1;
      const sourceEnd = src.sourceDuration && src.sourceDuration > 0 ? src.sourceDuration : Number.POSITIVE_INFINITY;
      const cut = round3(quantizeToFrame(src.inPoint + offset * speed, fpsNow));
      // 导入素材的元数据时长可能比真实流略长；在素材末端之后分割会生成
      // 一段没有画面的空片段，时间线显示 5s、导出却只有 4.48s。
      if (cut >= sourceEnd - 1 / fpsNow) return null;
      const left: TimelineClip = { ...src, outPoint: cut };
      const right: TimelineClip = {
        ...src,
        ...newClipIdentity('local-split'),
        inPoint: cut,
        timelineStart: round3(cutAt),
        sortOrder: src.sortOrder + 1,
      };
      const next = [...all.slice(0, idx), left, right, ...all.slice(idx + 1)];
      return [next, right.id];
    },
    [],
  );

  const splitClip = useCallback(
    (id: string, at: number): string | null => {
      const before = clipsRef.current;
      const fpsNow = fpsRef.current;
      const split = splitInArray(before, id, at, fpsNow);
      if (!split) {
        // 单切失败时把「为什么切不动」说清楚（批量切静默跳过，不打扰）
        const src = before.find((c) => c.id === id);
        const cutAt = quantizeToFrame(at, fpsNow);
        if (src && !src.locked) {
          const span = clipSpan(src);
          const offset = cutAt - src.timelineStart;
          const speed = src.speed > 0 ? src.speed : 1;
          const sourceEnd = src.sourceDuration && src.sourceDuration > 0 ? src.sourceDuration : Number.POSITIVE_INFINITY;
          const cut = round3(quantizeToFrame(src.inPoint + offset * speed, fpsNow));
          if (offset > 1 / fpsNow && offset < span - 1 / fpsNow && cut >= sourceEnd - 1 / fpsNow) {
            toast.info('分割点超出素材实际长度');
          }
        }
        return null;
      }
      commit(split[0], '分割片段', before);
      return split[1];
    },
    [commit, splitInArray],
  );

  /**
   * 批量分割：一次 commit 在同一时刻切开多个片段（剃刀 Shift+点击 = 切所有轨、
   * 批量分割键共用）。切不动的片段静默跳过。返回实际切开的数量。
   */
  const splitManyAt = useCallback(
    (at: number, ids?: string[]): number => {
      const before = clipsRef.current;
      const fpsNow = fpsRef.current;
      const idSet = ids ? new Set(ids) : null;
      let working = before;
      let n = 0;
      for (const c of before) {
        if (c.locked) continue;
        if (idSet && !idSet.has(c.id)) continue;
        const cutAt = quantizeToFrame(at, fpsNow);
        if (cutAt <= c.timelineStart || cutAt >= c.timelineStart + clipSpan(c)) continue;
        const split = splitInArray(working, c.id, at, fpsNow);
        if (!split) continue;
        working = split[0];
        n += 1;
      }
      if (n === 0) return 0;
      commit(working, n === 1 ? '分割片段' : `批量分割 ${n} 个片段`, before);
      return n;
    },
    [commit, splitInArray],
  );

  const splitAtPlayhead = useCallback(
    (at: number, id?: string): string | null => {
      const before = clipsRef.current;
      const target =
        (id ? before.find((c) => c.id === id) : undefined) ??
        before
          .filter(
            (c) =>
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

  /**
   * 冻结帧插入（OpenMotion Freeze frame 对齐，纯客户端实现）：
   * 在切点切开源片段 → 插入一张图片片段（默认 1s，拖右边缘可拉长）→
   * 切点之后同轨片段整体后移。抓帧与上传由组件层完成，这里只负责
   * 一次 commit 落库（可整体撤销）。失败返回 false 并说明原因。
   */
  const insertFreezeFrame = useCallback(
    (id: string, at: number, image: { name: string; url: string; durationSec?: number }): boolean => {
      const before = clipsRef.current;
      const src = before.find((c) => c.id === id);
      if (!docRef.current || !src || src.locked || src.track !== 'video') return false;
      const fpsNow = fpsRef.current;
      const cutAt = quantizeToFrame(at, fpsNow);
      const span = clipSpan(src);
      const offset = cutAt - src.timelineStart;
      if (offset <= 1 / fpsNow || offset >= span - 1 / fpsNow) {
        toast.info('播放头太靠近片段边缘，无法插入冻结帧');
        return false;
      }
      const speed = src.speed > 0 ? src.speed : 1;
      const sourceEnd = src.sourceDuration && src.sourceDuration > 0 ? src.sourceDuration : Number.POSITIVE_INFINITY;
      const cut = round3(quantizeToFrame(src.inPoint + offset * speed, fpsNow));
      if (cut >= sourceEnd - 1 / fpsNow) {
        toast.info('冻结点超出素材实际长度');
        return false;
      }
      const duration = round3(Math.max(1 / fpsNow, image.durationSec ?? 1));
      const srcEnd = src.timelineStart + span;
      const idx = before.findIndex((c) => c.id === id);
      const left: TimelineClip = { ...src, outPoint: cut };
      const imageClip: TimelineClip = {
        ...newClipIdentity('local-freeze'),
        projectId: projectId ?? '',
        track: 'video',
        sourceShotId: null,
        sourceUrl: image.url,
        inPoint: 0,
        outPoint: duration,
        // 图片没有真实时长，这里只是右边缘可拉长的上限（素材池图片同规则）
        sourceDuration: 10,
        timelineStart: round3(cutAt),
        lane: src.lane ?? 0,
        speed: 1,
        volume: 1,
        transition: { type: 'none', duration: 0 },
        text: image.name.slice(0, 120),
        locked: false,
        sortOrder: src.sortOrder + 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      const right: TimelineClip = {
        ...src,
        ...newClipIdentity('local-split'),
        inPoint: cut,
        timelineStart: round3(cutAt + duration),
        sortOrder: src.sortOrder + 2,
      };
      // 切点之后（不含被切的两半）的同轨片段整体后移一个冻结帧时长
      const shifted = before.map((c) =>
        c.id !== id &&
        c.track === src.track &&
        (c.lane ?? 0) === (src.lane ?? 0) &&
        c.timelineStart >= srcEnd - 1e-6
          ? { ...c, timelineStart: round3(Math.max(0, c.timelineStart + duration)) }
          : c,
      );
      const next = [...shifted.slice(0, idx), left, imageClip, right, ...shifted.slice(idx + 1)];
      commit(next, '插入冻结帧', before);
      setSelection([imageClip.id]);
      return true;
    },
    [commit, projectId, setSelection],
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
    (at: number, lane = 0, text = '新字幕', textStyle?: TimelineClip['textStyle'], durationSec = 3): string | null => {
      const before = clipsRef.current;
      if (!docRef.current) return null;
      const duration = Math.max(0.2, durationSec);
      const startAt = quantizeToFrame(Math.max(0, at), fpsRef.current);
      let targetLane = lane;
      // 同一时刻已有字幕时不覆盖，自动向上找空 lane；字幕/贴纸可以同时叠多层
      for (let i = 0; i < 24; i += 1) {
        const occupied = before.some(
          (c) =>
            c.track === 'subtitle' &&
            (c.lane ?? 0) === targetLane &&
            startAt < c.timelineStart + (c.outPoint - c.inPoint) / Math.max(0.01, c.speed || 1) &&
            startAt + duration > c.timelineStart,
        );
        if (!occupied) break;
        targetLane += 1;
      }
      const clip: TimelineClip = {
        ...newClipIdentity('local-sub'),
        projectId: projectId ?? '',
        track: 'subtitle',
        sourceShotId: null,
        sourceUrl: null,
        inPoint: 0,
        outPoint: duration,
        sourceDuration: duration,
        timelineStart: startAt,
        lane: targetLane,
        speed: 1,
        volume: 1,
        transition: { type: 'none', duration: 0 },
        text,
        ...(textStyle ? { textStyle } : {}),
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
        /** 探测到源视频自带音轨：同一份源自动生成一条原声轨 */
        hasAudio?: boolean;
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
      const startAt = quantizeToFrame(Math.max(0, at), fpsRef.current);
      const videoIdentity = newClipIdentity('local-video');
      const clip: TimelineClip = {
        ...videoIdentity,
        projectId: projectId ?? '',
        track: 'video',
        sourceShotId: asset.shotId ?? null,
        sourceUrl: asset.url,
        inPoint: 0,
        outPoint: duration,
        sourceDuration: duration,
        timelineStart: startAt,
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
      let next: TimelineClip[] = [...before, clip];
      // 源视频自带音轨：建一条「内嵌原声」音频片段。它参与导出，但默认不单独占一行，
      // 波形直接画在画面片段下半部；点音画分离后才升为并排 A 轨。
      if (asset.hasAudio === true) {
        const audioIdentity = newClipIdentity('local-audio');
        const audioClip: TimelineClip = {
          ...audioIdentity,
          projectId: projectId ?? '',
          track: 'audio',
          sourceShotId: asset.shotId ?? null,
          sourceUrl: asset.url,
          inPoint: 0,
          outPoint: duration,
          sourceDuration: duration,
          timelineStart: startAt,
          lane,
          speed: 1,
          volume: 1,
          text: `♪ 原声 · ${asset.name}`.slice(0, 120),
          bindGroup: `auto:${clip.id}`,
          locked: false,
          sortOrder: before.length + 1,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        next = [...next, audioClip];
      }
      commit(next, '拖入画面', before);
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
      const sameAudio = before.find((c) => c.track === 'audio' && sameOrigin(c, src, fpsRef.current));
      if (sameAudio) {
        // 内嵌原声升为独立并排 A 轨；已经分离过的保持原状。
        if (!sameAudio.bindGroup?.startsWith('auto:')) return null;
        const preferredLane = src.lane ?? 0;
        const next = before.map((c) =>
          c.id === sameAudio.id
            ? {
                ...c,
                lane: preferredLane,
                bindGroup: `av:${src.clientKey ?? src.id}`,
                updatedAt: new Date().toISOString(),
              }
            : c,
        );
        commit(next, '音画分离', before);
        return sameAudio.id;
      }
      const occupied = before
        .filter((c) => c.track === 'audio')
        .map((c) => ({ lane: c.lane ?? 0, start: c.timelineStart, end: c.timelineStart + clipSpan(c) }));
      // 分离出的原声优先占用源画面自己的 lane：这样它天生和画面并排，
      // 不会被塞进 A1 后跟一整排无关音频混在一起。只有该 lane 已有重叠音频时才另找空道。
      const preferred = Math.max(0, src.lane ?? 0);
      const overlap = occupied.some(
        (o) => o.lane === preferred && src.timelineStart < o.end && src.timelineStart + clipSpan(src) > o.start,
      );
      const { lane } = overlap
        ? pickFreeLane(occupied, 0, src.timelineStart, src.timelineStart + clipSpan(src))
        : { lane: preferred };
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
        sourceDuration: src.sourceDuration ?? src.outPoint,
        locked: false,
        // 同一 av: 组 = 画面和它分离出的原声绑定；行渲染据此并排，拖动也保持同步。
        bindGroup: `av:${src.clientKey ?? src.id}`,
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
      // 合并只把音频收回画面轨内显示，不删除音频：导出仍需要它来出声，
      // 以后再次「音画分离」还能原地升回并排 A 轨。
      const ids = new Set(victims.map((v) => v.id));
      const group = `auto:${src.clientKey ?? src.id}`;
      commit(
        before.map((c) =>
          ids.has(c.id)
            ? { ...c, bindGroup: group, updatedAt: new Date().toISOString() }
            : c,
        ),
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

  const setClipSpeedCurve = useCallback(
    (id: string, speeds: number[]): boolean => {
      const before = clipsRef.current;
      const src = before.find((c) => c.id === id);
      if (!src || src.locked || src.track !== 'video' || !src.sourceUrl) return false;
      const list = speeds
        .map((v) => Math.round(clamp(v, 0.25, 4) * 100) / 100)
        .filter((v) => Number.isFinite(v));
      if (list.length < 2) return false;
      const srcDur = Math.max(0.1, src.outPoint - src.inPoint);
      const slice = srcDur / list.length;
      const oldSpan = clipSpan(src);
      const end = src.timelineStart + oldSpan;
      const pieces: TimelineClip[] = [];
      let cursor = src.timelineStart;
      for (let i = 0; i < list.length; i += 1) {
        const inPoint = round3(src.inPoint + slice * i);
        const outPoint = i === list.length - 1 ? src.outPoint : round3(src.inPoint + slice * (i + 1));
        const span = Math.max(MIN_SPAN, (outPoint - inPoint) / list[i]);
        const identity = newClipIdentity('clip');
        pieces.push({
          ...src,
          ...identity,
          inPoint,
          outPoint,
          speed: list[i],
          timelineStart: round3(cursor),
          // 分段后每段可见时间重新计时，旧关键帧不再成立
          keyframes: null,
          transition: i === list.length - 1 ? src.transition : null,
          bindGroup: null,
        });
        cursor += span;
      }
      const delta = cursor - end;
      const next = before
        .filter((c) => c.id !== id)
        .map((c) => {
          if (
            c.track === src.track &&
            (c.lane ?? 0) === (src.lane ?? 0) &&
            c.timelineStart >= end - 1e-6
          ) {
            return { ...c, timelineStart: round3(Math.max(0, c.timelineStart + delta)) };
          }
          return c;
        })
        .concat(pieces);
      commit(next, `曲线变速 ${list.length} 段`, before);
      return true;
    },
    [commit],
  );

  const createCompound = useCallback(
    (ids: string[]): string | null => {
      const before = clipsRef.current;
      const picked = before.filter(
        (c) => ids.includes(c.id) && c.track === 'video' && c.sourceUrl && !c.compound && !c.locked,
      );
      if (picked.length < 2) return null;
      const lane = picked[0].lane ?? 0;
      if (picked.some((c) => (c.lane ?? 0) !== lane)) return null;
      const order = [...picked].sort((a, b) => a.timelineStart - b.timelineStart);
      for (let i = 1; i < order.length; i += 1) {
        const prevEnd = order[i - 1].timelineStart + clipSpan(order[i - 1]);
        if (order[i].timelineStart - prevEnd > 1e-3) return null;
      }
      const start = order[0].timelineStart;
      const end = Math.max(...order.map((c) => c.timelineStart + clipSpan(c)));
      const children = order.map((c) => ({
        key: localId('cc'),
        sourceUrl: c.sourceUrl as string,
        sourceShotId: c.sourceShotId ?? null,
        text: c.text ?? null,
        inPoint: c.inPoint,
        outPoint: c.outPoint,
        offset: round3(c.timelineStart - start),
        speed: c.speed,
        volume: c.volume,
        reverse: Boolean(c.reverse),
        keyframes: c.keyframes ?? null,
        transition: c.transition ?? null,
        enabled: c.enabled !== false,
      }));
      const identity = newClipIdentity('clip');
      const parent: TimelineClip = {
        ...order[0],
        ...identity,
        timelineStart: start,
        inPoint: 0,
        outPoint: round3(end - start),
        speed: 1,
        reverse: false,
        keyframes: null,
        transition: order[order.length - 1].transition ?? null,
        compound: { children },
        bindGroup: null,
        locked: false,
      };
      const next = before.filter((c) => !ids.includes(c.id)).concat(parent);
      commit(next, `新建复合片段（${children.length} 段）`, before);
      setSelection([parent.id]);
      return parent.id;
    },
    [commit, setSelection],
  );

  const ungroupCompound = useCallback(
    (id: string): string[] => {
      const before = clipsRef.current;
      const parent = before.find((c) => c.id === id);
      if (!parent?.compound?.children?.length) return [];
      const expanded = expandCompoundClip(parent).map((c) => ({
        ...c,
        ...newClipIdentity('clip'),
        sortOrder: parent.sortOrder,
      }));
      const next = before.filter((c) => c.id !== id).concat(expanded);
      commit(next, '解除复合片段', before);
      setSelection(expanded.map((c) => c.id));
      return expanded.map((c) => c.id);
    },
    [commit, setSelection],
  );

  const toggleClipReverse = useCallback(
    (id: string) => {
      const before = clipsRef.current;
      const src = before.find((c) => c.id === id);
      if (!src || src.locked) return;
      const next = Boolean(!src.reverse);
      commit(
        before.map((c) => (c.id === id ? { ...c, reverse: next } : c)),
        next ? '设置倒放' : '取消倒放',
        before,
      );
    },
    [commit],
  );

  const setClipVolume = useCallback(
    (id: string, volume: number) => {
      const before = clipsRef.current;
      const src = before.find((c) => c.id === id);
      if (!src) return;
      const v = clamp(volume, 0, 2);
      // 画面内置原声：视频片段的音量线必须同步到 auto: 音频，否则 UI 改了、导出还是旧音量。
      const autoIds = src.track === 'video'
        ? before
            .filter((c) => c.track === 'audio' && c.bindGroup === `auto:${src.id}`)
            .map((c) => c.id)
        : [];
      const ids = new Set([id, ...autoIds]);
      const changed = before.some((c) => ids.has(c.id) && Math.abs(v - c.volume) >= 1e-3);
      if (!changed) return;
      commit(
        before.map((c) => (ids.has(c.id) ? { ...c, volume: v } : c)),
        '调整音量',
        before,
      );
    },
    [commit],
  );

  /**
   * 音量包络（G12）：包络编辑与 volume 直线共用「同一份声音只改一处」的规则——
   * 画面片段与其 auto: 内嵌音频互相镜像（导出走 auto 音频、预览走画面静音），
   * 所以在画面上画的包络必须同步写进 auto 音频，反之亦然。
   * 点位帧量化 + 升序去重由 normalizeVolumePoints 收口；少于 2 点视为清除。
   */
  const setClipVolumeAutomation = useCallback(
    (id: string, points: TimelineVolumePoint[]) => {
      const before = clipsRef.current;
      const src = before.find((c) => c.id === id);
      if (!src || src.locked) return;
      const span = clipSpan(src);
      const nextPoints = normalizeVolumePoints(points, span, fpsRef.current);
      const nextAutomation = nextPoints.length >= 2 ? { points: nextPoints } : null;
      const ids = volumeSyncIds(before, src);
      const changed = before.some((c) => {
        if (!ids.has(c.id)) return false;
        const cur = c.volumeAutomation?.points ?? null;
        const next = nextAutomation?.points ?? null;
        return JSON.stringify(cur) !== JSON.stringify(next);
      });
      if (!changed) return;
      commit(
        before.map((c) => (ids.has(c.id) ? { ...c, volumeAutomation: nextAutomation } : c)),
        nextAutomation ? '调整音量包络' : '清除音量包络',
        before,
      );
    },
    [commit],
  );

  const clearClipVolumeAutomation = useCallback(
    (id: string) => {
      setClipVolumeAutomation(id, []);
    },
    [setClipVolumeAutomation],
  );

  /**
   * 淡入淡出（G11）：帧量化 + 夹紧（各自 0–片段时长，相加不超时长）。
   * 未传入的一侧保持现值并优先让位；双侧同时超长时等比例收缩。
   * 镜像范围与音量包络同规则（画面 ↔ auto: 内嵌音频共用同一份声音）；
   * 拖拽把手 / 检查器输入 / 导出 afade·fade 滤镜读同一份数据。0 = 清除该侧淡变。
   */
  const setClipFades = useCallback(
    (id: string, fades: { fadeIn?: number; fadeOut?: number }) => {
      const before = clipsRef.current;
      const src = before.find((c) => c.id === id);
      if (!src || src.locked) return;
      const span = clipSpan(src);
      if (!(span > 0)) return;
      const fps = Math.max(1, fpsRef.current);
      const inReq = Math.max(0, fades.fadeIn ?? (src.fadeIn ?? 0));
      const outReq = Math.max(0, fades.fadeOut ?? (src.fadeOut ?? 0));
      let fadeIn = quantizeToFrame(Math.min(inReq, span), fps);
      let fadeOut = quantizeToFrame(Math.min(outReq, span), fps);
      if (fadeIn + fadeOut > span) {
        const over = fadeIn + fadeOut - span;
        if (fades.fadeIn === undefined) {
          fadeIn = Math.max(0, floorToFrame(fadeIn - over, fps));
        } else if (fades.fadeOut === undefined) {
          fadeOut = Math.max(0, floorToFrame(fadeOut - over, fps));
        } else {
          const k = span / (fadeIn + fadeOut);
          fadeIn = floorToFrame(fadeIn * k, fps);
          fadeOut = Math.max(0, quantizeToFrame(Math.min(fadeOut * k, span - fadeIn), fps));
        }
      }
      const ids = volumeSyncIds(before, src);
      const changed = before.some((c) => {
        if (!ids.has(c.id)) return false;
        return Math.abs(fadeIn - (c.fadeIn ?? 0)) >= 1 / (2 * fps) || Math.abs(fadeOut - (c.fadeOut ?? 0)) >= 1 / (2 * fps);
      });
      if (!changed) return;
      commit(
        before.map((c) =>
          ids.has(c.id)
            ? {
                ...c,
                fadeIn: fadeIn > 0 ? fadeIn : undefined,
                fadeOut: fadeOut > 0 ? fadeOut : undefined,
              }
            : c,
        ),
        fadeIn > 0 || fadeOut > 0 ? '设置淡入淡出' : '清除淡入淡出',
        before,
      );
    },
    [commit],
  );

  const applyDuckUnderVoice = useCallback(
    (id: string) => {
      const before = clipsRef.current;
      const src = before.find((c) => c.id === id);
      if (!src || src.locked) return false;
      const regions = collectVoiceRegions(before, id);
      const points = buildDuckEnvelope({
        clipStart: src.timelineStart,
        span: clipSpan(src),
        voiceRegions: regions,
        fps: fpsRef.current,
      });
      if (!points) return false;
      commit(
        before.map((c) =>
          c.id === id
            ? { ...c, volumeAutomation: { points }, duckUnderVoice: true }
            : c,
        ),
        '人声避让',
        before,
      );
      return true;
    },
    [commit],
  );

  /**
   * 音频效果链（FX rack）：客户端先归一化一次（非法类型剔除、参数夹紧、上限截断），
   * 服务端落库前还会防御一遍。镜像范围与音量包络同规则（画面 ↔ auto: 内嵌音频）：
   * 导出的 auto 音频 part 读 auto: 片段，预览响的也是它，画面上挂的 FX 必须
   * 同步过去才听得到、导得出。null/空数组 = 清除整条链。
   */
  const setClipAudioFx = useCallback(
    (id: string, nodes: TimelineClipAudioFxNode[] | null) => {
      const before = clipsRef.current;
      const src = before.find((c) => c.id === id);
      if (!src || src.locked) return;
      const clean = normalizeAudioFxNodes(nodes);
      const nextFx = clean ? { nodes: clean } : null;
      const ids = volumeSyncIds(before, src);
      const changed = before.some((c) => {
        if (!ids.has(c.id)) return false;
        return JSON.stringify(c.audioFx ?? null) !== JSON.stringify(nextFx);
      });
      if (!changed) return;
      commit(
        before.map((c) => (ids.has(c.id) ? { ...c, audioFx: nextFx } : c)),
        nextFx ? '调整音频效果' : '清除音频效果',
        before,
      );
    },
    [commit],
  );

  const setClipPitch = useCallback(
    (id: string, pitch: number) => {
      const before = clipsRef.current;
      const src = before.find((c) => c.id === id);
      if (!src || src.locked) return;
      const p = clamp(pitch, 0.5, 2);
      if (Math.abs(p - (src.pitch ?? 1)) < 1e-3) return;
      commit(
        before.map((c) => (c.id === id ? { ...c, pitch: p } : c)),
        '调整音高',
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

  const setClipKeyframes = useCallback(
    (id: string, keyframes: TimelineClip['keyframes']) => {
      const before = clipsRef.current;
      const src = before.find((c) => c.id === id);
      if (!src || src.locked) return;
      const nextFrames = keyframes && keyframes.length > 0 ? keyframes : null;
      commit(
        before.map((c) => (c.id === id ? { ...c, keyframes: nextFrames } : c)),
        nextFrames ? '调整运镜关键帧' : '清除运镜关键帧',
        before,
      );
    },
    [commit],
  );

  const setClipVisual = useCallback(
    (id: string, visual: TimelineClip['visual']) => {
      const before = clipsRef.current;
      const src = before.find((c) => c.id === id);
      if (!src || src.locked) return;
      commit(
        before.map((c) => (c.id === id ? { ...c, visual: visual ? { ...(c.visual ?? {}), ...visual } : null } : c)),
        '调整视觉增强',
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
      if (!src || src.locked || lane < 0) return;
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
    rippleTrimAt,
    trimClipToPlayhead,
    closeGap,
    closeAllGaps,
    splitClip,
    splitManyAt,
    splitAtPlayhead,
    insertFreezeFrame,
    editSubtitle,
    addSubtitle,
    addAudio,
    addVideo,
    detachAudio,
    attachAudio,
    packVideo,
    setClipSpeed,
    setClipSpeedCurve,
    toggleClipReverse,
    createCompound,
    ungroupCompound,
    setClipVolume,
    setClipVolumeAutomation,
    clearClipVolumeAutomation,
    setClipFades,
    applyDuckUnderVoice,
    setClipAudioFx,
    setClipPitch,
    setClipTransition,
    setClipLocked,
    setClipEnabled,
    bindSelection,
    unbindSelection,
    updateTextStyle,
    setClipText,
    setClipKeyframes,
    setClipVisual,
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
