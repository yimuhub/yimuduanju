/**
 * 一幕·神剪 · 底部多轨时间线（原型同款轨道头 + 标尺 + 片段）
 * 真源是项目 EDL：拖动、跨轨、边缘修剪、Q/W 波纹裁切、分割、删除、
 * 轨道显隐/锁定、缩放与行高全部走 useEdlEditor 的已有方法。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlignJustify, ClipboardPaste, Copy, Eye, EyeOff, Layers, Lock, Magnet, MapPin, Minus, Plus, PlusCircle, Redo2, RotateCcw, Trash2, Type, Undo2, Volume2, VolumeX } from 'lucide-react';
import { IconRazor, IconRippleDelete, IconSelect, IconSplit, IconTrimLeft, IconTrimRight } from './ShenJianIcons';
import { toast } from 'sonner';
import { useStudio } from './StudioShell';
import { useEdl } from './EdlContext';
import { clipSpan, sameOrigin } from './model';
import type { TimelineClip, TimelineTrackKind } from '@shared/api.interface';
import { mediaOfDrag, peekTimelineDrag, readTimelineDrag, trackOfDrag } from '@client/src/lib/timeline-dnd';
import { probeVideoHasAudio } from '@client/src/lib/media-audio';
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

const fmtSec = (s: number) => {
  const t = Math.max(0, s);
  const m = Math.floor(t / 60);
  const sec = Math.floor(t % 60);
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
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
 * 画面运镜关键帧：按关键帧真实时间铺白色菱形（剪映样式）。
 * 点击跳到该关键帧；按住左右拖可直接改关键帧时间，落库走 setClipKeyframes。
 */
