import { NavLink, Outlet, useParams, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import {
  Play,
  Download,
} from 'lucide-react';
import { projects } from '@client/src/api';
import type { Project, ProjectStatus } from '@shared/api.interface';
import { logger } from '@client/src/utils/logger';

const tabs = [
  { to: '', label: '概览', end: true, group: '概览' },
  { to: 'script', label: '剧本', group: '剧本圣经' },
  { to: 'bible', label: '圣经', group: '剧本圣经' },
  { to: 'characters', label: '人物', group: '美术资产' },
  { to: 'scenes', label: '场景', group: '美术资产' },
  { to: 'assets', label: '资产', group: '美术资产' },
  { to: 'storyboard', label: '分镜', group: '镜头' },
  { to: 'director', label: '导演台', group: '镜头' },
  { to: 'timeline', label: '时间线', group: '镜头' },
  { to: 'canvas', label: '无限画布', fullscreen: true, group: '画布' },
  { to: 'canvas-auto', label: '一键成片', fullscreen: true, group: '画布' },
  { to: 'canvas-free3', label: '自由画布 3', fullscreen: true, group: '画布' },
  { to: 'agents', label: 'AI助手', group: '交付' },
  { to: 'tasks', label: '任务队列', group: '交付' },
  { to: 'qc', label: '质检', group: '交付' },
  { to: 'export', label: '导出', group: '交付' },
];

// P1 改造：16 个平级 Tab 改为 6 分组导航（路由不变，仅导航分组，解决横向滚动过重）
const TAB_GROUPS = ['概览', '剧本圣经', '美术资产', '镜头', '画布', '交付'];

const statusLabelMap: Record<ProjectStatus, string> = {
  draft: '草稿',
  parsing: '解析中',
  planning: '规划中',
  bible_ready: '圣经已就绪',
  storyboard_ready: '分镜已就绪',
  assets_generating: '资产生成中',
  video_generating: '视频生成中',
  audio_generating: '音频生成中',
  editing: '剪辑中',
  qc: '质检中',
  ready: '已完成',
  exported: '已导出',
  failed: '失败',
};

const statusColorMap: Record<ProjectStatus, string> = {
  draft: 'bg-gray-100 text-gray-600',
  parsing: 'bg-blue-50 text-blue-600',
  planning: 'bg-blue-50 text-blue-600',
  bible_ready: 'bg-green-50 text-green-600',
  storyboard_ready: 'bg-green-50 text-green-600',
  assets_generating: 'bg-amber-50 text-amber-600',
  video_generating: 'bg-amber-50 text-amber-600',
  audio_generating: 'bg-amber-50 text-amber-600',
  editing: 'bg-purple-50 text-purple-600',
  qc: 'bg-purple-50 text-purple-600',
  ready: 'bg-green-50 text-green-600',
  exported: 'bg-green-50 text-green-600',
  failed: 'bg-red-50 text-red-600',
};

const ProjectWorkspacePage = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [project, setProject] = useState<Project | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    projects.getProject(id)
      .then((data) => setProject(data))
      .catch((err) => {
        logger.error('Failed to load project:', String(err));
        setError('加载项目信息失败');
      });
  }, [id]);

  const displayTitle = project?.title || `短剧项目 · ${id?.slice(0, 8) || ''}`;
  const displayStatus: ProjectStatus = project?.status || 'draft';

  return (
    <div className="space-y-6">
      {/* Project header */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <h1 className="truncate text-xl font-semibold text-foreground">
              {displayTitle}
            </h1>
            <span
              className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${statusColorMap[displayStatus]}`}
            >
              {statusLabelMap[displayStatus]}
            </span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {project
              ? `更新于 ${new Date(project.updatedAt).toLocaleString('zh-CN')}`
              : error || '加载中...'}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {/* P1 修复：之前三个按钮均无 onClick；导出跳交付页，继续生成跳任务队列 */}
          <button
            onClick={() => navigate(`/project/${id}/export`)}
            className="flex items-center gap-1.5 rounded-lg border border-input bg-white px-3.5 py-2 text-sm font-medium text-foreground hover:bg-muted/50"
          >
            <Download className="h-4 w-4" />
            导出
          </button>
          <button
            onClick={() => navigate(`/project/${id}/tasks`)}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90"
          >
            <Play className="h-4 w-4" />
            继续生成
          </button>
        </div>
      </div>

      {/* Tabs（分组导航） */}
      <div className="-mx-6 border-b border-border px-6">
        <div className="flex items-center gap-4 overflow-x-auto scrollbar-thin">
          {TAB_GROUPS.map((group, gi) => (
            <div key={group} className="flex shrink-0 items-center gap-1">
              {gi > 0 && <span className="mx-1 h-4 w-px bg-border" />}
              <span className="mr-0.5 hidden text-[11px] font-medium text-muted-foreground/70 xl:inline">
                {group}
              </span>
              {tabs
                .filter((tab) => tab.group === group)
                .map((tab) => (
                  <NavLink
                    key={tab.to || 'overview'}
                    to={tab.fullscreen ? `/project/${id}/${tab.to}` : tab.to}
                    end={tab.end}
                    className={({ isActive }) =>
                      `relative shrink-0 px-3 py-3 text-sm font-medium transition-colors ${
                        isActive
                          ? 'text-primary'
                          : 'text-muted-foreground hover:text-foreground'
                      }`
                    }
                  >
                    {({ isActive }) => (
                      <>
                        {tab.label}
                        {isActive && (
                          <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
                        )}
                      </>
                    )}
                  </NavLink>
                ))}
            </div>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div>
        <Outlet />
      </div>
    </div>
  );
};

export default ProjectWorkspacePage;
