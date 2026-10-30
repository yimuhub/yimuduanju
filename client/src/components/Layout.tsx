import { useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { ConfirmHost } from '@client/src/components/ui/confirm';
import CommandPalette from '@client/src/components/workspace/CommandPalette';
import {
  WorkspaceTabsProvider,
  WORKSPACE_PAGES,
} from '@client/src/components/workspace/WorkspaceTabsContext';
import { Clapperboard, X, Sparkles, Wand2 } from 'lucide-react';

/**
 * 全站布局（AI-EOS 极客模式 · 三栏制）
 * ─────────────────────────────────────────────
 * 常规页面 = 唯一一张三栏屏（左会话/任务栏 + 中对话栏 + 右功能标签坞），
 * 由首页「创作作战室」自身提供，Layout 不再渲染外层侧栏 / 顶栏 / 独立 RightDock，
 * 侧栏原功能条目全部进入左栏底部功能网格与右栏标签页（见 WorkspaceTabsContext）。
 * 画布路由保持全屏沉浸 + 左上角悬浮导航（原有逻辑）。
 */

const Layout = () => {
  const location = useLocation();
  const navigate = useNavigate();
  // 画布全屏模式左上角悬浮导航面板开关
  const [canvasNavOpen, setCanvasNavOpen] = useState(false);

  const pathParts = location.pathname.split('/').filter(Boolean);
  const isCanvasRoute =
    pathParts[0] === 'project' &&
    ['canvas', 'canvas-free3', 'canvas-auto'].includes(pathParts[2] ?? '');

  return (
    <WorkspaceTabsProvider>
      <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
      {/* 常规页面：仅渲染页面自身（首页为三栏屏；其余路由均已重定向到首页开签） */}
      <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <Outlet />
      </main>
      <ConfirmHost />
      <CommandPalette />

      {/* ============ 画布全屏模式：左上角悬浮导航（logo 圆钮 + 全部导航浮层） ============ */}
      {isCanvasRoute && (
        <>
          <button
            onClick={() => setCanvasNavOpen((v) => !v)}
            className="fixed left-4 top-4 z-[1002] flex h-12 w-12 items-center justify-center rounded-full bg-brand-gradient text-white shadow-lg shadow-black/25 transition-transform hover:scale-105"
            aria-label={canvasNavOpen ? '关闭导航菜单' : '打开导航菜单'}
            title="导航菜单"
          >
            {canvasNavOpen ? <X className="h-5 w-5" /> : <Clapperboard className="h-5 w-5" />}
          </button>
          {canvasNavOpen && (
            <>
              <div className="fixed inset-0 z-[1000]" onClick={() => setCanvasNavOpen(false)} />
              <div className="fixed left-4 top-[72px] z-[1001] max-h-[calc(100vh-96px)] w-60 overflow-y-auto rounded-2xl border border-border bg-card py-2 shadow-2xl">
                <div className="px-4 pb-1.5 pt-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">导航菜单</div>
                {WORKSPACE_PAGES.map((item) => (
                  <button
                    key={item.key}
                    onClick={() => {
                      setCanvasNavOpen(false);
                      navigate('/', { state: { openTab: item.key } });
                    }}
                    className="flex w-full items-center gap-3 rounded-lg px-4 py-2.5 text-sm font-medium text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                  >
                    <item.icon className="h-[18px] w-[18px] shrink-0" />
                    <span>{item.title}</span>
                  </button>
                ))}
                <div className="mt-1 border-t border-border pt-1">
                  <button
                    onClick={() => {
                      setCanvasNavOpen(false);
                      navigate('/');
                    }}
                    className="flex w-full items-center gap-3 rounded-lg px-4 py-2.5 text-sm font-medium text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                  >
                    <Sparkles className="h-[18px] w-[18px] shrink-0" /> 返回作战室
                  </button>
                  <button
                    onClick={() => {
                      setCanvasNavOpen(false);
                      navigate('/create');
                    }}
                    className="flex w-full items-center gap-3 rounded-lg px-4 py-2.5 text-sm font-medium text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                  >
                    <Wand2 className="h-[18px] w-[18px] shrink-0" /> 一键创作
                  </button>
                </div>
              </div>
            </>
          )}
        </>
      )}
      </div>
    </WorkspaceTabsProvider>
  );
};

export default Layout;
