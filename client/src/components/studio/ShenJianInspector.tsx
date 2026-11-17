/**
 * 一幕·神剪 · 右侧检查器
 * -------------------------------------------------------------
 * 与时间线共用同一份 EDL（useEdl），所有修改都走现有 commit / 撤销栈，
 * 不再另存属性副本。没有选中片段时显示工程概览。
 */
import { useMemo } from 'react';
import { useStudio } from './StudioShell';
import { useEdl } from './EdlContext';
import { clipSpan, toTimecode } from './model';
import type { TimelineClip, TimelineTextStyle } from '@shared/api.interface';

const TRACK_LABEL: Record<string, string> = {
  video: '画面',
  audio: '音频',
  subtitle: '字幕',
};

const kindOf = (clip: TimelineClip): 'video' | 'audio' | 'text' =>
  clip.track === 'subtitle' ? 'text' : clip.track === 'audio' ? 'audio' : 'video';

const basename = (url?: string | null) => {
  if (!url) return '';
  try {
    return decodeURIComponent(url.split('?')[0].split('/').pop() || '');
  } catch {
    return url.split('/').pop() || '';
  }
};

const fieldBox =
  'width:100%;height:26px;background:#0d0f13;border:1px solid #2a2e36;border-radius:5px;padding:0 7px;color:#dfe4ea;font-size:11px;outline:none';

