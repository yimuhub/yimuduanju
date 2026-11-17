/**
 * 一幕·神剪 · 中舞台（原型同款画布 + 走带）
 * 预览内容来自真实 EDL：当前播放头命中哪条画面轨，就渲染哪条片段的真实媒体。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Eye,
  Fullscreen,
  Maximize2,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { useStudio } from './StudioShell';
import { useEdl } from './EdlContext';
import { clipSpan } from './model';
import { sampleVideoTransform } from '@shared/timeline-keyframes';

type Ratio = '9:16' | '16:9' | '1:1';

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
  const [videoBroken, setVideoBroken] = useState(false);

  const total = Math.max(1, data.totalSec || 0);

  const active = useMemo(() => {
    const clips = (data.timeline?.clips ?? []).filter(
      (c) => c.track === 'video' && c.enabled !== false && curT >= c.timelineStart && curT < c.timelineStart + clipSpan(c),
    );
    return clips.sort((a, b) => (b.lane ?? 0) - (a.lane ?? 0))[0] ?? null;
  }, [data.timeline?.clips, curT]);

  const subtitle = useMemo(() => {
    const subs = (data.timeline?.clips ?? []).filter(
      (c) => c.track === 'subtitle' && c.enabled !== false && curT >= c.timelineStart && curT < c.timelineStart + clipSpan(c),
    );
    return subs.sort((a, b) => (b.lane ?? 0) - (a.lane ?? 0))[0] ?? null;
  }, [data.timeline?.clips, curT]);

  const shot = useMemo(
    () => (active?.sourceShotId ? data.shots.find((s) => s.id === active.sourceShotId) : null),
    [active?.sourceShotId, data.shots],
  );
  const fallbackUrl = shot?.frameUrl || data.shots[0]?.frameUrl || '';
  const url = active?.sourceUrl || fallbackUrl;
  const isStill = /\.(png|jpe?g|webp|gif|bmp|avif)(?:[?#]|$)/i.test(url) || (!active && !!fallbackUrl);
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
      v.volume = previewVolume;
      v.muted = previewMuted;
      if (playing) void v.play().catch(() => undefined);
      else v.pause();
    };
    if (v.readyState >= 1) sync();
    else v.addEventListener('loadedmetadata', sync, { once: true });
    return () => v.removeEventListener('loadedmetadata', sync);
  }, [sourceTime, playing, previewVolume, previewMuted, isStill, active?.id]);

  const filter = [
    previewQuality === 'fast' ? 'saturate(.92) contrast(.96) brightness(.97)' : '',
    grade.filter === 'cinematic' ? 'sepia(.12) contrast(1.08)' : '',
    grade.filter === 'warm' ? 'sepia(.2) saturate(1.08)' : '',
    grade.filter === 'cool' ? 'hue-rotate(10deg) saturate(.9)' : '',
    grade.brightness !== 100 ? `brightness(${grade.brightness}%)` : '',
    grade.contrast !== 100 ? `contrast(${grade.contrast}%)` : '',
    grade.saturation !== 100 ? `saturate(${grade.saturation}%)` : '',
  ]
    .filter(Boolean)
    .join(' ');

  const title = data.project?.title || '未命名项目';
  const caption = subtitle?.text || active?.text || shot?.dialogue || '';

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
        <div className={`canvas-frame${ratio === '16:9' ? ' wide' : ratio === '1:1' ? ' square' : ''}`}>
          <div
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
                  muted={previewMuted}
                  onError={() => setVideoBroken(true)}
                  style={{ filter, transform: `scale(${transform.scale}) translate(${transform.x * 100}%, ${transform.y * 100}%) rotate(${transform.rotate}deg)` }}
                />
              )
            ) : (
              <div className="canvas-empty">
                <span>当前播放头没有可预览画面</span>
                <small>从左侧素材库拖入时间线，或选择已有镜头</small>
              </div>
            )}
            <div className="grade" />
            <div className="vignette" />
            <div className="layer-title">{title}</div>
            {caption ? <div className="layer-sub"><span>{caption}</span></div> : null}
            <div className="layer-watermark">一幕 · 神剪</div>
            <div className="safe" />
            {previewQuality === 'fast' ? <div className="quality-badge">流畅预览 · 代理 540p</div> : null}
          </div>
        </div>
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
          <button type="button" className="icon-btn" data-tip="跳到片头 (Home)" onClick={() => setCurT(0)}><SkipBack /></button>
          <button type="button" className="icon-btn" data-tip="上一帧 (←)" onClick={() => setCurT(Math.max(0, curT - 1 / edl.fps))}><SkipForward style={{ transform: 'rotate(180deg)' }} /></button>
          <button type="button" className="icon-btn play-btn" data-tip="播放 / 暂停 (Space)" onClick={() => setPlaying(!playing)}>
            {playing ? <Pause /> : <Play />}
          </button>
          <button type="button" className="icon-btn" data-tip="下一帧 (→)" onClick={() => setCurT(Math.min(total, curT + 1 / edl.fps))}><SkipForward /></button>
          <button type="button" className="icon-btn" data-tip="跳到片尾 (End)" onClick={() => setCurT(total)}><SkipForward /></button>
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
            <Fullscreen />
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
