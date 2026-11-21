/**
 * 一幕·神剪 · 预览缩放配套 UI（对齐 OpenMotion PreviewZoomOverlay.tsx）
 * - StageZoomControls：画布控制条右侧的缩放档位菜单（50/75/100/150/200% + 适应）+ 快捷 Fit
 * - StageZoomHud：右下角缩放百分比 HUD，1.2s 无操作消隐；纯展示层，pointer-events 关闭不挡字幕拖拽
 * - StageMinimap：右下角 112px 导航器，视区矩形可拖拽平移主画布；鼠标离开 2s 折叠成小图标
 *
 * 缩放/平移的数学在 stageZoom.ts，画幅 transform 由 ShenJianStage 直写 DOM，本文件只做展示与交互。
 */
import { memo, useEffect, useRef, useState, type RefObject } from 'react';
import { ChevronDown, Map as MapIcon } from 'lucide-react';
import {
  isStageAtFit,
  stageNavigatorFrameSize,
  STAGE_ZOOM_PRESETS,
  type StageZoomState,
} from './stageZoom';

/**
 * 缩放档位菜单 + 快捷适应按钮（挂在画布控制条右侧，不随画布缩放）。
 * Fit 旁弹出预设菜单：radio 勾选当前档，选档后平移归零（OpenMotion 同语义）。
 */
