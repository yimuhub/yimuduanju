import React, { Suspense, lazy, useEffect } from 'react';
import { Route, Routes, useLocation } from 'react-router-dom';
import { ErrorBoundary } from 'react-error-boundary';

import Layout from './components/Layout';
import NotFound from './pages/NotFound/NotFound';
import AgentStudio from './pages/AgentStudio/AgentStudio';
import DashboardPage from './pages/Dashboard/DashboardPage';
import ProjectsPage from './pages/Projects/ProjectsPage';
import CreateWizardPage from './pages/CreateWizard/CreateWizardPage';
import TemplatesPage from './pages/Templates/TemplatesPage';
import AssetsPage from './pages/Assets/AssetsPage';
import AiAssistantPage from './pages/AiAssistant/AiAssistantPage';
import StylesPage from './pages/Styles/StylesPage';
import AccountPage from './pages/Account/AccountPage';
import SettingsPage from './pages/Settings/SettingsPage';
import ProjectWorkspacePage from './pages/ProjectWorkspace/ProjectWorkspacePage';
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
// P1 性能：三个画布（含 three/xyflow 重依赖与一键成片流水线）懒加载，首屏不再背全量包
const PavoCanvas = lazy(() => import('./pages/CanvasStudioV2/PavoCanvas'));
const CanvasAutoPage = lazy(() => import('./pages/CanvasStudioV2/CanvasAutoPage'));
const FreeCanvas3Page = lazy(() => import('./pages/FreeCanvas3/FreeCanvas3Page'));

const RoutesComponent = () => {
  // 浏览器页签标题：平台渲染的 HTML 标题不可控，应用挂载后统一覆盖为品牌名
  useEffect(() => {
    document.title = '一幕·YIMU AI 短剧工坊';
  }, []);
  return (
    <Routes>
      {/* 无限画布 v2 · Pavo 式交互（节点即工具箱 / 分支创作 / 3D 导演台 / @ 引用） */}
      <Route
        path="project/:id/canvas"
        element={
          <RouteErrorGuard>
            <Suspense fallback={<CanvasLoading tip="无限画布加载中..." />}>
              <PavoCanvas />
            </Suspense>
          </RouteErrorGuard>
        }
      />
      {/* 一键成片独立流水线页（已拆分为 8 步可视化确认与批量全自动投递工作台） */}
      <Route
        path="project/:id/canvas-auto"
        element={
          <RouteErrorGuard>
            <Suspense fallback={<CanvasLoading tip="一键成片流水线加载中..." />}>
              <CanvasAutoPage />
            </Suspense>
          </RouteErrorGuard>
        }
      />
      {/* 自由画布 3 · 1:1 对标 Pavo（开发中：Pavo 逐项实测取证后重做） */}
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
      <Route element={<Layout />}>
        {/* 首页 = 创作作战室（Agent 三段式）；数据看板移至 /dashboard */}
        <Route index element={<AgentStudio />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="projects" element={<ProjectsPage />} />
        <Route path="create" element={<CreateWizardPage />} />
        <Route path="templates" element={<TemplatesPage />} />
        <Route path="styles" element={<StylesPage />} />
        <Route path="assets" element={<AssetsPage />} />
        <Route path="ai-assistant" element={<AiAssistantPage />} />
        <Route path="account" element={<AccountPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="project/:id" element={<ProjectWorkspacePage />}>
          <Route index element={<ProjectOverviewTab />} />
          <Route path="script" element={<ProjectScriptTab />} />
          <Route path="bible" element={<ProjectBibleTab />} />
          <Route path="characters" element={<ProjectCharactersTab />} />
          <Route path="scenes" element={<ProjectScenesTab />} />
          <Route path="storyboard" element={<ProjectStoryboardTab />} />
          <Route path="director" element={<ProjectDirectorTab />} />
          <Route path="timeline" element={<ProjectTimelineTab />} />
          <Route path="assets" element={<ProjectAssetsTab />} />
          <Route path="agents" element={<ProjectAgentsTab />} />
          <Route path="tasks" element={<ProjectTasksTab />} />
          <Route path="qc" element={<ProjectQcTab />} />
          <Route path="export" element={<ProjectExportTab />} />
        </Route>
      </Route>
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

const CanvasLoading = ({ tip }: { tip: string }) => (
  <div className="flex h-screen w-screen items-center justify-center bg-[#F6F7F9]">
    <div className="flex flex-col items-center gap-3">
      <div className="h-10 w-10 animate-spin rounded-full border-2 border-[#1FA97E]/30 border-t-[#1FA97E]" />
      <div className="text-sm text-muted-foreground">{tip}</div>
    </div>
  </div>
);

export default RoutesComponent;
