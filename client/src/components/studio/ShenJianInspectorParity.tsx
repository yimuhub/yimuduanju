/**
 * 同构版右侧检查器。
 * 7 个主页签 + 画面下 4 个子页签；音频 / 变速是真实可写面板，
 * 画面 / 动画 / 调整复用经典检查器；跟踪、AI 效果与画面子页签明确标为待接入。
 */
import { useEffect, useMemo, useState } from 'react';
import {
  AudioLines,
  ChevronRight,
  CircleDashed,
  Gauge,
  Image as ImageIcon,
  RotateCcw,
  ScanEye,
  SlidersHorizontal,
  Sparkles,
  Wand2,
} from 'lucide-react';
import { toast } from 'sonner';
import { ShenJianInspector } from './ShenJianInspectorV2';
import { useStudio } from './StudioShell';
import { useEdl } from './EdlContext';
import { clipSpan } from './model';

type Grade = { brightness: number; contrast: number; saturation: number; filter: string };
type MainTab = 'frame' | 'audio' | 'speed' | 'anim' | 'tracking' | 'adjust' | 'ai';
type SubTab = 'basic' | 'keying' | 'mask' | 'beauty';

const MAIN_TABS: Array<[MainTab, string, React.ReactNode]> = [
  ['frame', '画面', <ImageIcon key="frame" />],
  ['audio', '音频', <AudioLines key="audio" />],
  ['speed', '变速', <Gauge key="speed" />],
  ['anim', '动画', <Sparkles key="anim" />],
  ['tracking', '跟踪', <ScanEye key="tracking" />],
  ['adjust', '调整', <SlidersHorizontal key="adjust" />],
  ['ai', 'AI效果', <Wand2 key="ai" />],
];

const SUB_TABS: Array<[SubTab, string]> = [
  ['basic', '基础'],
  ['keying', '抠像'],
  ['mask', '蒙版'],
  ['beauty', '美容美体'],
];

const SUB_COPY: Record<Exclude<SubTab, 'basic'>, { title: string; body: string; fallback: string }> = {
  keying: {
    title: '抠像尚未接入同构版',
    body: '当前没有色度键 / 智能抠像面板。经典版也没有独立抠像入口，画面处理仍通过画中画、透明度与调色完成。',
    fallback: '可先用「画面 · 基础」里的位置、缩放、混合模式做替代。',
  },
  mask: {
    title: '蒙版尚未接入同构版',
    body: '当前没有线性 / 圆形 / 羽化蒙版面板。时间线片段与 EDL 数据结构已保留，后续可直接加蒙版字段而不改轨道。',
    fallback: '可先用「画面 · 基础」里的圆角、缩放与位置做近似。',
  },
  beauty: {
    title: '美容美体尚未接入同构版',
    body: '当前没有磨皮、瘦脸、美体参数。现有能力集中在画面变换、调色、字幕与关键帧。',
    fallback: '可先用「调整」页的亮度 / 对比度 / 饱和度做基础校正。',
  },
};

const PENDING: Partial<Record<MainTab, { title: string; body: string; fallback: string }>> = {
  tracking: {
    title: '目标跟踪尚未接入同构版',
    body: '当前只有手动关键帧运镜（画面 / 动画），没有对人物、物体或点的自动跟踪。',
    fallback: '可先在「动画」页给片段加关键帧，做推近、拉远、左右移。',
  },
  ai: {
    title: 'AI 效果库尚未接入同构版',
    body: '当前没有一键 AI 特效、风格迁移、智能改色面板；AI 能力仍通过对话提案与确认门完成，不直接改时间线。',
    fallback: '可回到对话面板描述想要的风格，由 Agent 出提案后确认。',
  },
};

const clipName = (clip: { text?: string | null; sourceUrl?: string | null; track?: string; id: string }) => {
  if (clip.text) return clip.text;
  const file = (clip.sourceUrl || '').split('/').pop() || '';
  if (file) return decodeURIComponent(file);
  return clip.track === 'audio' ? '音频片段' : '时间线片段';
};

const ParSlider = ({
  label,
  value,
  min,
  max,
  step = 1,
  suffix = '',
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  onChange: (v: number) => void;
}) => (
  <div className="parity-field">
    <label>{label}</label>
    <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    <span className="parity-field-val">{value}{suffix}</span>
  </div>
);

