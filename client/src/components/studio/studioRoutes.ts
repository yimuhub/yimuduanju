/**
 * Studio · 路由映射（URL 是唯一真源）
 * -------------------------------------------------------------
 * 方案 F 的右产出坞 7 个 Tab 与项目既有页面，共用一条 URL 约定：
 *
 *   /project/:id                 → 舞台=对话，右坞=预览
 *   /project/:id/canvas          → 舞台=无限画布，右坞=预览
 *   /project/:id/script          → 舞台=对话，右坞=剧本
 *   /project/:id/bible           → 舞台=对话，右坞=圣经
 *   /project/:id/storyboard      → 舞台=对话，右坞=分镜
 *   /project/:id/assets          → 舞台=对话，右坞=资产
 *   /project/:id/qc              → 舞台=对话，右坞=质检
 *   /project/:id/export          → 舞台=对话，右坞=导出
 *   /project/:id/<page-seg>      → 舞台=内容页，右坞=预览
 *
 * 这样刷新、分享链接、浏览器前进后退都能落到同一处；
 * 画布 / 时间线 / 右坞预览 / 分镜四者又共用同一份 StudioShot[]，
 * 不会出现「时间码不自洽、引用索引错位」。
 */
import ProjectFlowTab from '@client/src/pages/ProjectWorkspace/tabs/ProjectFlowTab';
import ProjectOverviewTab from '@client/src/pages/ProjectWorkspace/tabs/ProjectOverviewTab';
import ProjectCharactersTab from '@client/src/pages/ProjectWorkspace/tabs/ProjectCharactersTab';
import ProjectScenesTab from '@client/src/pages/ProjectWorkspace/tabs/ProjectScenesTab';
import ProjectDirectorTab from '@client/src/pages/ProjectWorkspace/tabs/ProjectDirectorTab';
import ProjectTimelineTab from '@client/src/pages/ProjectWorkspace/tabs/ProjectTimelineTab';
import ProjectAgentsTab from '@client/src/pages/ProjectWorkspace/tabs/ProjectAgentsTab';
import ProjectTasksTab from '@client/src/pages/ProjectWorkspace/tabs/ProjectTasksTab';

export type DockTabKey =
  | 'preview'
  | 'script'
  | 'bible'
  | 'board'
  | 'assets'
  | 'qc'
  | 'export';

export const DOCK_TABS: { key: DockTabKey; label: string }[] = [
  { key: 'preview', label: '预览' },
  { key: 'script', label: '剧本' },
  { key: 'bible', label: '圣经' },
  { key: 'board', label: '分镜' },
  { key: 'assets', label: '资产' },
  { key: 'qc', label: '质检' },
  { key: 'export', label: '导出' },
];

/** URL 片段 → 右坞 Tab */
export const DOCK_SEG: Record<string, DockTabKey> = {
  script: 'script',
  bible: 'bible',
  storyboard: 'board',
  assets: 'assets',
  qc: 'qc',
  export: 'export',
};

/** 右坞 Tab → URL 片段（preview 对应项目根路径） */
export const DOCK_SEG_OF: Record<DockTabKey, string | null> = {
  preview: null,
  script: 'script',
  bible: 'bible',
  board: 'storyboard',
  assets: 'assets',
  qc: 'qc',
  export: 'export',
};

/** 舞台内容页：URL 片段 → 复用既有页签组件 */
export const PAGE_SEGS: Record<string, React.ComponentType> = {
  overview: ProjectOverviewTab,
  flow: ProjectFlowTab,
  characters: ProjectCharactersTab,
  scenes: ProjectScenesTab,
  director: ProjectDirectorTab,
  timeline: ProjectTimelineTab,
  agents: ProjectAgentsTab,
  tasks: ProjectTasksTab,
};

export const PAGE_SEG_LIST = Object.keys(PAGE_SEGS);
