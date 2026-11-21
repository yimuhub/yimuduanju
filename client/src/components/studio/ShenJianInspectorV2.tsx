/**
 * 一幕·神剪 · 右侧检查器（原型 基础 / 调节 / 动画 三页）
 * 所有数值都写回同一份 EDL：时间、变速、音量、转场、字幕样式、运镜关键帧。
 */
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Copy, Diamond, Link2, Scissors, Sparkles, Split, Trash2, Undo2, Volume2 } from 'lucide-react';
import { useStudio } from './StudioShell';
import { useEdl } from './EdlContext';
import { clipSpan, toTimecode } from './model';
import type { TimelineClip } from '@shared/api.interface';
import { sampleVideoTransform } from '@shared/timeline-keyframes';
import { cinematicCropPreset, normalizeCrop, type TimelineVisualCrop } from '@shared/timeline-visual';
import { useAutoRecord } from '@client/src/lib/keyframe-autorecord';

type Grade = { brightness: number; contrast: number; saturation: number; filter: string };

const gainToDb = (gain: number) => 20 * Math.log10(Math.max(0.001, gain));
const dbToGain = (db: number) => (db <= -60 ? 0 : Math.min(1, Math.pow(10, db / 20)));
const pitchToSemitone = (pitch: number) => Math.round(12 * Math.log2(Math.max(0.5, pitch)));
const semitoneToPitch = (semi: number) => Math.min(2, Math.max(0.5, Math.pow(2, semi / 12)));

const TEXT_FONTS = [
  { value: 'source-han-sans', label: '思源黑体' },
  { value: 'pingfang', label: '苹方' },
  { value: 'songti', label: '宋体' },
  { value: 'kaiti', label: '楷体' },
  { value: 'mono', label: '等宽' },
];

const TEXT_TEMPLATES: Array<{ name: string; patch: Record<string, unknown> }> = [
  { name: '经典白字', patch: { color: '#FFFFFF', strokeColor: '#000000', strokeWidth: 0.04, bgColor: '', bold: true } },
  { name: '综艺黄', patch: { color: '#FFE45C', strokeColor: '#000000', strokeWidth: 0.05, bgColor: '', bold: true } },
  { name: '电影字幕', patch: { color: '#F4F1EA', strokeColor: '#000000', strokeWidth: 0.03, bgColor: '#000000', bgOpacity: 0.55, bold: true } },
  { name: '黑底白字', patch: { color: '#FFFFFF', strokeColor: '#000000', strokeWidth: 0, bgColor: '#000000', bgOpacity: 0.55, bold: true } },
  { name: '极简小字', patch: { color: '#DDE3EA', strokeColor: '#000000', strokeWidth: 0.02, bgColor: '', bold: false, fontSize: 4.2 } },
];

/** 裁剪四边的中文标签（画面→基础 裁剪区块） */
const CROP_EDGE_LABEL: Record<keyof TimelineVisualCrop, string> = { top: '上', bottom: '下', left: '左', right: '右' };

