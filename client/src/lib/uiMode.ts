/**
 * 三界面模式（参照 AI-EOS ui-mode 实现）
 * ─────────────────────────────────────────────
 * - studio  = Studio Graphite（方案 F）：左导航轨 + 中舞台（对话 / 无限画布 / 内容页）
 *            + 右产出坞（7 Tab）+ 底时间线 + IDE 状态栏。**默认模式**。
 * - geek    = 极客模式：/ 三栏作战室（会话 | 对话 | 功能签右栏），旧路由重定向开签
 * - classic = 经典模式：固定侧边栏 + 顶栏 + 整页导航 + RightDock 助手坞
 *
 * 选择持久化 localStorage（key: yimu.uiMode），默认 studio。
 * 切换采用「写档 + 整页跳转/刷新」策略：简单可靠，所有挂载组件无需订阅对齐。
 */

export type UIMode = 'classic' | 'geek' | 'studio';

/**
 * 命名约定（全站文案统一，见 设置→偏好「界面模式」）：
 *   studio  = 「Studio 模式」（方案 F，默认——未设置过 uiMode 的新用户直接进入）
 *   classic = 「经典模式」（侧栏整页导航）
 *   geek    = 「极客模式」（三栏作战室）
 * 已设置过的用户保持其选择；旧档迁移规则见 readUIMode。
 */

/** 新档（方案 F 上线后写这里） */
export const UI_MODE_KEY = 'yimu.uiMode.v2';
/** 旧档（双模式时代） */
const UI_MODE_KEY_LEGACY = 'yimu.uiMode';

/** 应用路由 basename（与 index.tsx 一致；网关以 /app/yimu/ 前缀伺服 SPA） */
const APP_BASE = process.env.CLIENT_BASE_PATH || '/app/yimu';

export function readUIMode(): UIMode {
  try {
    const v = localStorage.getItem(UI_MODE_KEY);
    if (v === 'classic' || v === 'geek' || v === 'studio') return v;
    // 旧档迁移：classic 是用户主动选过的，保留；geek 只是旧默认，升级为方案 F
    const legacy = localStorage.getItem(UI_MODE_KEY_LEGACY);
    const migrated: UIMode = legacy === 'classic' ? 'classic' : 'studio';
    localStorage.setItem(UI_MODE_KEY, migrated);
    return migrated;
  } catch {
    /* 隐私模式读不到：本次会话仍生效 */
  }
  return 'studio';
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
