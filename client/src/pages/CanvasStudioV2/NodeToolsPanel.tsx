/**
 * 一幕·YIMU AI 短剧创作平台 画布 v2 —— 节点即工具箱（Pavo 核心交互）
 * 点击节点 → 弹出该节点类型专属的 Agent 工具菜单 → 选工具 → 输入提示词 → 生成新节点分支
 * 融合小云雀 @ 引用：输入框 @ 唤起资产/画布素材选择
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { X, Sparkles, AtSign, Wand2, ChevronRight } from 'lucide-react';
import { NODE_META_V2, PAVO_C, type PavoNodeData } from './pavoTypes';

export interface ToolInvocation {
  toolId: string;
  prompt: string;
  /** @ 引用资产节点 id 列表 */
  refs: string[];
}

interface Props {
  node: PavoNodeData | null;
  nodeId: string | null;
  /** 画布上可作为 @ 引用来源的节点（资产/图片/文本等） */
  referable: Array<{ id: string; title: string; emoji: string }>;
  onInvoke: (toolId: string, prompt: string, refs: string[]) => void;
  onClose: () => void;
  busy: boolean;
}

const NodeToolsPanel = ({ node, nodeId, referable, onInvoke, onClose, busy }: Props) => {
  const [toolId, setToolId] = useState<string | null>(null);
  const [prompt, setPrompt] = useState('');
  const [showRefs, setShowRefs] = useState(false);
  const [pickedRefs, setPickedRefs] = useState<string[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setToolId(null);
    setPrompt('');
    setPickedRefs([]);
    setShowRefs(false);
    setEditing(null);
  }, [nodeId]);

  useEffect(() => {
    if (toolId && inputRef.current) inputRef.current.focus();
  }, [toolId]);

  const meta = node ? NODE_META_V2[node.kind] : null;
  const activeTool = meta?.tools.find((t) => t.id === toolId) || null;

  const placeholders: Record<string, string> = {
    'write': '输入文本内容…',
    'gen-script': '输入一句话故事，AI 展开为完整剧本…',
    'text2img': '描述画面内容、风格、景别…',
    'text2video': '描述镜头内容、运镜、动作…',
    'img2img': '描述在图基础上要做的改动…',
    'char-set': '描述角色外貌、服装、气质…',
    'char-fourview': '描述角色外貌，生成四视图锁定一致性…',
    'scene-set': '描述场景氛围、时代、光线…',
    'panorama': '描述场景，生成 720° 全景…',
    'product-set': '描述道具/产品…',
    'storyboard2img': '描述关键帧画面…',
    'storyboard2video': '描述镜头动态…',
    'script2storyboard': '粘贴剧本，自动拆解分镜…',
    'gen-script-auto': '输入故事创意…',
    'regenerate': '描述想要修正的方向…',
    'voice': '输入台词…',
    'bgm': '描述情绪/风格…',
    'sfx': '描述音效场景…',
    'reverse-prompt': '描述图片内容…',
    'open-director': '打开 3D 导演台摆位',
    'pick-asset': '从资产库选择引用…',
    'edit-note': '输入备注内容…',
  };

  const refLabel = useMemo(() => {
    if (!pickedRefs.length) return null;
    const names = pickedRefs.map((id) => {
      const r = referable.find((x) => x.id === id);
      return r ? `${r.emoji}${r.title}` : id.slice(0, 6);
    });
    return names.join('、');
  }, [pickedRefs, referable]);

  const invoke = () => {
    if (!toolId) return;
    onInvoke(toolId, prompt.trim(), pickedRefs);
  };

  if (!node || !meta) return null;

  return (
    <div
      data-yimu-panel
      style={{
        position: 'fixed', right: 12, top: 12, bottom: 12, zIndex: 280, width: 348,
        display: 'flex', flexDirection: 'column', background: PAVO_C.panel,
        borderRadius: 14, border: `1px solid ${PAVO_C.border}`, boxShadow: '0 10px 40px rgba(15,45,35,0.14)',
        fontFamily: "'Roboto','PingFang SC','Segoe UI',Arial,sans-serif", overflow: 'hidden',
      }}
    >
      {/* 头部 */}
      <div style={{ padding: '11px 14px', borderBottom: `1px solid ${PAVO_C.borderSoft}`, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 20 }}>{meta.emoji}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: PAVO_C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{node.title || meta.label}</div>
            <div style={{ fontSize: 9.5, color: '#7C8782' }}>{meta.fullName} · 点击工具让 AI 协助生成</div>
          </div>
          <button onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#8A948F' }}><X size={16} /></button>
        </div>
      </div>

      {/* 工具列表（节点即工具箱） */}
      <div style={{ padding: '10px 12px', borderBottom: `1px solid ${PAVO_C.borderSoft}`, flexShrink: 0, maxHeight: 168, overflowY: 'auto' }}>
        <div style={{ fontSize: 9.5, color: '#7C8782', marginBottom: 6, fontWeight: 600 }}>此节点的 AI 工具</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 5 }}>
          {meta.tools.map((t) => {
            const active = toolId === t.id;
            return (
              <button
                key={t.id}
                onClick={() => { setToolId(t.id); setPrompt(''); }}
                title={t.desc}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px', borderRadius: 9, cursor: 'pointer',
                  background: active ? PAVO_C.primarySoft : '#fff', border: active ? `1px solid ${PAVO_C.primary}` : `1px solid ${PAVO_C.borderSoft}`,
                  fontSize: 10.5, color: active ? PAVO_C.primaryDeep : '#3E4944', fontWeight: active ? 700 : 400, textAlign: 'left',
                }}
              >
                <span style={{ fontSize: 13 }}>{t.emoji}</span>
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 工具参数区 */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {!activeTool ? (
          <div style={{ fontSize: 11, color: '#8A948F', lineHeight: 1.7, paddingTop: 6 }}>
            选中一个工具开始创作。生成结果会作为<strong style={{ color: PAVO_C.primaryDeep }}>新节点分支</strong>落在画布上，旧节点保留。
          </div>
        ) : (
          <>
            {/* 工具描述 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
              <Wand2 size={13} color={PAVO_C.primary} />
              <span style={{ fontSize: 11, color: '#4A5550' }}>{activeTool.emoji} {activeTool.label}</span>
              <span style={{ fontSize: 9.5, color: '#8A948F' }}>· {activeTool.desc}</span>
            </div>

            {/* 3D 导演台特殊入口 */}
            {toolId === 'open-director' ? (
              <div style={{ fontSize: 11, color: '#4A5550', lineHeight: 1.8, background: PAVO_C.primarySoft, padding: '10px 12px', borderRadius: 10 }}>
                将打开 <strong>3D 导演台</strong>：可在其中拖拽角色摆位、设置机位（低/高/侧拍）、切换导演/相机视角，确认后导出一张「站位示意图」作为分镜参考。
              </div>
            ) : (
              <>
                {/* @ 引用资产（小云雀融合） */}
                <div style={{ marginBottom: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', minHeight: 26 }}>
                    {pickedRefs.length > 0 && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: PAVO_C.primarySoft, padding: '3px 8px', borderRadius: 999, fontSize: 10, color: PAVO_C.primaryDeep }}>
                        {refLabel}
                        <button onClick={() => setPickedRefs([])} style={{ border: 'none', background: 'none', cursor: 'pointer', color: PAVO_C.primaryDeep, fontSize: 11 }}>×</button>
                      </div>
                    )}
                    <button
                      onClick={() => setShowRefs((s) => !s)}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 9px', borderRadius: 8, cursor: 'pointer', background: '#fff', border: `1px solid ${PAVO_C.border}`, fontSize: 10, color: '#3E4944' }}
                    >
                      <AtSign size={11} color={PAVO_C.primary} /> 引用资产
                      <ChevronRight size={10} style={{ transform: showRefs ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }} />
                    </button>
                  </div>
                  {showRefs && (
                    <div style={{ marginTop: 6, maxHeight: 130, overflowY: 'auto', border: `1px solid ${PAVO_C.borderSoft}`, borderRadius: 10, padding: 6 }}>
                      {referable.length === 0 && <div style={{ fontSize: 10, color: '#8A948F', padding: 6 }}>暂无资产节点，可先在画布创建角色/场景/图片资产</div>}
                      {referable.map((r) => {
                        const on = pickedRefs.includes(r.id);
                        return (
                          <button
                            key={r.id}
                            onClick={() => setPickedRefs((p) => (on ? p.filter((x) => x !== r.id) : [...p, r.id]))}
                            style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', padding: '5px 8px', borderRadius: 7, cursor: 'pointer', background: on ? PAVO_C.primarySoft : '#fff', border: 'none', fontSize: 10.5, color: '#3E4944', textAlign: 'left' }}
                          >
                            <span style={{ width: 12, height: 12, borderRadius: 3, border: `1px solid ${on ? PAVO_C.primary : PAVO_C.border}`, background: on ? PAVO_C.primary : '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 9, flexShrink: 0 }}>{on ? '✓' : ''}</span>
                            <span style={{ fontSize: 13 }}>{r.emoji}</span>
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.title}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* 提示词输入 */}
                <textarea
                  ref={inputRef}
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder={placeholders[toolId] || '输入创作提示词…'}
                  rows={4}
                  style={{ width: '100%', boxSizing: 'border-box', padding: '9px 11px', borderRadius: 10, fontSize: 11, border: `1px solid ${PAVO_C.border}`, outline: 'none', resize: 'vertical', fontFamily: 'inherit', background: '#FAFCFB', color: PAVO_C.text }}
                />
              </>
            )}

            {/* 生成按钮 */}
            <button
              onClick={invoke}
              disabled={busy || (toolId !== 'open-director' && !prompt.trim())}
              style={{
                width: '100%', marginTop: 10, padding: '10px 0', borderRadius: 10, border: 'none', cursor: busy ? 'wait' : (toolId !== 'open-director' && !prompt.trim()) ? 'not-allowed' : 'pointer',
                background: PAVO_C.primary, color: '#fff', fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                opacity: busy || (toolId !== 'open-director' && !prompt.trim()) ? 0.55 : 1,
              }}
            >
              <Sparkles size={13} /> {busy ? 'AI 生成中…' : '生成 · 落回画布分支'}
            </button>

            {/* 节点内直接编辑（自己编写/编辑备注时） */}
            {toolId === 'write' && (
              <div style={{ marginTop: 8 }}>
                <button onClick={() => { setEditing('write'); setDraft(prompt); }} style={{ width: '100%', padding: '7px 0', borderRadius: 9, cursor: 'pointer', background: '#fff', border: `1px solid ${PAVO_C.border}`, fontSize: 11, color: PAVO_C.primaryDeep }}>
                  保存为当前节点内容
                </button>
              </div>
            )}
          </>
        )}
      </div>

      <div style={{ padding: '8px 14px', borderTop: `1px solid ${PAVO_C.borderSoft}`, fontSize: 9.5, color: '#8A948F', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
        <Sparkles size={10} /> 演示引擎 · 阶段四接入三通道 API
        <div style={{ flex: 1 }} />
        <span>{referable.length} 个资产可引用</span>
      </div>
    </div>
  );
};

export default NodeToolsPanel;