export const StageZoomControls = memo(function StageZoomControls({
  zoom,
  onZoomPercent,
  onFit,
}: {
  zoom: StageZoomState;
  onZoomPercent: (percent: number) => void;
  onFit: () => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const atFit = isStageAtFit(zoom);
  const currentPercent = Math.round(zoom.zoomPercent);

  // 菜单自身的外点/Esc 关闭：capture 阶段吞掉 Esc，避免冒泡到全局快捷键后顺手复位画布
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  return (
    <div className="stage-zoom-controls" ref={rootRef}>
      {!atFit ? (
        <button
          type="button"
          className="icon-btn stage-zoom-fit"
          data-tip="适应画布：整幅画面铺满预览区 (Esc / 双击画布)"
          onClick={() => { setOpen(false); onFit(); }}
        >
          适应
        </button>
      ) : null}
      <div className="stage-zoom-menu-anchor">
        <button
          type="button"
          className={`stage-zoom-trigger${open ? ' open' : ''}`}
          data-tip="缩放档位：Ctrl/⌘+滚轮以光标为锚缩放，滚轮平移，中键拖拽平移"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <span className="stage-zoom-trigger-val">{atFit ? '适应' : `${currentPercent}%`}</span>
          <ChevronDown size={12} />
        </button>
        {open ? (
          <div className="stage-zoom-pop" role="menu" aria-label="预览缩放档位">
            {STAGE_ZOOM_PRESETS.map((percent) => (
              <button
                key={percent}
                type="button"
                role="menuitemradio"
                aria-checked={currentPercent === percent}
                className={`stage-zoom-item${currentPercent === percent ? ' checked' : ''}`}
                onClick={() => { setOpen(false); onZoomPercent(percent); }}
              >
                <span className="stage-zoom-radio" />
                {percent}%
              </button>
            ))}
            <div className="stage-zoom-sep" />
            <button
              type="button"
              role="menuitemradio"
              aria-checked={atFit}
              className={`stage-zoom-item${atFit ? ' checked' : ''}`}
              onClick={() => { setOpen(false); onFit(); }}
            >
              <span className="stage-zoom-radio" />
              适应
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
});

/**
 * 右下角 HUD：缩放时显示百分比（Fit 复位时显示「适应」），1.2s 无操作淡出。
 * 文案与透明度由 ShenJianStage 在手势里直写 DOM（不触发重渲染），这里只是挂载节点。
 */
export const StageZoomHud = memo(function StageZoomHud({ hudRef }: { hudRef: RefObject<HTMLDivElement | null> }) {
  return (
    <div
      ref={hudRef}
      className="stage-zoom-hud"
      style={{ opacity: 0, transition: 'opacity 200ms ease-in' }}
      aria-live="polite"
    />
  );
});

/**
 * minimap 导航器：整幅画幅的等比缩略框（最长边 112px）+ 当前视区矩形。
 * 内容方案：用当前片段媒体的静态副本（图片直接 img；视频取首帧的暂停 <video>，不逐帧截图、
 * 不持续解码；blob:/跨域媒体退化为纯色块）——导航器的核心信息是视区矩形位置。
 * 视区矩形位置由 ShenJianStage 每次写 transform 时直写 DOM，同步零渲染开销；
 * 矩形可拖拽（含点按跳转）平移主画布。鼠标离开 2s 折叠成小图标，hover 展开：
 * OpenMotion 无此细节，这里为了避免缩放状态下常驻遮挡右下角画面而取舍加入。
 */
export const StageMinimap = memo(function StageMinimap({
  zoom,
  aspect,
  mediaUrl,
  mediaIsStill,
  regionRef,
  onPanToFrac,
}: {
  zoom: StageZoomState;
  /** 画幅宽高比（timeline.width / height），与画布 frame 同形 */
  aspect: number;
  mediaUrl: string;
  mediaIsStill: boolean;
  /** ShenJianStage 提供的回调 ref：节点挂载/卸载时立即同步一次视区矩形 */
  regionRef: (node: HTMLDivElement | null) => void;
  onPanToFrac: (fx: number, fy: number) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [mediaFailed, setMediaFailed] = useState(false);
  const frameBoxRef = useRef<HTMLDivElement | null>(null);
  // regionRef 是回调 ref（父层在挂载时直写矩形），这里镜像一份读取最新节点
  const regionNodeRef = useRef<HTMLDivElement | null>(null);
  const collapseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoverRef = useRef(false);
  const dragRef = useRef<{ pointerId: number; grabX: number; grabY: number } | null>(null);

  const setRegionBoth = (node: HTMLDivElement | null) => {
    regionNodeRef.current = node;
    regionRef(node);
  };

  const expand = () => {
    if (collapseTimerRef.current) clearTimeout(collapseTimerRef.current);
    collapseTimerRef.current = null;
    setCollapsed(false);
  };
  const scheduleCollapse = () => {
    if (collapseTimerRef.current) clearTimeout(collapseTimerRef.current);
    collapseTimerRef.current = setTimeout(() => setCollapsed(true), 2000);
  };

  // 换档（新的缩放手势）时重新展开；指针不在其上时 2s 后折叠，避免常驻遮挡右下画面。
  // 折叠期间 hover 展开（onPointerEnter），拖拽视区矩形期间指针在框上不会折叠。
  useEffect(() => {
    expand();
    if (!hoverRef.current) scheduleCollapse();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom.zoomPercent]);
  useEffect(() => () => {
    if (collapseTimerRef.current) clearTimeout(collapseTimerRef.current);
  }, []);
  // 媒体切换后重试副本加载
  useEffect(() => setMediaFailed(false), [mediaUrl]);

  /** 屏幕点击点 → 画幅归一化坐标（minimap 框与画幅同比例，比例可直接换用） */
  const fracOf = (clientX: number, clientY: number) => {
    const frame = frameBoxRef.current;
    if (!frame) return null;
    const rect = frame.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    return {
      fx: Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)),
      fy: Math.min(1, Math.max(0, (clientY - rect.top) / rect.height)),
    };
  };

  /** 视区矩形当前中心（父层直写的百分比样式），拖拽时保持抓取偏移不跳变 */
  const regionCenter = () => {
    const region = regionNodeRef.current;
    if (!region) return { cx: 0.5, cy: 0.5 };
    const left = parseFloat(region.style.left || '0');
    const top = parseFloat(region.style.top || '0');
    const width = parseFloat(region.style.width || '0');
    const height = parseFloat(region.style.height || '0');
    return { cx: left + width / 2, cy: top + height / 2 };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const frac = fracOf(e.clientX, e.clientY);
    if (!frac) return;
    e.preventDefault();
    e.stopPropagation();
    frameBoxRef.current?.setPointerCapture(e.pointerId);
    const center = regionCenter();
    const grabX = center.cx - frac.fx;
    const grabY = center.cy - frac.fy;
    dragRef.current = { pointerId: e.pointerId, grabX, grabY };
    onPanToFrac(Math.min(1, Math.max(0, frac.fx + grabX)), Math.min(1, Math.max(0, frac.fy + grabY)));
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    const frac = fracOf(e.clientX, e.clientY);
    if (!frac) return;
    e.preventDefault();
    onPanToFrac(Math.min(1, Math.max(0, frac.fx + drag.grabX)), Math.min(1, Math.max(0, frac.fy + drag.grabY)));
  };
  const finishDrag = (e: React.PointerEvent) => {
    if (dragRef.current?.pointerId === e.pointerId) dragRef.current = null;
  };

  if (isStageAtFit(zoom)) return null;

  const frameSize = stageNavigatorFrameSize(aspect);
  // 静态媒体副本：视频取首帧（media fragment 对 blob: 无效），加载失败退化为色块
  const replicaSrc = mediaUrl && !mediaUrl.startsWith('blob:') && !mediaIsStill ? `${mediaUrl}#t=0.1` : mediaUrl;

  return (
    <div
      className={`stage-minimap${collapsed ? ' collapsed' : ''}`}
      onPointerEnter={() => { hoverRef.current = true; expand(); }}
      onPointerLeave={() => { hoverRef.current = false; scheduleCollapse(); }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finishDrag}
      onPointerCancel={finishDrag}
      onDoubleClick={(e) => e.stopPropagation()}
      data-testid="stage-zoom-minimap"
    >
      {collapsed ? (
        <span className="stage-minimap-collapsed" aria-hidden>
          <MapIcon size={14} />
        </span>
      ) : (
        <div className="stage-minimap-frame" ref={frameBoxRef} style={frameSize}>
          {replicaSrc && !mediaFailed ? (
            mediaIsStill ? (
              <img className="stage-minimap-media" src={replicaSrc} alt="" draggable={false} onError={() => setMediaFailed(true)} />
            ) : (
              <video
                key={replicaSrc}
                className="stage-minimap-media"
                src={replicaSrc}
                muted
                playsInline
                preload="metadata"
                onError={() => setMediaFailed(true)}
              />
            )
          ) : null}
          <div ref={setRegionBoth} className="stage-minimap-region" data-testid="stage-zoom-minimap-region" />
        </div>
      )}
    </div>
  );
});
