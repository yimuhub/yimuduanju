import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import {
  DEFAULT_PANE_LAYOUT,
  MIN_INSPECTOR_WIDTH,
  MIN_LIBRARY_WIDTH,
  MIN_STAGE_WIDTH,
  MIN_TIMELINE_HEIGHT,
  clampPaneValue,
  normalizePaneLayout,
  type ShenJianPaneLayout,
} from '@shared/pane-layout';

export type PaneKind = 'left' | 'right' | 'bottom';

const STORAGE_KEY = 'yimu:shenjian:pane-layout:v1';
const clamp = clampPaneValue;

function loadLayout(): ShenJianPaneLayout {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null') as Partial<ShenJianPaneLayout> | null;
    return {
      libraryWidth:
        typeof raw?.libraryWidth === 'number' && Number.isFinite(raw.libraryWidth)
          ? clamp(raw.libraryWidth, MIN_LIBRARY_WIDTH, 900)
          : DEFAULT_PANE_LAYOUT.libraryWidth,
      inspectorWidth:
        typeof raw?.inspectorWidth === 'number' && Number.isFinite(raw.inspectorWidth)
          ? clamp(raw.inspectorWidth, MIN_INSPECTOR_WIDTH, 900)
          : DEFAULT_PANE_LAYOUT.inspectorWidth,
      timelineHeight:
        typeof raw?.timelineHeight === 'number' && Number.isFinite(raw.timelineHeight)
          ? clamp(raw.timelineHeight, MIN_TIMELINE_HEIGHT, 900)
          : null,
    };
  } catch {
    return { ...DEFAULT_PANE_LAYOUT };
  }
}

const readViewport = () => ({
  width: typeof window === 'undefined' ? 1440 : window.innerWidth,
  height: typeof window === 'undefined' ? 900 : window.innerHeight,
});

export function useShenJianLayout() {
  const [layout, setLayout] = useState<ShenJianPaneLayout>(loadLayout);
  const [viewport, setViewport] = useState(readViewport);
  const [dragging, setDragging] = useState<PaneKind | null>(null);
  // 持久化保留用户原始尺寸；渲染/拖拽用按当前视口夹紧后的 effective，避免窄屏丢桌面设置。
  const effective = normalizePaneLayout(layout, viewport.width, viewport.height);
  const effectiveRef = useRef(effective);
  effectiveRef.current = effective;

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
    } catch {
      // localStorage 不可用时只保留本会话尺寸
    }
  }, [layout]);

  useEffect(() => {
    const onResize = () => setViewport(readViewport());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const startResize = (kind: PaneKind, e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const start = effectiveRef.current;
    const startX = e.clientX;
    const startY = e.clientY;
    const startTimeline =
      start.timelineHeight ?? document.querySelector('.timeline')?.getBoundingClientRect().height ?? 320;
    const body = document.body;
    const prevCursor = body.style.cursor;
    const prevSelect = body.style.userSelect;
    body.style.cursor = kind === 'bottom' ? 'row-resize' : 'col-resize';
    body.style.userSelect = 'none';
    setDragging(kind);

    const onMove = (ev: PointerEvent) => {
      if (kind === 'left') {
        const max = Math.max(MIN_LIBRARY_WIDTH, window.innerWidth - start.inspectorWidth - MIN_STAGE_WIDTH);
        setLayout((prev) => ({ ...prev, libraryWidth: clamp(start.libraryWidth + ev.clientX - startX, MIN_LIBRARY_WIDTH, max) }));
      } else if (kind === 'right') {
        const max = Math.max(MIN_INSPECTOR_WIDTH, window.innerWidth - start.libraryWidth - MIN_STAGE_WIDTH);
        setLayout((prev) => ({ ...prev, inspectorWidth: clamp(start.inspectorWidth - (ev.clientX - startX), MIN_INSPECTOR_WIDTH, max) }));
      } else {
        const max = Math.max(MIN_TIMELINE_HEIGHT, window.innerHeight - 150);
        setLayout((prev) => ({ ...prev, timelineHeight: clamp(startTimeline - (ev.clientY - startY), MIN_TIMELINE_HEIGHT, max) }));
      }
    };
    const finish = () => {
      window.removeEventListener('pointermove', onMove);
      body.style.cursor = prevCursor;
      body.style.userSelect = prevSelect;
      setDragging(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', finish, { once: true });
    window.addEventListener('pointercancel', finish, { once: true });
  };

  const nudge = (kind: PaneKind, delta: number) => {
    const cur = effectiveRef.current;
    setLayout((prev) => {
      if (kind === 'left') {
        const max = Math.max(MIN_LIBRARY_WIDTH, window.innerWidth - cur.inspectorWidth - MIN_STAGE_WIDTH);
        return { ...prev, libraryWidth: clamp(cur.libraryWidth + delta, MIN_LIBRARY_WIDTH, max) };
      }
      if (kind === 'right') {
        const max = Math.max(MIN_INSPECTOR_WIDTH, window.innerWidth - cur.libraryWidth - MIN_STAGE_WIDTH);
        return { ...prev, inspectorWidth: clamp(cur.inspectorWidth - delta, MIN_INSPECTOR_WIDTH, max) };
      }
      const start = cur.timelineHeight ?? document.querySelector('.timeline')?.getBoundingClientRect().height ?? 320;
      const max = Math.max(MIN_TIMELINE_HEIGHT, window.innerHeight - 150);
      return { ...prev, timelineHeight: clamp(start + delta, MIN_TIMELINE_HEIGHT, max) };
    });
  };

  const reset = (kind: PaneKind) => {
    setLayout((prev) => ({
      ...prev,
      ...(kind === 'left'
        ? { libraryWidth: DEFAULT_PANE_LAYOUT.libraryWidth }
        : kind === 'right'
          ? { inspectorWidth: DEFAULT_PANE_LAYOUT.inspectorWidth }
          : { timelineHeight: null }),
    }));
  };

  const onResizerKey = (kind: PaneKind) => (e: KeyboardEvent) => {
    const step = 8;
    if (kind === 'left' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault();
      nudge('left', e.key === 'ArrowRight' ? step : -step);
    } else if (kind === 'right' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault();
      nudge('right', e.key === 'ArrowLeft' ? step : -step);
    } else if (kind === 'bottom' && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      nudge('bottom', e.key === 'ArrowUp' ? step : -step);
    }
  };

  const rootStyle = {
    '--lib-w': `${effective.libraryWidth}px`,
    '--ins-w': `${effective.inspectorWidth}px`,
    ...(effective.timelineHeight != null ? { '--tl-h': `${effective.timelineHeight}px` } : {}),
  } as unknown as CSSProperties;

  return { layout: effective, dragging, startResize, nudge, reset, onResizerKey, rootStyle };
}
