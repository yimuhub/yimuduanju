/**
 * 双界面模式（参照 AI-EOS ui-mode 实现）
 * ─────────────────────────────────────────────
 * - geek    = 极客模式：/ 路由三栏作战室（会话 | 对话 | 功能签右栏），旧路由重定向开签
 * - classic = 经典模式：固定侧边栏 + 顶栏 + 整页导航 + RightDock 助手坞
 *
 * 选择持久化 localStorage（key: yimu.uiMode），默认 geek。
 * 切换采用「写档 + 整页跳转/刷新」策略：简单可靠，所有挂载组件无需订阅对齐。
 */

export type UIMode = 'classic' | 'geek';

export const UI_MODE_KEY = 'yimu.uiMode';

/** 应用路由 basename（与 index.tsx 一致；网关以 /app/yimu/ 前缀伺服 SPA） */
const APP_BASE = process.env.CLIENT_BASE_PATH || '/app/yimu';

export function readUIMode(): UIMode {
  try {
    const v = localStorage.getItem(UI_MODE_KEY);
    return v === 'classic' ? 'classic' : 'geek';
  } catch {
    return 'geek';
  }
}

export function writeUIMode(mode: UIMode) {
  try {
    localStorage.setItem(UI_MODE_KEY, mode);
  } catch {
    /* 隐私模式写不进去：本次会话仍然生效，只是刷新后要重新切 */
  }
}

/**
 * 切换界面模式：写档后整页导航到 target（缺省停留在当前路径），full reload 保证两套路由/外壳干净重建。
 * @param mode   目标模式
 * @param target 切换后的落点路由（如 '/'、'/projects'）；自动补应用 basename 前缀，避免跳出路由基路径
 */
export function switchUIMode(mode: UIMode, target?: string) {
  writeUIMode(mode);
  let to: string;
  if (target === undefined) {
    to = window.location.pathname + window.location.search;
  } else {
    // 相对路由 → 完整路径（basename 已在目标前缀上则不重复加）
    to = target.startsWith(APP_BASE) ? target : APP_BASE + (target.startsWith('/') ? target : `/${target}`);
    if (window.location.pathname === to) return window.location.reload();
  }
  if (window.location.pathname + window.location.search === to) {
    window.location.reload();
  } else {
    window.location.assign(to);
  }
}
