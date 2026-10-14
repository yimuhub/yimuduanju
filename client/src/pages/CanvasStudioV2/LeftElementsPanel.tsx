/**
 * 一木·YIMU AI 视频创作平台 画布 v2 —— 左侧「画布元素」列表（仿 Pavo 左栏）
 * 按类型分组列出画布上所有节点，点击聚焦；每类型带「+」快捷新建；底部资产/导演台入口
 */
import { useMemo } from 'react';
import { Plus, Eye, Focus } from 'lucide-react';
import { ELEMENTS_GROUPS, NODE_META_V2, PAVO_C, type PavoNodeData } from './pavoTypes';

interface Props {
  nodes: Array<{ id: string; data: PavoNodeData }>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAdd: (kind: PavoNodeData['kind']) => void;
  onFocus: (id: string) => void;
  open: boolean;
  onToggle: () => void;
}

const LeftElementsPanel = ({ nodes, selectedId, onSelect, onAdd, onFocus, open, onToggle }: Props) => {
  const groups = useMemo(
    () =>
      ELEMENTS_GROUPS.map((g) => ({
        ...g,
        items: nodes.filter((n) => g.kinds.includes(n.data.kind)),
      })),
    [nodes],
  );

  return (
    <>
      {/* 收起态：细条 */}
      {!open && (
        <div style={{ width: 44, borderRight: `1px solid ${PAVO_C.borderSoft}`, background: PAVO_C.panel, display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 10, gap: 4, flexShrink: 0 }}>
          <button onClick={onToggle} title="展开画布元素" style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#5E6B65', padding: 6 }}>
            <Eye size={16} />
          </button>
          {ELEMENTS_GROUPS.flatMap((g) => g.kinds).map((k) => (
            <button key={k} onClick={() => onAdd(k)} title={`新建${NODE_META_V2[k].label}节点`} style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 15, padding: 3 }}>
              {NODE_META_V2[k].emoji}
            </button>
          ))}
        </div>
      )}

      {/* 展开态 */}
      {open && (
        <div style={{ width: 208, borderRight: `1px solid ${PAVO_C.borderSoft}`, background: PAVO_C.panel, display: 'flex', flexDirection: 'column', flexShrink: 0, minHeight: 0 }}>
          <div style={{ padding: '12px 12px 8px', borderBottom: `1px solid ${PAVO_C.borderSoft}` }}>
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: PAVO_C.text }}>画布元素</span>
              <div style={{ flex: 1 }} />
              <button onClick={onToggle} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#8A948F', fontSize: 12 }}>«</button>
            </div>
            <div style={{ fontSize: 9, color: '#8A948F', marginTop: 2 }}>{nodes.length} 个节点 · 双击空白新建</div>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '8px 8px' }}>
            {groups.map((g) => (
              <div key={g.title} style={{ marginBottom: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 4px' }}>
                  <span style={{ fontSize: 9.5, fontWeight: 700, color: '#7C8782' }}>{g.title}</span>
                  <div style={{ flex: 1, height: 1, background: PAVO_C.borderSoft }} />
                  <span style={{ fontSize: 9, color: '#9AA4A0' }}>{g.items.length}</span>
                </div>
                {g.items.length === 0 && (
                  <div style={{ fontSize: 9, color: '#B0B8B3', padding: '3px 6px' }}>暂无节点</div>
                )}
                {g.items.map((n) => {
                  const m = NODE_META_V2[n.data.kind];
                  const sel = n.id === selectedId;
                  return (
                    <div
                      key={n.id}
                      onClick={() => onSelect(n.id)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 6, padding: '5px 7px', borderRadius: 8, cursor: 'pointer',
                        background: sel ? PAVO_C.primarySoft : 'transparent',
                        border: sel ? `1px solid rgba(31,169,126,0.3)` : '1px solid transparent', marginBottom: 2,
                      }}
                    >
                      <span style={{ fontSize: 13 }}>{m.emoji}</span>
                      <span style={{ flex: 1, fontSize: 10.5, color: sel ? PAVO_C.primaryDeep : '#3E4944', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {n.data.title || m.label}
                      </span>
                      {n.data.isAsset && <span style={{ fontSize: 8, color: PAVO_C.primary, fontWeight: 700 }}>资</span>}
                      <button onClick={(e) => { e.stopPropagation(); onFocus(n.id); }} title="聚焦" style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#9AA4A0', padding: 2 }}>
                        <Focus size={11} />
                      </button>
                    </div>
                  );
                })}
                {/* 快捷新建该组类型 */}
                <div style={{ display: 'flex', gap: 3, padding: '2px 4px' }}>
                  {g.kinds.map((k) => (
                    <button key={k} onClick={() => onAdd(k)} title={`新建${NODE_META_V2[k].label}`} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#9AA4A0', fontSize: 11, padding: 2, lineHeight: 1 }}>
                      <Plus size={10} />
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
};

export default LeftElementsPanel;
