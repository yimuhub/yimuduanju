/**
 * Studio · 多轨线性剪辑时间线（生产级）
 * -------------------------------------------------------------
 * 数据真源 = GET /timeline 的 EDL；所有编辑走 useEdlEditor。
 *
 * 这一版解决的核心体验问题：
 *   · 看得见：视频片段显示帧带、音频片段显示波形（服务端生成 + 缓存）；
 *   · 剪得准：拖动/修剪/分割全部落帧，实时磁吸并画吸附线，时间码可点击输入；
 *   · 剪得快：波纹删除、多选、框选、复制/粘贴、标记点、统一快捷键面板；
 *   · 管得住：轨道可重命名、静音、独奏、锁定、调高，片段可变速/音量/锁定；
 *   · 稳得住：乐观锁冲突提示、撤销持久化、视口虚拟化、事件委托拖拽。
 *
 * 交互：
 *   · 标尺/空白拖动 = scrub；Shift + 空白拖动 = 框选
 *   · 片段拖动 = 移动；拖到同类型其它轨 = 换 lane；左右把手 = 修剪
 *   · Shift + 点击 = 加选；⌘A = 全选；⌘C / ⌘X / ⌘V = 复制 / 剪切 / 粘贴
 *   · Delete = 波纹删除；Shift+Delete = 删除留空隙；S = 分割；M = 标记
 *   · , / . = 前后一帧（Shift = 10 帧）；? = 快捷键面板
 */
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  AlignJustify,
  AudioLines,
  ChevronDown,
  ChevronUp,
  ClipboardPaste,
  Clapperboard,
  Copy,
  Film,
  Flag,
  Gauge,
  Keyboard,
  Layers,
  Link2,
  Link2Off,
  Lock,
  Magnet,
  Minus,
  Music2,
  Plus,
  PlusCircle,
  Redo2,
  RotateCcw,
  Scissors,
  Trash2,
  Type,
  Undo2,
  Unlock,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { useStudio } from './StudioShell';
import { clipSpan, sameOrigin, shotLabel } from './model';
import { useEdlEditor } from './useEdlEditor';
import { Filmstrip, useThumbnails, useWaveform, Waveform } from './timeline-media';
import { exportTimeline } from '@client/src/api/timeline';
import { listProjectAssets, mediaUrl } from '@client/src/api/assets';
import {
  clamp,
  collectSnapTargets,
  formatTimecode,
  parseTimecode,
  quantizeToFrame,
  ROW_HEIGHT_DEFAULT,
  ROW_HEIGHT_MAX,
  ROW_HEIGHT_MIN,
  round3,
  SNAP_PX,
  snapClipStart,
  snapPoint,
} from '@client/src/lib/timeline-frame';
import { laneFromY, pickFreeLane } from '@client/src/lib/timeline-drop';
import {
  clearTimelineDrag,
  mediaOfDrag,
  peekTimelineDrag,
  readTimelineDrag,
  startTimelineDrag,
  trackOfDrag,
  type TimelineDragPayload,
} from '@client/src/lib/timeline-dnd';
import { resolveTextStyle } from '@shared/api.interface';
import type {
  Asset,
  TimelineClip,
  TimelineTextStyle,
  TimelineTrackMeta,
} from '@shared/api.interface';

/** 字幕可选字体。value 是稳定键（落库用），label 是界面显示名 */
const TEXT_FONTS: { value: string; label: string }[] = [
  { value: 'source-han-sans', label: '思源黑体' },
  { value: 'pingfang', label: '苹方' },
  { value: 'songti', label: '宋体' },
  { value: 'kaiti', label: '楷体' },
  { value: 'mono', label: '等宽' },
];

/** 字幕纵向位置预设（归一化 y） */
const TEXT_POSITIONS: { value: number; label: string }[] = [
  { value: 0.12, label: '顶部' },
  { value: 0.5, label: '居中' },
  { value: 0.86, label: '底部' },
];

const PX_MIN = 6;
const PX_MAX = 160;
const PX_DEFAULT = 17;

/**
 * 缩放滑块的刻度映射：线性滑块在 6–160 px/s 上会把 90% 行程都花在高倍率，
 * 低倍率（看整体节奏）几乎调不出来。用对数映射，100% 落在 PX_DEFAULT 附近手感最接近剪映。
 */
const ZOOM_LOG = Math.log(PX_MAX / PX_MIN);
const clampR = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const zoomToSlider = (px: number): number =>
  Math.round((Math.log(clampR(px, PX_MIN, PX_MAX) / PX_MIN) / ZOOM_LOG) * 100);
const sliderToZoom = (v: number): number => PX_MIN * Math.exp((clampR(v, 0, 100) / 100) * ZOOM_LOG);

const LABEL_W = 148;

type RowTrack = TimelineClip['track'];

interface Row {
  key: string;
  track: RowTrack;
  lane: number;
  code: string;
  baseTitle: string;
  name: string;
  color: string;
  muted: boolean;
  solo: boolean;
  locked: boolean;
  height: number;
}

const audioLaneTitle = (lane: number) =>
  lane === 0 ? '对白' : lane === 1 ? '配乐' : lane === 2 ? '音效' : `音轨${lane + 1}`;

const makeRow = (track: RowTrack, lane: number, meta?: TimelineTrackMeta): Row => {
  const key = `${track}:${lane}`;
  let code = 'O';
  let baseTitle = '叠加';
  let color = '#7A5B3E';
  if (track === 'subtitle') {
    code = `S${lane + 1}`;
    baseTitle = lane === 0 ? '字幕' : `字幕${lane + 1}`;
    color = '#5A4E78';
  } else if (track === 'audio') {
    code = `A${lane + 1}`;
    baseTitle = audioLaneTitle(lane);
    color = '#3E6B4C';
  } else if (track === 'video') {
    code = `V${lane + 1}`;
    baseTitle = lane === 0 ? '画面' : `画面${lane + 1}`;
    color = '#3F5C73';
  }
  return {
    key,
    track,
    lane,
    code,
    baseTitle,
    name: (meta?.name ?? '').trim() || baseTitle,
    color,
    muted: meta?.muted === true,
    solo: meta?.solo === true,
    locked: meta?.locked === true,
    height: clamp(meta?.height ?? ROW_HEIGHT_DEFAULT[track], ROW_HEIGHT_MIN, ROW_HEIGHT_MAX),
  };
};

interface DragState {
  mode: 'move' | 'trim-left' | 'trim-right' | 'marquee';
  pointerId: number;
  startX: number;
  startY: number;
  moved: boolean;
  clipId?: string;
  clipIds?: string[];
  el?: HTMLElement;
  els?: HTMLElement[];
  origById?: Map<string, TimelineClip>;
  anchorStart?: number;
  totalSpan?: number;
  origLane?: number;
  origSpan?: number;
  edge?: 'left' | 'right';
  delta?: number;
  deltaLane?: number;
  marqueeRect?: { x: number; y: number; w: number; h: number };
}

/* ------------------------- 单片段视图（独立请求缩略图/波形） ------------------------- */

