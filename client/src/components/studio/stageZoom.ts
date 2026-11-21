/**
 * 一幕·神剪 · 预览画布缩放/平移的纯数学（对齐 OpenMotion studio/src/components/nle/previewZoom.ts）
 *
 * 坐标模型（与 OpenMotion 同构）：
 * - 画幅 `.canvas-frame` 由 CSS 自适应出「Fit 尺寸」（zoomPercent=100 的基准），缩放只在其上叠加
 *   `translate3d(panX, panY, 0) scale(zoomPercent/100)`，transform-origin 固定 center center；
 * - panX/panY 是「画幅中心相对视口中心的偏移」（单位：屏幕 px），Fit 时恒为 0；
 * - 光标锚定缩放公式 `pan' = cursorRel×(1-ratio) + pan×ratio` 里的 cursorRel 必须
 *   相对「未缩放画幅中心」度量（= 变换后 rect 中心 − 当前 pan），调用方负责换算。
 *
 * 本文件不碰 DOM，全部可单测（test/unit/stage-zoom.spec.ts）。
 */

export interface StageZoomState {
  /** 缩放百分比：100 = 当前自适应的 Fit 尺寸，范围 50–400（scale 0.5–4） */
  zoomPercent: number;
  panX: number;
  panY: number;
}

export const MIN_STAGE_ZOOM_PERCENT = 50;
export const MAX_STAGE_ZOOM_PERCENT = 400;
export const DEFAULT_STAGE_ZOOM: StageZoomState = { zoomPercent: 100, panX: 0, panY: 0 };
/** HUD 消隐时长：最后一次缩放操作 1.2s 后淡出（OpenMotion ZOOM_HUD_TIMEOUT_MS） */
export const STAGE_ZOOM_HUD_TIMEOUT_MS = 1200;
/** 手势沉降时长：停止缩放 200ms 后才把状态提交给 React UI（OpenMotion ZOOM_SETTLE_MS） */
export const STAGE_ZOOM_SETTLE_MS = 200;
/** minimap 导航器最长边（OpenMotion NAVIGATOR_PX） */
export const STAGE_NAVIGATOR_PX = 112;
/** 平移越过内容边缘的回弹余量（OpenMotion PREVIEW_PAN_OVERSCROLL_PX） */
export const STAGE_PAN_OVERSCROLL_PX = 48;
/** 档位预设（OpenMotion ZOOM_PRESETS） */
export const STAGE_ZOOM_PRESETS = [50, 75, 100, 150, 200] as const;

const ZOOM_SENSITIVITY = 0.007;
const MAX_WHEEL_DELTA = 10;

export const isFitZoom = (zoomPercent: number) => Math.abs(zoomPercent - 100) < 0.5;

/** 处于 Fit（100% 且居中）：此时不写 transform、不渲染任何缩放 UI */
export function isStageAtFit(state: StageZoomState): boolean {
  return isFitZoom(state.zoomPercent) && Math.abs(state.panX) < 0.1 && Math.abs(state.panY) < 0.1;
}

/** transform 字符串过高的精度会引发布局抖动，统一 4 位小数 */
export function toDomPrecision(value: number): number {
  return Math.round(value * 10000) / 10000;
}

export function clampStageZoomPercent(percent: number): number {
  if (!Number.isFinite(percent)) return 100;
  return Math.min(MAX_STAGE_ZOOM_PERCENT, Math.max(MIN_STAGE_ZOOM_PERCENT, percent));
}

/** 中键（button=1）拖拽平移；左键留给画面播放/暂停与字幕拖拽 */
export function canStartStagePan(button: number): boolean {
  return button === 1;
}

/** 滚轮 deltaY → 下一档缩放百分比（指数步进，手感与 OpenMotion 一致） */
export function getStageWheelZoomPercent(deltaY: number, currentZoomPercent: number): number {
  if (!Number.isFinite(deltaY)) return clampStageZoomPercent(currentZoomPercent);
  const clamped = Math.abs(deltaY) > MAX_WHEEL_DELTA ? MAX_WHEEL_DELTA * Math.sign(deltaY) : deltaY;
  const step = -clamped * ZOOM_SENSITIVITY;
  const current = clampStageZoomPercent(currentZoomPercent);
  return clampStageZoomPercent(current * Math.exp(step));
}

/**
 * 拖拽/滚轮平移的范围夹紧：内容超出视口时允许平移到边缘 + 回弹余量，
 * 内容小于视口（缩小档）时不允许平移出去。
 */
export function clampStagePan(input: {
  panX: number;
  panY: number;
  zoomPercent: number;
  viewportWidth: number;
  viewportHeight: number;
  contentWidth: number;
  contentHeight: number;
}): Pick<StageZoomState, 'panX' | 'panY'> {
  const scale = clampStageZoomPercent(input.zoomPercent) / 100;
  const maxPanX = Math.max(0, (input.contentWidth * scale - input.viewportWidth) / 2) + STAGE_PAN_OVERSCROLL_PX;
  const maxPanY = Math.max(0, (input.contentHeight * scale - input.viewportHeight) / 2) + STAGE_PAN_OVERSCROLL_PX;
  return {
    panX: Math.min(maxPanX, Math.max(-maxPanX, input.panX)),
    panY: Math.min(maxPanY, Math.max(-maxPanY, input.panY)),
  };
}