const ClipKeyframes = ({
  clip,
  span,
  pxPerSec,
  onSeek,
  onChange,
}: {
  clip: TimelineClip;
  span: number;
  pxPerSec: number;
  onSeek: (t: number) => void;
  onChange: (frames: NonNullable<TimelineClip['keyframes']>) => void;
}) => {
  const frames = clip.keyframes ?? [];
  if (!frames.length) return null;
  const bind = (i: number, f: NonNullable<TimelineClip['keyframes']>[number]) => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
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
  });
  return (
    <>
      {frames.map((f, i) => (
        <b
          key={`${f.time}-${i}`}
          className="kfm"
          style={{ left: Math.max(1, Math.min(span * pxPerSec - 4, f.time * pxPerSec - 1.5)) }}
          title={`画面关键帧 ${f.time.toFixed(2)}s · 缩放 ${Math.round((f.scale ?? 1) * 100)}% · X ${Math.round((f.x ?? 0) * 100)}% · Y ${Math.round((f.y ?? 0) * 100)}%（点击定位，左右拖改时间）`}
          {...bind(i, f)}
        />
      ))}
    </>
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

export const ShenJianTimeline = ({ snapOn, setSnapOn }: { snapOn: boolean; setSnapOn: (v: boolean) => void }) => {
  const [addOpen, setAddOpen] = useState(false);
  const { data, projectId, curT, setCurT, setPreviewMode } = useStudio();
  const edl = useEdl();

  const [zoom, setZoom] = useState(44);
  const [laneH, setLaneH] = useState(64);
  /** 每条轨道单独的显示高度；未设置的轨道跟随全局行高，关键帧轨道默认展开。 */
  const [rowHeights, setRowHeights] = useState<Record<string, number>>({});
  const [tool, setTool] = useState<'select' | 'razor'>('select');
  const [scrollTop, setScrollTop] = useState(0);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [ctx, setCtx] = useState<CtxState>(null);
  const [dragOver, setDragOver] = useState<{ track: TimelineTrackKind; lane: number; at: number; created: boolean } | null>(null);

  const lanesRef = useRef<HTMLDivElement | null>(null);
  const clips = data.timeline?.clips ?? [];
  const total = useMemo(
    () => Math.max(20, data.totalSec || 0, ...clips.map((c) => c.timelineStart + clipSpan(c))),
    [clips, data.totalSec],
  );

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
    // 轨道编号与顺序绑定：上下滑动、增删轨道后仍跟随
    out.forEach((r, i) => { r.no = i + 1; });
    return out;
  }, [clips, edl.tracks, edl.fps]);

  // 所有轨道默认跟随全局行高；用户按轨道头 −/＋ 后，单独值覆盖默认值。
  const rowH = useMemo<Record<string, number>>(() => {
    const map: Record<string, number> = {};
    for (const r of rows) map[r.key] = rowHeights[r.key] ?? laneH;
    return map;
  }, [rows, rowHeights, laneH]);
  const rowTops = useMemo(() => {
    let top = 0;
    return rows.map((r) => {
      const at = top;
      top += rowH[r.key] ?? laneH;
      return at;
    });
  }, [rows, rowH, laneH]);
  const rowIndexAt = useCallback((y: number) => {
    if (!rows.length) return -1;
    // 负值＝指针在第一条轨道上方：这是“往上拖新建一行”的空白区，不能吸到第一行。
    if (y < 0) return -1;
    let hit = rows.length - 1;
    for (let i = 0; i < rows.length; i += 1) {
      if (y < (rowTops[i] ?? 0) + (rowH[rows[i].key] ?? laneH)) { hit = i; break; }
    }
    return hit;
  }, [rows, rowTops, rowH, laneH]);
  const nudgeRowHeight = (row: Row, delta: number) => {
    const current = rowH[row.key] ?? laneH;
    const next = Math.max(44, Math.min(260, current + delta));
    setRowHeights((h) => ({ ...h, [row.key]: next }));
  };

  // 只有「不挂在画面旁」的底部音频才需要基线；分离原声已经并排，不压基线。
  const unpairedAudioRows = rows.filter((r) => r.track === 'audio' && r.pairedVideoLane == null).length;
  const aboveRows = rows.length - unpairedAudioRows;
  const baselineTop = 24 + rows.slice(0, Math.max(0, aboveRows)).reduce((sum, r) => sum + (rowH[r.key] ?? laneH), 0);
  const width = Math.max(900, total * zoom + 260);
  const step = zoom >= 60 ? 1 : zoom >= 30 ? 5 : zoom >= 16 ? 10 : 20;
  const ticks = useMemo(() => Array.from({ length: Math.ceil((total + step) / step) + 1 }, (_, i) => i * step), [total, step]);

  const maxLaneOf = useCallback(
    (track: TimelineTrackKind) => {
      const lanes = clips.filter((c) => c.track === track).map((c) => c.lane ?? 0);
      return lanes.length ? Math.max(...lanes) : -1;
    },
    [clips],
  );

  /** 拖动时按其他片段边缘/播放头磁吸 */
  const snapStart = useCallback(
    (id: string, raw: number, span: number) => {
      if (!snapOn) return raw;
      const threshold = 8 / zoom;
      let best = raw;
      let dist = threshold;
      const consider = (v: number) => {
        const d = Math.abs(raw - v);
        if (d < dist) { dist = d; best = v; }
      };
      for (const c of clips) {
        if (c.id === id || c.track !== (clips.find((x) => x.id === id)?.track)) continue;
        consider(c.timelineStart);
        consider(c.timelineStart + clipSpan(c));
      }
      consider(curT);
      return best;
    },
    [clips, curT, snapOn, zoom],
  );

  const onPointerMove = useCallback((e: PointerEvent) => {
    if (!drag) return;
    const dx = (e.clientX - drag.startX) / zoom;
    if (drag.kind === 'move') {
      const snapped = snapStart(drag.id, drag.origStart + dx, drag.origSpan);
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
        const y = e.clientY - rect.top + wrap.scrollTop - 24;
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
      const d = Math.max(-drag.origSpan + 0.15, Math.min(drag.origSpan - 0.15, dx));
      setDrag({ ...drag, dx: d, span: drag.origSpan - d, origStart: drag.origStart + d });
    } else {
      // 右边缘只能拉到源视频结尾：20s 素材最多 20s，不能无限延长。
      const maxSpan = drag.maxSpan ?? Number.POSITIVE_INFINITY;
      const d = Math.max(0.15 - drag.origSpan, Math.min(maxSpan - drag.origSpan, dx));
      setDrag({ ...drag, dx: d, span: Math.min(maxSpan, drag.origSpan + d) });
    }
  }, [drag, lanesRef, laneH, maxLaneOf, rowIndexAt, rows, snapStart, zoom]);

  const finishDrag = useCallback(() => {
    if (!drag) return;
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
    if (!ctx) return;
    const close = () => setCtx(null);
    window.addEventListener('pointerdown', close, { once: true });
    return () => window.removeEventListener('pointerdown', close);
  }, [ctx]);

  const seekFromEvent = (e: React.MouseEvent, el: HTMLElement) => {
    const rect = el.getBoundingClientRect();
    const x = e.clientX - rect.left + el.scrollLeft;
    setCurT(Math.max(0, Math.min(total, x / zoom)));
  };

  const selected = clips.find((c) => edl.selectedIds.includes(c.id)) ?? null;

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
    const w = Math.max(400, (lanesRef.current?.clientWidth ?? 800) - 24);
    setZoom(Math.max(14, Math.min(120, w / Math.max(1, total))));
    setScrollLeft(0);
  };

  // 快捷键桥：A/B 切工具、Shift+Z 适配、Ctrl+滚轮缩放都由工作台键盘层派发
  useEffect(() => {
    const onTool = (e: Event) => setTool((e as CustomEvent).detail === 'razor' ? 'razor' : 'select');
    const onZoom = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (d === 'fit') fit();
      else setZoom((z) => Math.max(14, Math.min(120, z + (d === 'out' ? -4 : 4))));
    };
    window.addEventListener('yimu:shenjian-tool', onTool);
    window.addEventListener('yimu:shenjian-zoom', onZoom);
    return () => {
      window.removeEventListener('yimu:shenjian-tool', onTool);
      window.removeEventListener('yimu:shenjian-zoom', onZoom);
    };
  });

  const rowClips = (row: Row) =>
    clips
      .filter((c) => {
        // 拖动中的素材实时跟随指针所在的轨道；其余素材按原轨道归属。
        if (drag?.kind === 'move' && drag.id === c.id) return drag.targetRowKey === row.key;
        return c.track === row.track && (c.lane ?? 0) === row.lane;
      })
      // auto: 内嵌原声不落 A 行；同 lane 被分开后自动让位，避免和独立音频重叠。
      .filter((c) => !(row.track === 'audio' && c.bindGroup?.startsWith('auto:')))
      .sort((a, b) => a.timelineStart - b.timelineStart);

  const displayLeft = (c: TimelineClip) => (drag?.id === c.id && drag.kind !== 'trim-r' ? (drag.kind === 'move' ? drag.origStart + drag.dx : drag.origStart) : c.timelineStart);
  const displaySpan = (c: TimelineClip) => (drag?.id === c.id ? drag.span : clipSpan(c));

  return (
    <section className="tl2 timeline">
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
        <button type="button" className="tl-tool" data-tip="撤销 (Ctrl+Z)" onClick={() => edl.undo()}><Undo2 /></button>
        <button type="button" className="tl-tool" data-tip="重做 (Ctrl+Shift+Z)" onClick={() => edl.redo()}><Redo2 /></button>
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
          <input className="tl-zoom" type="range" min="14" max="120" value={zoom} onChange={(e) => setZoom(Number(e.target.value))} />
          <button type="button" className="icon-btn" data-tip="时间线放大 (+)" onClick={() => setZoom((z) => Math.min(120, z + 4))}><Plus /></button>
          <button type="button" className="mini-btn" data-tip="适应窗口" onClick={fit}>适应</button>
        </div>
      </div>

      <div className="tl-body">
        <div className="track-heads">
          <div className="head-ruler"><span>轨道</span><span>{rows.length || 1} 轨</span></div>
          <div className="heads-inner" style={{ transform: `translateY(-${scrollTop}px)` }}>
            {rows.length === 0 ? (
              <div className="track-head empty-head" style={{ height: laneH }}>
                <span className="tname">—</span>
                <span className="tlabel"><em>轨道 1</em><b>空白 · 拖入即定型</b></span>
              </div>
            ) : null}
            {rows.map((row) => (
              <div className={`track-head${drag?.targetRowKey === row.key ? ' droptarget' : ''}`} key={row.key} style={{ height: rowH[row.key] ?? laneH }}>
                <span className="tname">{row.label}</span>
                <span className="tlabel"><em>轨道 {row.no}</em><b>{row.name}</b></span>
                <span className="locks">
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
                  {row.track !== 'subtitle' ? (
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
          ref={lanesRef}
          onScroll={(e) => {
            setScrollTop(e.currentTarget.scrollTop);
            setScrollLeft(e.currentTarget.scrollLeft);
          }}
          onWheel={(e) => {
            if (e.ctrlKey || e.metaKey) {
              e.preventDefault();
              setZoom((z) => Math.max(14, Math.min(120, z + (e.deltaY < 0 ? 4 : -4))));
            } else if (e.altKey) {
              e.preventDefault();
              e.currentTarget.scrollLeft += e.deltaY;
              setScrollLeft(e.currentTarget.scrollLeft);
            }
          }}
          onClick={(e) => {
            if (!(e.target as HTMLElement).closest('.clip')) seekFromEvent(e, e.currentTarget);
          }}
          onDragOver={(e) => {
            e.preventDefault();
            const payload = peekTimelineDrag();
            if (!payload) return;
            const rect = e.currentTarget.getBoundingClientRect();
            const at = Math.max(0, (e.clientX - rect.left + e.currentTarget.scrollLeft) / zoom);
            const y = e.clientY - rect.top + e.currentTarget.scrollTop - 24;
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
            const at = Math.max(0, (e.clientX - rect.left + e.currentTarget.scrollLeft) / zoom);
            const y = e.clientY - rect.top + e.currentTarget.scrollTop - 24;
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
            {(drag?.created || dragOver?.created) ? (
              <div className="new-track-hint">
                松开新建 {(drag?.track ?? dragOver?.track) === 'audio' ? 'A' : (drag?.track ?? dragOver?.track) === 'subtitle' ? 'T' : 'V'}
                {((drag?.lane ?? dragOver?.lane ?? 0) + 1)}
              </div>
            ) : null}
            {drag?.kind === 'move' && !drag.targetRowKey ? (
              <div
                className={`drag-ghost ${clipColor(clips.find((c) => c.id === drag.id) ?? ({} as TimelineClip))}`}
                style={{
                  left: Math.max(0, (drag.origStart + drag.dx) * zoom),
                  top: 24 + Math.max(0, (drag.pointerY ?? 0)) - Math.max(18, (laneH - 10) / 2),
                  width: Math.max(10, drag.origSpan * zoom),
                  height: Math.max(28, laneH - 10),
                }}
              >
                <span>{clipLabel(clips.find((c) => c.id === drag.id) ?? ({} as TimelineClip))}</span>
              </div>
            ) : null}
            <div
              className="ruler"
              onClick={(e) => seekFromEvent(e, e.currentTarget.parentElement?.parentElement as HTMLElement)}
            >
              {ticks.map((t) => (
                <div key={t} className={`tick${t % (step * 2) === 0 ? '' : ' minor'}`} style={{ left: t * zoom }}>
                  {t % (step * 2) === 0 ? fmtSec(t) : ''}
                </div>
              ))}
            </div>
            <div className="baseline" style={{ top: baselineTop }}>
              <span>时间轴基线 · 字幕最上 · 画面居中 · 音频最下</span>
            </div>
            <div className="lanes">
              {rows.length === 0 ? (
                <div className="lane empty-lane" style={{ height: laneH }}>
                  <span>把视频 / 图片 / 音频 / 字幕拖进来 · 第一段素材是什么，第一条轨道就是什么</span>
                </div>
              ) : null}
              {rows.map((row) => (
                <div
                  key={row.key}
                  className={`lane ${row.track}${drag?.targetRowKey === row.key ? ' droptarget' : ''}`}
                  style={{ height: rowH[row.key] ?? laneH }}
                  onDoubleClick={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    const at = (e.clientX - rect.left + (lanesRef.current?.scrollLeft ?? 0)) / zoom;
                    setCurT(at);
                  }}
                >
                  {rowClips(row).map((clip) => {
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
                    const rowHeightNow = rowH[row.key] ?? laneH;
                    const hasEmbeddedAudio = clip.track === 'video' && rowHeightNow >= 58 && !audioDetached;
                    return (
                      <div
                        key={clip.id}
                        className={`clip2 ${clipColor(clip)}${isSelected ? ' selected' : ''}${drag?.id === clip.id && drag.kind === 'move' ? ' dragging' : ''}`}
                        style={{ left: left * zoom, width: w, height: rowHeightNow - 10 }}
                        title={`${clipLabel(clip)} · ${clip.timelineStart.toFixed(2)}s → ${(clip.timelineStart + clipSpan(clip)).toFixed(2)}s`}
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          edl.setSelection([clip.id]);
                          setPreviewMode('timeline');
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
                          edl.setSelection([clip.id]);
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
                        {clip.track === 'audio' || hasEmbeddedAudio ? (
                          <GainLine clip={clip} onChange={(v) => edl.setClipVolume(clip.id, v)} />
                        ) : null}
                        {clip.track === 'subtitle' ? <div className="t"><b>T1 字幕</b>{clip.text || '字幕'}</div> : null}
                        <span className="shade" />
                        <span className="cname">{clipLabel(clip)}</span>
                        <span className="tagline">{clip.track === 'audio' ? '音频' : clip.track === 'subtitle' ? '文本' : `V${(clip.lane ?? 0) + 1}`}</span>
                        {clip.transition && clip.transition.type !== 'none' ? <span className="xf">{clip.transition.type === 'crossfade' ? '叠' : '淡'}</span> : null}
                        {clip.track === 'video' && clip.keyframes?.length ? (
                          <ClipKeyframes
                            clip={clip}
                            span={span}
                            pxPerSec={zoom}
                            onSeek={setCurT}
                            onChange={(frames) => edl.setClipKeyframes(clip.id, frames)}
                          />
                        ) : null}
                        <span
                          className="trim l"
                          onPointerDown={(e) => {
                            e.stopPropagation();
                            edl.setSelection([clip.id]);
                            if (row.locked || clip.locked) return;
                            setDrag({ id: clip.id, kind: 'trim-l', startX: e.clientX, startY: e.clientY, origStart: clip.timelineStart, origSpan: span, lane: clip.lane ?? 0, track: clip.track, dx: 0, span });
                          }}
                        />
                        <span
                          className="trim r"
                          onPointerDown={(e) => {
                            e.stopPropagation();
                            edl.setSelection([clip.id]);
                            if (row.locked || clip.locked) return;
                            const sourceDuration = clip.sourceDuration ?? clip.outPoint;
                            const maxSpan = Math.max(0.15, (sourceDuration - clip.inPoint) / Math.max(0.01, clip.speed || 1));
                            setDrag({ id: clip.id, kind: 'trim-r', startX: e.clientX, startY: e.clientY, origStart: clip.timelineStart, origSpan: span, lane: clip.lane ?? 0, track: clip.track, dx: 0, span, maxSpan });
                          }}
                        />
                      </div>
                    );
                  })}
                  {dragOver && dragOver.track === row.track && dragOver.lane === row.lane ? (
                    <span className="drop-line" style={{ left: dragOver.at * zoom }} />
                  ) : null}
                </div>
              ))}
            </div>
            <div className="playhead" style={{ left: curT * zoom }} />
            {edl.markers.map((m) => (
              <span key={m} className="marker" style={{ left: m * zoom }} title={`标记 ${fmtSec(m)}`} />
            ))}
          </div>
        </div>
      </div>

      <div className="tl-foot">
        <span>{fmtSec(curT)} / {fmtSec(total)} · {rows.length} 轨 · {clips.length} 片段</span>
        <span>·</span><span>缩放 <b>{zoom}</b> px/s</span>
        <span>·</span><span>行高</span>
        <input className="tl-zoom" type="range" min="30" max="96" value={laneH} onChange={(e) => { setLaneH(Number(e.target.value)); setRowHeights({}); }} />
        <div className="right"><span>Ctrl+滚轮缩放</span><span>·</span><span>拖动片段可跨轨叠加</span></div>
      </div>

      {ctx ? (
        <div className="ctx open" style={{ left: ctx.x, top: ctx.y }} onPointerDown={(e) => e.stopPropagation()}>
          <button type="button" onClick={() => { splitAtPlayhead(); setCtx(null); }}><IconSplit />在播放头分割<span className="kbd2">E</span></button>
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
          <div className="line" />
          <button type="button" onClick={() => { const c = clips.find((x) => x.id === ctx.id); if (c) edl.setClipLocked(c.id, !c.locked); setCtx(null); }}><Lock />锁定 / 解锁</button>
          <button type="button" onClick={() => { const c = clips.find((x) => x.id === ctx.id); if (c) edl.setClipEnabled(c.id, c.enabled === false); setCtx(null); }}><Eye />启用 / 停用<span className="kbd2">V</span></button>
        </div>
      ) : null}
    </section>
  );
};

const Volume2Ico = () => <span style={{ fontSize: 11 }}>♪</span>;

export default ShenJianTimeline;
