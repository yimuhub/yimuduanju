/**
 * 预览缩放/平移纯数学单测（stageZoom.ts，对齐 OpenMotion previewZoom.test.ts 的关键语义）
 * -------------------------------------------------------------
 * 覆盖：缩放档位夹紧、滚轮指数步进、光标锚定缩放（光标下画幅点不动）、
 *       滚轮/拖拽平移夹紧与回弹余量、可视区（minimap 视区矩形）、
 *       minimap 反向换算（pan ⇆ 可视区中心 互推）、导航器框尺寸。
 * 这是「字幕拖拽/安全区坐标系在缩放后不漂移」换算链的正确性底线。
 */
import {
  canStartStagePan,
  clampStagePan,
  clampStageZoomPercent,
  DEFAULT_STAGE_ZOOM,
  getStageWheelZoomPercent,
  isStageAtFit,
  MAX_STAGE_ZOOM_PERCENT,
  MIN_STAGE_ZOOM_PERCENT,
  resolveStagePanToRegionCenter,
  resolveStageVisibleRegion,
  resolveStageWheelPan,
  resolveStageWheelZoom,
  STAGE_NAVIGATOR_PX,
  stageNavigatorFrameSize,
} from '../../client/src/components/studio/stageZoom';

/** 视口 1000×500，画幅 Fit 尺寸 500×500（缩小档下左右留白，放大档下溢出） */
const VIEW = { viewportWidth: 1000, viewportHeight: 500, contentWidth: 500, contentHeight: 500 };

describe('clampStageZoomPercent', () => {
  it('夹在 50–400（scale 0.5–4）之间', () => {
    expect(MIN_STAGE_ZOOM_PERCENT).toBe(50);
    expect(MAX_STAGE_ZOOM_PERCENT).toBe(400);
    expect(clampStageZoomPercent(10)).toBe(50);
    expect(clampStageZoomPercent(150)).toBe(150);
    expect(clampStageZoomPercent(999)).toBe(400);
    expect(clampStageZoomPercent(Number.NaN)).toBe(100);
  });
});

describe('getStageWheelZoomPercent', () => {
  it('deltaY 指数步进：向上放大、向下缩小', () => {
    const up = getStageWheelZoomPercent(-10, 100);
    const down = getStageWheelZoomPercent(10, 100);
    expect(up).toBeGreaterThan(100);
    expect(down).toBeLessThan(100);
    // step = -clampedDelta × 0.007，指数曲线手感与 OpenMotion 一致
    expect(up).toBeCloseTo(100 * Math.exp(0.07), 6);
    expect(down).toBeCloseTo(100 * Math.exp(-0.07), 6);
  });

  it('超过 MAX_DELTA 的大幅滚动被钳制，不会一步跳满', () => {
    expect(getStageWheelZoomPercent(-1000, 100)).toBe(getStageWheelZoomPercent(-10, 100));
    expect(getStageWheelZoomPercent(1000, 100)).toBe(getStageWheelZoomPercent(10, 100));
  });
});

describe('resolveStageWheelZoom 光标锚定', () => {
  it('缩放前后光标下的画幅点保持不动', () => {
    // 光标在画幅内 (400, 300)（相对未缩放画幅中心，视口中心 = 画幅中心时 client 即 cursorRel）
    const cursor = { cursorX: 400, cursorY: 300 };
    const next = resolveStageWheelZoom({ state: { ...DEFAULT_STAGE_ZOOM }, deltaY: -10, ...VIEW, ...cursor });
    expect(next.zoomPercent).toBeGreaterThan(100);
    // 新可见中心应偏向光标方向：pan 为负（画幅向左上移），使光标处内容放大后仍留在原位
    expect(next.panX).toBeLessThan(0);
    expect(next.panY).toBeLessThan(0);
    // 不变量：光标相对「视口中心 + pan」的偏移按缩放比缩放后仍指向同一画幅点
    const scale = next.zoomPercent / 100;
    // 画幅点 p 满足 screen = center + pan + p * scale → p = (cursorRel - pan) / scale
    const pBefore = (cursor.cursorX - 0) / 1;
    const pAfter = (cursor.cursorX - next.panX) / scale;
    expect(pAfter).toBeCloseTo(pBefore, 6);
  });

  it('向缩小档缩放时 pan 被夹回，不会把画幅推出可视范围', () => {
    const next = resolveStageWheelZoom({
      state: { zoomPercent: 400, panX: 900, panY: 500 },
      deltaY: 10,
      ...VIEW,
      cursorX: 0,
      cursorY: 0,
    });
    const scale = next.zoomPercent / 100;
    const maxPanX = Math.abs(VIEW.contentWidth * scale - VIEW.viewportWidth) / 2 + 48;
    expect(Math.abs(next.panX)).toBeLessThanOrEqual(maxPanX + 1e-6);
  });
});

