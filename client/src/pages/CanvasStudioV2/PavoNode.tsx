/**
 * 一木·YIMU AI 视频创作平台 画布 v2 —— Pavo 式节点卡片
 * 浅白极简 + 淡青边框 + 左右各一个「+」端口 + 内容预览（图/四视图/文本/视频）
 */
import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Sparkles, Loader, Play } from 'lucide-react';
import { NODE_META_V2, PAVO_C, pavoSummary, type PavoNodeData } from './pavoTypes';

export type PavoCardData = PavoNodeData & {
  __onOpenTools?: (id: string) => void;
};

const HANDLE: React.CSSProperties = {
  width: 15, height: 15, borderRadius: '50%', background: '#fff',
  border: `2px solid ${PAVO_C.primary}`, color: PAVO_C.primary,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  fontSize: 10.5, lineHeight: '12px', fontWeight: 700, cursor: 'crosshair',
  boxShadow: '0 1px 3px rgba(0,0,0,0.14)',
};

const PavoNode = memo((props: NodeProps) => {
  const data = props.data as PavoCardData;
  const meta = NODE_META_V2[data.kind] || NODE_META_V2.text;
  const generating = !!data.generating;
  const url = data.values?.url as string | undefined;

  const renderBody = () => {
    // 视频
    if (data.kind === 'video') {
      return (
        <div style={{ marginTop: 6, height: 72, borderRadius: 8, background: 'linear-gradient(135deg,#17332A,#1FA97E)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.9)' }}>
          <div style={{ width: 30, height: 30, borderRadius: '50%', background: 'rgba(255,255,255,0.92)', color: '#17332A', display: 'flex', alignItems: 'center', justifyContent: 'center', paddingLeft: 2 }}>
            <Play size={13} fill="currentColor" />
          </div>
        </div>
      );
    }
    // 图片 / 角色 / 场景（含四视图/全景）
    if (data.hasImage || data.kind === 'image' || data.kind === 'character' || data.kind === 'scene') {
      const src = url || pavoDemoInline(data.seed, data.title || meta.label);
      return (
        <img src={src} alt="" style={{ width: '100%', height: data.kind === 'character' && !url ? 104 : 84, objectFit: 'cover', borderRadius: 8, marginTop: 6, display: 'block', background: '#EEF4F1' }} />
      );
    }
    // 3D 导演台
    if (data.kind === 'director') {
      return (
        <div style={{ marginTop: 6, height: 64, borderRadius: 8, background: '#E9F5F0', border: '1px dashed rgba(31,169,126,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          {['🎥', '🚶', '🎬'].map((e, i) => <span key={i} style={{ fontSize: 18 }}>{e}</span>)}
        </div>
      );
    }
    // 文本/剧本/分镜/音频/备注
    const s = pavoSummary(data);
    return (
      <div style={{ fontSize: 10, color: '#4A5550', lineHeight: 1.55, marginTop: 6, minHeight: 24, maxHeight: 44, overflow: 'hidden', whiteSpace: 'pre-wrap' }}>
        {s || <span style={{ color: '#A6B0AB' }}>点击节点，使用 AI 工具生成…</span>}
      </div>
    );
  };

  return (
    <div
      onClick={(e) => { e.stopPropagation(); data.__onOpenTools?.(props.id); }}
      style={{
        width: meta.width, background: PAVO_C.panel, borderRadius: 12, padding: '9px 11px',
        border: `1.5px solid ${props.selected ? PAVO_C.primary : PAVO_C.borderSoft}`,
        boxShadow: props.selected ? `0 0 0 3px rgba(31,169,126,0.14), 0 4px 14px rgba(15,45,35,0.10)` : '0 1px 6px rgba(15,45,35,0.05)',
        fontFamily: "'Roboto','PingFang SC','Segoe UI',Arial,sans-serif",
        cursor: 'pointer', transition: 'box-shadow .15s, border-color .15s',
      }}
    >
      <Handle id="in" type="target" position={Position.Left} style={{ ...HANDLE, top: '50%' }}><span style={{ position: 'relative', top: -0.5 }}>+</span></Handle>
      <Handle id="out" type="source" position={Position.Right} style={{ ...HANDLE, top: '50%' }}><span style={{ position: 'relative', top: -0.5 }}>+</span></Handle>

      {/* 头部 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 15 }}>{meta.emoji}</span>
        <span style={{ fontSize: 12, fontWeight: 600, color: PAVO_C.text, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {data.title || meta.label}
        </span>
        {data.isAsset && (
          <span style={{ fontSize: 8, fontWeight: 700, color: PAVO_C.primary, padding: '1px 6px', borderRadius: 999, background: PAVO_C.primarySoft }}>资产</span>
        )}
        <span style={{ fontSize: 8, color: '#7C8782', padding: '1px 6px', borderRadius: 999, background: '#F2F5F4' }}>{meta.label}</span>
      </div>

      {/* 主体 */}
      {generating ? (
        <div style={{ marginTop: 8, padding: '10px 0', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Loader size={13} color={PAVO_C.primary} style={{ animation: 'yimuSpin 0.8s linear infinite' }} />
          <span style={{ fontSize: 10, color: '#4A5550' }}>AI 生成中…</span>
        </div>
      ) : renderBody()}

      {/* 底部：AI 工具提示（Pavo：点击节点弹工具箱） */}
      <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 4, padding: '4px 8px', borderRadius: 8, background: '#F2F7F5', border: '1px solid rgba(31,169,126,0.18)' }}>
        <Sparkles size={10} color={PAVO_C.primary} />
        <span style={{ fontSize: 9, color: PAVO_C.primaryDeep, fontWeight: 600 }}>点击使用 AI 工具</span>
      </div>
    </div>
  );
});

/** 节点内联演示图（无 URL 时按 seed 生成青绿渐变） */
function pavoDemoInline(seed: string, label: string): string {
  const colors: Array<[string, string]> = [
    ['#1FA97E', '#7FD9BC'], ['#178A66', '#6FCFAE'], ['#2F9E7F', '#94D8C3'], ['#4AC2A1', '#A9E8D4'],
  ];
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 997;
  const [c1, c2] = colors[h % colors.length];
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='400' height='520'>` +
    `<defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>` +
    `<stop offset='0' stop-color='${c1}'/><stop offset='1' stop-color='${c2}'/>` +
    `</linearGradient></defs><rect width='400' height='520' fill='url(#g)'/>` +
    `<text x='200' y='255' text-anchor='middle' font-size='20' fill='rgba(255,255,255,0.94)' font-family='sans-serif'>${label}</text>` +
    `<text x='200' y='292' text-anchor='middle' font-size='11' fill='rgba(255,255,255,0.75)' font-family='sans-serif'>演示资产 · 待接入 API</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export default PavoNode;
