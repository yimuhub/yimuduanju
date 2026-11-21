/**
 * 一幕·神剪 · 底部多轨时间线（原型同款轨道头 + 标尺 + 片段）
 * 真源是项目 EDL：拖动、跨轨、边缘修剪、Q/W 波纹裁切、分割、删除、
 * 轨道显隐/锁定、缩放与行高全部走 useEdlEditor 的已有方法。
 * FX 参数自动化 lane：音频片段行展开区按「FX:节点·参数」画包络折线
 * （复用 R1 关键帧 lane 的行展开机制，交互与音量包络同款）。
 */
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlignJustify, ChevronDown, ChevronRight, ClipboardPaste, Copy, Crop, Eye, EyeOff, Layers, Lock, Magnet, MapPin, Minus, Plus, PlusCircle, Redo2, RotateCcw, Snowflake, Trash2, Type, Undo2, Volume2, VolumeX } from 'lucide-react';
import { IconRazor, IconRippleDelete, IconSelect, IconSplit, IconTrimLeft, IconTrimRight } from './ShenJianIcons';
import { toast } from 'sonner';
import { useStudio } from './StudioShell';
import { useEdl } from './EdlContext';
import { clipSpan, sameOrigin } from './model';
import type { TimelineClip, TimelineTrackKind } from '@shared/api.interface';
import type { TimelineVolumePoint } from '@shared/timeline-audio-expr';
import {
  AUDIO_FX_PARAM_DEFS,
  AUDIO_FX_TYPE_SHORT,
  formatAudioFxParamValue,
  paramAt,
  type AudioFxAutomationPoint,
  type AudioFxParamDef,
} from '@shared/timeline-audio-fx';
import type { EdlEditor } from './useEdlEditor';
import { uploadLocalFile } from '@client/src/api/assets';
import { frameNumberOf } from '@client/src/lib/timeline-frame';
import { useTimeDisplayMode } from '@client/src/lib/hooks';
import { resolveCloseAllShifts, resolveGapAt, type GapClip } from '@client/src/lib/timeline-gaps';
import { mediaOfDrag, peekTimelineDrag, readTimelineDrag, trackOfDrag } from '@client/src/lib/timeline-dnd';
import { probeVideoHasAudio } from '@client/src/lib/media-audio';
import { quantizeToFrame } from '@client/src/lib/timeline-frame';
import type { TimelineVideoKeyframe } from '@shared/timeline-keyframes';
import {
  activeBeatClip,
  activeBeatTimes,
  addManualBeat,
  applyBeatRedo,
  applyBeatUndo,
  moveManualBeat,
  removeManualBeat,
  sourceBeatToTimeline,
  timelineToSourceBeat,
  useBeatsSnapshot,
  type BeatSourceClip,
} from '@client/src/lib/timeline-beats';
import {
  hasVolumeAutomation,
  isVoiceClip,
  normalizeVolumePoints,
  volumeAt,
} from '@client/src/lib/timeline-audio';
import { useThumbnails, Filmstrip, StillFrame, useWaveform, Waveform } from './timeline-media';

type Row = {
  key: string;
  no: number;
  track: TimelineTrackKind;
  lane: number;
  label: string;
  name: string;
  visible: boolean;
  muted: boolean;
  locked: boolean;
  /** 音画分离出的 A 轨：绑定到哪条画面轨，行紧贴在它下面 */
  pairedVideoLane?: number;
};

/** 悬停帧预览：复用时间线缩略图雪碧图，不额外请求解码。 */
function HoverFramePreview({
  time,
  clips,
  projectId,
  zoom,
}: {
  time: number;
  clips: TimelineClip[];
  projectId?: string;
  zoom: number;
}) {
  const hit = clips
    .filter((c) => c.track === 'video' && c.enabled !== false && time >= c.timelineStart && time <= c.timelineStart + clipSpan(c))
    .sort((a, b) => (b.lane ?? 0) - (a.lane ?? 0))[0];
  const thumbs = useThumbnails(projectId, hit?.sourceUrl);
  if (!hit || !thumbs?.spriteUrl || !thumbs.count) return null;
  const sourceTime = Math.max(0, (time - hit.timelineStart) * Math.max(0.01, hit.speed || 1) + hit.inPoint);
  const index = Math.max(0, Math.min(thumbs.count - 1, Math.floor(sourceTime / Math.max(0.01, thumbs.interval))));
  const col = index % Math.max(1, thumbs.columns);
  const row = Math.floor(index / Math.max(1, thumbs.columns));
  const W = 112;
  const H = 63;
  return (
    <span className="hover-card" style={{ left: time * zoom + TL_LEFT_PAD + 12 }}>
      <span
        className="hover-card-img"
        style={{
          width: W,
          height: H,
          backgroundImage: `url(${thumbs.spriteUrl})`,
          backgroundSize: `${Math.max(1, thumbs.columns) * W}px ${Math.max(1, thumbs.rows) * H}px`,
          backgroundPosition: `-${col * W}px -${row * H}px`,
        }}
      />
      <i>{fmtSec(sourceTime)} · V{(hit.lane ?? 0) + 1}</i>
    </span>
  );
}

type DragState = {
  id: string;
  kind: 'move' | 'trim-l' | 'trim-r';
  startX: number;
  startY: number;
  origStart: number;
  origSpan: number;
  lane: number;
  targetRowKey?: string;
  created?: boolean;
  track: TimelineTrackKind;
  dx: number;
  span: number;
  pointerX?: number;
  pointerY?: number;
  /** 拖到空白区松手时，新轨道插到同类轨道的顶部还是底部 */
  insertAt?: 'top' | 'bottom';
  /** 右边缘最多能拉到的时长（源媒体完整时长 - 入点）/ 速度 */
  maxSpan?: number;
};

type CtxState = { x: number; y: number; id: string } | null;

/**
 * 键盘拾取状态（OpenMotion useTimelineClipDrag 对齐）：
 * Space 拿起选中片段 → ↑/↓ 换行 → ←/→ 帧步进 → Enter/Space 落下 → Esc 取消还原。
 */
type PickupState = {
  id: string;
  track: TimelineTrackKind;
  /** 拾起时的起点（取消还原的基准） */
  origStart: number;
  origLane: number;
  /** 当前预览位置（帧量化） */
  start: number;
  lane: number;
};

/** 空白轨区右键菜单（OpenMotion TrackGapContextMenu 对齐） */
type GapCtxState = {
  x: number;
  y: number;
  track: TimelineTrackKind;
  lane: number;
  /** 右键时刻（帧量化） */
  time: number;
  /** 没有任何行的空白区（空轨）：菜单项全部置灰 */
  empty?: boolean;
} | null;

/** 剃刀可切的片段：画面（含图片）/音频；字幕、锁定片段不切 */
const isRazorable = (c: TimelineClip) => (c.track === 'video' || c.track === 'audio') && !c.locked;

/**
 * 冻结帧抓帧：隐藏 video seek 到冻结时刻 → canvas → PNG blob。
 * 素材与页面同源（/uploads 或后端代理），画布不会被跨域污染。
 */
const captureFramePng = (url: string, atSec: number): Promise<Blob> =>
  new Promise((resolve, reject) => {
    const v = document.createElement('video');
    v.muted = true;
    v.preload = 'auto';
    v.crossOrigin = 'anonymous';
    let settled = false;
    let timer = 0;
    const cleanup = () => {
      window.clearTimeout(timer);
      v.onloadedmetadata = null;
      v.onseeked = null;
      v.onerror = null;
      v.removeAttribute('src');
      try { v.load(); } catch { /* 已卸载 */ }
    };
    const ok = (b: Blob | null) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (b && b.size > 0) resolve(b);
      else reject(new Error('冻结帧导出失败'));
    };
    const bad = (msg: string) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(msg));
    };
    timer = window.setTimeout(() => bad('抓帧超时，素材加载太慢'), 15000);
    v.onloadedmetadata = () => {
      const dur = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : atSec + 1;
      v.currentTime = Math.max(0, Math.min(atSec, dur - 0.04));
    };
    v.onseeked = () => {
      try {
        const c = document.createElement('canvas');
        c.width = v.videoWidth || 720;
        c.height = v.videoHeight || 1280;
        const ctx = c.getContext('2d');
        if (!ctx) {
          bad('画布不可用');
          return;
        }
        ctx.drawImage(v, 0, 0, c.width, c.height);
        c.toBlob((b) => ok(b), 'image/png');
      } catch {
        bad('抓帧失败（跨域素材无法导出画面）');
      }
    };
    v.onerror = () => bad('素材加载失败');
    v.src = url;
  });

/** 与 OpenMotion Studio 对齐的时间线几何：132 轨道头、24 标尺、8 顶距、48 左留白。 */
const TL_RULER_H = 24;
const TL_TOP_PAD = 8;
const TL_LEFT_PAD = 0;
const TL_VIDEO_ROW_H = 64;
const TL_AUDIO_ROW_H = 48;
const TL_CLIP_GAP_Y = 3;
/** 关键帧属性 lane（R1，OpenMotion TimelinePropertyLanes 对齐）：每组占一行 28px */
const KF_LANE_H = 28;

/* ============================ 关键帧属性分组（R1） ============================ */

/** 属性组：缩放 / 位移（x+y 合一条 lane）/ 旋转，固定顺序展示 */
type KfGroupKey = 'scale' | 'offset' | 'rotate';

const KF_GROUP_DEFS: Array<{
  key: KfGroupKey;
  label: string;
  /** 该组在关键帧上的取值（用于判断关键帧是否属于本组、菱形 tooltip） */
  pick: (f: TimelineVideoKeyframe) => number | undefined;
  /** 该组字段值格式化（tooltip 用） */
  fmt?: (f: TimelineVideoKeyframe) => string;
}> = [
  { key: 'scale', label: '缩放', pick: (f) => f.scale, fmt: (f) => `${Math.round((f.scale ?? 1) * 100)}%` },
  { key: 'offset', label: '位移', pick: (f) => f.x ?? f.y, fmt: (f) => `${Math.round((f.x ?? 0) * 100)},${Math.round((f.y ?? 0) * 100)}` },
  { key: 'rotate', label: '旋转', pick: (f) => f.rotate, fmt: (f) => `${Math.round(f.rotate ?? 0)}°` },
];

/** 片段关键帧落在哪些属性组（固定顺序；关键帧可能同时出现在多个组） */
const kfGroupsOf = (frames: TimelineVideoKeyframe[] | null | undefined): KfGroupKey[] => {
  const list = frames ?? [];
  return KF_GROUP_DEFS.filter((g) => list.some((f) => g.pick(f) !== undefined)).map((g) => g.key);
};

const kfGroupDef = (key: KfGroupKey) => KF_GROUP_DEFS.find((g) => g.key === key) as (typeof KF_GROUP_DEFS)[number];

/**
 * 从关键帧上摘掉某组的字段；摘完四个属性全空 = 整帧删除（返回 null）。
 * 与「清除全部关键帧」菜单同一语义：只剩一个属性时删属性即删整帧。
 */
const stripKeyframeGroup = (f: TimelineVideoKeyframe, group: KfGroupKey): TimelineVideoKeyframe | null => {
  const next: TimelineVideoKeyframe = { ...f };
  if (group === 'scale') delete next.scale;
  if (group === 'offset') { delete next.x; delete next.y; }
  if (group === 'rotate') delete next.rotate;
  if (next.scale === undefined && next.x === undefined && next.y === undefined && next.rotate === undefined) return null;
  return next;
};

/** 缓动选项（右键菜单 / 关键帧条共用）：当前项打勾 */
const KF_EASE_OPTIONS: Array<{ value: NonNullable<TimelineVideoKeyframe['easing']>; label: string }> = [
  { value: 'linear', label: '线性' },
  { value: 'ease-in', label: '缓入' },
  { value: 'ease-out', label: '缓出' },
  { value: 'ease-inout', label: '缓入缓出' },
];

/**
 * 相邻菱形连接线的缓动着色（OpenMotion TimelineDiamondConnectors 语义）：
 * linear = 灰；in / out / inout = 一幕红深浅。
 */
const easeConnectorColor = (easing: TimelineVideoKeyframe['easing']): string => {
  if (easing === 'ease-in') return '#ff403a';
  if (easing === 'ease-out') return '#ff7d72';
  if (easing === 'ease-inout') return '#c22722';
  return '#9aa3af66';
};

const easeLabelOf = (easing: TimelineVideoKeyframe['easing']): string =>
  KF_EASE_OPTIONS.find((o) => o.value === easing)?.label ?? '线性';

const fmtSec = (s: number) => {
  const t = Math.max(0, s);
  const m = Math.floor(t / 60);
  const sec = Math.floor(t % 60);
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
};

/** 标尺角标用参考版 mm:ss.cs，毫秒只取两位。 */
const fmtTc = (s: number) => {
  const t = Math.max(0, s);
  const m = Math.floor(t / 60);
  const sec = Math.floor(t % 60);
  const cs = Math.floor((t - Math.floor(t)) * 100);
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
};

const clipColor = (c: TimelineClip) => (c.track === 'audio' ? 'audio' : c.track === 'subtitle' ? 'text' : '');

const clipLabel = (c: TimelineClip) => {
  if (c.track === 'subtitle') return c.text || '字幕';
  if (c.track === 'audio') return c.text || '音频';
  return c.text?.slice(0, 16) || '画面';
};

const IMAGE_RE = /\.(png|jpe?g|webp|gif|bmp|avif)(?:[?#]|$)/i;

/**
 * 画面片段缩略层：
 * - 视频走服务端抽帧 sprite，按片段区间铺成多帧 filmstrip；
 * - 图片/GIF 走 StillFrame 保留原图/动画；
 * - sprite 未就绪时先用源首帧兜底，不把片段画成空白。
 */
const ClipVisual = ({
  projectId,
  clip,
  fallbackUrl,
  span,
  pxPerSec,
  rowHeight,
  embeddedAudio,
}: {
  projectId: string;
  clip: TimelineClip;
  fallbackUrl?: string;
  span: number;
  pxPerSec: number;
  rowHeight: number;
  embeddedAudio?: boolean;
}) => {
  const url = clip.sourceUrl || fallbackUrl || '';
  const still = IMAGE_RE.test(url);
  const thumb = useThumbnails(projectId, still ? null : url);
  if (!url) return null;
  const base = still ? (
    <StillFrame url={url} span={span} pxPerSec={pxPerSec} />
  ) : thumb ? (
    <Filmstrip
      thumb={thumb}
      span={span}
      inPoint={clip.inPoint}
      outPoint={clip.outPoint}
      pxPerSec={pxPerSec}
      rowHeight={rowHeight}
    />
  ) : (
    <img className="thumb" src={url} alt="" loading="lazy" draggable={false} />
  );
  return (
    <>
      {base}
      {embeddedAudio ? <EmbeddedAudio projectId={projectId} clip={clip} span={span} pxPerSec={pxPerSec} /> : null}
    </>
  );
};

/**
 * 真实音频波形：按项目 + 媒体地址请求后端 peaks，并按片段区间/当前缩放重采样。
 * 加载中也有明确文案，绝不把音频片段画成空白色块。
 */
const AudioClipWave = ({
  projectId,
  clip,
  span,
  pxPerSec,
}: {
  projectId: string;
  clip: TimelineClip;
  span: number;
  pxPerSec: number;
}) => {
  const wave = useWaveform(projectId, clip.sourceUrl);
  if (!wave) {
    return (
      <div className="wave" aria-label="音频波形加载中">
        <span className="wave-empty">波形解析中…</span>
      </div>
    );
  }
  if (wave.peaks.length === 0) {
    return (
      <div className="wave" aria-label="音频没有可解析的波形">
        <span className="wave-empty">无可解析波形</span>
      </div>
    );
  }
  return (
    <div className="wave" aria-label="音频波形">
      <Waveform
        wave={wave}
        span={span}
        inPoint={clip.inPoint}
        outPoint={clip.outPoint}
        pxPerSec={pxPerSec}
        gain={clip.volume ?? 1}
      />
    </div>
  );
};

/**
 * 剪映式白色增益线：上下拖动直接改片段音量。
 * 中线 = 0dB（volume 1），最上 = +6dB（volume 2），最下 = 静音（volume 0）。
 * 拖动时实时写回 EDL，预览与导出共用同一份 volume。
 */
const GainLine = ({
  clip,
  onChange,
}: {
  clip: TimelineClip;
  onChange: (v: number) => void;
}) => {
  const [vol, setVol] = useState(() => Math.max(0, Math.min(2, clip.volume ?? 1)));
  const [dragging, setDragging] = useState(false);
  useEffect(() => setVol(Math.max(0, Math.min(2, clip.volume ?? 1))), [clip.id, clip.volume]);
  const db = vol <= 0.001 ? '-∞' : `${vol > 1 ? '+' : ''}${(20 * Math.log10(vol)).toFixed(1)}`;
  const top = 10 + (1 - Math.min(2, vol) / 2) * 80;
  const tone = vol > 1.001 ? ' boost' : vol < 0.999 ? ' cut' : '';
  const apply = (clientY: number, rect: DOMRect) => {
    const p = Math.max(0.1, Math.min(0.9, (clientY - rect.top) / Math.max(1, rect.height)));
    const next = Math.max(0, Math.min(2, 2 * (1 - (p - 0.1) / 0.8)));
    setVol(next);
    onChange(next);
  };
  return (
    <div
      className={`gain-line${tone}${dragging ? ' dragging' : ''}`}
      style={{ top: `${top}%` }}
      title={`音量 ${db} dB（向上增大，向下减小）`}
      onPointerDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setDragging(true);
        const rect = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
        apply(e.clientY, rect);
        const move = (ev: PointerEvent) => apply(ev.clientY, rect);
        const up = () => {
          setDragging(false);
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', up);
          window.removeEventListener('pointercancel', up);
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
        window.addEventListener('pointercancel', up);
      }}
    >
      <i />
      <span>{db} dB</span>
    </div>
  );
};

/**
 * 音量包络（G12）：白色折线 + 可拖圆点，画在音频片段体 / 内嵌原声半区内。
 * 双击线上加点（v 取该处插值）、拖点改 t/v（t 帧量化、v 0–2、不越过相邻点）、
 * 右键点删除（少于 2 点时清空整条包络）；hover 圆点显示 t / v。
 * 数据写 clip.volumeAutomation，预览（ShenJianStage）与导出（volume 表达式）共用。
 */
const VolumeEnvelope = ({
  clip,
  span,
  pxPerSec,
  height,
  fps,
  onChange,
  onClear,
}: {
  clip: TimelineClip;
  span: number;
  pxPerSec: number;
  height: number;
  fps: number;
  onChange: (points: TimelineVolumePoint[]) => void;
  onClear: () => void;
}) => {
  const H = Math.max(18, height);
  const points = useMemo(
    () => normalizeVolumePoints(clip.volumeAutomation?.points, span, fps),
    [clip.volumeAutomation, span, fps],
  );
  if (points.length < 2) return null;
  // v 0–2 映射到上下留 3px 的绘制区：顶 = 200%，底 = 静音
  const yFor = (v: number) => 3 + (1 - Math.max(0, Math.min(2, v)) / 2) * (H - 6);
  const localT = (clientX: number, el: HTMLElement) => {
    const rect = el.getBoundingClientRect();
    return Math.max(0, Math.min(span, (clientX - rect.left) / Math.max(1, pxPerSec)));
  };
  const addAt = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const t = quantizeToFrame(localT(e.clientX, e.currentTarget as HTMLElement), fps);
    // v 取点击处折线的插值，而不是点击的纵向位置：加出来的点不改变当前音量形状
    onChange([...points, { t, v: volumeAt(points, t) }]);
  };
  const dragPoint = (e: React.PointerEvent, i: number) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const orig = points[i];
    const startX = e.clientX;
    const startY = e.clientY;
    const prev = points[i - 1];
    const next = points[i + 1];
    const minT = prev ? prev.t + 1 / Math.max(1, fps) : 0;
    const maxT = next ? next.t - 1 / Math.max(1, fps) : span;
    const move = (ev: PointerEvent) => {
      const t = quantizeToFrame(
        Math.max(minT, Math.min(maxT, orig.t + (ev.clientX - startX) / Math.max(1, pxPerSec))),
        fps,
      );
      const v = Math.max(0, Math.min(2, orig.v - ((ev.clientY - startY) * 2) / (H - 6)));
      onChange(points.map((p, idx) => (idx === i ? { t, v } : p)));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };
  const removePoint = (e: React.MouseEvent, i: number) => {
    e.preventDefault();
    e.stopPropagation();
    // 右键删点：剩下不足 2 个点时整条包络清空（恢复音量直线）
    if (points.length - 1 < 2) onClear();
    else onChange(points.filter((_, idx) => idx !== i));
  };
  const linePoints = points.map((p) => `${(p.t * pxPerSec).toFixed(2)},${yFor(p.v).toFixed(2)}`).join(' ');
  return (
    <div className="venv" style={{ height: H }}>
      {/* 容器 pointer-events:none；命中线 pointer-events:stroke，双击线上加点（事件冒泡到 svg） */}
      <svg width="100%" height={H} onDoubleClick={addAt}>
        <polyline className="venv-hit" points={linePoints} />
        <polyline className="venv-line" points={linePoints} />
        {points.map((p, i) => (
          <circle
            key={`${p.t}-${i}`}
            className="venv-dot"
            cx={Math.max(2, Math.min(span * pxPerSec - 2, p.t * pxPerSec))}
            cy={yFor(p.v)}
            r={4}
            onPointerDown={(e) => dragPoint(e, i)}
            onContextMenu={(e) => removePoint(e, i)}
          >
            <title>{`t=${p.t.toFixed(2)}s v=${Math.round(p.v * 100)}%（拖动改音量/时间，右键删除）`}</title>
          </circle>
        ))}
      </svg>
    </div>
  );
};

