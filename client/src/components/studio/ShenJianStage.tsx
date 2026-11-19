/**
 * 一幕·神剪 · 中舞台（原型同款画布 + 走带）
 * 预览内容来自真实 EDL：当前播放头命中哪条画面轨，就渲染哪条片段的真实媒体。
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Eye, Maximize2, Volume2, VolumeX } from 'lucide-react';
import { IconFrameNext, IconFramePrev, IconFullscreen, IconPause, IconPlay, IconSkipEnd, IconSkipStart } from './ShenJianIcons';
import { useStudio } from './StudioShell';
import { useEdl } from './EdlContext';
import { clipSpan } from './model';
import { sampleVideoTransform } from '@shared/timeline-keyframes';
import type { TimelineClip, TimelineTextStyle } from '@shared/api.interface';

type Ratio = '9:16' | '16:9' | '1:1' | '4:3';

// 预览字体映射，与检查器里的字体 id 一一对应
const PREVIEW_FONTS: Record<string, string> = {
  'source-han-sans': '"Noto Sans SC", "Source Han Sans SC", "PingFang SC", sans-serif',
  'pingfang': '"PingFang SC", "Noto Sans SC", sans-serif',
  'songti': '"Songti SC", "Noto Serif SC", serif',
  'kaiti': '"Kaiti SC", "STKaiti", serif',
  'mono': '"SFMono-Regular", "Menlo", monospace',
};

export const ShenJianStage = ({
  ratio,
  safe,
  onToggleSafe,
  grade,
}: {
  ratio: Ratio;
  safe: boolean;
  onToggleSafe: () => void;
  grade: { brightness: number; contrast: number; saturation: number; filter: string };
}) => {
  const {
    data,
    curT,
    setCurT,
    playing,
    setPlaying,
    previewQuality,
    previewVolume,
    setPreviewVolume,
    previewMuted,
    setPreviewMuted,
    projectId,
  } = useStudio();
  const edl = useEdl();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const audioRefs = useRef<Map<string, HTMLAudioElement>>(new Map());
  // >0dB（volume>1）需要 WebAudio GainNode；普通音量直接走元素 volume，避免破坏跨域媒体。
  const audioCtxRef = useRef<AudioContext | null>(null);
  const audioGainRef = useRef<Map<string, GainNode>>(new Map());
  const [videoBroken, setVideoBroken] = useState(false);
  const [subDrag, setSubDrag] = useState<{ id: string; x: number; y: number } | null>(null);
  const lastSubDrag = useRef<{ id: string; x: number; y: number } | null>(null);

  // 剪映式时间轴长度＝内容末端，而不是项目参数里的固定时长。
  // 新建项目 durationSeconds 默认 50s，旧实现会让 5s 素材后面挂 45s 黑场，
  // 播放头、走带和字幕拖拽全部落进空白区。
  const total = useMemo(() => {
    let end = 0;
    for (const c of data.timeline?.clips ?? []) {
      end = Math.max(end, c.timelineStart + clipSpan(c));
    }
    return Math.max(1, end || data.totalSec || 0);
  }, [data.timeline?.clips, data.totalSec]);

  // 轨道属性以本地 EDL 为准：静音/显隐点完立即生效，不等一次刷新。
  const timelineTracks = edl.tracks?.length ? edl.tracks : (data.timeline?.tracks ?? []);
  const trackMeta = (track: string, lane: number) =>
    timelineTracks.find((t) => t.track === track && (t.lane ?? 0) === lane);

  const active = useMemo(() => {
    const clips = (data.timeline?.clips ?? []).filter(
      (c) =>
        c.track === 'video' &&
        c.enabled !== false &&
        trackMeta('video', c.lane ?? 0)?.exportEnabled !== false &&
        curT >= c.timelineStart &&
        curT < c.timelineStart + clipSpan(c),
    );
    return clips.sort((a, b) => (b.lane ?? 0) - (a.lane ?? 0))[0] ?? null;
  }, [data.timeline?.clips, timelineTracks, curT]);

  const activeVideoMuted = active ? trackMeta('video', active.lane ?? 0)?.muted === true : false;

  const audioClips = useMemo(
    () => (data.timeline?.clips ?? []).filter((c) => c.track === 'audio' && c.sourceUrl && c.enabled !== false),
    [data.timeline?.clips],
  );
  const activeAudio = useMemo(
    () =>
      audioClips.filter(
        (c) =>
          trackMeta('audio', c.lane ?? 0)?.muted !== true &&
          curT >= c.timelineStart &&
          curT < c.timelineStart + clipSpan(c),
      ),
    [audioClips, timelineTracks, curT],
  );

  const activeSubs = useMemo(() => {
    return (data.timeline?.clips ?? [])
      .filter((c) => c.track === 'subtitle' && c.enabled !== false && curT >= c.timelineStart && curT < c.timelineStart + clipSpan(c))
      .sort((a, b) => (b.lane ?? 0) - (a.lane ?? 0) || (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  }, [data.timeline?.clips, curT]);
  // 轨道调色优先：左侧特效/滤镜与右侧调节都写进 tracks[].grade，预览和导出共用
  const trackGrade = (data.timeline?.tracks ?? []).find((t) => t.track === 'video' && (t.lane ?? 0) === (active?.lane ?? 0))?.grade ?? null;
  const effectiveGrade = { ...grade, ...(trackGrade ?? {}) };

  // 真预览：只显示播放头命中的真实片段，不用项目封面/首帧冒充当前画面。
  const url = active?.sourceUrl || '';
  const isStill = /\.(png|jpe?g|webp|gif|bmp|avif)(?:[?#]|$)/i.test(url);
  const transform = sampleVideoTransform(active?.keyframes, active ? curT - active.timelineStart : 0);
  const local = active ? Math.max(0, curT - active.timelineStart) : 0;
  const sourceTime = active ? (active.reverse ? Math.max(active.inPoint, active.outPoint - local * active.speed) : active.inPoint + local * active.speed) : 0;

  useEffect(() => setVideoBroken(false), [url]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v || isStill) return;
    const sync = () => {
      if (Number.isFinite(sourceTime) && Math.abs(v.currentTime - sourceTime) > 0.28) {
        try { v.currentTime = sourceTime; } catch { /* 元数据未就绪 */ }
      }
      // 画面原声音量跟随片段 volume（白线/滑块调节实时作用于预览；>1 增益受跨域限制，导出端完整生效）
      v.volume = Math.min(1, Math.max(0, active?.volume ?? 1)) * previewVolume;
      // 有独立音频轨在出声时，画面本体静音，避免同一条对白重复播放
      v.muted = previewMuted || activeVideoMuted || activeAudio.length > 0 || (active?.volume ?? 1) <= 0.001;
      if (playing) void v.play().catch(() => undefined);
      else v.pause();
    };
    if (v.readyState >= 1) sync();
    else v.addEventListener('loadedmetadata', sync, { once: true });
    return () => v.removeEventListener('loadedmetadata', sync);
  }, [sourceTime, playing, previewVolume, previewMuted, isStill, active?.id, active?.volume, activeAudio.length, activeVideoMuted]);

  // 音频轨真实播放：时间线每帧对齐 sourceTime，音量/速度/音高实时生效
  useEffect(() => {
    for (const c of audioClips) {
      const a = audioRefs.current.get(c.id);
      if (!a) continue;
      const inRange = curT >= c.timelineStart && curT < c.timelineStart + clipSpan(c);
      const laneMuted = trackMeta('audio', c.lane ?? 0)?.muted === true;
      if (!inRange || laneMuted) {
        a.pause();
        continue;
      }
      const rate = Math.max(0.1, c.speed ?? 1);
      const pitch = Math.min(2, Math.max(0.5, c.pitch ?? 1));
      const local = Math.max(0, curT - c.timelineStart);
      const st = c.reverse ? Math.max(c.inPoint, c.outPoint - local * rate) : c.inPoint + local * rate;
      if (Number.isFinite(st) && Math.abs(a.currentTime - st) > 0.2) {
        try { a.currentTime = st; } catch { /* 元数据未就绪 */ }
      }
      const gain = Math.max(0, Math.min(2, c.volume ?? 1));
      let node = audioGainRef.current.get(c.id);
      if (!node && gain > 1) {
        try {
          const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
          if (Ctx) {
            const ctx = audioCtxRef.current ?? new Ctx();
            audioCtxRef.current = ctx;
            const src = ctx.createMediaElementSource(a);
            node = ctx.createGain();
            src.connect(node);
            node.connect(ctx.destination);
            audioGainRef.current.set(c.id, node);
          }
        } catch {
          // 跨域未给 CORS 时无法建 MediaElementSource，退回元素最大音量
          node = undefined;
        }
      }
      if (node) {
        a.volume = 1;
        node.gain.value = previewMuted ? 0 : Math.min(2, gain * previewVolume);
        if (playing && audioCtxRef.current?.state === 'suspended') void audioCtxRef.current.resume();
      } else {
        a.volume = Math.min(1, gain) * previewVolume;
      }
      a.preservesPitch = pitch === 1;
      a.playbackRate = Math.min(4, rate * pitch);
      if (previewMuted) a.pause();
      else if (playing) void a.play().catch(() => undefined);
      else a.pause();
    }
  }, [audioClips, curT, playing, previewVolume, previewMuted]);

  useEffect(() => () => {
    for (const a of audioRefs.current.values()) a.pause();
    audioGainRef.current.clear();
    void audioCtxRef.current?.close().catch(() => undefined);
    audioCtxRef.current = null;
  }, []);

  const filter = [
    previewQuality === 'fast' ? 'saturate(.92) contrast(.96) brightness(.97)' : '',
    effectiveGrade.filter === 'cinematic' ? 'sepia(.12) contrast(1.08)' : '',
    effectiveGrade.filter === 'warm' ? 'sepia(.2) saturate(1.08)' : '',
    effectiveGrade.filter === 'cool' ? 'hue-rotate(10deg) saturate(.9)' : '',
    effectiveGrade.filter === 'soft' ? 'brightness(1.06) contrast(.92) saturate(.96)' : '',
    effectiveGrade.filter === 'sharp' ? 'contrast(1.14) saturate(1.08)' : '',
    effectiveGrade.filter === 'fade' ? 'sepia(.16) saturate(.68) contrast(.92)' : '',
    effectiveGrade.brightness !== 100 ? `brightness(${effectiveGrade.brightness}%)` : '',
    effectiveGrade.contrast !== 100 ? `contrast(${effectiveGrade.contrast}%)` : '',
    effectiveGrade.saturation !== 100 ? `saturate(${effectiveGrade.saturation}%)` : '',
  ]
    .filter(Boolean)
    .join(' ');

  const hexRgba = (hex: string | undefined, alpha: number) => {
    const h = (hex || '#000000').replace('#', '');
    const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.padEnd(6, '0').slice(0, 6);
    return `rgba(${parseInt(full.slice(0, 2), 16)},${parseInt(full.slice(2, 4), 16)},${parseInt(full.slice(4, 6), 16)},${alpha})`;
  };
  const styleFor = (subStyle: TimelineTextStyle | null | undefined, id?: string) => {
    if (!subStyle) return undefined;
    const dragging = subDrag?.id === id;
    const x = dragging ? subDrag.x : (subStyle.x ?? 0.5);
    const y = dragging ? subDrag.y : (subStyle.y ?? 0.86);
    const widthPct = Math.max(20, (subStyle.maxWidth ?? 0.86) * 100);
    // 字幕框按中心定位；用户把 X 拖得太靠边时，宽字幕会有一半跑出画外。
    // 按当前宽度把中心夹在画面内，保证导出/预览都不会截字。
    const clampedX = Math.min(1 - widthPct / 200, Math.max(widthPct / 200, x));
    // 字幕底色必须随模板走：CSS 里 span 旧实现硬编码 #0000008c，
    // 选「经典白字/极简小字」也永远带一条黑底，和剪映不一致。
    const subBg = (subStyle.bgOpacity ?? 0) > 0 ? hexRgba(subStyle.bgColor, subStyle.bgOpacity ?? 0) : 'transparent';
    return {
      top: `${y * 100}%`,
      left: `${clampedX * 100}%`,
      right: 'auto',
      bottom: 'auto',
      width: `${Math.max(20, (subStyle.maxWidth ?? 0.86) * 100)}%`,
      transform: 'translate(-50%, -50%)',
      textAlign: subStyle.align ?? 'center',
      fontSize: `${subStyle.fontSize ?? 7}cqh`,
      fontFamily: PREVIEW_FONTS[subStyle.fontFamily ?? 'source-han-sans'] ?? PREVIEW_FONTS['source-han-sans'],
      color: subStyle.color || '#ffffff',
      fontWeight: subStyle.bold ? 800 : 600,
      fontStyle: subStyle.italic ? 'italic' : 'normal',
      WebkitTextStroke: (subStyle.strokeWidth ?? 0) > 0 ? `${(subStyle.strokeWidth ?? 0)}em ${subStyle.strokeColor || '#000000'}` : undefined,
      ['--sub-bg']: subBg,
      background: 'transparent',
      borderRadius: 0,
      padding: 0,
      cursor: 'grab',
      touchAction: 'none',
      pointerEvents: 'auto',
    } as CSSProperties;
  };

  const startSubtitleDrag = (e: React.PointerEvent, clipId: string, style?: TimelineTextStyle | null) => {
    e.stopPropagation();
    e.preventDefault();
    const frame = canvasRef.current?.getBoundingClientRect();
    if (!frame) return;
    const norm = (cx: number, cy: number) => ({
      x: Math.max(0.04, Math.min(0.96, (cx - frame.left) / frame.width)),
      y: Math.max(0.1, Math.min(0.9, (cy - frame.top) / frame.height)),
    });
    const start = norm(e.clientX, e.clientY);
    const seed = { id: clipId, x: start.x, y: start.y };
    lastSubDrag.current = seed;
    setSubDrag(seed);
    const onMove = (ev: PointerEvent) => {
      const p = norm(ev.clientX, ev.clientY);
      const next = { id: clipId, x: p.x, y: p.y };
      lastSubDrag.current = next;
      setSubDrag(next);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      const last = lastSubDrag.current;
      setSubDrag(null);
      if (last && last.id === clipId) edl.updateTextStyle(clipId, { x: last.x, y: last.y });
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  const renderSubs = activeSubs.length > 0 && !(active && (active.lane ?? 0) > 0);

  return (
    <section className="stage">
      <div className="stage-bar">
        <div className="meta">
          <span>{ratio}</span><span className="dot" />
          <span>{data.timeline?.width ?? 1080} × {data.timeline?.height ?? 1920}</span><span className="dot" />
          <span>{edl.fps} fps</span><span className="dot" />
          <span>{previewQuality === 'fast' ? '流畅预览 540p' : '原画预览'}</span>
        </div>
        <div className="right">
          <button type="button" className="icon-btn" data-tip="安全区参考线：短视频平台 UI 遮挡范围" onClick={onToggleSafe}>
            <Eye />
          </button>
          <button
            type="button"
            className="icon-btn"
            data-tip="全屏预览 (F)"
            onClick={() => {
              if (document.fullscreenElement) void document.exitFullscreen();
              else void document.documentElement.requestFullscreen?.();
            }}
          >
            <Maximize2 />
          </button>
        </div>
      </div>

      <div className="canvas-wrap">
        <div className={`canvas-frame${ratio === '16:9' ? ' wide' : ratio === '1:1' ? ' square' : ratio === '4:3' ? ' four-three' : ''}`}>
          <div
            ref={canvasRef}
            className={`canvas${previewQuality === 'fast' ? ' fast' : ''}${safe ? ' safe-on' : ''}`}
            onClick={() => setPlaying(!playing)}
            role="button"
            tabIndex={0}
            aria-label="预览画面，点击播放或暂停"
          >
            {url && !videoBroken ? (
              isStill ? (
                <img className="bg" src={url} alt="" style={{ filter, transform: `scale(${transform.scale}) translate(${transform.x * 100}%, ${transform.y * 100}%) rotate(${transform.rotate}deg)` }} />
              ) : (
                <video
                  key={active?.id || url}
                  ref={videoRef}
                  className="bg"
                  src={url}
                  playsInline
                  muted={previewMuted || activeVideoMuted || activeAudio.length > 0}
                  onError={() => setVideoBroken(true)}
                  style={{ filter, transform: `scale(${transform.scale}) translate(${transform.x * 100}%, ${transform.y * 100}%) rotate(${transform.rotate}deg)` }}
                />
              )
            ) : null}
            {renderSubs ? (
              activeSubs.map((c) => (
                <div
                  key={c.id}
                  className={`layer-sub${subDrag?.id === c.id ? ' dragging' : ''}${edl.selectedIds.includes(c.id) ? ' selected' : ''}`}
                  style={styleFor(c.textStyle, c.id)}
                  data-subtitle-id={c.id}
                  title="拖动字幕到画面任意位置"
                  onPointerDown={(e) => startSubtitleDrag(e, c.id, c.textStyle)}
                  onClick={(e) => e.stopPropagation()}
                >
                  <span>{c.text}</span>
                </div>
              ))
            ) : null}
            {audioClips.map((c) => (
              <audio
                key={c.id}
                ref={(el) => {
                  if (el) audioRefs.current.set(c.id, el);
                  else audioRefs.current.delete(c.id);
                }}
                src={c.sourceUrl ?? undefined}
                preload="auto"
              />
            ))}
            <div className="safe" />
            {previewQuality === 'fast' ? <div className="quality-badge">流畅预览 · 代理 540p</div> : null}
          </div>
        </div>
        {!url || videoBroken ? (
          <div className="canvas-empty">
            <span>当前播放头没有可预览画面</span>
            <small>从左侧素材库拖入时间线，或选择已有镜头</small>
          </div>
        ) : null}
      </div>

      <div className="transport">
        <input
          className="scrub"
          type="range"
          min="0"
          max={total}
          step={1 / edl.fps}
          value={Math.min(total, curT)}
          title="拖动进度条预览"
          onChange={(e) => setCurT(Number(e.target.value))}
        />
        <div className="tc">
          <span>{fmt(curT)}</span><em> / </em><span>{fmt(total)}</span>
        </div>
        <div className="mid">
          <button type="button" className="icon-btn" data-tip="跳到片头 (Home)" onClick={() => setCurT(0)}><IconSkipStart /></button>
          <button type="button" className="icon-btn" data-tip="上一帧 (←)" onClick={() => setCurT(Math.max(0, curT - 1 / edl.fps))}><IconFramePrev /></button>
          <button type="button" className="icon-btn play-btn" data-tip="播放 / 暂停 (Space)" onClick={() => setPlaying(!playing)}>
            {playing ? <IconPause /> : <IconPlay />}
          </button>
          <button type="button" className="icon-btn" data-tip="下一帧 (→)" onClick={() => setCurT(Math.min(total, curT + 1 / edl.fps))}><IconFrameNext /></button>
          <button type="button" className="icon-btn" data-tip="跳到片尾 (End)" onClick={() => setCurT(total)}><IconSkipEnd /></button>
        </div>
        <div className="right">
          <button
            type="button"
            className={`icon-btn${previewMuted ? ' active' : ''}`}
            data-tip={previewMuted ? '取消全局静音' : '全局静音'}
            onClick={() => setPreviewMuted(!previewMuted)}
          >
            {previewMuted ? <VolumeX /> : <Volume2 />}
          </button>
          <input
            className="vol-range"
            type="range"
            min="0"
            max="100"
            value={Math.round(previewVolume * 100)}
            title="预览监听音量，不改变片段音量"
            onChange={(e) => setPreviewVolume(Number(e.target.value) / 100)}
          />
          <button
            type="button"
            className="icon-btn"
            data-tip="全屏预览 (F)"
            onClick={() => {
              if (document.fullscreenElement) void document.exitFullscreen();
              else void document.documentElement.requestFullscreen?.();
            }}
          >
            <IconFullscreen />
          </button>
          <span className="save-pill" title={projectId ? '时间线自动保存' : ''}>
            {edl.saving ? '保存中' : edl.dirty ? '待保存' : '已保存'}
          </span>
        </div>
      </div>
    </section>
  );
};

const fmt = (sec: number) => {
  const t = Math.max(0, sec);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = Math.floor(t % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};

export default ShenJianStage;
