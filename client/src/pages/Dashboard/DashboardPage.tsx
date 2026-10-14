import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Zap,
  FileText,
  Sliders,
  FolderKanban,
  Film,
  Image as ImageIcon,
  Wallet,
  ChevronRight,
  Sparkles,
  Play,
  Clock,
} from 'lucide-react';
import { projects, templates, dashboard, storyboard } from '@client/src/api';
import type {
  DashboardStats,
  ProjectListItem,
  Template,
  ProjectStatus,
} from '@shared/api.interface';
import { DEMO_SCRIPT } from '@client/src/utils/demoScript';
import { toast } from 'sonner';

const statusLabelMap: Record<ProjectStatus, string> = {
  draft: '草稿',
  parsing: '解析中',
  planning: '规划中',
  bible_ready: '圣经就绪',
  storyboard_ready: '分镜就绪',
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
  parsing: 'bg-blue-100 text-blue-700',
  planning: 'bg-blue-100 text-blue-700',
  bible_ready: 'bg-blue-100 text-blue-700',
  storyboard_ready: 'bg-blue-100 text-blue-700',
  assets_generating: 'bg-blue-100 text-blue-700',
  video_generating: 'bg-blue-100 text-blue-700',
  audio_generating: 'bg-blue-100 text-blue-700',
  editing: 'bg-blue-100 text-blue-700',
  qc: 'bg-blue-100 text-blue-700',
  ready: 'bg-green-100 text-green-700',
  exported: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
};

const gradientColors = [
  'from-rose-400/30 via-orange-300/30 to-amber-400/30',
  'from-sky-400/30 via-indigo-400/30 to-purple-400/30',
  'from-emerald-400/30 via-teal-400/30 to-cyan-400/30',
  'from-pink-400/30 via-rose-400/30 to-red-400/30',
  'from-violet-400/30 via-purple-400/30 to-fuchsia-400/30',
  'from-amber-400/30 via-orange-400/30 to-rose-400/30',
];

const formatDuration = (seconds: number): string => {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return secs > 0 ? `${mins}分${secs}秒` : `${mins}分钟`;
};

const formatTimeAgo = (dateStr: string): string => {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return '刚刚';
  if (mins < 60) return `${mins}分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}天前`;
  return new Date(dateStr).toLocaleDateString('zh-CN');
};

const modeCards = [
  {
    icon: Zap,
    title: '极速模式',
    desc: '输入一句话，AI 全自动完成 90 秒短剧',
    href: '/create?mode=quick',
    btnText: '立即体验',
    gradient: 'from-red-50 to-orange-50',
    iconBg: 'bg-gradient-to-br from-red-500 to-orange-500',
  },
  {
    icon: FileText,
    title: '剧本模式',
    desc: '上传完整剧本，AI 智能解析分镜人物场景',
    href: '/create?mode=script',
    btnText: '上传剧本',
    gradient: 'from-blue-50 to-indigo-50',
    iconBg: 'bg-gradient-to-br from-blue-500 to-indigo-500',
  },
  {
    icon: Sliders,
    title: '专业导演模式',
    desc: '全参数可控，专业导演级创作体验',
    href: '/create?mode=professional',
    btnText: '开始创作',
    gradient: 'from-purple-50 to-pink-50',
    iconBg: 'bg-gradient-to-br from-purple-500 to-pink-500',
  },
];

