/**
 * 一幕·神剪 · 底部多轨时间线（原型同款轨道头 + 标尺 + 片段）
 * 真源是项目 EDL：拖动、跨轨、边缘修剪、Q/W 波纹裁切、分割、删除、
 * 轨道显隐/锁定、缩放与行高全部走 useEdlEditor 的已有方法。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Copy,
  Eye,
  Lock,
  Magnet,
  MapPin,
  Minus,
  MousePointer2,
  Plus,
  Redo2,
  Scissors,
  Trash2,
  Undo2,
} from 'lucide-react';
import { toast } from 'sonner';
import { useStudio } from './StudioShell';
import { useEdl } from './EdlContext';
import { clipSpan } from './model';
import type { TimelineClip, TimelineTrackKind } from '@shared/api.interface';
import { peekTimelineDrag, readTimelineDrag, trackOfDrag } from '@client/src/lib/timeline-dnd';

type Row = {
  key: string;
  track: TimelineTrackKind;
  lane: number;
  label: string;
  name: string;
  muted: boolean;
  locked: boolean;
};

type DragState = {
  id: string;
  kind: 'move' | 'trim-l' | 'trim-r';
  startX: number;
  origStart: number;
  origSpan: number;
  lane: number;
  track: TimelineTrackKind;
  dx: number;
  span: number;
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

export const ShenJianTimeline = ({ snapOn, setSnapOn }: { snapOn: boolean; setSnapOn: (v: boolean) => void }) => {
  const { data, curT, setCurT, setPreviewMode } = useStudio();
  const edl = useEdl();

  const [zoom, setZoom] = useState(38);
  const [laneH, setLaneH] = useState(44);
  const [tool, setTool] = useState<'select' | 'razor'>('select');
  const [scrollTop, setScrollTop] = useState(0);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [ctx, setCtx] = useState<CtxState>(null);
  const [dragOver, setDragOver] = useState<{ track: TimelineTrackKind; lane: number; at: number } | null>(null);

  const lanesRef = useRef<HTMLDivElement | null>(null);
  const clips = data.timeline?.clips ?? [];
  const total = useMemo(
    () => Math.max(20, data.totalSec || 0, ...clips.map((c) => c.timelineStart + clipSpan(c))),
    [clips, data.totalSec],
  );

  const rows = useMemo<Row[]>(() => {
    const maxVideo = Math.max(2, ...clips.filter((c) => c.track === 'video').map((c) => c.lane ?? 0));
    const maxAudio = Math.max(1, ...clips.filter((c) => c.track === 'audio').map((c) => c.lane ?? 0));
    const maxSub = Math.max(0, ...clips.filter((c) => c.track === 'subtitle').map((c) => c.lane ?? 0));
    const metaOf = (track: TimelineTrackKind, lane: number) =>
      (edl.tracks ?? []).find((t) => t.track === track && (t.lane ?? 0) === lane);
    const out: Row[] = [];
    for (let lane = maxVideo; lane >= 0; lane -= 1) {
      const meta = metaOf('video', lane);
      out.push({
        key: `video:${lane}`,
        track: 'video',
        lane,
        label: `V${lane + 1}`,
        name: meta?.name || (lane === 0 ? '主画面' : '叠加层'),
        muted: meta?.exportEnabled === false,
        locked: meta?.locked === true,
      });
    }
    for (let lane = 0; lane <= maxAudio; lane += 1) {
      const meta = metaOf('audio', lane);
      out.push({
        key: `audio:${lane}`,
        track: 'audio',
        lane,
        label: `A${lane + 1}`,
        name: meta?.name || (lane === 0 ? '对白 / 配音' : '音乐 / 音效'),
        muted: meta?.muted === true,
        locked: meta?.locked === true,
      });
    }
    for (let lane = 0; lane <= maxSub; lane += 1) {
      const meta = metaOf('subtitle', lane);
      out.push({
        key: `subtitle:${lane}`,
        track: 'subtitle',
        lane,
        label: `T${lane + 1}`,
        name: meta?.name || '字幕',
        muted: meta?.muted === true,
        locked: meta?.locked === true,
      });
    }
    return out;
  }, [clips, edl.tracks]);

  const width = Math.max(900, total * zoom + 260);
  const step = zoom >= 60 ? 1 : zoom >= 30 ? 5 : zoom >= 16 ? 10 : 20;
  const ticks = useMemo(() => Array.from({ length: Math.ceil((total + step) / step) + 1 }, (_, i) => i * step), [total, step]);

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
      setDrag({ ...drag, dx: snapped - drag.origStart, span: drag.origSpan });
    } else if (drag.kind === 'trim-l') {
      const d = Math.max(-drag.origSpan + 0.15, Math.min(drag.origSpan - 0.15, dx));
      setDrag({ ...drag, dx: d, span: drag.origSpan - d, origStart: drag.origStart + d });
    } else {
      const d = Math.max(0.15 - drag.origSpan, dx);
      setDrag({ ...drag, dx: d, span: drag.origSpan + d });
    }
  }, [drag, snapStart, zoom]);

  const finishDrag = useCallback(() => {
    if (!drag) return;
    if (drag.kind === 'move' && Math.abs(drag.dx) > 0.01) {
      edl.moveClipToLane(drag.id, Math.max(0, drag.origStart + drag.dx), drag.lane, drag.lane !== (clips.find((c) => c.id === drag.id)?.lane ?? 0));
    } else if (drag.kind === 'trim-l' && Math.abs(drag.dx) > 0.01) {
      edl.trimClip(drag.id, 'left', drag.dx);
    } else if (drag.kind === 'trim-r' && Math.abs(drag.dx) > 0.01) {
      edl.trimClip(drag.id, 'right', drag.dx);
    }
    setDrag(null);
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', finishDrag);
  }, [drag, edl, clips]);

  useEffect(() => {
    if (!drag) return;
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', finishDrag);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', finishDrag);
    };
  }, [drag, onPointerMove, finishDrag]);

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

  const addTrack = () => {
    const lane = edl.addTrack('video');
    if (lane == null) toast.error('新建轨道失败');
    else toast.success(`已新建 V${lane + 1}`);
  };

  const fit = () => {
    const w = Math.max(400, (lanesRef.current?.clientWidth ?? 800) - 24);
    setZoom(Math.max(14, Math.min(120, w / Math.max(1, total))));
    setScrollLeft(0);
  };

  const rowClips = (row: Row) =>
    clips
      .filter((c) => c.track === row.track && (c.lane ?? 0) === row.lane)
      .sort((a, b) => a.timelineStart - b.timelineStart);

  const displayLeft = (c: TimelineClip) => (drag?.id === c.id && drag.kind !== 'trim-r' ? (drag.origStart) : c.timelineStart);
  const displaySpan = (c: TimelineClip) => (drag?.id === c.id ? drag.span : clipSpan(c));

  return (
    <section className="tl2 timeline">
      <div className="tl-tools">
        <button type="button" className={`tl-tool${tool === 'select' ? ' on' : ''}`} data-tip="选择工具 (A)：点选/拖动片段" onClick={() => setTool('select')}>
          <MousePointer2 /><span className="dotmark" />
        </button>
        <button type="button" className={`tl-tool${tool === 'razor' ? ' on' : ''}`} data-tip="剃刀工具 (B)：在点击处切开片段" onClick={() => setTool('razor')}>
          <Scissors /><span className="dotmark" />
        </button>
        <div className="sep" />
        <button type="button" className="tl-tool" data-tip="分割 (E / Ctrl+B)：在播放头处切成两段" onClick={splitAtPlayhead}><Scissors /></button>
        <button type="button" className="tl-tool" data-tip="删除前半段 (Q)：保留播放头之后" onClick={deleteLeft}><span className="trim-ico l">▥</span></button>
        <button type="button" className="tl-tool" data-tip="删除后半段 (W)：保留播放头之前" onClick={deleteRight}><span className="trim-ico r">▥</span></button>
        <button type="button" className="tl-tool" data-tip="波纹删除：删除并自动合拢空隙" onClick={() => selected && edl.rippleDelete([selected.id])}><Trash2 /></button>
        <button type="button" className="tl-tool" data-tip="删除选中片段 (Delete)" onClick={() => selected && edl.rippleDelete([selected.id])}><span className="del-ico">✕</span></button>
        <div className="sep" />
        <button type="button" className="tl-tool" data-tip="撤销 (Ctrl+Z)" onClick={() => edl.undo()}><Undo2 /></button>
        <button type="button" className="tl-tool" data-tip="重做 (Ctrl+Shift+Z)" onClick={() => edl.redo()}><Redo2 /></button>
        <button type="button" className={`tl-tool${snapOn ? ' on' : ''}`} data-tip="吸附开关 (N)" onClick={() => setSnapOn(!snapOn)}><Magnet /></button>
        <button type="button" className="tl-tool" data-tip="添加标记 (M)" onClick={() => edl.addMarker(curT)}><MapPin /></button>
        <div className="tl-caption">A 选择 · B 剃刀 · E 分割 · Q 删前 · W 删后</div>
        <div className="grow">
          <button type="button" className="mini-btn" data-tip="新增轨道：可以无限往上叠 V4/V5…" onClick={addTrack}><Plus /> 轨道</button>
          <button type="button" className="icon-btn" data-tip="时间线缩小 (-)" onClick={() => setZoom((z) => Math.max(14, z - 4))}><Minus /></button>
          <input className="tl-zoom" type="range" min="14" max="120" value={zoom} onChange={(e) => setZoom(Number(e.target.value))} />
          <button type="button" className="icon-btn" data-tip="时间线放大 (+)" onClick={() => setZoom((z) => Math.min(120, z + 4))}><Plus /></button>
          <button type="button" className="mini-btn" data-tip="适应窗口" onClick={fit}>适应</button>
        </div>
      </div>

      <div className="tl-body">
        <div className="track-heads">
          <div className="heads-inner" style={{ transform: `translateY(-${scrollTop}px)` }}>
            <div className="head-ruler"><span>轨道</span><span>{rows.length} 轨</span></div>
            {rows.map((row) => (
              <div className="track-head" key={row.key} style={{ height: laneH }}>
                <span className="tname">{row.label}</span>
                <span className="tlabel">{row.name}</span>
                <span className="locks">
                  <button
                    type="button"
                    className={row.muted ? 'on' : ''}
                    title={row.muted ? '恢复显示/发声' : '停用该轨'}
                    onClick={() =>
                      row.track === 'video'
                        ? edl.updateTrack('video', row.lane, { exportEnabled: row.muted })
                        : edl.updateTrack(row.track, row.lane, { muted: !row.muted })
                    }
                  >
                    <Eye />
                  </button>
                  <button
                    type="button"
                    className={row.locked ? 'on' : ''}
                    title={row.locked ? '解锁轨道' : '锁定轨道'}
                    onClick={() => edl.updateTrack(row.track, row.lane, { locked: !row.locked })}
                  >
                    <Lock />
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
            const idx = Math.max(0, Math.min(rows.length - 1, Math.floor(y / laneH)));
            const row = rows[idx];
            if (row) setDragOver({ track: trackOfDrag(payload), lane: row.track === trackOfDrag(payload) ? row.lane : row.lane, at });
          }}
          onDragLeave={() => setDragOver(null)}
          onDrop={(e) => {
            e.preventDefault();
            const payload = readTimelineDrag(e);
            if (!payload?.url) return;
            const rect = e.currentTarget.getBoundingClientRect();
            const at = Math.max(0, (e.clientX - rect.left + e.currentTarget.scrollLeft) / zoom);
            const y = e.clientY - rect.top + e.currentTarget.scrollTop - 24;
            const idx = Math.max(0, Math.min(rows.length - 1, Math.floor(y / laneH)));
            const row = rows[idx];
            const want = trackOfDrag(payload);
            const lane = row && row.track === want ? row.lane : 0;
            if (want === 'audio') edl.addAudio({ name: payload.name, url: payload.url, durationSeconds: payload.durationSeconds }, at, lane);
            else edl.addVideo({ name: payload.name, url: payload.url, durationSeconds: payload.durationSeconds || 5, shotId: payload.shotId }, at, lane);
            setDragOver(null);
            toast.success(`已放入 ${row?.label ?? want}`);
          }}
        >
          <div className="lanes-inner" style={{ width }}>
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
            <div className="lanes">
              {rows.map((row) => (
                <div
                  key={row.key}
                  className={`lane ${row.track}`}
                  style={{ height: laneH }}
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
                    const thumb = shot?.frameUrl || (/\.(png|jpe?g|webp|gif|bmp|avif)/i.test(clip.sourceUrl || '') ? clip.sourceUrl : '');
                    return (
                      <div
                        key={clip.id}
                        className={`clip2 ${clipColor(clip)}${isSelected ? ' selected' : ''}`}
                        style={{ left: left * zoom, width: w, height: laneH - 10 }}
                        title={`${clipLabel(clip)} · ${clip.timelineStart.toFixed(2)}s → ${(clip.timelineStart + clipSpan(clip)).toFixed(2)}s`}
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          edl.setSelection([clip.id]);
                          setPreviewMode('timeline');
                          if (row.locked || clip.locked) return;
                          const start = clip.timelineStart;
                          setDrag({ id: clip.id, kind: 'move', startX: e.clientX, origStart: start, origSpan: span, lane: clip.lane ?? 0, track: clip.track, dx: 0, span });
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
                        {thumb ? <img className="thumb" src={thumb} alt="" /> : null}
                        {clip.track === 'audio' ? (
                          <div className="wave">
                            {Array.from({ length: Math.max(6, Math.floor(w / 4)) }, (_, i) => (
                              <i key={i} style={{ height: `${18 + ((i * 13 + Math.floor(clip.timelineStart * 7)) % 70)}%` }} />
                            ))}
                          </div>
                        ) : null}
                        {clip.track === 'subtitle' ? <div className="t"><b>T1 字幕</b>{clip.text || '字幕'}</div> : null}
                        <span className="shade" />
                        <span className="cname">{clipLabel(clip)}</span>
                        <span className="tagline">{clip.track === 'audio' ? '音频' : clip.track === 'subtitle' ? '文本' : `V${(clip.lane ?? 0) + 1}`}</span>
                        {clip.transition && clip.transition.type !== 'none' ? <span className="xf">{clip.transition.type === 'crossfade' ? '叠' : '淡'}</span> : null}
                        {clip.keyframes?.length ? <i className="kf" style={{ left: 8 }} /> : null}
                        <span
                          className="trim l"
                          onPointerDown={(e) => {
                            e.stopPropagation();
                            edl.setSelection([clip.id]);
                            if (row.locked || clip.locked) return;
                            setDrag({ id: clip.id, kind: 'trim-l', startX: e.clientX, origStart: clip.timelineStart, origSpan: span, lane: clip.lane ?? 0, track: clip.track, dx: 0, span });
                          }}
                        />
                        <span
                          className="trim r"
                          onPointerDown={(e) => {
                            e.stopPropagation();
                            edl.setSelection([clip.id]);
                            if (row.locked || clip.locked) return;
                            setDrag({ id: clip.id, kind: 'trim-r', startX: e.clientX, origStart: clip.timelineStart, origSpan: span, lane: clip.lane ?? 0, track: clip.track, dx: 0, span });
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
        <input className="tl-zoom" type="range" min="30" max="96" value={laneH} onChange={(e) => setLaneH(Number(e.target.value))} />
        <div className="right"><span>Ctrl+滚轮缩放</span><span>·</span><span>拖动片段可跨轨叠加</span></div>
      </div>

      {ctx ? (
        <div className="ctx open" style={{ left: ctx.x, top: ctx.y }} onPointerDown={(e) => e.stopPropagation()}>
          <button type="button" onClick={() => { splitAtPlayhead(); setCtx(null); }}><Scissors />在播放头分割<span className="kbd2">E</span></button>
          <button type="button" onClick={() => { edl.copySelection([ctx.id]); setCtx(null); }}><Copy />复制片段<span className="kbd2">⌘C</span></button>
          <button type="button" onClick={() => { edl.rippleDelete([ctx.id]); setCtx(null); }}><Trash2 />波纹删除<span className="kbd2">⌫</span></button>
          <button type="button" onClick={() => { const c = clips.find((x) => x.id === ctx.id); if (c) edl.toggleClipReverse(c.id); setCtx(null); }}><Undo2 />倒放</button>
          <button type="button" onClick={() => { const c = clips.find((x) => x.id === ctx.id); if (c) edl.detachAudio(c.id); setCtx(null); }}><Volume2Ico />分离音频<span className="kbd2">⌘⇧S</span></button>
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
