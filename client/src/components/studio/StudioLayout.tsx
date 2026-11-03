/**
 * Studio · 外层布局（方案 F）
 * -------------------------------------------------------------
 * Studio 自带完整外壳（导航轨 / 舞台 / 产出坞 / 时间线 / 状态栏），
 * 这里只补上全站级的浮层能力：确认弹窗宿主 + ⌘K 命令面板。
 */
import { Outlet } from 'react-router-dom';
import { ConfirmHost } from '@client/src/components/ui/confirm';
import CommandPalette from '@client/src/components/workspace/CommandPalette';
import { WorkspaceTabsProvider } from '@client/src/components/workspace/WorkspaceTabsContext';

const StudioLayout = () => (
  <WorkspaceTabsProvider>
    <div className="h-screen w-screen overflow-hidden bg-[var(--bg)] text-[var(--fg)]">
      <Outlet />
    </div>
    <ConfirmHost />
    <CommandPalette />
  </WorkspaceTabsProvider>
);

export default StudioLayout;
