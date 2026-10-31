import { NavLink, Outlet, useParams, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import {
  Play,
  Download,
  Workflow,
  LayoutDashboard,
  FileText,
  BookOpen,
  Users,
  MapPin,
  Image,
  Film,
  Video,
  Clock,
  PenTool,
  GitBranch,
  Bot,
  ListTodo,
  ShieldCheck,
  Maximize2,
} from 'lucide-react';
import { projects } from '@client/src/api';
import type { Project, ProjectStatus } from '@shared/api.interface';
import { logger } from '@client/src/utils/logger';

// 左侧竖导航（与全站侧栏一致的「图标 + 文字」紧凑语言；fullscreen 画布项点击后进入沉浸全屏路由）
const tabs = [
  { to: 'flow', label: '流程总控', group: '概览', icon: Workflow, hint: '九段流水线总控：当前段高亮、确认门一键通过、开拍后在这里等成片' },
  { to: '', label: '概览', end: true, group: '概览', icon: LayoutDashboard, hint: '项目整体进度、成本与快捷入口' },
  { to: 'script', label: '剧本', group: '剧本圣经', icon: FileText, hint: '查看与编辑全剧分场剧本' },
  { to: 'bible', label: '圣经', group: '剧本圣经', icon: BookOpen, hint: '世界观设定与视觉风格圣经' },
  { to: 'characters', label: '人物', group: '美术资产', icon: Users, hint: '角色外貌、参考图与专属配音音色绑定' },
  { to: 'scenes', label: '场景', group: '美术资产', icon: MapPin, hint: '全剧场地设定与场景概念图' },
  { to: 'assets', label: '资产', group: '美术资产', icon: Image, hint: '项目生成的全部图片、视频、音频与合成成片' },
  { to: 'storyboard', label: '分镜', group: '镜头', icon: Film, hint: '结构化分镜表：逐镜生成首帧、视频与配音' },
  { to: 'director', label: '导演台', group: '镜头', icon: Video, hint: '三栏导演监视器：实时调节景别、机位、焦段与运镜' },
  { to: 'timeline', label: '时间线', group: '镜头', icon: Clock, hint: '五轨时间线：按秒拖拽调整镜头时长与音画节奏' },
  { to: 'canvas-free3', label: '自由画布 ★', fullscreen: true, group: '画布', icon: PenTool, hint: '旗舰无限画布（1:1 Pavo 交互 + 3D 导演台 + 自动同步项目分镜）' },
  { to: 'canvas', label: '无限画布', fullscreen: true, group: '画布', icon: GitBranch, hint: '节点即工具箱模式：支持分支创作与多会话智能体（v5 旧旗舰，老板最爱）' },
  { to: 'agents', label: 'AI助手', group: '交付', icon: Bot, hint: '8 大影视工种智能体协同对话' },
  { to: 'tasks', label: '任务队列', group: '交付', icon: ListTodo, hint: '查看后台生成队列进度、重试或取消任务' },
  { to: 'qc', label: '质检', group: '交付', icon: ShieldCheck, hint: '成片完整性、角色一致性与钩子/CTA 规则质检' },
  { to: 'export', label: '导出', group: '交付', icon: Download, hint: '一键合成带配音与字幕的 MP4 成片或导出剪映草稿' },
];

// 分组导航（路由不变，仅导航分组）
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
  draft: 'bg-muted text-muted-foreground',
  parsing: 'bg-blue-500/15 text-blue-400',
  planning: 'bg-blue-500/15 text-blue-400',
  bible_ready: 'bg-emerald-500/15 text-emerald-400',
  storyboard_ready: 'bg-emerald-500/15 text-emerald-400',
  assets_generating: 'bg-amber-500/15 text-amber-400',
  video_generating: 'bg-amber-500/15 text-amber-400',
  audio_generating: 'bg-amber-500/15 text-amber-400',
  editing: 'bg-primary/10 text-primary',
  qc: 'bg-primary/10 text-primary',
  ready: 'bg-emerald-500/15 text-emerald-400',
  exported: 'bg-emerald-500/15 text-emerald-400',
  failed: 'bg-red-500/15 text-red-400',
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
    <div className="space-y-5">
      {/* 项目头部：项目名 + 状态徽章 + 快捷入口（全站统一工作台语言） */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-3">
            <h1 className="truncate text-xl font-semibold text-foreground">
              {displayTitle}
            </h1>
            <span
              className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${statusColorMap[displayStatus]}`}
            >
              {statusLabelMap[displayStatus]}
            </span>
          </div>
          <p className="mt-1 truncate text-sm text-muted-foreground">
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
          <button
            onClick={() => navigate(`/project/${id}/export`)}
            className="flex items-center gap-1.5 rounded-lg border border-input bg-background px-3.5 py-2 text-sm font-medium text-foreground hover:bg-muted/50"
          >
            <Download className="h-4 w-4" />
            导出成片
          </button>
          {/* 流程总控快捷入口 */}
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
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/30 bg-amber-500/15 px-4 py-3 text-xs text-amber-300">
          <div>
            <span className="font-semibold">🎬 创作流水线进行中：</span>
            剧本与分镜已拆解就绪！系统正在后台队列生成分镜首帧图。你可以在「分镜」或「自由画布 ★」中预览画面、为镜头一键生成视频与角色配音，最后在「导出」页合成为带配音与字幕的完整 MP4。
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => navigate(`/project/${id}/storyboard`)}
              className="rounded-lg bg-card px-2.5 py-1 font-medium text-amber-300 shadow-sm hover:bg-amber-500/20"
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

      {/* 左侧竖导航（图标 + 文字紧凑样式，激活态复用 nav-active 浅底红字）+ 右侧内容区 */}
      <div className="flex items-start gap-5">
        <aside className="w-40 shrink-0">
          <nav className="sticky top-0 space-y-3">
            {TAB_GROUPS.map((group) => (
              <div key={group}>
                <div className="mb-1 px-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">
                  {group}
                </div>
                <div className="space-y-0.5">
                  {tabs
                    .filter((tab) => tab.group === group)
                    .map((tab) => {
                      const Icon = tab.icon;
                      return (
                        <NavLink
                          key={tab.to || 'overview'}
                          to={tab.fullscreen ? `/project/${id}/${tab.to}` : tab.to}
                          end={tab.end}
                          title={tab.hint}
                          className={({ isActive }) =>
                            `flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors ${
                              isActive
                                ? 'nav-active'
                                : 'nav-idle hover:bg-muted'
                            }`
                          }
                        >
                          <Icon className="h-4 w-4 shrink-0" />
                          <span className="truncate">{tab.label}</span>
                          {tab.fullscreen && (
                            <Maximize2 className="ml-auto h-3 w-3 shrink-0 text-muted-foreground/50" />
                          )}
                        </NavLink>
                      );
                    })}
                </div>
              </div>
            ))}
          </nav>
        </aside>

        {/* Tab content */}
        <div className="min-w-0 flex-1">
          <Outlet />
        </div>
      </div>
    </div>
  );
};

export default ProjectWorkspacePage;
