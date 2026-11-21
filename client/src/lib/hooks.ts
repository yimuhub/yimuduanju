/**
 * 轮询 · 可见性守护（全站统一）
 * ─────────────────────────────────────────────
 * 浏览器页签切走（document.hidden）时暂停轮询，回到可见时立即补拉一次，
 * 恢复后按原周期继续。挂载时与原 setInterval 写法一致先立即执行一次。
 * 替代各页面手写的 setInterval —— 旧行为在后台页签里仍全速打请求
 * （Dashboard 5s×4 接口、工作台 5s 进度……），纯浪费且放大服务端负载。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  readTimeDisplayMode,
  writeTimeDisplayMode,
  TIME_DISPLAY_EVENT,
  type TimeDisplayMode,
} from './timeline-frame';

export function useVisibleInterval(fn: () => void, intervalMs: number): void {
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    const tick = () => {
      if (document.hidden) return;
      fnRef.current();
    };
    tick();
    const timer = setInterval(tick, intervalMs);
    // 回到可见时立即补拉一次，避免停留在旧数据直到下一个周期
    const onVisible = () => {
      if (!document.hidden) fnRef.current();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [intervalMs]);
}

/**
 * 时间 / 帧显示模式（OpenMotion timeDisplayMode 对齐）。
 * 预览时间码与时间线读数共用一份选择：点击任一处切换，广播给另一侧，
 * localStorage 持久化，刷新后保持。
 */
export function useTimeDisplayMode(): [TimeDisplayMode, (mode?: TimeDisplayMode) => void] {
  const [mode, setMode] = useState<TimeDisplayMode>(() => readTimeDisplayMode());
  const modeRef = useRef(mode);
  modeRef.current = mode;
  useEffect(() => {
    const on = (e: Event) => {
      const next = (e as CustomEvent).detail;
      setMode(next === 'frame' ? 'frame' : 'time');
    };
    window.addEventListener(TIME_DISPLAY_EVENT, on);
    return () => window.removeEventListener(TIME_DISPLAY_EVENT, on);
  }, []);
  const change = useCallback((next?: TimeDisplayMode) => {
    // 副作用（localStorage + 广播）放在 updater 之外，StrictMode 双调也不会重复触发
    const target = next ?? (modeRef.current === 'time' ? 'frame' : 'time');
    if (target === modeRef.current) return;
    modeRef.current = target;
    writeTimeDisplayMode(target);
    setMode(target);
    window.dispatchEvent(new CustomEvent(TIME_DISPLAY_EVENT, { detail: target }));
  }, []);
  return [mode, change];
}
