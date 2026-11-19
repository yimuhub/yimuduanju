/**
 * 同构版专用分区尺寸：默认 372（72 rail + 300 素材）/ 430 检查器 / 360 时间线。
 * 与经典版分开存储，切版本不会互相改写尺寸；窄屏只用夹紧值，不污染桌面设置。
 */
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';

export type ParityPaneKind = 'left' | 'right' | 'bottom';

type ParityLayout = { libraryWidth: number; inspectorWidth: number; timelineHeight: number };

const STORAGE_KEY = 'yimu:shenjian:parity-layout:v1';
const DEFAULT_LAYOUT: ParityLayout = { libraryWidth: 372, inspectorWidth: 430, timelineHeight: 360 };
const MIN_LIBRARY = 252; // 72 rail + 180 内容
const MIN_INSPECTOR = 320;
const MIN_STAGE = 360;
const MIN_TIMELINE = 180;

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

function loadLayout(): ParityLayout {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null') as Partial<ParityLayout> | null;
    return {
      libraryWidth: typeof raw?.libraryWidth === 'number' && Number.isFinite(raw.libraryWidth)
        ? clamp(raw.libraryWidth, MIN_LIBRARY, 900)
        : DEFAULT_LAYOUT.libraryWidth,
      inspectorWidth: typeof raw?.inspectorWidth === 'number' && Number.isFinite(raw.inspectorWidth)
        ? clamp(raw.inspectorWidth, MIN_INSPECTOR, 900)
        : DEFAULT_LAYOUT.inspectorWidth,
      timelineHeight: typeof raw?.timelineHeight === 'number' && Number.isFinite(raw.timelineHeight)
        ? clamp(raw.timelineHeight, MIN_TIMELINE, 900)
        : DEFAULT_LAYOUT.timelineHeight,
    };
  } catch {
    return { ...DEFAULT_LAYOUT };
  }
}

const readViewport = () => ({
  width: typeof window === 'undefined' ? 1440 : window.innerWidth,
  height: typeof window === 'undefined' ? 900 : window.innerHeight,
});

function normalize(raw: ParityLayout, viewport: { width: number; height: number }): ParityLayout {
  const maxLib = Math.max(MIN_LIBRARY, viewport.width - raw.inspectorWidth - MIN_STAGE);
  const maxIns = Math.max(MIN_INSPECTOR, viewport.width - raw.libraryWidth - MIN_STAGE);
  const maxTl = Math.max(MIN_TIMELINE, viewport.height - 150);
  return {
    libraryWidth: clamp(raw.libraryWidth, MIN_LIBRARY, maxLib),
    inspectorWidth: clamp(raw.inspectorWidth, MIN_INSPECTOR, maxIns),
    timelineHeight: clamp(raw.timelineHeight, MIN_TIMELINE, maxTl),
  };
}

export function useParityLayout() {
  const [layout, setLayout] = useState<ParityLayout>(loadLayout);
  const [viewport, setViewport] = useState(readViewport);
  const [dragging, setDragging] = useState<ParityPaneKind | null>(null);
  const effective = normalize(layout, viewport);
  const effectiveRef = useRef(effective);
  effectiveRef.current = effective;

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
    } catch {
      // 只保留本会话
    }
  }, [layout]);

  useEffect(() => {
    const onResize = () => setViewport(readViewport());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const startResize = (kind: ParityPaneKind, e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const start = effectiveRef.current;
    const startX = e.clientX;
    const startY = e.clientY;
    const body = document.body;
    const prevCursor = body.style.cursor;
    const prevSelect = body.style.userSelect;
    body.style.cursor = kind === 'bottom' ? 'row-resize' : 'col-resize';
    body.style.userSelect = 'none';
    setDragging(kind);

    const onMove = (ev: PointerEvent) => {
      if (kind === 'left') {
        const max = Math.max(MIN_LIBRARY, window.innerWidth - start.inspectorWidth - MIN_STAGE);
        setLayout((prev) => ({ ...prev, libraryWidth: clamp(start.libraryWidth + ev.clientX - startX, MIN_LIBRARY, max) }));
      } else if (kind === 'right') {
        const max = Math.max(MIN_INSPECTOR, window.innerWidth - start.libraryWidth - MIN_STAGE);
        setLayout((prev) => ({ ...prev, inspectorWidth: clamp(start.inspectorWidth - (ev.clientX - startX), MIN_INSPECTOR, max) }));
      } else {
        const max = Math.max(MIN_TIMELINE, window.innerHeight - 150);
        setLayout((prev) => ({ ...prev, timelineHeight: clamp(start.timelineHeight - (ev.clientY - startY), MIN_TIMELINE, max) }));
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

  const nudge = (kind: ParityPaneKind, delta: number) => {
    const cur = effectiveRef.current;
    setLayout((prev) => {
      if (kind === 'left') {
        const max = Math.max(MIN_LIBRARY, window.innerWidth - cur.inspectorWidth - MIN_STAGE);
        return { ...prev, libraryWidth: clamp(cur.libraryWidth + delta, MIN_LIBRARY, max) };
      }
      if (kind === 'right') {
        const max = Math.max(MIN_INSPECTOR, window.innerWidth - cur.libraryWidth - MIN_STAGE);
        return { ...prev, inspectorWidth: clamp(cur.inspectorWidth - delta, MIN_INSPECTOR, max) };
      }
      const max = Math.max(MIN_TIMELINE, window.innerHeight - 150);
      return { ...prev, timelineHeight: clamp(cur.timelineHeight + delta, MIN_TIMELINE, max) };
    });
  };

  const reset = (kind: ParityPaneKind) => {
    setLayout((prev) => ({
      ...prev,
      ...(kind === 'left'
        ? { libraryWidth: DEFAULT_LAYOUT.libraryWidth }
        : kind === 'right'
          ? { inspectorWidth: DEFAULT_LAYOUT.inspectorWidth }
          : { timelineHeight: DEFAULT_LAYOUT.timelineHeight }),
    }));
  };

  const onResizerKey = (kind: ParityPaneKind) => (e: KeyboardEvent) => {
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
    '--tl-h': `${effective.timelineHeight}px`,
  } as unknown as CSSProperties;

  return { layout: effective, dragging, startResize, nudge, reset, onResizerKey, rootStyle };
}
