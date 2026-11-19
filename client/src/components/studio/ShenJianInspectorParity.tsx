/**
 * 同构版右侧检查器：
 * - 7 个主页签（画面 / 音频 / 变速 / 动画 / 跟踪 / 调整 / AI 效果）
 * - 画面下 4 个子页签（基础 / 抠像 / 蒙版 / 美容美体）
 * - 有现有能力的页签直接复用经典检查器；没有能力的页签明确标为“待接入”，
 *   不伪装成已实现，方便和经典版逐项对照。
 */
import { useEffect, useState } from 'react';
import { ChevronRight, CircleDashed, Sparkles } from 'lucide-react';
import { ShenJianInspector } from './ShenJianInspectorV2';

type Grade = { brightness: number; contrast: number; saturation: number; filter: string };
type MainTab = 'frame' | 'audio' | 'speed' | 'anim' | 'tracking' | 'adjust' | 'ai';
type SubTab = 'basic' | 'keying' | 'mask' | 'beauty';

const MAIN_TABS: Array<[MainTab, string]> = [
  ['frame', '画面'],
  ['audio', '音频'],
  ['speed', '变速'],
  ['anim', '动画'],
  ['tracking', '跟踪'],
  ['adjust', '调整'],
  ['ai', 'AI效果'],
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

export const ShenJianInspectorParity = ({
  grade,
  setGrade,
}: {
  grade: Grade;
  setGrade: (patch: Partial<Grade>) => void;
}) => {
  const [tab, setTab] = useState<MainTab>('frame');
  const [sub, setSub] = useState<SubTab>('basic');

  // 复用经典检查器时，把它切到对应的既有页签。
  useEffect(() => {
    const target = tab === 'anim' ? 'anim' : tab === 'adjust' ? 'color' : 'basic';
    window.dispatchEvent(new CustomEvent('yimu:shenjian-inspector-tab', { detail: target }));
  }, [tab]);

  const showClassic = tab === 'frame' || tab === 'audio' || tab === 'speed' || tab === 'anim' || tab === 'adjust';
  const subPending = tab === 'frame' && sub !== 'basic' ? SUB_COPY[sub] : null;
  const mainPending = PENDING[tab] ?? null;

  return (
    <aside className="inspector parity-inspector">
      <div className="parity-insp-tabs">
        {MAIN_TABS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={tab === key ? 'on' : ''}
            onClick={() => setTab(key)}
            title={key === 'frame' ? '画面：基础变换与片段属性' : label}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'frame' ? (
        <div className="parity-insp-subtabs">
          {SUB_TABS.map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={sub === key ? 'on' : ''}
              onClick={() => setSub(key)}
            >
              {label}
            </button>
          ))}
        </div>
      ) : <div className="parity-insp-subplaceholder" />}

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
        ) : showClassic ? (
          <ShenJianInspector grade={grade} setGrade={setGrade} />
        ) : null}
      </div>

      <div className="parity-insp-foot">
        <span>同构版</span>
        <span className="grow" />
        <span>{showClassic ? '复用真实 EDL 控件' : '占位页 · 不写入数据'}</span>
      </div>
    </aside>
  );
};

export default ShenJianInspectorParity;
