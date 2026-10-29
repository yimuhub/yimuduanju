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
} from 'lucide-react';

const navItems = [
  { to: '/', label: '创作作战室', icon: Sparkles, end: true },
  { to: '/dashboard', label: '数据看板', icon: LayoutDashboard },
  { to: '/projects', label: '我的项目', icon: FolderKanban },
  { to: '/project/free/canvas-free3', label: '自由画布', icon: Workflow },
  { to: '/create', label: '一键创作', icon: Wand2 },
  { to: '/templates', label: '模板中心', icon: LayoutGrid },
  { to: '/assets', label: '资产库', icon: Image },
  { to: '/ai-assistant', label: 'AI助手', icon: Bot },
  { to: '/settings', label: '设置', icon: Settings },
];

const breadcrumbMap: Record<string, string> = {
  '': '首页',
  projects: '我的项目',
  create: '一键创作',
  templates: '模板中心',
  assets: '资产库',
  'ai-assistant': 'AI助手',
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
      <div className="flex h-16 items-center gap-3 px-5 border-b border-sidebar-border">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-[#FF403A] to-[#FF7A3A] text-white shadow-sm">
          <Clapperboard className="h-5 w-5" />
        </div>
        <div className="flex flex-col leading-tight">
          <span className="text-sm font-semibold leading-snug text-foreground">
            一木·YIMU AI 视频创作平台
          </span>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            onClick={() => setDrawerOpen(false)}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-sidebar-primary text-sidebar-primary-foreground shadow-sm'
                  : 'text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
              }`
            }
          >
            <item.icon className="h-[18px] w-[18px]" />
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>

      {/* User */}
      <div className="border-t border-sidebar-border p-3">
        <div className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-sidebar-accent">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-primary to-[#FF7A3A] text-sm font-semibold text-primary-foreground">
            YM
          </div>
          <div className="flex-1 overflow-hidden">
            <div className="truncate text-sm font-medium text-foreground">
              一木用户
            </div>
            <div className="truncate text-xs text-muted-foreground">
              专业版
            </div>
          </div>
        </div>
      </div>
    </>
  );

  // 首页（创作作战室）为沉浸式三段式布局：隐藏顶栏与内边距，交给页面自身全高渲染
  const immersive = pathParts.length === 0;

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
      {/* Sidebar（桌面端固定，小屏抽屉） */}
      <aside className={`hidden shrink-0 flex-col border-r border-sidebar-border bg-sidebar lg:flex ${immersive ? 'w-[220px]' : 'w-60'}`}>
        {sidebarBody}
      </aside>
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
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-primary to-[#FF7A3A] text-sm font-semibold text-primary-foreground">
              YM
            </div>
          </div>
        </header>
        )}

        {/* Page content */}
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <main className={`min-w-0 flex-1 overflow-y-auto ${immersive ? 'overflow-hidden p-0' : 'p-4 sm:p-6'}`}>
            <Outlet />
          </main>
          {!immersive && dockOpen && <RightDock onClose={toggleDock} />}
        </div>
      </div>
      <ConfirmHost />
    </div>
  );
};

export default Layout;
