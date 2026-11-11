import { useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { ConfirmHost } from '@client/src/components/ui/confirm';
import CommandPalette from '@client/src/components/workspace/CommandPalette';
import ClassicLayout from '@client/src/components/ClassicLayout';
import CanvasFloatingNav from '@client/src/components/CanvasFloatingNav';
import {
  WorkspaceTabsProvider,
} from '@client/src/components/workspace/WorkspaceTabsContext';
import { readUIMode } from '@client/src/lib/uiMode';

/**
 * 全站布局外壳（双界面模式，参照 AI-EOS ui-mode）
 * ─────────────────────────────────────────────
 * - classic 经典模式：固定侧边栏 + 顶栏 + 整页导航 + RightDock 助手坞（见 ClassicLayout）
 * - geek    极客模式：唯一一张三栏屏（左会话栏 + 中对话栏 + 右功能标签坞），
 *   由首页「创作作战室」自身提供，Layout 不再渲染外层侧栏 / 顶栏 / 独立 RightDock，
 *   侧栏原功能条目全部进入左栏底部功能网格与右栏标签页（见 WorkspaceTabsContext）。
 * - 画布路由两种模式下均保持全屏沉浸 + 左上角悬浮导航。
 */

const Layout = () => {
  // /create（三栏 TriPane）与 /canvases（卡片画布页）是全幅宽页面，
  // 极客模式下原本无任何导航外壳——统一用 ClassicLayout 侧栏壳覆盖
  // （进入时默认折叠为图标栏，见 ClassicLayout），保证全站导航可达。
  const firstSeg = useLocation().pathname.split('/').filter(Boolean)[0] ?? '';
  const needsSidebarShell = firstSeg === 'create' || firstSeg === 'canvases';
  // 双模式路由分流：切换通过整页刷新（switchUIMode），此处读到的一定是最新档
  if (readUIMode() === 'classic' || needsSidebarShell) {
    return <ClassicLayout />;
  }
  return <GeekLayout />;
};

const GeekLayout = () => {
  const location = useLocation();
  const navigate = useNavigate();

  const pathParts = location.pathname.split('/').filter(Boolean);
  const isCanvasRoute =
    pathParts[0] === 'project' &&
    pathParts[2] === 'canvas-free3';

  return (
    <WorkspaceTabsProvider>
      <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
      {/* 常规页面：仅渲染页面自身（首页为三栏屏；其余路由均已重定向到首页开签） */}
      <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
        <Outlet />
      </main>
      <ConfirmHost />
      <CommandPalette />

      {/* ============ 画布全屏模式：左上角悬浮导航（共享组件，与经典模式同款） ============ */}
      {isCanvasRoute && (
        <CanvasFloatingNav
          homeLabel="返回作战室"
          onNavigate={(to) => navigate(to)}
          onWorkspacePage={(key) => navigate('/', { state: { openTab: key } })}
        />
      )}
      </div>
    </WorkspaceTabsProvider>
  );
};

export default Layout;
