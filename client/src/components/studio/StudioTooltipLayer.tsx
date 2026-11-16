/**
 * 工具栏悬浮解释（剪映式 tooltip）
 * -------------------------------------------------------------
 * 时间线/预览/顶栏里大量按钮只写了 title，浏览器原生 tooltip 既慢又难看，
 * 鼠标停留时用户经常不知道「剪刀 / 磁铁 / 封面」是什么。
 * 这里用事件委托统一接管：hover 到任意带 title 的按钮，转成即时小浮层；
 * 不改每个按钮的 JSX，也不新增第二套文案源（title 仍是唯一真源）。
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

interface Tip {
  text: string;
  x: number;
  y: number;
  below: boolean;
}

const OFFSET = 9;
const MAX_W = 280;

export const StudioTooltipLayer = () => {
  const [tip, setTip] = useState<Tip | null>(null);
  const timerRef = useRef<number | null>(null);
  const activeRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const clearTimer = () => {
      if (timerRef.current) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
    const hide = () => {
      clearTimer();
      activeRef.current = null;
      setTip(null);
    };
    const show = (el: HTMLElement) => {
      const text = (el.dataset.tip || el.getAttribute('title') || '').trim();
      if (!text) return;
      // 原生 title 会延迟弹出，抢在它前面移除；文案转存 data-tip，后续 hover 复用
      if (el.getAttribute('title')) {
        el.dataset.tip = text;
        el.removeAttribute('title');
        if (!el.getAttribute('aria-label')) el.setAttribute('aria-label', text);
      }
      const r = el.getBoundingClientRect();
      const half = Math.min(MAX_W, Math.max(92, text.length * 12)) / 2;
      const x = Math.max(8 + half, Math.min(window.innerWidth - 8 - half, r.left + r.width / 2));
      const below = r.top < 46;
      const y = below ? r.bottom + OFFSET : r.top - OFFSET;
      setTip({ text, x, y, below });
    };
    const onOver = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null;
      const el = target?.closest?.(
        'button[title], button[data-tip], [role="button"][title], .icon-btn[data-tip]',
      ) as HTMLElement | null;
      // 片段本身也有 title（整段素材说明），不抢它的原生提示
      if (!el || el.closest('.clip') || el.closest('.pro-chat-float')) return;
      if (activeRef.current === el) return;
      activeRef.current = el;
      clearTimer();
      timerRef.current = window.setTimeout(() => show(el), 120);
    };
    const onOut = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null;
      const el = activeRef.current;
      if (!el) return;
      const related = e.relatedTarget as HTMLElement | null;
      if (related && el.contains(related)) return;
      hide();
    };
    document.addEventListener('pointerover', onOver, true);
    document.addEventListener('pointerout', onOut, true);
    document.addEventListener('pointerdown', hide, true);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    return () => {
      clearTimer();
      document.removeEventListener('pointerover', onOver, true);
      document.removeEventListener('pointerout', onOut, true);
      document.removeEventListener('pointerdown', hide, true);
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
    };
  }, []);

  if (!tip) return null;
  return createPortal(
    <div
      className={`studio-tip${tip.below ? ' below' : ''}`}
      style={{ left: `${tip.x}px`, top: `${tip.y}px` }}
      role="tooltip"
    >
      {tip.text}
    </div>,
    document.body,
  );
};

export default StudioTooltipLayer;
