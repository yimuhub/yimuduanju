/**
 * 一幕·YIMU AI 短剧创作平台 画布 v2 —— Pavo 式主工作台
 * 布局：左侧「画布元素」列表（可折叠）+ 中央无限画布（布局最大化）+ 右侧节点工具/对话助手
 * 交互：双击加节点 · 点击节点弹专属 AI 工具（节点即工具箱）· 分支生成 · @ 引用资产 · 3D 导演台
 * 视觉：浅白极简 + 青绿点缀
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ReactFlow, Background, Controls, MiniMap, ReactFlowProvider, useReactFlow,
  useNodesState, useEdgesState, addEdge, type Node, type Edge, type Connection,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { ArrowLeft, Clapperboard, Lock, Unlock, Sparkles, Wand2, ZoomIn } from 'lucide-react';
import PavoNode, { type PavoCardData } from './PavoNode';
import CustomEdge from './CustomEdge';
import NodeToolsPanel from './NodeToolsPanel';
import LeftElementsPanel from './LeftElementsPanel';
import PavoChatPanel from './PavoChatPanel';
import Director3DPanel, { type DirectorExport } from './Director3DPanel';
import { NODE_META_V2, NODE_KINDS_V2, PAVO_C, defaultPavoNode, type PavoNodeData, type PavoNodeKind } from './pavoTypes';
import { runPavoTool, autoHarness, pavoAgentReply } from './demoEngine2';

type YNode = Node<PavoCardData>;
type YEdge = Edge<{ onScissor?: (id: string) => void }>;

const nodeTypes = { pavo: PavoNode };
const edgeTypes = { yimuEdge: CustomEdge };
const STORAGE_PREFIX = 'yimu-pavo-v1';

const Workspace = () => {
  const { id: projectId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { fitView } = useReactFlow();

  // P1 修复：useNodesState 泛型应为 Node 类型（YNode），之前误传 Data 类型导致全文件类型错乱
  const [nodes, setNodes, onNodesChange] = useNodesState<YNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<YEdge>([]);
  const [loaded, setLoaded] = useState(false);
  const [episode, setEpisode] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [toolsNodeId, setToolsNodeId] = useState<string | null>(null);
  const [addPanel, setAddPanel] = useState<{ x: number; y: number } | null>(null);
  const [leftOpen, setLeftOpen] = useState(true);
  const [locked, setLocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [directorOpen, setDirectorOpen] = useState(false);
  const [storyInput, setStoryInput] = useState('');
  const [showStory, setShowStory] = useState(false);

  const storageKey = `${STORAGE_PREFIX}-${projectId}-ep${episode}`;
  const keyRef = useRef(storageKey);
  keyRef.current = storageKey;

  const persist = useCallback((ns: YNode[], es: YEdge[]) => {
    try { localStorage.setItem(keyRef.current, JSON.stringify({ nodes: ns, edges: es })); } catch { /* noop */ }
  }, []);
  useEffect(() => { if (loaded) persist(nodes, edges); }, [nodes, edges, loaded, persist]);

  // ===== 加载 =====
  useEffect(() => {
    if (!projectId) return;
    setLoaded(false);
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const local = JSON.parse(raw);
        if (Array.isArray(local.nodes)) {
          setNodes(local.nodes.map((n: YNode) => ({ ...n, type: 'pavo', data: { ...n.data, generating: false } })));
          setEdges((local.edges || []).map((e: YEdge) => ({ ...e, type: 'yimuEdge' })));
        } else { setNodes([]); setEdges([]); }
      } else { setNodes([]); setEdges([]); }
    } catch { setNodes([]); setEdges([]); }
    setLoaded(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, episode]);

  // ===== 双击空白加节点（原生捕获） =====
  useEffect(() => {
    const onDbl = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t) return;
      if (t.closest('[data-yimu-panel]')) return;
      if (t.closest('.react-flow__node')) return;
      if (!t.closest('.react-flow__pane')) return;
      if (locked) return;
      setAddPanel({ x: e.clientX, y: e.clientY });
    };
    document.addEventListener('dblclick', onDbl, true);
    return () => document.removeEventListener('dblclick', onDbl, true);
  }, [locked]);

  // ===== 节点操作 =====
  const addNodeAt = useCallback((kind: PavoNodeKind, pos?: { x: number; y: number }) => {
    const data = defaultPavoNode(kind);
    const node: YNode = {
      id: `${data.seed}-n`, type: 'pavo',
      position: pos || { x: 140 + Math.random() * 220, y: 100 + Math.random() * 180 },
      data,
    };
    setNodes((nds) => [...nds, node]);
    setAddPanel(null);
    setSelectedId(node.id);
    setToolsNodeId(node.id);
  }, [setNodes]);

  const onConnect = useCallback((c: Connection) => {
    setEdges((eds) => addEdge({ ...c, type: 'yimuEdge' }, eds));
  }, [setEdges]);

  const onScissor = useCallback((edgeId: string) => {
    setEdges((eds) => eds.filter((e) => e.id !== edgeId));
  }, [setEdges]);

  const handleNodeClick = useCallback((_: React.MouseEvent, node: YNode) => {
    setSelectedId(node.id);
    setToolsNodeId(node.id);
  }, []);

  const selected = useMemo(() => nodes.find((n) => n.id === selectedId) || null, [nodes, selectedId]);
  const toolsNode = useMemo(() => (toolsNodeId ? nodes.find((n) => n.id === toolsNodeId) || null : null), [nodes, toolsNodeId]);
  const contextLabel = selected ? `${NODE_META_V2[selected.data.kind].emoji} ${selected.data.title}` : null;

  /** @ 引用资产列表（角色/场景/图片/资产/文本节点） */
  const referable = useMemo(
    () => nodes.filter((n) => n.data.isAsset || ['character', 'scene', 'image', 'asset', 'text', 'script'].includes(n.data.kind))
      .map((n) => ({ id: n.id, title: n.data.title || NODE_META_V2[n.data.kind].label, emoji: NODE_META_V2[n.data.kind].emoji })),
    [nodes],
  );

  // ===== 节点工具执行（Pavo 分支生成） =====
  const handleInvoke = useCallback(async (toolId: string, prompt: string, refs: string[]) => {
    if (!toolsNode) return;
    const src = toolsNode;
    setBusy(true);
    setNodes((nds) => nds.map((n) => (n.id === src.id ? { ...n, data: { ...n.data, generating: true } } : n)));
    try {
      const refText = refs.map((r) => {
        const n = nodes.find((x) => x.id === r);
        return n ? `${NODE_META_V2[n.data.kind].emoji}${n.data.title}` : '';
      }).filter(Boolean).join('、');
      const fullPrompt = refText ? `${prompt}\n（@引用：${refText}）` : prompt;

      if (toolId === 'open-director') {
        setDirectorOpen(true);
        setToolsNodeId(null);
        setNodes((nds) => nds.map((n) => (n.id === src.id ? { ...n, data: { ...n.data, generating: false } } : n)));
        return;
      }

      const out = await runPavoTool(src.data.kind, toolId, fullPrompt);
      const newNodes: YNode[] = out.nodes.map((d, i) => {
        const id = `${d.seed}-n`;
        return {
          id, type: 'pavo',
          position: { x: src.position.x + 300 + (i % 2) * 40, y: src.position.y - 40 + (i - Math.floor(out.nodes.length / 2)) * 160 },
          data: { ...d, seed: d.seed },
        };
      });
      setNodes((nds) => [
        ...nds.map((n) => (n.id === src.id ? { ...n, data: { ...n.data, generating: false } } : n)),
        ...newNodes,
      ]);
      setEdges((eds) => [
        ...eds,
        ...newNodes.map((n) => ({ id: `g-${src.id}-${n.id}`, source: src.id, target: n.id, type: 'yimuEdge' as const, label: out.edgeNote })),
      ]);
      if (newNodes.length) {
        setToolsNodeId(newNodes[newNodes.length - 1].id);
        setSelectedId(newNodes[newNodes.length - 1].id);
      }
    } finally {
      setBusy(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toolsNode, nodes, setNodes, setEdges]);

  // ===== 一键铺开（Pavo Harness：故事 → 角色/场景资产自动拆解） =====
  const handleHarness = useCallback(async () => {
    if (!storyInput.trim() || busy) return;
    setBusy(true);
    try {
      const out = await autoHarness(storyInput);
      const baseX = 120, baseY = 90;
      const newNodes: YNode[] = out.nodes.map((d, i) => {
        const id = `${d.seed}-n`;
        const col = i < 2 ? 0 : 1;
        const row = i < 2 ? i : i - 2;
        return {
          id, type: 'pavo',
          position: { x: baseX + col * 320, y: baseY + row * 260 },
          data: { ...d, seed: d.seed },
        };
      });
      setNodes((nds) => [...nds, ...newNodes]);
      // 资产节点不自动连线（作为资产库备用），由用户后续 @ 引用
      setStoryInput('');
      setShowStory(false);
      setTimeout(() => { try { fitView({ padding: 0.2, duration: 400 }); } catch { /* noop */ } }, 200);
    } finally {
      setBusy(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storyInput, busy, setNodes, fitView]);

  // ===== 一键整理（自动布局：按类型分列） =====
  const ORDER: PavoNodeKind[] = ['text', 'script', 'storyboard', 'image', 'video', 'audio', 'character', 'scene', 'asset', 'director', 'note'];
  const handleArrange = useCallback(() => {
    const groups: Record<string, YNode[]> = {};
    nodes.forEach((n) => { (groups[n.data.kind] = groups[n.data.kind] || []).push(n); });
    const kinds = Object.keys(groups).sort((a, b) => ORDER.indexOf(a as PavoNodeKind) - ORDER.indexOf(b as PavoNodeKind));
    setNodes((nds) => {
      const arr: YNode[] = [];
      kinds.forEach((k, ki) => {
        groups[k].forEach((n, ni) => { arr.push({ ...n, position: { x: 70 + ki * 330, y: 60 + ni * 210 } }); });
      });
      return arr;
    });
    setTimeout(() => { try { fitView({ padding: 0.18, duration: 400 }); } catch { /* noop */ } }, 150);
  }, [nodes, setNodes, fitView]);

  // ===== 3D 导演台导出 → 落画布 =====
  const handleDirectorExport = useCallback((out: DirectorExport) => {
    const d = defaultPavoNode('image', '导演台 · 站位示意图');
    const node: YNode = { id: `${d.seed}-n`, type: 'pavo', position: { x: 180 + Math.random() * 120, y: 140 + Math.random() * 120 }, data: { ...d, hasImage: true, values: { ...d.values, url: out.image, prompt: `导演台站位：${out.items.map((i) => i.label).join('、')}` } } };
    setNodes((nds) => [...nds, node]);
    setSelectedId(node.id);
    setToolsNodeId(node.id);
  }, [setNodes]);

  // ===== 对话助手 =====
  const handleAgentSend = useCallback(async (agentName: string, instruction: string) => {
    return pavoAgentReply(agentName, instruction, contextLabel || '');
  }, [contextLabel]);
  const handleApplyNode = useCallback((text: string) => {
    const d = defaultPavoNode('note', 'AI 助手备注');
    const node: YNode = { id: `${d.seed}-n`, type: 'pavo', position: { x: 120 + Math.random() * 240, y: 140 + Math.random() * 200 }, data: { ...d, values: { text: text.slice(0, 300) } } };
    setNodes((nds) => [...nds, node]);
    setToolsNodeId(node.id);
  }, [setNodes]);

  // ===== 聚焦节点 =====
  const handleFocus = useCallback((nodeId: string) => {
    const n = nodes.find((x) => x.id === nodeId);
    if (!n) return;
    setSelectedId(nodeId);
    setTimeout(() => { try { fitView({ nodes: [{ id: nodeId }], padding: 0.4, duration: 400, maxZoom: 1.2 }); } catch { /* noop */ } }, 50);
  }, [nodes, fitView]);

  return (
    <div style={{ position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column', background: PAVO_C.bg, fontFamily: "'Roboto','PingFang SC','Segoe UI',Arial,sans-serif", zIndex: 999 }}>
      <style>{`
        @keyframes yimuSpin { to { transform: rotate(360deg); } }
        .react-flow__attribution { display: none; }
        .react-flow__controls { box-shadow: 0 1px 6px rgba(15,45,35,.1); border-radius: 8px; overflow: hidden; }
        .react-flow__controls button { background:#fff; border:none; color:#44544D; width:28px; height:28px; }
        .react-flow__minimap { border-radius: 10px; overflow: hidden; box-shadow: 0 2px 10px rgba(15,45,35,.12); }
        .react-flow__edge-path { stroke: #7DBDA8; }
        .react-flow__node { font-family: inherit; }
      `}</style>

      {/* ===== 顶部工具条 ===== */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 16px', background: PAVO_C.panel, borderBottom: `1px solid ${PAVO_C.borderSoft}`, flexShrink: 0 }}>
        <button onClick={() => navigate(`/project/${projectId}`)} style={topBtn}><ArrowLeft size={13} /> 返回项目</button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, fontWeight: 700, color: PAVO_C.text }}>
          <span style={{ width: 24, height: 24, borderRadius: 7, background: PAVO_C.primary, color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 12 }}>木</span>
          一幕·YIMU AI 短剧创作平台
          <span style={{ fontSize: 9.5, fontWeight: 600, padding: '2px 9px', borderRadius: 999, background: PAVO_C.primarySoft, color: PAVO_C.primaryDeep }}>无限画布</span>
        </div>

        {/* 集切换 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginLeft: 6 }}>
          <span style={{ fontSize: 10, color: '#9AA4A0' }}>集</span>
          {[1, 2, 3].map((ep) => (
            <button key={ep} onClick={() => setEpisode(ep)} style={{ width: 26, height: 26, borderRadius: 7, fontSize: 11, cursor: 'pointer', fontWeight: 600, background: episode === ep ? PAVO_C.primary : '#fff', color: episode === ep ? '#fff' : '#5E6B65', border: episode === ep ? 'none' : `1px solid ${PAVO_C.border}` }}>{ep}</button>
          ))}
        </div>

        {/* 一键铺开（Pavo Harness） */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button onClick={() => setShowStory((s) => !s)} style={topBtn}><Wand2 size={13} color={PAVO_C.primary} /> 一键铺开</button>
          {showStory && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#F4F8F6', padding: '3px 5px', borderRadius: 9, border: `1px solid ${PAVO_C.borderSoft}` }}>
              <input
                value={storyInput}
                onChange={(e) => setStoryInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleHarness(); }}
                placeholder="输入一句故事，自动拆解角色/场景资产…"
                style={{ width: 240, padding: '6px 9px', borderRadius: 7, fontSize: 10.5, border: 'none', outline: 'none', background: 'transparent' }}
              />
              <button onClick={handleHarness} disabled={busy} style={{ padding: '6px 10px', borderRadius: 7, background: PAVO_C.primary, color: '#fff', border: 'none', cursor: busy ? 'wait' : 'pointer', fontSize: 10.5, fontWeight: 700 }}><Sparkles size={11} /> 生成</button>
            </div>
          )}
        </div>

        <div style={{ flex: 1 }} />

        <button onClick={handleArrange} style={topBtn} title="一键整理（快捷键 ⌘⇧F）"><Clapperboard size={13} /> 一键整理</button>
        <button onClick={() => setLocked((l) => !l)} style={topBtn}>{locked ? <Unlock size={13} /> : <Lock size={13} />}{locked ? '解锁' : '锁定'}</button>
        <button onClick={() => setLeftOpen((o) => !o)} style={topBtn} title="切换左侧面板"><ZoomIn size={13} /> 布局</button>
      </div>

      {/* ===== 主体：左 + 中 + 右 ===== */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0, position: 'relative' }}>
        {/* 左侧画布元素列表 */}
        <LeftElementsPanel
          nodes={nodes.map((n) => ({ id: n.id, data: n.data }))}
          selectedId={selectedId}
          onSelect={(id) => { setSelectedId(id); setToolsNodeId(id); }}
          onAdd={(kind) => addNodeAt(kind)}
          onFocus={handleFocus}
          open={leftOpen}
          onToggle={() => setLeftOpen((o) => !o)}
        />

        {/* 中央无限画布（布局最大化） */}
        <div style={{ flex: 1, position: 'relative', minWidth: 0 }}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={(e, n) => handleNodeClick(e, n as YNode)}
            onPaneClick={() => { setAddPanel(null); setToolsNodeId(null); }}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            fitView
            fitViewOptions={{ padding: 0.25 }}
            minZoom={0.15} maxZoom={3}
            deleteKeyCode={['Delete', 'Backspace']}
            multiSelectionKeyCode={['Shift', 'Meta']}
            nodesDraggable={!locked}
            nodesConnectable={!locked}
            proOptions={{ hideAttribution: true }}
          >
            <Background color="#E2E9E6" gap={22} size={1} />
            <Controls position="bottom-left" />
            <MiniMap position="bottom-right" pannable zoomable maskColor="rgba(15,45,35,0.05)" nodeColor={() => PAVO_C.primary} />
          </ReactFlow>

          {nodes.length === 0 && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none', color: '#B0B8B3' }}>
              <div style={{ fontSize: 34, marginBottom: 10 }}>🎨</div>
              <div style={{ fontSize: 14, color: '#7C8782' }}>双击画布空白处，添加第一个节点</div>
              <div style={{ fontSize: 11, color: '#9AA4A0', marginTop: 6 }}>或点顶部「一键铺开」，输入故事自动拆解角色与场景资产</div>
            </div>
          )}
        </div>
      </div>

      {/* ===== 双击节点类型面板 ===== */}
      {addPanel && (
        <div data-yimu-panel style={{ position: 'fixed', left: Math.min(addPanel.x, window.innerWidth - 300), top: Math.min(addPanel.y, window.innerHeight - 280), zIndex: 300, width: 280, background: PAVO_C.panel, borderRadius: 14, border: `1px solid ${PAVO_C.border}`, boxShadow: '0 14px 44px rgba(15,45,35,0.18)', padding: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 11.5, fontWeight: 700, color: PAVO_C.text }}>添加节点</span>
            <div style={{ flex: 1 }} />
            <button onClick={() => setAddPanel(null)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#9AA4A0', fontSize: 12 }}>✕</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
            {NODE_KINDS_V2.map((k) => {
              const m = NODE_META_V2[k];
              return (
                <button key={k} onClick={() => addNodeAt(k)} title={m.fullName}
                  style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, padding: '8px 2px', borderRadius: 10, cursor: 'pointer', background: '#F7FAF9', border: `1px solid ${PAVO_C.borderSoft}`, fontSize: 9.5, color: '#3E4944' }}>
                  <span style={{ fontSize: 18 }}>{m.emoji}</span>
                  <span>{m.label}</span>
                </button>
              );
            })}
          </div>
          <div style={{ fontSize: 9.5, color: '#9AA4A0', marginTop: 9, textAlign: 'center' }}>双击画布任意空白再次唤起 · 点击节点弹 AI 工具</div>
        </div>
      )}

      {/* ===== 节点即工具箱（Pavo 核心） ===== */}
      <NodeToolsPanel
        node={toolsNode?.data ?? null}
        nodeId={toolsNodeId}
        referable={referable}
        onInvoke={handleInvoke}
        onClose={() => setToolsNodeId(null)}
        busy={busy}
      />

      {/* ===== 3D 导演台 ===== */}
      <Director3DPanel open={directorOpen} onClose={() => setDirectorOpen(false)} onExport={handleDirectorExport} />

      {/* ===== 右侧对话助手（小云雀融合） ===== */}
      <PavoChatPanel contextLabel={contextLabel} referable={referable} onSend={handleAgentSend} onApplyNode={handleApplyNode} />
    </div>
  );
};

const topBtn: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 11px', borderRadius: 8, fontSize: 11, cursor: 'pointer', background: '#fff', border: `1px solid ${PAVO_C.border}`, color: '#44544D' };

const PavoCanvas = () => (
  <ReactFlowProvider>
    <Workspace />
  </ReactFlowProvider>
);

export default PavoCanvas;
