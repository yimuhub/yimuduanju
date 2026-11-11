import { NavLink, Outlet, useParams, useNavigate } from 'react-router-dom';
import { useCallback, useState } from 'react';
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
  Bot,
  ListTodo,
  ShieldCheck,
  Maximize2,
  Hand,
  Loader2,
  AlertTriangle,
} from 'lucide-react';
import { projects } from '@client/src/api';
import type { Project, ProjectProgressResponse, ProjectStatus } from '@shared/api.interface';
import { toast } from 'sonner';
import { logger } from '@client/src/utils/logger';
import { useVisibleInterval } from '@client/src/lib/hooks';

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
  { to: 'timeline', label: '时间线', group: '镜头', icon: Clock, hint: '多轨时间线已并入 Studio 底部：点此查看迁移说明并一键切换' },
  { to: 'canvas-free3', label: '自由画布', fullscreen: true, group: '画布', icon: PenTool, hint: '旗舰自由画布（1:1 Pavo 交互 + 角色/场景/剧本/分镜节点 + AI 助手 + 集数切换 + 3D 导演台）' },
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

// 状态胶囊：统一 .pill 5 色板（蓝=生产 绿=就绪 琥珀=质检 红=失败 灰=草稿）
const statusColorMap: Record<ProjectStatus, string> = {
  draft: 'pill-neutral',
  parsing: 'pill-run',
  planning: 'pill-run',
  bible_ready: 'pill-ok',
  storyboard_ready: 'pill-ok',
  assets_generating: 'pill-run',
  video_generating: 'pill-run',
  audio_generating: 'pill-run',
  editing: 'pill-run',
  qc: 'pill-wait',
  ready: 'pill-ok',
  exported: 'pill-ok',
  failed: 'pill-fail',
};

const ProjectWorkspacePage = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [project, setProject] = useState<Project | null>(null);
  const [progress, setProgress] = useState<ProjectProgressResponse | null>(null);
  const [approving, setApproving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!id) return;
    projects.getProject(id)
      .then((data) => setProject(data))
      .catch((err) => {
        logger.error('Failed to load project:', String(err));
        setError('加载项目信息失败');
      });
    // 进度轮询：剧本生成/等待确认都靠它驱动横幅，避免用户以为卡死
    projects.getProgress(id)
      .then(setProgress)
      .catch((err) => logger.error('load progress failed:', String(err)));
  }, [id]);

  // 页签不可见时暂停轮询（useVisibleInterval 挂载即拉一次 + 回前台补拉）
  useVisibleInterval(load, 5000);

  /** 门 1 放行：确认剧本 → 后端自动创建物化任务 */
  const approveScript = async () => {
    if (!id || approving) return;
    setApproving(true);
    try {
      await projects.approveProject(id, 'script');
      toast.success('剧本已确认，正在物化分镜');
      load();
    } catch (err) {
      toast.error(`确认失败：${(err as Error).message}`);
    } finally {
      setApproving(false);
    }
  };

  const displayTitle = project?.title || `短剧项目 · ${id?.slice(0, 8) || ''}`;
  const displayStatus: ProjectStatus = project?.status || 'draft';
  const nextGate = progress?.nextGate ?? null;
  const scriptJob = progress?.scriptJob ?? null;
  const scriptJobRunning =
    !!scriptJob &&
    ['pending', 'queued', 'running', 'retrying'].includes(scriptJob.status);

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
              className={`pill ${statusColorMap[displayStatus]}`}
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
            打开自由画布
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

      {/* 剧本阶段状态横幅：生成中 / 待确认 / 失败 三态都必须可见可操作 */}
      {nextGate === 'script' && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/30 bg-amber-500/15 px-4 py-3 text-sm text-amber-300">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 font-semibold">
              <Hand className="h-4 w-4" /> 剧本已生成，等待你确认
            </div>
            <p className="mt-1 text-xs text-amber-300/80">
              确认后系统自动物化分镜；不喜欢可以直接去「剧本」页修改或重新生成。
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              onClick={() => navigate(`/project/${id}/script`)}
              className="rounded-lg border border-amber-500/40 bg-card px-3 py-1.5 text-xs font-medium text-amber-300 hover:bg-amber-500/20"
            >
              先看剧本
            </button>
            <button
              onClick={() => void approveScript()}
              disabled={approving}
              className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground shadow-sm hover:opacity-90 disabled:opacity-50"
            >
              {approving ? '确认中…' : '确认剧本，物化分镜'}
            </button>
          </div>
        </div>
      )}

      {!nextGate && scriptJob?.status === 'failed' && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-500/30 bg-red-500/15 px-4 py-3 text-sm text-red-300">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 font-semibold">
              <AlertTriangle className="h-4 w-4" /> 剧本生成失败
            </div>
            <p className="mt-1 break-words text-xs text-red-300/80">
              {scriptJob.errorMessage || '模型返回异常，请到任务队列重试或手动粘贴剧本'}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              onClick={() => navigate(`/project/${id}/tasks`)}
              className="rounded-lg border border-red-500/40 bg-card px-3 py-1.5 text-xs font-medium text-red-300 hover:bg-red-500/20"
            >
              去任务队列重试
            </button>
            <button
              onClick={() => navigate(`/project/${id}/script`)}
              className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700"
            >
              手动粘贴剧本
            </button>
          </div>
        </div>
      )}

      {!nextGate && scriptJobRunning && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-sky-500/30 bg-sky-500/15 px-4 py-3 text-sm text-sky-300">
          <div className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="font-semibold">AI 正在生成剧本…</span>
            <span className="text-xs text-sky-300/80">通常 1-2 分钟，完成后这里会出现确认按钮</span>
          </div>
          <button
            onClick={() => navigate(`/project/${id}/tasks`)}
            className="rounded-lg border border-sky-500/40 bg-card px-3 py-1.5 text-xs font-medium text-sky-300 hover:bg-sky-500/20"
          >
            查看任务队列
          </button>
        </div>
      )}

      {nextGate && nextGate !== 'script' && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/30 bg-amber-500/15 px-4 py-3 text-sm text-amber-300">
          <div className="flex items-center gap-1.5 font-semibold">
            <Hand className="h-4 w-4" />
            等待
            {nextGate === 'storyboard' ? '分镜确认' : '成片确认'}
          </div>
          <button
            onClick={() => navigate(`/project/${id}/flow`)}
            className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground shadow-sm hover:opacity-90"
          >
            去流程总控确认
          </button>
        </div>
      )}

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
