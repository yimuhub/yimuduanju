/**
 * Studio · 产出坞「预览」Tab（重设计）
 * -------------------------------------------------------------
 * 画面 / 声音 / 字幕全部跟随 EDL：取当前播放头覆盖的视频片段、音频片段
 * 与字幕片段。未保存过 EDL（无视频片段）时回退到镜头台账（shots）。
 *
 * 播放同步策略：StudioShell 的 curT 是主时钟（时间线播放头），媒体元素
 * 是从动——播放时让 video/audio 跟上 curT（漂移超阈值才 seek），暂停时
 * 把媒体定格到播放头位置，保证时间线与画面自洽。
 *
 * 布局：上区（比例 / 画面 / 时间码）与下区（属性 / 描述 / 播放 / 胶片条）
 * 之间有一条可拖拽分隔条，往下拖预览变大、往上拖变小，高度持久保存。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Clapperboard, Maximize2, Scan } from 'lucide-react';
import { resolveTextStyle } from '@shared/api.interface';
import { useStudio } from './StudioShell';
import { useEdl } from './EdlContext';
import { clipSpan, sameOrigin, shotLabel, stateShort, toTimecode } from './model';
import MediaPreviewDialog from '@client/src/components/MediaPreviewDialog';
import { listCharacters, listProps } from '@client/src/api/bible';
import { isImageUrl } from '@client/src/lib/media-kind';
import { previewProxyUrl } from '@client/src/lib/preview-proxy';
import { sampleVideoTransform } from '@shared/timeline-keyframes';
import { virtualCompoundClip } from '@shared/timeline-compound';
import type { Prop } from '@shared/api.interface';

type Ratio = '9:16' | '16:9' | '1:1';

const PREVIEW_FONTS: Record<string, string> = {
  'source-han-sans': '"PingFang SC", "Noto Sans SC", "Microsoft YaHei", sans-serif',
  pingfang: '"PingFang SC", "Microsoft YaHei", sans-serif',
  songti: '"Songti SC", "SimSun", "Noto Serif SC", serif',
  kaiti: '"Kaiti SC", "KaiTi", "STKaiti", serif',
  mono: 'Menlo, Consolas, monospace',
};

const PV_H_KEY = 'yimu.previewHeight';
const readPreviewH = (): number => {
  try {
    const v = Number(localStorage.getItem(PV_H_KEY));
    if (v >= 200) return v;
  } catch {
    /* 隐私模式忽略 */
  }
  return Math.round(Math.min(window.innerHeight * 0.36, 380));
};

