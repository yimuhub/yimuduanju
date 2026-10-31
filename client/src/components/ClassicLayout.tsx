import { useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { ConfirmHost } from '@client/src/components/ui/confirm';
import CommandPalette from '@client/src/components/workspace/CommandPalette';
import ClassicRightDock from '@client/src/components/ClassicRightDock';
import {
  WorkspaceTabsProvider,
  WORKSPACE_PAGES,
} from '@client/src/components/workspace/WorkspaceTabsContext';
import { switchUIMode } from '@client/src/lib/uiMode';
import {
  LayoutDashboard,
  FolderKanban,
  Wand2,
  Image as ImageIcon,
  Bot,
  Settings,
  Search,
  Bell,
  ChevronRight,
  Clapperboard,
  Workflow,
  Menu,
  X,
  PanelRightOpen,
  Sparkles,
  Palette,
  UserCircle,
  MonitorCog,
  LayoutTemplate,
} from 'lucide-react';

/**
 * 经典模式外壳（v3.0.x 形态恢复 + 深色 token 适配）
 * ─────────────────────────────────────────────
 * 左：固定可折叠侧边栏（navItems 全部条目，点击整页导航，激活态 nav-active）
 * 顶：面包屑 + 搜索 + 用户菜单 + 助手坞开关
 * 右：RightDock 助手坞（任务 / 资产 / 动态 三页签，可收起）
 * 画布路由保持全屏沉浸（不渲染侧栏 / 顶栏 / 助手坞），左上角品牌悬浮导航。
 */

const navItems = [
  { to: '/', label: '创作作战室', icon: Sparkles, end: true },
  { to: '/dashboard', label: '数据看板', icon: LayoutDashboard },
  { to: '/projects', label: '我的项目', icon: FolderKanban },
  { to: '/project/free/canvas-free3', label: '自由画布', icon: Workflow },
  { to: '/create', label: '一键创作', icon: Wand2 },
  { to: '/templates', label: '模板中心', icon: LayoutTemplate },
  { to: '/styles', label: '风格中心', icon: Palette },
  { to: '/assets', label: '资产库', icon: ImageIcon },
  { to: '/ai-assistant', label: 'AI助手', icon: Bot },
  { to: '/account', label: '用户中心', icon: UserCircle },
  { to: '/settings', label: '设置', icon: Settings },
];

// 侧栏分组（对标即梦/可灵工作台：导航按「创作 / 项目 / 账户」分区，降低长列表噪音）
const navGroups: { label: string; items: typeof navItems }[] = [
  {
    label: '创作',
    items: [navItems[0], navItems[3], navItems[4]],
  },
  {
    label: '项目',
    items: [navItems[1], navItems[2], navItems[5], navItems[6], navItems[7]],
  },
  {
    label: '助手与账户',
    items: [navItems[8], navItems[9], navItems[10]],
  },
];

const breadcrumbMap: Record<string, string> = {
  '': '首页',
  dashboard: '数据看板',
  projects: '我的项目',
  create: '一键创作',
  templates: '模板中心',
  assets: '资产库',
  'ai-assistant': 'AI助手',
  account: '用户中心',
  styles: '风格中心',
  settings: '设置',
  project: '项目工作台',
  'canvas': '无限画布',
  'canvas-free3': '自由画布',
  script: '剧本',
  bible: '圣经',
  characters: '人物',
  scenes: '场景',
  storyboard: '分镜',
  director: '导演台',
  timeline: '时间线',
  agents: 'AI助手',
  tasks: '任务队列',
  qc: '质检',
  export: '导出',
};

// 项目 id 等裸 UUID 显示为短码，不再满屏
const shortId = (part: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}/i.test(part) ? `${part.slice(0, 8)}…` : part;

const ClassicLayout = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const pathParts = location.pathname.split('/').filter(Boolean);
  const isCanvasRoute =
    pathParts[0] === 'project' &&
    ['canvas', 'canvas-free3'].includes(pathParts[2] ?? '');
  // 创作作战室（/）为全高三栏屏：内容区不加内边距，其余整页导航页面带标准内边距
  const isStudioHome = pathParts.length === 0;

  // P1 移动端：抽屉式侧边栏，小屏默认收起
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [searchText, setSearchText] = useState('');
  // 助手坞默认展开，收起状态跨页面持久
  const [dockOpen, setDockOpen] = useState(
    () => localStorage.getItem('yimu.rightDockOpen') !== '0',
  );
  // 顶栏头像下拉
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  // 侧栏折叠（图标模式），状态跨页面持久
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => localStorage.getItem('yimu.sidebarCollapsed') === '1',
  );
  const toggleSidebar = () => {
    setSidebarCollapsed((prev) => {
      localStorage.setItem('yimu.sidebarCollapsed', prev ? '0' : '1');
      return !prev;
    });
  };
  const toggleDock = () => {
    setDockOpen((prev) => {
      localStorage.setItem('yimu.rightDockOpen', prev ? '0' : '1');
      return !prev;
    });
  };

  const breadcrumbs = pathParts.map((part: string, index: number) => ({
    label: breadcrumbMap[part] || shortId(part),
    path: '/' + pathParts.slice(0, index + 1).join('/'),
  }));

  const submitSearch = () => {
    navigate(`/projects${searchText.trim() ? `?keyword=${encodeURIComponent(searchText.trim())}` : ''}`);
  };

  const sidebarBody = (
    <>
      {/* Logo */}
      <div className="flex h-16 items-center gap-3 border-b border-sidebar-border px-4">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-gradient text-white shadow-sm">
          <Clapperboard className="h-5 w-5" />
        </div>
        {!sidebarCollapsed && (
          <div className="flex flex-col leading-tight">
            <span className="text-sm font-semibold leading-snug text-sidebar-foreground">
              一幕·YIMU AI 短剧创作平台
            </span>
          </div>
        )}
      </div>

      {/* Nav（分组 + 可折叠图标模式） */}
      <nav className={`flex-1 space-y-4 overflow-y-auto px-3 py-4 ${sidebarCollapsed ? 'px-2' : ''}`}>
        {navGroups.map((group) => (
          <div key={group.label}>
            {!sidebarCollapsed && (
              <div className="mb-1 px-3 text-[11px] font-medium uppercase tracking-wider text-sidebar-foreground/40">
                {group.label}
              </div>
            )}
            {sidebarCollapsed && <div className="mx-2 mb-2 border-t border-sidebar-border" />}
            <div className="space-y-1">
              {group.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  title={sidebarCollapsed ? item.label : undefined}
                  onClick={() => setDrawerOpen(false)}
                  className={({ isActive }) =>
                    `flex items-center gap-3 rounded-lg text-sm font-medium transition-colors ${
                      sidebarCollapsed ? 'justify-center px-0 py-2.5' : 'px-3 py-2.5'
                    } ${
                      isActive
                        ? 'nav-active'
                        : 'text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
                    }`
                  }
                >
                  <item.icon className="h-[18px] w-[18px] shrink-0" />
                  {!sidebarCollapsed && <span>{item.label}</span>}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>

      {/* 底部：界面模式切换 + 用户 + 折叠 */}
      <div className="border-t border-sidebar-border p-3">
        <button
          onClick={() => switchUIMode('geek', '/')}
          title="切换到极客模式（三栏作战室 + 功能标签页）"
          className={`flex w-full items-center gap-3 rounded-lg border border-border px-2 py-2 text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground ${sidebarCollapsed ? 'justify-center' : ''}`}
        >
          <MonitorCog className="h-4 w-4 shrink-0" />
          {!sidebarCollapsed && <span>极客模式</span>}
        </button>
        <button
          onClick={() => navigate('/account')}
          title={sidebarCollapsed ? '一幕用户' : undefined}
          className={`mt-1 flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-sidebar-accent ${sidebarCollapsed ? 'justify-center' : ''}`}
        >
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-gradient text-sm font-semibold text-primary-foreground">
            YM
          </div>
          {!sidebarCollapsed && (
            <div className="flex-1 overflow-hidden">
              <div className="truncate text-sm font-medium text-sidebar-foreground">一幕用户</div>
              <div className="truncate text-xs text-sidebar-foreground/60">专业版</div>
            </div>
          )}
        </button>
        <button
          onClick={toggleSidebar}
          className={`mt-1 hidden w-full items-center gap-3 rounded-lg px-2 py-2 text-sidebar-foreground/50 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground lg:flex ${sidebarCollapsed ? 'justify-center' : ''}`}
          aria-label={sidebarCollapsed ? '展开侧栏' : '折叠侧栏'}
        >
          <PanelRightOpen className={`h-4 w-4 ${sidebarCollapsed ? 'rotate-180' : ''}`} />
          {!sidebarCollapsed && <span className="text-xs">折叠侧栏</span>}
        </button>
      </div>
    </>
  );

  return (
    <WorkspaceTabsProvider>
      <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
        {/* 画布全屏模式：左上角悬浮导航（与极客模式同款） */}
        {isCanvasRoute && (
          <CanvasFloatingNav
            onNavigate={(to) => {
              setDrawerOpen(false);
              navigate(to);
            }}
          />
        )}

        {!isCanvasRoute && (
          <>
            {/* Sidebar（桌面端固定，小屏抽屉） */}
            <aside
              className={`hidden shrink-0 flex-col border-r border-sidebar-border bg-sidebar transition-[width] duration-200 lg:flex ${
                sidebarCollapsed ? 'w-[68px]' : 'w-60'
              }`}
            >
              {sidebarBody}
            </aside>
            {drawerOpen && (
              <div className="fixed inset-0 z-50 lg:hidden">
                <div className="absolute inset-0 bg-black/40" onClick={() => setDrawerOpen(false)} />
                <aside className="absolute left-0 top-0 flex h-full w-60 flex-col border-r border-sidebar-border bg-sidebar">
                  <button
                    onClick={() => setDrawerOpen(false)}
                    className="absolute right-2 top-4 rounded-lg p-1.5 text-muted-foreground hover:bg-muted"
                    aria-label="关闭导航"
                  >
                    <X className="h-4 w-4" />
                  </button>
                  {sidebarBody}
                </aside>
              </div>
            )}

            {/* Main */}
            <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
              {/* TopBar */}
              <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border bg-background px-4 sm:px-6">
                <div className="flex min-w-0 items-center gap-2 text-sm">
                  <button
                    onClick={() => setDrawerOpen(true)}
                    className="rounded-lg p-2 text-foreground/70 hover:bg-muted lg:hidden"
                    aria-label="打开导航"
                  >
                    <Menu className="h-5 w-5" />
                  </button>
                  <span className="hidden shrink-0 text-muted-foreground sm:inline">首页</span>
                  <div className="hidden min-w-0 items-center gap-2 md:flex">
                    {breadcrumbs.map((b) => (
                      <div key={b.path} className="flex min-w-0 items-center gap-2">
                        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <span className="truncate font-medium text-foreground">{b.label}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-2 sm:gap-4">
                  <div className="relative hidden sm:block">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <input
                      type="search"
                      placeholder="搜索项目、资产、模板..."
                      value={searchText}
                      onChange={(e) => setSearchText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') submitSearch();
                      }}
                      className="h-9 w-48 rounded-lg border border-input bg-muted/50 pl-9 pr-4 text-sm outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20 xl:w-72"
                    />
                  </div>
                  <button className="hidden h-9 w-9 items-center justify-center rounded-lg border border-input bg-background hover:bg-muted/50 sm:flex" aria-label="通知">
                    <Bell className="h-[18px] w-[18px] text-foreground/70" />
                    <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-primary" />
                  </button>
                  <button
                    onClick={toggleDock}
                    className={`hidden h-9 w-9 items-center justify-center rounded-lg border border-input bg-background hover:bg-muted/50 xl:flex ${
                      dockOpen ? 'border-primary/40 text-primary' : 'text-foreground/70'
                    }`}
                    aria-label={dockOpen ? '收起助手坞' : '展开助手坞'}
                    title={dockOpen ? '收起助手坞' : '展开助手坞'}
                  >
                    <PanelRightOpen className="h-[18px] w-[18px]" />
                  </button>
                  <div className="relative">
                    <button
                      onClick={() => setUserMenuOpen((v) => !v)}
                      className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-gradient text-sm font-semibold text-primary-foreground transition-transform hover:scale-105"
                      aria-label="用户菜单"
                    >
                      YM
                    </button>
                    {userMenuOpen && (
                      <>
                        <div className="fixed inset-0 z-40" onClick={() => setUserMenuOpen(false)} />
                        <div className="absolute right-0 top-11 z-50 w-44 overflow-hidden rounded-xl border border-border bg-card py-1 shadow-2xl">
                          <div className="border-b border-border px-4 py-2.5">
                            <div className="text-sm font-medium text-foreground">一幕用户</div>
                            <div className="text-xs text-muted-foreground">专业版</div>
                          </div>
                          <button
                            onClick={() => {
                              setUserMenuOpen(false);
                              navigate('/account');
                            }}
                            className="flex w-full items-center gap-2.5 px-4 py-2.5 text-sm text-foreground hover:bg-muted"
                          >
                            <UserCircle className="h-4 w-4 text-muted-foreground" />
                            用户中心
                          </button>
                          <button
                            onClick={() => {
                              setUserMenuOpen(false);
                              navigate('/settings');
                            }}
                            className="flex w-full items-center gap-2.5 px-4 py-2.5 text-sm text-foreground hover:bg-muted"
                          >
                            <Settings className="h-4 w-4 text-muted-foreground" />
                            设置
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </header>

              {/* Page content + RightDock */}
              <div className="flex min-h-0 flex-1 overflow-hidden">
                <main
                  className={`min-w-0 flex-1 overflow-y-auto ${
                    isStudioHome ? 'overflow-hidden p-0' : 'p-4 sm:p-6'
                  }`}
                >
                  <Outlet />
                </main>
                {dockOpen && <ClassicRightDock onClose={toggleDock} />}
              </div>
            </div>
          </>
        )}
        <ConfirmHost />
        <CommandPalette />
      </div>
    </WorkspaceTabsProvider>
  );
};

/** 画布全屏沉浸：左上角品牌圆钮 + 全部导航浮层（经典模式下点击整页导航） */
const CanvasFloatingNav = ({ onNavigate }: { onNavigate: (to: string) => void }) => {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen((v) => !v)}
        className="fixed left-4 top-4 z-[1002] flex h-12 w-12 items-center justify-center rounded-full bg-brand-gradient text-white shadow-lg shadow-black/25 transition-transform hover:scale-105"
        aria-label={open ? '关闭导航菜单' : '打开导航菜单'}
        title="导航菜单"
      >
        {open ? <X className="h-5 w-5" /> : <Clapperboard className="h-5 w-5" />}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-[1000]" onClick={() => setOpen(false)} />
          <div className="fixed left-4 top-[72px] z-[1001] max-h-[calc(100vh-96px)] w-60 overflow-y-auto rounded-2xl border border-border bg-card py-2 shadow-2xl">
            <div className="px-4 pb-1.5 pt-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">导航菜单</div>
            <button
              onClick={() => {
                setOpen(false);
                onNavigate('/');
              }}
              className="flex w-full items-center gap-3 rounded-lg px-4 py-2.5 text-sm font-medium text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            >
              <Sparkles className="h-[18px] w-[18px] shrink-0" /> 创作作战室
            </button>
            {WORKSPACE_PAGES.map((item) => (
              <button
                key={item.key}
                onClick={() => {
                  setOpen(false);
                  onNavigate(`/${item.key}`);
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
                  setOpen(false);
                  onNavigate('/create');
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
  );
};

export default ClassicLayout;