const ClipView = ({
  clip,
  pxPerSec,
  selected,
  rowLocked,
  projectId,
  label,
  tip,
  onDoubleClick,
  onDelete,
  rowHeight,
  audioDetached,
}: {
  clip: TimelineClip;
  pxPerSec: number;
  /** 行高：缩略图按它算格子尺寸，行高变大图才不会被裁成一条线 */
  rowHeight: number;
  selected: boolean;
  rowLocked: boolean;
  projectId?: string;
  label: string;
  tip: string;
  /** 该画面的原声已被分离成独立音频片段：波形压暗，提示「这里不再出声」 */
  audioDetached?: boolean;
  onDoubleClick: () => void;
  onDelete: () => void;
}) => {
  const span = clipSpan(clip);
  const isVideo = clip.track === 'video';
  const isAudio = clip.track === 'audio';
  const thumb = useThumbnails(projectId, isVideo ? clip.sourceUrl : null);
  const wave = useWaveform(
    projectId,
    isAudio || isVideo ? clip.sourceUrl : null,
  );
  const isSub = clip.track === 'subtitle';
  const ts = resolveTextStyle(clip.textStyle ?? null);

  const cls = [
    'clip',
    clip.track === 'subtitle' ? 'v2' : isAudio ? 'a' : clip.sourceUrl ? 'v' : 'pending',
    selected ? 'on' : '',
    clip.locked || rowLocked ? 'locked' : '',
    audioDetached ? 'audio-off' : '',
    thumb || wave ? 'has-media' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      data-clip-id={clip.id}
      className={cls}
      style={{
        left: `${clip.timelineStart * pxPerSec}px`,
        width: `${Math.max(6, span * pxPerSec)}px`,
        cursor: clip.locked || rowLocked ? 'not-allowed' : undefined,
      }}
      role="button"
      tabIndex={0}
      aria-label={tip}
      title={tip}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onDoubleClick();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') e.preventDefault();
      }}
    >
      {isVideo ? (
        <Filmstrip
          thumb={thumb}
          span={span}
          inPoint={clip.inPoint}
          outPoint={clip.outPoint}
          pxPerSec={pxPerSec}
          rowHeight={rowHeight}
        />
      ) : null}
      {isAudio ? (
        <Waveform
          wave={wave}
          span={span}
          inPoint={clip.inPoint}
          outPoint={clip.outPoint}
          pxPerSec={pxPerSec}
        />
      ) : null}
      {isVideo && wave ? (
        <div className="tl-clip-wave" aria-hidden>
          <Waveform
            wave={wave}
            span={span}
            inPoint={clip.inPoint}
            outPoint={clip.outPoint}
            pxPerSec={pxPerSec}
          />
          {audioDetached ? (
            <i className="tl-clip-mute" title="原声已分离成下面那条音频片段">
              <VolumeX size={8} />
            </i>
          ) : null}
        </div>
      ) : null}
      <span
        className="tl-clip-label"
        style={
          isSub
            ? {
                color: ts.color,
                fontWeight: ts.bold ? 700 : 400,
                fontStyle: ts.italic ? 'italic' : undefined,
              }
            : undefined
        }
      >
        {label.slice(0, 26)}
      </span>
      {clip.bindGroup ? (
        <i className="tl-clip-link" title="已绑定：拖动时同组片段一起移动">
          <Link2 size={9} />
        </i>
      ) : null}
      <i className="tl-handle l" data-edge="left" title="修剪入点" />
      <i className="tl-handle r" data-edge="right" title="修剪出点" />
      <button
        type="button"
        className="tl-clip-del"
        title="删除片段"
        aria-label="删除片段"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
      >
        <X size={9} strokeWidth={2.8} />
      </button>
    </div>
  );
};

/* ------------------------- 主组件 ------------------------- */

