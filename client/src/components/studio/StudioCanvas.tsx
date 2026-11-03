/**
 * Studio · 无限画布视图（方案 F 新增）
 * -------------------------------------------------------------
 * 交互（设计稿 .cv-hint 标注）：
 *   拖拽空白 → 平移 · 滚轮 → 缩放 · 拖动卡片 → 重排 · 点击卡片 → 同步预览/时间线
 *
 * 数据来自单一数据源 shots：画布节点 = 镜头，分带 = 场次，
 * 连线 = 同场相邻镜 + 跨场跳转（虚线）。选中态与右坞预览、时间线同源。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStudio } from './StudioShell';
import { shotLabel, stateChip, stateShort, type StudioScene, type StudioShot } from './model';

const NODE_W = 150;
const NODE_H = 94;
const GAP = 16;
const COLS = 4;
const BAND_PAD = 18;
const BAND_GAP = 58;

interface Pt {
  x: number;
  y: number;
}

interface Layout {
  nodes: Map<string, Pt>;
  bands: { scene: StudioScene; x: number; y: number; w: number; h: number }[];
  width: number;
  height: number;
}

/** 按场次分带、场内网格排布 */
function computeLayout(scenes: StudioScene[]): Layout {
  const nodes = new Map<string, Pt>();
  const bands: Layout['bands'] = [];
  let y = 0;
  let maxW = 0;

  for (const scene of scenes) {
    const rows = Math.max(1, Math.ceil(scene.shots.length / COLS));
    scene.shots.forEach((shot, i) => {
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      nodes.set(shot.id, { x: col * (NODE_W + GAP), y: y + row * (NODE_H + GAP) });
    });
    const innerH = rows * NODE_H + (rows - 1) * GAP;
    const w = COLS * (NODE_W + GAP) - GAP + BAND_PAD * 2;
    bands.push({ scene, x: -BAND_PAD, y: y - BAND_PAD, w, h: innerH + BAND_PAD * 2 });
    maxW = Math.max(maxW, w);
    y += innerH + BAND_PAD * 2 + BAND_GAP;
  }
  return { nodes, bands, width: maxW, height: Math.max(0, y - BAND_GAP) };
}