/**
 * 画面运镜关键帧（G13 增强）：按关键帧真实时间铺菱形（剪映样式）。
 * 点击跳到该关键帧；按住左右拖可直接改关键帧时间；Shift+点击多选（配合
 * 右键菜单做批量删除 / 批量移到播放头）；右键打开关键帧菜单。
 */
const ClipKeyframes = ({
  clip,
  span,
  pxPerSec,
  selectedTimes,
  onSeek,
  onChange,
  onSelect,
  onContext,
}: {
  clip: TimelineClip;
  span: number;
  pxPerSec: number;
  /** Shift 多选的关键帧时间（仅当前片段） */
  selectedTimes: number[];
  onSeek: (t: number) => void;
  onChange: (frames: NonNullable<TimelineClip['keyframes']>) => void;
  /** Shift+点击：切换该关键帧的选中态 */
  onSelect: (time: number, shiftKey: boolean) => void;
  onContext: (e: React.MouseEvent, time: number) => void;
}) => {
  const frames = clip.keyframes ?? [];
  if (!frames.length) return null;
  const frameEq = (a: number, b: number) => Math.abs(a - b) < 1 / 1000;
  const bind = (i: number, f: NonNullable<TimelineClip['keyframes']>[number]) => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      onSelect(f.time, e.shiftKey);
      if (e.shiftKey) return; // Shift 点击只改多选，不定位不拖动
      onSeek(clip.timelineStart + f.time);
      const startX = e.clientX;
      const orig = f.time;
      const move = (ev: PointerEvent) => {
        const dt = (ev.clientX - startX) / Math.max(1, pxPerSec);
        const next = Math.max(0, Math.min(span, orig + dt));
        const list = [...frames];
        list[i] = { ...list[i], time: Math.round(next * 1000) / 1000 };
        onChange(list);
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', up);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
    },
    onContextMenu: (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      onContext(e, f.time);
    },
  });
  return (
    <>
      {frames.map((f, i) => (
        <b
          key={`${f.time}-${i}`}
          className={`kfm${selectedTimes.some((t) => frameEq(t, f.time)) ? ' picked' : ''}`}
          style={{ left: Math.max(1, Math.min(span * pxPerSec - 4, f.time * pxPerSec - 1.5)) }}
          title={`画面关键帧 ${f.time.toFixed(2)}s · 缩放 ${Math.round((f.scale ?? 1) * 100)}% · X ${Math.round((f.x ?? 0) * 100)}% · Y ${Math.round((f.y ?? 0) * 100)}%（点击定位，Shift 多选，右键菜单）`}
          {...bind(i, f)}
        />
      ))}
    </>
  );
};

/**
 * 关键帧属性 lane（R1，OpenMotion TimelinePropertyLanes 对齐）：
 * 片段展开后，行底部按「缩放 / 位移 / 旋转」各占一行 28px（KF_LANE_H），
 * 画该组关键帧菱形 + 相邻菱形缓动连接线（linear 灰、in/out/inout 一幕红深浅）。
 * 菱形：单击定位播放头；拖拽 retime（帧量化、被同组相邻关键帧钳制，实时预览）；
 * Shift+点击多选（复用 kfSel）；右键组内菜单（删该属性 / 移到播放头 / 清空该属性 / 缓动）。
 * 一个关键帧可同时在多个组出现（如既有 scale 又有 rotate）。
 */
const ClipKeyframeLanes = ({
  clip,
  leftPx,
  span,
  pxPerSec,
  fps,
  selectedTimes,
  onSeek,
  onChange,
  onSelect,
  onContext,
}: {
  clip: TimelineClip;
  /** 片段在行内的显示左缘（px）：拖动/拾取中菱形跟着片段走 */
  leftPx: number;
  span: number;
  pxPerSec: number;
  fps: number;
  /** Shift 多选的关键帧时间（仅当前片段，与紧凑菱形共用 kfSel） */
  selectedTimes: number[];
  onSeek: (t: number) => void;
  onChange: (frames: NonNullable<TimelineClip['keyframes']>) => void;
  onSelect: (time: number, shiftKey: boolean) => void;
  onContext: (e: React.MouseEvent, time: number, group: KfGroupKey) => void;
}) => {
  const frames = clip.keyframes ?? [];
  const groups = kfGroupsOf(frames);
  if (!frames.length || !groups.length) return null;
  const frameEq = (a: number, b: number) => Math.abs(a - b) < 1e-3;
  const minStep = 1 / Math.max(1, fps);
  // 菱形横坐标：片段左缘 + 关键帧本地时间；两端留 1px 收边
  const xOf = (t: number) => Math.max(leftPx + 1, Math.min(leftPx + span * pxPerSec - 5, leftPx + t * pxPerSec - 4.5));
  return (
    <div
      className="kf-lanes"
      id={`kf-lanes-${clip.id}`}
      role="group"
      aria-label={`${clipLabel(clip)} 关键帧属性 lane`}
      style={{ height: groups.length * KF_LANE_H }}
    >
      {groups.map((groupKey, gi) => {
        const def = kfGroupDef(groupKey);
        // 该组的关键帧（时间升序）：菱形与钳制边界都从这里来
        const groupFrames = frames.filter((f) => def.pick(f) !== undefined);
        return (
          <div
            key={groupKey}
            className="kf-lane"
            data-kf-group={groupKey}
            style={{ height: KF_LANE_H, bottom: (groups.length - 1 - gi) * KF_LANE_H }}
          >
            <span className="kf-lane-tag">{def.label}</span>
            {groupFrames.map((f, i) => {
              const x = xOf(f.time);
              // 与相邻菱形的缓动连接线（颜色 = 段起点关键帧的 easing）
              const nextF = groupFrames[i + 1];
              const connector = nextF ? (() => {
                const x1 = x + 5;
                const x2 = xOf(nextF.time);
                const w = x2 - x1;
                if (w < 2) return null;
                return (
                  <i
                    key={`conn-${f.time}-${i}`}
                    className="kf-conn"
                    style={{ left: x1, width: w, background: easeConnectorColor(f.easing) }}
                    title={`${def.label} ${f.time.toFixed(2)}s → ${nextF.time.toFixed(2)}s · ${easeLabelOf(f.easing)}`}
                  />
                );
              })() : null;
              // 同组相邻关键帧（retime 钳制边界，OpenMotion beginTimelineKeyframeRetime 语义）
              const groupTimes = groupFrames.map((g) => g.time);
              const drag = (e: React.PointerEvent) => {
                if (e.button !== 0) return;
                e.preventDefault();
                e.stopPropagation();
                onSelect(f.time, e.shiftKey);
                if (e.shiftKey) return; // Shift 只改多选
                onSeek(clip.timelineStart + f.time);
                const startX = e.clientX;
                const orig = f.time;
                const idx = i;
                const minT = idx > 0 ? groupTimes[idx - 1] + minStep : 0;
                const maxT = idx < groupTimes.length - 1 ? groupTimes[idx + 1] - minStep : span;
                const move = (ev: PointerEvent) => {
                  const raw = orig + (ev.clientX - startX) / Math.max(1, pxPerSec);
                  // 帧量化 + 同组相邻钳制：不会越过兄弟关键帧，也不会粘连
                  const next = quantizeToFrame(Math.max(minT, Math.min(maxT, raw)), fps);
                  const clamped = Math.max(minT, Math.min(maxT, next));
                  if (Math.abs(clamped - orig) < 1e-6) return;
                  const list = frames.map((g) => (Math.abs(g.time - orig) < 1e-3 ? { ...g, time: clamped } : g));
                  onChange(list);
                };
                const up = () => {
                  window.removeEventListener('pointermove', move);
                  window.removeEventListener('pointerup', up);
                  window.removeEventListener('pointercancel', up);
                };
                window.addEventListener('pointermove', move);
                window.addEventListener('pointerup', up);
                window.addEventListener('pointercancel', up);
              };
              return (
                <Fragment key={`dia-${groupKey}-${f.time}-${i}`}>
                  {connector}
                  <b
                    className={`kf-dia${selectedTimes.some((t) => frameEq(t, f.time)) ? ' picked' : ''}`}
                    style={{ left: x }}
                    title={`${def.label} ${f.time.toFixed(2)}s · ${def.fmt ? def.fmt(f) : ''} · 段缓动 ${easeLabelOf(f.easing)}（点击定位，拖动改时间，Shift 多选，右键菜单）`}
                    onPointerDown={drag}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onContext(e, f.time, groupKey);
                    }}
                  />
                </Fragment>
              );
            })}
          </div>
        );
      })}
    </div>
  );
};

/* ============================ FX 参数自动化 lane ============================ */

/**
 * 单个 FX 自动化 lane 的渲染描述：第 nodeIndex 个效果节点的 paramKey 参数，
 * 断点（写入时已归一化：帧量化、升序、v 夹紧到注册表范围）与取值范围。
 */
interface FxAutomationLaneDef {
  nodeIndex: number;
  paramKey: string;
  /** lane 标签的节点短名（EQ/压缩/延迟…，与 Inspector 路径条 chips 同表） */
  nodeLabel: string;
  def: AudioFxParamDef;
  points: AudioFxAutomationPoint[];
  /** 无断点时的静态种子值（单点插值 fallback） */
  seed: number;
}

/** 片段的全部 FX 自动化 lane：bypass 节点跳过（预览/导出同样不生效），参数键走注册表白名单 */
const fxAutomationLanesOf = (clip: TimelineClip): FxAutomationLaneDef[] => {
  const out: FxAutomationLaneDef[] = [];
  const nodes = clip.audioFx?.nodes ?? [];
  for (let i = 0; i < nodes.length; i += 1) {
    const n = nodes[i];
    if (!n || n.bypass === true || !n.automation) continue;
    for (const def of AUDIO_FX_PARAM_DEFS[n.type] ?? []) {
      const points = n.automation[def.key];
      if (!Array.isArray(points) || points.length === 0) continue;
      out.push({ nodeIndex: i, paramKey: def.key, nodeLabel: AUDIO_FX_TYPE_SHORT[n.type], def, points, seed: n.params[def.key] });
    }
  }
  return out;
};

/**
 * FX 参数自动化 lane（OpenMotion TimelineAutomationLane 对齐，音量包络同款交互）：
 * 音频片段行展开后，每个「FX:节点·参数」各占一行 28px（KF_LANE_H），画该参数的
 * 包络折线（v = 参数绝对值，纵向映射随注册表范围）。双击加点（v 取该处插值）、
 * 拖点改 t/v（t 帧量化、v 夹紧范围、不越过相邻点）、右键删点（只剩 1 点时右键
 * 清除该参数自动化）。单点也画：横贯整行的虚线 = 「端点外保持」语义。
 * 只画音频轨片段：画面片段上的 FX 镜像到 auto: 内嵌音频（不落 A 行），
 * 其自动化从检查器开关进出，不在时间线重复呈现。
 */
const ClipFxAutomationLanes = ({
  clip,
  lanes,
  leftPx,
  span,
  pxPerSec,
  fps,
  onChange,
}: {
  clip: TimelineClip;
  lanes: FxAutomationLaneDef[];
  /** 片段在行内的显示左缘（px）：拖动/拾取中包络跟着片段走（与关键帧 lane 同款） */
  leftPx: number;
  span: number;
  pxPerSec: number;
  fps: number;
  /** 落库：改某节点某参数的断点；null = 清除该参数自动化 */
  onChange: (nodeIndex: number, paramKey: string, points: AudioFxAutomationPoint[] | null) => void;
}) => {
  if (!lanes.length || span <= 0) return null;
  const H = KF_LANE_H;
  const minStep = 1 / Math.max(1, fps);
  const rightPx = leftPx + span * pxPerSec;
  // 断点横坐标（行内绝对 px，两端 1–2px 收边）；纵向按参数范围映射（顶=max，底=min）
  const xOf = (t: number) => Math.max(leftPx + 1, Math.min(rightPx - 2, leftPx + t * pxPerSec));
  const yFor = (lane: FxAutomationLaneDef, v: number) => {
    const range = Math.max(1e-9, lane.def.max - lane.def.min);
    // ratio 0 = 参数下限（行底），1 = 上限（行顶）；上下各留 3px 收边
    const ratio = (Math.max(lane.def.min, Math.min(lane.def.max, v)) - lane.def.min) / range;
    return 3 + (1 - ratio) * (H - 6);
  };
  return (
    <div
      className="fx-lanes"
      id={`fx-lanes-${clip.id}`}
      role="group"
      aria-label={`${clipLabel(clip)} FX 参数自动化 lane`}
      style={{ height: lanes.length * H }}
    >
      {lanes.map((lane, li) => {
        const points = [...lane.points].sort((a, b) => a.t - b.t);
        const record = { [lane.paramKey]: points };
        const change = (next: AudioFxAutomationPoint[]) => onChange(lane.nodeIndex, lane.paramKey, next);
        // 首点之前 / 末点之后保持端点值：横向补保持虚线（y=端点值；单点时横贯整行）
        const holds: Array<{ x1: number; x2: number; v: number }> = [];
        if (points.length === 1) holds.push({ x1: leftPx + 1, x2: rightPx - 2, v: points[0].v });
        else {
          if (points[0].t > 0) holds.push({ x1: leftPx + 1, x2: xOf(points[0].t), v: points[0].v });
          if (points[points.length - 1].t < span) holds.push({ x1: xOf(points[points.length - 1].t), x2: rightPx - 2, v: points[points.length - 1].v });
        }
        return (
          <div
            key={`${lane.nodeIndex}-${lane.paramKey}`}
            className="fx-lane"
            data-fx-param={lane.paramKey}
            style={{ height: H, bottom: (lanes.length - 1 - li) * H }}
          >
            <span className="kf-lane-tag">{`FX:${lane.nodeLabel}·${lane.def.label}`}</span>
            <svg
              width="100%"
              height={H}
              onDoubleClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                // 双击加点：v 取该处折线插值（不改变当前包络形状），t 帧量化
                const rect = e.currentTarget.getBoundingClientRect();
                const t = quantizeToFrame(
                  Math.max(0, Math.min(span, (e.clientX - rect.left - leftPx) / Math.max(1, pxPerSec))),
                  fps,
                );
                change([...points, { t, v: paramAt(record, lane.paramKey, t, lane.seed) }]);
              }}
            >
              {holds.map((h, hi) => (
                h.x2 - h.x1 > 1 ? (
                  <line key={`hold-${hi}`} className="fx-lane-hold" x1={h.x1} x2={h.x2} y1={yFor(lane, h.v)} y2={yFor(lane, h.v)} />
                ) : null
              ))}
              {points.length > 1 ? (
                <>
                  <polyline
                    className="fx-lane-hit"
                    points={points.map((p) => `${xOf(p.t).toFixed(2)},${yFor(lane, p.v).toFixed(2)}`).join(' ')}
                  />
                  <polyline
                    className="fx-lane-line"
                    points={points.map((p) => `${xOf(p.t).toFixed(2)},${yFor(lane, p.v).toFixed(2)}`).join(' ')}
                  />
                </>
              ) : null}
              {points.map((p, i) => {
                const prev = points[i - 1];
                const next = points[i + 1];
                const minT = prev ? prev.t + minStep : 0;
                const maxT = next ? next.t - minStep : span;
                const drag = (e: React.PointerEvent) => {
                  if (e.button !== 0) return;
                  e.preventDefault();
                  e.stopPropagation();
                  const startX = e.clientX;
                  const startY = e.clientY;
                  const orig = p;
                  const range = Math.max(1e-9, lane.def.max - lane.def.min);
                  const move = (ev: PointerEvent) => {
                    // 帧量化 + 相邻钳制（与音量包络同款）；纵向 1:1 映射参数范围
                    const t = quantizeToFrame(
                      Math.max(minT, Math.min(maxT, orig.t + (ev.clientX - startX) / Math.max(1, pxPerSec))),
                      fps,
                    );
                    const v = Math.max(lane.def.min, Math.min(lane.def.max, orig.v - ((ev.clientY - startY) * range) / (H - 6)));
                    change(points.map((q, qi) => (qi === i ? { t, v } : q)));
                  };
                  const up = () => {
                    window.removeEventListener('pointermove', move);
                    window.removeEventListener('pointerup', up);
                    window.removeEventListener('pointercancel', up);
                  };
                  window.addEventListener('pointermove', move);
                  window.addEventListener('pointerup', up);
                  window.addEventListener('pointercancel', up);
                };
                return (
                  <circle
                    key={`${p.t}-${i}`}
                    className="fx-lane-dot"
                    cx={xOf(p.t)}
                    cy={yFor(lane, p.v)}
                    r={4}
                    onPointerDown={drag}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      // 右键删点：只剩 1 个点时清除该参数自动化（lane 整行撤掉）
                      if (points.length - 1 < 1) onChange(lane.nodeIndex, lane.paramKey, null);
                      else change(points.filter((_, idx) => idx !== i));
                    }}
                  >
                    <title>
                      {`FX:${lane.nodeLabel}·${lane.def.label} t=${p.t.toFixed(2)}s ${formatAudioFxParamValue(lane.def, p.v)}（拖动改值/时间，右键删除）`}
                    </title>
                  </circle>
                );
              })}
            </svg>
          </div>
        );
      })}
    </div>
  );
};

