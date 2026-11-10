/**
 * Studio · 多轨线性剪辑时间线
 * -------------------------------------------------------------
 * 唯一数据源 = GET /timeline 的 EDL（timeline_clips），不再从 shots 现场拼装。
 * 轨道按 `track + lane` 动态生成：
 *   · 字幕轨 S1/S2…（可重叠，可拖动、可删除、可双击改字）
 *   · 画面轨 V1（来自镜头视频，可拖动、修剪、排齐）
 *   · 音频轨 A1 对白 / A2 配乐 / A3 音效 / …（可重叠，可拖动、修剪、删除）
 *
 * 交互：
 *   · 标尺/空白拖动 = scrub；Ctrl/⌘ + 滚轮 = 以指针为锚点缩放
 *   · 片段主体横向拖动 = 改 timelineStart；纵向拖到同类型其它轨 = 换 lane
 *   · 片段左右把手 = 修剪源媒体入/出点（左侧同步推 timelineStart）
 *   · 悬停片段右上角 × / Delete = 删除；双击字幕 = 就地编辑
 *   · S = 在播放头处分割；⌘Z / ⌘⇧Z = 撤销重做；⌘S = 立即保存
 *   · 加轨道菜单：加字幕 / 加音频素材 / 新增字幕轨 / 新增音频轨（时间重叠）
 *
 * 所有编辑走 useEdlEditor：乐观更新 + 400ms 防抖 PUT 整体替换（事务落库）。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import interact from 'interactjs';
import { toast } from 'sonner';
import {
  AlignJustify,
  ChevronDown,
  ChevronUp,
  Film,
  Layers,
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
  X,
} from 'lucide-react';
import { useStudio } from './StudioShell';
import { clipSpan, shotLabel, toTimecode } from './model';
import { useEdlEditor } from './useEdlEditor';
import { exportTimeline } from '@client/src/api/timeline';
import { listProjectAssets, mediaUrl } from '@client/src/api/assets';
import type { Asset, TimelineClip } from '@shared/api.interface';

const PX_MIN = 8;
const PX_MAX = 120;
const PX_DEFAULT = 17;
const ROW_H = 26;
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const round3 = (n: number) => Math.round(n * 1000) / 1000;

type RowTrack = TimelineClip['track'];

interface Row {
  key: string;
  track: RowTrack;
  lane: number;
  code: string;
  title: string;
  color: string;
}

const audioLaneTitle = (lane: number) =>
  lane === 0 ? '对白' : lane === 1 ? '配乐' : lane === 2 ? '音效' : `音轨${lane + 1}`;

const makeRow = (track: RowTrack, lane: number): Row => {
  const key = `${track}:${lane}`;
  if (track === 'subtitle') {
    return {
      key,
      track,
      lane,
      code: `S${lane + 1}`,
      title: lane === 0 ? '字幕' : `字幕${lane + 1}`,
      color: '#5A4E78',
    };
  }
  if (track === 'audio') {
    return {
      key,
      track,
      lane,
      code: `A${lane + 1}`,
      title: audioLaneTitle(lane),
      color: '#3E6B4C',
    };
  }
  if (track === 'video') {
    return {
      key,
      track,
      lane,
      code: `V${lane + 1}`,
      title: lane === 0 ? '画面' : `画面${lane + 1}`,
      color: '#3F5C73',
    };
  }
  return {
    key,
    track,
    lane,
    code: 'O',
    title: '叠加',
    color: '#7A5B3E',
  };
};

export const StudioTimeline = () => {
  const {
    data,
    setSel,
    curT,
    setCurT,
    playing,
    setPlaying,
    tlCollapsed,
    setTlCollapsed,
    toggleTlCollapsed,
  } = useStudio();
  const shots = data.shots;
  const clips = useMemo(() => data.timeline?.clips ?? [], [data.timeline]);
  const collapsed = tlCollapsed;
  const editor = useEdlEditor();

  const [pxPerSec, setPxPerSec] = useState(PX_DEFAULT);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [subEdit, setSubEdit] = useState<{ id: string; text: string } | null>(null);
  const [exporting, setExporting] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickLane, setPickLane] = useState(1);
  const [audioAssets, setAudioAssets] = useState<Asset[]>([]);
  const [loadingAssets, setLoadingAssets] = useState(false);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const hoverRef = useRef(false);
  const pxRef = useRef(pxPerSec);
  pxRef.current = pxPerSec;

  // 拖动回调里读最新值，避免选中态/播放头变化导致 interact 解绑重绑
  const clipsRef = useRef(clips);
  clipsRef.current = clips;
  const curTRef = useRef(curT);
  curTRef.current = curT;
  const selectedRef = useRef<string | null>(selectedClipId);
  selectedRef.current = selectedClipId;
  const editorRef = useRef(editor);
  editorRef.current = editor;

  const shotMap = useMemo(() => new Map(shots.map((s) => [s.id, s])), [shots]);

  const total = useMemo(() => {
    let end = 0;
    for (const c of clips) end = Math.max(end, c.timelineStart + clipSpan(c));
    return end > 0 ? end : Math.max(0.5, data.totalSec);
  }, [clips, data.totalSec]);
  const totalRef = useRef(total);
  totalRef.current = total;

  // ---------- 轨道行：字幕（上）→ 画面 → 音频（下），lane 越大越靠后 ----------
  const rows = useMemo(() => {
    const map = new Map<string, Row>();
    const ensure = (track: RowTrack, lane: number) => {
      const key = `${track}:${lane}`;
      if (!map.has(key)) map.set(key, makeRow(track, lane));
    };
    ensure('subtitle', 0);
    ensure('video', 0);
    ensure('audio', 0);
    ensure('audio', 1);
    for (const c of clips) ensure(c.track, c.lane ?? 0);
    const order: RowTrack[] = ['subtitle', 'video', 'audio', 'overlay'];
    return [...map.values()].sort(
      (a, b) => order.indexOf(a.track) - order.indexOf(b.track) || a.lane - b.lane,
    );
  }, [clips]);

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
    clips.filter((c) => c.track === track).reduce((m, c) => Math.max(m, c.lane ?? 0), 0);

  // 轨道数变化时同步时间线总高度（否则 overflow 隐藏会吃掉下面的轨）
  useEffect(() => {
    const app = scrollRef.current?.closest('.app') as HTMLElement | null;
    if (!app) return undefined;
    if (collapsed) {
      app.style.removeProperty('--tl-h');
      return undefined;
    }
    const h = clamp(32 + 16 + rows.length * ROW_H + 8, 198, 470);
    app.style.setProperty('--tl-h', `${h}px`);
    return () => {
      app.style.removeProperty('--tl-h');
    };
  }, [rows.length, collapsed]);

  /** 刻度步长随缩放自适应：保证主刻度间距 ≥ 56px */
  const ticks = useMemo(() => {
    const steps = [0.5, 1, 2, 5, 10, 15, 30, 60, 120];
    const stepSec = steps.find((s) => s * pxPerSec >= 56) ?? 120;
    const out: { x: number; major: boolean; label: string }[] = [];
    const count = Math.min(600, Math.ceil(total / stepSec) + 1);
    for (let i = 0; i <= count; i += 1) {
      const t = i * stepSec;
      out.push({
        x: t * pxPerSec,
        major: i % 5 === 0,
        label: toTimecode(t).slice(3, 8),
      });
    }
    return out;
  }, [total, pxPerSec]);

  // ---------- 缩放（锚点保持指针下的时间不动） ----------
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

  // 播放时自动跟随播放头
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

  // ---------- 线性 scrub ----------
  const scrubFrom = (clientX: number) => {
    const el = scrollRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const t = (clientX - rect.left + el.scrollLeft) / pxRef.current;
    setCurT(clamp(t, 0, totalRef.current));
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

  // ---------- 片段拖动（横向改时间 / 纵向换轨）+ 边缘修剪 ----------
  const clipSig = clips.map((c) => `${c.id}@${c.track}:${c.lane ?? 0}`).join('|');
  useEffect(() => {
    const root = scrollRef.current;
    if (!root || clips.length === 0) return undefined;
    const px = pxPerSec;
    const bound: HTMLElement[] = [];

    const rowAt = (x: number, y: number) => {
      const el = document.elementFromPoint(x, y);
      const trk = el?.closest('.trk') as HTMLElement | null;
      if (!trk || !root.contains(trk)) return null;
      return {
        key: trk.dataset.rowKey ?? '',
        track: trk.dataset.rowTrack as RowTrack,
        lane: Number(trk.dataset.rowLane ?? 0),
      };
    };

    root.querySelectorAll<HTMLElement>('[data-clip-id]').forEach((el) => {
      const id = el.dataset.clipId ?? '';
      bound.push(el);

      const body = interact(el);
      body.draggable({
        ignoreFrom: '.tl-handle, .tl-clip-del, .tl-sub-input',
        inertia: false,
        listeners: {
          start() {
            setSelectedClipId(id);
            setPlaying(false);
            el.classList.add('dragging');
            // 让 elementFromPoint 穿过被拖动的片段，命中下方目标轨
            el.style.pointerEvents = 'none';
          },
          move(ev) {
            const src = clipsRef.current.find((c) => c.id === id);
            let dy = 0;
            const target = rowAt(ev.clientX, ev.clientY);
            if (src && target && target.track === src.track && target.lane !== (src.lane ?? 0)) {
              const srcRow = el.parentElement as HTMLElement | null;
              const targetRow = root.querySelector<HTMLElement>(`[data-row-key="${target.key}"]`);
              if (srcRow && targetRow) dy = targetRow.offsetTop - srcRow.offsetTop;
            }
            el.style.transform = `translate(${ev.clientX - ev.clientX0}px, ${dy}px)`;
          },
          end(ev) {
            el.classList.remove('dragging');
            el.style.transform = '';
            el.style.pointerEvents = '';
            const src = clipsRef.current.find((c) => c.id === id);
            if (!src) return;
            const dx = ev.clientX - ev.clientX0;
            if (Math.abs(dx) < 3 && Math.abs(ev.clientY - ev.clientY0) < ROW_H / 2) return;

            let nextStart = Math.max(0, src.timelineStart + dx / px);
            // 吸附：0 / 播放头 / 其它片段的首尾，阈值 7px
            let best = 7 / px;
            let snap: number | null = null;
            const targets = [0, curTRef.current];
            for (const c of clipsRef.current) {
              if (c.id === id) continue;
              targets.push(c.timelineStart, c.timelineStart + clipSpan(c));
            }
            for (const t of targets) {
              const d = Math.abs(nextStart - t);
              if (d < best) {
                best = d;
                snap = t;
              }
            }
            if (snap != null) nextStart = snap;

            const target = rowAt(ev.clientX, ev.clientY);
            const lane = target && target.track === src.track ? target.lane : (src.lane ?? 0);
            if (Math.abs(nextStart - src.timelineStart) > 0.005 || lane !== (src.lane ?? 0)) {
              editorRef.current.moveClip(id, round3(nextStart), lane);
            }
          },
        },
      });

      el.querySelectorAll<HTMLElement>('.tl-handle').forEach((h) => {
        bound.push(h);
        const edge = h.dataset.edge === 'left' ? 'left' : 'right';
        const inter = interact(h);
        inter.draggable({
          inertia: false,
          listeners: {
            start(ev) {
              ev.stopPropagation();
              setSelectedClipId(id);
              el.classList.add('trimming');
            },
            move(ev) {
              const live = clipsRef.current.find((c) => c.id === id);
              if (!live) return;
              const span = clipSpan(live);
              const raw = ev.clientX - ev.clientX0;
              const dx = edge === 'left' ? Math.min(raw, span * px - 4) : raw;
              if (edge === 'left') {
                el.style.marginLeft = `${dx}px`;
                el.style.width = `${Math.max(4, span * px - dx)}px`;
              } else {
                el.style.width = `${Math.max(4, span * px + dx)}px`;
              }
            },
            end(ev) {
              el.classList.remove('trimming');
              el.style.marginLeft = '';
              el.style.width = '';
              const deltaSec = round3((ev.clientX - ev.clientX0) / px);
              if (Math.abs(deltaSec) >= 0.05) {
                editorRef.current.trimClip(id, edge, deltaSec);
              }
            },
          },
        });
      });
    });

    return () => {
      for (const el of bound) interact(el).unset();
    };
    // 仅在片段集合 / 轨道 / 缩放变化时重绑；选中与播放头走 ref
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clipSig, pxPerSec]);

  // ---------- 键盘（仅指针在时间线内时生效，避免抢页面快捷键） ----------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!hoverRef.current) return;
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        if (e.shiftKey) void editorRef.current.redo();
        else void editorRef.current.undo();
        return;
      }
      if (mod && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        void editorRef.current.saveNow();
        return;
      }
      if (mod || e.altKey) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (!selectedRef.current) return;
        e.preventDefault();
        editorRef.current.removeClip(selectedRef.current);
        setSelectedClipId(null);
        return;
      }
      if (e.key === 's' || e.key === 'S') {
        e.preventDefault();
        const created = editorRef.current.splitAtPlayhead(
          curTRef.current,
          selectedRef.current ?? undefined,
        );
        if (created) setSelectedClipId(created);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // 加轨道菜单：点外面关闭
  useEffect(() => {
    if (!addOpen) return undefined;
    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t?.closest('.tl-add')) setAddOpen(false);
    };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [addOpen]);

  const selectClip = (c: TimelineClip) => {
    setSelectedClipId(c.id);
    if (c.track === 'video' && c.sourceShotId) {
      const i = shots.findIndex((s) => s.id === c.sourceShotId);
      if (i >= 0) setSel(i);
    }
  };

  const openAudioPicker = (lane: number) => {
    setAddOpen(false);
    setPickLane(clamp(lane, 0, 7));
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
    setSelectedClipId(created);
    setPickerOpen(false);
    toast.success(`已插入到 A${pickLane + 1} · ${toTimecode(curT)}`, { duration: 1600 });
  };

  const addSubtitleAt = (lane: number) => {
    setAddOpen(false);
    const created = editor.addSubtitle(curT, lane, '新字幕');
    if (!created) {
      toast.error('时间线还没加载完成，请稍后再试');
      return;
    }
    setSelectedClipId(created);
    setSubEdit({ id: created, text: '新字幕' });
  };

  const commitSubtitle = () => {
    if (!subEdit) return;
    const { id, text } = subEdit;
    setSubEdit(null);
    editor.editSubtitle(id, text.trim());
  };

  // ---------- 导出（先落库再按 EDL 渲染） ----------
  const runExport = async () => {
    if (!data.projectId || exporting) return;
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

  // ---------- 收起态 ----------
  if (collapsed) {
    return (
      <section className="tl tl-collapsed-bar" id="tl">
        <div className="tl-head">
          <h3>时间线</h3>
          <span className="tl-count num">
            · {shots.length} 镜 / {clips.length} 片段
          </span>
          {editor.dirty ? <span className="tl-save dirty">未保存</span> : null}
          <span className="sp" />
          <span className="tl-tc">{toTimecode(total)}</span>
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

  const canvasW = Math.max(total * pxPerSec + 160, 320);
  const saveText = editor.saving
    ? '保存中…'
    : editor.dirty
      ? '未保存'
      : editor.ready
        ? '已保存'
        : '载入中';

  const renderClip = (c: TimelineClip) => {
    const span = clipSpan(c);
    const shot = c.sourceShotId ? shotMap.get(c.sourceShotId) : undefined;
    const cls = [
      'clip',
      c.track === 'subtitle' ? 'v2' : c.track === 'audio' ? 'a' : c.sourceUrl ? 'v' : 'pending',
      selectedClipId === c.id ? 'on' : '',
    ]
      .filter(Boolean)
      .join(' ');
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
        ? `${shot ? `#${shot.no} ${shot.txt}` : '画面片段'}（拖动移动 / 拖到其它画面轨 / 拖把手修剪）`
        : c.track === 'subtitle'
          ? '字幕：双击改字 / 拖动移位 / 拖到其它字幕轨重叠 / × 删除'
          : `音频：${c.text || '未命名'}（拖动移位 / 拖到其它音轨重叠 / × 删除）`;
    return (
      <div
        key={c.id}
        data-clip-id={c.id}
        className={cls}
        style={{
          left: `${c.timelineStart * pxPerSec}px`,
          width: `${Math.max(6, span * pxPerSec)}px`,
        }}
        role="button"
        tabIndex={0}
        aria-label={tip}
        title={tip}
        onClick={() => selectClip(c)}
        onDoubleClick={() => {
          if (c.track === 'subtitle') setSubEdit({ id: c.id, text: c.text || '' });
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            selectClip(c);
          }
        }}
      >
        {subEdit?.id === c.id && c.track === 'subtitle' ? (
          <input
            className="tl-sub-input"
            autoFocus
            value={subEdit.text}
            onChange={(e) => setSubEdit({ id: c.id, text: e.target.value })}
            onBlur={commitSubtitle}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitSubtitle();
              if (e.key === 'Escape') setSubEdit(null);
              e.stopPropagation();
            }}
            onPointerDown={(e) => e.stopPropagation()}
          />
        ) : (
          <span>{label.slice(0, 26)}</span>
        )}
        <i className="tl-handle l" data-edge="left" title="修剪入点" />
        <i className="tl-handle r" data-edge="right" title="修剪出点" />
        <button
          type="button"
          className="tl-clip-del"
          title="删除片段"
          aria-label="删除片段"
          onClick={(e) => {
            e.stopPropagation();
            editor.removeClip(c.id);
            if (selectedClipId === c.id) setSelectedClipId(null);
          }}
        >
          <X size={9} strokeWidth={2.8} />
        </button>
      </div>
    );
  };

  return (
    <section
      className="tl"
      id="tl"
      onPointerEnter={() => {
        hoverRef.current = true;
      }}
      onPointerLeave={() => {
        hoverRef.current = false;
        if (addOpen) setAddOpen(false);
      }}
    >
      <div className="tl-head">
        <h3>时间线</h3>
        <span className="chip num">
          {shots.length} 镜 · {clips.length} 片段
        </span>
        <span className="sp" />
        <span
          className={`tl-save${editor.saving ? ' busy' : editor.dirty ? ' dirty' : ''}`}
          title={editor.dirty ? '改动会在 0.4 秒后自动保存' : '时间线已与服务器同步'}
        >
          {saveText}
        </span>
        <span className="tl-tc">
          {toTimecode(curT)} / {toTimecode(total)}
        </span>

        <div className="tl-tools">
          <button
            type="button"
            className="icon-btn"
            title="撤销 (⌘Z)"
            disabled={!editor.canUndo}
            onClick={() => void editor.undo()}
          >
            <Undo2 size={13} />
          </button>
          <button
            type="button"
            className="icon-btn"
            title="重做 (⌘⇧Z)"
            disabled={!editor.canRedo}
            onClick={() => void editor.redo()}
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
              const created = editor.splitAtPlayhead(curT, selectedClipId ?? undefined);
              if (created) setSelectedClipId(created);
            }}
          >
            <Scissors size={13} />
          </button>
          <button
            type="button"
            className="icon-btn danger"
            title="删除选中片段 (Delete)"
            disabled={!selectedClipId}
            onClick={() => {
              if (!selectedClipId) return;
              editor.removeClip(selectedClipId);
              setSelectedClipId(null);
            }}
          >
            <Trash2 size={13} />
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
                  onClick={() => addSubtitleAt(clamp(maxLane('subtitle') + 1, 0, 7))}
                >
                  <Layers size={12} /> 新增字幕轨（可重叠）
                </button>
                <button
                  type="button"
                  onClick={() => openAudioPicker(clamp(maxLane('audio') + 1, 0, 7))}
                >
                  <Layers size={12} /> 新增音频轨（可重叠）
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
          <span className="tl-sep" />
          <button
            type="button"
            className="icon-btn"
            title="缩小 (⌘滚轮)"
            onClick={() => applyZoom(pxPerSec / 1.25)}
          >
            <Minus size={13} />
          </button>
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

      <div className="tl-main">
        <div className="tl-labels">
          {rows.map((r) => (
            <div className="tl-lb" key={r.key} title={`${r.code} ${r.title}`}>
              <span className="sw" style={{ background: r.color }} />
              <b>{r.code}</b>
              {r.title}
            </div>
          ))}
        </div>

        <div className="tl-tracks" id="tracks" ref={scrollRef}>
          <div className="tl-canvas" style={{ width: `${canvasW}px` }}>
            <div className="ruler" onPointerDown={beginScrub} title="拖动定位播放头">
              {ticks.map((t, i) => (
                <div
                  key={i}
                  className={`tick${t.major ? ' maj' : ''}`}
                  style={{ left: `${t.x}px` }}
                >
                  {t.label ? <span>{t.label}</span> : null}
                </div>
              ))}
            </div>

            {rows.map((row) => (
              <div
                key={row.key}
                className="trk"
                data-row-key={row.key}
                data-row-track={row.track}
                data-row-lane={row.lane}
                onPointerDown={(e) => {
                  if (e.target === e.currentTarget) beginScrub(e);
                }}
              >
                {(clipsByRow.get(row.key) ?? []).map(renderClip)}
              </div>
            ))}

            {clips.length === 0 ? (
              <div className="tl-empty">
                时间线还没有片段
                <em>生成镜头视频后会自动出现；也可用 ＋ 按钮插入字幕 / 音频</em>
              </div>
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
              <span className="num">插入点 {toTimecode(curT)}</span>
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