describe('clampStagePan / resolveStageWheelPan', () => {
  it('平移限制在内容边缘 + 48px 回弹余量内', () => {
    const scale = 2; // 200%：内容 1000×1000，视口 1000×500
    const pan = clampStagePan({
      panX: 9999,
      panY: -9999,
      zoomPercent: 200,
      ...VIEW,
    });
    expect(pan.panX).toBeCloseTo((VIEW.contentWidth * scale - VIEW.viewportWidth) / 2 + 48, 6);
    expect(pan.panY).toBeCloseTo(-((VIEW.contentHeight * scale - VIEW.viewportHeight) / 2 + 48), 6);
  });

  it('内容小于视口（缩小档）时不允许平移出去', () => {
    const pan = clampStagePan({ panX: -300, panY: 300, zoomPercent: 50, ...VIEW });
    // 50%：内容 250×250，小于视口 → maxPan 只有回弹余量 48
    expect(Math.abs(pan.panX)).toBeLessThanOrEqual(48 + 1e-6);
    expect(Math.abs(pan.panY)).toBeLessThanOrEqual(48 + 1e-6);
  });

  it('滚轮平移方向与滚动方向一致（内容跟随手指）', () => {
    const next = resolveStageWheelPan({ state: { ...DEFAULT_STAGE_ZOOM, zoomPercent: 200 }, deltaX: 30, deltaY: -20, ...VIEW });
    expect(next.panX).toBe(-30);
    expect(next.panY).toBe(20);
  });
});

describe('resolveStageVisibleRegion（minimap 视区矩形）', () => {
  it('Fit 且居中时可见区覆盖整幅画幅', () => {
    const region = resolveStageVisibleRegion({ state: { ...DEFAULT_STAGE_ZOOM }, ...VIEW });
    expect(region.left).toBeCloseTo(0, 6);
    expect(region.top).toBeCloseTo(0, 6);
    expect(region.width).toBeCloseTo(1, 6);
    expect(region.height).toBeCloseTo(1, 6);
  });

  it('200% 放大时可见区收窄，居中时位于画幅中部', () => {
    // 视口 1000×500、画幅 500×500：200% 时横向恰好铺满（宽 1），纵向只看到一半（高 0.5）
    const region = resolveStageVisibleRegion({ state: { zoomPercent: 200, panX: 0, panY: 0 }, ...VIEW });
    expect(region.width).toBeCloseTo(1, 6);
    expect(region.height).toBeCloseTo(0.5, 6);
    expect(region.left).toBeCloseTo(0, 6);
    expect(region.top).toBeCloseTo(0.25, 6);
  });

  it('平移后可见区随之移动并被画幅边界截断', () => {
    // 200%：内容 1000×1000。panY=+250 → 画面整体下移，视口只看到画幅上半部（top 0，height 0.5）
    const region = resolveStageVisibleRegion({ state: { zoomPercent: 200, panX: 0, panY: 250 }, ...VIEW });
    expect(region.top).toBeCloseTo(0, 6);
    expect(region.height).toBeCloseTo(0.5, 6);
  });
});

describe('resolveStagePanToRegionCenter（minimap 反向换算）', () => {
  it('与 resolveStageVisibleRegion 互为反函数（可达范围内）', () => {
    // 纵向：200% 时内容(1000px) > 视口(500px)，可见区高 0.5，中心可达范围 [0.25, 0.75]
    for (const fy of [0.25, 0.4, 0.5, 0.6, 0.75]) {
      const pan = resolveStagePanToRegionCenter({ fx: 0.5, fy, zoomPercent: 200, ...VIEW });
      const region = resolveStageVisibleRegion({ state: { zoomPercent: 200, ...pan }, ...VIEW });
      const cy = region.top + region.height / 2;
      expect(cy).toBeCloseTo(fy, 5);
    }
    // 横向：200% 时内容宽恰好等于视口宽，中心只能在 0.5 附近 ±48px 回弹内移动
    const edge = resolveStagePanToRegionCenter({ fx: 0.2, fy: 0.5, zoomPercent: 200, ...VIEW });
    expect(Math.abs(edge.panX)).toBeLessThanOrEqual(48 + 1e-6);
    const region = resolveStageVisibleRegion({ state: { zoomPercent: 200, ...edge }, ...VIEW });
    expect(region.left + region.width / 2).toBeGreaterThan(0.4);
  });

  it('Fit 时点画幅中心 pan 归零', () => {
    const pan = resolveStagePanToRegionCenter({ fx: 0.5, fy: 0.5, zoomPercent: 100, ...VIEW });
    expect(pan.panX).toBe(0);
    expect(pan.panY).toBe(0);
  });
});

describe('stageNavigatorFrameSize', () => {
  it('横画幅：宽 112，高按比例缩小', () => {
    expect(stageNavigatorFrameSize(16 / 9)).toEqual({ width: 112, height: 63 });
    expect(stageNavigatorFrameSize(16 / 9).height).toBeCloseTo(112 / (16 / 9), 4);
  });

  it('竖画幅：高 112，宽按比例缩小', () => {
    const size = stageNavigatorFrameSize(9 / 16);
    expect(size.height).toBe(STAGE_NAVIGATOR_PX);
    expect(size.width).toBeCloseTo(112 * (9 / 16), 4);
  });
});

describe('isStageAtFit / canStartStagePan', () => {
  it('Fit 判定：100% 且居中；pan 微动即不算 Fit', () => {
    expect(isStageAtFit(DEFAULT_STAGE_ZOOM)).toBe(true);
    expect(isStageAtFit({ zoomPercent: 100.4, panX: 0, panY: 0 })).toBe(true);
    expect(isStageAtFit({ zoomPercent: 100, panX: 0.2, panY: 0 })).toBe(false);
    expect(isStageAtFit({ zoomPercent: 150, panX: 0, panY: 0 })).toBe(false);
  });

  it('只有中键能发起平移拖拽，左键留给播放/字幕', () => {
    expect(canStartStagePan(1)).toBe(true);
    expect(canStartStagePan(0)).toBe(false);
    expect(canStartStagePan(2)).toBe(false);
  });
});
