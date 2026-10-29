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
  { to: 'flow', label: '流程总控', group: '概览', hint: '九段流水线总控：当前段高亮、确认门一键通过、开拍后在这里等成片' },
  { to: '', label: '概览', end: true, group: '概览', hint: '项目整体进度、成本与快捷入口' },
  { to: 'script', label: '剧本', group: '剧本圣经', hint: '查看与编辑全剧分场剧本' },
  { to: 'bible', label: '圣经', group: '剧本圣经', hint: '世界观设定与视觉风格圣经' },
  { to: 'characters', label: '人物', group: '美术资产', hint: '角色外貌、参考图与专属配音音色绑定' },
  { to: 'scenes', label: '场景', group: '美术资产', hint: '全剧场地设定与场景概念图' },
  { to: 'assets', label: '资产', group: '美术资产', hint: '项目生成的全部图片、视频、音频与合成成片' },
  { to: 'storyboard', label: '分镜', group: '镜头', hint: '结构化分镜表：逐镜生成首帧、视频与配音' },
  { to: 'director', label: '导演台', group: '镜头', hint: '三栏导演监视器：实时调节景别、机位、焦段与运镜' },
  { to: 'timeline', label: '时间线', group: '镜头', hint: '五轨时间线：按秒拖拽调整镜头时长与音画节奏' },
  { to: 'canvas-free3', label: '自由画布 3 ★', fullscreen: true, group: '画布', hint: '旗舰无限画布（1:1 Pavo 交互 + 3D 导演台 + 自动同步项目分镜）' },
  { to: 'canvas', label: '剧情画布', fullscreen: true, group: '画布', hint: '节点即工具箱模式：支持分支创作与多会话智能体' },
  { to: 'canvas-auto', label: '一键成片画布', fullscreen: true, group: '画布', hint: '从故事到角色/场景资产一键铺开编排' },
  { to: 'agents', label: 'AI助手', group: '交付', hint: '8 大影视工种智能体协同对话' },
  { to: 'tasks', label: '任务队列', group: '交付', hint: '查看后台生成队列进度、重试或取消任务' },
  { to: 'qc', label: '质检', group: '交付', hint: '成片完整性、角色一致性与钩子/CTA 规则质检' },
  { to: 'export', label: '导出', group: '交付', hint: '一键合成带配音与字幕的 MP4 成片或导出剪映草稿' },
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
          <button
            onClick={() => navigate(`/project/${id}/canvas-free3`)}
            className="flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/5 px-3.5 py-2 text-sm font-medium text-primary hover:bg-primary/10"
          >
            打开无限画布
          </button>
          {/* P1 修复：之前三个按钮均无 onClick；导出跳交付页，继续生成跳任务队列 */}
          <button
            onClick={() => navigate(`/project/${id}/export`)}
            className="flex items-center gap-1.5 rounded-lg border border-input bg-white px-3.5 py-2 text-sm font-medium text-foreground hover:bg-muted/50"
          >
            <Download className="h-4 w-4" />
            导出成片
          </button>
          <button
            onClick={() => navigate(`/project/${id}/flow`)}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90"
          >
            <Play className="h-4 w-4" />
            流程总控
          </button>
        </div>
      </div>

      {/* 新手流程引导横幅：消除极速模式进入工作台后的“假完成”困惑 */}
      {(displayStatus === 'storyboard_ready' || displayStatus === 'assets_generating' || displayStatus === 'video_generating') && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50/80 px-4 py-3 text-xs text-amber-900">
          <div>
            <span className="font-semibold">🎬 创作流水线进行中：</span>
            剧本与分镜已拆解就绪！系统正在后台队列生成分镜首帧图。你可以在「分镜」或「自由画布 3 ★」中预览画面、为镜头一键生成视频与角色配音，最后在「导出」页合成为带配音与字幕的完整 MP4。
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => navigate(`/project/${id}/storyboard`)}
              className="rounded-lg bg-white px-2.5 py-1 font-medium text-amber-900 shadow-sm hover:bg-amber-100"
            >
              去分镜表精修
            </button>
            <button
              onClick={() => navigate(`/project/${id}/tasks`)}
              className="rounded-lg bg-amber-600 px-2.5 py-1 font-medium text-white hover:bg-amber-700"
            >
              查看队列进度
            </button>
          </div>
        </div>
      )}

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
                    title={tab.hint}
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
