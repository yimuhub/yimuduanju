/**
 * 轮询 · 可见性守护（全站统一）
 * ─────────────────────────────────────────────
 * 浏览器页签切走（document.hidden）时暂停轮询，回到可见时立即补拉一次，
 * 恢复后按原周期继续。挂载时与原 setInterval 写法一致先立即执行一次。
 * 替代各页面手写的 setInterval —— 旧行为在后台页签里仍全速打请求
 * （Dashboard 5s×4 接口、工作台 5s 进度……），纯浪费且放大服务端负载。
 */
import { useEffect, useRef } from 'react';

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