/**
 * 片段淡入淡出把手（G11，OpenMotion TimelineClipFades 对齐）：
 * 选中片段显示左上/右上两个横向拖拽把手，拖动改头/尾淡变时长
 * （帧量化、吸附 0、与另一侧相加不超片段时长）；片段体上叠斜线示意遮罩。
 * 数据写 clip.fadeIn / fadeOut，预览透明度·音频增益与导出 fade·afade 滤镜共用。
 */
const ClipFades = ({
  clip,
  span,
  pxPerSec,
  fps,
  onChange,
}: {
  clip: TimelineClip;
  span: number;
  pxPerSec: number;
  fps: number;
  onChange: (fades: { fadeIn?: number; fadeOut?: number }) => void;
}) => {
  const fadeIn = Math.max(0, Math.min(span, clip.fadeIn ?? 0));
  const fadeOut = Math.max(0, Math.min(span, clip.fadeOut ?? 0));
  const [dragEdge, setDragEdge] = useState<'in' | 'out' | null>(null);
  const startDrag = (e: React.PointerEvent, edge: 'in' | 'out') => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const orig = edge === 'in' ? fadeIn : fadeOut;
    const other = edge === 'in' ? fadeOut : fadeIn;
    const startX = e.clientX;
    setDragEdge(edge);
    const move = (ev: PointerEvent) => {
      // 向右拖增淡入、向左拖增淡出；上限 = 片段时长 - 另一侧
      const delta = ((ev.clientX - startX) * (edge === 'in' ? 1 : -1)) / Math.max(1, pxPerSec);
      const next = Math.max(0, Math.min(span - other, orig + delta));
      // 帧量化 + 吸附 0：回到起点直接清除，不留半帧残留
      const q = next < 0.5 / Math.max(1, fps) ? 0 : quantizeToFrame(next, fps);
      if (edge === 'in') onChange({ fadeIn: q });
      else onChange({ fadeOut: q });
    };
    const up = () => {
      setDragEdge(null);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };
  const widthPx = Math.max(1, span * pxPerSec);
  const inPx = Math.min(widthPx, (fadeIn / Math.max(span, 1e-6)) * widthPx);
  const outPx = Math.min(widthPx, (fadeOut / Math.max(span, 1e-6)) * widthPx);
  return (
    <div className={`clip-fades${dragEdge ? ' dragging' : ''}`}>
      {fadeIn > 0 || fadeOut > 0 ? (
        <svg className="clip-fade-ramps" aria-hidden="true" viewBox={`0 0 ${widthPx} 100`} preserveAspectRatio="none">
          {fadeIn > 0 ? <polygon className="fade-shade" points={`0,0 ${inPx.toFixed(2)},0 0,100`} /> : null}
          {fadeOut > 0 ? <polygon className="fade-shade" points={`${(widthPx - outPx).toFixed(2)},0 ${widthPx},0 ${widthPx},100`} /> : null}
          {fadeIn > 0 ? <line className="fade-line" x1={0} y1={100} x2={inPx.toFixed(2)} y2={0} /> : null}
          {fadeOut > 0 ? <line className="fade-line" x1={(widthPx - outPx).toFixed(2)} y1={0} x2={widthPx} y2={100} /> : null}
        </svg>
      ) : null}
      <span
        className="fade-handle l"
        title={`淡入 ${fadeIn.toFixed(2)}s（拖动调整，帧量化；双击归零）`}
        onPointerDown={(e) => startDrag(e, 'in')}
        onDoubleClick={(e) => {
          e.stopPropagation();
          onChange({ fadeIn: 0 });
        }}
      />
      <span
        className="fade-handle r"
        title={`淡出 ${fadeOut.toFixed(2)}s（拖动调整，帧量化；双击归零）`}
        onPointerDown={(e) => startDrag(e, 'out')}
        onDoubleClick={(e) => {
          e.stopPropagation();
          onChange({ fadeOut: 0 });
        }}
      />
    </div>
  );
};

/**
 * 画面轨内置原声：未做音画分离时，轨道拉高后在画面片段底部显示同源波形。
 * 分离出独立音频轨后，这个条不再出现，避免同一段声音在两条轨上重复显示。
 */
const EmbeddedAudio = ({
  projectId,
  clip,
  span,
  pxPerSec,
}: {
  projectId: string;
  clip: TimelineClip;
  span: number;
  pxPerSec: number;
}) => {
  const wave = useWaveform(projectId, clip.sourceUrl);
  if (!wave || wave.peaks.length === 0) return null;
  return (
    <div className="embed-wave" aria-label="画面内置原声">
      <Waveform
        wave={wave}
        span={span}
        inPoint={clip.inPoint}
        outPoint={clip.outPoint}
        pxPerSec={pxPerSec}
        gain={clip.volume ?? 1}
      />
    </div>
  );
};

/**
 * 节拍太密（平均间隔 < 5px）时细线会糊成一片：整层隐藏（OpenMotion
 * beatsTooDense 同语义），吸附目标不受影响，只是不画线。
 */
const beatsTooDense = (times: number[], pps: number) => {
  if (times.length < 2) return false;
  return ((times[times.length - 1] - times[0]) / (times.length - 1)) * pps < 5;
};

/**
 * 轨道区背景节拍竖线（OpenMotion BeatBackgroundLines 对齐）：
 * 画进每条轨道行的背景（lane 有不透明底色，全局层会被盖住），淡色细线
 * 只出现在已分析素材的片段跨度内（映射时已裁剪）；命中（播放头压线 /
 * 拖动中磁吸命中）时加亮成 2px 红线，与磁吸引导线呼应。
 * R3 手动编辑：editable 时每根线带一个可抓的 beat 圆点（拖动 retime /
 * 右键删除 / Alt+单击删除）；圆点 pointer-events:auto、线条保持 none，
 * 片段体仍在上层，不抢片段的点击。
 */
const BeatLines = ({
  times,
  zoom,
  highlightTime,
  from,
  to,
  editable,
}: {
  times: number[];
  zoom: number;
  highlightTime: number | null;
  from: number;
  to: number;
  editable?: {
    draggingTime: number | null;
    onDragStart: (e: React.PointerEvent, time: number) => void;
    onRemove: (e: React.MouseEvent, time: number) => void;
  };
}) => {
  if (!times.length || beatsTooDense(times, zoom)) return null;
  return (
    <div className="tl-beat-lines" aria-hidden={!editable}>
      {times.map((t, i) => {
        if (t < from || t > to) return null;
        const hit = highlightTime != null && Math.abs(t - highlightTime) < 1e-3;
        const dot = editable && editable.draggingTime != null && Math.abs(t - editable.draggingTime) < 1e-3;
        return (
          <Fragment key={`${i}-${t}`}>
            <i className={hit ? 'hit' : undefined} style={{ left: TL_LEFT_PAD + t * zoom }} />
            {editable ? (
              <b
                className={dot ? 'dragging' : undefined}
                style={{ left: TL_LEFT_PAD + t * zoom }}
                title={`节拍 ${t.toFixed(2)}s（拖动移位，右键 / Alt+单击删除）`}
                onPointerDown={(e) => {
                  if (e.button !== 0) return;
                  e.preventDefault();
                  e.stopPropagation();
                  if (e.altKey) editable.onRemove(e, t);
                  else editable.onDragStart(e, t);
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  editable.onRemove(e, t);
                }}
              />
            ) : null}
          </Fragment>
        );
      })}
    </div>
  );
};

/**
 * 吸附目标分级（OpenMotion timelineSnapping 对齐）：
 * 播放头 > 片段边缘 > 节拍 > 标记 > 网格——节拍插在片段边缘之后、网格之前。
 */
type SnapType = 'playhead' | 'clip-edge' | 'beat' | 'marker' | 'grid';
type SnapTarget = { time: number; type: SnapType };
const SNAP_PRIORITY: Record<SnapType, number> = { playhead: 0, 'clip-edge': 1, beat: 2, marker: 3, grid: 4 };
const SNAP_PX = 5;
const SNAP_RELEASE_PX = 7;

/** 收集所有轨道、播放头、节拍与标记的吸附点；同一时间点保留优先级最高的语义。 */
function collectSnapTargets(input: {
  clips: TimelineClip[];
  excludeId: string;
  playhead: number;
  markers: number[];
  /** 已分析素材换算到时间线坐标的节拍（timelineStart - inPoint + beat，仅片段范围内） */
  beats: number[];
}): SnapTarget[] {
  const byTime = new Map<number, SnapTarget>();
  const add = (time: number, type: SnapType) => {
    if (!Number.isFinite(time) || time < 0) return;
    const rounded = Math.round(time * 1000) / 1000;
    const old = byTime.get(rounded);
    if (!old || SNAP_PRIORITY[type] < SNAP_PRIORITY[old.type]) byTime.set(rounded, { time: rounded, type });
  };
  for (const beat of input.beats) add(beat, 'beat');
  for (const marker of input.markers) add(marker, 'marker');
  for (const clip of input.clips) {
    if (clip.id === input.excludeId) continue;
    add(clip.timelineStart, 'clip-edge');
    add(clip.timelineStart + clipSpan(clip), 'clip-edge');
  }
  add(input.playhead, 'playhead');
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}

/** 最近吸附点；距离相同按播放头 > 片段边缘 > 节拍 > 标记 > 网格。 */
function nearestSnap(time: number, targets: SnapTarget[], thresholdSecs: number): SnapTarget | null {
  let best: SnapTarget | null = null;
  let dist = thresholdSecs + 1e-9;
  for (const target of targets) {
    const d = Math.abs(target.time - time);
    if (d < dist || (Math.abs(d - dist) < 1e-9 && best && SNAP_PRIORITY[target.type] < SNAP_PRIORITY[best.type])) {
      best = target;
      dist = d;
    }
  }
  return best;
}

/* ============================ 右键菜单项（独立小函数，便于并行改动合并） ============================ */

/** 音量包络菜单项（G12）：已有包络的片段提供「清除」入口，清空后白色增益线恢复 */
function envelopeMenuEntry(clip: TimelineClip | null, edl: EdlEditor, close: () => void) {
  if (!clip || !hasVolumeAutomation(clip)) return null;
  return (
    <button
      type="button"
      key="venv-clear"
      onClick={() => {
        edl.clearClipVolumeAutomation(clip.id);
        toast.success('已清除音量包络');
        close();
      }}
    >
      <Volume2 />音量包络：清除
    </button>
  );
}

/**
 * 人声避让菜单项（G15）：音乐/音效语义的音频片段右键「人声避让」，
 * 按对白轨人声区间一键生成压低包络（0.25 / 淡入 0.15s / 淡出 0.3s）。
 */
function duckMenuEntry(clip: TimelineClip | null, edl: EdlEditor, close: () => void) {
  if (!clip || clip.track !== 'audio' || isVoiceClip(clip)) return null;
  return (
    <button
      type="button"
      key="venv-duck"
      onClick={() => {
        const ok = edl.applyDuckUnderVoice(clip.id);
        if (ok) toast.success('已按人声生成避让包络（人声区间内压到 25%）');
        else toast.info('没有找到人声片段：把人声放在对白轨（A1）或做一次音画分离后再试');
        close();
      }}
    >
      <span style={{ fontSize: 11 }}>♪</span>人声避让
    </button>
  );
}

/**
 * 裁剪菜单项（C1，OpenMotion ClipContextMenu「Crop」同语义）：画面片段右键
 * 打开检查器并滚动到「画面→基础」的裁剪区块——本项目以 Inspector 为裁剪落点。
 */
function cropMenuEntry(clip: TimelineClip | null, edl: EdlEditor, close: () => void) {
  if (!clip || clip.track !== 'video') return null;
  return (
    <button
      type="button"
      key="clip-crop"
      title="裁掉源画面四周（左/右/上/下），预览与导出共用同一份参数"
      onClick={() => {
        edl.setSelection([clip.id]);
        // 同构检查器先切到 画面→基础；经典检查器收到裁剪事件后自己切基础页并滚动
        window.dispatchEvent(new CustomEvent('yimu:shenjian-inspector-main', { detail: 'frame' }));
        window.dispatchEvent(new CustomEvent('yimu:shenjian-inspector-crop'));
        close();
      }}
    >
      <Crop />裁剪
    </button>
  );
}

/** 关键帧右键菜单的批量动作集合（G13）：单删 / 批删 / 移到播放头 / 清除全部；
 *  R1：group 存在时追加「删该属性 / 该属性清空」；R2：缓动四选一（当前项打勾） */
function keyframeMenuEntries(input: {
  clip: TimelineClip;
  times: number[];
  playhead: number;
  fps: number;
  edl: EdlEditor;
  close: () => void;
  /** 属性 lane 内右键时带的组：菜单追加组内动作 */
  group?: KfGroupKey;
}) {
  const { clip, times, playhead, fps, edl, close, group } = input;
  const frames = clip.keyframes ?? [];
  if (!frames.length) return null;
  const eq = (a: number, b: number) => Math.abs(a - b) < 1e-3;
  const picked = frames.filter((f) => times.some((t) => eq(t, f.time)));
  const removeTimes = (list: NonNullable<TimelineClip['keyframes']>, victim: number[]) =>
    list.filter((f) => !victim.some((t) => eq(t, f.time)));
  const entries: React.ReactNode[] = [];
  if (picked.length === 1) {
    const t = picked[0].time;
    entries.push(
      <button
        type="button"
        key="kf-del"
        onClick={() => {
          edl.setClipKeyframes(clip.id, removeTimes(frames, [t]));
          toast.success(`已删除 ${t.toFixed(2)}s 的关键帧`);
          close();
        }}
      >
        <Trash2 />删除此关键帧
      </button>,
    );
  } else if (picked.length > 1) {
    entries.push(
      <button
        type="button"
        key="kf-del-multi"
        onClick={() => {
          edl.setClipKeyframes(clip.id, removeTimes(frames, times));
          toast.success(`已删除 ${picked.length} 个关键帧`);
          close();
        }}
      >
        <Trash2 />删除所选关键帧（{picked.length}）
      </button>,
    );
  }
  if (picked.length >= 1) {
    const target = Math.max(0, Math.min(clipSpan(clip), quantizeToFrame(playhead - clip.timelineStart, fps)));
    entries.push(
      <button
        type="button"
        key="kf-to-playhead"
        onClick={() => {
          // 多个关键帧移到同一播放头时合并成一个（保留第一个的运镜参数）
          const moved = { ...picked[0], time: target };
          const rest = removeTimes(frames, times).filter((f) => !eq(f.time, target));
          edl.setClipKeyframes(
            clip.id,
            [...rest, moved].sort((a, b) => a.time - b.time),
          );
          toast.success(`已移到播放头 ${target.toFixed(2)}s`);
          close();
        }}
      >
        <MapPin />移到播放头
      </button>,
    );
  }
  if (group && picked.length >= 1) {
    const def = kfGroupDef(group);
    entries.push(
      <button
        type="button"
        key="kf-del-group"
        onClick={() => {
          // 删属性语义：摘掉该组字段；关键帧摘完四个属性全空 = 整帧删除
          const pickedTimes = picked.map((f) => f.time);
          const next = frames
            .map((f) => (pickedTimes.some((t) => eq(t, f.time)) ? stripKeyframeGroup(f, group) : f))
            .filter((f): f is TimelineVideoKeyframe => f !== null);
          edl.setClipKeyframes(clip.id, next);
          toast.success(`已删除 ${picked.length} 个关键帧的${def.label}属性`);
          close();
        }}
      >
        <Trash2 />删除{def.label}属性{picked.length > 1 ? `（${picked.length} 帧）` : ''}
      </button>,
      <button
        type="button"
        key="kf-clear-group"
        onClick={() => {
          const next = frames
            .map((f) => stripKeyframeGroup(f, group))
            .filter((f): f is TimelineVideoKeyframe => f !== null);
          edl.setClipKeyframes(clip.id, next);
          toast.success(`已清空全部关键帧的${def.label}属性`);
          close();
        }}
      >
        <RotateCcw />清空全部{def.label}属性
      </button>,
    );
  }
  entries.push(
    <button
      type="button"
      key="kf-clear"
      onClick={() => {
        edl.setClipKeyframes(clip.id, []);
        toast.success('已清除全部关键帧');
        close();
      }}
    >
      <RotateCcw />清除全部关键帧
    </button>,
  );
  // R2 缓动子菜单：该字段表示「此关键帧 → 下一关键帧」段的缓动；多选时整批套用
  if (picked.length >= 1) {
    const allSame = (value: NonNullable<TimelineVideoKeyframe['easing']>) =>
      picked.every((f) => (f.easing ?? 'linear') === value);
    entries.push(<span key="kf-ease-label" className="ctx-label">缓动 · 此帧到下一帧{group ? `（${kfGroupDef(group).label}）` : ''}</span>);
    for (const opt of KF_EASE_OPTIONS) {
      entries.push(
        <button
          type="button"
          key={`kf-ease-${opt.value}`}
          onClick={() => {
            const pickedTimes = picked.map((f) => f.time);
            edl.setClipKeyframes(
              clip.id,
              frames.map((f) => (pickedTimes.some((t) => eq(t, f.time)) ? { ...f, easing: opt.value } : f)),
            );
            toast.success(`缓动已设为${opt.label}（${picked.length} 帧）`);
            close();
          }}
        >
          {opt.label}
          {allSame(opt.value) ? <span className="ease-check">✓</span> : null}
        </button>,
      );
    }
  }
  return entries;
}

