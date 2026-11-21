/**
 * 关键帧自动打点（auto-record，G13）
 * -------------------------------------------------------------
 * OpenMotion 的 auto-record 语义：开关打开时，手动改运镜参数会自动在
 * 播放头落一个关键帧；关闭时改参数只改整条动画的值，不再偷偷打点。
 *
 * 状态存 localStorage（跨会话），并用 window 事件在时间线工具条与
 * 检查器之间同步——两个入口共享同一个开关，不能各存一份。
 * 默认开启：与既有行为一致（滑杆改动一直在播放头落关键帧），不删减旧功能。
 */
import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'yimu:shenjian:keyframe-autorecord';
/** 跨组件同步事件（工具条 ↔ 检查器） */
const CHANGE_EVENT = 'yimu:shenjian-keyframe-autorecord';

export function readAutoRecord(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw == null) return true;
    return raw === '1';
  } catch {
    return true;
  }
}

export function writeAutoRecord(on: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, on ? '1' : '0');
  } catch {
    /* 会话内保留 */
  }
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: on }));
}

/** 工具条 / 检查器共用的开关 Hook：读写 localStorage + 事件同步 */
export function useAutoRecord(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(readAutoRecord);
  useEffect(() => {
    const sync = (e: Event) => setOn(Boolean((e as CustomEvent).detail));
    window.addEventListener(CHANGE_EVENT, sync);
    return () => window.removeEventListener(CHANGE_EVENT, sync);
  }, []);
  const toggle = useCallback((next: boolean) => {
    writeAutoRecord(next);
    setOn(next);
  }, []);
  return [on, toggle];
}
