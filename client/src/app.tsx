import React, { Suspense, lazy, useEffect } from 'react';
import { Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { ErrorBoundary } from 'react-error-boundary';

import Layout from './components/Layout';
import { useWorkspaceTabs, type WorkspacePageKey } from './components/workspace/WorkspaceTabsContext';
import { readUIMode } from './lib/uiMode';
import NotFound from './pages/NotFound/NotFound';
import AgentStudio from './pages/AgentStudio/AgentStudio';
import CreateWizardPage from './pages/CreateWizard/CreateWizardPage';
import ProjectWorkspacePage from './pages/ProjectWorkspace/ProjectWorkspacePage';
import ProjectFlowTab from './pages/ProjectWorkspace/tabs/ProjectFlowTab';
import ProjectOverviewTab from './pages/ProjectWorkspace/tabs/ProjectOverviewTab';
import ProjectScriptTab from './pages/ProjectWorkspace/tabs/ProjectScriptTab';
import ProjectBibleTab from './pages/ProjectWorkspace/tabs/ProjectBibleTab';
import ProjectCharactersTab from './pages/ProjectWorkspace/tabs/ProjectCharactersTab';
import ProjectScenesTab from './pages/ProjectWorkspace/tabs/ProjectScenesTab';
import ProjectStoryboardTab from './pages/ProjectWorkspace/tabs/ProjectStoryboardTab';
import ProjectDirectorTab from './pages/ProjectWorkspace/tabs/ProjectDirectorTab';
import ProjectTimelineTab from './pages/ProjectWorkspace/tabs/ProjectTimelineTab';
import ProjectAssetsTab from './pages/ProjectWorkspace/tabs/ProjectAssetsTab';
import ProjectAgentsTab from './pages/ProjectWorkspace/tabs/ProjectAgentsTab';
import ProjectTasksTab from './pages/ProjectWorkspace/tabs/ProjectTasksTab';
import ProjectQcTab from './pages/ProjectWorkspace/tabs/ProjectQcTab';
import ProjectExportTab from './pages/ProjectWorkspace/tabs/ProjectExportTab';
// 方案 F · Studio Graphite：新界面外壳（导航轨 / 舞台 / 产出坞 / 时间线 / 状态栏）
import StudioLayout from './components/studio/StudioLayout';
import { StudioShell } from './components/studio/StudioShell';
import StudioHomePage from './pages/Studio/StudioHomePage';
import StudioProjectPage from './pages/Studio/StudioProjectPage';
import StudioSectionPage from './pages/Studio/StudioSectionPage';
import { CanvasModePage } from './pages/CanvasMode/CanvasModePage';
// P1 性能：画布（含 three/xyflow 重依赖）懒加载，首屏不再背全量包
const FreeCanvas3Page = lazy(() => import('./pages/FreeCanvas3/FreeCanvas3Page'));

// Studio 外壳（无项目上下文）+ 全幅内容页：/create 三栏 TriPane 与 /canvases 卡片画布页
// 需要完整宽度与高度，这里只提供左导航轨 + 底状态栏，不再包 .studio-page 内边距容器。
const StudioBarePage = ({ children }: { children: React.ReactNode }) => (
  <StudioShell>
    <div className="flex min-h-0 flex-1 flex-col">{children}</div>
  </StudioShell>
);

// 经典模式整页路由：与极客模式右栏签共用同一批懒加载 chunk（Vite 按 module 去重，不重复打包）
const ClassicPages = {
  dashboard: lazy(() => import('./pages/Dashboard/DashboardPage')),
  projects: lazy(() => import('./pages/Projects/ProjectsPage')),
  templates: lazy(() => import('./pages/Templates/TemplatesPage')),
  styles: lazy(() => import('./pages/Styles/StylesPage')),
  assets: lazy(() => import('./pages/Assets/AssetsPage')),
  'ai-assistant': lazy(() => import('./pages/AiAssistant/AiAssistantPage')),
  account: lazy(() => import('./pages/Account/AccountPage')),
  settings: lazy(() => import('./pages/Settings/SettingsPage')),
  'system-logs': lazy(() => import('./pages/SystemLogs/SystemLogsPage')),
  queue: lazy(() => import('./pages/Queue/QueuePage')),
} as const;
const SystemLogsPage = ClassicPages['system-logs'];
const QueuePage = ClassicPages.queue;

/** JSX 不支持 `Foo['bar']` 成员表达式，这里取出带连字符的键 */
const AiAssistantPage = ClassicPages['ai-assistant'];

const RoutesComponent = () => {
  // 浏览器页签标题：平台渲染的 HTML 标题不可控，应用挂载后统一覆盖为品牌名
  useEffect(() => {
    document.title = '一幕·YIMU AI 短剧创作平台';
  }, []);
  // 三模式：studio = 方案 F（默认）；classic = 经典侧栏；geek = 极客三栏
  const mode = readUIMode();
  const isClassic = mode === 'classic';
  const isStudio = mode === 'studio';
  return (
    <Routes>
      {isStudio ? (
        <>
          {/* 画布沉浸全屏：独立于 Studio 外壳 */}
          <Route
            path="project/:id/canvas-free3"
            element={
              <RouteErrorGuard>
                <Suspense fallback={<CanvasLoading tip="自由画布加载中..." />}>
                  <FreeCanvas3Page />
                </Suspense>
              </RouteErrorGuard>
            }
          />
          <Route element={<StudioLayout />}>
            {/* 首页 = 工作台（对话 + 真实项目列表） */}
            <Route index element={<StudioHomePage />} />
            {/* 项目工作区：URL 片段决定「舞台视图 + 右坞 Tab」 */}
            <Route path="project/:id/*" element={<StudioProjectPage />} />
            {/* 既有整页：塞进 Studio 舞台，右坞与时间线自动隐藏 */}
            <Route path="dashboard" element={<StudioSectionPage />}>
              <Route
                index
                element={
                  <RouteErrorGuard>
                    <Suspense fallback={<CanvasLoading tip="页面加载中..." />}>
                      <ClassicPages.dashboard />
                    </Suspense>
                  </RouteErrorGuard>
                }
              />
            </Route>
            <Route path="projects" element={<StudioSectionPage />}>
              <Route
                index
                element={
                  <RouteErrorGuard>
                    <Suspense fallback={<CanvasLoading tip="页面加载中..." />}>
                      <ClassicPages.projects />
                    </Suspense>
                  </RouteErrorGuard>
                }
              />
            </Route>
            <Route path="templates" element={<StudioSectionPage />}>
              <Route
                index
                element={
                  <RouteErrorGuard>
                    <Suspense fallback={<CanvasLoading tip="页面加载中..." />}>
                      <ClassicPages.templates />
                    </Suspense>
                  </RouteErrorGuard>
                }
              />
            </Route>
            <Route path="styles" element={<StudioSectionPage />}>
              <Route
                index
                element={
                  <RouteErrorGuard>
                    <Suspense fallback={<CanvasLoading tip="页面加载中..." />}>
                      <ClassicPages.styles />
                    </Suspense>
                  </RouteErrorGuard>
                }
              />
            </Route>
            <Route path="assets" element={<StudioSectionPage />}>
              <Route
                index
                element={
                  <RouteErrorGuard>
                    <Suspense fallback={<CanvasLoading tip="页面加载中..." />}>
                      <ClassicPages.assets />
                    </Suspense>
                  </RouteErrorGuard>
                }
              />
            </Route>
            <Route path="ai-assistant" element={<StudioSectionPage />}>
              <Route
                index
                element={
                  <RouteErrorGuard>
                    <Suspense fallback={<CanvasLoading tip="页面加载中..." />}>
                      <AiAssistantPage />
                    </Suspense>
                  </RouteErrorGuard>
                }
              />
            </Route>
            <Route path="account" element={<StudioSectionPage />}>
              <Route
                index
                element={
                  <RouteErrorGuard>
                    <Suspense fallback={<CanvasLoading tip="页面加载中..." />}>
                      <ClassicPages.account />
                    </Suspense>
                  </RouteErrorGuard>
                }
              />
            </Route>
            <Route path="settings" element={<StudioSectionPage />}>
              <Route
                index
                element={
                  <RouteErrorGuard>
                    <Suspense fallback={<CanvasLoading tip="页面加载中..." />}>
                      <ClassicPages.settings />
                    </Suspense>
                  </RouteErrorGuard>
                }
              />
            </Route>
            {/* 系统日志：全量日志读取 + 失败任务诊断，URL 支持 ?jobId= 直达 */}
            <Route path="system-logs" element={<StudioSectionPage />}>
              <Route
                index
                element={
                  <RouteErrorGuard>
                    <Suspense fallback={<CanvasLoading tip="系统日志加载中..." />}>
                      <SystemLogsPage />
                    </Suspense>
                  </RouteErrorGuard>
                }
              />
            </Route>
            {/* 全站排队：跨项目按真实执行顺序展示，可暂停/终止/调序 */}
            <Route path="queue" element={<StudioSectionPage />}>
              <Route
                index
                element={
                  <RouteErrorGuard>
                    <Suspense fallback={<CanvasLoading tip="全站排队加载中..." />}>
                      <QueuePage />
                    </Suspense>
                  </RouteErrorGuard>
                }
              />
            </Route>
            <Route
              path="create"
              element={
                <RouteErrorGuard>
                  <StudioBarePage>
                    <CreateWizardPage />
                  </StudioBarePage>
                </RouteErrorGuard>
              }
            />
            {/* 画布模式：所有画布项目的卡片式展示 + 新建/编辑/删除 */}
            <Route
              path="canvases"
              element={
                <RouteErrorGuard>
                  <StudioBarePage>
                    <CanvasModePage />
                  </StudioBarePage>
                </RouteErrorGuard>
              }
            />
          </Route>
        </>
      ) : (
        <Route element={<Layout />}>
          {/* 画布：Layout 检测 canvas-free3 路径进入全屏沉浸模式（不渲染侧栏/顶栏/RightDock），
              并在左上角挂品牌悬浮导航按钮（见 Layout isCanvasRoute） */}
          <Route
            path="project/:id/canvas-free3"
            element={
              <RouteErrorGuard>
                <Suspense fallback={<CanvasLoading tip="自由画布加载中..." />}>
                  <FreeCanvas3Page />
                </Suspense>
              </RouteErrorGuard>
            }
          />
          {/* 首页 = 创作作战室；经典模式下作为侧栏「创作作战室」项对应的普通页面渲染 */}
          <Route index element={<AgentStudio />} />
          <Route path="create" element={<CreateWizardPage />} />
          {/* 画布模式：卡片式画布项目列表（此前仅 Studio 模式有该路由，经典/极客模式下访问会 404） */}
          <Route
            path="canvases"
            element={
              <RouteErrorGuard>
                <CanvasModePage />
              </RouteErrorGuard>
            }
          />
          {isClassic ? (
            <>
              {/* 经典模式：所有真实路由直接整页渲染 */}
              {(Object.keys(ClassicPages) as (keyof typeof ClassicPages)[]).map((key) => {
                const Page = ClassicPages[key];
                return (
                  <Route
                    key={key}
                    path={key}
                    element={
                      <RouteErrorGuard>
                        <Suspense fallback={<CanvasLoading tip="页面加载中..." />}>
                          <Page />
                        </Suspense>
                      </RouteErrorGuard>
                    }
                  />
                );
              })}
            </>
          ) : (
            <>
              {/* 旧路由兼容（仅极客模式）：/dashboard 等直接访问 → 回首页并在右栏自动打开对应标签页 */}
              <Route path="dashboard" element={<LegacyRedirect pageKey="dashboard" />} />
              <Route path="projects" element={<LegacyRedirect pageKey="projects" />} />
              <Route path="templates" element={<LegacyRedirect pageKey="templates" />} />
              <Route path="styles" element={<LegacyRedirect pageKey="styles" />} />
              <Route path="assets" element={<LegacyRedirect pageKey="assets" />} />
              <Route path="ai-assistant" element={<LegacyRedirect pageKey="ai-assistant" />} />
              <Route path="account" element={<LegacyRedirect pageKey="account" />} />
              <Route path="settings" element={<LegacyRedirect pageKey="settings" />} />
              {/* 极客模式：系统日志 / 全站排队没有对应右栏标签，直接整页打开 */}
              <Route
                path="system-logs"
                element={
                  <RouteErrorGuard>
                    <Suspense fallback={<CanvasLoading tip="系统日志加载中..." />}>
                      <SystemLogsPage />
                    </Suspense>
                  </RouteErrorGuard>
                }
              />
              <Route
                path="queue"
                element={
                  <RouteErrorGuard>
                    <Suspense fallback={<CanvasLoading tip="全站排队加载中..." />}>
                      <QueuePage />
                    </Suspense>
                  </RouteErrorGuard>
                }
              />
            </>
          )}
          <Route path="project/:id" element={<ProjectWorkspacePage />}>
            <Route path="flow" element={<ProjectFlowTab />} />
            <Route index element={<ProjectOverviewTab />} />
            <Route path="script" element={<ProjectScriptTab />} />
            <Route path="bible" element={<ProjectBibleTab />} />
            <Route path="characters" element={<ProjectCharactersTab />} />
            <Route path="scenes" element={<ProjectScenesTab />} />
            <Route path="storyboard" element={<ProjectStoryboardTab />} />
            <Route path="director" element={<ProjectDirectorTab />} />
            {/* 经典 / 极客：时间线已并入 Studio 底部，这里只保留一键迁移引导 */}
            <Route path="timeline" element={<ProjectTimelineTab />} />
            <Route path="assets" element={<ProjectAssetsTab />} />
            <Route path="agents" element={<ProjectAgentsTab />} />
            <Route path="tasks" element={<ProjectTasksTab />} />
            <Route path="qc" element={<ProjectQcTab />} />
            <Route path="export" element={<ProjectExportTab />} />
          </Route>
        </Route>
      )}
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
};

const routeFallback = (
  <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
    页面加载失败，
    <button
      onClick={() => window.location.reload()}
      className="ml-1 font-medium text-primary hover:underline"
    >
      点击重试
    </button>
  </div>
);

/** P1 稳定性：单个路由崩溃只影响当前页，不再整站白屏；切换路由自动重置 */
const RouteErrorGuard = ({ children }: { children: React.ReactNode }) => {
  const location = useLocation();
  return (
    <ErrorBoundary FallbackComponent={() => routeFallback} resetKeys={[location.pathname]}>
      {children}
    </ErrorBoundary>
  );
};

/** 旧路由兼容：直接访问 /projects 等旧地址时，回首页并在右栏自动打开对应功能标签页 */
const LegacyRedirect = ({ pageKey }: { pageKey: WorkspacePageKey }) => {
  const { openTab } = useWorkspaceTabs();
  const navigate = useNavigate();
  useEffect(() => {
    openTab(pageKey);
    navigate('/', { replace: true });
    // 仅在首次挂载时执行一次重定向
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
};

const CanvasLoading = ({ tip }: { tip: string }) => (
  <div className="flex h-screen w-screen items-center justify-center bg-[#F6F7F9]">
    <div className="flex flex-col items-center gap-3">
      <div className="h-10 w-10 animate-spin rounded-full border-2 border-[#1FA97E]/30 border-t-[#1FA97E]" />
      <div className="text-sm text-muted-foreground">{tip}</div>
    </div>
  </div>
);

export default RoutesComponent;
