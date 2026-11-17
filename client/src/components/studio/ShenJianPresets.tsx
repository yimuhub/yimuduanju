/**
 * 一幕·神剪 · 左侧非素材类真实面板
 * 文本/字幕/贴纸：直接写入字幕轨（预览与烧录同一份数据）
 * 特效/滤镜/调节：直接改舞台预览的画面处理
 * 转场：写入当前选中片段的 transition 字段
 */
import { useState } from 'react';
import { Blend, Droplets, Flame, Sparkles, Star, Sun, Wand2 } from 'lucide-react';
import { toast } from 'sonner';
import { useStudio } from './StudioShell';
import { useEdl } from './EdlContext';

type PresetRail = 'text' | 'sticker' | 'effect' | 'transition' | 'caption' | 'filter' | 'adjust';

type TextStyle = {
  fontSize?: number;
  color?: string;
  bold?: boolean;
  italic?: boolean;
  strokeColor?: string;
  strokeWidth?: number;
  bgColor?: string;
  bgOpacity?: number;
  x?: number;
  y?: number;
};

const TEXT_PRESETS: { name: string; text: string; style: TextStyle; hint: string }[] = [
  { name: '基础字幕', text: '在这里输入字幕', style: { fontSize: 7, color: '#ffffff', y: 0.86 }, hint: '底部居中，适合对白' },
  { name: '大标题', text: '标题文字', style: { fontSize: 8, bold: true, color: '#ffffff', y: 0.16 }, hint: '画面上方主标题' },
  { name: '花字', text: '重点花字', style: { fontSize: 8, bold: true, color: '#ffe27a', strokeColor: '#7a3c00', strokeWidth: 0.06, y: 0.55 }, hint: '描边强调，适合综艺' },
  { name: '对白', text: '角色对白', style: { fontSize: 7, color: '#ffffff', bgColor: '#000000', bgOpacity: 0.45, y: 0.88 }, hint: '半透明底，口播清晰' },
  { name: '旁白', text: '旁白文字', style: { fontSize: 8, italic: true, color: '#ffe8b0', y: 0.78 }, hint: '斜体叙事旁白' },
  { name: '片尾署名', text: '一幕 · AI 精品短剧', style: { fontSize: 6, color: '#ffffff', y: 0.94 }, hint: '片尾落款' },
];

const STICKERS: { name: string; glyph: string; color: string }[] = [
  { name: '星星', glyph: '✦', color: '#ffe27a' },
  { name: '爱心', glyph: '♥', color: '#ff6b7a' },
  { name: '火焰', glyph: '🔥', color: '#ff9b45' },
  { name: '闪光', glyph: '✧', color: '#9ff5ff' },
  { name: '对勾', glyph: '✓', color: '#69e0bd' },
  { name: '问号', glyph: '?', color: '#ffdf6b' },
  { name: '感叹', glyph: '!', color: '#ff8f88' },
  { name: '箭头', glyph: '➜', color: '#ffffff' },
];

const FILTERS: { name: string; filter: string; note: string }[] = [
  { name: '原片', filter: 'none', note: '不处理' },
  { name: '电影感', filter: 'cinematic', note: '暖暗对比' },
  { name: '暖调', filter: 'warm', note: '夕阳肤色' },
  { name: '冷调', filter: 'cool', note: '雨夜蓝灰' },
  { name: '清晰', filter: 'sharp', note: '提高对比' },
  { name: '褪色', filter: 'fade', note: '低饱和胶片' },
];

const EFFECTS: { name: string; filter: string; brightness?: number; contrast?: number; saturation?: number; icon: React.ReactNode; note: string }[] = [
  { name: '柔光', filter: 'soft', brightness: 108, contrast: 92, icon: <Sun />, note: '人像柔光' },
  { name: '黑金', filter: 'warm', brightness: 94, contrast: 122, saturation: 88, icon: <Flame />, note: '夜景高级感' },
  { name: '冷雨', filter: 'cool', brightness: 96, contrast: 108, saturation: 76, icon: <Droplets />, note: '雨夜冷色' },
  { name: '高能', filter: 'sharp', brightness: 104, contrast: 128, saturation: 118, icon: <Sparkles />, note: '爽点节奏' },
  { name: '回忆', filter: 'fade', brightness: 106, contrast: 88, saturation: 64, icon: <Wand2 />, note: '回忆插叙' },
  { name: '双重曝光', filter: 'cinematic', brightness: 100, contrast: 105, saturation: 90, icon: <Blend />, note: '叠化氛围' },
];

const TRANSITIONS: { name: string; type: 'none' | 'crossfade' | 'fade'; note: string }[] = [
  { name: '无转场', type: 'none', note: '硬切' },
  { name: '叠化', type: 'crossfade', note: '0.5s 交叉溶解' },
  { name: '淡入淡出', type: 'fade', note: '0.5s 黑场过渡' },
];

