/**
 * 画面关键帧条（剪映式）
 * -------------------------------------------------------------
 * · 每个关键帧显示该时刻的真实画面缩略图 + 时间 + 缩放/位移/旋转；
 * · 缩略图来自服务端抽帧 sprite，按关键帧的源时间取格，能直接看出关键帧内容；
 * · 点击卡片定位到该帧；× 删除；「抽帧」把当前播放头画面写成关键帧。
 */
import { useMemo, type CSSProperties } from 'react';
import { useStudio } from './StudioShell';
import { useEdl } from './EdlContext';
import { useThumbnails } from './timeline-media';
import { clipSpan } from './model';
import { sampleVideoTransform, type TimelineVideoKeyframe } from '@shared/timeline-keyframes';
import type { TimelineClip } from '@shared/api.interface';
import { toast } from 'sonner';

const frameOf = (clip: TimelineClip, f: TimelineVideoKeyframe) => {
  const local = Math.max(0, Math.min(clipSpan(clip), f.time));
  const src = clip.reverse
    ? Math.max(clip.inPoint, clip.outPoint - local * (clip.speed ?? 1))
    : clip.inPoint + local * (clip.speed ?? 1);
  return src;
};

export const ShenJianKeyframes = ({
  clip,
  curT,
  onSeek,
}: {
  clip: TimelineClip;
  curT: number;
  onSeek: (t: number) => void;
}) => {
  const { projectId } = useStudio();
  const edl = useEdl();
  const span = Math.max(0.01, clipSpan(clip));
  const localT = Math.max(0, Math.min(span, curT - clip.timelineStart));
  const frames = useMemo(
    () => [...(clip.keyframes ?? [])].sort((a, b) => a.time - b.time),
    [clip.keyframes],
  );
  const thumb = useThumbnails(projectId, clip.sourceUrl);
  const current = sampleVideoTransform(clip.keyframes, localT);
  const hasAtPlayhead = frames.some((f) => Math.abs(f.time - localT) < 1 / Math.max(1, edl.fps));

  const addAtPlayhead = () => {
    if (hasAtPlayhead) {
      edl.setClipKeyframes(clip.id, frames.filter((f) => Math.abs(f.time - localT) >= 1 / Math.max(1, edl.fps)));
      toast.info(`已删除 ${localT.toFixed(2)}s 的画面关键帧`);
      return;
    }
    const next = [...frames, { time: localT, ...current, easing: 'linear' as const }];
    edl.setClipKeyframes(clip.id, next);
    toast.success(`已从当前画面抽取关键帧：${localT.toFixed(2)}s`);
  };

  const cell = (f: TimelineVideoKeyframe) => {
    if (!thumb || thumb.tileWidth <= 0) return null;
    const t = frameOf(clip, f);
    const idx = Math.max(0, Math.min(thumb.count - 1, Math.floor(t / thumb.interval)));
    const col = idx % thumb.columns;
    const row = Math.floor(idx / thumb.columns);
    return {
      backgroundImage: `url("${thumb.spriteUrl}")`,
      backgroundSize: `${thumb.columns * thumb.tileWidth}px ${thumb.rows * thumb.tileHeight}px`,
      backgroundPosition: `-${col * thumb.tileWidth}px -${row * thumb.tileHeight}px`,
      width: thumb.tileWidth,
      height: thumb.tileHeight,
    } as CSSProperties;
  };

  return (
    <section className="section">
      <h4>
        画面关键帧 <span className="val">{frames.length}</span>
        <button
          type="button"
          className={`mini-btn kf-toggle${hasAtPlayhead ? ' on' : ''}`}
          title={hasAtPlayhead ? '删除播放头处的画面关键帧' : '从当前画面抽取关键帧'}
          onClick={addAtPlayhead}
        >
          ◆
        </button>
        <button type="button" className="mini-btn kf-pick" title="从当前画面抽取关键帧" onClick={addAtPlayhead}>
          抽取画面
        </button>
      </h4>
      {frames.length === 0 ? (
        <p className="mini-note">还没有画面关键帧。把播放头停在想要的画面上，点「抽取画面」即可把当前画面定为关键帧。</p>
      ) : (
        <div className="kf-strip">
          {frames.map((f) => {
            const style = cell(f);
            const tr = sampleVideoTransform([f], 0);
            const on = Math.abs(f.time - localT) < 0.5 / Math.max(1, edl.fps) + 0.05;
            return (
              <div
                key={`${f.time}-${f.scale ?? 1}-${f.x ?? 0}`}
                className={`kf-card${on ? ' on' : ''}`}
                title={`${f.time.toFixed(2)}s · 缩放 ${Math.round((tr.scale ?? 1) * 100)}% · X ${Math.round((f.x ?? 0) * 100)}% · Y ${Math.round((f.y ?? 0) * 100)}%`}
                onClick={() => onSeek(clip.timelineStart + f.time)}
              >
                <div className="kf-shot" style={style ?? undefined}>
                  {!style ? <span className="kf-shot-fallback">无帧</span> : null}
                  <b className="kf-badge">{f.time.toFixed(2)}s</b>
                </div>
                <div className="kf-meta">
                  <span>{Math.round((tr.scale ?? 1) * 100)}%</span>
                  <span>{Math.round((f.x ?? 0) * 100)},{Math.round((f.y ?? 0) * 100)}</span>
                  <i
                    role="button"
                    tabIndex={0}
                    title="删除该关键帧"
                    onClick={(e) => {
                      e.stopPropagation();
                      edl.setClipKeyframes(clip.id, frames.filter((x) => x !== f));
                    }}
                    onKeyDown={() => undefined}
                  >
                    ×
                  </i>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
};