export const ShenJianInspectorParity = ({
  grade,
  setGrade,
}: {
  grade: Grade;
  setGrade: (patch: Partial<Grade>) => void;
}) => {
  const { data } = useStudio();
  const edl = useEdl();
  const [tab, setTab] = useState<MainTab>('frame');
  const [sub, setSub] = useState<SubTab>('basic');

  const selected = useMemo(
    () => (data.timeline?.clips ?? []).find((c) => edl.selectedIds.includes(c.id)) ?? null,
    [data.timeline?.clips, edl.selectedIds],
  );

  useEffect(() => {
    const target = tab === 'anim' ? 'anim' : tab === 'adjust' ? 'color' : 'basic';
    window.dispatchEvent(new CustomEvent('yimu:shenjian-inspector-tab', { detail: target }));
  }, [tab]);

  // 时间线快捷条「变速」等入口可把检查器直接切到对应页签
  useEffect(() => {
    const onMain = (e: Event) => {
      const d = (e as CustomEvent).detail as MainTab;
      if (['frame', 'audio', 'speed', 'anim', 'tracking', 'adjust', 'ai', 'key', 'beauty'].includes(d)) setTab(d);
    };
    window.addEventListener('yimu:shenjian-inspector-main', onMain);
    return () => window.removeEventListener('yimu:shenjian-inspector-main', onMain);
  }, []);

  const showClassic = tab === 'frame' || tab === 'anim' || tab === 'adjust';
  const subPending = tab === 'frame' && sub !== 'basic' ? SUB_COPY[sub] : null;
  const mainPending = PENDING[tab] ?? null;
  const volume = Math.round((selected?.volume ?? 1) * 100);
  const pitch = Math.round((selected?.pitch ?? 1) * 100) / 100;
  const speed = selected?.speed ?? 1;
  const span = selected ? clipSpan(selected) : 0;

  const resetAll = () => {
    setGrade({ brightness: 100, contrast: 100, saturation: 100, filter: 'none' });
    if (selected) {
      edl.setClipVolume(selected.id, 1);
      edl.setClipPitch(selected.id, 1);
      edl.setClipSpeed(selected.id, 1);
    }
    toast.success('已重置当前参数');
  };

  return (
    <aside className="inspector parity-inspector">
      <div className="parity-insp-tabs">
        {MAIN_TABS.map(([key, label, icon]) => (
          <button
            key={key}
            type="button"
            className={tab === key ? 'on' : ''}
            onClick={() => setTab(key)}
            title={key === 'frame' ? '画面：基础变换与片段属性' : label}
          >
            {icon}
            <span>{label}</span>
          </button>
        ))}
      </div>

      {tab === 'frame' ? (
        <div className="parity-insp-subtabs">
          {SUB_TABS.map(([key, label]) => (
            <button key={key} type="button" className={sub === key ? 'on' : ''} onClick={() => setSub(key)}>
              {label}
            </button>
          ))}
        </div>
      ) : <div className="parity-insp-subplaceholder" />}

      <div className="parity-ins-head">
        <span className="parity-selected-tag">已选中：<b>{selected ? clipName(selected) : '无片段'}</b></span>
        <button type="button" className="parity-reset" title="重置画面调节 / 音量 / 音高 / 速度" onClick={resetAll}>
          <RotateCcw />
        </button>
      </div>

      <div className="parity-insp-body">
        {subPending ? (
          <div className="parity-pending">
            <div className="parity-pending-icon"><CircleDashed /></div>
            <b>{subPending.title}</b>
            <p>{subPending.body}</p>
            <div className="parity-pending-tip">{subPending.fallback}</div>
            <button type="button" className="mini-btn" onClick={() => setSub('basic')}>
              回到画面 · 基础 <ChevronRight size={11} />
            </button>
          </div>
        ) : mainPending ? (
          <div className="parity-pending">
            <div className="parity-pending-icon"><Sparkles /></div>
            <b>{mainPending.title}</b>
            <p>{mainPending.body}</p>
            <div className="parity-pending-tip">{mainPending.fallback}</div>
            <button type="button" className="mini-btn" onClick={() => setTab(tab === 'tracking' ? 'anim' : 'frame')}>
              去{tab === 'tracking' ? '动画' : '画面'}页继续 <ChevronRight size={11} />
            </button>
          </div>
        ) : !selected ? (
          <div className="parity-insp-empty">
            <div className="parity-empty-ico"><ScanEye /></div>
            <b>还没有选中片段</b>
            <p>在底部时间线点一下任意片段，这里会显示它的时间、变换、音量、变速与字幕。</p>
            <div className="parity-empty-keys">
              <span>E 分割</span><span>Q 删前</span><span>W 删后</span><span>空格播放</span>
            </div>
          </div>
        ) : tab === 'audio' ? (
          <div className="parity-panel">
            <section className="parity-group">
              <h4>音量 <span className="parity-group-val">{volume}%</span></h4>
              <ParSlider label="音量" value={volume} min={0} max={200} suffix="%" onChange={(v) => edl.setClipVolume(selected.id, v / 100)} />
              <div className="parity-inline">
                <button type="button" className="parity-mini" onClick={() => edl.setClipVolume(selected.id, 0)}>静音</button>
                <button type="button" className="parity-mini" onClick={() => edl.setClipVolume(selected.id, 1)}>100%</button>
                <button type="button" className="parity-mini" onClick={() => edl.setClipVolume(selected.id, 2)}>200%</button>
              </div>
            </section>
            <section className="parity-group">
              <h4>音色</h4>
              <ParSlider label="音高" value={Math.round(pitch * 100)} min={50} max={200} suffix="%" onChange={(v) => edl.setClipPitch(selected.id, v / 100)} />
              <div className="parity-inline">
                <button type="button" className="parity-mini" onClick={() => edl.setClipPitch(selected.id, 0.8)}>低沉</button>
                <button type="button" className="parity-mini" onClick={() => edl.setClipPitch(selected.id, 1)}>原音</button>
                <button type="button" className="parity-mini" onClick={() => edl.setClipPitch(selected.id, 1.25)}>明亮</button>
              </div>
            </section>
            <section className="parity-group">
              <h4>片段</h4>
              <div className="parity-inline">
                <button type="button" className={`parity-mini${selected.reverse ? ' on' : ''}`} onClick={() => edl.toggleClipReverse(selected.id)}>
                  {selected.reverse ? '取消倒放' : '倒放'}
                </button>
                <button type="button" className="parity-mini" onClick={() => edl.setClipVolume(selected.id, 1)}>恢复默认</button>
              </div>
              <div className="parity-hint">音量、音高与倒放都会同步到预览和导出；负值/超限由后端统一夹紧。</div>
            </section>
          </div>
        ) : tab === 'speed' ? (
          <div className="parity-panel">
            <section className="parity-group">
              <h4>常规变速 <span className="parity-group-val">{speed.toFixed(2)}× · {span.toFixed(2)}s</span></h4>
              <ParSlider label="速度" value={speed} min={0.25} max={4} step={0.05} suffix="×" onChange={(v) => edl.setClipSpeed(selected.id, v)} />
              <div className="parity-speed-presets">
                {[0.5, 1, 1.5, 2, 3].map((v) => (
                  <button key={v} type="button" className={Math.abs(speed - v) < 0.001 ? 'on' : ''} onClick={() => edl.setClipSpeed(selected.id, v)}>
                    {v}×
                  </button>
                ))}
              </div>
              <div className="parity-inline">
                <button type="button" className="parity-mini" onClick={() => edl.setClipSpeed(selected.id, 1)}>恢复 1×</button>
                <button type="button" className={`parity-mini${selected.reverse ? ' on' : ''}`} onClick={() => edl.toggleClipReverse(selected.id)}>
                  {selected.reverse ? '取消倒放' : '倒放'}
                </button>
              </div>
            </section>
            <section className="parity-group">
              <h4>时间</h4>
              <div className="parity-kv"><span>开始</span><b>{selected.timelineStart.toFixed(2)}s</b></div>
              <div className="parity-kv"><span>结束</span><b>{(selected.timelineStart + span).toFixed(2)}s</b></div>
              <div className="parity-hint">变速后同轨后续片段会自动平移，不会留下空隙。</div>
            </section>
          </div>
        ) : showClassic ? (
          <ShenJianInspector grade={grade} setGrade={setGrade} />
        ) : null}
      </div>

      <div className="parity-insp-foot">
        <span>同构版</span>
        <span className="grow" />
        <span>{showClassic ? '复用真实 EDL 控件' : tab === 'audio' || tab === 'speed' ? '真实可写参数' : '占位页 · 不写入数据'}</span>
      </div>
    </aside>
  );
};

export default ShenJianInspectorParity;
