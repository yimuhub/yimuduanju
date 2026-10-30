import { useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { ConfirmHost } from '@client/src/components/ui/confirm';
import RightDock from '@client/src/components/RightDock';
import {
  LayoutDashboard,
  FolderKanban,
  Wand2,
  LayoutGrid,
  Image,
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
  LogOut,
} from 'lucide-react';
import { toast } from 'sonner';

const navItems = [
  { to: '/', label: '创作作战室', icon: Sparkles, end: true },
  { to: '/dashboard', label: '数据看板', icon: LayoutDashboard },
  { to: '/projects', label: '我的项目', icon: FolderKanban },
  { to: '/project/free/canvas-free3', label: '自由画布', icon: Workflow },
  { to: '/create', label: '一键创作', icon: Wand2 },
  { to: '/templates', label: '模板中心', icon: LayoutGrid },
  { to: '/styles', label: '风格中心', icon: Palette },
  { to: '/assets', label: '资产库', icon: Image },
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
  canvas: '无限画布',
  'canvas-auto': '一键成片',
  'canvas-free3': '自由画布 3',
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

// P1 修复：项目 id/模板深链 id 等裸 UUID 显示为短码，不再满屏
const shortId = (part: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}/i.test(part) ? `${part.slice(0, 8)}…` : part;

const Layout = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const pathParts = location.pathname.split('/').filter(Boolean);
  // P1 移动端：抽屉式侧边栏，小屏默认收起
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [searchText, setSearchText] = useState('');
  // 三段式布局：右侧助手坞默认展开（仅 xl 以上占布局），收起状态跨页面持久
  const [dockOpen, setDockOpen] = useState(
    () => localStorage.getItem('yimu.rightDockOpen') !== '0',
  );
  // 顶栏头像下拉（用户中心 / 设置 / 退出登录）
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  // 侧栏折叠（图标模式），状态跨页面持久
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => localStorage.getItem('yimu.sidebarCollapsed') === '1',
  );
  // 画布全屏模式左上角悬浮导航面板开关
  const [canvasNavOpen, setCanvasNavOpen] = useState(false);
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
    // P1 修复：顶栏搜索之前是死输入框，现回车跳项目页按关键词过滤
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
      <nav className={`flex-1 space-y-4 overflow-y-auto px-3 py-4 sidebar-scroll ${sidebarCollapsed ? 'px-2' : ''}`}>
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

      {/* User */}
      <div className="border-t border-sidebar-border p-3">
        <button
          onClick={() => navigate('/account')}
          title={sidebarCollapsed ? '一幕用户' : undefined}
          className={`flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-sidebar-accent ${sidebarCollapsed ? 'justify-center' : ''}`}
        >
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-gradient text-sm font-semibold text-primary-foreground">
            YM
          </div>
          {!sidebarCollapsed && (
            <div className="flex-1 overflow-hidden">
              <div className="truncate text-sm font-medium text-sidebar-foreground">
                一幕用户
              </div>
              <div className="truncate text-xs text-sidebar-foreground/60">
                专业版
              </div>
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

  // 首页（创作作战室）为沉浸式三段式布局：隐藏顶栏与内边距，交给页面自身全高渲染
  // 画布路由（无限画布 / 自由画布 / 一键成片）同样沉浸：整个侧栏都不渲染，全屏画布 + 悬浮导航
  const isCanvasRoute =
    pathParts[0] === 'project' &&
    ['canvas', 'canvas-free3', 'canvas-auto'].includes(pathParts[2] ?? '');
  const immersive = pathParts.length === 0 || isCanvasRoute;

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
      {/* Sidebar（桌面端固定，小屏抽屉；画布全屏模式不渲染） */}
      {!isCanvasRoute && (
      <aside className={`hidden shrink-0 flex-col border-r border-sidebar-border bg-sidebar transition-[width] duration-200 lg:flex ${sidebarCollapsed ? 'w-[68px]' : immersive ? 'w-[220px]' : 'w-60'}`}>
        {sidebarBody}
      </aside>
      )}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setDrawerOpen(false)}
          />
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
        {/* TopBar（沉浸式首页隐藏） */}
        {!immersive && (
        <header className="flex h-16 items-center justify-between gap-3 border-b border-border bg-background px-4 sm:px-6">
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
            <button className="relative hidden h-9 w-9 items-center justify-center rounded-lg border border-input bg-background hover:bg-muted/50 sm:flex">
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
            {/* P1 用户中心：头像点击弹下拉，替代此前不可点的摆设头像 */}
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
                  <div className="absolute right-0 top-11 z-50 w-44 overflow-hidden rounded-xl border bg-white py-1 shadow-lg">
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
                    <button
                      onClick={() => {
                        setUserMenuOpen(false);
                        toast('演示环境暂未接入登录体系');
                      }}
                      className="flex w-full items-center gap-2.5 border-t border-border px-4 py-2.5 text-sm text-foreground hover:bg-muted"
                    >
                      <LogOut className="h-4 w-4 text-muted-foreground" />
                      退出登录
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </header>
        )}

        {/* Page content */}
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <main className={`min-w-0 flex-1 ${immersive ? `p-0 ${isCanvasRoute ? 'overflow-y-auto' : 'overflow-hidden'}` : 'overflow-y-auto p-4 sm:p-6'}`}>
            <Outlet />
          </main>
          {/* 作战室（/）与画布路由均为沉浸模式，不渲染 RightDock —— 作战室右栏由自身 TriPane 提供，避免重复 */}
          {!immersive && dockOpen && <RightDock onClose={toggleDock} />}
        </div>
      </div>
      <ConfirmHost />

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
              <div className="fixed left-4 top-[72px] z-[1001] max-h-[calc(100vh-96px)] w-60 overflow-y-auto rounded-2xl border border-border bg-white py-2 shadow-2xl">
                <div className="px-4 pb-1.5 pt-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">导航菜单</div>
                {navItems.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.end}
                    onClick={() => setCanvasNavOpen(false)}
                    className={({ isActive }) =>
                      `flex items-center gap-3 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors ${
                        isActive ? 'nav-active' : 'nav-idle'
                      }`
                    }
                  >
                    <item.icon className="h-[18px] w-[18px] shrink-0" />
                    <span>{item.label}</span>
                  </NavLink>
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
                </div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
};

export default Layout;
