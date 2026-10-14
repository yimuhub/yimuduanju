/**
 * 自由画布 3 · 1:1 复刻 Pavo AI Canvas
 * 主页面：React Flow 画布 / 双击建节点 / 端口拖线 / 连线剪刀 / 快捷键 / 参考模式拾取
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  BaseEdge,
  ConnectionMode,
  EdgeLabelRenderer,
  getBezierPath,
  Position,
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
import { Scissors } from 'lucide-react';
import { useParams } from 'react-router-dom';
import { useP3Store } from './pavo3Store';
import { Pavo3Node } from './Pavo3Node';
import { LeftElementsPanel } from './LeftElementsPanel';
import { BottomBar, CanvasMinimap } from './BottomBar';
import { ModelDialog } from './ModelDialog';
import {
  AddNodeMenu,
  AssetLibraryDialog,
  ModelSelectDialog,
  ReorganizeConfirm,
  ShortcutsDialog,
  StyleLibraryDialog,
} from './Dialogs';
import { Director3D } from './Director3D';
import { P3 } from './pavo3Constants';
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
    removeNode,
    setReorganizeConfirm,
  } = useP3Store();
  const lastPaneClick = useRef<{ x: number; y: number; t: number } | null>(null);
  const flowWrapRef = useRef<HTMLDivElement>(null);

  /* ---- 持久化：按项目读/写 localStorage（Pavo 同款：画布自动保存） ---- */
  const { projectName, restoreCanvas } = useP3Store();
  // 路由参数名为 id（project/:id/canvas-free3），之前误读 projectId 导致恒为 undefined、
  // 画布持久化与白模上传都拿不到项目归属；此处修正（白模产线需要真实 projectId）。
  const { id: routeProjectId } = useParams<{ id: string }>();
  const projectId = routeProjectId === 'free' ? undefined : routeProjectId;
  const persistKey = `yimu-free3-${projectId ?? 'default'}`;
  useEffect(() => {
    try {
      // 兼容旧数据：修复前 projectId 恒为 undefined，画布全落在 default 键下；
      // 项目键无数据时回落到 default，避免用户旧画布“丢失”
      const raw = localStorage.getItem(persistKey)
        ?? (projectId ? localStorage.getItem('yimu-free3-default') : null);
      if (raw) {
        const snap = JSON.parse(raw);
        if (snap && Array.isArray(snap.nodes)) restoreCanvas(snap);
      }
    } catch {
      /* 损坏数据忽略 */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persistKey]);
  useEffect(() => {
    try {
      const snap = { nodes, edges, projectName };
      localStorage.setItem(persistKey, JSON.stringify(snap));
    } catch {
      /* 容量不足忽略 */
    }
  }, [nodes, edges, projectName, persistKey]);

  /* ---- 双击画布空白 → 添加节点菜单（原生 dblclick，可靠） ---- */
  useEffect(() => {
    const el = flowWrapRef.current;
    if (!el) return;
    const onDbl = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      // 忽略节点 / 弹窗 / 工具栏上的双击
      if (t.closest('.react-flow__node')) return;
      if (t.closest('.p3-dialog-mask')) return;
      if (t.closest('.p3-tool-panel')) return;
      const x = e.clientX;
      const y = e.clientY;
      closeDialog();
      openAddMenu({ visible: true, x, y });
    };
    el.addEventListener('dblclick', onDbl);
    return () => el.removeEventListener('dblclick', onDbl);
  }, [openAddMenu, closeDialog]);

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

  /* ---- 全局快捷键 ---- */
  const onKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      else if (meta && e.key === 'z' && e.shiftKey) { e.preventDefault(); redo(); }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && !meta) {
        // 删除选中节点
        const sel = useP3Store.getState().selectedNodeIds ?? [];
        sel.forEach((id) => removeNode(id));
      } else if (meta && e.shiftKey && (e.key === 'F' || e.key === 'f')) {
        e.preventDefault();
        setReorganizeConfirm(true);
      } else if (e.key === 'Escape') {
        closeAddMenu();
        closeDialog();
      }
    },
    [undo, redo, removeNode, setReorganizeConfirm, closeAddMenu, closeDialog],
  );

  React.useEffect(() => {
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onKeyDown]);

  /* ---- 选中变化（用于删除） ---- */
  const onSelectionChange = useCallback(({ nodes: sel }: OnSelectionChangeParams) => {
    useP3Store.setState({ selectedNodeIds: sel.map((n) => n.id) });
  }, []);

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
          {/* 底部工具栏 */}
          <BottomBar />
        </ReactFlow>

        {/* 画布小地图（画布外绝对定位） */}
        <CanvasMinimap />

      </div>

      {/* 弹窗层 */}
      <ModelDialog />
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
