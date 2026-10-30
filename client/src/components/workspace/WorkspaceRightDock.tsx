import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { Loader2, Plus, X, AlertCircle } from 'lucide-react';
import {
  OUTPUT_TAB,
  WORKSPACE_PAGES,
  useWorkspaceTabs,
  type WorkspacePageKey,
} from '@client/src/components/workspace/WorkspaceTabsContext';

/**
 * 右栏 · 功能坞（类浏览器标签页，AI-EOS 极客模式）
 * ─────────────────────────────────────────────
 * - 默认「产出」签：由 AgentStudio 传入 outputView（产出资产 / 生成任务 / 活动轨迹子视图），固定不可关
 * - 功能签：数据看板 / 我的项目 / 风格中心 / 模板中心 / 资产库 / AI助手 / 用户中心 / 设置，
 *   每签直接懒渲染 client/src/pages 下真实页面组件（复用现有深色页面）
 * - 右上 + 号：下拉列出尚未打开的功能，点击新开签
 */

const PAGE_COMPONENTS: Record<
  WorkspacePageKey,
  React.LazyExoticComponent<React.ComponentType<unknown>>
> = {
  dashboard: lazy(() => import('@client/src/pages/Dashboard/DashboardPage')),
  projects: lazy(() => import('@client/src/pages/Projects/ProjectsPage')),
  styles: lazy(() => import('@client/src/pages/Styles/StylesPage')),
  templates: lazy(() => import('@client/src/pages/Templates/TemplatesPage')),
  assets: lazy(() => import('@client/src/pages/Assets/AssetsPage')),
  'ai-assistant': lazy(() => import('@client/src/pages/AiAssistant/AiAssistantPage')),
  account: lazy(() => import('@client/src/pages/Account/AccountPage')),
  settings: lazy(() => import('@client/src/pages/Settings/SettingsPage')),
};

const TabLoading = () => (
  <div className="flex h-40 items-center justify-center text-muted-foreground">
    <Loader2 className="h-5 w-5 animate-spin" />
  </div>
);

const TabError = ({ pageKey }: { pageKey: WorkspacePageKey }) => {
  const { closeTab, openTab } = useWorkspaceTabs();
  return (
    <div className="flex h-40 flex-col items-center justify-center gap-2 text-muted-foreground">
      <AlertCircle className="h-5 w-5 text-red-400" />
      <p className="text-xs">页面加载失败</p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => {
            closeTab(pageKey);
            // 下一帧重开，触发懒加载重试
            window.setTimeout(() => openTab(pageKey), 0);
          }}
          className="rounded-md border border-input px-2 py-1 text-xs hover:bg-muted"
        >
          重试
        </button>
        <button
          type="button"
          onClick={() => closeTab(pageKey)}
          className="rounded-md border border-input px-2 py-1 text-xs hover:bg-muted"
        >
          关闭
        </button>
      </div>
    </div>
  );
};

interface WorkspaceRightDockProps {
  /** 固定「产出」签内容（AgentStudio 的产出资产/生成任务/活动轨迹子视图） */
  outputView: React.ReactNode;
}

const WorkspaceRightDock = ({ outputView }: WorkspaceRightDockProps) => {
  const { tabs, activeKey, setActiveKey, closeTab, openTab } = useWorkspaceTabs();
  const [plusOpen, setPlusOpen] = useState(false);
  const plusRef = useRef<HTMLDivElement>(null);

  // + 下拉：点击外部关闭
  useEffect(() => {
    if (!plusOpen) return;
    const onDown = (e: MouseEvent) => {
      if (plusRef.current && !plusRef.current.contains(e.target as Node)) setPlusOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [plusOpen]);

  const closedPages = WORKSPACE_PAGES.filter((p) => !tabs.some((t) => t.key === p.key));
  const activeTab = tabs.find((t) => t.key === activeKey) ?? OUTPUT_TAB;

  return (
    <aside className="flex h-full min-h-0 w-full min-w-0 flex-col border-l border-sidebar-border bg-sidebar">
      {/* 标签页条（类浏览器：横向滚动 + 固定 + 号） */}
      <div className="flex h-10 shrink-0 items-stretch border-b border-sidebar-border">
        <div className="flex min-w-0 flex-1 items-stretch overflow-x-auto dock-tabs-scroll">
          {tabs.map((t) => {
            const active = t.key === activeKey;
            const closable = t.key !== OUTPUT_TAB.key;
            return (
              <div
                key={t.key}
                className={`group/tab flex shrink-0 items-center gap-1.5 border-r border-sidebar-border pl-3 pr-2 text-xs transition-colors ${
                  active
                    ? 'bg-background font-medium text-foreground'
                    : 'text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
                }`}
              >
                <button
                  type="button"
                  onClick={() => setActiveKey(t.key)}
                  className="flex items-center gap-1.5 py-2"
                  title={t.title}
                >
                  <t.icon className="h-3.5 w-3.5 shrink-0" />
                  <span className="whitespace-nowrap">{t.title}</span>
                </button>
                {closable && (
                  <button
                    type="button"
                    onClick={() => closeTab(t.key)}
                    aria-label={`关闭 ${t.title}`}
                    className={`rounded p-0.5 transition-opacity hover:bg-muted hover:text-foreground ${
                      active ? 'opacity-60' : 'opacity-0 group-hover/tab:opacity-60'
                    }`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
        {/* + 号：从功能列表再开新签 */}
        <div ref={plusRef} className="relative flex shrink-0 items-center border-l border-sidebar-border px-1.5">
          <button
            type="button"
            onClick={() => setPlusOpen((v) => !v)}
            aria-label="打开功能页"
            title="打开功能页"
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <Plus className="h-4 w-4" />
          </button>
          {plusOpen && (
            <div className="absolute right-1.5 top-9 z-50 w-56 overflow-hidden rounded-xl border border-border bg-card py-1 shadow-2xl">
              <div className="px-3 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                打开功能页
              </div>
              {closedPages.length === 0 ? (
                <p className="px-3 py-2 text-xs text-muted-foreground">全部功能页均已打开</p>
              ) : (
                closedPages.map((p) => (
                  <button
                    key={p.key}
                    type="button"
                    onClick={() => {
                      openTab(p.key);
                      setPlusOpen(false);
                    }}
                    className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs text-foreground hover:bg-muted"
                  >
                    <p.icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">{p.title}</span>
                      <span className="block truncate text-[10px] text-muted-foreground">{p.description}</span>
                    </span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      {/* 内容区：产出签 = AgentStudio 子视图；功能签 = 真实页面组件。
          pane-narrow 容器查询让窄签页面自动收起宽版侧元素；overflow 双向裁剪保证无溢出 */}
      {activeTab.key === OUTPUT_TAB.key ? (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">{outputView}</div>
      ) : activeTab.pageKey ? (
        <div className="pane-narrow min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto p-4 sm:p-5">
          <Suspense fallback={<TabLoading />}>
            {(() => {
              const Page = PAGE_COMPONENTS[activeTab.pageKey];
              return Page ? <Page /> : <TabError pageKey={activeTab.pageKey} />;
            })()}
          </Suspense>
        </div>
      ) : null}
    </aside>
  );
};

export default WorkspaceRightDock;