export const StudioPreview = () => {
  const {
    data,
    sel,
    setSel,
    curT,
    playing,
    setPlaying,
    playDir,
    setPlayDir,
    projectId,
    proEdit,
    previewMode,
    previewVolume,
    previewMuted,
    originalAudio,
    previewQuality,
    setPreviewQuality,
  } = useStudio();
  const edl = useEdl();
  const [charNames, setCharNames] = useState<Record<string, string>>({});
  const [propByCode, setPropByCode] = useState<Record<string, Prop>>({});
  const [ratio, setRatio] = useState<Ratio>('9:16');
  const [videoBroken, setVideoBroken] = useState(false);
  const [openModal, setOpenModal] = useState(false);
  const [previewH, setPreviewH] = useState<number>(readPreviewH);
  const [splitting, setSplitting] = useState(false);
  const [safeOn, setSafeOn] = useState(false);
  const pvRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [subDrag, setSubDrag] = useState<{ id: string; x: number; y: number } | null>(null);
  const audioRefs = useRef(new Map<string, HTMLAudioElement>());
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [canvasOn, setCanvasOn] = useState(false);
  const [proxyBroken, setProxyBroken] = useState(false);

  // 剪映 ⌘F：全屏预览 / 退出全屏（由时间线快捷键层派发，避免两处各绑一套 DOM 查询）
  useEffect(() => {
    const onFullscreen = () => {
      const el = pvRef.current;
      if (!el) return;
      if (document.fullscreenElement) void document.exitFullscreen();
      else void el.requestFullscreen?.();
    };
    window.addEventListener('yimu:preview-fullscreen', onFullscreen);
    return () => window.removeEventListener('yimu:preview-fullscreen', onFullscreen);
  }, []);

  const shots = data.shots;
  const shot = shots[sel];

  /** 本镜一致性引用：人物名称 + 道具 @编号，来自与画布/时间线同一份设定表 */
  useEffect(() => {
    if (!projectId) return;
    let alive = true;
    const refresh = () => {
      Promise.all([
        listCharacters(projectId).catch(() => []),
        listProps(projectId).catch(() => [] as Prop[]),
      ]).then(([cs, ps]) => {
        if (!alive) return;
        setCharNames(Object.fromEntries(cs.map((c) => [c.id, c.name])));
        setPropByCode(Object.fromEntries(ps.filter((p) => p.code).map((p) => [p.code, p])));
      });
    };
    refresh();
    window.addEventListener('yimu:bible-updated', refresh);
    return () => { alive = false; window.removeEventListener('yimu:bible-updated', refresh); };
  }, [projectId]);

  // ---------- 跟随 EDL：当前播放头覆盖的片段 ----------
  const tlClips = data.timeline?.clips ?? [];
  const videoClips = useMemo(
    () => tlClips.filter((c) => c.track === 'video' && c.sourceUrl && c.enabled !== false),
    [tlClips],
  );
  const tlMode = previewMode === 'timeline' && videoClips.length > 0;

  const activeVideo = useMemo(() => {
    if (!tlMode) return null;
    const hit = videoClips
      .filter((c) => curT >= c.timelineStart && curT < c.timelineStart + clipSpan(c))
      // 剪映式层序：V1 是底图，V2/V3/V4 越往上越先被识别。
      // 同一时间命中多条画面时，取 lane 最大（最上层）的一条作为当前画面。
      .sort((a, b) => (b.lane ?? 0) - (a.lane ?? 0))[0];
    if (!hit) return null;
    return hit.compound?.children?.length ? virtualCompoundClip(hit, curT) ?? hit : hit;
  }, [tlMode, videoClips, curT]);

  const activeAudio = useMemo(
    () =>
      tlMode
        ? tlClips.filter(
            (c) =>
              c.track === 'audio' &&
              c.sourceUrl &&
              c.enabled !== false &&
              curT >= c.timelineStart &&
              curT < c.timelineStart + clipSpan(c),
          )
        : [],
    [tlMode, tlClips, curT],
  );

  // 画面原声已被拆成独立音频轨时不重复出声：<video> 静音，只播音频片段
  const detachedVideoAudio = useMemo(
    () => Boolean(activeVideo && activeAudio.some((a) => sameOrigin(a, activeVideo))),
    [activeVideo, activeAudio],
  );

  const subtitles = useMemo(
    () =>
      tlMode
        ? tlClips
            .filter(
              (c) =>
                c.track === 'subtitle' &&
                c.enabled !== false &&
                (c.text ?? '').trim() &&
                curT >= c.timelineStart &&
                curT < c.timelineStart + clipSpan(c),
            )
            .sort((a, b) => (a.lane ?? 0) - (b.lane ?? 0))
            .map((c) => ({
              id: c.id,
              lane: c.lane ?? 0,
              text: (c.text ?? '').trim(),
              style: c.textStyle ?? null,
            }))
        : [],
    [tlMode, tlClips, curT],
  );

  /** 帧内拖拽字幕：按归一化坐标实时预览，松手只落一次库（避免拖动时每帧保存） */
  const startSubtitleDrag = useCallback(
    (e: React.PointerEvent<HTMLDivElement>, id: string, style: unknown) => {
      if (e.button !== 0) return;
      const frame = frameRef.current;
      if (!frame) return;
      const rect = frame.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const st = resolveTextStyle(style as never);
      const px = (e.clientX - rect.left) / rect.width;
      const py = (e.clientY - rect.top) / rect.height;
      const offsetX = px - st.x;
      const offsetY = py - st.y;
      let last = { x: st.x, y: st.y };
      e.preventDefault();
      e.stopPropagation();
      edl.setSelection([id]);
      setSubDrag({ id, x: last.x, y: last.y });
      const move = (ev: PointerEvent) => {
        const nx = (ev.clientX - rect.left) / rect.width - offsetX;
        const ny = (ev.clientY - rect.top) / rect.height - offsetY;
        last = {
          x: Math.min(0.98, Math.max(0.02, nx)),
          y: Math.min(0.96, Math.max(0.04, ny)),
        };
        setSubDrag({ id, x: last.x, y: last.y });
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        edl.updateTextStyle(id, { x: last.x, y: last.y });
        setSubDrag(null);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up, { once: true });
    },
    [edl],
  );

  const activeShot = activeVideo?.sourceShotId
    ? shots.find((s) => s.id === activeVideo.sourceShotId)
    : undefined;

  // 换视频/片段时重置"加载失败"标记
  const shotId = shot?.id;
  const shotVideoUrl = shot?.videoUrl;
  const activeVideoId = activeVideo?.id;
  const activeVideoUrl = activeVideo?.sourceUrl;

  /** 原始时间线/镜头地址；图片仍直接走原图，视频在流畅档走 540p 代理 */
  const previewVideoUrl = tlMode ? activeVideo?.sourceUrl : shot?.videoUrl;
  const previewIsStill = Boolean(tlMode && isImageUrl(previewVideoUrl));
  // 流畅档优先使用服务端 540p 代理。
  // 本地素材首次无缓存时服务端 302 回原片并后台转码；远程素材无缓存时
  // 立即 404，<video> onError 会回退原片，绝不会卡在代理下载上一直黑屏。
  const fastProxyEligible =
    Boolean(previewVideoUrl) &&
    !previewIsStill &&
    previewQuality === 'fast' &&
    tlMode &&
    Boolean(projectId) &&
    (previewVideoUrl?.startsWith('/uploads/') ||
      previewVideoUrl?.startsWith('/api/assets/') ||
      /^https?:\/\//i.test(previewVideoUrl ?? ''));
  const fastProxyUrl =
    fastProxyEligible && previewVideoUrl && projectId
      ? previewProxyUrl(projectId, previewVideoUrl)
      : previewVideoUrl;
  const effectiveVideoUrl = fastProxyEligible && !proxyBroken ? fastProxyUrl : previewVideoUrl;
  const usingProxy = Boolean(fastProxyEligible && !proxyBroken && fastProxyUrl);

  useEffect(() => {
    setVideoBroken(false);
    setProxyBroken(false);
  }, [shotId, shotVideoUrl, activeVideoId, activeVideoUrl, previewQuality]);

  // 媒体从动于主时钟 curT
  useEffect(() => {
    const speed = activeVideo && activeVideo.speed > 0 ? activeVideo.speed : 1;
    const videoUrl = effectiveVideoUrl;
    const v = videoRef.current;
    if (v && videoUrl && !videoBroken) {
      const videoT = tlMode && activeVideo
        ? activeVideo.reverse
          ? Math.min(
              Math.max(
                activeVideo.outPoint - Math.max(0, curT - activeVideo.timelineStart) * speed,
                activeVideo.inPoint,
              ),
              Math.max(activeVideo.inPoint, activeVideo.outPoint),
            )
          : Math.min(
              Math.max(
                activeVideo.inPoint + (curT - activeVideo.timelineStart) * speed,
                activeVideo.inPoint,
              ),
              Math.max(activeVideo.inPoint, activeVideo.outPoint),
            )
        : (() => {
            const inP = shot?.inPoint ?? 0;
            const outP = shot?.outPoint ?? inP + (shot?.dur ?? 0);
            return Math.min(inP + Math.max(0, curT - (shot?.start ?? 0)), Math.max(inP, outP));
          })();
      const reversePreview = Boolean(tlMode && activeVideo?.reverse);
      v.playbackRate = reversePreview ? 1 : tlMode && activeVideo ? speed : 1;
      v.volume = previewVolume;
      v.muted = previewMuted || !originalAudio || detachedVideoAudio;
      if (playing && playDir > 0 && !reversePreview) {
        if (v.paused) v.play().catch(() => {});
        if (v.readyState >= 1 && Math.abs(v.currentTime - videoT) > 0.12) {
          v.currentTime = videoT;
        }
      } else {
        // 浏览器 video 不支持负速率：倒放时保持暂停，由主时钟逐帧反向 seek
        if (!v.paused) v.pause();
        const tol = reversePreview || playDir < 0 ? 0.02 : 0.05;
        if (v.readyState >= 1 && Math.abs(v.currentTime - videoT) > tol) {
          v.currentTime = videoT;
        }
      }
    }

    if (!tlMode) {
      // 回退：镜头自带的配音
      const a = audioRefs.current.get('legacy');
      if (a && shot?.voiceUrl) {
        const localT = Math.max(0, curT - shot.start);
        if (playing && playDir > 0) {
          if (a.paused) a.play().catch(() => {});
          if (a.readyState >= 1 && Math.abs(a.currentTime - localT) > 0.12) {
            a.currentTime = localT;
          }
        } else {
          if (!a.paused) a.pause();
          const tol = playDir < 0 ? 0.02 : 0.05;
          if (a.readyState >= 1 && Math.abs(a.currentTime - localT) > tol) {
            a.currentTime = localT;
          }
        }
      }
    }

    // EDL 音频：每轨独立从 inPoint 起播，按 timelineStart 对齐
    for (const clip of activeAudio) {
      const a = audioRefs.current.get(clip.id);
      if (!a) continue;
      const rate = clip.speed > 0 ? clip.speed : 1;
      const localA = Math.max(0, curT - clip.timelineStart);
      const t = clip.reverse
        ? Math.max(clip.inPoint, clip.outPoint - localA * rate)
        : Math.min(
            Math.max(clip.inPoint + localA * rate, clip.inPoint),
            Math.max(clip.inPoint, clip.outPoint),
          );
      const pitch = Math.min(2, Math.max(0.5, clip.pitch ?? 1));
      // 试听：pitch 直接改播放速率（preservesPitch=false 才会真的变调）；
      // 导出端用 asetrate + atempo，保持片段时间线时长。
      a.preservesPitch = pitch !== 1;
      a.playbackRate = Math.min(4, rate * pitch);
      a.volume = Math.max(0, Math.min(1, clip.volume)) * previewVolume;
      a.muted = previewMuted;
      if (playing && playDir > 0 && !clip.reverse) {
        if (a.paused) a.play().catch(() => {});
        if (a.readyState >= 1 && Math.abs(a.currentTime - t) > 0.12) a.currentTime = t;
      } else {
        if (!a.paused) a.pause();
        const tol = playDir < 0 || clip.reverse ? 0.02 : 0.05;
        if (a.readyState >= 1 && Math.abs(a.currentTime - t) > tol) a.currentTime = t;
      }
    }
  }, [curT, playing, playDir, shot, videoBroken, tlMode, activeVideo, activeAudio, detachedVideoAudio, previewVolume, previewMuted, originalAudio, effectiveVideoUrl]);

  // ---------- 上/下区拖拽分割 ----------
  const onSplitStart = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      const startY = e.clientY;
      const startH = previewH;
      const host = document.querySelector('.dock-body') as HTMLElement | null;
      const maxH = Math.max(260, (host?.clientHeight ?? window.innerHeight) - 210);
      let last = startH;
      setSplitting(true);
      const move = (ev: PointerEvent) => {
        last = Math.max(200, Math.min(maxH, Math.round(startH + ev.clientY - startY)));
        setPreviewH(last);
      };
      const up = () => {
        setSplitting(false);
        try {
          localStorage.setItem(PV_H_KEY, String(last));
        } catch {
          /* 忽略 */
        }
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    },
    [previewH],
  );

  const resetSplit = useCallback(() => {
    const next = Math.round(Math.min(window.innerHeight * 0.36, 380));
    setPreviewH(next);
    try {
      localStorage.removeItem(PV_H_KEY);
    } catch {
      /* 忽略 */
    }
  }, []);

  /** 预览当前媒体：时间线片段优先，否则镜头成片；图片/GIF 走静态图分支 */

  /**
   * 流畅预览：把当前视频帧画到 640px 长的画布上再铺满画面。
   * 解码仍在后台，但合成/缩放/全屏放大都走低分辨率画布，
   * 弱机或 4K 素材拖动播放头时更跟手；原画模式还是直接显示 <video>。
   */
  useEffect(() => {
    setCanvasOn(false);
    if (previewQuality !== 'fast' || !tlMode || previewIsStill) return undefined;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!video || !canvas || !ctx) return undefined;
    let raf = 0;
    let alive = true;
    const draw = () => {
      if (!alive) return;
      if (video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) {
        const w = Math.min(640, video.videoWidth);
        const h = Math.max(2, Math.round((w * video.videoHeight) / video.videoWidth));
        if (canvas.width !== w || canvas.height !== h) {
          canvas.width = w;
          canvas.height = h;
        }
        try {
          ctx.drawImage(video, 0, 0, w, h);
          setCanvasOn(true);
        } catch {
          /* 跨域/首帧未就绪：保留 <video> 原画兜底 */
        }
      }
      raf = window.requestAnimationFrame(draw);
    };
    draw();
    return () => {
      alive = false;
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, [previewQuality, tlMode, previewIsStill, effectiveVideoUrl, usingProxy]);


  if (!shot) {
    return (
      <div className="dp-empty">
        <div className="dp-empty-ico"><Clapperboard size={20} /></div>
        <b>还没有分镜镜头</b>
        <p>先在剧本页把剧本物化成镜头，预览会自动接上画面与时间码。</p>
      </div>
    );
  }

  const endT =
    tlMode && activeVideo ? activeVideo.timelineStart + clipSpan(activeVideo) : shot.start + shot.dur;
  const clipDur = tlMode && activeVideo ? clipSpan(activeVideo) : shot.dur;
  const displayShot = activeShot ?? shot;
  const scene = data.scenes.find((s) => s.id === displayShot.sceneId);
  const videoUrl = effectiveVideoUrl;
  const activeIsStill = previewIsStill;
  const clipLocalT =
    tlMode && activeVideo ? Math.max(0, curT - activeVideo.timelineStart) : 0;
  const videoXf = tlMode && activeVideo ? sampleVideoTransform(activeVideo.keyframes, clipLocalT) : null;
  const videoXfStyle = videoXf
    ? {
        transform: `translate(${(-videoXf.x * 100) / videoXf.scale}%, ${(-videoXf.y * 100) / videoXf.scale}%) scale(${videoXf.scale}) rotate(${videoXf.rotate}deg)`,
      }
    : undefined;
  const showVideo = Boolean(videoUrl) && !videoBroken && !activeIsStill;
  const showStill = Boolean(videoUrl) && !videoBroken && activeIsStill;

  const step = (delta: number) => {
    if (shots.length === 0) return;
    setSel((sel + delta + shots.length) % shots.length);
  };

  const stClass = displayShot.st === 'done' ? 'ok' : displayShot.st === 'render' ? 'run' : 'dim';

  return (
    <div className="pv" ref={pvRef}>
      {/* ---------- 上区：画面 ---------- */}
      <div className="pv-top" style={{ height: previewH }}>
        <div className={`dsub${proEdit ? ' pro' : ''}`}>
          {proEdit ? (
            <div className="pv-pro-label">
              <b>{tlMode ? '时间线合成预览' : '镜头预览'}</b>
              <span>{tlMode ? (activeIsStill ? '时间线图片 / GIF 合成' : '只渲染时间线内容') : '来自镜头池 · 点击时间线切回合成'}</span>
            </div>
          ) : null}
          <div className="seg">
            {(['9:16', '16:9', '1:1'] as Ratio[]).map((r) => (
              <button
                key={r}
                type="button"
                className={ratio === r ? 'on' : undefined}
                onClick={() => setRatio(r)}
              >
                {r}
              </button>
            ))}
          </div>
          <div className="spacer" />
          {proEdit ? (
            <>
              <div className="pv-quality" role="group" aria-label="预览清晰度">
                <button
                  type="button"
                  className={previewQuality === 'fast' ? 'on' : ''}
                  title="流畅预览：本地视频自动 540p 代理 + 低分辨率画布合成，拖动播放头更跟手"
                  onClick={() => setPreviewQuality('fast')}
                >
                  流畅
                </button>
                <button
                  type="button"
                  className={previewQuality === 'original' ? 'on' : ''}
                  title="原画预览：按素材原始分辨率显示，适合看细节/对字幕"
                  onClick={() => setPreviewQuality('original')}
                >
                  原画
                </button>
              </div>
              <button
                type="button"
                className={`pro-mini${safeOn ? ' on' : ''}`}
                title="显示 / 隐藏安全框"
                onClick={() => setSafeOn((v) => !v)}
              >
                <Scan size={12} />
                安全框
              </button>
              <button
                type="button"
                className="pro-mini"
                title="全屏预览"
                onClick={() => {
                  const el = pvRef.current;
                  if (!el) return;
                  if (document.fullscreenElement) void document.exitFullscreen();
                  else void el.requestFullscreen?.();
                }}
              >
                <Maximize2 size={12} />
              </button>
            </>
          ) : (
            <span className="chip num">
              {shotLabel(shot.no)} / {shots.length}
            </span>
          )}
        </div>

        <div className="pv-stage">
          <div className="pv-frame" ref={frameRef} data-ratio={ratio} data-tag={shot.tag} data-st={shot.st}>
            {showStill ? (
              <div className="pv-media-xf" style={videoXfStyle}>
                <img
                  src={videoUrl}
                  alt={(activeVideo?.text || activeVideo?.sourceUrl || '').slice(0, 40)}
                  onError={() => setVideoBroken(true)}
                  style={{
                    position: 'absolute',
                    inset: 0,
                    width: '100%',
                    height: '100%',
                    objectFit: 'contain',
                    background: '#000',
                  }}
                />
              </div>
            ) : showVideo ? (
              <div className="pv-media-xf" style={videoXfStyle}>
              <video
                ref={videoRef}
                src={videoUrl}
                poster={tlMode ? undefined : shot.frameUrl}
                playsInline
                preload="auto"
                onError={() => {
                  if (usingProxy) setProxyBroken(true);
                  else setVideoBroken(true);
                }}
                style={{
                  position: 'absolute',
                  inset: 0,
                  width: '100%',
                  height: '100%',
                  objectFit: 'contain',
                  background: '#000',
                  opacity: canvasOn ? 0 : 1,
                }}
              />
              <canvas
                ref={canvasRef}
                className="pv-fast"
                style={{ display: canvasOn ? 'block' : 'none' }}
              />
              </div>
            ) : tlMode ? (
              <div className="pv-gap">
                <span>时间线空隙</span>
                <em>把播放头移到画面片段上</em>
              </div>
            ) : shot.frameUrl ? (
              <img
                src={shot.frameUrl}
                alt={shotLabel(shot.no)}
                style={{
                  position: 'absolute',
                  inset: 0,
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                }}
              />
            ) : (
              <>
                <div className="pv-grid" />
                <div className="pv-blank">
                  <Clapperboard size={26} strokeWidth={1.4} />
                  <span>暂无首帧画面</span>
                  <em>{shotLabel(shot.no)} · {displayShot.tag}</em>
                </div>
              </>
            )}
            {/* 声音：EDL 音频轨可多轨同时出声；未保存 EDL 时回退镜头配音 */}
            {tlMode ? (
              activeAudio.map((c) => (
                <audio
                  key={c.id}
                  ref={(el) => {
                    if (el) audioRefs.current.set(c.id, el);
                    else audioRefs.current.delete(c.id);
                  }}
                  src={c.sourceUrl ?? undefined}
                  preload="auto"
                />
              ))
            ) : shot.voiceUrl ? (
              <audio
                ref={(el) => {
                  if (el) audioRefs.current.set('legacy', el);
                  else audioRefs.current.delete('legacy');
                }}
                src={shot.voiceUrl}
                preload="auto"
              />
            ) : null}
            {subtitles.length > 0 && !(activeVideo && (activeVideo.lane ?? 0) > 0) ? (
              <div className="pv-subtitle">
                {subtitles.map((t) => {
                  const st = resolveTextStyle(t.style);
                  const dragging = subDrag?.id === t.id;
                  const x = dragging ? subDrag.x : Math.min(1, Math.max(0, st.x));
                  const y = dragging ? subDrag.y : Math.min(1, Math.max(0, st.y));
                  const fontFamily = PREVIEW_FONTS[st.fontFamily] ?? PREVIEW_FONTS['source-han-sans'];
                  return (
                    <div
                      key={t.id}
                      className={`pv-sub-item${dragging ? ' dragging' : ''}${edl.selectedIds.includes(t.id) ? ' selected' : ''}`}
                      data-subtitle-id={t.id}
                      onPointerDown={(e) => startSubtitleDrag(e, t.id, t.style)}
                      title="拖动字幕到画面任意位置"
                      style={{
                        left: `${x * 100}%`,
                        top: `${y * 100}%`,
                        width: `${Math.min(1, Math.max(0.2, st.maxWidth)) * 100}%`,
                        transform: 'translate(-50%, -50%)',
                        zIndex: 100 + t.lane,
                        textAlign: st.align,
                        // cqh = 预览框高度的 1%：与后端「字号按画幅高度百分比」同一套语义，
                        // 所以 9:16 / 16:9 下看到的比例和烧进成片的一致
                        fontSize: `${st.fontSize}cqh`,
                        fontFamily,
                        color: st.color,
                        fontWeight: st.bold ? 700 : 400,
                        fontStyle: st.italic ? 'italic' : undefined,
                        WebkitTextStrokeWidth: `${st.strokeWidth * st.fontSize}cqh`,
                        WebkitTextStrokeColor: st.strokeColor,
                        background:
                          st.bgColor && st.bgOpacity > 0
                            ? `color-mix(in srgb, ${st.bgColor} ${Math.round(st.bgOpacity * 100)}%, transparent)`
                            : undefined,
                        paddingTop: st.bgColor ? '0.12em' : undefined,
                        paddingBottom: st.bgColor ? '0.12em' : undefined,
                      }}
                    >
                      {t.text}
                    </div>
                  );
                })}
              </div>
            ) : null}
            {safeOn ? <div className="pv-safe" /> : null}
            <div className="pv-scan" />
            <span className="pv-no num">{shotLabel(shot.no)}</span>
            <span className="pv-dur num">{clipDur.toFixed(1)}s</span>
            <span className={`pv-st${shot.st === 'done' ? ' ok' : shot.st === 'render' ? ' run' : ''}`}>
              {stateShort(shot.st)}
            </span>
          </div>
        </div>

        <div className="pv-tc">
          <span className="num">{toTimecode(curT)}</span>
          <span className="pv-tc-arrow">→</span>
          <span className="num">{toTimecode(endT)}</span>
        </div>
      </div>

      {/* ---------- 可拖拽分隔条 ---------- */}
      <div
        className={`pv-splitter${splitting ? ' dragging' : ''}`}
        onPointerDown={onSplitStart}
        onDoubleClick={resetSplit}
        title="拖拽调整预览画面高度 · 双击恢复默认"
        role="separator"
        aria-orientation="horizontal"
      >
        <span className="pv-grip" />
      </div>

      {/* ---------- 下区：可滚动信息 + 常驻控制坞 ---------- */}
      <div className="pv-bottom">
        <div className="pv-scroll">
          <div className="pv-info">
            <div className="pv-info-i">
              <span className="pv-info-k">场景</span>
              <span className="pv-info-v serif" title={scene ? `${scene.label} · ${scene.title || '场次'}` : displayShot.sceneLabel}>
                {scene ? `${scene.label} · ${scene.title || '场次'}` : displayShot.sceneLabel}
              </span>
            </div>
            <div className="pv-info-i">
              <span className="pv-info-k">景别</span>
              <span className="pv-info-v">{displayShot.tag}</span>
            </div>
            <div className="pv-info-i">
              <span className="pv-info-k">时长</span>
              <span className="pv-info-v num">{clipDur.toFixed(1)}s</span>
            </div>
            <div className="pv-info-i">
              <span className="pv-info-k">状态</span>
              <span className={`pv-info-v ${stClass}`}>
                <i className="pv-info-dot" />
                {stateShort(displayShot.st)}
              </span>
            </div>
          </div>

          {displayShot.characterIds.length > 0 || displayShot.propTags.length > 0 || displayShot.referenceImageUrls.length > 0 ? (
            <div className="pv-refs">
              <div className="pv-refs-head">
                <b>一致性引用</b>
                <small>本镜注入的身份锁 / 道具 / 参考图</small>
              </div>
              <div className="pv-refs-chips">
                {displayShot.characterIds.map((cid) => (
                  <span className="pv-ref char" key={cid} title={`人物 id ${cid}`}>
                    {charNames[cid] ?? `人物 ${cid.slice(0, 6)}`}
                  </span>
                ))}
                {displayShot.propTags.map((tag) => {
                  const p = propByCode[tag.replace(/^@/, '')];
                  return (
                    <span className="pv-ref prop" key={tag} title={p?.identityAnchors || tag}>
                      {p ? `${p.code} ${p.name}` : tag}
                    </span>
                  );
                })}
                {displayShot.referenceImageUrls.length > 0 ? (
                  <span className="pv-ref img">参考图 ×{displayShot.referenceImageUrls.length}</span>
                ) : null}
                {displayShot.characterIds.length === 0 && displayShot.propTags.length === 0 ? (
                  <span className="pv-ref dim">尚未登记人物/道具</span>
                ) : null}
              </div>
            </div>
          ) : null}

          <div className="pv-quote">
            <span className="pv-quote-mark">“</span>
            <p>{displayShot.txt}</p>
            <span className="pv-quote-lb">画面描述 / 对白</span>
          </div>
        </div>

        {/* 控制坞：播放 + 镜头胶片条，始终可见且不遮挡上方内容 */}
        <div className="pv-film">
          <div className="pv-nav">
            <button type="button" className="icon-btn" onClick={() => step(-1)} title="上一镜 ( ← )">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M15 18l-6-6 6-6" />
              </svg>
            </button>
            <button
              type="button"
              className={`pv-play${playing ? ' on' : ''}`}
              onClick={() => {
                setPlayDir(1);
                setPlaying(!playing);
              }}
              title="按真实时长播放"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                {playing ? <path d="M7 4v16M17 4v16" /> : <path d="M7 4l12 8-12 8z" />}
              </svg>
              <span>{playing ? '暂停' : '播放'}</span>
            </button>
            <button type="button" className="icon-btn" onClick={() => step(1)} title="下一镜 ( → )">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 18l6-6-6-6" />
              </svg>
            </button>
            <div className="spacer" />
            {shot.videoUrl ? (
              <button type="button" className="pv-link" onClick={() => setOpenModal(true)}>
                预览视频
              </button>
            ) : null}
          </div>

          <div className="pv-strip-head">
            <span>镜头 · <b className="num">{shots.length}</b></span>
            <span className="pv-strip-hint">点击切换当前镜</span>
          </div>
          <div className="pv-strip">
            {shots.map((s, i) => (
              <button
                key={s.id}
                type="button"
                className={`pv-cell${i === sel ? ' on' : ''}`}
                data-st={s.st}
                onClick={() => setSel(i)}
                title={`${shotLabel(s.no)} · ${s.txt}`}
              >
                <span className="pv-cell-img">
                  {s.frameUrl ? (
                    <img src={s.frameUrl} alt="" loading="lazy" />
                  ) : (
                    <Clapperboard size={15} strokeWidth={1.6} />
                  )}
                </span>
                <span className="pv-cell-lb num">{shotLabel(s.no)}</span>
                <span className="pv-cell-bar" />
              </button>
            ))}
          </div>
        </div>
      </div>

      {openModal && shot.videoUrl ? (
        <MediaPreviewDialog
          url={shot.videoUrl}
          kind="video"
          title={`${shotLabel(shot.no)} · ${shot.txt}`}
          onClose={() => setOpenModal(false)}
        />
      ) : null}
    </div>
  );
};

