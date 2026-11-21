/**
 * HTML 动画工作室的分区尺寸。
 * 对标 OpenMotion / Dockview：左素材、右检查器、底部时间线、代码栏四边都能拖，
 * 双击恢复默认，聚焦后方向键可微调；尺寸持久化且不会把中间舞台挤没。
 */
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';

export type MotionPane = 'left' | 'right' | 'timeline' | 'code';
type Layout = { left: number; right: number; timeline: number; code: number };

const KEY = 'yimu:html-motion:layout:v1';
const DEFAULTS: Layout = { left: 268, right: 306, timeline: 206, code: 520 };
const LIMITS: Record<MotionPane, [number, number]> = {
  left: [220, 420],
  right: [280, 460],
  timeline: [176, 520],
  code: [320, 760],
};
const STAGE_MIN = 300;

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

function load(): Layout {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null') as Partial<Layout> | null;
    return {
      left: clamp(Number(raw?.left) || DEFAULTS.left, ...LIMITS.left),
      right: clamp(Number(raw?.right) || DEFAULTS.right, ...LIMITS.right),
      timeline: clamp(Number(raw?.timeline) || DEFAULTS.timeline, ...LIMITS.timeline),
      code: clamp(Number(raw?.code) || DEFAULTS.code, ...LIMITS.code),
    };
  } catch {
    return { ...DEFAULTS };
  }
}

const viewport = () => ({ w: typeof window === 'undefined' ? 1440 : window.innerWidth, h: typeof window === 'undefined' ? 900 : window.innerHeight });

function normalize(raw: Layout, vp: { w: number; h: number }): Layout {
  const wide = vp.w > 1024;
  // 先按“代码栏最小宽度”算两侧上限，再单独压代码栏；否则代码栏先被存到 760，
  // 会把左右两侧都顶到最小值，舞台反而只剩 238px。
  const left = wide ? clamp(raw.left, LIMITS.left[0], Math.max(LIMITS.left[0], vp.w - raw.right - LIMITS.code[0] - STAGE_MIN - 24)) : raw.left;
  const right = vp.w > 760 ? clamp(raw.right, LIMITS.right[0], Math.max(LIMITS.right[0], vp.w - left - LIMITS.code[0] - STAGE_MIN - 24)) : raw.right;
  const codeMax = Math.max(LIMITS.code[0], vp.w - left - right - STAGE_MIN - 24);
  return {
    left,
    right,
    timeline: clamp(raw.timeline, LIMITS.timeline[0], Math.max(LIMITS.timeline[0], vp.h - 330)),
    code: clamp(raw.code, LIMITS.code[0], Math.min(LIMITS.code[1], codeMax)),
  };
}

export function useMotionLayout() {
  const [layout, setLayout] = useState<Layout>(load);
  const [vp, setVp] = useState(viewport);
  const [dragging, setDragging] = useState<MotionPane | null>(null);
  const effective = normalize(layout, vp);
  const effectiveRef = useRef(effective);
  effectiveRef.current = effective;

  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify(layout)); } catch { /* session only */ }
  }, [layout]);

  useEffect(() => {
    const onResize = () => setVp(viewport());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const startResize = (kind: MotionPane, e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const start = effectiveRef.current;
    const x0 = e.clientX;
    const y0 = e.clientY;
    const body = document.body;
    const prevCursor = body.style.cursor;
    const prevSelect = body.style.userSelect;
    body.style.cursor = kind === 'timeline' ? 'row-resize' : 'col-resize';
    body.style.userSelect = 'none';
    setDragging(kind);
    const onMove = (ev: PointerEvent) => {
      if (kind === 'left') {
        const max = Math.max(LIMITS.left[0], window.innerWidth - start.right - STAGE_MIN - 16);
        setLayout((p) => ({ ...p, left: clamp(start.left + ev.clientX - x0, LIMITS.left[0], max) }));
      } else if (kind === 'right') {
        const max = Math.max(LIMITS.right[0], window.innerWidth - start.left - STAGE_MIN - 16);
        setLayout((p) => ({ ...p, right: clamp(start.right - (ev.clientX - x0), LIMITS.right[0], max) }));
      } else if (kind === 'timeline') {
        const max = Math.max(LIMITS.timeline[0], window.innerHeight - 330);
        setLayout((p) => ({ ...p, timeline: clamp(start.timeline - (ev.clientY - y0), LIMITS.timeline[0], max) }));
      } else {
        const max = Math.max(LIMITS.code[0], window.innerWidth - start.left - start.right - STAGE_MIN - 24);
        setLayout((p) => ({ ...p, code: clamp(start.code - (ev.clientX - x0), LIMITS.code[0], Math.min(LIMITS.code[1], max)) }));
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

  const nudge = (kind: MotionPane, delta: number) => {
    const cur = effectiveRef.current;
    const [min, max] = LIMITS[kind];
    const bound = kind === 'left'
      ? Math.max(min, window.innerWidth - cur.right - cur.code - STAGE_MIN - 24)
      : kind === 'right'
        ? Math.max(min, window.innerWidth - cur.left - cur.code - STAGE_MIN - 24)
        : kind === 'timeline'
          ? Math.max(min, window.innerHeight - 330)
          : Math.max(min, window.innerWidth - cur.left - cur.right - STAGE_MIN - 24);
    setLayout((p) => {
      const value = kind === 'left' ? cur.left + delta
        : kind === 'right' ? cur.right - delta
          : kind === 'timeline' ? cur.timeline + delta
            : cur.code - delta;
      return { ...p, [kind]: clamp(value, min, bound) };
    });
  };

  const reset = (kind: MotionPane) => setLayout((p) => ({ ...p, [kind]: DEFAULTS[kind] }));

  const onResizerKey = (kind: MotionPane) => (e: KeyboardEvent) => {
    const vertical = kind === 'timeline';
    if (vertical && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      nudge(kind, e.key === 'ArrowUp' ? 8 : -8);
    } else if (!vertical && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault();
      nudge(kind, e.key === 'ArrowLeft' ? -8 : 8);
    }
  };

  const rootStyle = {
    '--hm-left-w': `${effective.left}px`,
    '--hm-right-w': `${effective.right}px`,
    '--hm-tl-h': `${effective.timeline}px`,
    '--hm-code-w': `${effective.code}px`,
  } as unknown as CSSProperties;

  return { layout: effective, dragging, startResize, nudge, reset, onResizerKey, rootStyle };
}