export const ShenJianTimeline = ({ snapOn, setSnapOn, hideToolbar = false }: { snapOn: boolean; setSnapOn: (v: boolean) => void; hideToolbar?: boolean }) => {
  const [addOpen, setAddOpen] = useState(false);
  const { data, projectId, curT, setCurT, playing, setPreviewMode } = useStudio();
  const edl = useEdl();

  const [zoom, setZoom] = useState(44);
  const [laneH, setLaneH] = useState(57);
  /** 每条轨道单独的显示高度；未设置的轨道跟随全局行高，关键帧轨道默认展开。 */
  const [rowHeights, setRowHeights] = useState<Record<string, number>>({});
  const [tool, setTool] = useState<'select' | 'razor'>('select');
  const toolRef = useRef(tool);
  toolRef.current = tool;
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('yimu:shenjian-tool-state', { detail: tool }));
  }, [tool]);
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('yimu:shenjian-zoom-state', { detail: zoom }));
  }, [zoom]);
  // 时间/帧显示模式：与预览时间码共用一份选择（localStorage 持久化 + 事件同步）
  const [timeMode, setTimeMode] = useTimeDisplayMode();
  // 键盘拾取中的片段；空白轨区右键（空隙闭合）菜单
  const [pickup, setPickup] = useState<PickupState | null>(null);
  const [gapCtx, setGapCtx] = useState<GapCtxState>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [viewW, setViewW] = useState(900);
  useEffect(() => {
    const el = lanesRef.current;
    if (!el) return;
    const sync = () => setViewW(el.clientWidth || 900);
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const [headW, setHeadW] = useState(() => {
    const raw = Number(localStorage.getItem('yimu:om:track-head-w:v2'));
    return Number.isFinite(raw) && raw >= 104 && raw <= 260 ? raw : 132;
  });
  useEffect(() => {
    try { localStorage.setItem('yimu:om:track-head-w:v2', String(headW)); } catch { /* 会话内保留 */ }
  }, [headW]);
  const beginHeadResize = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = headW;
    const body = document.body;
    const prevCursor = body.style.cursor;
    body.style.cursor = 'col-resize';
    const onMove = (ev: PointerEvent) => setHeadW(Math.max(104, Math.min(260, startW + ev.clientX - startX)));
    const finish = () => {
      body.style.cursor = prevCursor;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', finish);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', finish, { once: true });
  };

  // React 的 wheel 监听默认 passive，preventDefault 会失效；
  // 原生 non-passive + rAF 合并：⌘/Ctrl+滚轮连续缩放，指针下的时间保持不动。
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const wheelRafRef = useRef(0);
  const wheelPendingRef = useRef(0);
  // 直接挂在 React 事件上：Dockview 会把时间线节点延后挂载，原生 addEventListener 会错过节点。
  const onTimelineWheel = (e: WheelEvent) => {
    const el = lanesRef.current;
    if (!el) return;
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const anchorX = e.clientX - rect.left;
      const anchorTime = (anchorX + el.scrollLeft - TL_LEFT_PAD) / Math.max(1, zoomRef.current);
      const base = wheelPendingRef.current || zoomRef.current;
      const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.08 : 0.0022));
      wheelPendingRef.current = Math.max(14, Math.min(240, base * factor));
      if (!wheelRafRef.current) {
        wheelRafRef.current = requestAnimationFrame(() => {
          wheelRafRef.current = 0;
          const next = wheelPendingRef.current;
          wheelPendingRef.current = 0;
          if (!next) return;
          setZoom(next);
          requestAnimationFrame(() => {
            const target = Math.max(0, anchorTime * next + TL_LEFT_PAD - anchorX);
            if (Math.abs(el.scrollLeft - target) > 0.5) el.scrollLeft = target;
            setScrollLeft(el.scrollLeft);
          });
        });
      }
    } else if (e.altKey) {
      e.preventDefault();
      el.scrollLeft += e.deltaY;
      setScrollLeft(el.scrollLeft);
    }
  };
  const [drag, setDrag] = useState<DragState | null>(null);
  /** 节拍点拖动预览（R3）：src=源媒体秒，at=拖动中的时间线秒；松手写 moveManualBeat */
  const [beatDrag, setBeatDrag] = useState<{ src: number; at: number; moved: boolean } | null>(null);
  const [marquee, setMarquee] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const [snapGuide, setSnapGuide] = useState<SnapTarget | null>(null);
  const snapTargetRef = useRef<SnapTarget | null>(null);
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const hoverTimerRef = useRef<number | null>(null);
  const hoverRafRef = useRef<number | null>(null);
  const hoverVisibleRef = useRef(false);
  const hoverLatestRef = useRef(0);

  const clearHover = () => {
    if (hoverTimerRef.current) window.clearTimeout(hoverTimerRef.current);
    if (hoverRafRef.current) cancelAnimationFrame(hoverRafRef.current);
    hoverTimerRef.current = null;
    hoverRafRef.current = null;
    hoverVisibleRef.current = false;
    setHoverTime(null);
  };

  const trackHover = (clientX: number, el: HTMLElement) => {
    if (drag || beatDrag || playing) return;
    const rect = el.getBoundingClientRect();
    const time = Math.max(0, (clientX - rect.left + el.scrollLeft - TL_LEFT_PAD) / zoom);
    hoverLatestRef.current = time;
    const publish = () => {
      hoverRafRef.current = null;
      setHoverTime(hoverLatestRef.current);
    };
    if (hoverVisibleRef.current) {
      if (!hoverRafRef.current) hoverRafRef.current = requestAnimationFrame(publish);
      return;
    }
    if (hoverTimerRef.current) window.clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = window.setTimeout(() => {
      hoverTimerRef.current = null;
      hoverVisibleRef.current = true;
      publish();
    }, 120);
  };
  /**
   * 剃刀引导线：跟随指针的红色竖线（一幕红）。
   * 参考 OpenMotion TimelineRazorInteraction——只写 transform，不触发重渲染。
   */
  const razorGuideRef = useRef<HTMLDivElement | null>(null);
  const razorRafRef = useRef(0);
  const razorClientXRef = useRef(0);
  const moveRazorGuide = useCallback((clientX: number) => {
    if (toolRef.current !== 'razor') return;
    razorClientXRef.current = clientX;
    if (razorRafRef.current) return;
    razorRafRef.current = requestAnimationFrame(() => {
      razorRafRef.current = 0;
      const guide = razorGuideRef.current;
      const wrap = lanesRef.current;
      if (!guide || !wrap) return;
      const rect = wrap.getBoundingClientRect();
      const x = razorClientXRef.current - rect.left + wrap.scrollLeft - TL_LEFT_PAD;
      guide.style.transform = `translateX(${x}px)`;
      guide.style.visibility = x >= 0 ? 'visible' : 'hidden';
    });
  }, []);
  const hideRazorGuide = useCallback(() => {
    if (razorRafRef.current) {
      cancelAnimationFrame(razorRafRef.current);
      razorRafRef.current = 0;
    }
    if (razorGuideRef.current) razorGuideRef.current.style.visibility = 'hidden';
  }, []);
  // 工具切走时立即收线
  useEffect(() => {
    if (tool !== 'razor') hideRazorGuide();
    return hideRazorGuide;
  }, [tool, hideRazorGuide]);

  const [ctx, setCtx] = useState<CtxState>(null);
  /** 关键帧右键菜单（G13）：菜单位置 + 片段 + Shift 多选的关键帧时间；group = 属性 lane 内右键（组内菜单） */
  const [kCtx, setKCtx] = useState<{ x: number; y: number; id: string; times: number[]; group?: KfGroupKey } | null>(null);
  /** Shift+点击菱形的当前多选（切换片段时重置） */
  const [kfSel, setKfSel] = useState<{ id: string; times: number[] } | null>(null);
  /**
   * 关键帧属性 lane 的展开态（R1）：clipId → 开/关。
   * 选中「有关键帧的画面片段」时默认展开一次（useAutoExpandKeyframedClips 语义）；
   * 一旦手动展开/收起（写入显式 true/false），本次会话不再自动改，收起后不反弹。
   */
  const [kfLaneOpen, setKfLaneOpen] = useState<Record<string, boolean>>({});
  const [dragOver, setDragOver] = useState<{ track: TimelineTrackKind; lane: number; at: number; created: boolean } | null>(null);

  const lanesRef = useRef<HTMLDivElement | null>(null);
  const wheelHandlerRef = useRef<(e: WheelEvent) => void>(() => {});
  const wheelListenerRef = useRef<((e: WheelEvent) => void) | null>(null);
  const bindLanes = useCallback((el: HTMLDivElement | null) => {
    const prev = lanesRef.current;
    if (prev && wheelListenerRef.current) prev.removeEventListener('wheel', wheelListenerRef.current);
    lanesRef.current = el;
    if (!el) { wheelListenerRef.current = null; return; }
    const fn = (ev: WheelEvent) => wheelHandlerRef.current(ev);
    wheelListenerRef.current = fn;
    el.addEventListener('wheel', fn, { passive: false });
  }, []);
  wheelHandlerRef.current = onTimelineWheel;
  const clips = data.timeline?.clips ?? [];
  // 节拍吸附（W6）：store 里按 assetId 存节拍，这里取「第一个命中已分析素材的
  // 音频片段」换算成时间线坐标；拖动该片段时旧位置的节拍不参与吸附。
  const beatsSnapshot = useBeatsSnapshot();
  const beatTimes = useMemo(
    () => activeBeatTimes(clips, beatsSnapshot.byAsset, drag?.id ?? null, beatsSnapshot.manualEdits),
    [clips, beatsSnapshot.byAsset, beatsSnapshot.manualEdits, drag?.id],
  );
  // 节拍高亮：拖动/修剪中磁吸命中的节拍，或播放头压住的节拍（±0.5px 内）
  const beatHighlight = useMemo<number | null>(() => {
    if (snapGuide?.type === 'beat') return snapGuide.time;
    const halfPx = 0.5 / zoom;
    for (const t of beatTimes) {
      if (Math.abs(t - curT) <= halfPx) return t;
    }
    return null;
  }, [snapGuide, beatTimes, curT, zoom]);
  /* ---------------- 节拍手动编辑（R3）：拖 beat 点 retime / 右键删 / Alt+单击加 ---------------- */
  /** 当前吸附所用的那条音频片段（activeBeatTimes 同一条选段规则），节拍编辑落在它身上 */
  const beatEditTarget = useMemo(() => {
    const clip = activeBeatClip(clips, beatsSnapshot.byAsset, drag?.id ?? null);
    if (!clip?.sourceAssetId) return null;
    return { clip, assetId: clip.sourceAssetId };
  }, [clips, beatsSnapshot.byAsset, drag?.id]);
  const beatSpanOf = (clip: BeatSourceClip) => Math.max(0, (clip.outPoint - clip.inPoint) / (clip.speed > 0 ? clip.speed : 1));
  /** BeatLines 的可编辑挂载：拖动（本地预览，松手一次提交）/ 右键与 Alt 删除 */
  const beatEditable = useMemo(() => {
    if (!beatEditTarget) return null;
    const { clip, assetId } = beatEditTarget;
    const span = beatSpanOf(clip);
    const toSrc = (t: number) => timelineToSourceBeat(clip, t);
    return {
      draggingTime: beatDrag?.at ?? null,
      onDragStart: (e: React.PointerEvent, time: number) => {
        const wrap = lanesRef.current;
        if (!wrap) return;
        const rect = wrap.getBoundingClientRect();
        let st = { src: toSrc(time), at: time, moved: false };
        setBeatDrag(st);
        const move = (ev: PointerEvent) => {
          const raw = (ev.clientX - rect.left + wrap.scrollLeft - TL_LEFT_PAD) / zoom;
          const clamped = Math.max(clip.timelineStart, Math.min(clip.timelineStart + span, raw));
          const at = Math.max(clip.timelineStart, Math.min(clip.timelineStart + span, quantizeToFrame(clamped, edl.fps)));
          if (Math.abs(at - st.at) < 1e-6) return;
          st = { ...st, at, moved: true };
          setBeatDrag(st);
        };
        const up = () => {
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', up);
          window.removeEventListener('pointercancel', up);
          if (st.moved) moveManualBeat(assetId, st.src, toSrc(st.at));
          setBeatDrag(null);
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
        window.addEventListener('pointercancel', up);
      },
      onRemove: (_e: React.MouseEvent, time: number) => {
        if (removeManualBeat(assetId, toSrc(time))) toast.success(`已删除 ${time.toFixed(2)}s 的节拍`);
      },
    };
  }, [beatEditTarget, beatDrag?.at, zoom, edl.fps]);
  // 拖动中的节拍点本地预览：旧位置的线让位给拖动中的位置（吸附目标仍用 beatTimes）
  const beatDisplayTimes = useMemo(() => {
    if (!beatDrag || !beatEditTarget) return beatTimes;
    const orig = sourceBeatToTimeline(beatEditTarget.clip, beatDrag.src);
    return beatTimes.filter((t) => Math.abs(t - orig) > 0.008).concat([beatDrag.at]).sort((a, b) => a - b);
  }, [beatTimes, beatDrag, beatEditTarget]);
  // 内容末端与「时间轴最小可滚动长度」是两件事：20s 只是空白基线，
  // 不能拿来当片长显示，否则 5s 成片会在 footer 里写成 20s。
  const contentTotal = useMemo(
    () => Math.max(0, ...clips.map((c) => c.timelineStart + clipSpan(c))),
    [clips],
  );
  const total = useMemo(
    () => Math.max(20, data.totalSec || 0, contentTotal),
    [data.totalSec, contentTotal],
  );
  // 首次进入按真实片长铺满时间线（参考 OpenMotion 默认“适应窗口”），
  // 不被 20s 空基线撑开，也不能把 6s 成片只占左侧三分之一。
  const didFitRef = useRef(false);
  useEffect(() => {
    if (didFitRef.current || !data.timeline) return;
    const el = lanesRef.current;
    const cw = el?.clientWidth ?? 0;
    if (cw < 240) return;
    const realTotal = Math.max(0.5, contentTotal || 20);
    didFitRef.current = true;
    setZoom(Math.max(14, Math.min(240, (cw - TL_LEFT_PAD - 24) / realTotal)));
    setScrollLeft(0);
    if (el) el.scrollLeft = 0;
  }, [contentTotal, data.timeline, viewW]);

  const rows = useMemo<Row[]>(() => {
    // 轨道行只由「实际有素材的 lane」决定；某类素材一个都没有时，该类轨道完全不出现。
    // 唯一例外：已有字幕但还没有主画面轨时，补一条空 V1 落点，保证字幕永远压在一个画面轨之上。
    const videoSet = new Set(clips.filter((c) => c.track === 'video').map((c) => c.lane ?? 0));
    // auto: 开头的音频是「内嵌原声」，不单独占行；只有被音画分离/独立导入的音频才出 A 轨。
    const audioLanes = Array.from(
      new Set(
        clips
          .filter((c) => c.track === 'audio')
          .filter((c) => {
            const lane = c.lane ?? 0;
            return clips.some(
              (x) =>
                x.track === 'audio' &&
                (x.lane ?? 0) === lane &&
                !x.bindGroup?.startsWith('auto:'),
            );
          })
          .map((c) => c.lane ?? 0),
      ),
    ).sort((a, b) => a - b);
    // 同类型轨道内用 meta.order 控制上下位置；未设置时：字幕/画面按 lane 从高到低，音频按 lane 从低到高。
    const orderOf = (track: TimelineTrackKind, lane: number) => {
      const meta = (edl.tracks ?? []).find((t) => t.track === track && (t.lane ?? 0) === lane);
      return meta?.order ?? (track === 'audio' ? lane : -lane);
    };
    const subLanesSorted = Array.from(new Set(clips.filter((c) => c.track === 'subtitle').map((c) => c.lane ?? 0)))
      .sort((a, b) => orderOf('subtitle', a) - orderOf('subtitle', b));
    if (subLanesSorted.length > 0) videoSet.add(0);
    const videoLanes = Array.from(videoSet).sort((a, b) => orderOf('video', a) - orderOf('video', b));
    const metaOf = (track: TimelineTrackKind, lane: number) =>
      (edl.tracks ?? []).find((t) => t.track === track && (t.lane ?? 0) === lane);
    // 画面片段的稳定业务标识 → 画面轨。音画分离后 A 轨要贴在原画面轨旁边，
    // id 每次落库会重生成，所以优先用 clientKey/originClipKey，老数据再用同源时间回退。
    const videoByKey = new Map<string, TimelineClip>();
    for (const v of clips.filter((c) => c.track === 'video')) {
      videoByKey.set(v.id, v);
      if (v.clientKey) videoByKey.set(v.clientKey, v);
    }
    const pairLaneOf = (audioLane: number): number | undefined => {
      const a = clips.find((c) => c.track === 'audio' && (c.lane ?? 0) === audioLane);
      if (!a) return undefined;
      if (a.bindGroup?.startsWith('av:') || a.bindGroup?.startsWith('auto:')) {
        const key = a.bindGroup.slice(a.bindGroup.startsWith('av:') ? 3 : 5);
        const v = videoByKey.get(key);
        if (v) return v.lane ?? 0;
      }
      const v = clips.find((c) => c.track === 'video' && sameOrigin(a, c, edl.fps));
      return v ? (v.lane ?? 0) : undefined;
    };
    const audioRows: Row[] = audioLanes.map((lane) => {
      const meta = metaOf('audio', lane);
      const paired = pairLaneOf(lane);
      return {
        key: `audio:${lane}`,
        no: 0,
        track: 'audio' as const,
        lane,
        label: `A${lane + 1}`,
        name: meta?.name || (paired != null ? `原声 · V${paired + 1}` : lane === 0 ? '原声 / 对白' : lane === 1 ? '音乐' : '音效'),
        visible: true,
        muted: meta?.muted === true,
        locked: meta?.locked === true,
        pairedVideoLane: paired,
      };
    });
    const out: Row[] = [];
    const pushAudio = (row: Row) => out.push(row);
    const pushVideo = (lane: number) => {
      const meta = metaOf('video', lane);
      out.push({
        key: `video:${lane}`,
        no: 0,
        track: 'video',
        lane,
        label: `V${lane + 1}`,
        name: meta?.name || (lane === 0 ? '画面主轨' : '叠加画面'),
        visible: meta?.exportEnabled !== false,
        muted: meta?.muted === true,
        locked: meta?.locked === true,
      });
      // 音画分离后的原声紧贴这条画面轨，不再沉到所有轨道最底部。
      for (const a of audioRows) if (a.pairedVideoLane === lane) pushAudio(a);
    };
    // 固定图层顺序：字幕层最上 → 视频层中间 → 音频层最下。
    for (const lane of subLanesSorted) {
      const meta = metaOf('subtitle', lane);
      out.push({
        key: `subtitle:${lane}`,
        no: 0,
        track: 'subtitle',
        lane,
        label: `T${lane + 1}`,
        name: meta?.name || '字幕 / 文本',
        visible: true,
        muted: meta?.muted === true,
        locked: meta?.locked === true,
      });
    }
    for (const lane of videoLanes) pushVideo(lane);
    // 没有画面来源的音频（配乐/音效/独立导入）仍按底部音频区排列。
    for (const a of audioRows) if (a.pairedVideoLane == null) pushAudio(a);
    // 轨道编号与顺序绑定：上下滑动、增删轨道后仍跟随。
    // 显示标签按同类型内的出现顺序计数（V1/A1/T1），不受 lane 空洞影响。
    const seen: Record<string, number> = { video: 0, audio: 0, subtitle: 0 };
    const prefixOf: Record<string, string> = { video: 'V', audio: 'A', subtitle: 'T' };
    out.forEach((r, i) => {
      r.no = i + 1;
      seen[r.track] = (seen[r.track] ?? 0) + 1;
      r.label = `${prefixOf[r.track]}${seen[r.track]}`;
    });
    return out;
  }, [clips, edl.tracks, edl.fps]);

  // 参考版主画面轨 64、其余 48；用户按轨道头 −/＋ 后单独覆盖。
  const defaultRowH = useCallback((row: Row) => {
    if (row.track === 'video') return Math.max(TL_VIDEO_ROW_H, laneH + 7);
    return Math.max(TL_AUDIO_ROW_H, laneH - 9);
  }, [laneH]);
  /**
   * 展开区给行加高：画面片段的关键帧属性 lane（R1，N组 × KF_LANE_H）+
   * 音频片段的 FX 参数自动化 lane（N参数 × KF_LANE_H），叠加在用户行高之上；
   * rowTops 累加 rowH，后续行整体下移（单点生效）。auto: 内嵌原声不落 A 行，
   * 也就不占加高（与 rowClips / rowFxAutomationClips 的过滤口径一致）。
   */
  const laneExtraOf = useCallback(
    (row: Row) => {
      let extra = 0;
      for (const c of clips) {
        if ((c.lane ?? 0) !== row.lane || !kfLaneOpen[c.id]) continue;
        if (c.track === 'video') extra += kfGroupsOf(c.keyframes).length * KF_LANE_H;
        else if (c.track === 'audio' && !c.bindGroup?.startsWith('auto:')) extra += fxAutomationLanesOf(c).length * KF_LANE_H;
      }
      return extra;
    },
    [clips, kfLaneOpen],
  );
  const rowH = useMemo<Record<string, number>>(() => {
    const map: Record<string, number> = {};
    for (const r of rows) map[r.key] = (rowHeights[r.key] ?? defaultRowH(r)) + laneExtraOf(r);
    return map;
  }, [rows, rowHeights, defaultRowH, laneExtraOf]);
  const rowTops = useMemo(() => {
    let top = TL_TOP_PAD;
    return rows.map((r) => {
      const at = top;
      top += rowH[r.key] ?? TL_VIDEO_ROW_H;
      return at;
    });
  }, [rows, rowH]);
  const rowIndexAt = useCallback((y: number) => {
    if (!rows.length) return -1;
    // 负值＝指针在第一条轨道上方：这是“往上拖新建一行”的空白区，不能吸到第一行。
    if (y < 0) return -1;
    let hit = rows.length - 1;
    for (let i = 0; i < rows.length; i += 1) {
      if (y < (rowTops[i] ?? TL_TOP_PAD) + (rowH[rows[i].key] ?? TL_VIDEO_ROW_H)) { hit = i; break; }
    }
    return hit;
  }, [rows, rowTops, rowH]);
  const nudgeRowHeight = (row: Row, delta: number) => {
    const current = rowH[row.key] ?? defaultRowH(row);
    const next = Math.max(44, Math.min(260, current + delta));
    setRowHeights((h) => ({ ...h, [row.key]: next }));
  };

  // 只有「不挂在画面旁」的底部音频才需要基线；分离原声已经并排，不压基线。
  const unpairedAudioRows = rows.filter((r) => r.track === 'audio' && r.pairedVideoLane == null).length;
  const aboveRows = rows.length - unpairedAudioRows;
  const baselineTop = TL_RULER_H + rows.slice(0, Math.max(0, aboveRows)).reduce((sum, r) => sum + (rowH[r.key] ?? TL_VIDEO_ROW_H), 0);
  const width = Math.max(900, TL_LEFT_PAD + total * zoom + 260);
  const step = zoom >= 60 ? 1 : zoom >= 30 ? 5 : zoom >= 16 ? 10 : 20;
  const ticks = useMemo(() => Array.from({ length: Math.ceil((total + step) / step) + 1 }, (_, i) => i * step), [total, step]);

  const maxLaneOf = useCallback(
    (track: TimelineTrackKind) => {
      const lanes = clips.filter((c) => c.track === track).map((c) => c.lane ?? 0);
      return lanes.length ? Math.max(...lanes) : -1;
    },
    [clips],
  );

  /**
   * 跨轨分级吸附：
   * - 片段起点和终点都参与，左右边缘都能贴；
   * - 5px 吸附、7px 释放，已经吸住后不会被微小抖动甩开；
   * - 播放头 > 片段边缘 > 节拍 > 标记 > 网格。
   */
  const snapMove = useCallback(
    (id: string, rawStart: number, span: number): { start: number; target: SnapTarget | null } => {
      if (!snapOn) return { start: rawStart, target: null };
      const targets = collectSnapTargets({ clips, excludeId: id, playhead: curT, markers: edl.markers, beats: beatTimes });
      const sticky = snapTargetRef.current;
      if (sticky) {
        // 已经吸住时，只要任一被吸附的边缘仍在 7px 释放区内，就保持不动；
        // 超过释放区才允许离开，避免手抖在吸附点附近来回跳。
        const stickStart = Math.abs(rawStart - sticky.time) * zoom < SNAP_RELEASE_PX;
        const stickEnd = Math.abs(rawStart + span - sticky.time) * zoom < SNAP_RELEASE_PX;
        if (stickStart || stickEnd) {
          return { start: stickStart ? sticky.time : sticky.time - span, target: sticky };
        }
      }
      const startHit = nearestSnap(rawStart, targets, SNAP_PX / zoom);
      const endHit = nearestSnap(rawStart + span, targets, SNAP_PX / zoom);
      const pick = !startHit ? endHit : !endHit ? startHit
        : Math.abs(startHit.time - rawStart) <= Math.abs(endHit.time - (rawStart + span)) ? startHit : endHit;
      if (!pick) return { start: rawStart, target: null };
      snapTargetRef.current = pick;
      return {
        start: pick === startHit ? pick.time : pick.time - span,
        target: pick,
      };
    },
    [clips, curT, beatTimes, edl.markers, snapOn, zoom],
  );

  const snapEdge = useCallback(
    (id: string, raw: number): { time: number; target: SnapTarget | null } => {
      if (!snapOn) return { time: raw, target: null };
      const targets = collectSnapTargets({ clips, excludeId: id, playhead: curT, markers: edl.markers, beats: beatTimes });
      const hit = nearestSnap(raw, targets, SNAP_PX / zoom);
      snapTargetRef.current = hit;
      return { time: hit?.time ?? raw, target: hit };
    },
    [clips, curT, beatTimes, edl.markers, snapOn, zoom],
  );

  const applyPointerMove = useCallback((e: { clientX: number; clientY: number }) => {
    if (!drag) return;
    const dx = (e.clientX - drag.startX) / zoom;
    if (drag.kind === 'move') {
      const snap = snapMove(drag.id, drag.origStart + dx, drag.origSpan);
      const snapped = snap.start;
      setSnapGuide(snap.target);
      // 垂直跨轨：以鼠标落在左侧轨道头的同一行判定，实时给出目标轨道
      let targetRowKey = drag.targetRowKey;
      let lane = drag.lane;
      let insertAt: 'top' | 'bottom' | undefined = drag.insertAt;
      const wrap = lanesRef.current;
      let pointerY: number | undefined;
      if (wrap) {
        const rect = wrap.getBoundingClientRect();
        // 靠近边缘自动滚动：指针停住也能持续把后面的轨道/时间带进来
        const edge = 56;
        let scrolled = false;
        if (e.clientX > rect.right - edge) { wrap.scrollLeft += 18; scrolled = true; }
        else if (e.clientX < rect.left + edge) { wrap.scrollLeft -= 18; scrolled = true; }
        if (e.clientY > rect.bottom - 40) { wrap.scrollTop += 14; scrolled = true; }
        else if (e.clientY < rect.top + 40) { wrap.scrollTop -= 14; scrolled = true; }
        if (scrolled) { setScrollLeft(wrap.scrollLeft); setScrollTop(wrap.scrollTop); }
        const y = e.clientY - rect.top + wrap.scrollTop - TL_RULER_H;
        pointerY = y;
        const idx = rowIndexAt(y);
        const row = rows[idx];
        if (row && row.track === drag.track && !row.locked) {
          targetRowKey = row.key;
          lane = row.lane;
        } else if (!row || row.track !== drag.track) {
          // 空白区或别的类型轨道：在同类轨道区按指针方向插入新轨（往上拖就插到顶部）
          targetRowKey = undefined;
          lane = maxLaneOf(drag.track) + 1;
        }
        if (!targetRowKey) {
          const same = rows.filter((r) => r.track === drag.track);
          if (same.length) {
            const first = rows.indexOf(same[0]);
            const last = rows.indexOf(same[same.length - 1]);
            const topEdge = rowTops[first] ?? 0;
            const bottomEdge = (rowTops[last] ?? 0) + (rowH[rows[last].key] ?? laneH);
            insertAt = y < topEdge + (rowH[same[0].key] ?? laneH) / 2 ? 'top'
              : y > bottomEdge - (rowH[same[same.length - 1].key] ?? laneH) / 2 ? 'bottom'
              : y < (topEdge + bottomEdge) / 2 ? 'top' : 'bottom';
          } else {
            insertAt = 'top';
          }
        }
      }
      setDrag({ ...drag, dx: snapped - drag.origStart, span: drag.origSpan, lane, targetRowKey, created: !targetRowKey, pointerX: e.clientX, pointerY, insertAt });
    } else if (drag.kind === 'trim-l') {
      const rawLeft = drag.origStart + dx;
      const snapped = snapEdge(drag.id, rawLeft);
      setSnapGuide(snapped.target);
      const d = Math.max(-drag.origSpan + 0.15, Math.min(drag.origSpan - 0.15, snapped.time - drag.origStart));
      setDrag({ ...drag, dx: d, span: drag.origSpan - d, origStart: drag.origStart + d });
    } else {
      // 右边缘只能拉到源视频结尾：20s 素材最多 20s，不能无限延长。
      const maxSpan = drag.maxSpan ?? Number.POSITIVE_INFINITY;
      const rawRight = drag.origStart + drag.origSpan + dx;
      const snapped = snapEdge(drag.id, Math.min(drag.origStart + maxSpan, rawRight));
      setSnapGuide(snapped.target);
      const d = Math.max(0.15 - drag.origSpan, Math.min(maxSpan - drag.origSpan, snapped.time - drag.origStart - drag.origSpan));
      setDrag({ ...drag, dx: d, span: Math.min(maxSpan, drag.origSpan + d) });
    }
  }, [drag, lanesRef, laneH, maxLaneOf, rowIndexAt, rows, snapEdge, snapMove, zoom]);

  // 单一手势层：pointermove 可能 120Hz+，每帧最多推进一次，避免整条时间线被事件频率拖着重渲染。
  const pendingPointRef = useRef<{ clientX: number; clientY: number } | null>(null);
  const moveRafRef = useRef(0);
  const flushMove = useCallback(() => {
    moveRafRef.current = 0;
    const point = pendingPointRef.current;
    pendingPointRef.current = null;
    if (point) applyPointerMove(point);
  }, [applyPointerMove]);
  const onPointerMove = useCallback((e: PointerEvent) => {
    pendingPointRef.current = { clientX: e.clientX, clientY: e.clientY };
    if (!moveRafRef.current) moveRafRef.current = requestAnimationFrame(flushMove);
  }, [flushMove]);

  const finishDrag = useCallback(() => {
    if (moveRafRef.current) { cancelAnimationFrame(moveRafRef.current); moveRafRef.current = 0; }
    pendingPointRef.current = null;
    if (!drag) return;
    snapTargetRef.current = null;
    setSnapGuide(null);
    if (drag.kind === 'move' && (Math.abs(drag.dx) > 0.01 || drag.lane !== (clips.find((c) => c.id === drag.id)?.lane ?? 0))) {
      const sourceClip = clips.find((c) => c.id === drag.id);
      const sameLane = drag.lane === (sourceClip?.lane ?? 0);
      edl.moveClipToLane(drag.id, Math.max(0, drag.origStart + drag.dx), drag.lane, !sameLane);
      if (!sameLane) {
        // 新轨落在同类轨道区的顶部还是底部：写 meta.order，rows 会按它重排。
        const sameRows = rows.filter((r) => r.track === drag.track);
        const orderOfRow = (r: Row) => {
          const meta = (edl.tracks ?? []).find((t) => t.track === r.track && (t.lane ?? 0) === r.lane);
          return meta?.order ?? (r.track === 'audio' ? r.lane : -r.lane);
        };
        const orders = sameRows.map(orderOfRow);
        const order = orders.length
          ? drag.insertAt === 'top' ? Math.min(...orders) - 1 : Math.max(...orders) + 1
          : 0;
        edl.updateTrack(drag.track, drag.lane, { order });
        const prefix = drag.track === 'audio' ? 'A' : drag.track === 'subtitle' ? 'T' : 'V';
        const exists = clips.some((c) => c.track === drag.track && (c.lane ?? 0) === drag.lane && c.id !== drag.id);
        toast.success(exists
          ? `已放入 ${prefix}${drag.lane + 1}`
          : `已新建 ${prefix}${drag.lane + 1}${drag.insertAt === 'top' ? '（顶部）' : ''} 并放入`);
      }
    } else if (drag.kind === 'trim-l' && Math.abs(drag.dx) > 0.01) {
      edl.trimClip(drag.id, 'left', drag.dx);
    } else if (drag.kind === 'trim-r' && Math.abs(drag.dx) > 0.01) {
      edl.trimClip(drag.id, 'right', drag.dx);
    }
    setDrag(null);
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', finishDrag);
  }, [drag, edl, clips, rows]);

  useEffect(() => {
    if (!drag) return;
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', finishDrag);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', finishDrag);
    };
  }, [drag, onPointerMove, finishDrag]);

  // 空轨自动回收：除默认 V1/A1 外，没有素材的轨道元信息也一并删除
  useEffect(() => {
    const used = new Set(clips.map((c) => `${c.track}:${c.lane ?? 0}`));
    const extras = (edl.tracks ?? []).filter(
      (t) => !used.has(`${t.track}:${t.lane ?? 0}`),
    );
    if (!extras.length) return;
    for (const t of extras) edl.removeTrack(t.track, t.lane ?? 0);
  }, [clips, edl]);

  useEffect(() => {
    if (!ctx && !gapCtx) return;
    const close = () => {
      setCtx(null);
      setGapCtx(null);
    };
    window.addEventListener('pointerdown', close, { once: true });
    return () => window.removeEventListener('pointerdown', close);
  }, [ctx, gapCtx]);

  // 关键帧菜单：点外部 / Esc 关闭；菜单打开时保留 Shift 多选，便于连续批操作
  useEffect(() => {
    if (!kCtx) return;
    const close = () => setKCtx(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setKCtx(null);
    };
    window.addEventListener('pointerdown', close, { once: true });
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [kCtx]);

  /** Shift+点击关键帧：在当前片段上切换该关键帧的选中态（切片段时重置） */
  const toggleKeyframePick = (clipId: string, time: number, shiftKey: boolean) => {
    if (!shiftKey) {
      if (kfSel && kfSel.id !== clipId) setKfSel(null);
      return;
    }
    setKfSel((cur) => {
      const base = cur && cur.id === clipId ? cur.times : [];
      const eq = (a: number, b: number) => Math.abs(a - b) < 1e-3;
      const has = base.some((t) => eq(t, time));
      return { id: clipId, times: has ? base.filter((t) => !eq(t, time)) : [...base, time] };
    });
  };

  const seekFromEvent = (e: React.MouseEvent, el: HTMLElement) => {
    const rect = el.getBoundingClientRect();
    const x = e.clientX - rect.left + el.scrollLeft - TL_LEFT_PAD;
    setCurT(Math.max(0, Math.min(total, x / zoom)));
  };

  // 播放头拖动：标尺与播放头共用同一套坐标，横向自动滚动跟手。
  // Shift / ⌘ 点选：在已有选区上增删；普通点击仍是单选。
  const selectClip = (id: string, e: { shiftKey?: boolean; metaKey?: boolean }) => {
    const base = edl.selectedIds;
    const additive = Boolean(e.shiftKey || e.metaKey);
    if (!additive) {
      edl.setSelection([id]);
      return;
    }
    edl.setSelection(base.includes(id) ? base.filter((x) => x !== id) : [...base, id]);
  };

  // 参考版空白区交互：轻点 = 定位播放头，拖拽 = 框选多个片段。
  const beginLanePointer = (e: React.PointerEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('.clip2,.playhead,.marker,.trim,.tl-add-menu')) return;
    // 剃刀模式：空白区点击不定位、不框选（OpenMotion 语义：剃刀只作用于片段）
    if (toolRef.current === 'razor') return;
    // R3 节拍手动编辑：Alt+单击轨道空白 = 在此刻加节拍（Alt+点已有节拍点=删除，
    // 由 beat 圆点自己的 pointerdown 处理）。放在框选/定位之前，Alt 不参与这两者。
    if (e.altKey && e.button === 0) {
      if (!beatEditTarget) { toast.info('先对音频素材「分析节拍」，再手动编辑节拍点'); return; }
      const wrap = lanesRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const at = (e.clientX - rect.left + wrap.scrollLeft - TL_LEFT_PAD) / zoom;
      const clip = beatEditTarget.clip;
      const end = clip.timelineStart + beatSpanOf(clip);
      if (at < clip.timelineStart - 0.01 || at > end + 0.01) {
        toast.info('点击位置不在节拍片段的跨度内');
        return;
      }
      const snapped = quantizeToFrame(Math.max(clip.timelineStart, Math.min(end, at)), edl.fps);
      // 已有节拍（±6px 内）→ 删除；否则在此刻加（源媒体秒入覆盖层，片段挪动后依然成立）
      const hit = beatTimes.find((t) => Math.abs(t - snapped) * zoom < 6);
      if (hit != null) {
        if (removeManualBeat(beatEditTarget.assetId, timelineToSourceBeat(clip, hit))) toast.success(`已删除 ${hit.toFixed(2)}s 的节拍`);
      } else if (addManualBeat(beatEditTarget.assetId, timelineToSourceBeat(clip, snapped))) {
        toast.success(`已添加节拍 ${snapped.toFixed(2)}s`);
      }
      return;
    }
    // 拾取中点到空白处：取消拾取并还原
    if (pickup) {
      setPickup(null);
      return;
    }
    if (e.button !== 0) return;
    const wrap = lanesRef.current;
    if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    const x0 = e.clientX - rect.left + wrap.scrollLeft;
    const y0 = e.clientY - rect.top + wrap.scrollTop;
    let moved = false;
    const downX = e.clientX;
    const downY = e.clientY;
    const pick = (x1: number, y1: number, x2: number, y2: number) => {
      const ids: string[] = [];
      for (const clip of clips) {
        if (clip.locked) continue;
        const row = rows.find((r) => r.track === clip.track && (r.lane ?? 0) === (clip.lane ?? 0));
        if (!row) continue;
        const idx = rows.indexOf(row);
        const left = TL_LEFT_PAD + clip.timelineStart * zoom;
        const right = left + Math.max(6, clipSpan(clip) * zoom);
        const top = TL_RULER_H + TL_TOP_PAD + (rowTops[idx] ?? 0);
        const bottom = top + (rowH[row.key] ?? TL_VIDEO_ROW_H);
        if (right >= Math.min(x1, x2) && left <= Math.max(x1, x2) && bottom >= Math.min(y1, y2) && top <= Math.max(y1, y2)) ids.push(clip.id);
      }
      return ids;
    };
    const onMove = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - downX, ev.clientY - downY) < 4) return;
      moved = true;
      const x = ev.clientX - rect.left + wrap.scrollLeft;
      const y = ev.clientY - rect.top + wrap.scrollTop;
      setMarquee({ x1: x0, y1: Math.max(TL_RULER_H + TL_TOP_PAD, y0), x2: x, y2: Math.max(TL_RULER_H + TL_TOP_PAD, y) });
    };
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setMarquee(null);
      if (!moved) {
        setCurT(Math.max(0, Math.min(total, (ev.clientX - rect.left + wrap.scrollLeft - TL_LEFT_PAD) / zoom)));
        edl.setSelection([]);
        return;
      }
      const x = ev.clientX - rect.left + wrap.scrollLeft;
      const y = ev.clientY - rect.top + wrap.scrollTop;
      edl.setSelection(pick(x0, Math.max(TL_RULER_H + TL_TOP_PAD, y0), x, Math.max(TL_RULER_H + TL_TOP_PAD, y)));
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
  };

  const beginScrub = (e: React.PointerEvent, source: 'ruler' | 'lanes') => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const ruler = e.currentTarget as HTMLElement;
    const wrap = lanesRef.current;
    const update = (clientX: number) => {
      if (source === 'ruler') {
        const rect = ruler.getBoundingClientRect();
        setCurT(Math.max(0, Math.min(total, (clientX - rect.left - TL_LEFT_PAD) / zoom)));
        return;
      }
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const edge = 28;
      if (clientX > rect.right - edge) wrap.scrollLeft += 18;
      else if (clientX < rect.left + edge) wrap.scrollLeft -= 18;
      const x = clientX - rect.left + wrap.scrollLeft - TL_LEFT_PAD;
      setScrollLeft(wrap.scrollLeft);
      setCurT(Math.max(0, Math.min(total, x / zoom)));
    };
    update(e.clientX);
    const onMove = (ev: PointerEvent) => update(ev.clientX);
    const finish = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', finish, { once: true });
    window.addEventListener('pointercancel', finish, { once: true });
  };

  const selected = clips.find((c) => edl.selectedIds.includes(c.id)) ?? null;

  // R1 自动展开（useAutoExpandKeyframedClips 语义）：选中「有关键帧的画面片段」时
  // 默认展开属性 lane；已有显式状态（手动开/过）的片段不再自动改，收起后不反弹。
  useEffect(() => {
    if (!edl.selectedIds.length) return;
    const fresh = edl.selectedIds.filter((id) => {
      const clip = clips.find((c) => c.id === id);
      return Boolean(clip && clip.track === 'video' && clip.keyframes?.length && kfLaneOpen[id] === undefined);
    });
    if (!fresh.length) return;
    setKfLaneOpen((m) => {
      const next = { ...m };
      let touched = false;
      for (const id of fresh) if (next[id] === undefined) { next[id] = true; touched = true; }
      return touched ? next : m;
    });
  }, [edl.selectedIds, clips, kfLaneOpen]);

  // FX 自动化 lane 自动展开：选中「带 FX 参数自动化的音频片段」时默认展开
  //（与上方 R1 同语义：已有显式状态不再自动改，收起后不反弹；独立 effect，
  // 不掺和关键帧逻辑）。
  useEffect(() => {
    if (!edl.selectedIds.length) return;
    const fresh = edl.selectedIds.filter((id) => {
      const clip = clips.find((c) => c.id === id);
      return Boolean(clip && clip.track === 'audio' && fxAutomationLanesOf(clip).length > 0 && kfLaneOpen[id] === undefined);
    });
    if (!fresh.length) return;
    setKfLaneOpen((m) => {
      const next = { ...m };
      let touched = false;
      for (const id of fresh) if (next[id] === undefined) { next[id] = true; touched = true; }
      return touched ? next : m;
    });
  }, [edl.selectedIds, clips, kfLaneOpen]);

  /* ---------------- 空白轨区右键：闭合空隙（OpenMotion TrackGapContextMenu 对齐） ---------------- */
  const toGapClip = (c: TimelineClip): GapClip => ({
    id: c.id,
    start: c.timelineStart,
    duration: clipSpan(c),
    locked: c.locked === true,
  });

  const openGapMenu = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    // 片段有自己的右键菜单
    if (target.closest('.clip2')) return;
    e.preventDefault();
    const wrap = lanesRef.current;
    if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    const y = e.clientY - rect.top + wrap.scrollTop - TL_RULER_H;
    const row = rows[rowIndexAt(y)];
    const time = quantizeToFrame(Math.max(0, (e.clientX - rect.left + wrap.scrollLeft - TL_LEFT_PAD) / zoom), edl.fps);
    if (!row) {
      // 没有任何轨道行的空白区：菜单仍弹出，两项置灰并说明原因
      setGapCtx({ x: e.clientX, y: e.clientY, track: 'video', lane: 0, time, empty: true });
      return;
    }
    setGapCtx({ x: e.clientX, y: e.clientY, track: row.track, lane: row.lane, time });
  };

  const runCloseGap = (state: NonNullable<GapCtxState>, all: boolean) => {
    const err = all
      ? edl.closeAllGaps(state.track, state.lane)
      : edl.closeGap(state.track, state.lane, state.time);
    if (err) toast.info(err);
    else toast.success(all ? '已闭合全部空隙' : '已闭合空隙');
    setGapCtx(null);
  };

  /* ---------------- 冻结帧（OpenMotion Freeze frame 对齐，纯客户端） ---------------- */
  const freezeFrame = (clipId: string) => {
    const clip = clips.find((c) => c.id === clipId);
    if (!clip) return;
    if (clip.track !== 'video' || !clip.sourceUrl) {
      toast.info('只有画面片段能加冻结帧');
      return;
    }
    const cutAt = quantizeToFrame(curT, edl.fps);
    if (cutAt <= clip.timelineStart || cutAt >= clip.timelineStart + clipSpan(clip)) {
      toast.info('先把播放头移到片段内部再冻结');
      return;
    }
    if (!projectId) {
      toast.error('项目还没准备好');
      return;
    }
    const sourceTime = clip.inPoint + (cutAt - clip.timelineStart) * Math.max(0.01, clip.speed || 1);
    const name = `冻结帧 ${fmtTc(cutAt)}`;
    const loading = toast.loading('正在抓取冻结帧…');
    captureFramePng(clip.sourceUrl, sourceTime)
      .then((blob) => uploadLocalFile(projectId, blob, `${name}.png`))
      .then(({ fileUrl }) => {
        const ok = edl.insertFreezeFrame(clipId, cutAt, { name, url: fileUrl, durationSec: 1 });
        if (ok) toast.success('已插入冻结帧（默认 1s，拖右边缘可拉长）');
      })
      .catch((err) => toast.error((err as Error).message || '冻结帧生成失败'))
      .finally(() => toast.dismiss(loading));
  };

  const splitAtPlayhead = () => {
    const id = selected?.id;
    if (!id) {
      const hit = clips.find((c) => c.track === 'video' && curT >= c.timelineStart && curT < c.timelineStart + clipSpan(c));
      if (!hit) { toast.info('播放头下没有可分割片段'); return; }
      const next = edl.splitAtPlayhead(curT, hit.id);
      if (next) toast.success('已分割');
      return;
    }
    const next = edl.splitAtPlayhead(curT, id);
    if (next) toast.success('已分割');
    else toast.info('播放头不在选中片段内');
  };

  const deleteLeft = () => {
    if (!selected) { toast.info('先选中一个片段'); return; }
    edl.rippleTrimAt(selected.id, 'left', curT);
  };
  const deleteRight = () => {
    if (!selected) { toast.info('先选中一个片段'); return; }
    edl.rippleTrimAt(selected.id, 'right', curT);
  };

  const fit = () => {
    const w = Math.max(400, (lanesRef.current?.clientWidth ?? 800) - TL_LEFT_PAD - 24);
    setZoom(Math.max(14, Math.min(240, w / Math.max(1, total))));
    setScrollLeft(0);
  };

  // OpenMotion 的三种缩放模式：整条适应 / 选区适应 / 手动（滑杆与连续滚轮）。
  const fitSelection = () => {
    const picked = clips.filter((c) => edl.selectedIds.includes(c.id));
    if (!picked.length) { fit(); return; }
    const start = Math.min(...picked.map((c) => c.timelineStart));
    const end = Math.max(...picked.map((c) => c.timelineStart + clipSpan(c)));
    const span = Math.max(0.5, end - start);
    const w = Math.max(320, (lanesRef.current?.clientWidth ?? 800) - TL_LEFT_PAD - 32);
    const next = Math.max(14, Math.min(240, w / span));
    setZoom(next);
    requestAnimationFrame(() => {
      const wrap = lanesRef.current;
      if (!wrap) return;
      wrap.scrollLeft = Math.max(0, start * next + TL_LEFT_PAD - 16);
      setScrollLeft(wrap.scrollLeft);
    });
  };

  // 快捷键桥：A/B 切工具、Shift+Z 适配、Ctrl+滚轮缩放都由工作台键盘层派发
  useEffect(() => {
    const onTool = (e: Event) => setTool((e as CustomEvent).detail === 'razor' ? 'razor' : 'select');
    const onZoom = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (d === 'fit') fit();
      else if (d === 'fit-selection') fitSelection();
      else setZoom((z) => Math.max(14, Math.min(240, z + (d === 'out' ? -4 : 4))));
    };
    const onZoomSet = (e: Event) => {
      const v = Number((e as CustomEvent).detail);
      if (Number.isFinite(v)) setZoom(Math.max(14, Math.min(240, v)));
    };
    const onHome = () => {
      const wrap = lanesRef.current;
      if (wrap) { wrap.scrollLeft = 0; wrap.scrollTop = 0; }
      setScrollLeft(0);
      setScrollTop(0);
    };
    window.addEventListener('yimu:shenjian-tool', onTool);
    window.addEventListener('yimu:shenjian-zoom', onZoom);
    window.addEventListener('yimu:shenjian-zoom-set', onZoomSet);
    window.addEventListener('yimu:shenjian-scroll-home', onHome);
    return () => {
      window.removeEventListener('yimu:shenjian-tool', onTool);
      window.removeEventListener('yimu:shenjian-zoom', onZoom);
      window.removeEventListener('yimu:shenjian-zoom-set', onZoomSet);
      window.removeEventListener('yimu:shenjian-scroll-home', onHome);
    };
  });

  /* ---------------- 键盘拾取（OpenMotion useTimelineClipDrag 对齐） ----------------
   * Space 拿起选中片段 → ↑/↓ 换轨 → ←/→ 帧步进移动 → Enter/Space 落下 → Esc 取消还原。
   * 与全局 Space=播放/暂停 的分工：恰好选中一个片段且未播放时 Space 进拾取；
   * 拾取态按键在本层以 capture 监听就地消化，不会落回工作台键盘层误触播放。
   */
  const playingRef = useRef(playing);
  playingRef.current = playing;
  const edlRef = useRef(edl);
  edlRef.current = edl;
  const clipsRef = useRef(clips);
  clipsRef.current = clips;
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const fpsRef = useRef(edl.fps);
  fpsRef.current = edl.fps;
  const pickupRef = useRef<PickupState | null>(null);
  pickupRef.current = pickup;

  /** ↑/↓ 换目标轨：同类型行按显示顺序（锁定行跳过），末尾追加「新建一条轨」候选（对齐拖拽落空白） */
  const stepPickupLane = (st: PickupState, step: -1 | 1): PickupState | null => {
    const rowLanes = rowsRef.current
      .filter((r) => r.track === st.track && !r.locked)
      .map((r) => r.lane);
    const maxLane = Math.max(-1, ...clipsRef.current.filter((c) => c.track === st.track).map((c) => c.lane ?? 0));
    const candidates = [...rowLanes];
    if (maxLane + 1 >= 0 && !candidates.includes(maxLane + 1)) candidates.push(maxLane + 1);
    if (candidates.length === 0) return null;
    const at = candidates.indexOf(st.lane);
    const next = at < 0
      ? (step === 1 ? candidates[0] : candidates[candidates.length - 1])
      : candidates[Math.min(candidates.length - 1, Math.max(0, at + step))];
    if (next == null || next === st.lane) return null;
    return { ...st, lane: next };
  };

  const commitPickup = () => {
    const st = pickupRef.current;
    if (!st) return;
    setPickup(null);
    if (st.lane !== st.origLane) {
      const rowExists = rowsRef.current.some((r) => r.track === st.track && r.lane === st.lane);
      edlRef.current.moveClipToLane(st.id, st.start, st.lane, !rowExists);
    } else {
      edlRef.current.moveClip(st.id, st.start);
    }
  };
  const commitPickupRef = useRef(commitPickup);
  commitPickupRef.current = commitPickup;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.closest('input, textarea, select, [contenteditable="true"]') || el.isContentEditable)) return;
      const st = pickupRef.current;
      if (st) {
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault();
          e.stopPropagation();
          commitPickupRef.current();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          setPickup(null);
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault();
          e.stopPropagation();
          const frames = (e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 10 : 1);
          const next = Math.max(0, quantizeToFrame(st.start + frames / Math.max(1, fpsRef.current), fpsRef.current));
          setPickup({ ...st, start: next });
        } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault();
          e.stopPropagation();
          const next = stepPickupLane(st, e.key === 'ArrowDown' ? 1 : -1);
          if (next) setPickup(next);
        }
        return;
      }
      // 未拾取时：Esc 退出剃刀工具（a 键由工作台键盘层切回选择工具）
      if (toolRef.current === 'razor' && e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setTool('select');
        return;
      }
      // 未拾取时：恰好选中一个片段且未播放，Space = 拾取；否则放行给全局播放/暂停
      if (e.key !== ' ' || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      if (playingRef.current) return;
      if (toolRef.current === 'razor') return;
      const sel = edlRef.current.selectedIds;
      if (sel.length !== 1) return;
      const clip = clipsRef.current.find((c) => c.id === sel[0]);
      if (!clip || clip.locked) return;
      const row = rowsRef.current.find((r) => r.track === clip.track && r.lane === (clip.lane ?? 0));
      if (row?.locked) return;
      e.preventDefault();
      e.stopPropagation();
      setPickup({
        id: clip.id,
        track: clip.track,
        origStart: clip.timelineStart,
        origLane: clip.lane ?? 0,
        start: clip.timelineStart,
        lane: clip.lane ?? 0,
      });
      toast.info('已拾取片段：↑↓ 换轨 · ←→ 移动 · Space/Enter 放下 · Esc 取消', { duration: 2400 });
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  // 拾取中的片段跟随键盘目标行；目标行尚不存在（将新建轨）时不落在任何行，改挂 ghost
  const pickupRowKey = pickup
    ? rows.find((r) => r.track === pickup.track && r.lane === pickup.lane)?.key ?? null
    : null;

  const rowClips = (row: Row) =>
    clips
      .filter((c) => {
        // 拖动中的素材实时跟随指针所在的轨道；其余素材按原轨道归属。
        if (drag?.kind === 'move' && drag.id === c.id) return drag.targetRowKey === row.key;
        if (pickup?.id === c.id) return pickupRowKey === row.key;
        return c.track === row.track && (c.lane ?? 0) === row.lane;
      })
      // auto: 内嵌原声不落 A 行；同 lane 被分开后自动让位，避免和独立音频重叠。
      .filter((c) => !(row.track === 'audio' && c.bindGroup?.startsWith('auto:')))
      .sort((a, b) => a.timelineStart - b.timelineStart);

  /** 该行里有关键帧的画面片段（轨道头 caret 展开属性 lane 用） */
  const rowKeyframeClips = (row: Row) =>
    clips.filter((c) => c.track === 'video' && (c.lane ?? 0) === row.lane && c.keyframes?.length);

  /** 该行里带 FX 参数自动化的音频片段（轨道头 caret 展开 FX lane 用；auto: 内嵌原声不落 A 行） */
  const rowFxAutomationClips = (row: Row) =>
    clips.filter(
      (c) =>
        c.track === 'audio' &&
        (c.lane ?? 0) === row.lane &&
        !c.bindGroup?.startsWith('auto:') &&
        fxAutomationLanesOf(c).length > 0,
    );

  /**
   * FX 自动化 lane 落库：改某节点某参数的断点（null = 清除该参数自动化），
   * 走 setClipAudioFx 统一归一化（+ 画面↔auto 镜像）；其余节点的 automation 原样保留。
   */
  const setClipFxAutomation = (clipId: string, nodeIndex: number, paramKey: string, points: AudioFxAutomationPoint[] | null) => {
    const clip = clips.find((c) => c.id === clipId);
    if (!clip || clip.locked) return;
    const next = (clip.audioFx?.nodes ?? []).map((n, i) => {
      if (i !== nodeIndex) return n;
      const automation = { ...(n.automation ?? {}) };
      if (!points || points.length === 0) delete automation[paramKey];
      else automation[paramKey] = points;
      return { ...n, automation: Object.keys(automation).length > 0 ? automation : undefined };
    });
    edl.setClipAudioFx(clipId, next.length > 0 ? next : null);
  };

  const displayLeft = (c: TimelineClip) => {
    if (pickup?.id === c.id) return pickup.start;
    return drag?.id === c.id && drag.kind !== 'trim-r' ? (drag.kind === 'move' ? drag.origStart + drag.dx : drag.origStart) : c.timelineStart;
  };
  const displaySpan = (c: TimelineClip) => (drag?.id === c.id ? drag.span : clipSpan(c));

  return (
    <section className="tl2 timeline">
      {!hideToolbar ? (
      <div className="tl-tools">
        <button type="button" className={`tl-tool${tool === 'select' ? ' on' : ''}`} data-tip="选择工具 (A)：点选/拖动片段" onClick={() => setTool('select')}>
          <IconSelect /><span className="dotmark" />
        </button>
        <button type="button" className={`tl-tool${tool === 'razor' ? ' on' : ''}`} data-tip="剃刀工具 (B)：在点击处切开片段" onClick={() => setTool('razor')}>
          <IconRazor /><span className="dotmark" />
        </button>
        <div className="sep" />
        <button type="button" className="tl-tool" data-tip="分割 (E / Ctrl+B)：在播放头处切成两段" onClick={splitAtPlayhead}><IconSplit /></button>
        <button type="button" className="tl-tool" data-tip="删除前半段 (Q)：保留播放头之后" onClick={deleteLeft}><IconTrimLeft /></button>
        <button type="button" className="tl-tool" data-tip="删除后半段 (W)：保留播放头之前" onClick={deleteRight}><IconTrimRight /></button>
        <button type="button" className="tl-tool" data-tip="波纹删除：删除并自动合拢空隙" onClick={() => selected && edl.rippleDelete([selected.id])}><IconRippleDelete /></button>
        <button type="button" className="tl-tool" data-tip="删除选中片段 (Delete)" onClick={() => selected && edl.rippleDelete([selected.id])}><span className="del-ico">✕</span></button>
        <button
          type="button"
          className="tl-tool"
          data-tip="音画分离 (⌘⇧S)：把选中画面的原声拆成独立音频轨"
          onClick={() => {
            if (!selected || selected.track !== 'video') { toast.info('先选中一个画面片段'); return; }
            const audioId = edl.detachAudio(selected.id);
            toast.success(audioId ? '已分离音频，下方出现独立音频轨' : '该画面已有独立原声轨');
          }}
        >
          <Volume2 />
        </button>
        <div className="sep" />
        <button type="button" className="tl-tool" data-tip="撤销 (Ctrl+Z)" onClick={() => { if (!applyBeatUndo()) edl.undo(); }}><Undo2 /></button>
        <button type="button" className="tl-tool" data-tip="重做 (Ctrl+Shift+Z)" onClick={() => { if (!applyBeatRedo()) edl.redo(); }}><Redo2 /></button>
        <button type="button" className={`tl-tool${snapOn ? ' on' : ''}`} data-tip="吸附开关 (N)" onClick={() => setSnapOn(!snapOn)}><Magnet /></button>
        <button type="button" className="tl-tool" data-tip="添加标记 (M)" onClick={() => edl.addMarker(curT)}><MapPin /></button>
        <div className="sep" />
        <button
          type="button"
          className="tl-tool"
          data-tip="复制选中片段 (⌘C)"
          disabled={!selected}
          onClick={() => { if (selected) { edl.copySelection([selected.id]); toast.success('已复制'); } }}
        >
          <Copy />
        </button>
        <button
          type="button"
          className="tl-tool"
          data-tip="粘贴到播放头 (⌘V)"
          onClick={() => {
            const created = edl.pasteAt(curT);
            if (created.length) toast.success(`已粘贴 ${created.length} 个片段`);
            else toast.info('剪贴板是空的，先复制一个片段');
          }}
        >
          <ClipboardPaste />
        </button>
        <div className="tl-add">
          <button type="button" className="tl-tool" data-tip="添加字幕 / 新增轨道" onClick={() => setAddOpen((v) => !v)}>
            <PlusCircle />
          </button>
          {addOpen ? (
            <div className="tl-add-menu" onPointerDown={(e) => e.stopPropagation()}>
              <button type="button" onClick={() => { edl.addSubtitle(curT); setAddOpen(false); }}>
                <Type size={12} /> 加字幕（播放头）
              </button>
              <div className="msep" />
              <button type="button" onClick={() => { edl.addSubtitle(curT, Math.max(0, ...rows.filter((r) => r.track === 'subtitle').map((r) => r.lane)) + 1); setAddOpen(false); }}>
                <Layers size={12} /> 新增字幕轨
              </button>
            </div>
          ) : null}
        </div>
        <button
          type="button"
          className="tl-tool"
          data-tip="画面轨首尾相接（排齐）"
          onClick={() => { edl.packVideo(); toast.success('画面轨已排齐'); }}
        >
          <AlignJustify />
        </button>
        <button
          type="button"
          className="tl-tool"
          data-tip="回到起点"
          onClick={() => {
            setCurT(0);
            if (lanesRef.current) lanesRef.current.scrollLeft = 0;
            setScrollLeft(0);
          }}
        >
          <RotateCcw />
        </button>
        <div className="tl-caption">A 选择 · B 剃刀 · E 分割 · Q 删前 · W 删后 · ⇧⌘S 音画分离</div>
        <div className="grow">
          <span className="tl-newhint">拖到空白自动建轨</span>
          <button type="button" className="icon-btn" data-tip="时间线缩小 (-)" onClick={() => setZoom((z) => Math.max(14, z - 4))}><Minus /></button>
          <input className="tl-zoom" type="range" min="14" max="240" value={zoom} onChange={(e) => setZoom(Number(e.target.value))} />
          <button type="button" className="icon-btn" data-tip="时间线放大 (+)" onClick={() => setZoom((z) => Math.min(240, z + 4))}><Plus /></button>
          <button type="button" className="mini-btn" data-tip="适应窗口" onClick={fit}>适应</button>
          <button type="button" className="mini-btn" data-tip="缩放到选中片段" onClick={fitSelection}>选区</button>
        </div>
      </div>
      ) : null}

      <div className="tl-body" style={{ gridTemplateColumns: `${headW}px minmax(0, 1fr)` }}>
        <div className="tl-head-resizer" title="拖动调整轨道头列宽，双击复位" onPointerDown={beginHeadResize} onDoubleClick={() => setHeadW(132)} />
        <div className="track-heads">
          <div className="head-ruler">
            <span
              className="head-time"
              title="点击切换 时间码 / 帧号 显示"
              role="button"
              tabIndex={0}
              onClick={() => setTimeMode()}
              onKeyDown={(e) => { if (e.key === 'Enter') setTimeMode(); }}
              style={{ cursor: 'pointer' }}
            >
              {timeMode === 'frame' ? `${frameNumberOf(curT, edl.fps)} f` : fmtTc(curT)}
            </span>
          </div>
          <div className="heads-inner" style={{ transform: `translateY(-${scrollTop}px)` }}>
            {rows.length === 0 ? (
              <div className="track-head empty-head" style={{ height: laneH }}>
                <span className="tname">—</span>
                <span className="tlabel"><em>轨道 1</em><b>空白 · 拖入即定型</b></span>
              </div>
            ) : null}
            {rows.map((row) => (
              <div className={`track-head ${row.track}${drag?.targetRowKey === row.key ? ' droptarget' : ''}`} key={row.key} style={{ height: rowH[row.key] ?? laneH }}>
                <span className="tname">{row.label}</span>
                <span className="tlabel"><em>轨道 {row.no}</em><b>{row.name}</b></span>
                <span className="locks">
                  {row.track === 'video' && rowKeyframeClips(row).length ? (
                    (() => {
                      const kfClips = rowKeyframeClips(row);
                      const anyOpen = kfClips.some((c) => kfLaneOpen[c.id]);
                      return (
                        <button
                          type="button"
                          className={`kf-caret${anyOpen ? ' on' : ''}`}
                          aria-expanded={anyOpen}
                          aria-controls={kfClips.map((c) => `kf-lanes-${c.id}`).join(' ')}
                          title={anyOpen ? '收起关键帧属性行（缩放/位移/旋转）' : '展开关键帧属性行（缩放/位移/旋转）'}
                          onClick={(e) => {
                            e.stopPropagation();
                            const next = !anyOpen;
                            setKfLaneOpen((m) => {
                              const n = { ...m };
                              for (const c of kfClips) n[c.id] = next;
                              return n;
                            });
                          }}
                        >
                          {anyOpen ? <ChevronDown /> : <ChevronRight />}
                        </button>
                      );
                    })()
                  ) : null}
                  {row.track === 'audio' && rowFxAutomationClips(row).length ? (
                    (() => {
                      const fxClips = rowFxAutomationClips(row);
                      const anyOpen = fxClips.some((c) => kfLaneOpen[c.id]);
                      return (
                        <button
                          type="button"
                          className={`kf-caret${anyOpen ? ' on' : ''}`}
                          aria-expanded={anyOpen}
                          aria-controls={fxClips.map((c) => `fx-lanes-${c.id}`).join(' ')}
                          title={anyOpen ? '收起 FX 自动化行（效果参数包络）' : '展开 FX 自动化行（效果参数包络）'}
                          onClick={(e) => {
                            e.stopPropagation();
                            const next = !anyOpen;
                            setKfLaneOpen((m) => {
                              const n = { ...m };
                              for (const c of fxClips) n[c.id] = next;
                              return n;
                            });
                          }}
                        >
                          {anyOpen ? <ChevronDown /> : <ChevronRight />}
                        </button>
                      );
                    })()
                  ) : null}
                  {row.track === 'video' ? (
                    <button
                      type="button"
                      className={row.visible ? '' : 'on'}
                      title={row.visible ? '隐藏该画面轨' : '恢复显示该画面轨'}
                      onClick={() => edl.updateTrack('video', row.lane, { exportEnabled: !row.visible })}
                    >
                      {row.visible ? <Eye /> : <EyeOff />}
                    </button>
                  ) : null}
                  {row.track === 'audio' ? (
                    <button
                      type="button"
                      className={row.muted ? 'on' : ''}
                      title={row.muted ? '取消静音该轨' : '静音该轨'}
                      onClick={() => edl.updateTrack(row.track, row.lane, { muted: !row.muted })}
                    >
                      {row.muted ? <VolumeX /> : <Volume2 />}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className={row.locked ? 'on' : ''}
                    title={row.locked ? '解锁轨道' : '锁定轨道'}
                    onClick={() => edl.updateTrack(row.track, row.lane, { locked: !row.locked })}
                  >
                    <Lock />
                  </button>
                  <button
                    type="button"
                    className="danger"
                    title="删除该轨（轨道上的片段会一并移除）"
                    onClick={() => {
                      const removed = edl.removeTrack(row.track, row.lane ?? 0);
                      if (removed) toast.success(`${row.label} 已删除`);
                      else toast.info('该轨上还有片段，先删除片段再删轨');
                    }}
                  >
                    <Trash2 />
                  </button>
                </span>
                <span className="hctl" title={`轨道高度 ${Math.round(rowH[row.key] ?? laneH)}px`}>
                  <button type="button" title="降低该轨道高度" onClick={(e) => { e.stopPropagation(); nudgeRowHeight(row, -24); }}>
                    <Minus />
                  </button>
                  <button type="button" title="增高该轨道高度（关键帧图同步放大）" onClick={(e) => { e.stopPropagation(); nudgeRowHeight(row, 24); }}>
                    <Plus />
                  </button>
                </span>
              </div>
            ))}
          </div>
        </div>

        <div
          className="lanes-wrap"
          ref={bindLanes}
          onScroll={(e) => {
            setScrollTop(e.currentTarget.scrollTop);
            setScrollLeft(e.currentTarget.scrollLeft);
            clearHover();
          }}
          onPointerMove={(e) => {
            moveRazorGuide(e.clientX);
            trackHover(e.clientX, e.currentTarget);
          }}
          onPointerLeave={() => {
            clearHover();
            hideRazorGuide();
          }}
          onClick={(e) => {
            // 剃刀模式点击不定位播放头（只作用于片段）；拾取中点击交给取消逻辑
            if (pickup || toolRef.current === 'razor') return;
            if (!(e.target as HTMLElement).closest('.clip')) seekFromEvent(e, e.currentTarget);
          }}
          onDragOver={(e) => {
            e.preventDefault();
            const payload = peekTimelineDrag();
            if (!payload) return;
            const rect = e.currentTarget.getBoundingClientRect();
            const at = Math.max(0, (e.clientX - rect.left + e.currentTarget.scrollLeft - TL_LEFT_PAD) / zoom);
            const y = e.clientY - rect.top + e.currentTarget.scrollTop - TL_RULER_H;
            const idx = Math.max(0, rowIndexAt(y));
            const row = rows[idx];
            const want = trackOfDrag(payload);
            const sameType = row?.track === want;
            const lane = sameType ? row.lane : maxLaneOf(want) + 1;
            setDragOver({ track: want, lane, at, created: !sameType });
          }}
          onDragLeave={() => setDragOver(null)}
          onDrop={(e) => {
            e.preventDefault();
            const payload = readTimelineDrag(e);
            const media = payload ? mediaOfDrag(payload) : undefined;
            if (!payload || !media) return;
            const rect = e.currentTarget.getBoundingClientRect();
            const at = Math.max(0, (e.clientX - rect.left + e.currentTarget.scrollLeft - TL_LEFT_PAD) / zoom);
            const y = e.clientY - rect.top + e.currentTarget.scrollTop - TL_RULER_H;
            const idx = Math.max(0, rowIndexAt(y));
            const row = rows[idx];
            const want = trackOfDrag(payload);
            const sameType = row?.track === want;
            const lane = sameType ? row.lane : maxLaneOf(want) + 1;
            setDragOver(null);
            const prefix = want === 'audio' ? 'A' : 'V';
            const where = sameType ? `已放入 ${prefix}${lane + 1}` : `已新建 ${prefix}${lane + 1} 并放入`;
            if (want === 'audio') {
              edl.addAudio({ name: payload.name, url: media, durationSeconds: payload.durationSeconds }, at, lane);
              toast.success(where);
              return;
            }
            // 先探测源视频有没有声音：有声音才自动生成原声轨，没有就绝不造空轨
            void probeVideoHasAudio(media).then((hasAudio) => {
              edl.addVideo(
                { name: payload.name, url: media, durationSeconds: payload.durationSeconds || 5, shotId: payload.shotId, hasAudio },
                at,
                lane,
              );
              toast.success(hasAudio ? `${where} · 原声已内嵌（波形在画面下半部，音画分离后并排 A 轨）` : where);
            });
          }}
        >
          <div className="lanes-inner" style={{ width }}>
            {((drag?.created || dragOver?.created) || (pickup && !pickupRowKey)) ? (
              <div className="new-track-hint">
                {(drag?.created || dragOver?.created) ? (
                  <>松手新建 {(drag?.track ?? dragOver?.track) === 'audio' ? 'A' : (drag?.track ?? dragOver?.track) === 'subtitle' ? 'T' : 'V'}{((drag?.lane ?? dragOver?.lane ?? 0) + 1)}</>
                ) : (
                  <>放下新建 {pickup?.track === 'audio' ? 'A' : pickup?.track === 'subtitle' ? 'T' : 'V'}{(pickup?.lane ?? 0) + 1}</>
                )}
              </div>
            ) : null}
            {drag?.kind === 'move' && !drag.targetRowKey ? (
              <div
                className={`drag-ghost ${clipColor(clips.find((c) => c.id === drag.id) ?? ({} as TimelineClip))}`}
                style={{
                  left: TL_LEFT_PAD + Math.max(0, (drag.origStart + drag.dx) * zoom),
                  top: TL_RULER_H + Math.max(0, (drag.pointerY ?? 0)) - Math.max(18, (laneH - 10) / 2),
                  width: Math.max(10, drag.origSpan * zoom),
                  height: Math.max(28, laneH - 10),
                }}
              >
                <span>{clipLabel(clips.find((c) => c.id === drag.id) ?? ({} as TimelineClip))}</span>
              </div>
            ) : null}
            {pickup && !pickupRowKey ? (() => {
              const ghostClip = clips.find((c) => c.id === pickup.id);
              if (!ghostClip) return null;
              return (
                <div
                  className={`drag-ghost pickup-ghost ${clipColor(ghostClip)}`}
                  style={{
                    left: TL_LEFT_PAD + Math.max(0, pickup.start * zoom),
                    top: TL_RULER_H + TL_TOP_PAD,
                    width: Math.max(10, clipSpan(ghostClip) * zoom),
                    height: Math.max(28, laneH - 10),
                  }}
                >
                  <span>{clipLabel(ghostClip)}</span>
                </div>
              );
            })() : null}
            <div
              className="ruler"
              onPointerDown={(e) => beginScrub(e, 'ruler')}
              onClick={(e) => seekFromEvent(e, e.currentTarget.parentElement?.parentElement as HTMLElement)}
            >
              {ticks.map((t) => (
                <div key={t} className="tick" style={{ left: TL_LEFT_PAD + t * zoom }}>
                  {timeMode === 'frame' ? frameNumberOf(t, edl.fps) : fmtSec(t)}
                </div>
              ))}
            </div>
            <div className="baseline" style={{ top: baselineTop }}>
              <span>时间轴基线 · 字幕最上 · 画面居中 · 音频最下</span>
            </div>
            <div
              className={`lanes${tool === 'razor' ? ' razor-on' : ''}`}
              onPointerDown={beginLanePointer}
              onContextMenu={openGapMenu}
            >
              {rows.length === 0 ? (
                <div className="lane empty-lane" style={{ height: laneH }}>
                  <span>把视频 / 图片 / 音频 / 字幕拖进来 · 第一段素材是什么，第一条轨道就是什么</span>
                </div>
              ) : null}
              {(() => { const from = (scrollLeft - TL_LEFT_PAD) / zoom - 1; const to = (scrollLeft + viewW - TL_LEFT_PAD) / zoom + 1; return rows.map((row) => (
                <div
                  key={row.key}
                  className={`lane ${row.track}${drag?.targetRowKey === row.key ? ' droptarget' : ''}`}
                  style={{ height: rowH[row.key] ?? laneH }}
                  onDoubleClick={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    const at = (e.clientX - rect.left + (lanesRef.current?.scrollLeft ?? 0) - TL_LEFT_PAD) / zoom;
                    setCurT(at);
                  }}
                >
                  {/* 节拍背景竖线（W6）：画进轨道行背景，垫在片段之下；命中高亮。
                      R3：beatEditable 时带可抓圆点（拖动 retime / 右键删 / Alt 删） */}
                  <BeatLines
                    times={beatDisplayTimes}
                    zoom={zoom}
                    highlightTime={beatHighlight}
                    from={from}
                    to={to}
                    editable={beatEditable ?? undefined}
                  />
                  {rowClips(row).filter((c) => c.timelineStart + clipSpan(c) >= from && c.timelineStart <= to).map((clip) => {
                    const span = displaySpan(clip);
                    const left = displayLeft(clip);
                    const isSelected = edl.selectedIds.includes(clip.id);
                    const w = Math.max(8, span * zoom);
                    const shot = clip.sourceShotId ? data.shots.find((s) => s.id === clip.sourceShotId) : null;
                    // 已分离的画面不再显示内置原声，避免同一条声音上下重复
                    const audioDetached = clip.track === 'video' && clips.some(
                      (a) => a.track === 'audio' && !a.bindGroup?.startsWith('auto:') && (
                        (clip.clientKey && a.bindGroup === `av:${clip.clientKey}`) ||
                        sameOrigin(a, clip, edl.fps)
                      ),
                    );
                    // 行高按「基础行高」计：展开属性 lane 的加高区画在行底部，
                    // 片段体不跟着变高（运镜/淡变/包络几何与展开前一致）
                    const rowHeightNow = rowHeights[row.key] ?? defaultRowH(row);
                    const hasEmbeddedAudio = clip.track === 'video' && rowHeightNow >= 58 && !audioDetached;
                    // 音量包络（G12）：包络存在即优先（GainLine 隐藏，清空后恢复）；
                    // 折线本体只在片段选中时显示（可拖点编辑）
                    const envActive = hasVolumeAutomation(clip);
                    const showEnvelope = isSelected && envActive;
                    return (
                      <div
                        key={clip.id}
                        className={`clip2 ${clipColor(clip)}${isSelected ? ' selected' : ''}${drag?.id === clip.id && drag.kind === 'move' ? ' dragging' : ''}${pickup?.id === clip.id ? ' pickup' : ''}`}
                        style={{ left: TL_LEFT_PAD + left * zoom, width: w, height: rowHeightNow - 6 }}
                        title={`${clipLabel(clip)} · ${clip.timelineStart.toFixed(2)}s → ${(clip.timelineStart + clipSpan(clip)).toFixed(2)}s`}
                        onPointerDownCapture={(e) => {
                          // 剪映里点片段任何位置都先选中。音量线/关键帧条会 stopPropagation，
                          // 旧实现点片段正中会直接进入音量拖拽、右侧检查器始终空白。
                          selectClip(clip.id, e);
                          setPreviewMode('timeline');
                        }}
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          setPreviewMode('timeline');
                          // 拾取中再点别的片段：取消拾取并还原，不进入拖拽
                          if (pickup) {
                            setPickup(null);
                            return;
                          }
                          // 剃刀工具：点击在指针时刻切开；Shift+点击切所有轨（同时刻所有可切片段）
                          if (toolRef.current === 'razor') {
                            if (e.button !== 0) return;
                            const wrap = lanesRef.current;
                            if (!wrap) return;
                            const rect = wrap.getBoundingClientRect();
                            const cutAt = quantizeToFrame(
                              Math.max(0, (e.clientX - rect.left + wrap.scrollLeft - TL_LEFT_PAD) / zoom),
                              edl.fps,
                            );
                            if (e.shiftKey) {
                              // Blade+Shift：指针时刻切所有轨（一次 commit，可整体撤销）
                              const ids = clips.filter(isRazorable).map((c) => c.id);
                              const n = edl.splitManyAt(cutAt, ids);
                              if (n > 0) toast.success(`已在指针时刻切开 ${n} 个片段`);
                              else toast.info('指针处没有可切开的片段');
                              return;
                            }
                            if (!isRazorable(clip)) return;
                            const next = edl.splitClip(clip.id, cutAt);
                            if (next) toast.success('已切开');
                            else toast.info('切点太靠近片段边缘');
                            return;
                          }
                          if (row.locked || clip.locked) return;
                          const start = clip.timelineStart;
                          setDrag({ id: clip.id, kind: 'move', startX: e.clientX, startY: e.clientY, origStart: start, origSpan: span, lane: clip.lane ?? 0, targetRowKey: row.key, track: clip.track, dx: 0, span, pointerX: e.clientX });
                        }}
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          setCurT(clip.timelineStart);
                        }}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setCtx({ x: e.clientX, y: e.clientY, id: clip.id });
                          selectClip(clip.id, e);
                        }}
                      >
                        <ClipVisual
                          projectId={projectId}
                          clip={clip}
                          fallbackUrl={shot?.frameUrl}
                          span={span}
                          pxPerSec={zoom}
                          rowHeight={rowHeightNow - 10}
                          embeddedAudio={hasEmbeddedAudio}
                        />
                        {clip.track === 'audio' ? (
                          <AudioClipWave projectId={projectId} clip={clip} span={span} pxPerSec={zoom} />
                        ) : null}
                        {clip.track === 'audio' && (showEnvelope || !envActive) ? (
                          showEnvelope ? (
                            <VolumeEnvelope
                              clip={clip}
                              span={span}
                              pxPerSec={zoom}
                              height={rowHeightNow - 16}
                              fps={edl.fps}
                              onChange={(points) => edl.setClipVolumeAutomation(clip.id, points)}
                              onClear={() => edl.clearClipVolumeAutomation(clip.id)}
                            />
                          ) : (
                            <GainLine clip={clip} onChange={(v) => edl.setClipVolume(clip.id, v)} />
                          )
                        ) : hasEmbeddedAudio && (showEnvelope || !envActive) ? (
                          /* 内嵌原声半区：无包络时保留白色增益线（包络优先，存在即隐藏） */
                          showEnvelope ? (
                            <VolumeEnvelope
                              clip={clip}
                              span={span}
                              pxPerSec={zoom}
                              height={Math.max(18, (rowHeightNow - 6) * 0.44)}
                              fps={edl.fps}
                              onChange={(points) => edl.setClipVolumeAutomation(clip.id, points)}
                              onClear={() => edl.clearClipVolumeAutomation(clip.id)}
                            />
                          ) : (
                            <GainLine clip={clip} onChange={(v) => edl.setClipVolume(clip.id, v)} />
                          )
                        ) : null}
                        {clip.track === 'subtitle' ? <div className="t"><b>T1 字幕</b>{clip.text || '字幕'}</div> : null}
                        <span className="shade" />
                        <span className="cname">{clipLabel(clip)}</span>
                        <span className="tagline">{clip.track === 'audio' ? '音频' : clip.track === 'subtitle' ? '文本' : `V${(clip.lane ?? 0) + 1}`}</span>
                        {clip.transition && clip.transition.type !== 'none' ? <span className="xf">{clip.transition.type === 'crossfade' ? '叠' : '淡'}</span> : null}
                        {clip.track === 'video' && clip.keyframes?.length && !kfLaneOpen[clip.id] ? (
                          <ClipKeyframes
                            clip={clip}
                            span={span}
                            pxPerSec={zoom}
                            selectedTimes={kfSel && kfSel.id === clip.id ? kfSel.times : []}
                            onSeek={setCurT}
                            onChange={(frames) => edl.setClipKeyframes(clip.id, frames)}
                            onSelect={(time, shiftKey) => toggleKeyframePick(clip.id, time, shiftKey)}
                            onContext={(e, time) => {
                              // 右键单个菱形：若它不在多选里，则多选收拢为它自己
                              const cur = kfSel && kfSel.id === clip.id ? kfSel.times : [];
                              const picked = cur.some((t) => Math.abs(t - time) < 1e-3)
                                ? cur
                                : [time];
                              setKfSel({ id: clip.id, times: picked });
                              setKCtx({ x: e.clientX, y: e.clientY, id: clip.id, times: picked });
                            }}
                          />
                        ) : null}
                        {/* 淡入淡出把手（G11）：音频片与画面片，选中时出现（斜线示意始终跟随已设值） */}
                        {(clip.track === 'audio' || clip.track === 'video') && clip.sourceUrl && isSelected ? (
                          <ClipFades
                            clip={clip}
                            span={span}
                            pxPerSec={zoom}
                            fps={edl.fps}
                            onChange={(fades) => edl.setClipFades(clip.id, fades)}
                          />
                        ) : null}
                        <span
                          className="trim l"
                          onPointerDown={(e) => {
                            e.stopPropagation();
                            edl.setSelection([clip.id]);
                            if (pickup) { setPickup(null); return; }
                            if (row.locked || clip.locked) return;
                            setDrag({ id: clip.id, kind: 'trim-l', startX: e.clientX, startY: e.clientY, origStart: clip.timelineStart, origSpan: span, lane: clip.lane ?? 0, track: clip.track, dx: 0, span });
                          }}
                        />
                        <span
                          className="trim r"
                          onPointerDown={(e) => {
                            e.stopPropagation();
                            edl.setSelection([clip.id]);
                            if (pickup) { setPickup(null); return; }
                            if (row.locked || clip.locked) return;
                            const sourceDuration = clip.sourceDuration ?? clip.outPoint;
                            const maxSpan = Math.max(0.15, (sourceDuration - clip.inPoint) / Math.max(0.01, clip.speed || 1));
                            setDrag({ id: clip.id, kind: 'trim-r', startX: e.clientX, startY: e.clientY, origStart: clip.timelineStart, origSpan: span, lane: clip.lane ?? 0, track: clip.track, dx: 0, span, maxSpan });
                          }}
                        />
                      </div>
                    );
                  })}
                  {/* R1 关键帧属性 lane：行内展开的画面片段各占底部加高区（缩放/位移/旋转） */}
                  {rowClips(row)
                    .filter((c) => c.track === 'video' && c.keyframes?.length && kfLaneOpen[c.id])
                    .map((clip) => (
                      <ClipKeyframeLanes
                        key={`kfl-${clip.id}`}
                        clip={clip}
                        leftPx={TL_LEFT_PAD + displayLeft(clip) * zoom}
                        span={displaySpan(clip)}
                        pxPerSec={zoom}
                        fps={edl.fps}
                        selectedTimes={kfSel && kfSel.id === clip.id ? kfSel.times : []}
                        onSeek={setCurT}
                        onChange={(frames) => edl.setClipKeyframes(clip.id, frames)}
                        onSelect={(time, shiftKey) => toggleKeyframePick(clip.id, time, shiftKey)}
                        onContext={(e, time, group) => {
                          // 组内右键：不在多选里的菱形收拢为自己（多选共用组菜单）
                          const cur = kfSel && kfSel.id === clip.id ? kfSel.times : [];
                          const picked = cur.some((t) => Math.abs(t - time) < 1e-3) ? cur : [time];
                          setKfSel({ id: clip.id, times: picked });
                          setKCtx({ x: e.clientX, y: e.clientY, id: clip.id, times: picked, group });
                        }}
                      />
                    ))}
                  {/* FX 参数自动化 lane：行内展开的音频片段各占底部加高区（FX:节点·参数 一行一条包络） */}
                  {rowClips(row)
                    .filter((c) => c.track === 'audio' && kfLaneOpen[c.id])
                    .map((clip) => {
                      const lanes = fxAutomationLanesOf(clip);
                      if (!lanes.length) return null;
                      return (
                        <ClipFxAutomationLanes
                          key={`fxl-${clip.id}`}
                          clip={clip}
                          lanes={lanes}
                          leftPx={TL_LEFT_PAD + displayLeft(clip) * zoom}
                          span={displaySpan(clip)}
                          pxPerSec={zoom}
                          fps={edl.fps}
                          onChange={(nodeIndex, paramKey, points) => setClipFxAutomation(clip.id, nodeIndex, paramKey, points)}
                        />
                      );
                    })}
                  {dragOver && dragOver.track === row.track && dragOver.lane === row.lane ? (
                    <span className="drop-line" style={{ left: TL_LEFT_PAD + dragOver.at * zoom }} />
                  ) : null}
                </div>
              )); })()}
            </div>
            {/* 剃刀引导线：rAF 直写 transform，跟随指针 */}
            <div ref={razorGuideRef} className="razor-guide" aria-hidden="true" />
            {snapGuide ? (
              <span className={`snap-guide ${snapGuide.type}`} style={{ left: TL_LEFT_PAD + snapGuide.time * zoom }}>
                <b>{snapGuide.type === 'playhead' ? '播放头' : snapGuide.type === 'marker' ? '标记' : snapGuide.type === 'grid' ? '网格' : snapGuide.type === 'beat' ? '节拍' : '片段边缘'}</b>
              </span>
            ) : null}
            {hoverTime != null && !drag && !beatDrag ? (
              <>
                <span className="hover-line" style={{ left: TL_LEFT_PAD + hoverTime * zoom }}>
                  <i>{timeMode === 'frame' ? `${frameNumberOf(hoverTime, edl.fps)} f` : fmtSec(hoverTime)}</i>
                </span>
                <HoverFramePreview time={hoverTime} clips={clips} projectId={projectId} zoom={zoom} />
              </>
            ) : null}
            {marquee ? (
              <span
                className="tl-marquee"
                style={{
                  left: Math.min(marquee.x1, marquee.x2),
                  top: Math.min(marquee.y1, marquee.y2),
                  width: Math.abs(marquee.x2 - marquee.x1),
                  height: Math.abs(marquee.y2 - marquee.y1),
                }}
              />
            ) : null}
            <div
              className="playhead"
              style={{ left: TL_LEFT_PAD + curT * zoom }}
              title="拖动播放头"
              onPointerDown={(e) => beginScrub(e, 'lanes')}
            />
            {edl.markers.map((m) => (
              <span key={m} className="marker" style={{ left: TL_LEFT_PAD + m * zoom }} title={`标记 ${fmtSec(m)}`} />
            ))}
          </div>
        </div>
      </div>

      <div className="tl-foot">
        <span>
          {timeMode === 'frame'
            ? `${frameNumberOf(curT, edl.fps)} / ${frameNumberOf(contentTotal, edl.fps)} f`
            : `${fmtSec(curT)} / ${fmtSec(contentTotal)}`}
          {' · '}{rows.length} 轨 · {clips.length} 片段
        </span>
        <span>·</span><span>缩放 <b>{zoom}</b> px/s</span>
        <span>·</span><span>行高</span>
        <input className="tl-zoom" type="range" min="30" max="96" value={laneH} onChange={(e) => { setLaneH(Number(e.target.value)); setRowHeights({}); }} />
        <div className="right"><span>Ctrl+滚轮缩放</span><span>·</span><span>拖动片段可跨轨叠加</span></div>
      </div>

      {ctx ? (() => {
        const ctxClip = clips.find((x) => x.id === ctx.id) ?? null;
        const playheadInside = Boolean(ctxClip && curT > ctxClip.timelineStart && curT < ctxClip.timelineStart + clipSpan(ctxClip));
        const freezeOk = Boolean(ctxClip && ctxClip.track === 'video' && ctxClip.sourceUrl && playheadInside);
        return (
        <div className="ctx open" style={{ left: ctx.x, top: ctx.y }} onPointerDown={(e) => e.stopPropagation()}>
          <button type="button" onClick={() => { splitAtPlayhead(); setCtx(null); }}><IconSplit />在播放头分割<span className="kbd2">E</span></button>
          <button
            type="button"
            disabled={!ctxClip || ctxClip.locked || !playheadInside}
            title={playheadInside ? '把左边缘修到播放头（非波纹，后续片段不动）' : '播放头不在片段内'}
            onClick={() => { edl.trimClipToPlayhead('left', curT, ctx.id); setCtx(null); }}
          >
            <IconTrimLeft />修剪到播放头（左）
          </button>
          <button
            type="button"
            disabled={!ctxClip || ctxClip.locked || !playheadInside}
            title={playheadInside ? '把右边缘修到播放头（非波纹，后续片段不动）' : '播放头不在片段内'}
            onClick={() => { edl.trimClipToPlayhead('right', curT, ctx.id); setCtx(null); }}
          >
            <IconTrimRight />修剪到播放头（右）
          </button>
          {ctxClip?.track === 'video' ? (
            <button
              type="button"
              disabled={!freezeOk}
              title={freezeOk ? '在播放头抓一帧并插入图片片段（默认 1s）' : '先把播放头移到片段内部'}
              onClick={() => { freezeFrame(ctx.id); setCtx(null); }}
            >
              <Snowflake />冻结帧
            </button>
          ) : null}
          <div className="line" />
          <button type="button" onClick={() => { edl.copySelection([ctx.id]); setCtx(null); }}><Copy />复制片段<span className="kbd2">⌘C</span></button>
          <button type="button" onClick={() => { edl.rippleDelete([ctx.id]); setCtx(null); }}><Trash2 />波纹删除<span className="kbd2">⌫</span></button>
          <button type="button" onClick={() => { const c = clips.find((x) => x.id === ctx.id); if (c) edl.toggleClipReverse(c.id); setCtx(null); }}><Undo2 />倒放</button>
          <button type="button" onClick={() => { const c = clips.find((x) => x.id === ctx.id); if (c) edl.detachAudio(c.id); setCtx(null); }}><Volume2Ico />音轨分离<span className="kbd2">⌘⇧S</span></button>
          <button type="button" onClick={() => {
            const c = clips.find((x) => x.id === ctx.id);
            if (!c) return;
            const audioId = edl.detachAudio(c.id);
            if (!audioId) { toast.info('该画面已有独立原声轨'); setCtx(null); return; }
            edl.setClipText(audioId, `♪ 人声 · ${c.text?.trim() || '对白'}`.slice(0, 120));
            toast.success('已拆出独立人声轨');
            setCtx(null);
          }}><span style={{ fontSize: 11 }}>♪</span>人声分离</button>
          {/* G12/G15：音量包络与避让的菜单项收在独立小函数里，便于与其它右键改动并行 */}
          {envelopeMenuEntry(clips.find((x) => x.id === ctx.id) ?? null, edl, () => setCtx(null))}
          {duckMenuEntry(clips.find((x) => x.id === ctx.id) ?? null, edl, () => setCtx(null))}
          {/* C1 裁剪：打开检查器裁剪区块（独立小函数，减小合并面） */}
          {cropMenuEntry(clips.find((x) => x.id === ctx.id) ?? null, edl, () => setCtx(null))}
          <div className="line" />
          <button type="button" onClick={() => { const c = clips.find((x) => x.id === ctx.id); if (c) edl.setClipLocked(c.id, !c.locked); setCtx(null); }}><Lock />锁定 / 解锁</button>
          <button type="button" onClick={() => { const c = clips.find((x) => x.id === ctx.id); if (c) edl.setClipEnabled(c.id, c.enabled === false); setCtx(null); }}><Eye />启用 / 停用<span className="kbd2">V</span></button>
        </div>
        );
      })() : null}

      {gapCtx ? (() => {
        const rowSet = gapCtx.empty
          ? []
          : clips.filter(
              (c) =>
                c.track === gapCtx.track &&
                (c.lane ?? 0) === gapCtx.lane &&
                !(gapCtx.track === 'audio' && c.bindGroup?.startsWith('auto:')),
            );
        const gapClips = rowSet.map(toGapClip);
        const gap = gapCtx.empty ? null : resolveGapAt(gapClips, gapCtx.time);
        const allShifts = gapCtx.empty ? [] : resolveCloseAllShifts(gapClips);
        const lockedTrack = gapCtx.empty
          ? false
          : (edl.tracks ?? []).some((t) => t.track === gapCtx.track && (t.lane ?? 0) === gapCtx.lane && t.locked === true);
        const gapBlocked = Boolean(
          gap && gap.followingIds.some((cid) => rowSet.find((c) => c.id === cid)?.locked),
        );
        const allBlocked = allShifts.some((s) => rowSet.find((c) => c.id === s.id)?.locked);
        const canCloseGap = Boolean(gap) && !lockedTrack && !gapBlocked;
        const canCloseAll = allShifts.length > 0 && !lockedTrack && !allBlocked;
        return (
          <div className="ctx open" style={{ left: gapCtx.x, top: gapCtx.y }} onPointerDown={(e) => e.stopPropagation()}>
            <button
              type="button"
              disabled={!canCloseGap}
              title={gapCtx.empty ? '该轨道还没有片段' : lockedTrack ? '轨道已锁定，先解锁再闭合' : gapBlocked ? '该轨道上有锁定片段' : canCloseGap ? undefined : '这里没有可闭合的空隙'}
              onClick={() => runCloseGap(gapCtx, false)}
            >
              <AlignJustify />闭合此空隙
              {gap ? <span className="kbd2">{(gap.gapEnd - gap.gapStart).toFixed(2)}s</span> : null}
            </button>
            <button
              type="button"
              disabled={!canCloseAll}
              title={gapCtx.empty ? '该轨道还没有片段' : lockedTrack ? '轨道已锁定，先解锁再闭合' : allBlocked ? '该轨道上有锁定片段' : canCloseAll ? undefined : '该轨道没有可闭合的空隙'}
              onClick={() => runCloseGap(gapCtx, true)}
            >
              <AlignJustify />闭合全部空隙
            </button>
          </div>
        );
      })() : null}

      {/* G13 关键帧菜单：删除 / 移到播放头 / 清除全部（Shift 多选时可批量） */}
      {kCtx ? (
        <div className="ctx open" style={{ left: kCtx.x, top: kCtx.y }} onPointerDown={(e) => e.stopPropagation()}>
          {(() => {
            const clip = clips.find((x) => x.id === kCtx.id);
            if (!clip) return null;
            return keyframeMenuEntries({
              clip,
              times: kCtx.times,
              playhead: curT,
              fps: edl.fps,
              edl,
              close: () => setKCtx(null),
              group: kCtx.group,
            });
          })()}
        </div>
      ) : null}
    </section>
  );
};

const Volume2Ico = () => <span style={{ fontSize: 11 }}>♪</span>;

export default ShenJianTimeline;
