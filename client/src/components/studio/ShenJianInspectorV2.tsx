/**
 * 一幕·神剪 · 右侧检查器（原型 基础 / 调节 / 动画 三页）
 * 所有数值都写回同一份 EDL：时间、变速、音量、转场、字幕样式、运镜关键帧。
 */
import { useMemo, useState } from 'react';
import { Copy, Diamond, Link2, Scissors, Sparkles, Split, Trash2, Undo2, Volume2 } from 'lucide-react';
import { useStudio } from './StudioShell';
import { useEdl } from './EdlContext';
import { clipSpan, toTimecode } from './model';
import type { TimelineClip } from '@shared/api.interface';
import { sampleVideoTransform } from '@shared/timeline-keyframes';

type Grade = { brightness: number; contrast: number; saturation: number; filter: string };

export const ShenJianInspector = ({
  grade,
  setGrade,
}: {
  grade: Grade;
  setGrade: (patch: Partial<Grade>) => void;
}) => {
  const { data, curT, setCurT } = useStudio();
  const edl = useEdl();
  const [tab, setTab] = useState<'basic' | 'color' | 'anim'>('basic');

  const clip = useMemo(() => {
    const ids = edl.selectedIds;
    const id = ids.length ? ids[ids.length - 1] : '';
    if (!id) return null;
    return (data.timeline?.clips ?? []).find((c) => c.id === id) ?? null;
  }, [data.timeline, edl.selectedIds]);

  const shot = useMemo(
    () => (clip?.sourceShotId ? data.shots.find((s) => s.id === clip.sourceShotId) : null),
    [clip?.sourceShotId, data.shots],
  );

  const trackMeta = useMemo(
    () => (clip ? (edl.tracks ?? []).find((t) => t.track === clip.track && (t.lane ?? 0) === (clip.lane ?? 0)) : null),
    [clip, edl.tracks],
  );

  const duration = clip ? clipSpan(clip) : 0;
  const end = clip ? clip.timelineStart + duration : 0;
  const thumb = clip?.text ? undefined : clip?.sourceUrl && /\.(png|jpe?g|webp|gif)/i.test(clip.sourceUrl) ? clip.sourceUrl : shot?.frameUrl;
  const transform = clip ? sampleVideoTransform(clip.keyframes, Math.max(0, curT - clip.timelineStart)) : { scale: 1, x: 0, y: 0, rotate: 0 };

  const writeTransform = (patch: Partial<{ scale: number; x: number; y: number; rotate: number }>) => {
    if (!clip) return;
    const time = Math.max(0, curT - clip.timelineStart);
    const frames = [...(clip.keyframes ?? [])];
    const current = sampleVideoTransform(frames, time);
    const next = { time, ...current, ...patch };
    const idx = frames.findIndex((f) => Math.abs(f.time - time) < 1 / Math.max(1, edl.fps));
    if (idx >= 0) frames[idx] = { ...frames[idx], ...next };
    else frames.push(next);
    edl.setClipKeyframes(clip.id, frames);
  };

  const setStart = (v: number) => {
    if (!clip) return;
    edl.moveClip(clip.id, Math.max(0, v));
  };

  const setEnd = (v: number) => {
    if (!clip) return;
    const next = Math.max(0.1, v);
    edl.trimClip(clip.id, 'right', next - end);
  };

  return (
    <aside className="inspector">
      <div className="insp-tabs">
        {([
          ['basic', '基础'],
          ['color', '调节'],
          ['anim', '动画'],
        ] as const).map(([key, label]) => (
          <button key={key} type="button" className={tab === key ? 'on' : ''} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </div>

      <div className="insp-scroll">
        {!clip ? (
          <div className="insp-empty">
            <b>还没有选中片段</b><br />
            在底部时间线点一下任意片段，这里会显示它的时间、变速、音量、字幕和运镜。
            <div className="split-line" />
            <div className="badge-row">
              <span className="mini-chip">E 分割</span>
              <span className="mini-chip">Q 删前</span>
              <span className="mini-chip">W 删后</span>
              <span className="mini-chip">空格播放</span>
            </div>
            <div className="badge-row">
              <span className="mini-chip">拖动片段跨轨</span>
              <span className="mini-chip">拖边缘修剪</span>
              <span className="mini-chip">右键更多</span>
            </div>
          </div>
        ) : (
          <>
            <div className="sel-head">
              <div className="sel-thumb">
                {thumb ? <img src={thumb} alt="" /> : <span>{clip.track === 'audio' ? <Volume2 /> : clip.track === 'subtitle' ? 'T' : '—'}</span>}
              </div>
              <div style={{ minWidth: 0 }}>
                <div className="sel-name">{shot ? `镜${String(shot.no).padStart(2, '0')} ${shot.txt}` : clip.text || '时间线片段'}</div>
                <div className="sel-meta">
                  {toTimecode(clip.timelineStart)} → {toTimecode(end)} · {duration.toFixed(2)}s
                </div>
              </div>
              <span className="kind-pill">
                {clip.track === 'audio' ? '音频' : clip.track === 'subtitle' ? '文本' : '视频'}
              </span>
            </div>

            {tab === 'basic' ? (
              <>
                <section className="section">
                  <h4>时间<span className="val">{clip.track === 'audio' ? trackMeta?.name || `A${(clip.lane ?? 0) + 1}` : `V${(clip.lane ?? 0) + 1}`}</span></h4>
                  <div className="grid2">
                    <div className="row" style={{ margin: 0 }}>
                      <label style={{ width: 32 }}>开始</label>
                      <input type="number" step="0.05" value={Number(clip.timelineStart.toFixed(2))} onChange={(e) => setStart(Number(e.target.value) || 0)} />
                    </div>
                    <div className="row" style={{ margin: 0 }}>
                      <label style={{ width: 32 }}>结束</label>
                      <input type="number" step="0.05" value={Number(end.toFixed(2))} onChange={(e) => setEnd(Number(e.target.value) || 0.1)} />
                    </div>
                  </div>
                  <div className="mini-note" style={{ marginTop: 7 }}>
                    源入点 {clip.inPoint.toFixed(2)}s · 源出点 {clip.outPoint.toFixed(2)}s
                  </div>
                </section>

                {clip.track !== 'audio' && clip.track !== 'subtitle' ? (
                  <section className="section">
                    <h4>变换<span className="val">关键帧 {clip.keyframes?.length ?? 0}</span></h4>
                    <Slider label="缩放" value={Math.round(transform.scale * 100)} min={50} max={300} suffix="%" onChange={(v) => writeTransform({ scale: v / 100 })} />
                    <Slider label="X 位置" value={Math.round(transform.x * 100)} min={-100} max={100} suffix="%" onChange={(v) => writeTransform({ x: v / 100 })} />
                    <Slider label="Y 位置" value={Math.round(transform.y * 100)} min={-100} max={100} suffix="%" onChange={(v) => writeTransform({ y: v / 100 })} />
                    <Slider label="旋转" value={Math.round(transform.rotate)} min={-180} max={180} suffix="°" onChange={(v) => writeTransform({ rotate: v })} />
                    <Slider label="不透明度" value={100} min={0} max={100} suffix="%" onChange={() => undefined} disabled />
                  </section>
                ) : null}

                {clip.track !== 'subtitle' ? (
                  <section className="section">
                    <h4>速度与声音</h4>
                    <Slider
                      label="速度"
                      value={Number((clip.speed ?? 1).toFixed(2))}
                      min={0.25}
                      max={4}
                      step={0.05}
                      suffix="×"
                      onChange={(v) => edl.setClipSpeed(clip.id, v)}
                    />
                    <Slider
                      label="音量"
                      value={Math.round((clip.volume ?? 1) * 100)}
                      min={0}
                      max={100}
                      suffix="%"
                      onChange={(v) => edl.setClipVolume(clip.id, v / 100)}
                    />
                    <div className="row">
                      <label>混合</label>
                      <select defaultValue="normal" onChange={() => undefined}>
                        <option value="normal">正常</option>
                        <option value="overlay">叠加</option>
                        <option value="screen">滤色</option>
                      </select>
                    </div>
                  </section>
                ) : null}

                {clip.text !== undefined && clip.text !== null || clip.track === 'subtitle' ? (
                  <section className="section">
                    <h4>字幕文本</h4>
                    <textarea
                      className="sj2-textarea"
                      value={clip.text ?? ''}
                      onChange={(e) => edl.editSubtitle(clip.id, e.target.value)}
                      placeholder="输入字幕 / 对白…"
                    />
                    <div className="row">
                      <label>字号</label>
                      <input
                        type="range"
                        min="4"
                        max="24"
                        step="1"
                        value={clip.textStyle?.fontSize ?? 8}
                        onChange={(e) => edl.updateTextStyle(clip.id, { fontSize: Number(e.target.value) })}
                      />
                      <span className="mini-note">{clip.textStyle?.fontSize ?? 8}</span>
                    </div>
                    <div className="row">
                      <label>颜色</label>
                      <input
                        type="color"
                        value={clip.textStyle?.color || '#ffffff'}
                        onChange={(e) => edl.updateTextStyle(clip.id, { color: e.target.value })}
                        style={{ height: 26, padding: 2 }}
                      />
                      <div className="seg" style={{ marginLeft: 'auto' }}>
                        {(['left', 'center', 'right'] as const).map((align) => (
                          <button
                            key={align}
                            type="button"
                            className={(clip.textStyle?.align ?? 'center') === align ? 'on' : ''}
                            onClick={() => edl.updateTextStyle(clip.id, { align })}
                          >
                            {align === 'left' ? '左' : align === 'center' ? '中' : '右'}
                          </button>
                        ))}
                      </div>
                    </div>
                  </section>
                ) : null}

                <section className="section">
                  <h4>画面调节<span className="val">预览</span></h4>
                  <div className="row">
                    <label>滤镜</label>
                    <select value={grade.filter} onChange={(e) => setGrade({ filter: e.target.value })}>
                      <option value="none">无</option>
                      <option value="cinematic">电影感</option>
                      <option value="warm">暖调</option>
                      <option value="cool">冷调</option>
                    </select>
                  </div>
                  <Slider label="亮度" value={grade.brightness} min={40} max={160} suffix="" onChange={(v) => setGrade({ brightness: v })} />
                  <Slider label="对比度" value={grade.contrast} min={40} max={160} suffix="" onChange={(v) => setGrade({ contrast: v })} />
                  <Slider label="饱和度" value={grade.saturation} min={0} max={200} suffix="" onChange={(v) => setGrade({ saturation: v })} />
                </section>

                <section className="section">
                  <h4>操作</h4>
                  <div className="grid4">
                    <button type="button" className="tool-tile" data-tip="分割 (E / Ctrl+B)" onClick={() => edl.splitAtPlayhead(curT, clip.id)}>
                      <Scissors />分割
                    </button>
                    <button type="button" className="tool-tile" data-tip="波纹删除：删除并合拢空隙" onClick={() => edl.rippleDelete([clip.id])}>
                      <Trash2 />删除
                    </button>
                    <button type="button" className="tool-tile" data-tip="倒放：画面与独立音频一起反向" onClick={() => edl.toggleClipReverse(clip.id)}>
                      <Undo2 />倒放
                    </button>
                    <button type="button" className="tool-tile" data-tip="复制片段" onClick={() => edl.copySelection([clip.id])}>
                      <Copy />复制
                    </button>
                    <button type="button" className="tool-tile" data-tip="音画分离" onClick={() => edl.detachAudio(clip.id)}>
                      <Volume2 />分离
                    </button>
                    <button type="button" className="tool-tile" data-tip="复合片段" onClick={() => edl.createCompound([clip.id])}>
                      <Link2 />复合
                    </button>
                    <button type="button" className="tool-tile" data-tip="在播放头加一个运镜关键帧" onClick={() => writeTransform({})}>
                      <Diamond />关键帧
                    </button>
                    <button type="button" className="tool-tile" data-tip="跳到片段开头" onClick={() => setCurT(clip.timelineStart)}>
                      <Split />片头
                    </button>
                  </div>
                  <div className="insp-foot">
                    双击时间线片段可进入字幕编辑；拖片段左右边缘可修剪；拖到另一条画面轨可叠加。
                  </div>
                </section>
              </>
            ) : null}

            {tab === 'color' ? (
              <>
                <section className="section">
                  <h4>滤镜预设</h4>
                  <div className="swatches">
                    {[
                      ['none', '#8a909b', '原始'],
                      ['cinematic', '#b98a57', '电影'],
                      ['warm', '#d9a066', '暖调'],
                      ['cool', '#6f9ec2', '冷调'],
                    ].map(([key, color, label]) => (
                      <button
                        key={key}
                        type="button"
                        className={`swatch${grade.filter === key ? ' on' : ''}`}
                        style={{ background: color }}
                        title={label}
                        onClick={() => setGrade({ filter: key })}
                      />
                    ))}
                  </div>
                </section>
                <section className="section">
                  <h4>基础调节</h4>
                  <Slider label="亮度" value={grade.brightness} min={40} max={160} suffix="" onChange={(v) => setGrade({ brightness: v })} />
                  <Slider label="对比度" value={grade.contrast} min={40} max={160} suffix="" onChange={(v) => setGrade({ contrast: v })} />
                  <Slider label="饱和度" value={grade.saturation} min={0} max={200} suffix="" onChange={(v) => setGrade({ saturation: v })} />
                  <div className="mini-note">这些调节实时作用在中舞台预览；当前导出烧录仍以时间线数据为准。</div>
                </section>
              </>
            ) : null}

            {tab === 'anim' ? (
              <>
                <section className="section">
                  <h4>运镜关键帧<span className="val">{clip.keyframes?.length ?? 0} 个</span></h4>
                  {(clip.keyframes?.length ?? 0) === 0 ? (
                    <div className="keyframe-bar">
                      <span>在播放头添加第一个关键帧</span>
                      <button type="button" className="mini-btn" onClick={() => writeTransform({})}>添加</button>
                    </div>
                  ) : (
                    <div className="kf-list">
                      {(clip.keyframes ?? []).map((f) => (
                        <div key={f.time} className="kf-row">
                          <b>{f.time.toFixed(2)}s</b>
                          <span>缩放 {Math.round((f.scale ?? 1) * 100)}% · X {Math.round((f.x ?? 0) * 100)}% · Y {Math.round((f.y ?? 0) * 100)}% · {Math.round(f.rotate ?? 0)}°</span>
                          <button
                            type="button"
                            className="icon-btn"
                            title="删除关键帧"
                            onClick={() => edl.setClipKeyframes(clip.id, (clip.keyframes ?? []).filter((x) => x !== f))}
                          >
                            <Trash2 />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="grid2" style={{ marginTop: 8 }}>
                    <button type="button" className="mini-btn" onClick={() => writeTransform({ scale: 1.12 })}>缓慢推近</button>
                    <button type="button" className="mini-btn" onClick={() => writeTransform({ scale: 0.94 })}>缓慢拉远</button>
                  </div>
                </section>
                <section className="section">
                  <h4>动画说明</h4>
                  <div className="mini-note">
                    关键帧按「片段本地时间」写入 EDL，预览与导出共用同一份数据；同一时间重复修改会合并成一个关键帧。
                  </div>
                </section>
              </>
            ) : null}
          </>
        )}
      </div>
    </aside>
  );
};

const Slider = ({
  label,
  value,
  min,
  max,
  step = 1,
  suffix,
  onChange,
  disabled,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  onChange: (v: number) => void;
  disabled?: boolean;
}) => (
  <div className="row">
    <label>{label}</label>
    <input type="range" min={min} max={max} step={step} value={value} disabled={disabled} onChange={(e) => onChange(Number(e.target.value))} />
    <span className="mini-note" style={{ width: 42, textAlign: 'right' }}>{value}{suffix ?? ''}</span>
  </div>
);

export default ShenJianInspector;