export const ShenJianPresets = ({ rail }: { rail: PresetRail }) => {
  const { curT, data } = useStudio();
  const edl = useEdl();
  const [text, setText] = useState('在这里输入字幕');
  const [grade, setGrade] = useState({ brightness: 100, contrast: 100, saturation: 100, filter: 'none' });

  const selectedId = edl.selectedIds[edl.selectedIds.length - 1];
  const selected = (data.timeline?.clips ?? []).find((c) => c.id === selectedId) ?? null;

  const applyGrade = (patch: Partial<typeof grade>) => {
    const next = { ...grade, ...patch };
    setGrade(next);
    // 落库到画面轨 grade：预览与导出共用同一份，不再只是前端滤镜
    const videoLane = selected?.track === 'video' ? selected.lane ?? 0 : 0;
    edl.updateTrack('video', videoLane, { grade: next });
    window.dispatchEvent(new CustomEvent('yimu:shenjian-grade', { detail: next }));
  };

  const addText = (content: string, style: TextStyle, label = '文本') => {
    const id = edl.addSubtitle(Math.max(0, curT), 0, content, style);
    if (!id) {
      toast.error('请先打开项目时间线');
      return;
    }
    edl.setSelection([id]);
    toast.success(`已添加${label}到时间线`);
  };

  const addSticker = (glyph: string, color: string) => {
    const id = edl.addSubtitle(Math.max(0, curT), 1, glyph, { fontSize: 22, color, bold: true, x: 0.78, y: 0.36 });
    if (!id) return;
    edl.setSelection([id]);
    toast.success('贴纸已加入时间线，可拖动改变位置时间');
  };

  if (rail === 'text' || rail === 'caption') {
    return (
      <div className="preset-panel">
        <div className="preset-section-title">输入文字</div>
        <textarea className="sj2-textarea" value={text} onChange={(e) => setText(e.target.value)} placeholder="输入标题 / 字幕 / 对白" />
        <button type="button" className="preset-add" onClick={() => addText(text, { fontSize: 8, color: '#ffffff', y: 0.8 }, '文本')}>
          <Sparkles /> 添加到时间线
        </button>
        <div className="preset-section-title">文字模板</div>
        <div className="preset-list">
          {TEXT_PRESETS.map((p) => (
            <button type="button" className="preset-row" key={p.name} onClick={() => addText(p.text, p.style, p.name)}>
              <span className="preset-sample" style={{ color: p.style.color, fontWeight: p.style.bold ? 700 : 400 }}>{p.name}</span>
              <span className="preset-note">{p.hint}</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (rail === 'sticker') {
    return (
      <div className="preset-panel">
        <div className="preset-section-title">贴纸 / 贴图</div>
        <div className="sticker-grid">
          {STICKERS.map((s) => (
            <button type="button" key={s.name} className="sticker-tile" onClick={() => addSticker(s.glyph, s.color)}>
              <b style={{ color: s.color }}>{s.glyph}</b>
              <span>{s.name}</span>
            </button>
          ))}
        </div>
        <div className="insp-empty" style={{ padding: '10px 2px' }}>
          贴纸以字幕图层写入，预览与导出共用同一条数据；选中后可改位置、字号与时间。
        </div>
      </div>
    );
  }

  if (rail === 'effect') {
    return (
      <div className="preset-panel">
        <div className="preset-section-title">画面特效</div>
        <div className="effect-grid">
          {EFFECTS.map((e) => (
            <button
              type="button"
              key={e.name}
              className="effect-tile"
              onClick={() => applyGrade({ filter: e.filter, brightness: e.brightness ?? 100, contrast: e.contrast ?? 100, saturation: e.saturation ?? 100 })}
            >
              <span className="effect-ico">{e.icon}</span>
              <b>{e.name}</b>
              <em>{e.note}</em>
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (rail === 'filter') {
    return (
      <div className="preset-panel">
        <div className="preset-section-title">滤镜</div>
        <div className="preset-list">
          {FILTERS.map((f) => (
            <button type="button" className="preset-row" key={f.name} onClick={() => applyGrade({ filter: f.filter })}>
              <span className="preset-sample">{f.name}</span>
              <span className="preset-note">{f.note}</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (rail === 'transition') {
    return (
      <div className="preset-panel">
        <div className="preset-section-title">转场</div>
        {!selected ? <div className="insp-empty" style={{ padding: '8px 2px' }}>先在时间线选中一个画面片段，再选择转场。</div> : null}
        <div className="preset-list">
          {TRANSITIONS.map((t) => (
            <button
              type="button"
              className={`preset-row${selected?.transition?.type === t.type ? ' on' : ''}`}
              key={t.name}
              disabled={!selected}
              onClick={() => {
                if (!selected) return;
                edl.setClipTransition(selected.id, t.type === 'none' ? { type: 'none', duration: 0 } : { type: t.type, duration: 0.5 });
                toast.success(`已应用${t.name}：${t.note}`);
              }}
            >
              <span className="preset-sample">{t.name}</span>
              <span className="preset-note">{t.note}</span>
            </button>
          ))}
        </div>
        <div className="preset-section-title">转场时长</div>
        <div className="preset-caption">叠化 / 淡入淡出固定 0.5s，与导出转场计划一致。</div>
      </div>
    );
  }

  return (
    <div className="preset-panel">
      <div className="preset-section-title">基础调节</div>
      {[
        ['亮度', 'brightness', 40, 160],
        ['对比度', 'contrast', 40, 160],
        ['饱和度', 'saturation', 0, 200],
      ].map(([label, key, min, max]) => (
        <div className="row" key={key}>
          <label>{label}</label>
          <input
            type="range"
            min={Number(min)}
            max={Number(max)}
            value={grade[key as 'brightness' | 'contrast' | 'saturation']}
            onChange={(e) => applyGrade({ [key]: Number(e.target.value) } as Partial<typeof grade>)}
          />
          <span className="mini-note" style={{ width: 36, textAlign: 'right' }}>{grade[key as 'brightness' | 'contrast' | 'saturation']}</span>
        </div>
      ))}
      <button type="button" className="preset-add" onClick={() => applyGrade({ brightness: 100, contrast: 100, saturation: 100, filter: 'none' })}>
        <Star /> 恢复默认
      </button>
    </div>
  );
};

export default ShenJianPresets;