export const StudioTimeline = () => {
  const {
    data,
    projectId,
    sel,
    setSel,
    curT,
    setCurT,
    playing,
    setPlaying,
    tlCollapsed,
    setTlCollapsed,
    toggleTlCollapsed,
    setDockTab,
  } = useStudio();
  const shots = data.shots;
  const clips = useMemo(() => data.timeline?.clips ?? [], [data.timeline]);
  const collapsed = tlCollapsed;
  const editor = useEdlEditor();
  const navigate = useNavigate();

  /**
   * 打开某一镜的「详细分镜编辑」（右坞分镜 Tab 的全屏聚焦编辑器）。
   * 时间线是剪辑视角、分镜详情是单镜创作视角，两边必须能一键来回：
   *   · 双击画面片段 / 属性条「分镜详情」/ 镜头条右键 —— 都走这里；
   *   · 定位信息写进 URL（?shot=&edit=1），刷新或分享也能落回同一镜。
   */
  const openShotDetail = useCallback(
    (shotId: string) => {
      const idx = shots.findIndex((s) => s.id === shotId);
      if (idx >= 0) setSel(idx);
      setDockTab('board', { shot: shotId, edit: '1', d: String(Date.now()) });
    },
    [shots, setSel, setDockTab],
  );

  const [focused, setFocused] = useState(false);
  const focusTimer = useRef<number | null>(null);
  useEffect(() => {
    const onFocus = () => {
      setFocused(true);
      if (focusTimer.current) window.clearTimeout(focusTimer.current);
      focusTimer.current = window.setTimeout(() => setFocused(false), 2200);
    };
    window.addEventListener('yimu:timeline-focus', onFocus);
    return () => {
      window.removeEventListener('yimu:timeline-focus', onFocus);
      if (focusTimer.current) window.clearTimeout(focusTimer.current);
    };
  }, []);

  const [pxPerSec, setPxPerSec] = useState(PX_DEFAULT);
  const [subEdit, setSubEdit] = useState<{ id: string; text: string } | null>(null);
  const [exporting, setExporting] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickLane, setPickLane] = useState(1);
  const [audioAssets, setAudioAssets] = useState<Asset[]>([]);
  const [loadingAssets, setLoadingAssets] = useState(false);
  const [tcEdit, setTcEdit] = useState<string | null>(null);
  const [snapLine, setSnapLine] = useState<number | null>(null);
  const [marquee, setMarquee] = useState<{
    x: number;
    y: number;
    w: number;
    h: number;
  } | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [renamingRow, setRenamingRow] = useState<string | null>(null);
  const [rowNameDraft, setRowNameDraft] = useState('');
  const [viewport, setViewport] = useState({ start: 0, end: Number.POSITIVE_INFINITY });

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const pxRef = useRef(pxPerSec);
  pxRef.current = pxPerSec;

  const clipsRef = useRef(clips);
  clipsRef.current = clips;
  const curTRef = useRef(curT);
  curTRef.current = curT;
  const editorRef = useRef(editor);
  editorRef.current = editor;
  const collapsedRef = useRef(collapsed);
  collapsedRef.current = collapsed;
  const selectedRef = useRef(editor.selectedIds);
  selectedRef.current = editor.selectedIds;
  const fps = editor.fps;

  const shotMap = useMemo(() => new Map(shots.map((s) => [s.id, s])), [shots]);
  const selShot = shots[sel];

  const jumpToShot = (i: number) => {
    const shot = shots[i];
    if (!shot) return;
    setSel(i);
    const clip = clips.find((c) => c.track === 'video' && c.sourceShotId === shot.id);
    if (clip) editor.setSelection([clip.id]);
    const el = scrollRef.current;
    if (clip && el) {
      const x = clip.timelineStart * pxPerSec;
      if (x < el.scrollLeft || x > el.scrollLeft + el.clientWidth - 80) {
        el.scrollLeft = Math.max(0, x - 80);
      }
    }
  };

  const total = useMemo(() => {
    let end = 0;
    for (const c of clips) end = Math.max(end, c.timelineStart + clipSpan(c));
    return end > 0 ? end : Math.max(0.5, data.totalSec);
  }, [clips, data.totalSec]);
  const totalRef = useRef(total);
  totalRef.current = total;

  /* ------------------------- 轨道行 ------------------------- */

  const rowMetaMap = useMemo(() => {
    const map = new Map<string, TimelineTrackMeta>();
    for (const t of editor.tracks) map.set(`${t.track}:${t.lane ?? 0}`, t);
    return map;
  }, [editor.tracks]);

  const rows = useMemo(() => {
    const map = new Map<string, Row>();
    const ensure = (track: RowTrack, lane: number) => {
      const key = `${track}:${lane}`;
      if (!map.has(key)) map.set(key, makeRow(track, lane, rowMetaMap.get(key)));
    };
    ensure('subtitle', 0);
    ensure('video', 0);
    ensure('audio', 0);
    ensure('audio', 1);
    for (const c of clips) ensure(c.track, c.lane ?? 0);
    for (const t of editor.tracks) ensure(t.track, t.lane ?? 0);
    const order: RowTrack[] = ['subtitle', 'video', 'audio', 'overlay'];
    return [...map.values()].sort(
      (a, b) => order.indexOf(a.track) - order.indexOf(b.track) || a.lane - b.lane,
    );
  }, [clips, editor.tracks, rowMetaMap]);

  const rowByKey = useMemo(() => new Map(rows.map((r) => [r.key, r])), [rows]);

  const clipsByRow = useMemo(() => {
    const map = new Map<string, TimelineClip[]>();
    for (const c of clips) {
      const key = `${c.track}:${c.lane ?? 0}`;
      const list = map.get(key);
      if (list) list.push(c);
      else map.set(key, [c]);
    }
    for (const list of map.values()) list.sort((a, b) => a.timelineStart - b.timelineStart);
    return map;
  }, [clips]);

  const maxLane = (track: RowTrack) =>
    [...clips, ...editor.tracks]
      .filter((c) => c.track === track)
      .reduce((m, c) => Math.max(m, c.lane ?? 0), 0);

  /* ------------------------- 拖放：素材 → 时间线 -------------------------
   * 剪映的核心手感：拖上去就落，落不下就自动开一条新轨。
   * 这里只做「坐标 → 落点」的计算与提示，真正建片段交给 useEdlEditor。
   * ------------------------------------------------------------------- */
  const [dropHint, setDropHint] = useState<{
    t: number;
    lane: number;
    track: RowTrack;
    span: number;
    created: boolean;
  } | null>(null);

  /** 每行在画布里的纵向偏移（标尺 16px 之后），用于画落点高亮 */
  const rowTop = useMemo(() => {
    const map = new Map<string, number>();
    let acc = 16;
    for (const r of rows) {
      map.set(r.key, acc);
      acc += r.height;
    }
    return map;
  }, [rows]);

  const computeDrop = (e: DragEvent, payload: TimelineDragPayload) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const track = trackOfDrag(payload);
    const span = Math.max(
      0.2,
      payload.durationSeconds && payload.durationSeconds > 0 ? payload.durationSeconds : 5,
    );
    const t = quantizeToFrame(Math.max(0, (e.clientX - rect.left) / pxRef.current), fps);
    // 减掉 16px 标尺，再按行高命中轨道；落在空白区时 laneFromY 会给「最大 lane + 1」
    const wanted = laneFromY(rows, Math.max(0, e.clientY - rect.top - 16), track);
    const occupied = clips
      .filter((c) => c.track === track)
      .map((c) => ({
        lane: c.lane ?? 0,
        start: c.timelineStart,
        end: c.timelineStart + clipSpan(c),
      }));
    const pick = pickFreeLane(occupied, wanted, t, t + span);
    return { t, lane: pick.lane, track, span, created: pick.created };
  };

  const onTracksDragOver = (e: DragEvent) => {
    if (!peekTimelineDrag()) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    const d = computeDrop(e, peekTimelineDrag() as TimelineDragPayload);
    if (!d) return;
    setDropHint((prev) =>
      prev && prev.t === d.t && prev.lane === d.lane && prev.track === d.track ? prev : d,
    );
  };

  const onTracksDrop = (e: DragEvent) => {
    const payload = readTimelineDrag(e);
    if (!payload) return;
    e.preventDefault();
    const d = computeDrop(e, payload);
    setDropHint(null);
    clearTimelineDrag();
    if (!d) return;
    const url = mediaOfDrag(payload);
    if (!url) {
      toast.error('这条素材还没有可用的画面/声音', {
        description: payload.kind === 'shot' ? '先在前排生成该镜的成片或首帧' : '素材地址为空',
      });
      return;
    }
    const id =
      d.track === 'audio'
        ? editor.addAudio({ name: payload.name, url, durationSeconds: d.span }, d.t, d.lane)
        : editor.addVideo(
            { name: payload.name, url, durationSeconds: d.span, shotId: payload.shotId ?? null },
            d.t,
            d.lane,
          );
    if (!id) return;
    editor.setSelection([id]);
    toast.success(d.created ? `已新建轨道并放入「${payload.name}」` : `已放入「${payload.name}」`, {
      duration: 1800,
    });
  };

  // 时间线总高度：按各行真实行高求和
  useEffect(() => {
    const app = scrollRef.current?.closest('.app') as HTMLElement | null;
    if (!app) return undefined;
    if (collapsed) {
      app.style.removeProperty('--tl-h');
      return undefined;
    }
    const rowsH = rows.reduce((sum, r) => sum + r.height, 0);
    const propsH = editor.selectedIds.length > 0 ? 30 : 0;
    const h = clamp(32 + 18 + rowsH + propsH + 8 + 66, 300, 780);
    app.style.setProperty('--tl-h', `${h}px`);
    return () => {
      app.style.removeProperty('--tl-h');
    };
  }, [rows, collapsed, editor.selectedIds.length]);

  /* ------------------------- 刻度 / 缩放 ------------------------- */

  const ticks = useMemo(() => {
    const steps = [0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120];
    const stepSec = steps.find((s) => s * pxPerSec >= 56) ?? 120;
    const out: { x: number; major: boolean; label: string }[] = [];
    const count = Math.min(800, Math.ceil(total / stepSec) + 1);
    for (let i = 0; i <= count; i += 1) {
      const t = i * stepSec;
      out.push({
        x: t * pxPerSec,
        major: i % 5 === 0,
        label: formatTimecode(t, fps).slice(3, 8),
      });
    }
    return out;
  }, [total, pxPerSec, fps]);

  const zoomAnchor = useRef<{ t: number; offset: number } | null>(null);

  const applyZoom = (next: number, anchor?: { t: number; offset: number }) => {
    const p = clamp(next, PX_MIN, PX_MAX);
    if (p === pxPerSec) return;
    if (anchor) zoomAnchor.current = anchor;
    setPxPerSec(p);
  };

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const offset = e.clientX - rect.left;
      const t = (offset + el.scrollLeft) / pxRef.current;
      const next = clamp(pxRef.current * (e.deltaY < 0 ? 1.15 : 1 / 1.15), PX_MIN, PX_MAX);
      if (next !== pxRef.current) applyZoom(next, { t, offset });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    const a = zoomAnchor.current;
    if (!el || !a) return;
    zoomAnchor.current = null;
    el.scrollLeft = Math.max(0, a.t * pxPerSec - a.offset);
  }, [pxPerSec]);

  const fitZoom = () => {
    const el = scrollRef.current;
    if (!el || total <= 0) return;
    applyZoom((el.clientWidth - 24) / total);
    el.scrollLeft = 0;
  };

  // 视口虚拟化
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return undefined;
    let raf = 0;
    const update = () => {
      raf = 0;
      setViewport({
        start: el.scrollLeft / pxRef.current,
        end: (el.scrollLeft + el.clientWidth) / pxRef.current,
      });
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    el.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      el.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [pxPerSec]);

  useEffect(() => {
    if (!playing) return;
    const el = scrollRef.current;
    if (!el) return;
    const x = curT * pxRef.current;
    const viewW = el.clientWidth;
    if (x < el.scrollLeft + 40 || x > el.scrollLeft + viewW - 64) {
      el.scrollLeft = Math.max(0, x - viewW * 0.35);
    }
  }, [curT, playing]);

  /* ------------------------- scrub ------------------------- */

  const scrubFrom = (clientX: number) => {
    const el = scrollRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const t = (clientX - rect.left + el.scrollLeft) / pxRef.current;
    setCurT(clamp(quantizeToFrame(t, fps), 0, totalRef.current));
  };

  const beginScrub = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    setPlaying(false);
    scrubFrom(e.clientX);
    const move = (ev: PointerEvent) => scrubFrom(ev.clientX);
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  /* ------------------------- 拖动 / 修剪 / 框选 ------------------------- */

  const rowAt = useCallback((x: number, y: number) => {
    const el = document.elementFromPoint(x, y);
    const trk = el?.closest('.trk') as HTMLElement | null;
    if (!trk || !canvasRef.current?.contains(trk)) return null;
    return {
      key: trk.dataset.rowKey ?? '',
      track: trk.dataset.rowTrack as RowTrack,
      lane: Number(trk.dataset.rowLane ?? 0),
    };
  }, []);

  const snapTargetsFor = useCallback(
    (excludeIds: string[]) => {
      const exclude = new Set(excludeIds);
      return collectSnapTargets({
        clips: clipsRef.current
          .filter((c) => !exclude.has(c.id))
          .map((c) => ({
            id: c.id,
            start: c.timelineStart,
            end: c.timelineStart + clipSpan(c),
          })),
        playhead: curTRef.current,
        markers: editorRef.current.markers,
      });
    },
    [],
  );

  const onCanvasPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest('.tl-clip-del') || target.closest('.tl-sub-input')) return;

    const handle = target.closest('.tl-handle') as HTMLElement | null;
    const clipEl = target.closest('[data-clip-id]') as HTMLElement | null;

    if (handle && clipEl) {
      startTrim(e, clipEl, handle.dataset.edge === 'left' ? 'left' : 'right');
      return;
    }
    if (clipEl) {
      startMove(e, clipEl);
      return;
    }
    if (e.shiftKey) {
      startMarquee(e);
      return;
    }
    beginScrub(e);
  };

  const startMove = (e: React.PointerEvent, el: HTMLElement) => {
    e.preventDefault();
    const id = el.dataset.clipId ?? '';
    const src = clipsRef.current.find((c) => c.id === id);
    if (!src) return;
    const row = rowByKey.get(`${src.track}:${src.lane ?? 0}`);
    if (src.locked || row?.locked) {
      toast.info('该轨道或片段已锁定，先解锁再编辑', { duration: 1600 });
      return;
    }

    const additive = e.shiftKey;
    const current = selectedRef.current;
    let ids: string[];
    if (additive) {
      ids = current.includes(id) ? current.filter((v) => v !== id) : [...current, id];
      editor.setSelection(ids);
    } else if (current.includes(id) && current.length > 1) {
      ids = current;
    } else {
      ids = [id];
      editor.setSelection(ids);
    }
    if (src.track === 'video' && src.sourceShotId) {
      const i = shots.findIndex((s) => s.id === src.sourceShotId);
      if (i >= 0) setSel(i);
    }

    // 首次点击不拖动：只选择，不进入拖拽（避免误位移）
    if (additive) return;

    setPlaying(false);
    const origById = new Map<string, TimelineClip>();
    const els: HTMLElement[] = [];
    for (const cid of ids) {
      const c = clipsRef.current.find((v) => v.id === cid);
      if (!c) continue;
      origById.set(cid, c);
      const node = canvasRef.current?.querySelector<HTMLElement>(`[data-clip-id="${cid}"]`);
      if (node) els.push(node);
    }
    const minStart = Math.min(...[...origById.values()].map((c) => c.timelineStart));
    const maxEnd = Math.max(
      ...[...origById.values()].map((c) => c.timelineStart + clipSpan(c)),
    );

    const drag: DragState = {
      mode: 'move',
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      moved: false,
      clipId: id,
      clipIds: ids,
      el,
      els,
      origById,
      anchorStart: minStart,
      totalSpan: maxEnd - minStart,
      origLane: src.lane ?? 0,
      delta: 0,
      deltaLane: 0,
    };
    dragRef.current = drag;
    els.forEach((n) => n.classList.add('dragging'));

    const onMove = (ev: PointerEvent) => {
      const d = dragRef.current;
      if (!d || d !== drag) return;
      const dx = ev.clientX - d.startX;
      const dy = ev.clientY - d.startY;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) d.moved = true;
      if (!d.moved) return;

      const wanted = Math.max(0, (d.anchorStart ?? 0) + dx / pxRef.current);
      const snapped = snapClipStart(
        wanted,
        d.totalSpan ?? 0,
        snapTargetsFor(d.clipIds ?? []),
        SNAP_PX / pxRef.current,
        fps,
      );
      let delta = snapped.start - (d.anchorStart ?? 0);
      if ((d.anchorStart ?? 0) + delta < 0) delta = -(d.anchorStart ?? 0);
      d.delta = delta;
      setSnapLine(snapped.snapAt);

      // 单选且纵向跨到同类型轨：换算 dy
      let laneDelta = 0;
      if ((d.clipIds?.length ?? 0) === 1) {
        const srcClip = d.origById?.get(d.clipId ?? '');
        const target = rowAt(ev.clientX, ev.clientY);
        if (srcClip && target && target.track === srcClip.track && target.lane !== d.origLane) {
          const fromRow = canvasRef.current?.querySelector<HTMLElement>(
            `[data-row-key="${srcClip.track}:${d.origLane}"]`,
          );
          const toRow = canvasRef.current?.querySelector<HTMLElement>(
            `[data-row-key="${target.key}"]`,
          );
          if (fromRow && toRow) laneDelta = toRow.offsetTop - fromRow.offsetTop;
        }
        d.deltaLane = target && target.track === srcClip?.track ? target.lane : (d.origLane ?? 0);
      }
      const shiftX = delta * pxRef.current;
      d.els?.forEach((n) => {
        n.style.transform = `translate(${shiftX}px, ${laneDelta}px)`;
      });
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      const d = dragRef.current;
      dragRef.current = null;
      setSnapLine(null);
      d?.els?.forEach((n) => {
        n.classList.remove('dragging');
        n.style.transform = '';
      });
      if (!d || !d.moved) return;
      const delta = d.delta ?? 0;
      if (Math.abs(delta) < 1 / fps / 2 && (d.deltaLane ?? d.origLane) === d.origLane) return;
      if ((d.clipIds?.length ?? 0) > 1) {
        editor.moveClips(d.clipIds ?? [], delta);
      } else {
        const orig = d.origById?.get(d.clipId ?? '');
        if (!orig) return;
        editor.moveClip(
          d.clipId ?? '',
          round3(orig.timelineStart + delta),
          d.deltaLane ?? d.origLane,
        );
      }
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const startTrim = (e: React.PointerEvent, el: HTMLElement, edge: 'left' | 'right') => {
    e.preventDefault();
    e.stopPropagation();
    const id = el.dataset.clipId ?? '';
    const src = clipsRef.current.find((c) => c.id === id);
    if (!src) return;
    const row = rowByKey.get(`${src.track}:${src.lane ?? 0}`);
    if (src.locked || row?.locked) {
      toast.info('该轨道或片段已锁定，先解锁再编辑', { duration: 1600 });
      return;
    }
    editor.setSelection([id]);
    setPlaying(false);
    el.classList.add('trimming');

    const span = clipSpan(src);
    const baseStart = src.timelineStart;
    const baseEnd = baseStart + span;
    let lastDelta = 0;

    const onMove = (ev: PointerEvent) => {
      const rawDx = ev.clientX - e.clientX;
      const targets = snapTargetsFor([id]);
      if (edge === 'left') {
        const wanted = Math.max(
          0,
          Math.min(baseStart + rawDx / pxRef.current, baseEnd - 0.1),
        );
        const snapped = snapPoint(wanted, targets, SNAP_PX / pxRef.current, fps);
        const d = snapped.t - baseStart;
        lastDelta = d;
        el.style.marginLeft = `${d * pxRef.current}px`;
        el.style.width = `${Math.max(4, (span - d) * pxRef.current)}px`;
        setSnapLine(snapped.snapAt ?? (Math.abs(d) < 1e-6 ? baseStart : null));
      } else {
        const wanted = Math.max(
          baseStart + 0.1,
          baseEnd + rawDx / pxRef.current,
        );
        const snapped = snapPoint(wanted, targets, SNAP_PX / pxRef.current, fps);
        const d = snapped.t - baseEnd;
        lastDelta = d;
        el.style.width = `${Math.max(4, (span + d) * pxRef.current)}px`;
        setSnapLine(snapped.snapAt ?? (Math.abs(d) < 1e-6 ? baseEnd : null));
      }
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      el.classList.remove('trimming');
      el.style.marginLeft = '';
      el.style.width = '';
      setSnapLine(null);
      if (Math.abs(lastDelta) >= 1 / fps / 2) {
        editor.trimClip(id, edge, round3(lastDelta));
      }
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const startMarquee = (e: React.PointerEvent) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const startX = e.clientX - rect.left;
    const startY = e.clientY - rect.top;
    editor.setSelection([]);

    const drag: DragState = {
      mode: 'marquee',
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      moved: false,
    };
    dragRef.current = drag;

    const onMove = (ev: PointerEvent) => {
      const x2 = ev.clientX - rect.left;
      const y2 = ev.clientY - rect.top;
      const box = {
        x: Math.min(startX, x2),
        y: Math.min(startY, y2),
        w: Math.abs(x2 - startX),
        h: Math.abs(y2 - startY),
      };
      drag.moved = true;
      setMarquee(box);
      const screenRect = {
        left: rect.left + box.x,
        top: rect.top + box.y,
        right: rect.left + box.x + box.w,
        bottom: rect.top + box.y + box.h,
      };
      const ids: string[] = [];
      canvas.querySelectorAll<HTMLElement>('[data-clip-id]').forEach((node) => {
        const r = node.getBoundingClientRect();
        if (
          r.right >= screenRect.left &&
          r.left <= screenRect.right &&
          r.bottom >= screenRect.top &&
          r.top <= screenRect.bottom
        ) {
          const id = node.dataset.clipId;
          if (id) ids.push(id);
        }
      });
      editor.setSelection(ids);
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setMarquee(null);
      dragRef.current = null;
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  /* ------------------------- 键盘 ------------------------- */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (collapsedRef.current) return;
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable) return;
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();

      if (mod && key === 'z') {
        e.preventDefault();
        if (e.shiftKey) editorRef.current.redo();
        else editorRef.current.undo();
        return;
      }
      if (mod && key === 's') {
        e.preventDefault();
        void editorRef.current.saveNow();
        return;
      }
      if (mod && key === 'c') {
        if (selectedRef.current.length === 0) return;
        e.preventDefault();
        editorRef.current.copySelection(selectedRef.current);
        return;
      }
      if (mod && key === 'x') {
        if (selectedRef.current.length === 0) return;
        e.preventDefault();
        editorRef.current.cutSelection(selectedRef.current);
        return;
      }
      if (mod && key === 'v') {
        e.preventDefault();
        const created = editorRef.current.pasteAt(curTRef.current);
        if (created.length) editorRef.current.setSelection(created);
        return;
      }
      if (mod && key === 'a') {
        e.preventDefault();
        editorRef.current.setSelection(clipsRef.current.map((c) => c.id));
        return;
      }
      if (mod) return;

      if (e.key === ' ') return;
      if (key === 's') {
        e.preventDefault();
        const created = editorRef.current.splitAtPlayhead(
          curTRef.current,
          selectedRef.current[0],
        );
        if (created) editorRef.current.setSelection([created]);
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        if (selectedRef.current.length === 0) return;
        if (e.shiftKey) {
          selectedRef.current.forEach((id) => editorRef.current.removeClip(id));
        } else {
          editorRef.current.rippleDelete(selectedRef.current);
        }
        return;
      }
      if (key === 'm') {
        e.preventDefault();
        editorRef.current.addMarker(curTRef.current);
        return;
      }
      if (e.key === ',') {
        e.preventDefault();
        const n = e.shiftKey ? -10 : -1;
        setCurT(quantizeToFrame(curTRef.current + n / fps, fps));
        return;
      }
      if (e.key === '.') {
        e.preventDefault();
        const n = e.shiftKey ? 10 : 1;
        setCurT(quantizeToFrame(curTRef.current + n / fps, fps));
        return;
      }
      if (e.key === '?') {
        e.preventDefault();
        setShortcutsOpen((v) => !v);
        return;
      }
      if (e.key === 'Escape') {
        editorRef.current.setSelection([]);
        setShortcutsOpen(false);
        setTcEdit(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fps, setCurT]);

  /* ------------------------- 其它 UI ------------------------- */

  useEffect(() => {
    if (!addOpen) return undefined;
    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t?.closest('.tl-add')) setAddOpen(false);
    };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [addOpen]);

  const openAudioPicker = (lane: number) => {
    setAddOpen(false);
    setPickLane(clamp(lane, 0, 19));
    setPickerOpen(true);
    if (!data.projectId) return;
    setLoadingAssets(true);
    listProjectAssets(data.projectId)
      .then((list) => setAudioAssets(list.filter((a) => a.assetType === 'audio' && a.fileUrl)))
      .catch(() => toast.error('音频资产加载失败'))
      .finally(() => setLoadingAssets(false));
  };

  const insertAudio = (asset: Asset) => {
    const url = mediaUrl(asset);
    if (!url) {
      toast.error('该音频没有可用的文件地址');
      return;
    }
    const created = editor.addAudio(
      { name: asset.name || '音频', url, durationSeconds: asset.durationSeconds },
      curT,
      pickLane,
    );
    if (!created) {
      toast.error('时间线还没加载完成，请稍后再试');
      return;
    }
    editor.setSelection([created]);
    setPickerOpen(false);
    toast.success(`已插入到 A${pickLane + 1} · ${formatTimecode(curT, fps)}`, { duration: 1600 });
  };

  const addSubtitleAt = (lane: number) => {
    setAddOpen(false);
    const created = editor.addSubtitle(curT, lane, '新字幕');
    if (!created) {
      toast.error('时间线还没加载完成，请稍后再试');
      return;
    }
    editor.setSelection([created]);
    setSubEdit({ id: created, text: '新字幕' });
  };

  const commitSubtitle = () => {
    if (!subEdit) return;
    const { id, text } = subEdit;
    setSubEdit(null);
    editor.editSubtitle(id, text.trim());
  };

  const commitTimecode = () => {
    if (tcEdit == null) return;
    const sec = parseTimecode(tcEdit, fps);
    setTcEdit(null);
    if (sec == null) {
      toast.error('时间码格式不正确', { description: '示例：00:00:12:08 或 12.5' });
      return;
    }
    setPlaying(false);
    setCurT(clamp(quantizeToFrame(sec, fps), 0, total));
  };

  const startRename = (row: Row) => {
    setRenamingRow(row.key);
    setRowNameDraft(row.name);
  };

  const commitRename = () => {
    if (!renamingRow) return;
    const [track, laneStr] = renamingRow.split(':');
    editor.updateTrack(track as RowTrack, Number(laneStr), { name: rowNameDraft.trim() });
    setRenamingRow(null);
  };

  const runExport = async () => {
    if (!data.projectId || exporting) return;
    if (editor.conflict) {
      toast.error('时间线有版本冲突，请先重新载入');
      return;
    }
    setExporting(true);
    const tid = toast.loading('正在保存时间线并按 EDL 导出…');
    try {
      const saved = await editor.saveNow();
      if (!saved) {
        toast.error('时间线未保存，已取消导出', { id: tid });
        return;
      }
      const res = await exportTimeline(data.projectId, { burnSubtitles: true });
      toast.success(`导出完成：${res.asset.name}`, {
        id: tid,
        description: `${res.clips} 段 · ${res.durationSeconds.toFixed(1)}s，已归档到项目资产`,
      });
    } catch (err) {
      const msg =
        (err as { response?: { data?: { message?: string | string[] } } })?.response?.data
          ?.message ?? (err as Error)?.message;
      toast.error('导出失败', {
        id: tid,
        description: Array.isArray(msg) ? msg.join('；') : String(msg ?? '网络错误'),
      });
    } finally {
      setExporting(false);
    }
  };

  /* ------------------------- 收起态 ------------------------- */

  if (collapsed) {
    return (
      <section className={`tl tl-collapsed-bar${focused ? ' tl-focus' : ''}`} id="tl">
        <div className="tl-head">
          <h3>时间线</h3>
          <span className="tl-count num">
            · {shots.length} 镜 / {clips.length} 片段
          </span>
          {editor.dirty ? <span className="tl-save dirty">未保存</span> : null}
          <span className="sp" />
          <span className="tl-tc">{formatTimecode(total, fps)}</span>
          <button
            type="button"
            className="tl-toggle-btn"
            title="展开时间线 (⌥T)"
            onClick={() => setTlCollapsed(false)}
          >
            <ChevronUp size={13} strokeWidth={2.2} />
            <span>展开</span>
          </button>
        </div>
        <button
          type="button"
          className="tl-edge-grip"
          aria-label="展开时间线"
          title="展开时间线 (⌥T)"
          onClick={toggleTlCollapsed}
        >
          <ChevronUp size={11} strokeWidth={2.4} />
        </button>
      </section>
    );
  }

  const canvasW = Math.max(total * pxPerSec + 200, 360);
  const saveText = editor.saving
    ? '保存中…'
    : editor.conflict
      ? '版本冲突'
      : editor.dirty
        ? '未保存'
        : editor.ready
          ? '已保存'
          : '载入中';

  const inView = (c: TimelineClip) => {
    if (!Number.isFinite(viewport.end)) return true;
    const s = c.timelineStart;
    const e = s + clipSpan(c);
    return e >= viewport.start - 2 && s <= viewport.end + 2;
  };

  const selectedClip = clips.find((c) => c.id === editor.selectedIds[0]);  const selectedRow = selectedClip
    ? rowByKey.get(`${selectedClip.track}:${selectedClip.lane ?? 0}`)
    : undefined;
  const multi = editor.selectedIds.length > 1;

  const selTextStyle = resolveTextStyle(selectedClip?.textStyle ?? null);

  /** 该画面的原声是否已经被分离成了独立音频片段（判据见 model.sameOrigin） */
  const detachedAudioOf = (clip: TimelineClip): TimelineClip | undefined =>
    clips.find((c) => c.track === 'audio' && sameOrigin(c, clip, fps));

  const propsBar = selectedClip ? (
    <div className="tl-props">
      <span className="tl-props-tag">
        {selectedRow?.code ?? ''}{' '}
        {selectedClip.track === 'video' ? '画面' : selectedClip.track === 'audio' ? '音频' : '字幕'}
        {multi ? ` · 已选 ${editor.selectedIds.length}` : ''}
      </span>
      <label className="tl-prop">
        <Gauge size={11} />
        <span>速度</span>
        <select
          value={selectedClip.speed}
          onChange={(e) => editor.setClipSpeed(selectedClip.id, Number(e.target.value))}
          disabled={selectedClip.locked}
        >
          {[0.5, 0.75, 1, 1.25, 1.5, 2, 4].map((s) => (
            <option key={s} value={s}>
              {s}×
            </option>
          ))}
        </select>
      </label>
      {selectedClip.track === 'audio' ? (
        <label className="tl-prop">
          {selectedClip.volume > 0 ? <Volume2 size={11} /> : <VolumeX size={11} />}
          <span>音量</span>
          <select
            value={Math.round(selectedClip.volume * 100)}
            onChange={(e) =>
              editor.setClipVolume(selectedClip.id, Number(e.target.value) / 100)
            }
            disabled={selectedClip.locked}
          >
            {[0, 25, 50, 75, 100].map((v) => (
              <option key={v} value={v}>
                {v}%
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <label className="tl-prop">
        <Magnet size={11} />
        <span>转场</span>
        <select
          value={selectedClip.transition?.type ?? 'none'}
          onChange={(e) =>
            editor.setClipTransition(selectedClip.id, {
              type: e.target.value as 'none' | 'crossfade' | 'fade',
              duration: e.target.value === 'none' ? 0 : 0.4,
            })
          }
          disabled={selectedClip.locked}
        >
          <option value="none">硬切</option>
          <option value="fade">淡入淡出</option>
          <option value="crossfade">叠化（预留）</option>
        </select>
      </label>
      {selectedClip.track === 'video' && selectedClip.sourceUrl ? (
        detachedAudioOf(selectedClip) ? (
          <button
            type="button"
            className="tl-prop-btn on"
            title="画面原声已经分离成独立音频片段：点这里删掉那条音频、画面恢复原声"
            onClick={() => {
              const n = editor.attachAudio(selectedClip.id);
              toast.success(n > 0 ? '已合并原声' : '没有找到可合并的音频片段', {
                duration: 1800,
              });
            }}
          >
            <AudioLines size={11} />
            合并原声
          </button>
        ) : (
          <button
            type="button"
            className="tl-prop-btn"
            title="音画分离：把这段画面的原声抽成独立的音频片段，可单独移动 / 修剪 / 调音量"
            onClick={() => {
              const id = editor.detachAudio(selectedClip.id);
              if (!id) {
                toast.info('该片段已经在分离状态，或没有可用的源媒体', { duration: 2000 });
                return;
              }
              editor.setSelection([id]);
              toast.success('已分离音轨：画面静音，原声变成下面那条音频', {
                duration: 2400,
              });
            }}
          >
            <AudioLines size={11} />
            分离音轨
          </button>
        )
      ) : null}
      {selectedClip.track === 'video' && selectedClip.sourceShotId ? (
        <button
          type="button"
          className="tl-prop-btn"
          onClick={() => openShotDetail(selectedClip.sourceShotId as string)}
          title="打开该镜的详细分镜编辑：提示词 / 主体 / 动作 / 运镜 / 时间分段（景别·@角色）/ 生成历史"
        >
          <Clapperboard size={11} />
          分镜详情
        </button>
      ) : null}
      <button
        type="button"
        className={`tl-prop-btn${selectedClip.locked ? ' on' : ''}`}
        onClick={() => editor.setClipLocked(selectedClip.id, !selectedClip.locked)}
        title={selectedClip.locked ? '解锁片段' : '锁定片段'}
      >
        {selectedClip.locked ? <Lock size={11} /> : <Unlock size={11} />}
        {selectedClip.locked ? '已锁定' : '锁定'}
      </button>
      <button
        type="button"
        className={`tl-prop-btn${selectedClip.bindGroup ? ' on' : ''}`}
        disabled={!multi && !selectedClip.bindGroup}
        onClick={() =>
          selectedClip.bindGroup ? editor.unbindSelection() : editor.bindSelection()
        }
        title={
          selectedClip.bindGroup
            ? '解绑：拖动时不再带着同组片段一起走'
            : '绑定：选中画面 + 对白 / 配乐 / 字幕，拖一个全组跟着动'
        }
      >
        {selectedClip.bindGroup ? <Link2Off size={11} /> : <Link2 size={11} />}
        {selectedClip.bindGroup ? '解绑' : '绑定'}
      </button>
      {selectedClip.track === 'subtitle' ? (
        <>
          <span className="tl-prop-sep" />
          <label className="tl-prop">
            <Type size={11} />
            <span>字体</span>
            <select
              value={selTextStyle.fontFamily}
              onChange={(e) =>
                editor.updateTextStyle(selectedClip.id, { fontFamily: e.target.value })
              }
              disabled={selectedClip.locked}
            >
              {TEXT_FONTS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
          <label className="tl-prop tl-prop-range">
            <span>字号</span>
            <input
              type="range"
              min={2.4}
              max={12}
              step={0.2}
              value={selTextStyle.fontSize}
              onChange={(e) =>
                editor.updateTextStyle(selectedClip.id, { fontSize: Number(e.target.value) })
              }
              disabled={selectedClip.locked}
            />
            <b className="tl-prop-val">{selTextStyle.fontSize.toFixed(1)}%</b>
          </label>
          <label className="tl-prop">
            <span>颜色</span>
            <input
              type="color"
              value={selTextStyle.color}
              onChange={(e) => editor.updateTextStyle(selectedClip.id, { color: e.target.value })}
              disabled={selectedClip.locked}
            />
          </label>
          <label className="tl-prop tl-prop-range">
            <span>描边</span>
            <input
              type="range"
              min={0}
              max={0.3}
              step={0.01}
              value={selTextStyle.strokeWidth}
              onChange={(e) =>
                editor.updateTextStyle(selectedClip.id, { strokeWidth: Number(e.target.value) })
              }
              disabled={selectedClip.locked}
            />
          </label>
          <label className="tl-prop tl-prop-range">
            <span>不透明度</span>
            <input
              type="range"
              min={0.2}
              max={1}
              step={0.05}
              value={selTextStyle.bgOpacity}
              onChange={(e) =>
                editor.updateTextStyle(selectedClip.id, { bgOpacity: Number(e.target.value) })
              }
              disabled={selectedClip.locked}
            />
          </label>
          <label className="tl-prop">
            <span>位置</span>
            <select
              value={selTextStyle.y}
              onChange={(e) =>
                editor.updateTextStyle(selectedClip.id, { y: Number(e.target.value) })
              }
              disabled={selectedClip.locked}
            >
              {TEXT_POSITIONS.map((p) => (
                <option key={p.label} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
        </>
      ) : null}
      <span className="sp" />
      <span className="tl-props-hint">
        {multi ? '多选：拖动整体移动 · ⌘C 复制' : '拖动移动 · 把手修剪 · Delete 波纹删除'}
      </span>
    </div>
  ) : null;

  const hasProps = Boolean(propsBar);

  return (
    <section
      className={`tl${focused ? ' tl-focus' : ''}`}
      id="tl"
      onPointerEnter={() => {
        // 仅用于 hover 视觉，不再作为快捷键开关
      }}
      onPointerLeave={() => {
        if (addOpen) setAddOpen(false);
      }}
    >
      <div className="tl-head">
        <h3>时间线</h3>
        <span className="chip num">
          {shots.length} 镜 · {clips.length} 片段
        </span>
        <span className="sp" />
        {editor.conflict ? (
          <button
            type="button"
            className="tl-conflict"
            title="时间线已在别处更新，点此载入服务器版本"
            onClick={() => void editor.reloadAfterConflict()}
          >
            版本冲突 · 重新载入
          </button>
        ) : (
          <span
            className={`tl-save${editor.saving ? ' busy' : editor.dirty ? ' dirty' : ''}`}
            title={editor.dirty ? '改动会在 0.4 秒后自动保存' : '时间线已与服务器同步'}
          >
            {saveText}
          </span>
        )}
        {tcEdit != null ? (
          <input
            className="tl-tc-input"
            autoFocus
            value={tcEdit}
            onChange={(e) => setTcEdit(e.target.value)}
            onBlur={commitTimecode}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitTimecode();
              if (e.key === 'Escape') setTcEdit(null);
              e.stopPropagation();
            }}
            title="输入时间码跳转，如 00:00:12:08"
          />
        ) : (
          <button
            type="button"
            className="tl-tc"
            title="点击输入时间码跳转"
            onClick={() => setTcEdit(formatTimecode(curT, fps))}
          >
            {formatTimecode(curT, fps)} / {formatTimecode(total, fps)}
          </button>
        )}

        <div className="tl-tools">
          <button
            type="button"
            className="icon-btn"
            title="撤销 (⌘Z)"
            disabled={!editor.canUndo}
            onClick={() => editor.undo()}
          >
            <Undo2 size={13} />
          </button>
          <button
            type="button"
            className="icon-btn"
            title="重做 (⌘⇧Z)"
            disabled={!editor.canRedo}
            onClick={() => editor.redo()}
          >
            <Redo2 size={13} />
          </button>
          <span className="tl-sep" />
          <button
            type="button"
            className="icon-btn"
            title="在播放头处分割 (S)"
            disabled={!editor.ready || clips.length === 0}
            onClick={() => {
              const created = editor.splitAtPlayhead(curT, editor.selectedIds[0]);
              if (created) editor.setSelection([created]);
            }}
          >
            <Scissors size={13} />
          </button>
          <button
            type="button"
            className="icon-btn danger"
            title="波纹删除（Delete）· Shift+Delete 留空隙"
            disabled={editor.selectedIds.length === 0}
            onClick={() => editor.rippleDelete(editor.selectedIds)}
          >
            <Trash2 size={13} />
          </button>
          <span className="tl-sep" />
          <button
            type="button"
            className="icon-btn"
            title="复制 (⌘C)"
            disabled={editor.selectedIds.length === 0}
            onClick={() => editor.copySelection(editor.selectedIds)}
          >
            <Copy size={13} />
          </button>
          <button
            type="button"
            className="icon-btn"
            title="粘贴到播放头 (⌘V)"
            disabled={!editor.ready}
            onClick={() => {
              const created = editor.pasteAt(curT);
              if (created.length) editor.setSelection(created);
            }}
          >
            <ClipboardPaste size={13} />
          </button>
          <span className="tl-sep" />
          <div className="tl-add">
            <button
              type="button"
              className="icon-btn"
              title="添加字幕 / 音频 / 新轨道"
              disabled={!editor.ready}
              onClick={() => setAddOpen((v) => !v)}
            >
              <PlusCircle size={13} />
            </button>
            {addOpen ? (
              <div className="tl-add-menu" onPointerDown={(e) => e.stopPropagation()}>
                <button type="button" onClick={() => addSubtitleAt(0)}>
                  <Type size={12} /> 加字幕（播放头）
                </button>
                <button type="button" onClick={() => openAudioPicker(1)}>
                  <Music2 size={12} /> 加音频素材
                </button>
                <div className="sep" />
                <button
                  type="button"
                  onClick={() => addSubtitleAt(clamp(maxLane('subtitle') + 1, 0, 19))}
                >
                  <Layers size={12} /> 新增字幕轨
                </button>
                <button
                  type="button"
                  onClick={() => openAudioPicker(clamp(maxLane('audio') + 1, 0, 19))}
                >
                  <Layers size={12} /> 新增音频轨
                </button>
              </div>
            ) : null}
          </div>
          <button
            type="button"
            className="icon-btn"
            title="画面轨首尾相接（排齐）"
            disabled={!editor.ready || clips.length === 0}
            onClick={() => editor.packVideo()}
          >
            <AlignJustify size={13} />
          </button>
          <button
            type="button"
            className="icon-btn"
            title="在播放头添加标记 (M)"
            onClick={() => editor.addMarker(curT)}
          >
            <Flag size={13} />
          </button>
          <span className="tl-sep" />
          <button
            type="button"
            className="icon-btn"
            title="回到起点"
            onClick={() => {
              setCurT(0);
              if (scrollRef.current) scrollRef.current.scrollLeft = 0;
            }}
          >
            <RotateCcw size={13} />
          </button>
          <button
            type="button"
            className="icon-btn"
            title="先保存，再按时间线导出成片（EDL）"
            disabled={exporting || clips.length === 0}
            onClick={() => void runExport()}
          >
            <Film size={13} />
          </button>
          <button
            type="button"
            className="icon-btn"
            title="快捷键一览 (?)"
            onClick={() => setShortcutsOpen(true)}
          >
            <Keyboard size={13} />
          </button>
          <span className="tl-sep" />
          <button
            type="button"
            className="icon-btn"
            title="缩小 (⌘滚轮)"
            onClick={() => applyZoom(pxPerSec / 1.25)}
          >
            <Minus size={13} />
          </button>
          <input
            type="range"
            className="tl-zoom-slider"
            min={0}
            max={100}
            step={1}
            value={zoomToSlider(pxPerSec)}
            onChange={(e) => applyZoom(sliderToZoom(Number(e.target.value)))}
            title="拖动调整时间线缩放（也可 ⌘+滚轮）"
            aria-label="时间线缩放"
            style={{ '--zoom-fill': `${zoomToSlider(pxPerSec)}%` } as Record<string, string>}
          />
          <span className="tl-zoom-pct num">{Math.round((pxPerSec / PX_DEFAULT) * 100)}%</span>
          <button
            type="button"
            className="icon-btn"
            title="放大 (⌘滚轮)"
            onClick={() => applyZoom(pxPerSec * 1.25)}
          >
            <Plus size={13} />
          </button>
          <button type="button" className="tl-fit" title="适应宽度" onClick={fitZoom}>
            适应
          </button>
        </div>

        <button
          type="button"
          className="tl-toggle-btn"
          title="收起时间线 (⌥T)"
          onClick={() => setTlCollapsed(true)}
        >
          <ChevronDown size={13} strokeWidth={2.2} />
          <span>收起</span>
        </button>
      </div>

      <button
        type="button"
        className="tl-edge-grip"
        aria-label="收起时间线"
        title="收起时间线 (⌥T)"
        onClick={toggleTlCollapsed}
      >
        <ChevronDown size={11} strokeWidth={2.4} />
      </button>

      {propsBar}

      <div className="tl-main">
        <div className="tl-labels" style={{ flex: `0 0 ${LABEL_W}px`, width: `${LABEL_W}px` }}>
          <div className="tl-lb-spacer" />
          {rows.map((r) => (
            <div
              className={`tl-lb${r.muted ? ' muted' : ''}${r.locked ? ' locked' : ''}`}
              key={r.key}
              style={{ height: `${r.height}px` }}
              title={`${r.code} ${r.name}`}
            >
              <span className="sw" style={{ background: r.color }} />
              <b>{r.code}</b>
              {renamingRow === r.key ? (
                <input
                  className="tl-lb-input"
                  autoFocus
                  value={rowNameDraft}
                  onChange={(e) => setRowNameDraft(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitRename();
                    if (e.key === 'Escape') setRenamingRow(null);
                    e.stopPropagation();
                  }}
                />
              ) : (
                <span
                  className="tl-lb-name"
                  onDoubleClick={() => startRename(r)}
                  title="双击重命名"
                >
                  {r.name}
                </span>
              )}
              <span className="tl-lb-btns">
                <button
                  type="button"
                  className={r.muted ? 'on' : ''}
                  title={r.muted ? '取消静音' : '静音该轨'}
                  onClick={() => editor.updateTrack(r.track, r.lane, { muted: !r.muted })}
                >
                  <VolumeX size={9} />
                </button>
                <button
                  type="button"
                  className={r.solo ? 'on' : ''}
                  title={r.solo ? '取消独奏' : '独奏该轨'}
                  onClick={() => editor.updateTrack(r.track, r.lane, { solo: !r.solo })}
                >
                  <Volume2 size={9} />
                </button>
                <button
                  type="button"
                  className={r.locked ? 'on' : ''}
                  title={r.locked ? '解锁轨道' : '锁定轨道'}
                  onClick={() => editor.updateTrack(r.track, r.lane, { locked: !r.locked })}
                >
                  {r.locked ? <Lock size={9} /> : <Unlock size={9} />}
                </button>
                <button
                  type="button"
                  className="tl-lb-add"
                  title="在同类型下新增一条轨道"
                  onClick={() => {
                    const lane = editor.addTrack(r.track);
                    if (lane == null) toast.info('同类型轨道已达上限（20 条）', { duration: 1600 });
                  }}
                >
                  <Plus size={9} />
                </button>
                <button
                  type="button"
                  className="tl-lb-del"
                  title="删除这条轨道（需先清空其上的片段）"
                  onClick={() => {
                    const err = editor.removeTrack(r.track, r.lane);
                    if (err) toast.error(err, { duration: 2200 });
                  }}
                >
                  <Minus size={9} />
                </button>
              </span>
            </div>
          ))}
        </div>

        <div className="tl-tracks" id="tracks" ref={scrollRef}>
          <div
            className="tl-canvas"
            ref={canvasRef}
            style={{ width: `${canvasW}px` }}
            onPointerDown={onCanvasPointerDown}
            onDragOver={onTracksDragOver}
            onDragLeave={(e) => {
              if (e.currentTarget === e.target) setDropHint(null);
            }}
            onDrop={onTracksDrop}
          >
            <div className="ruler" title="拖动定位播放头 · Shift+拖动框选">
              {ticks.map((t, i) => (
                <div
                  key={i}
                  className={`tick${t.major ? ' maj' : ''}`}
                  style={{ left: `${t.x}px` }}
                >
                  {t.label ? <span>{t.label}</span> : null}
                </div>
              ))}
              {editor.markers.map((m) => (
                <div
                  key={`m-${m}`}
                  className="tl-marker"
                  style={{ left: `${m * pxPerSec}px` }}
                  title={`标记 ${formatTimecode(m, fps)}（点右键删除）`}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    editor.removeMarker(m);
                  }}
                />
              ))}
            </div>

            {dropHint ? (
              <div
                className={`tl-drop${dropHint.created ? ' new' : ''}`}
                style={{
                  left: `${dropHint.t * pxPerSec}px`,
                  top: `${rowTop.get(`${dropHint.track}:${dropHint.lane}`) ?? 16}px`,
                  width: `${Math.max(6, dropHint.span * pxPerSec)}px`,
                  height: `${rowByKey.get(`${dropHint.track}:${dropHint.lane}`)?.height ?? ROW_HEIGHT_DEFAULT[dropHint.track]}px`,
                }}
              >
                <span>
                  {dropHint.created ? '新建轨道' : ''}
                  {formatTimecode(dropHint.t, fps)}
                </span>
              </div>
            ) : null}

            {rows.map((row) => (
              <div
                key={row.key}
                className={`trk${row.muted ? ' muted' : ''}${row.locked ? ' locked' : ''}`}
                data-row-key={row.key}
                data-row-track={row.track}
                data-row-lane={row.lane}
                style={{ height: `${row.height}px` }}
              >
                {(clipsByRow.get(row.key) ?? []).filter(inView).map((c) => {
                  const shot = c.sourceShotId ? shotMap.get(c.sourceShotId) : undefined;
                  const label =
                    c.track === 'video'
                      ? shot
                        ? shotLabel(shot.no)
                        : '画面'
                      : c.track === 'subtitle'
                        ? c.text || '字幕'
                        : `♪ ${c.text || '音频'}`;
                  const tip =
                    c.track === 'video'
                      ? `${shot ? `#${shot.no} ${shot.txt}` : '画面片段'}（双击编辑分镜 / 拖动移动 / 拖到其它画面轨 / 拖把手修剪）`
                      : c.track === 'subtitle'
                        ? '字幕：双击改字 / 拖动移位 / 拖到其它字幕轨重叠 / × 删除'
                        : `音频：${c.text || '未命名'}（拖动移位 / 拖到其它音轨重叠 / × 删除）`;
                  return (
                    <ClipView
                      key={c.id}
                      clip={c}
                      pxPerSec={pxPerSec}
                      rowHeight={row.height}
                      selected={editor.selectedIds.includes(c.id)}
                      rowLocked={row.locked}
                      projectId={projectId}
                      audioDetached={
                        c.track === 'video' ? Boolean(detachedAudioOf(c)) : undefined
                      }
                      label={label}
                      tip={tip}
                      onDoubleClick={() => {
                        if (c.track === 'subtitle') {
                          setSubEdit({ id: c.id, text: c.text || '' });
                          return;
                        }
                        // 画面片段双击 = 打开该镜头的详细分镜编辑（主体/动作/运镜/景别/角色）
                        if (c.track === 'video' && c.sourceShotId) {
                          openShotDetail(c.sourceShotId);
                        }
                      }}
                      onDelete={() => editor.removeClip(c.id)}
                    />
                  );
                })}
              </div>
            ))}

            {clips.length === 0 ? (
              <div className="tl-empty">
                时间线还没有片段
                <em>生成镜头视频后会自动出现；也可用 ＋ 按钮插入字幕 / 音频</em>
              </div>
            ) : null}

            {snapLine != null ? (
              <div className="tl-snapline" style={{ left: `${snapLine * pxPerSec}px` }}>
                <span>{formatTimecode(snapLine, fps)}</span>
              </div>
            ) : null}

            {marquee ? (
              <div
                className="tl-marquee"
                style={{
                  left: `${marquee.x}px`,
                  top: `${marquee.y}px`,
                  width: `${marquee.w}px`,
                  height: `${marquee.h}px`,
                }}
              />
            ) : null}

            <div
              className="playhead"
              style={{ left: `${curT * pxPerSec}px`, opacity: playing ? 1 : 0.85 }}
            >
              <div className="playhead-grip" />
            </div>
          </div>
        </div>
      </div>

      {/* 镜头列表 */}
      <div className="tl-strip" role="group" aria-label="镜头列表">
        <span className="tl-strip-h">镜头</span>
        {shots.length === 0 ? (
          <span className="tl-strip-empty">暂无镜头 · 生成分镜后自动出现在时间线</span>
        ) : (
          shots.map((s, i) => (
            <button
              key={s.id}
              type="button"
              className={`tl-strip-i${i === sel ? ' on' : ''}`}
              draggable
              title={`${shotLabel(s.no)} ${s.sceneLabel} · ${s.tag} · ${s.dur.toFixed(1)}s · ${s.txt}（拖动可拖进时间线开新轨 · 双击进分镜详情）`}
              onClick={() => jumpToShot(i)}
              onDoubleClick={() => openShotDetail(s.id)}
              onDragStart={(e) =>
                startTimelineDrag(e, {
                  kind: 'shot',
                  name: `${shotLabel(s.no)} ${s.txt}`.slice(0, 40),
                  durationSeconds: s.dur,
                  shotId: s.id,
                  videoUrl: s.videoUrl,
                  frameUrl: s.frameUrl,
                })
              }
              onDragEnd={() => clearTimelineDrag()}
            >
              <b>{shotLabel(s.no)}</b>
              <span className="num">{s.dur.toFixed(1)}s</span>
              <i className={`tl-strip-st ${s.st}`} />
            </button>
          ))
        )}
      </div>

      <div className="tl-info">
        <span className="tl-info-m">
          <b>总时长</b>
          <em className="num">{formatTimecode(total, fps)}</em>
        </span>
        <span className="tl-info-m">
          <b>镜头</b>
          <em>{shots.length}</em>
        </span>
        <span className="tl-info-m">
          <b>片段</b>
          <em>{clips.length}</em>
        </span>
        <span className="tl-info-m">
          <b>轨道</b>
          <em>{rows.length}</em>
        </span>
        <span className="tl-info-m">
          <b>帧率</b>
          <em className="num">{fps}fps</em>
        </span>
        <span className="tl-info-div" />
        <div className="tl-info-sel">
          {selShot ? (
            <>
              <span className="tl-info-no">{shotLabel(selShot.no)}</span>
              <span className="tl-info-tag">{selShot.tag || '未设景别'}</span>
              <span className="tl-info-dur num">{selShot.dur.toFixed(1)}s</span>
              <span className="tl-info-txt" title={selShot.txt}>
                {selShot.txt || selShot.dialogue || '暂无画面描述'}
              </span>
            </>
          ) : (
            <span className="tl-info-none">暂无选中镜头 · 点击上方镜头条或时间线片段定位</span>
          )}
        </div>
        <span className="sp" />
        <span className="tl-info-keys">S 分割 · Delete 波纹删 · M 标记 · ? 快捷键</span>
        <button
          type="button"
          className="tl-info-btn"
          disabled={!selShot || !projectId}
          title="在分镜页编辑当前镜头"
          onClick={() =>
            projectId && navigate(`/project/${projectId}/storyboard?shot=${selShot?.id}`)
          }
        >
          编辑分镜
        </button>
        <button
          type="button"
          className="tl-info-btn"
          disabled={!projectId}
          title="打开全屏自由画布"
          onClick={() => projectId && navigate(`/project/${projectId}/canvas-free3`)}
        >
          自由画布
        </button>
      </div>

      {/* 快捷键面板 */}
      {shortcutsOpen ? (
        <div className="tl-modal-mask" onClick={() => setShortcutsOpen(false)}>
          <div className="tl-modal" onClick={(e) => e.stopPropagation()}>
            <div className="tl-modal-head">
              <b>时间线快捷键</b>
              <button type="button" title="关闭" onClick={() => setShortcutsOpen(false)}>
                <X size={14} />
              </button>
            </div>
            <div className="tl-keys">
              {[
                ['S', '在播放头分割'],
                ['Delete', '波纹删除（后续片段前移）'],
                ['Shift+Delete', '删除并保留空隙'],
                ['M', '在播放头添加标记'],
                [', / .', '前后一帧（Shift 为 10 帧）'],
                ['⌘/Ctrl+C', '复制选中片段'],
                ['⌘/Ctrl+X', '剪切选中片段'],
                ['⌘/Ctrl+V', '粘贴到播放头'],
                ['⌘/Ctrl+A', '全选片段'],
                ['⌘/Ctrl+Z', '撤销'],
                ['⌘/Ctrl+Shift+Z', '重做'],
                ['Shift+点击', '加选 / 减选片段'],
                ['Shift+拖动空白', '框选片段'],
                ['⌘/Ctrl+滚轮', '以指针为锚点缩放'],
                ['空格', '播放 / 暂停'],
                ['?', '打开 / 关闭本面板'],
              ].map(([k, v]) => (
                <div className="tl-key-row" key={k}>
                  <kbd>{k}</kbd>
                  <span>{v}</span>
                </div>
              ))}
            </div>
            <p className="tl-modal-note">
              片段属性（速度 / 音量 / 转场 / 锁定）在时间线上方属性条调整；轨道头可重命名、静音、独奏、锁定。
            </p>
          </div>
        </div>
      ) : null}

      {pickerOpen ? (
        <div className="tl-picker-mask" onClick={() => setPickerOpen(false)}>
          <div className="tl-picker" onClick={(e) => e.stopPropagation()}>
            <div className="tl-picker-head">
              <b>插入音频素材</b>
              <button type="button" title="关闭" onClick={() => setPickerOpen(false)}>
                <X size={14} />
              </button>
            </div>
            <div className="tl-picker-row">
              <span>目标音轨</span>
              <select value={pickLane} onChange={(e) => setPickLane(Number(e.target.value))}>
                {Array.from({ length: 8 }, (_, i) => (
                  <option key={i} value={i}>
                    {`A${i + 1} ${audioLaneTitle(i)}`}
                  </option>
                ))}
              </select>
              <span className="num">插入点 {formatTimecode(curT, fps)}</span>
            </div>
            <div className="tl-picker-list">
              {loadingAssets ? (
                <div className="empty">加载中…</div>
              ) : audioAssets.length === 0 ? (
                <div className="empty">项目里还没有音频资产，先去资产库上传配音或配乐</div>
              ) : (
                audioAssets.map((a) => (
                  <button key={a.id} type="button" onClick={() => insertAudio(a)}>
                    <Music2 size={12} />
                    <span className="nm">{a.name || '未命名音频'}</span>
                    <span className="du num">
                      {a.durationSeconds ? `${a.durationSeconds.toFixed(1)}s` : '—'}
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
};
