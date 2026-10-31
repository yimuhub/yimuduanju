/**
 * 自由画布 · 1:1 复刻 Pavo AI Canvas
 * 主页面：React Flow 画布 / 双击建节点 / 端口拖线 / 连线剪刀 / 快捷键 / 参考模式拾取
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  BaseEdge,
  ConnectionMode,
  Controls,
  EdgeLabelRenderer,
  MiniMap,
  Panel,
  getBezierPath,
  Position,
  useReactFlow,
  type Connection,
  type ConnectionState,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeTypes,
  type EdgeTypes,
  type OnSelectionChangeParams,
  type XYPosition,
} from '@xyflow/react';
import { Anchor, Copy, Image as ImageIcon, Pencil, Scissors, Trash2 } from 'lucide-react';
import { useParams } from 'react-router-dom';
import { useP3Store } from './pavo3Store';
import { Pavo3Node } from './Pavo3Node';
import { LeftElementsPanel } from './LeftElementsPanel';
import { BottomBar } from './BottomBar';
import { ModelDialog } from './ModelDialog';
import { AssistantPanel } from './AssistantPanel';
import {
  AddNodeMenu,
  AssetLibraryDialog,
  ModelSelectDialog,
  ReorganizeConfirm,
  ShortcutsDialog,
  StyleLibraryDialog,
} from './Dialogs';
import { Director3D } from './Director3D';
import { NODE_COLORS, P3 } from './pavo3Constants';
import './pavo3.css';
import '@xyflow/react/dist/style.css';

const nodeTypes: NodeTypes = { pavo: Pavo3Node };

/** 自定义边：选中后出现「剪刀」删除按钮 */
function PavoEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  selected,
  markerEnd,
  style,
}: EdgeProps) {
  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    // P1 修复：v12 参数名为 curvature（旧 curve 已移除），保持原 0.5 弯曲度
    curvature: 0.5,
  });
  const { edges, setEdges } = useP3Store();
  const remove = useCallback(() => {
    setEdges(edges.filter((e) => e.id !== id));
  }, [id, edges, setEdges]);

  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} />
      {selected && (
        <EdgeLabelRenderer>
          <button
            className="p3-edge-scissors nodrag nopan"
            onClick={remove}
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: 'all',
              width: 24, height: 24, borderRadius: 50,
              background: '#fff', border: `1px solid ${P3.border}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: P3.text, cursor: 'pointer', boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
            }}
            title="剪断连线"
          >
            <Scissors size={13} />
          </button>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

const edgeTypes: EdgeTypes = { pavoEdge: PavoEdge };

/** 顶栏集数选择器（画布状态按集分存 localStorage -epN，沿用画布自动保存机制） */
const EpisodeBar = ({ projectId }: { projectId?: string }) => {
  const episode = useP3Store((s) => s.episode);
  const setEpisode = useP3Store((s) => s.setEpisode);
  const pick = (ep: number) => {
    setEpisode(ep);
    try {
      localStorage.setItem(`yimu-free3-${projectId ?? 'default'}-last-ep`, String(ep));
    } catch {
      /* 忽略 */
    }
  };
  return (
    <Panel position="top-center">
      <div className="p3-tool-panel" style={{ gap: 6, padding: '4px 8px' }}>
        <span style={{ fontSize: 12, color: P3.helper, padding: '0 2px' }}>集数</span>
        {[1, 2, 3].map((ep) => (
          <button
            key={ep}
            onClick={() => pick(ep)}
            title={`切换到第 ${ep} 集（独立画布）`}
            style={{
              width: 30, height: 26, borderRadius: 7, fontSize: 12, cursor: 'pointer',
              fontWeight: 600, transition: 'background 0.12s',
              background: episode === ep ? P3.primary : '#fff',
              color: episode === ep ? '#fff' : P3.text,
              border: episode === ep ? 'none' : `1px solid ${P3.border}`,
            }}
          >
            {ep}
          </button>
        ))}
      </div>
    </Panel>
  );
};

/** 小地图节点配色（按节点类型，与节点徽标一致） */
const miniNodeColor = (node: Node): string => {
  const kind = (node.data as { nodeType?: string }).nodeType;
  return NODE_COLORS[kind] ?? '#9C9C9C';
};

/** 节点右键菜单状态（视口像素定位） */
interface CtxMenuState {
  x: number;
  y: number;
  nodeId: string;
}

const CanvasInner = () => {
  const {
    nodes,
    edges,
    onNodesChange,
    onEdgesChange,
    onConnect,
    snapGrid,
    openAddMenu,
    closeAddMenu,
    closeDialog,
    dialogKind,
    undo,
    redo,
    setReorganizeConfirm,
    minimap,
  } = useP3Store();
  const { screenToFlowPosition } = useReactFlow();
  const [ctxMenu, setCtxMenu] = useState<CtxMenuState | null>(null);
  const flowWrapRef = useRef<HTMLDivElement>(null);

  /* ---- 持久化：按项目 + 集数分存 localStorage（-epN 后缀，沿用画布自动保存机制）+ 后端实体同步 ---- */
  const { projectName, restoreCanvas, syncFromBackend, episode, setEpisode } = useP3Store();
  // 路由参数名为 id（project/:id/canvas-free3），之前误读 projectId 导致恒为 undefined、
  // 画布持久化与白模上传都拿不到项目归属；此处修正（白模产线需要真实 projectId）。
  const { id: routeProjectId } = useParams<{ id: string }>();
  const projectId = routeProjectId === 'free' ? undefined : routeProjectId;
  const baseKey = `yimu-free3-${projectId ?? 'default'}`;
  const persistKey = `${baseKey}-ep${episode}`;
  // 当前写入键（ref）：切换集数时先由加载 effect 恢复新集画布并更新键，
  // 保存 effect 依赖节点引用，未变化时不触发，避免把上一集内容误写入新集键
  const persistKeyRef = useRef(persistKey);
  // 首次加载完成前禁止写入（last-ep 重定向期间 persistKeyRef 尚未就位，防止空状态覆盖存档）
  const loadedRef = useRef(false);
  // 后端实体每个项目只同步一次（切集不重复注入）
  const syncedProjectRef = useRef<string | null>(null);
  useEffect(() => {
    try {
      // 记忆用户上次的集数选择
      const savedEp = Number(localStorage.getItem(`${baseKey}-last-ep`) || '1');
      if (Number.isFinite(savedEp) && savedEp >= 1 && savedEp <= 3 && savedEp !== episode) {
        setEpisode(savedEp);
        return; // 下一次 effect 随 persistKey 变化重新执行
      }
      // 兼容旧数据：修复前画布存在 yimu-free3-<projectId> / yimu-free3-default 单键下，
      // 第 1 集无数据时回落旧键，避免用户旧画布“丢失”
      const raw = localStorage.getItem(persistKey)
        ?? (episode === 1 ? localStorage.getItem(baseKey) : null)
        ?? (episode === 1 && projectId ? localStorage.getItem('yimu-free3-default') : null);
      if (raw) {
        const snap = JSON.parse(raw);
        if (snap && Array.isArray(snap.nodes)) restoreCanvas(snap);
      } else {
        // 该集无存档：清空画布（保留项目名），避免上一集节点串到新集
        restoreCanvas({ nodes: [], edges: [], projectName: useP3Store.getState().projectName });
      }
    } catch {
      /* 损坏数据忽略 */
    }
    persistKeyRef.current = persistKey;
    loadedRef.current = true;
    if (projectId && syncedProjectRef.current !== projectId) {
      syncedProjectRef.current = projectId;
      void syncFromBackend(projectId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persistKey, projectId]);
  useEffect(() => {
    if (!loadedRef.current) return;
    try {
      const snap = { nodes, edges, projectName };
      localStorage.setItem(persistKeyRef.current, JSON.stringify(snap));
    } catch {
      /* 容量不足忽略 */
    }
  }, [nodes, edges, projectName]);

  /* ---- 双击画布空白 → 快速创建文本节点（对标 FigJam/tldraw：双击即写；其他类型走工具栏 / 拖线） ---- */
  useEffect(() => {
    const el = flowWrapRef.current;
    if (!el) return;
    const onDbl = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      // 忽略节点 / 弹窗 / 工具栏上的双击
      if (t.closest('.react-flow__node')) return;
      if (t.closest('.p3-dialog-mask')) return;
      if (t.closest('.p3-tool-panel')) return;
      closeDialog();
      setCtxMenu(null);
      useP3Store.getState().createNode('text', screenToFlowPosition({ x: e.clientX, y: e.clientY }));
    };
    el.addEventListener('dblclick', onDbl);
    return () => el.removeEventListener('dblclick', onDbl);
  }, [closeDialog, screenToFlowPosition]);

  /* ---- 单击画布空白：关闭弹窗 ---- */
  const onPaneClick = useCallback(() => {
    closeDialog();
  }, [closeDialog]);

  /* ---- 端口拖线松手空白 → 菜单 + 从源节点连线 ---- */
  const onConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent, connectionState: ConnectionState) => {
      if (connectionState.isValid) return;
      const e = event as MouseEvent;
      if (!e) return;
      const pos: XYPosition = { x: e.clientX, y: e.clientY };
      const fromId = connectionState.fromNode?.id;
      closeDialog();
      openAddMenu({ visible: true, x: pos.x, y: pos.y, sourceId: fromId });
    },
    [openAddMenu, closeDialog],
  );

  /* ---- 参考模式：点击画布节点拾取参考 ---- */
  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      // 图片弹窗参考模式：由 ImageGenPanel 内部处理（通过自定义事件）
      if (dialogKind === 'image') {
        window.dispatchEvent(new CustomEvent('p3-pick-ref', { detail: node.id }));
      }
    },
    [dialogKind],
  );

  const defaultEdgeOptions = useMemo(
    () => ({
      type: 'pavoEdge',
      style: { stroke: P3.primary, strokeWidth: 2 },
      markerEnd: { type: 'arrowclosed' as const, color: P3.primary },
    }),
    [],
  );

  /* ---- 全局快捷键（输入控件聚焦时不劫持按键） ---- */
  const onKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) return;
      const meta = e.metaKey || e.ctrlKey;
      const st = useP3Store.getState();
      if (meta && e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      else if (meta && e.key === 'z' && e.shiftKey) { e.preventDefault(); redo(); }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && !meta) {
        // 删除选中节点 + 选中连线（批量删除带确认）
        e.preventDefault();
        st.deleteSelection();
      } else if (meta && (e.key === 'd' || e.key === 'D')) {
        // ⌘D / Ctrl+D：复制选中节点（含副本间连线）
        e.preventDefault();
        st.duplicateNodes(st.selectedNodeIds ?? []);
      } else if (meta && e.shiftKey && (e.key === 'F' || e.key === 'f')) {
        e.preventDefault();
        setReorganizeConfirm(true);
      } else if (e.key === 'Escape') {
        closeAddMenu();
        closeDialog();
        setCtxMenu(null);
      }
      // Space 平移：xyflow 默认 panActivationKeyCode='Space' 已支持，无需额外处理
    },
    [undo, redo, setReorganizeConfirm, closeAddMenu, closeDialog],
  );

  React.useEffect(() => {
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onKeyDown]);

  /* ---- 选中变化（用于删除 / 复制） ---- */
  const onSelectionChange = useCallback(({ nodes: sel }: OnSelectionChangeParams) => {
    useP3Store.setState({ selectedNodeIds: sel.map((n) => n.id) });
  }, []);

  /* ---- 节点右键上下文菜单（对标 Figma/tldraw） ---- */
  const onNodeContextMenu = useCallback((e: React.MouseEvent, node: Node) => {
    e.preventDefault();
    setCtxMenu({ x: e.clientX, y: e.clientY, nodeId: node.id });
  }, []);

  // 右键菜单外点击 / 滚动即关闭
  useEffect(() => {
    if (!ctxMenu) return;
    const close = () => setCtxMenu(null);
    window.addEventListener('mousedown', close);
    window.addEventListener('wheel', close, { passive: true });
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('wheel', close);
    };
  }, [ctxMenu]);

  const ctxNode = ctxMenu ? nodes.find((n) => n.id === ctxMenu.nodeId) : null;

  const ctxAction = useCallback((action: 'rename' | 'duplicate' | 'delete' | 'toggle-ref' | 'pick-ref') => {
    if (!ctxMenu) return;
    const st = useP3Store.getState();
    const id = ctxMenu.nodeId;
    const node = st.nodes.find((n) => n.id === id);
    setCtxMenu(null);
    if (action === 'rename' && node) {
      const next = window.prompt('重命名节点', node.data.title);
      if (next && next.trim() && next.trim() !== node.data.title) st.updateNodeData(id, { title: next.trim() });
    } else if (action === 'duplicate') {
      st.duplicateNodes([id]);
    } else if (action === 'delete') {
      // 右键目标在选中集内 → 批量删除；否则只删该节点
      if ((st.selectedNodeIds ?? []).includes(id)) st.deleteSelection();
      else st.removeNode(id);
    } else if (action === 'toggle-ref' && node) {
      st.updateNodeData(id, { isReference: !node.data.isReference });
    } else if (action === 'pick-ref') {
      window.dispatchEvent(new CustomEvent('p3-pick-ref', { detail: id }));
    }
  }, [ctxMenu]);

  return (
    <div className="p3-canvas-root" style={{ display: 'flex' }}>
      <LeftElementsPanel />
      <div style={{ flex: 1, position: 'relative', minWidth: 0 }} ref={flowWrapRef}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onConnectEnd={onConnectEnd}
          onPaneClick={onPaneClick}
          onNodeClick={onNodeClick}
          onNodeContextMenu={onNodeContextMenu}
          onSelectionChange={onSelectionChange}
          snapToGrid={snapGrid}
          snapGrid={[12, 12]}
          // P1 修复：v12 ConnectionMode 为枚举，字符串字面量不再可赋值；保持原 loose 语义
          connectionMode={ConnectionMode.Loose}
          defaultEdgeOptions={defaultEdgeOptions}
          minZoom={0.1}
          maxZoom={8}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          proOptions={{ hideAttribution: true }}
          className="p3-canvas"
          deleteKeyCode={null}
          zoomOnDoubleClick={false}
          panOnScroll
        >
          {/* 顶栏：集数切换 */}
          <EpisodeBar projectId={projectId} />

          {/* 底部工具栏 */}
          <BottomBar />

          {/* 右下：xyflow 缩放控件组 + 官方小地图（可拖拽 / 滚轮缩放） */}
          <Controls showInteractive={false} position="bottom-right" />
          {minimap && (
            <MiniMap
              position="bottom-right"
              pannable
              zoomable
              className="p3-minimap-flow"
              nodeColor={miniNodeColor}
              nodeStrokeColor="transparent"
              maskColor="rgba(18, 18, 18, 0.06)"
            />
          )}
        </ReactFlow>

        {/* 节点右键上下文菜单 */}
        {ctxMenu && ctxNode && (
          <div
            className="p3-ctx-menu"
            style={{ left: ctxMenu.x, top: ctxMenu.y }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {dialogKind === 'image' && (
              <button className="p3-ctx-item" onClick={() => ctxAction('pick-ref')}>
                <ImageIcon size={14} /> 选为图片参考
              </button>
            )}
            <button className="p3-ctx-item" onClick={() => ctxAction('rename')}>
              <Pencil size={14} /> 重命名
            </button>
            <button className="p3-ctx-item" onClick={() => ctxAction('duplicate')}>
              <Copy size={14} /> 复制节点 <kbd className="p3-ctx-kbd">⌘D</kbd>
            </button>
            <button className="p3-ctx-item" onClick={() => ctxAction('toggle-ref')}>
              <Anchor size={14} /> {ctxNode.data.isReference ? '取消参考标记' : '设为参考'}
            </button>
            <div className="p3-ctx-sep" />
            <button className="p3-ctx-item p3-ctx-danger" onClick={() => ctxAction('delete')}>
              <Trash2 size={14} /> 删除 <kbd className="p3-ctx-kbd">Del</kbd>
            </button>
          </div>
        )}

      </div>

      {/* 弹窗层 */}
      <ModelDialog />
      <AssistantPanel projectId={projectId} />
      <AddNodeMenu />
      <ModelSelectDialog />
      <StyleLibraryDialog />
      <AssetLibraryDialog />
      <ShortcutsDialog />
      <ReorganizeConfirm />
      <Director3D projectId={projectId} />
    </div>
  );
};

export default function FreeCanvas3Page() {
  return (
    <ReactFlowProvider>
      <CanvasInner />
    </ReactFlowProvider>
  );
}