const DashboardPage = () => {
  const navigate = useNavigate();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [recentProjects, setRecentProjects] = useState<ProjectListItem[]>([]);
  const [hotTemplates, setHotTemplates] = useState<Template[]>([]);
  const [error, setError] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [creatingDemo, setCreatingDemo] = useState(false);

  // P1 Onboarding：一键创建示例项目（真实管线；之前空状态只有一句话）
  const handleCreateDemo = async () => {
    if (creatingDemo) return;
    setCreatingDemo(true);
    try {
      const project = await projects.createProject({
        title: '示例短剧 · 雨夜告白',
        mode: 'quick',
        durationSeconds: 60,
        scriptText: DEMO_SCRIPT,
      });
      await storyboard.parseScript({ scriptText: DEMO_SCRIPT, projectId: project.id });
      toast.success('示例项目已创建，分镜解析中，马上跳转查看');
      navigate(`/project/${project.id}/storyboard`);
    } catch {
      toast.error('示例创建失败，请重试');
    } finally {
      setCreatingDemo(false);
    }
  };

  useEffect(() => {
    const loadData = async () => {
      try {
        setError('');
        const [statsData, projectsData, templatesData] = await Promise.all([
          dashboard.getStats(),
          dashboard.getRecentProjects(4),
          templates.listTemplates({ pageSize: 6 }),
        ]);
        setStats(statsData);
        setRecentProjects(projectsData);
        setHotTemplates(templatesData.items);
      } catch (err) {
        setError(err instanceof Error ? err.message : '加载失败');
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, []);

  const statItems = stats
    ? [
        { icon: FolderKanban, label: '项目总数', value: stats.totalProjects, color: 'text-blue-500 bg-blue-50' },
        { icon: Film, label: '生成镜头数', value: stats.totalShots, color: 'text-purple-500 bg-purple-50' },
        { icon: ImageIcon, label: '资产总数', value: stats.totalAssets, color: 'text-emerald-500 bg-emerald-50' },
        { icon: Wallet, label: '累计费用', value: `¥${stats.totalCost.toFixed(2)}`, color: 'text-primary bg-red-50' },
      ]
    : [];

  return (
    <div className="space-y-6">
      {/* Hero Section */}
      <section className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-red-50 via-orange-50 to-purple-50 p-8 md:p-10">
        <div className="absolute -top-20 -right-20 h-72 w-72 rounded-full bg-gradient-to-br from-red-200/40 to-orange-200/40 blur-3xl" />
        <div className="absolute -bottom-24 -left-10 h-64 w-64 rounded-full bg-gradient-to-br from-purple-200/40 to-pink-200/40 blur-3xl" />
        <div className="relative flex flex-col gap-8 md:flex-row md:items-center">
          <div className="flex-1">
            <div className="inline-flex items-center gap-1.5 rounded-full bg-white/70 px-3 py-1 text-xs font-medium text-primary shadow-sm backdrop-blur">
              <Sparkles className="h-3.5 w-3.5" />
              <span>一木·YIMU AI 视频创作平台</span>
            </div>
            <h1 className="mt-4 text-3xl font-bold leading-tight text-foreground md:text-4xl">
              让 AI 拍一部好剧
            </h1>
            <p className="mt-3 max-w-md text-base text-muted-foreground">
              一句话到成片，一木·YIMU AI 视频创作平台。从创意、剧本、分镜到生成剪辑，一站式全流程自动化。
            </p>
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <button
                onClick={() => navigate('/create')}
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-6 py-3 text-sm font-medium text-primary-foreground shadow-md shadow-primary/20 transition-all hover:bg-primary/90 hover:shadow-lg hover:shadow-primary/30"
              >
                <Sparkles className="h-4 w-4" />
                开始创作
              </button>
              {/* P1 修复：之前是无 onClick 死按钮，现滚动到模式区 */}
              <button
                onClick={() => document.getElementById('creation-modes')?.scrollIntoView({ behavior: 'smooth' })}
                className="inline-flex items-center gap-1 rounded-lg px-4 py-3 text-sm font-medium text-foreground/80 transition-colors hover:text-primary"
              >
                了解更多
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
          <div className="relative flex-1">
            <div className="relative mx-auto aspect-video w-full max-w-md overflow-hidden rounded-xl bg-gradient-to-br from-red-400 via-orange-400 to-purple-500 shadow-2xl">
              {/* P1 修复：预览播放键之前无动作，现跳一键创作 */}
              <div className="absolute inset-0 flex items-center justify-center">
                <button
                  onClick={() => navigate('/create')}
                  aria-label="开始创作"
                  className="flex h-16 w-16 items-center justify-center rounded-full bg-white/90 text-primary shadow-lg backdrop-blur transition-transform hover:scale-110"
                >
                  <Play className="ml-1 h-7 w-7 fill-current" />
                </button>
              </div>
              <div className="absolute bottom-4 left-4 right-4 flex items-center justify-between text-white/90">
                <div className="flex items-center gap-2 text-xs">
                  <Film className="h-4 w-4" />
                  <span>AI 自动生成</span>
                </div>
                <span className="text-xs">90s · 竖屏</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Creation Modes */}
      <section id="creation-modes">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">创作模式</h2>
        </div>
        <div className="mt-4 grid grid-cols-1 gap-6 md:grid-cols-3">
          {modeCards.map((mode) => (
            <Link
              key={mode.title}
              to={mode.href}
              className="group rounded-xl border bg-white p-6 shadow-sm transition-all hover:-translate-y-1 hover:shadow-lg"
            >
              <div
                className={`flex h-12 w-12 items-center justify-center rounded-xl ${mode.iconBg} text-white shadow-md`}
              >
                <mode.icon className="h-6 w-6" />
              </div>
              <h3 className="mt-4 text-base font-semibold text-foreground">
                {mode.title}
              </h3>
              <p className="mt-1.5 text-sm text-muted-foreground">{mode.desc}</p>
              <div className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-primary">
                {mode.btnText}
                <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* Stats */}
      <section>
        <h2 className="text-lg font-semibold text-foreground">创作统计</h2>
        <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-4">
          {loading && !stats
            ? Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="animate-pulse rounded-xl border bg-white p-6">
                  <div className="h-4 w-20 rounded bg-muted" />
                  <div className="mt-3 h-7 w-16 rounded bg-muted" />
                </div>
              ))
            : statItems.map((item) => (
                <div
                  key={item.label}
                  className="rounded-xl border bg-white p-5 shadow-sm transition-shadow hover:shadow-md"
                >
                  <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${item.color}`}>
                    <item.icon className="h-5 w-5" />
                  </div>
                  <div className="mt-3 text-2xl font-semibold text-foreground">
                    {item.value}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {item.label}
                  </div>
                </div>
              ))}
        </div>
      </section>

      {/* Recent Projects + Hot Templates */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Recent Projects */}
        <section className="lg:col-span-2">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-foreground">最近项目</h2>
            <Link
              to="/projects"
              className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
            >
              查看全部
              <ChevronRight className="h-4 w-4" />
            </Link>
          </div>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            {loading
              ? Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="animate-pulse overflow-hidden rounded-xl border bg-white">
                    <div className="aspect-video bg-muted" />
                    <div className="p-4">
                      <div className="h-4 w-24 rounded bg-muted" />
                      <div className="mt-2 h-3 w-16 rounded bg-muted" />
                    </div>
                  </div>
                ))
              : recentProjects.length === 0
              ? (
                <div className="col-span-2 rounded-xl border border-dashed p-8 text-center">
                  <p className="text-sm text-muted-foreground">暂无项目，30 秒创建一个可查看的示例吧</p>
                  <button
                    onClick={handleCreateDemo}
                    disabled={creatingDemo}
                    className="mt-4 inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90 disabled:opacity-50"
                  >
                    <Sparkles className="h-4 w-4" />
                    {creatingDemo ? '创建中...' : '一键创建示例项目'}
                  </button>
                </div>
              )
              : recentProjects.map((project, idx) => (
                  <Link
                    key={project.id}
                    to={`/project/${project.id}`}
                    className="group overflow-hidden rounded-xl border bg-white shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md"
                  >
                    <div
                      className={`relative aspect-video bg-gradient-to-br ${gradientColors[idx % gradientColors.length]}`}
                    >
                      <div className="absolute inset-0 flex items-center justify-center">
                        <span className="text-xs font-medium text-white/90">未获取</span>
                      </div>
                      <span
                        className={`absolute right-3 top-3 rounded-full px-2.5 py-0.5 text-xs font-medium ${statusColorMap[project.status]}`}
                      >
                        {statusLabelMap[project.status]}
                      </span>
                    </div>
                    <div className="p-4">
                      <h3 className="truncate text-sm font-semibold text-foreground group-hover:text-primary">
                        {project.title}
                      </h3>
                      <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                        <span className="inline-flex items-center gap-1">
                          <Clock className="h-3.5 w-3.5" />
                          {formatDuration(project.durationSeconds || 0)}
                        </span>
                        <span>{formatTimeAgo(project.updatedAt)}</span>
                      </div>
                    </div>
                  </Link>
                ))}
          </div>
        </section>

        {/* Hot Templates */}
        <section>
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-foreground">热门模板</h2>
            <Link
              to="/templates"
              className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
            >
              更多
              <ChevronRight className="h-4 w-4" />
            </Link>
          </div>
          <div className="mt-4 space-y-3">
            {loading
              ? Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="animate-pulse flex items-center gap-3 rounded-lg border p-2">
                    <div className="h-12 w-16 rounded bg-muted" />
                    <div className="flex-1">
                      <div className="h-3 w-20 rounded bg-muted" />
                      <div className="mt-1.5 h-2.5 w-12 rounded bg-muted" />
                    </div>
                  </div>
                ))
              : hotTemplates.length === 0
              ? <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">暂无模板</div>
              : hotTemplates.map((tpl, idx) => (
                  <Link
                    key={tpl.id}
                    // P1 修复：之前跳不存在的 /templates/:id（404）；现用深链打开详情弹窗
                    to={`/templates?template=${tpl.id}`}
                    className="flex items-center gap-3 rounded-lg border p-2 transition-colors hover:border-primary/40 hover:bg-primary/5"
                  >
                    <div
                      className={`flex h-12 w-16 flex-shrink-0 items-center justify-center rounded bg-gradient-to-br ${gradientColors[(idx + 2) % gradientColors.length]} text-white/90`}
                    >
                      <Film className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-foreground">
                        {tpl.name}
                      </div>
                      <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                        <span className="rounded bg-muted px-1.5 py-0.5">
                          {tpl.templateType === 'full' ? '完整' : tpl.templateType === 'style' ? '风格' : tpl.templateType === 'duration' ? '时长' : '类型'}
                        </span>
                        <span>{formatDuration(tpl.durationSeconds)}</span>
                      </div>
                    </div>
                  </Link>
                ))}
          </div>
        </section>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}
    </div>
  );
};

export default DashboardPage;
