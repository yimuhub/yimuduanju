/**
 * 全站外观主题（深色 / 浅色）
 * ─────────────────────────────────────────────
 * - token 真源：styles/graphite.css（深色物理 token）+ tailwind-theme.css
 *   的 html[data-theme='light'] 覆盖块。组件只消费 token，无需感知主题。
 * - 选择持久化 localStorage（key: yimu.theme），默认 dark。
 * - 应用方式：html data-theme 属性（dark / light），index.tsx 渲染前
 *   先 initTheme() 一次性应用，避免首帧闪色。
 * - 全局生效：Studio / 经典 / 极客三种界面模式下都可切换。
 */

export type ThemeMode = 'dark' | 'light';

export const THEME_KEY = 'yimu.theme';

export function readTheme(): ThemeMode {
  try {
    const v = localStorage.getItem(THEME_KEY);
    if (v === 'dark' || v === 'light') return v;
  } catch {
    /* 隐私模式读不到：用默认 */
  }
  return 'dark';
}

export function writeTheme(mode: ThemeMode) {
  try {
    localStorage.setItem(THEME_KEY, mode);
  } catch {
    /* 隐私模式写不进去：本次会话仍然生效 */
  }
}

/** 把主题落到 <html data-theme>；带 180ms 平滑过渡（靠 .theme-switching 短暂类） */
export function applyTheme(mode: ThemeMode) {
  const root = document.documentElement;
  if (root.dataset.theme === mode) return;
  root.dataset.theme = mode;
  // 切换瞬间才开全局底色过渡，结束即移除，避免常驻劫持组件自身过渡
  root.classList.add('theme-switching');
  window.setTimeout(() => root.classList.remove('theme-switching'), 220);
}

/** 应用入口调用：渲染前同步设置（不触发过渡动画） */
export function initTheme() {
  const root = document.documentElement;
  root.dataset.theme = readTheme();
}

/** 设置 → 偏好切换入口：写档 + 平滑过渡应用 */
export function switchTheme(mode: ThemeMode) {
  writeTheme(mode);
  applyTheme(mode);
}