export const ShenJianInspector = ({
  grade,
  setGrade,
}: {
  grade: Grade;
  setGrade: (patch: Partial<Grade>) => void;
}) => {
  const { data, curT, setCurT } = useStudio();
  const edl = useEdl();
  // 自动打点（G13）：开启时改运镜参数在播放头自动落关键帧（localStorage 持久，与工具条同源）
  const [autoRecord, setAutoRecord] = useAutoRecord();
  const [tab, setTab] = useState<'basic' | 'color' | 'anim'>('basic');
  useEffect(() => {
    const h = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (d === 'basic' || d === 'color' || d === 'anim') setTab(d);
    };
    window.addEventListener('yimu:shenjian-inspector-tab', h);
    return () => window.removeEventListener('yimu:shenjian-inspector-tab', h);
  }, []);
  // 时间线右键「裁剪」等入口：切到基础页并滚动到裁剪区块（延迟一拍等渲染完成）
  useEffect(() => {
    const onCrop = () => {
      setTab('basic');
      window.setTimeout(() => {
        document.querySelector('.inspector [data-insp-crop]')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 60);
    };
    window.addEventListener('yimu:shenjian-inspector-crop', onCrop);
    return () => window.removeEventListener('yimu:shenjian-inspector-crop', onCrop);
  }, []);

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
    // 手动打点入口（菱形按钮 / ⌘K 传空 patch）：始终在播放头落点，不受开关影响
    const manual = Object.keys(patch).length === 0;
    if (autoRecord || manual) {
      const current = sampleVideoTransform(frames, time);
      const next = { time, ...current, ...patch };
      const idx = frames.findIndex((f) => Math.abs(f.time - time) < 1 / Math.max(1, edl.fps));
      if (idx >= 0) frames[idx] = { ...frames[idx], ...next };
      else frames.push(next);
      edl.setClipKeyframes(clip.id, frames);
      return;
    }
    // 自动打点关闭（G13）：改的是整条动画的数值——所有关键帧统一更新，不再偷落新点
    if (!frames.length) {
      toast.info('自动打点已关闭且该片段没有关键帧：打开「自动打点」或在播放头按 ⌘K 打点');
      return;
    }
    edl.setClipKeyframes(
      clip.id,
      frames.map((f) => ({ ...f, ...patch })),
    );
  };

  /** 剪映菱形按钮：播放头处有关键帧则删除，没有则按当前变换添加 */
  const toggleKeyframe = () => {
    if (!clip) return;
    const time = Math.max(0, curT - clip.timelineStart);
    const frames = [...(clip.keyframes ?? [])];
    const idx = frames.findIndex((f) => Math.abs(f.time - time) < 1 / Math.max(1, edl.fps));
    if (idx >= 0) {
      frames.splice(idx, 1);
      edl.setClipKeyframes(clip.id, frames);
      toast.info(`已删除 ${time.toFixed(2)}s 处的关键帧`);
    } else {
      const current = sampleVideoTransform(frames, time);
      frames.push({ time, ...current });
      edl.setClipKeyframes(clip.id, frames);
      toast.success(`已在 ${time.toFixed(2)}s 添加关键帧（时间线上显示白色菱形）`);
    }
  };

  const setMotion = (
    from: Partial<{ scale: number; x: number; y: number; rotate: number }>,
    to: Partial<{ scale: number; x: number; y: number; rotate: number }>,
  ) => {
    if (!clip) return;
    const a = { time: 0, scale: 1, x: 0, y: 0, rotate: 0, ...from };
    const b = { time: Math.max(0.1, duration), scale: 1, x: 0, y: 0, rotate: 0, ...to };
    edl.setClipKeyframes(clip.id, [a, b] as never);
    toast.success('运镜已写入：预览与导出共用同一份关键帧');
  };

  const setStart = (v: number) => {
    if (!clip) return;
    edl.moveClip(clip.id, Math.max(0, v));
  };

  /** 源画面裁剪（C1）：归一化后写 visual.crop，全零自动清空为 null（= 不裁，旧行为） */
  const visualCrop = clip?.visual?.crop ?? null;
  const patchCrop = (patch: Partial<TimelineVisualCrop>) => {
    if (!clip) return;
    const next = normalizeCrop({
      left: visualCrop?.left ?? 0,
      right: visualCrop?.right ?? 0,
      top: visualCrop?.top ?? 0,
      bottom: visualCrop?.bottom ?? 0,
      ...patch,
    });
    edl.setClipVisual(clip.id, { crop: next });
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
                    <h4>变换</h4>
                    <Slider label="缩放" value={Math.round(transform.scale * 100)} min={50} max={300} suffix="%" onChange={(v) => writeTransform({ scale: v / 100 })} />
                    <Slider label="X 位置" value={Math.round(transform.x * 100)} min={-100} max={100} suffix="%" onChange={(v) => writeTransform({ x: v / 100 })} />
                    <Slider label="Y 位置" value={Math.round(transform.y * 100)} min={-100} max={100} suffix="%" onChange={(v) => writeTransform({ y: v / 100 })} />
                    <Slider label="旋转" value={Math.round(transform.rotate)} min={-180} max={180} suffix="°" onChange={(v) => writeTransform({ rotate: v })} />
                    <div className="grid2" style={{ marginTop: 6 }}>
                      <button type="button" className="mini-btn" onClick={() => writeTransform({ scale: 1, x: 0, y: 0 })}>适应画面</button>
                      <button type="button" className="mini-btn" onClick={() => writeTransform({ scale: 1.08, x: 0, y: 0 })}>填充画面</button>
                      <button type="button" className="mini-btn" onClick={() => writeTransform({ scale: 0.86, x: 0, y: 0 })}>原始尺寸</button>
                      <button type="button" className="mini-btn" onClick={() => edl.setClipKeyframes(clip.id, [])}>重置运镜</button>
                    </div>
                  </section>
                ) : null}

                {clip.track !== 'audio' && clip.track !== 'subtitle' ? (
                  <section className="section" data-insp-crop>
                    <h4>裁剪<span className="val">{visualCrop ? '已裁切' : '未裁剪'}</span></h4>
                    <div className="grid2">
                      {(['top', 'bottom', 'left', 'right'] as const).map((edge) => (
                        <div className="row" style={{ margin: 0 }} key={edge}>
                          <label style={{ width: 32 }}>{CROP_EDGE_LABEL[edge]}</label>
                          <input
                            type="number"
                            min={0}
                            max={45}
                            step={1}
                            value={Math.round((visualCrop?.[edge] ?? 0) * 100)}
                            onChange={(e) => patchCrop({ [edge]: (Number(e.target.value) || 0) / 100 })}
                          />
                        </div>
                      ))}
                    </div>
                    <div className="grid2" style={{ marginTop: 6 }}>
                      <button
                        type="button"
                        className="mini-btn"
                        title="按项目画幅裁掉上下，得到 2.35:1 电影感构图"
                        onClick={() => {
                          const preset = cinematicCropPreset(data.timeline?.width ?? 1080, data.timeline?.height ?? 1920);
                          if (!preset) {
                            toast.info('当前画幅已经比 2.35:1 更宽，无需裁切');
                            return;
                          }
                          patchCrop(preset);
                          toast.success('已按画幅裁出 2.35:1 电影感（居中，只裁上下）');
                        }}
                      >
                        2.35:1 电影感
                      </button>
                      <button type="button" className="mini-btn" disabled={!visualCrop} onClick={() => edl.setClipVisual(clip.id, { crop: null })}>
                        重置裁剪
                      </button>
                    </div>
                    <div className="mini-note" style={{ marginTop: 4 }}>
                      裁掉源画面四周再铺满画幅（每边最多 45%，上下/左右合计不超过 90%）；蒙版与字幕作用在裁切后的画面上，预览与导出共用同一份参数。
                    </div>
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
                      value={Number(gainToDb(clip.volume ?? 1).toFixed(1))}
                      min={-60}
                      max={0}
                      step={0.5}
                      suffix=" dB"
                      onChange={(v) => edl.setClipVolume(clip.id, dbToGain(v))}
                    />
                    <div className="grid2" style={{ marginTop: 6 }}>
                      {[0.5, 1, 1.5, 2].map((v) => (
                        <button key={v} type="button" className={`mini-btn${Math.abs((clip.speed ?? 1) - v) < 0.01 ? ' on' : ''}`} onClick={() => edl.setClipSpeed(clip.id, v)}>{v}× 变速</button>
                      ))}
                    </div>
                    <div className="row" style={{ marginTop: 6 }}>
                      <label>音量预设</label>
                      <div className="seg" style={{ marginLeft: 'auto', flexWrap: 'wrap' }}>
                        {[-24, -12, -6, -3, 0].map((db) => (
                          <button key={db} type="button" className={Math.abs(gainToDb(clip.volume ?? 1) - db) < 0.6 ? 'on' : ''} onClick={() => edl.setClipVolume(clip.id, dbToGain(db))}>{db === 0 ? '0' : db} dB</button>
                        ))}
                      </div>
                    </div>
                    <Slider
                      label="音高"
                      value={pitchToSemitone(clip.pitch ?? 1)}
                      min={-12}
                      max={12}
                      step={1}
                      suffix=" 半音"
                      onChange={(v) => edl.setClipPitch(clip.id, semitoneToPitch(v))}
                    />
                    <div className="grid2" style={{ marginTop: 6 }}>
                      {[-12, -6, 0, 6, 12].map((semi) => (
                        <button key={semi} type="button" className={`mini-btn${pitchToSemitone(clip.pitch ?? 1) === semi ? ' on' : ''}`} onClick={() => edl.setClipPitch(clip.id, semitoneToPitch(semi))}>{semi > 0 ? `+${semi}` : semi} 半音</button>
                      ))}
                    </div>
                    <div className="mini-note" style={{ marginTop: 4 }}>
                      当前 {(clip.pitch ?? 1).toFixed(3)}× · 导出用 asetrate + atempo 保持片段时长
                    </div>
                    {clip.track === 'video' ? (
                      <>
                        <button type="button" className="mini-btn" style={{ width: '100%', marginTop: 6 }} onClick={() => edl.detachAudio(clip.id)}>
                          <Volume2 /> 音轨分离（原声轨）
                        </button>
                        <button
                          type="button"
                          className="mini-btn"
                          style={{ width: '100%', marginTop: 4 }}
                          onClick={() => {
                            const audioId = edl.detachAudio(clip.id);
                            if (!audioId) { toast.info('该画面已有独立原声轨'); return; }
                            edl.setClipText(audioId, `♪ 人声 · ${clip.text?.trim() || '对白'}`.slice(0, 120));
                            toast.success('已拆出独立人声轨');
                          }}
                        >
                          <Sparkles /> 人声分离（拆出人声轨）
                        </button>
                      </>
                    ) : null}
                  </section>
                ) : null}

                {clip.track === 'subtitle' ? (
                  <section className="section">
                    <h4>字幕文本</h4>
                    <textarea
                      className="sj2-textarea"
                      value={clip.text ?? ''}
                      onChange={(e) => edl.editSubtitle(clip.id, e.target.value)}
                      placeholder="输入字幕 / 对白…"
                    />
                    <div className="row">
                      <label>字体</label>
                      <select
                        value={clip.textStyle?.fontFamily ?? 'source-han-sans'}
                        onChange={(e) => edl.updateTextStyle(clip.id, { fontFamily: e.target.value })}
                      >
                        {TEXT_FONTS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                      </select>
                    </div>
                    <div className="row" style={{ marginTop: 4 }}>
                      <label>模板</label>
                      <div className="seg" style={{ marginLeft: 'auto', flexWrap: 'wrap' }}>
                        {TEXT_TEMPLATES.map((tpl) => (
                          <button
                            key={tpl.name}
                            type="button"
                            onClick={() => edl.updateTextStyle(clip.id, tpl.patch as never)}
                          >{tpl.name}</button>
                        ))}
                      </div>
                    </div>
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
                    <div className="row">
                      <label>字重</label>
                      <div className="seg">
                        <button type="button" className={(clip.textStyle?.bold ?? false) ? 'on' : ''} onClick={() => edl.updateTextStyle(clip.id, { bold: !(clip.textStyle?.bold ?? false) })}>B 粗</button>
                        <button type="button" className={(clip.textStyle?.italic ?? false) ? 'on' : ''} onClick={() => edl.updateTextStyle(clip.id, { italic: !(clip.textStyle?.italic ?? false) })}>I 斜</button>
                      </div>
                    </div>
                    <div className="row">
                      <label>描边</label>
                      <input type="color" value={clip.textStyle?.strokeColor || '#000000'} onChange={(e) => edl.updateTextStyle(clip.id, { strokeColor: e.target.value })} style={{ height: 26, padding: 2 }} />
                      <input type="range" min="0" max="12" step="1" value={clip.textStyle?.strokeWidth ?? 0} onChange={(e) => edl.updateTextStyle(clip.id, { strokeWidth: Number(e.target.value) })} />
                      <span className="mini-note">{clip.textStyle?.strokeWidth ?? 0}</span>
                    </div>
                    <div className="row">
                      <label>底色</label>
                      <input type="color" value={clip.textStyle?.bgColor || '#000000'} onChange={(e) => edl.updateTextStyle(clip.id, { bgColor: e.target.value })} style={{ height: 26, padding: 2 }} />
                      <input type="range" min="0" max="100" step="1" value={Math.round((clip.textStyle?.bgOpacity ?? 0) * 100)} onChange={(e) => edl.updateTextStyle(clip.id, { bgOpacity: Number(e.target.value) / 100 })} />
                      <span className="mini-note">{Math.round((clip.textStyle?.bgOpacity ?? 0) * 100)}%</span>
                    </div>
                    <Slider label="X 位置" value={Math.round((clip.textStyle?.x ?? 0.5) * 100)} min={0} max={100} suffix="%" onChange={(v) => edl.updateTextStyle(clip.id, { x: v / 100 })} />
                    <Slider label="Y 位置" value={Math.round((clip.textStyle?.y ?? 0.86) * 100)} min={0} max={100} suffix="%" onChange={(v) => edl.updateTextStyle(clip.id, { y: v / 100 })} />
                    <Slider label="最大行宽" value={Math.round((clip.textStyle?.maxWidth ?? 0.86) * 100)} min={20} max={100} suffix="%" onChange={(v) => edl.updateTextStyle(clip.id, { maxWidth: v / 100 })} />
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
                    <button type="button" className="tool-tile" data-tip="音轨分离：原声拆成独立音频轨" onClick={() => edl.detachAudio(clip.id)}>
                      <Volume2 />音轨分离
                    </button>
                    <button type="button" className="tool-tile" data-tip="人声分离：拆出带人声标记的独立轨" onClick={() => {
                      const audioId = edl.detachAudio(clip.id);
                      if (!audioId) { toast.info('该画面已有独立原声轨'); return; }
                      edl.setClipText(audioId, `♪ 人声 · ${clip.text?.trim() || '对白'}`.slice(0, 120));
                      toast.success('已拆出独立人声轨');
                    }}>
                      <Sparkles />人声分离
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
                  <h4>运镜预设</h4>
                  <div className="grid2" style={{ marginTop: 8 }}>
                    <button type="button" className="mini-btn" onClick={() => setMotion({ scale: 1 }, { scale: 1.12 })}>推近</button>
                    <button type="button" className="mini-btn" onClick={() => setMotion({ scale: 1.12 }, { scale: 1 })}>拉远</button>
                    <button type="button" className="mini-btn" onClick={() => setMotion({ x: 0 }, { x: -0.06 })}>左移</button>
                    <button type="button" className="mini-btn" onClick={() => setMotion({ x: 0 }, { x: 0.06 })}>右移</button>
                    <button type="button" className="mini-btn" onClick={() => setMotion({ rotate: -2 }, { rotate: 2 })}>微旋</button>
                    <button type="button" className="mini-btn" onClick={() => setMotion({ y: 0.04, scale: 1.06 }, { y: -0.02, scale: 1.14 })}>呼吸</button>
                  </div>
                </section>
                <section className="section">
                  <h4>自动打点<span className="val">{autoRecord ? '开' : '关'}</span></h4>
                  <button
                    type="button"
                    className={`mini-btn${autoRecord ? ' on' : ''}`}
                    onClick={() => {
                      setAutoRecord(!autoRecord);
                      toast.success(autoRecord ? '自动打点已关闭：改运镜参数将整体调整动画' : '自动打点已开启：改运镜参数会在播放头自动落关键帧');
                    }}
                  >
                    {autoRecord ? '关闭自动打点' : '开启自动打点'}
                  </button>
                  <div className="mini-note" style={{ marginTop: 6 }}>
                    开启时拖动缩放 / 位移 / 旋转会在播放头自动落关键帧（覆盖同帧已有）；关闭后改的是整条动画的数值。菱形按钮与 ⌘K 手动打点不受影响。
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
