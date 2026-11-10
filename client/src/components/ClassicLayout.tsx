import { useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { ConfirmHost } from '@client/src/components/ui/confirm';
import CommandPalette from '@client/src/components/workspace/CommandPalette';
import ClassicRightDock from '@client/src/components/ClassicRightDock';
import CanvasFloatingNav from '@client/src/components/CanvasFloatingNav';
import SidebarUserCard from '@client/src/components/SidebarUserCard';
import {
  WorkspaceTabsProvider,
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
  PenTool,
  ArrowLeft,
} from 'lucide-react';

/**
 * 经典模式外壳（v3.0.x 形态恢复 + 深色 token 适配）
 * ─────────────────────────────────────────────
 * 左：固定可折叠侧边栏（navItems 全部条目，点击整页导航，激活态 nav-active）
 * 顶：面包屑 + 搜索 + 用户菜单 + 助手坞开关
 * 右：RightDock 助手坞（任务 / 资产 / 动态 三页签，可收起）
 * 画布路由保持全屏沉浸（不渲染侧栏 / 顶栏 / 助手坞），左上角品牌悬浮导航。
 */

const navItems: { key: string; to: string; label: string; icon: typeof Sparkles; end?: boolean }[] = [
  { key: 'home', to: '/', label: '创作作战室', icon: Sparkles, end: true },
  { key: 'canvas', to: '/project/free/canvas-free3', label: '自由画布', icon: Workflow },
  { key: 'canvases', to: '/canvases', label: '画布模式', icon: PenTool },
  { key: 'create', to: '/create', label: '一键创作', icon: Wand2 },
  { key: 'dashboard', to: '/dashboard', label: '数据看板', icon: LayoutDashboard },
  { key: 'projects', to: '/projects', label: '我的项目', icon: FolderKanban },
  { key: 'templates', to: '/templates', label: '模板中心', icon: LayoutTemplate },
  { key: 'styles', to: '/styles', label: '风格中心', icon: Palette },
  { key: 'assets', to: '/assets', label: '资产库', icon: ImageIcon },
  { key: 'ai-assistant', to: '/ai-assistant', label: 'AI助手', icon: Bot },
  { key: 'account', to: '/account', label: '用户中心', icon: UserCircle },
  { key: 'settings', to: '/settings', label: '设置', icon: Settings },
];

// 侧栏分组（对标即梦/可灵工作台：导航按「创作 / 项目 / 账户」分区，降低长列表噪音）
const navGroups: { label: string; items: typeof navItems }[] = [
  {
    label: '创作',
    items: navItems.filter((n) => ['home', 'canvas', 'canvases', 'create'].includes(n.key)),
  },
  {
    label: '项目',
    items: navItems.filter((n) => ['dashboard', 'projects', 'templates', 'styles', 'assets'].includes(n.key)),
  },
  {
    label: '助手与账户',
    items: navItems.filter((n) => ['ai-assistant', 'account', 'settings'].includes(n.key)),
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
  canvases: '画布模式',
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
    pathParts[2] === 'canvas-free3';
  // 创作作战室（/）为全高三栏屏：内容区不加内边距，其余整页导航页面带标准内边距
  const isStudioHome = pathParts.length === 0;
  // /projects 页内已有搜索（工具条），顶栏搜索同视图重复 → 该路由下隐藏
  const isProjectsRoute = pathParts[0] === 'projects';
  // 用户身份单一来源（lib/identity 的 useNickname hook，与极客左栏用户卡共享）

  // P1 移动端：抽屉式侧边栏，小屏默认收起
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [searchText, setSearchText] = useState('');
  // 助手坞默认展开，收起状态跨页面持久
  const [dockOpen, setDockOpen] = useState(
    () => localStorage.getItem('yimu.rightDockOpen') !== '0',
  );
  // 侧栏折叠（图标模式），状态跨页面持久；
  // /create、/canvases 等全幅宽页面在用户未手动设置过时默认折叠为图标栏（hover 显 tooltip）
  const isWidePageRoute = pathParts[0] === 'create' || pathParts[0] === 'canvases';
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      const stored = localStorage.getItem('yimu.sidebarCollapsed');
      if (stored === '1' || stored === '0') return stored === '1';
    } catch {
      /* 隐私模式读不到：按路径默认 */
    }
    return isWidePageRoute;
  });
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
          onClick={() => switchUIMode('studio', '/')}
          title="切换到 Studio 模式（方案 F：导航轨 + 舞台 + 产出坞 + 时间线）"
          className={`flex w-full items-center gap-3 rounded-lg border border-border px-2 py-2 text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground ${sidebarCollapsed ? 'justify-center' : ''}`}
        >
          <Sparkles className="h-4 w-4 shrink-0" />
          {!sidebarCollapsed && <span>Studio 模式</span>}
        </button>
        <button
          onClick={() => switchUIMode('geek', '/')}
          title="切换到极客模式（三栏作战室 + 功能标签页）"
          className={`mt-1 flex w-full items-center gap-3 rounded-lg border border-border px-2 py-2 text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground ${sidebarCollapsed ? 'justify-center' : ''}`}
        >
          <MonitorCog className="h-4 w-4 shrink-0" />
          {!sidebarCollapsed && <span>极客模式</span>}
        </button>
        <div className="mt-1">
          <SidebarUserCard size="md" collapsed={sidebarCollapsed} />
        </div>
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


        {/* 画布全屏沉浸：只渲染画布路由本体（Outlet），不渲染侧栏 / 顶栏 / 助手坞。
            P1 修复：此前画布路由下直接跳过 Outlet，经典模式进入 /project/:id/canvas-free3 白屏。 */}
        {isCanvasRoute && (
          <main className="h-screen w-screen overflow-hidden">
            <Outlet />
          </main>
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
                  {/* 返回上一页：/create、画布模式等二级页面提供明确返回入口 */}
                  <button
                    onClick={() => navigate(-1)}
                    className="flex shrink-0 items-center gap-1 rounded-lg border border-input bg-background px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                    aria-label="返回上一页"
                    title="返回上一页"
                  >
                    <ArrowLeft className="h-3.5 w-3.5" /> 返回
                  </button>
                  <span className="hidden shrink-0 text-muted-foreground sm:inline">首页</span>
                  <div className="hidden min-w-0 items-center gap-2 md:flex">
                    {breadcrumbs.map((b, i) => (
                      <div key={b.path} className="flex min-w-0 items-center gap-2">
                        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                        {/* 面包屑可点击跳转（末级仅高亮不可点，避免自跳转） */}
                        {i < breadcrumbs.length - 1 ? (
                          <button
                            onClick={() => navigate(b.path)}
                            className="truncate font-medium text-muted-foreground transition-colors hover:text-primary"
                            title={b.label}
                          >
                            {b.label}
                          </button>
                        ) : (
                          <span className="truncate font-medium text-foreground">{b.label}</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-2 sm:gap-4">
                  {!isProjectsRoute && (
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
                  )}
                  {/* P2 诚信修复：删除写死的「未读红点」假状态；通知中心暂未开放，按钮降级为禁用占位 */}
                  <button
                    className="hidden h-9 w-9 cursor-not-allowed items-center justify-center rounded-lg border border-input bg-background opacity-60 sm:flex"
                    aria-label="通知（暂未开放）"
                    title="通知中心暂未开放"
                    disabled
                  >
                    <Bell className="h-[18px] w-[18px] text-foreground/70" />
                  </button>
                  {/* 助手坞开关：作战室首页也显示（收起后可从这里重新展开） */}
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
                {/* 助手坞：所有经典模式页面（含作战室首页）默认展开，收起状态 localStorage 持久；
                    作战室首页的 TriPane 右坞在经典模式下不再渲染（见 AgentStudio isClassicMode），避免同屏双右坞 */}
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

export default ClassicLayout;
