/**
 * 自由画布 3 · 1:1 复刻 Pavo AI Canvas
 * 底部工具栏：整理画布 / 画布小地图 / 网格吸附 / 缩放选项 / 添加节点 / 历史资产 / 快捷键
 */
import React, { useMemo, useState } from 'react';
import { Panel, useReactFlow, useStore } from '@xyflow/react';
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
} from 'lucide-react';
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

/* ---------------- 画布小地图（自绘，Pavo 风格 165×125） ---------------- */
export const CanvasMinimap = () => {
  const minimap = useP3Store((s) => s.minimap);
  const nodes = useP3Store((s) => s.nodes);
  const { setViewport, getViewport } = useReactFlow();
  const viewport = useStore((s) => s.transform);
  const flowBounds = useStore((s) => {
    const b = s.nodeLookup;
    if (!b.size) return { x: 0, y: 0, w: 400, h: 300 };
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    b.forEach((n) => {
      minX = Math.min(minX, n.internals.positionAbsolute.x);
      minY = Math.min(minY, n.internals.positionAbsolute.y);
      maxX = Math.max(maxX, n.internals.positionAbsolute.x + n.measured.width);
      maxY = Math.max(maxY, n.internals.positionAbsolute.y + n.measured.height);
    });
    return { x: minX - 40, y: minY - 40, w: maxX - minX + 80, h: maxY - minY + 80 };
  });

  const W = 165;
  const H = 125;

  const mm = useMemo(() => {
    if (!flowBounds.w || !flowBounds.h) return null;
    const scale = Math.min(W / flowBounds.w, H / flowBounds.h);
    const ox = (W - flowBounds.w * scale) / 2 - flowBounds.x * scale;
    const oy = (H - flowBounds.h * scale) / 2 - flowBounds.y * scale;
    return { scale, ox, oy };
  }, [flowBounds]);

  if (!minimap) return null;
  if (!mm) return null;

  // 视口框
  const vx = viewport[0] * mm.scale + mm.ox;
  const vy = viewport[1] * mm.scale + mm.oy;
  const vw = (window.innerWidth / viewport[2]) * mm.scale;
  const vh = (window.innerHeight / viewport[2]) * mm.scale;

  return (
    <div
      className="p3-minimap"
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        const px = e.clientX - r.left;
        const py = e.clientY - r.top;
        const fx = (px - mm.ox) / mm.scale;
        const fy = (py - mm.oy) / mm.scale;
        setViewport(
          {
            x: window.innerWidth / 2 - fx * viewport[2],
            y: window.innerHeight / 2 - fy * viewport[2],
            zoom: viewport[2],
          },
          { duration: 300 },
        );
      }}
    >
      <svg width={W} height={H} style={{ display: 'block' }}>
        <rect width={W} height={H} rx={8} fill="#F7F7F7" />
        {/* 节点 */}
        {nodes.map((n) => {
          const nx = (n.position.x + (n.measured?.width ?? 280) / 2) * mm.scale + mm.ox;
          const ny = (n.position.y + (n.measured?.height ?? 120) / 2) * mm.scale + mm.oy;
          const c = n.data.nodeType === 'text' ? '#0ABCCF' : n.data.nodeType === 'image' ? '#7FB8FF' : '#9C9C9C';
          return <rect key={n.id} x={nx - 3} y={ny - 3} width={6} height={6} rx={1.5} fill={c} />;
        })}
        {/* 视口框 */}
        <rect
          x={vx}
          y={vy}
          width={vw}
          height={vh}
          fill="rgba(10,188,207,0.08)"
          stroke="#0ABCCF"
          strokeWidth={1}
          rx={2}
        />
      </svg>
    </div>
  );
};
