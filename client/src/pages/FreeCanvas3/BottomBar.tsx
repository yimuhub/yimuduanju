/**
 * 自由画布 · 1:1 复刻 Pavo AI Canvas
 * 底部工具栏：整理画布 / 画布小地图 / 网格吸附 / 缩放选项 / 添加节点 / 历史资产 / 快捷键
 */
import React, { useState } from 'react';
import { Panel, useReactFlow, useStore } from '@xyflow/react';
import { useParams } from 'react-router-dom';
import {
  LayoutGrid,
  Map,
  Grid3X3,
  ZoomIn,
  ZoomOut,
  Maximize,
  Plus,
  Clock,
  Keyboard,
  ChevronDown,
  Undo2,
  Redo2,
  Film,
} from 'lucide-react';
import { toast } from 'sonner';
import { useP3Store } from './pavo3Store';
import { P3 } from './pavo3Constants';

const ZOOM_OPTIONS = [
  { label: '放大', key: 'in', icon: <ZoomIn size={15} />, kbd: '⌘+' },
  { label: '缩小', key: 'out', icon: <ZoomOut size={15} />, kbd: '⌘-' },
  { label: '适合屏幕', key: 'fit', icon: <Maximize size={15} />, kbd: '⌘0' },
  { label: '缩放至50%', key: '50' },
  { label: '缩放至100%', key: '100' },
  { label: '缩放至800%', key: '800' },
];

export const BottomBar = () => {
  const { zoomIn, zoomOut, fitView, zoomTo } = useReactFlow();
  const zoom = useStore((s) => s.transform[2]);
  const {
    minimap,
    toggleMinimap,
    snapGrid,
    toggleSnapGrid,
    setReorganizeConfirm,
    setAssetsOpen,
    setShortcutsOpen,
    openAddMenu,
  } = useP3Store();
  const [zoomOpen, setZoomOpen] = useState(false);
  const { id: routeProjectId } = useParams<{ id: string }>();
  const projectId = routeProjectId === 'free' ? undefined : routeProjectId;
  const [pulling, setPulling] = useState(false);

  // 「分镜上画布」：后端分镜表全量镜头一键落画布（竖排流水线，已有节点仅刷新媒体）
  const pullStoryboard = async () => {
    if (!projectId || pulling) return;
    setPulling(true);
    try {
      const added = await useP3Store.getState().pullStoryboard(projectId);
      if (added > 0) toast.success(`已把后端分镜落上画布：新增 ${added} 个节点`);
      else toast.success('分镜已与画布同步（无新增节点，已有镜头媒体已刷新）');
    } catch {
      toast.error('分镜同步失败，请确认后端服务可达');
    } finally {
      setPulling(false);
    }
  };

  const pct = Math.round(zoom * 100);

  // 底部「添加节点」复用全局双击菜单（fixed 渲染在根层，避免被 React Flow Panel 裁剪）
  const openCentralAddMenu = () => {
    openAddMenu({
      visible: true,
      x: Math.round(window.innerWidth / 2 - 74),
      y: Math.round(window.innerHeight / 2 - 150),
    });
  };

  const toolBtn = (active: boolean): React.CSSProperties => ({
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    width: 32, height: 32, borderRadius: 8, cursor: 'pointer',
    color: active ? P3.primary : P3.text,
    background: active ? 'rgba(10,188,207,0.1)' : 'transparent',
    position: 'relative',
  });

  return (
    <>
      {/* 左下：整理 / 小地图 / 网格 / 缩放 */}
      <Panel position="bottom-left">
        <div className="p3-tool-panel">
          <button
            style={toolBtn(false)}
            title="整理画布 ⌥⇧F"
            onClick={() => useP3Store.getState().startReorganize()}
          >
            <LayoutGrid size={16} />
          </button>
          <button
            style={toolBtn(minimap)}
            title="画布小地图"
            aria-pressed={minimap}
            onClick={toggleMinimap}
          >
            <Map size={16} />
          </button>
          <button
            style={toolBtn(snapGrid)}
            title="网格吸附"
            aria-pressed={snapGrid}
            onClick={toggleSnapGrid}
          >
            <Grid3X3 size={16} />
          </button>
          <div style={{ width: 1, height: 18, background: P3.border, margin: '0 4px' }} />
          <div style={{ position: 'relative' }}>
            <button
              style={{ ...toolBtn(false), width: 'auto', padding: '0 10px', gap: 4, fontSize: 13 }}
              onClick={() => setZoomOpen((v) => !v)}
            >
              {pct}%
              <ChevronDown size={13} color={P3.helper} />
            </button>
            {zoomOpen && (
              <div
                style={{
                  position: 'absolute', left: 0, bottom: 'calc(100% + 8px)', zIndex: 70,
                  background: '#fff', border: `1px solid ${P3.border}`, borderRadius: 12,
                  boxShadow: '0 8px 24px rgba(0,0,0,0.12)', padding: 6, minWidth: 170,
                }}
              >
                {ZOOM_OPTIONS.map((z) => (
                  <button
                    key={z.key}
                    onClick={() => {
                      setZoomOpen(false);
                      if (z.key === 'in') zoomIn();
                      else if (z.key === 'out') zoomOut();
                      else if (z.key === 'fit') fitView({ padding: 0.15, duration: 300 });
                      else zoomTo(Number(z.key) / 100);
                    }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                      padding: '7px 10px', borderRadius: 8, fontSize: 13, cursor: 'pointer',
                      color: P3.text, textAlign: 'left',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = P3.hover)}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                  >
                    {z.icon}
                    {z.label}
                    <span style={{ marginLeft: 'auto', fontSize: 11, color: P3.faint }}>{z.kbd}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </Panel>

      {/* 底部中央：添加节点 / 历史资产 / 快捷键 */}
      <Panel position="bottom-center">
        <div className="p3-tool-panel p3-bottom-center">
          <button style={toolBtn(false)} title="撤销" onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true }))}>
            <Undo2 size={16} />
          </button>
          <button style={toolBtn(false)} title="重做" onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true, shiftKey: true }))}>
            <Redo2 size={16} />
          </button>
          <div style={{ width: 1, height: 18, background: P3.border, margin: '0 4px' }} />
          <button style={toolBtn(false)} title="添加节点" onClick={openCentralAddMenu}>
            <Plus size={18} />
          </button>
          {projectId && (
            <button
              style={{ ...toolBtn(pulling), width: 'auto', padding: '0 10px', gap: 5, fontSize: 12.5, fontWeight: 500 }}
              title="拉取后端分镜表：全量镜头按「首帧 → 视频」竖排流水线上画布（已在画布的镜头仅刷新媒体）"
              onClick={pullStoryboard}
              disabled={pulling}
            >
              <Film size={15} className={pulling ? 'p3-spin' : undefined} />
              {pulling ? '同步中…' : '分镜上画布'}
            </button>
          )}
          <button style={toolBtn(false)} title="历史资产" onClick={() => setAssetsOpen(true)}>
            <Clock size={16} />
          </button>
          <button style={toolBtn(false)} title="快捷键" onClick={() => setShortcutsOpen(true)}>
            <Keyboard size={16} />
          </button>
        </div>
      </Panel>
    </>
  );
};
