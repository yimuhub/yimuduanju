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
import { Clapperboard } from 'lucide-react';
import { useStudio } from './StudioShell';
import { clipSpan, shotLabel, stateShort, toTimecode } from './model';
import MediaPreviewDialog from '@client/src/components/MediaPreviewDialog';

type Ratio = '9:16' | '16:9' | '1:1';

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
  const { data, sel, setSel, curT, playing, setPlaying } = useStudio();
  const [ratio, setRatio] = useState<Ratio>('9:16');
  const [videoBroken, setVideoBroken] = useState(false);
  const [openModal, setOpenModal] = useState(false);
  const [previewH, setPreviewH] = useState<number>(readPreviewH);
  const [splitting, setSplitting] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRefs = useRef(new Map<string, HTMLAudioElement>());

  const shots = data.shots;
  const shot = shots[sel];

  // ---------- 跟随 EDL：当前播放头覆盖的片段 ----------
  const tlClips = data.timeline?.clips ?? [];
  const videoClips = useMemo(
    () => tlClips.filter((c) => c.track === 'video' && c.sourceUrl),
    [tlClips],
  );
  const tlMode = videoClips.length > 0;

  const activeVideo = useMemo(() => {
    if (!tlMode) return null;
    const hit = videoClips
      .filter((c) => curT >= c.timelineStart && curT < c.timelineStart + clipSpan(c))
      .sort((a, b) => a.timelineStart - b.timelineStart)
      .pop();
    return hit ?? null;
  }, [tlMode, videoClips, curT]);

  const activeAudio = useMemo(
    () =>
      tlMode
        ? tlClips.filter(
            (c) =>
              c.track === 'audio' &&
              c.sourceUrl &&
              curT >= c.timelineStart &&
              curT < c.timelineStart + clipSpan(c),
          )
        : [],
    [tlMode, tlClips, curT],
  );

  const subtitles = useMemo(
    () =>
      tlMode
        ? tlClips
            .filter(
              (c) =>
                c.track === 'subtitle' &&
                (c.text ?? '').trim() &&
                curT >= c.timelineStart &&
                curT < c.timelineStart + clipSpan(c),
            )
            .sort((a, b) => (a.lane ?? 0) - (b.lane ?? 0))
            .map((c) => (c.text ?? '').trim())
        : [],
    [tlMode, tlClips, curT],
  );

  const activeShot = activeVideo?.sourceShotId
    ? shots.find((s) => s.id === activeVideo.sourceShotId)
    : undefined;

  // 换视频/片段时重置"加载失败"标记
  const shotId = shot?.id;
  const shotVideoUrl = shot?.videoUrl;
  const activeVideoId = activeVideo?.id;
  const activeVideoUrl = activeVideo?.sourceUrl;
  useEffect(() => {
    setVideoBroken(false);
  }, [shotId, shotVideoUrl, activeVideoId, activeVideoUrl]);

  // 媒体从动于主时钟 curT
  useEffect(() => {
    const speed = activeVideo && activeVideo.speed > 0 ? activeVideo.speed : 1;
    const videoUrl = tlMode ? activeVideo?.sourceUrl : shot?.videoUrl;
    const v = videoRef.current;
    if (v && videoUrl && !videoBroken) {
      const videoT = tlMode && activeVideo
        ? Math.min(
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
      v.playbackRate = tlMode && activeVideo ? speed : 1;
      if (playing) {
        if (v.paused) v.play().catch(() => {});
        if (v.readyState >= 1 && Math.abs(v.currentTime - videoT) > 0.3) {
          v.currentTime = videoT;
        }
      } else {
        if (!v.paused) v.pause();
        if (v.readyState >= 1 && Math.abs(v.currentTime - videoT) > 0.05) {
          v.currentTime = videoT;
        }
      }
    }

    if (!tlMode) {
      // 回退：镜头自带的配音
      const a = audioRefs.current.get('legacy');
      if (a && shot?.voiceUrl) {
        const localT = Math.max(0, curT - shot.start);
        if (playing) {
          if (a.paused) a.play().catch(() => {});
          if (a.readyState >= 1 && Math.abs(a.currentTime - localT) > 0.3) {
            a.currentTime = localT;
          }
        } else {
          if (!a.paused) a.pause();
          if (a.readyState >= 1 && Math.abs(a.currentTime - localT) > 0.05) {
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
      const t = Math.min(
        Math.max(clip.inPoint + (curT - clip.timelineStart) * rate, clip.inPoint),
        Math.max(clip.inPoint, clip.outPoint),
      );
      a.playbackRate = rate;
      a.volume = Math.max(0, Math.min(1, clip.volume));
      if (playing) {
        if (a.paused) a.play().catch(() => {});
        if (a.readyState >= 1 && Math.abs(a.currentTime - t) > 0.3) a.currentTime = t;
      } else {
        if (!a.paused) a.pause();
        if (a.readyState >= 1 && Math.abs(a.currentTime - t) > 0.05) a.currentTime = t;
      }
    }
  }, [curT, playing, shot, videoBroken, tlMode, activeVideo, activeAudio]);

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
  const videoUrl = tlMode ? activeVideo?.sourceUrl : shot.videoUrl;
  const showVideo = Boolean(videoUrl) && !videoBroken;

  const step = (delta: number) => {
    if (shots.length === 0) return;
    setSel((sel + delta + shots.length) % shots.length);
  };

  const stClass = displayShot.st === 'done' ? 'ok' : displayShot.st === 'render' ? 'run' : 'dim';

  return (
    <div className="pv">
      {/* ---------- 上区：画面 ---------- */}
      <div className="pv-top" style={{ height: previewH }}>
        <div className="dsub">
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
          <span className="chip num">
            {shotLabel(shot.no)} / {shots.length}
          </span>
        </div>

        <div className="pv-stage">
          <div className="pv-frame" data-ratio={ratio} data-tag={shot.tag} data-st={shot.st}>
            {showVideo ? (
              <video
                ref={videoRef}
                src={videoUrl}
                poster={tlMode ? undefined : shot.frameUrl}
                playsInline
                preload="auto"
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
            {subtitles.length > 0 ? (
              <div className="pv-subtitle">
                {subtitles.map((t, i) => (
                  <div key={i}>{t}</div>
                ))}
              </div>
            ) : null}
            <div className="pv-safe" />
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
              onClick={() => setPlaying(!playing)}
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