export const StudioCanvas = () => {
  const { data, sel, setSel, setCanvasApi } = useStudio();
  const viewportRef = useRef<HTMLDivElement>(null);

  const [view, setView] = useState<Pt>({ x: 40, y: 24 });
  const [scale, setScale] = useState(1);
  const [panning, setPanning] = useState(false);
  const [dragNode, setDragNode] = useState<string | null>(null);
  const [offsets, setOffsets] = useState<Record<string, Pt>>({});

  const layout = useMemo(() => computeLayout(data.scenes), [data.scenes]);

  /** 缩放（相对视口中心） */
  const zoomAt = useCallback(
    (factor: number) => {
      setScale((prev) => {
        const next = Math.max(0.35, Math.min(2.4, prev * factor));
        return next;
      });
    },
    [],
  );

  /** 适应画布 */
  const fit = useCallback(() => {
    const vp = viewportRef.current;
    if (!vp || layout.width === 0) return;
    const pad = 40;
    const s = Math.min(
      (vp.clientWidth - pad * 2) / layout.width,
      (vp.clientHeight - pad * 2) / Math.max(1, layout.height),
      1.2,
    );
    const next = Math.max(0.35, Math.min(1.2, s));
    setScale(next);
    setView({
      x: Math.max(pad, (vp.clientWidth - layout.width * next) / 2),
      y: Math.max(pad, (vp.clientHeight - layout.height * next) / 2),
    });
  }, [layout.height, layout.width]);

  // 注册给全局快捷键（- / + / 0）
  useEffect(() => {
    setCanvasApi({
      zoomIn: () => zoomAt(1.2),
      zoomOut: () => zoomAt(1 / 1.2),
      fit,
    });
    return () => setCanvasApi(null);
  }, [fit, setCanvasApi, zoomAt]);

  // 滚轮缩放（以指针为中心）
  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return undefined;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = vp.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      setScale((prev) => {
        const next = Math.max(0.35, Math.min(2.4, prev * (e.deltaY < 0 ? 1.12 : 1 / 1.12)));
        // 保持指针下的内容位置不变
        setView((v) => ({
          x: px - ((px - v.x) * next) / prev,
          y: py - ((py - v.y) * next) / prev,
        }));
        return next;
      });
    };
    vp.addEventListener('wheel', onWheel, { passive: false });
    return () => vp.removeEventListener('wheel', onWheel);
  }, []);

  // 指针拖拽：空白平移 / 节点重排
  const dragRef = useRef<{
    mode: 'pan' | 'node';
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    nodeOrigin?: Pt;
  } | null>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    const target = e.target as HTMLElement;
    const nodeEl = target.closest('.cv-node') as HTMLElement | null;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    if (nodeEl?.dataset.shotId) {
      const id = nodeEl.dataset.shotId;
      setDragNode(id);
      const p = layout.nodes.get(id) ?? { x: 0, y: 0 };
      const off = offsets[id] ?? { x: 0, y: 0 };
      dragRef.current = {
        mode: 'node',
        startX: e.clientX,
        startY: e.clientY,
        originX: e.clientX,
        originY: e.clientY,
        nodeOrigin: { x: p.x + off.x, y: p.y + off.y },
      };
    } else {
      setPanning(true);
      dragRef.current = {
        mode: 'pan',
        startX: e.clientX,
        startY: e.clientY,
        originX: view.x,
        originY: view.y,
      };
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    if (d.mode === 'pan') {
      setView({ x: d.originX + (e.clientX - d.startX), y: d.originY + (e.clientY - d.startY) });
    } else if (d.mode === 'node' && d.nodeOrigin && dragNode) {
      const nx = d.nodeOrigin.x + (e.clientX - d.startX) / scale;
      const ny = d.nodeOrigin.y + (e.clientY - d.startY) / scale;
      setOffsets((prev) => ({
        ...prev,
        [dragNode]: { x: nx - (layout.nodes.get(dragNode)?.x ?? 0), y: ny - (layout.nodes.get(dragNode)?.y ?? 0) },
      }));
    }
  };

  const endDrag = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    dragRef.current = null;
    setPanning(false);
    setDragNode(null);
  };

  const nodePos = (shot: StudioShot): Pt => {
    const base = layout.nodes.get(shot.id) ?? { x: 0, y: 0 };
    const off = offsets[shot.id] ?? { x: 0, y: 0 };
    return { x: base.x + off.x, y: base.y + off.y };
  };

  /** 连线：同场相邻镜（实线）+ 跨场（虚线） */
  const edges = useMemo(() => {
    const out: { x1: number; y1: number; x2: number; y2: number; cross: boolean }[] = [];
    const flat: { shot: StudioShot; pos: Pt }[] = [];
    for (const band of layout.bands) {
      for (const shot of band.scene.shots) {
        const pos = layout.nodes.get(shot.id);
        if (pos) flat.push({ shot, pos });
      }
    }
    for (let i = 0; i < flat.length - 1; i += 1) {
      const a = flat[i];
      const b = flat[i + 1];
      const cross = a.shot.sceneId !== b.shot.sceneId;
      out.push({
        x1: a.pos.x + NODE_W / 2,
        y1: a.pos.y + NODE_H / 2,
        x2: b.pos.x + NODE_W / 2,
        y2: b.pos.y + NODE_H / 2,
        cross,
      });
    }
    return out;
  }, [layout]);

  const doneCount = data.shotStats.done;

  return (
    <div className="canvas-view" id="canvasView">
      <div className="cv-bar">
        <span className="cv-title">无限画布</span>
        <span className="chip num">{data.shotStats.total} 镜</span>
        <span className="chip num">{data.scenes.length} 场</span>
        <span className="chip ok num">已渲 {doneCount}</span>
        <div className="spacer" />
        <button
          type="button"
          className="icon-btn"
          onClick={() => zoomAt(1 / 1.2)}
          title="缩小 ( - )"
          aria-label="缩小"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M5 12h14" />
          </svg>
        </button>
        <span className="cv-zoom">{Math.round(scale * 100)}%</span>
        <button
          type="button"
          className="icon-btn"
          onClick={() => zoomAt(1.2)}
          title="放大 ( + )"
          aria-label="放大"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
        <button type="button" className="cv-btn" onClick={fit} title="适应画布 ( 0 )">
          适应
        </button>
      </div>

      <div
        className={`cv-viewport${panning ? ' panning' : ''}`}
        ref={viewportRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <div
          className="cv-world"
          style={{
            transform: `translate(${view.x}px, ${view.y}px) scale(${scale})`,
          }}
        >
          {/* 场次分带 */}
          {layout.bands.map((band) => (
            <div
              key={band.scene.id}
              className="cv-band"
              style={{ left: band.x, top: band.y, width: band.w, height: band.h }}
            >
              <div className="cv-band-h">
                <b>{band.scene.label}</b>
                <i>{band.scene.title || '场次'}</i>
                <span className="num">
                  {band.scene.shots.length} 镜 · {band.scene.dur.toFixed(1)}s
                </span>
              </div>
            </div>
          ))}

          {/* 连线 */}
          <svg className="cv-edges" width={layout.width + 400} height={layout.height + 400}>
            {edges.map((e, i) => (
              <path
                key={i}
                className={e.cross ? 'x' : undefined}
                d={`M ${e.x1} ${e.y1} L ${e.x2} ${e.y2}`}
              />
            ))}
          </svg>

          {/* 镜头节点 */}
          {data.shots.map((shot) => {
            const pos = nodePos(shot);
            const isSel = data.shots[sel]?.id === shot.id;
            return (
              <div
                key={shot.id}
                className={`cv-node${isSel ? ' on' : ''}${dragNode === shot.id ? ' dragging' : ''}`}
                data-shot-id={shot.id}
                data-st={shot.st}
                data-tag={shot.tag}
                style={{ left: pos.x, top: pos.y }}
                onClick={() => setSel(data.shots.findIndex((s) => s.id === shot.id))}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') setSel(data.shots.findIndex((s) => s.id === shot.id));
                }}
              >
                <div className="cv-ntop">
                  <span className="cv-nno">{shotLabel(shot.no)}</span>
                  <span className="cv-ndur">{shot.dur.toFixed(1)}s</span>
                </div>
                <div className="cv-nb">
                  <div className="cv-ntxt">{shot.txt}</div>
                  <div className="cv-nf">
                    <span className={`chip${stateChip(shot.st) ? ` ${stateChip(shot.st)}` : ''}`}>
                      {shot.tag}
                    </span>
                    <span className="cv-nst">{stateShort(shot.st)}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="cv-hint">
          <b>拖拽空白</b>平移 · <b>滚轮</b>缩放 · <b>拖动卡片</b>重排 · <b>点击卡片</b>同步右侧预览与时间线
        </div>
      </div>
    </div>
  );
};