/** 光标锚定缩放时的范围夹紧：缩小档下也允许把画幅推离中心（OpenMotion clampPreviewPanForZoom） */
function clampStagePanForZoom(
  panX: number,
  panY: number,
  zoomPercent: number,
  viewportWidth: number,
  viewportHeight: number,
  contentWidth: number,
  contentHeight: number,
): Pick<StageZoomState, 'panX' | 'panY'> {
  const scale = clampStageZoomPercent(zoomPercent) / 100;
  const maxPanX = Math.abs(contentWidth * scale - viewportWidth) / 2 + STAGE_PAN_OVERSCROLL_PX;
  const maxPanY = Math.abs(contentHeight * scale - viewportHeight) / 2 + STAGE_PAN_OVERSCROLL_PX;
  return {
    panX: Math.min(maxPanX, Math.max(-maxPanX, panX)),
    panY: Math.min(maxPanY, Math.max(-maxPanY, panY)),
  };
}

/**
 * Ctrl/⌘+滚轮以光标为锚缩放（OpenMotion resolvePreviewWheelZoom）。
 * cursorX/cursorY 相对「未缩放画幅中心」；缩放前后光标下的画幅点保持不动。
 */
export function resolveStageWheelZoom(input: {
  state: StageZoomState;
  deltaY: number;
  viewportWidth: number;
  viewportHeight: number;
  contentWidth: number;
  contentHeight: number;
  cursorX?: number;
  cursorY?: number;
}): StageZoomState {
  const oldZoom = clampStageZoomPercent(input.state.zoomPercent);
  const nextZoomPercent = getStageWheelZoomPercent(input.deltaY, oldZoom);
  const ratio = nextZoomPercent / oldZoom;

  let panX = input.state.panX;
  let panY = input.state.panY;
  if (input.cursorX !== undefined && input.cursorY !== undefined) {
    panX = input.cursorX * (1 - ratio) + panX * ratio;
    panY = input.cursorY * (1 - ratio) + panY * ratio;
  }

  const pan = clampStagePanForZoom(panX, panY, nextZoomPercent, input.viewportWidth, input.viewportHeight, input.contentWidth, input.contentHeight);
  return { zoomPercent: nextZoomPercent, ...pan };
}

/** 滚轮直接滚动 = 平移（OpenMotion resolvePreviewWheelPan）：滚动方向与内容移动方向一致 */
export function resolveStageWheelPan(input: {
  state: StageZoomState;
  deltaX: number;
  deltaY: number;
  viewportWidth: number;
  viewportHeight: number;
  contentWidth: number;
  contentHeight: number;
}): StageZoomState {
  const pan = clampStagePan({
    panX: input.state.panX - input.deltaX,
    panY: input.state.panY - input.deltaY,
    zoomPercent: input.state.zoomPercent,
    viewportWidth: input.viewportWidth,
    viewportHeight: input.viewportHeight,
    contentWidth: input.contentWidth,
    contentHeight: input.contentHeight,
  });
  return { zoomPercent: clampStageZoomPercent(input.state.zoomPercent), ...pan };
}

/**
 * 当前视口在整幅画幅中的可见区域（minimap 视区矩形），全部为 0-1 归一化比例，
 * 直接映射成 minimap 内的百分比定位。
 */
export function resolveStageVisibleRegion(input: {
  state: StageZoomState;
  viewportWidth: number;
  viewportHeight: number;
  contentWidth: number;
  contentHeight: number;
}): { left: number; top: number; width: number; height: number } {
  const scale = clampStageZoomPercent(input.state.zoomPercent) / 100;
  const axis = (pan: number, view: number, content: number): [number, number] => {
    const size = content * scale;
    if (!(size > 0)) return [0, 1];
    const at = (edge: number) => Math.min(1, Math.max(0, (edge - pan + size / 2) / size));
    const start = at(-view / 2);
    return [start, at(view / 2) - start];
  };
  const [left, width] = axis(input.state.panX, input.viewportWidth, input.contentWidth);
  const [top, height] = axis(input.state.panY, input.viewportHeight, input.contentHeight);
  return { left, top, width, height };
}

/**
 * minimap 反向换算：希望「可见区域中心」落在画幅的 (fx, fy) 归一化位置时应有的平移量。
 * 由 pan = content×scale×(0.5 − 中心比例) 反解（fit 时 fx=fy=0.5 → pan=0）。
 */
export function resolveStagePanToRegionCenter(input: {
  fx: number;
  fy: number;
  zoomPercent: number;
  contentWidth: number;
  contentHeight: number;
  viewportWidth: number;
  viewportHeight: number;
}): Pick<StageZoomState, 'panX' | 'panY'> {
  const scale = clampStageZoomPercent(input.zoomPercent) / 100;
  return clampStagePan({
    panX: input.contentWidth * scale * (0.5 - input.fx),
    panY: input.contentHeight * scale * (0.5 - input.fy),
    zoomPercent: input.zoomPercent,
    viewportWidth: input.viewportWidth,
    viewportHeight: input.viewportHeight,
    contentWidth: input.contentWidth,
    contentHeight: input.contentHeight,
  });
}

/** minimap 内容框尺寸：等比缩到最长边 112px（OpenMotion navigatorFrameSize） */
export function stageNavigatorFrameSize(aspect: number): { width: number; height: number } {
  const ratio = aspect > 0 ? aspect : 16 / 9;
  return ratio >= 1
    ? { width: STAGE_NAVIGATOR_PX, height: toDomPrecision(STAGE_NAVIGATOR_PX / ratio) }
    : { width: toDomPrecision(STAGE_NAVIGATOR_PX * ratio), height: STAGE_NAVIGATOR_PX };
}
