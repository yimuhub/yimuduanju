/**
 * Studio · 右产出坞
 * -------------------------------------------------------------
 * 7 个 Tab（与设计稿一致）：
 *   预览   —— 新写，接真实首帧图 / 视频 / 胶片条
 *   剧本   —— 复用 ProjectScriptTab
 *   圣经   —— 复用 ProjectBibleTab
 *   分镜   —— 复用 ProjectStoryboardTab
 *   资产   —— 复用 ProjectAssetsTab
 *   质检   —— 复用 ProjectQcTab
 *   导出   —— 复用 ProjectExportTab
 *
 * 被复用的页签均通过 useParams 取项目 id，因此本组件必须渲染在
 * /project/:id 路由内部（由 StudioProjectPage 保证）。
 */
import { useCallback, useRef, useState } from 'react';
import { useStudio } from './StudioShell';
import { StudioPreview } from './StudioPreview';
import { DOCK_TABS, type DockTabKey } from './studioRoutes';
import ProjectScriptTab from '@client/src/pages/ProjectWorkspace/tabs/ProjectScriptTab';
import ProjectBibleTab from '@client/src/pages/ProjectWorkspace/tabs/ProjectBibleTab';
import ProjectStoryboardTab from '@client/src/pages/ProjectWorkspace/tabs/ProjectStoryboardTab';
import ProjectAssetsTab from '@client/src/pages/ProjectWorkspace/tabs/ProjectAssetsTab';
import ProjectQcTab from '@client/src/pages/ProjectWorkspace/tabs/ProjectQcTab';
import ProjectExportTab from '@client/src/pages/ProjectWorkspace/tabs/ProjectExportTab';

/** 右坞宽度上下限（px） */
const DOCK_MIN = 380;
const DOCK_MAX = 980;

export const StudioDock = () => {
  const { data, dockTab, setDockTab, projectId, setDockW } = useStudio();
  const tab = dockTab || 'preview';
  const [dragging, setDragging] = useState(false);
  const draggingRef = useRef(false);

  /** 拖拽左缘把手调整右坞宽度 */
  const onResizeStart = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      draggingRef.current = true;
      setDragging(true);
      const move = (ev: PointerEvent) => {
        if (!draggingRef.current) return;
        const next = window.innerWidth - ev.clientX;
        setDockW(Math.max(DOCK_MIN, Math.min(DOCK_MAX, Math.round(next))));
      };
      const up = () => {
        draggingRef.current = false;
        setDragging(false);
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    },
    [setDockW],
  );

  /** 双击把手：恢复设计稿默认宽度 */
  const onResizeReset = useCallback(() => setDockW(null), [setDockW]);

  const count = (n: number | undefined) => (n ? <span className="num">{n}</span> : null);

  const renderPane = () => {
    if (tab === 'preview') return <StudioPreview />;
    if (!projectId) {
      return (
        <div className="placeholder">
          <b>产出坞</b>
          进入一个项目后，这里会显示该项目的剧本、圣经、分镜、资产、质检与导出。
        </div>
      );
    }
    switch (tab) {
      case 'script':
        return <ProjectScriptTab />;
      case 'bible':
        return <ProjectBibleTab />;
      case 'board':
        return <ProjectStoryboardTab />;
      case 'assets':
        return <ProjectAssetsTab />;
      case 'qc':
        return <ProjectQcTab />;
      case 'export':
        return <ProjectExportTab />;
      default:
        return <StudioPreview />;
    }
  };

  return (
    <aside className="dock" id="dock">
      <div
        className={`dock-resizer${dragging ? ' dragging' : ''}`}
        onPointerDown={onResizeStart}
        onDoubleClick={onResizeReset}
        title="拖拽调整产出坞宽度（双击恢复默认）"
        role="separator"
        aria-orientation="vertical"
      />
      <div className="dock-head">
        <span className="dock-title">产出</span>
        <div className="tabs" id="tabs">
          {DOCK_TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              className={`tab${tab === t.key ? ' on' : ''}`}
              onClick={() => setDockTab(t.key)}
            >
              {t.label}
              {t.key === 'board' ? count(data.shotStats.total) : null}
              {t.key === 'qc' ? count(data.jobs.filter((j) => j.status === 'failed').length) : null}
            </button>
          ))}
        </div>
      </div>
      <div className="dock-body">
        <div className="pane on">{renderPane()}</div>
      </div>
    </aside>
  );
};
