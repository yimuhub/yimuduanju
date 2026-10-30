import {
  useEffect,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';

/**
 * TriPane · 全站复用三栏布局系统
 * ─────────────────────────────────────────────
 * 左 | 中 | 右 三栏 + 两条可拖拽分隔条（纯 React + pointer events，零依赖）：
 * - 拖动分隔条调整左/右栏宽度，中栏自适应（flex-1）；拖拽与 hover 时分隔条高亮品牌色
 * - 双击分隔条恢复该侧默认宽度
 * - 尺寸持久化 localStorage（key 前缀 yimu.tripane.，传入 leftKey/rightKey 才持久化）
 * - 中栏保底：minCenterWidth（如 520）保证右栏拉到最宽时中栏仍不小于该值——
 *   空间不足时左右栏允许收缩（shrink），中栏永不小于保底宽度
 * - 窄屏（<lg）退化为单列堆叠：三栏纵向排列（左右栏自然高度、分隔条隐藏），中栏保底高度
 */

const LS_PREFIX = 'yimu.tripane.';

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

const readStoredWidth = (
  key: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number => {
  if (!key) return fallback;
  try {
    const raw = localStorage.getItem(LS_PREFIX + key);
    if (raw) {
      const n = Number(raw);
      if (Number.isFinite(n)) return clamp(n, min, max);
    }
  } catch { /* 忽略坏档 / 隐私模式 */ }
  return fallback;
};

export interface TriPaneProps {
  left: ReactNode;
  center: ReactNode;
  right: ReactNode;
  /** 左栏宽度持久化 key（完整存储 key = yimu.tripane.<leftKey>），不传则不持久化 */
  leftKey?: string;
  /** 右栏宽度持久化 key，不传则不持久化 */
  rightKey?: string;
  defaultLeftWidth?: number;
  defaultRightWidth?: number;
  minLeftWidth?: number;
  maxLeftWidth?: number;
  minRightWidth?: number;
  maxRightWidth?: number;
  /** 中栏保底宽度（px，仅 lg 以上生效）；空间不足时左右栏自动收缩给中栏让位 */
  minCenterWidth?: number;
  className?: string;
}

type DragState = { side: 'left' | 'right'; startX: number; startWidth: number } | null;

const TriPane = ({
  left,
  center,
  right,
  leftKey,
  rightKey,
  defaultLeftWidth = 280,
  defaultRightWidth = 320,
  minLeftWidth = 200,
  maxLeftWidth = 420,
  minRightWidth = 260,
  maxRightWidth = 480,
  minCenterWidth = 0,
  className = '',
}: TriPaneProps) => {
  const [leftWidth, setLeftWidth] = useState(() =>
    readStoredWidth(leftKey, defaultLeftWidth, minLeftWidth, maxLeftWidth),
  );
  const [rightWidth, setRightWidth] = useState(() =>
    readStoredWidth(rightKey, defaultRightWidth, minRightWidth, maxRightWidth),
  );
  const [drag, setDrag] = useState<DragState>(null);

  // 宽度持久化（有 key 才写）
  useEffect(() => {
    if (!leftKey) return;
    try { localStorage.setItem(LS_PREFIX + leftKey, String(leftWidth)); } catch { /* 容量满则忽略 */ }
  }, [leftKey, leftWidth]);
  useEffect(() => {
    if (!rightKey) return;
    try { localStorage.setItem(LS_PREFIX + rightKey, String(rightWidth)); } catch { /* 容量满则忽略 */ }
  }, [rightKey, rightWidth]);

  // 拖拽中：全局 col-resize 光标 + 禁止选中文本
  useEffect(() => {
    if (!drag) return;
    const prevCursor = document.body.style.cursor;
    const prevSelect = document.body.style.userSelect;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    return () => {
      document.body.style.cursor = prevCursor;
      document.body.style.userSelect = prevSelect;
    };
  }, [drag]);

  const startDrag = (side: 'left' | 'right') => (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* 忽略 */ }
    setDrag({
      side,
      startX: e.clientX,
      startWidth: side === 'left' ? leftWidth : rightWidth,
    });
  };

  const onDragMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag) return;
    const delta = e.clientX - drag.startX;
    if (drag.side === 'left') {
      setLeftWidth(clamp(drag.startWidth + delta, minLeftWidth, maxLeftWidth));
    } else {
      setRightWidth(clamp(drag.startWidth - delta, minRightWidth, maxRightWidth));
    }
  };

  const endDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag) return;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* 忽略 */ }
    setDrag(null);
  };

  const renderDivider = (side: 'left' | 'right') => {
    const active = drag?.side === side;
    return (
      <div
        role="separator"
        aria-orientation="vertical"
        aria-valuenow={side === 'left' ? leftWidth : rightWidth}
        onPointerDown={startDrag(side)}
        onPointerMove={onDragMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={() =>
          (side === 'left' ? setLeftWidth(defaultLeftWidth) : setRightWidth(defaultRightWidth))
        }
        title="拖拽调整宽度 · 双击恢复默认"
        className="group relative hidden w-1.5 shrink-0 cursor-col-resize touch-none select-none lg:block"
      >
        {/* 6px 命中区内的 2px 视觉线：默认透明（栏间已有边框），hover/拖拽高亮品牌色 */}
        <div
          className={`pointer-events-none absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 rounded-full transition-colors duration-150 ${
            active ? 'bg-brand-gradient' : 'bg-transparent group-hover:bg-primary/60'
          }`}
        />
      </div>
    );
  };

  const hasLeft = left !== null && left !== undefined;
  const hasRight = right !== null && right !== undefined;

  return (
    <div
      className={`flex h-full w-full flex-col overflow-y-auto lg:flex-row lg:overflow-hidden ${
        drag ? 'select-none' : ''
      } ${className}`}
    >
      {hasLeft && (
        <>
          <div
            className="w-full min-w-0 shrink-0 lg:w-[var(--yimu-tripane-left)] lg:shrink"
            style={{ '--yimu-tripane-left': `${leftWidth}px` } as CSSProperties}
          >
            {left}
          </div>
          {renderDivider('left')}
        </>
      )}

      {/* 中栏自适应：minCenterWidth > 0 时保底宽度（右栏最宽时中栏仍不小于该值） */}
      <div
        className="flex min-h-[360px] min-w-0 flex-1 flex-col lg:min-h-0 lg:min-w-[var(--yimu-tripane-center-min,0px)]"
        style={{ '--yimu-tripane-center-min': `${minCenterWidth}px` } as CSSProperties}
      >
        {center}
      </div>

      {hasRight && (
        <>
          {renderDivider('right')}
          <div
            className="w-full min-w-0 shrink-0 lg:w-[var(--yimu-tripane-right)] lg:shrink"
            style={{ '--yimu-tripane-right': `${rightWidth}px` } as CSSProperties}
          >
            {right}
          </div>
        </>
      )}
    </div>
  );
};

export default TriPane;