export const ShenJianInspector = () => {
  const { data, curT, setCurT } = useStudio();
  const edl = useEdl();

  const clip = useMemo(() => {
    // 多选时以最后点选的片段为主（与剪映检查器一致），避免旧选中项占住面板
    const ids = edl.selectedIds;
    const id = ids.length ? ids[ids.length - 1] : '';
    if (!id) return null;
    return (data.timeline?.clips ?? []).find((c) => c.id === id) ?? null;
  }, [data.timeline, edl.selectedIds]);

  const shot = useMemo(
    () => (clip?.sourceShotId ? data.shots.find((s) => s.id === clip.sourceShotId) : null),
    [clip?.sourceShotId, data.shots],
  );

  const trackMeta = useMemo(() => {
    if (!clip) return null;
    return (edl.tracks ?? []).find(
      (t) => t.track === clip.track && (t.lane ?? 0) === (clip.lane ?? 0),
    );
  }, [clip, edl.tracks]);

  if (!clip) {
    const total = data.totalSec || 0;
    return (
      <div className="sj-insp">
        <div className="sj-insp-empty-head">
          <span className="sj-insp-kicker">工程概览</span>
          <b>{data.project?.title || '未命名项目'}</b>
          <small>{data.timeline?.clips.length ?? 0} 个片段 · {toTimecode(total)}</small>
        </div>
        <div className="sj-insp-scroll">
          <section className="sj-sec">
            <h4>当前工程</h4>
            <div className="sj-kv"><span>版本</span><b>v{edl.version}</b></div>
            <div className="sj-kv"><span>帧率</span><b>{edl.fps} fps</b></div>
            <div className="sj-kv"><span>轨道</span><b>{edl.tracks.length}</b></div>
            <div className="sj-kv"><span>已保存</span><b className={edl.dirty ? 'warn' : 'ok'}>{edl.dirty ? '待保存' : '已同步'}</b></div>
          </section>
          <section className="sj-sec">
            <h4>快速操作</h4>
            <div className="sj-quick4">
              <button type="button" onClick={() => edl.splitAtPlayhead(curT)}>分割 E</button>
              <button type="button" onClick={() => edl.addMarker(curT)}>标记 M</button>
              <button type="button" onClick={() => edl.addSubtitle(curT)}>加字幕</button>
              <button type="button" onClick={() => window.dispatchEvent(new CustomEvent('yimu:timeline-shortcuts'))}>快捷键</button>
            </div>
          </section>
          <section className="sj-sec">
            <h4>剪辑提示</h4>
            <p className="sj-note">
              在时间线点选片段后，这里会显示速度、音量、转场、字幕、关键帧与真实入出点。
              所有修改都会自动保存到当前项目时间线。
            </p>
          </section>
        </div>
      </div>
    );
  }

  const kind = kindOf(clip);
  const hasText = kind === 'text' || Boolean(clip.text);
  const span = clipSpan(clip);
  const end = clip.timelineStart + span;
  const volume = Math.round((clip.volume ?? 1) * 100);
  const style: TimelineTextStyle = clip.textStyle ?? {};
  const transition = clip.transition?.type ?? 'none';
  const disabled = clip.enabled === false;
  const locked = clip.locked === true;

  return (
    <div className="sj-insp">
      <div className="sj-insp-head">
        <div className={`sj-insp-thumb ${kind}`}>
          {clip.sourceUrl && kind !== 'text' ? (
            kind === 'video' ? <video src={clip.sourceUrl} muted preload="metadata" /> : <span>♪</span>
          ) : (
            <span>{kind === 'text' ? 'T' : '—'}</span>
          )}
        </div>
        <div className="sj-insp-title">
          <b>{shot ? `#${String(shot.no).padStart(2, '0')} ${shot.txt}` : clip.text || basename(clip.sourceUrl) || '未命名片段'}</b>
          <small>
            {TRACK_LABEL[clip.track] || clip.track} · {trackMeta?.name || `${clip.track.toUpperCase()}${(clip.lane ?? 0) + 1}`}
            {' · '}{toTimecode(clip.timelineStart)} → {toTimecode(end)}
          </small>
        </div>
        <span className={`sj-kind ${kind}`}>{kind === 'text' ? '文本' : kind === 'audio' ? '音频' : '画面'}</span>
      </div>

      <div className="sj-insp-scroll">
        <section className="sj-sec">
          <h4>时间与入出点</h4>
          <div className="sj-grid2">
            <label className="sj-field">
              <span>时间线起点</span>
              <input
                type="number"
                step="0.05"
                value={Number(clip.timelineStart.toFixed(2))}
                style={{ width: '100%' }}
                onChange={(e) => edl.moveClip(clip.id, Math.max(0, Number(e.target.value) || 0))}
              />
            </label>
            <label className="sj-field">
              <span>片段时长</span>
              <input
                type="number"
                step="0.05"
                value={Number(span.toFixed(2))}
                style={{ width: '100%' }}
                onChange={(e) => {
                  const next = Math.max(0.1, Number(e.target.value) || 0.1);
                  edl.trimClip(clip.id, 'right', next - span);
                }}
              />
            </label>
          </div>
          <div className="sj-kv"><span>源入点</span><b>{clip.inPoint.toFixed(2)}s</b></div>
          <div className="sj-kv"><span>源出点</span><b>{clip.outPoint.toFixed(2)}s</b></div>
        </section>

        {kind !== 'text' ? (
          <section className="sj-sec">
            <h4>速度与音量</h4>
            <label className="sj-range">
              <span>速度 <b>{(clip.speed ?? 1).toFixed(2)}×</b></span>
              <input
                type="range"
                min="0.25"
                max="4"
                step="0.05"
                value={clip.speed ?? 1}
                onChange={(e) => edl.setClipSpeed(clip.id, Number(e.target.value))}
              />
            </label>
            <label className="sj-range">
              <span>音量 <b>{volume}%</b></span>
              <input
                type="range"
                min="0"
                max="100"
                value={volume}
                onChange={(e) => edl.setClipVolume(clip.id, Number(e.target.value) / 100)}
              />
            </label>
            <div className="sj-row2">
              <button type="button" className={clip.reverse ? 'on' : ''} onClick={() => edl.toggleClipReverse(clip.id)}>
                {clip.reverse ? '已倒放' : '倒放'}
              </button>
              <button type="button" onClick={() => edl.detachAudio(clip.id)}>分离音频</button>
              <button type="button" onClick={() => edl.createCompound([clip.id])}>复合片段</button>
            </div>
          </section>
        ) : null}

        {hasText ? (
          <section className="sj-sec">
            <h4>字幕文本</h4>
            <textarea
              className="sj-textarea"
              value={clip.text ?? ''}
              onChange={(e) => edl.setClipText(clip.id, e.target.value)}
              placeholder="输入字幕 / 对白…"
            />
            <label className="sj-range">
              <span>字号 <b>{style.fontSize ?? 8}</b></span>
              <input
                type="range"
                min="4"
                max="24"
                step="1"
                value={style.fontSize ?? 8}
                onChange={(e) => edl.updateTextStyle(clip.id, { fontSize: Number(e.target.value) })}
              />
            </label>
            <div className="sj-row2">
              {(['left', 'center', 'right'] as const).map((align) => (
                <button
                  key={align}
                  type="button"
                  className={(style.align ?? 'center') === align ? 'on' : ''}
                  onClick={() => edl.updateTextStyle(clip.id, { align })}
                >
                  {align === 'left' ? '左对齐' : align === 'center' ? '居中' : '右对齐'}
                </button>
              ))}
            </div>
            <label className="sj-field">
              <span>文字颜色</span>
              <input
                type="color"
                value={style.color || '#ffffff'}
                onChange={(e) => edl.updateTextStyle(clip.id, { color: e.target.value })}
                style={{ width: '100%', height: '28px', background: '#0d0f13', border: '1px solid #2a2e36' }}
              />
            </label>
          </section>
        ) : null}

        <section className="sj-sec">
          <h4>转场与状态</h4>
          <label className="sj-field">
            <span>与下一片段转场</span>
            <select
              value={transition}
              onChange={(e) =>
                edl.setClipTransition(clip.id, {
                  type: e.target.value as 'none' | 'crossfade' | 'fade',
                  duration: e.target.value === 'none' ? 0 : 0.4,
                })
              }
            >
              <option value="none">无</option>
              <option value="crossfade">叠化</option>
              <option value="fade">淡入淡出</option>
            </select>
          </label>
          <div className="sj-row2">
            <button type="button" className={disabled ? 'on' : ''} onClick={() => edl.setClipEnabled(clip.id, disabled)}>
              {disabled ? '已停用' : '启用画面'}
            </button>
            <button type="button" className={locked ? 'on' : ''} onClick={() => edl.setClipLocked(clip.id, !locked)}>
              {locked ? '已锁定' : '锁定片段'}
            </button>
          </div>
        </section>

        <section className="sj-sec">
          <h4>在播放头操作</h4>
          <div className="sj-quick4">
            <button type="button" onClick={() => edl.splitAtPlayhead(curT, clip.id)} disabled={curT <= clip.timelineStart || curT >= end}>分割 E</button>
            <button type="button" onClick={() => edl.rippleTrimAt(clip.id, 'left', curT)} disabled={curT <= clip.timelineStart || curT >= end}>删前 Q</button>
            <button type="button" onClick={() => edl.rippleTrimAt(clip.id, 'right', curT)} disabled={curT <= clip.timelineStart || curT >= end}>删后 W</button>
            <button type="button" onClick={() => edl.rippleDelete([clip.id])}>波纹删</button>
          </div>
          <div className="sj-row2">
            <button type="button" onClick={() => edl.copySelection([clip.id])}>复制</button>
            <button type="button" onClick={() => edl.cutSelection([clip.id])}>剪切</button>
            <button type="button" onClick={() => setCurT(clip.timelineStart)}>跳到片段头</button>
          </div>
        </section>

        {clip.keyframes && clip.keyframes.length > 0 ? (
          <section className="sj-sec">
            <h4>运镜关键帧 <span className="sj-count">{clip.keyframes.length}</span></h4>
            <p className="sj-note">关键帧已真实落库，预览与导出读取同一份数据。</p>
          </section>
        ) : null}
      </div>
    </div>
  );
};

export default ShenJianInspector;
