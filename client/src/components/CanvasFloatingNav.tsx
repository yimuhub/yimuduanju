import { useState } from 'react';
import { X, Sparkles, Wand2 } from 'lucide-react';
import {
  WORKSPACE_PAGES,
} from '@client/src/components/workspace/WorkspaceTabsContext';

/**
 * 画布全屏沉浸模式 · 左上角悬浮导航（共享组件）
 * ─────────────────────────────────────────────
 * 品牌 logo 圆钮 + 全部导航浮层。此前经典（ClassicLayout）与极客（Layout/GeekLayout）
 * 各自维护一份几乎相同的实现（重复样式块），现统一收敛到这里：
 *   · 首页入口（Sparkles）→ onNavigate('/')，文案由 homeLabel 定制
 *   · 功能页条目 → 缺省按整页路由 onNavigate(`/${key}`)；
 *     极客模式传入 onWorkspacePage 改为「回首页 + 右栏开签」
 *   · 一键创作入口 → onNavigate('/create')
 */

interface CanvasFloatingNavProps {
  onNavigate: (to: string, state?: unknown) => void;
  /** 提供后：功能页条目改走该回调（极客模式：navigate('/', { state: { openTab } })） */
  onWorkspacePage?: (pageKey: string) => void;
  /** 首页入口文案（经典=创作作战室；极客=返回作战室） */
  homeLabel?: string;
}

const CanvasFloatingNav = ({
  onNavigate,
  onWorkspacePage,
  homeLabel = '创作作战室',
}: CanvasFloatingNavProps) => {
  const [open, setOpen] = useState(false);
  const go = (to: string, state?: unknown) => {
    setOpen(false);
    onNavigate(to, state);
  };
  return (
    <>
      <button
        onClick={() => setOpen((v) => !v)}
        className="fixed left-4 top-4 z-[1002] flex h-12 w-12 items-center justify-center rounded-full bg-card shadow-lg shadow-black/25 ring-1 ring-border transition-transform hover:scale-105"
        aria-label={open ? '关闭导航菜单' : '打开导航菜单'}
        title="导航菜单"
      >
        {open ? (
          <X className="h-5 w-5" />
        ) : (
          <img src="/brand/mark.png" alt="一幕 YIMU" className="h-8 w-8 object-contain" />
        )}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-[1000]" onClick={() => setOpen(false)} />
          <div className="fixed left-4 top-[72px] z-[1001] max-h-[calc(100vh-96px)] w-60 overflow-y-auto rounded-2xl border border-border bg-card py-2 shadow-2xl">
            <div className="px-4 pb-1.5 pt-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">导航菜单</div>
            <button
              onClick={() => go('/')}
              className="flex w-full items-center gap-3 rounded-lg px-4 py-2.5 text-sm font-medium text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            >
              <Sparkles className="h-[18px] w-[18px] shrink-0" /> {homeLabel}
            </button>
            {WORKSPACE_PAGES.map((item) => (
              <button
                key={item.key}
                onClick={() =>
                  onWorkspacePage ? onWorkspacePage(item.key) : go(`/${item.key}`)
                }
                className="flex w-full items-center gap-3 rounded-lg px-4 py-2.5 text-sm font-medium text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              >
                <item.icon className="h-[18px] w-[18px] shrink-0" />
                <span>{item.title}</span>
              </button>
            ))}
            <div className="mt-1 border-t border-border pt-1">
              <button
                onClick={() => go('/create')}
                className="flex w-full items-center gap-3 rounded-lg px-4 py-2.5 text-sm font-medium text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              >
                <Wand2 className="h-[18px] w-[18px] shrink-0" /> 一键创作
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
};

export default CanvasFloatingNav;
