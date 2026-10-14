import { useEffect, useState, useCallback } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Plus, Search, Clock, Film, FolderOpen, Sparkles } from 'lucide-react';
import { projects, storyboard } from '@client/src/api';
import type { ProjectListItem, ProjectStatus } from '@shared/api.interface';
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
  draft: 'bg-slate-100 text-slate-600',
  parsing: 'bg-blue-100 text-blue-700',
  planning: 'bg-blue-100 text-blue-700',
  bible_ready: 'bg-blue-100 text-blue-700',
  storyboard_ready: 'bg-blue-100 text-blue-700',
  assets_generating: 'bg-blue-100 text-blue-700',
  video_generating: 'bg-blue-100 text-blue-700',
  audio_generating: 'bg-blue-100 text-blue-700',
  editing: 'bg-blue-100 text-blue-700',
  qc: 'bg-blue-100 text-blue-700',
  ready: 'bg-emerald-100 text-emerald-700',
  exported: 'bg-emerald-100 text-emerald-700',
  failed: 'bg-red-100 text-red-700',
};

const filterOptions: { label: string; value: ProjectStatus | '' }[] = [
  { label: '全部', value: '' },
  { label: '草稿', value: 'draft' },
  { label: '制作中', value: 'video_generating' },
  { label: '已完成', value: 'ready' },
  { label: '失败', value: 'failed' },
];

const gradientColors = [
  'from-rose-400/30 via-orange-300/30 to-amber-400/30',
  'from-sky-400/30 via-indigo-400/30 to-purple-400/30',
  'from-emerald-400/30 via-teal-400/30 to-cyan-400/30',
  'from-pink-400/30 via-rose-400/30 to-red-400/30',
  'from-violet-400/30 via-purple-400/30 to-fuchsia-400/30',
  'from-amber-400/30 via-orange-400/30 to-rose-400/30',
  'from-cyan-400/30 via-sky-400/30 to-blue-400/30',
  'from-lime-400/30 via-emerald-400/30 to-teal-400/30',
];

const formatDuration = (seconds: number): string => {
  if (!seconds) return '--';
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

const ProjectsPage = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [items, setItems] = useState<ProjectListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');
  const [keyword, setKeyword] = useState(searchParams.get('keyword') || '');
  const [statusFilter, setStatusFilter] = useState<ProjectStatus | ''>(
    (searchParams.get('status') as ProjectStatus) || ''
  );
  const [creatingDemo, setCreatingDemo] = useState(false);

  // P1 Onboarding：一键创建示例项目（真实管线，消费器自动物化分镜）
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

  const fetchProjects = useCallback(async () => {
    try {
      setError('');
      setLoading(true);
      const params: { page: number; pageSize: number; keyword?: string; status?: ProjectStatus } = {
        page: 1,
        pageSize: 20,
      };
      if (keyword) params.keyword = keyword;
      if (statusFilter) params.status = statusFilter;
      const res = await projects.listProjects(params);
      setItems(res.items);
      setTotal(res.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [keyword, statusFilter]);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  const handleSearch = (value: string) => {
    setKeyword(value);
    const next = new URLSearchParams(searchParams);
    if (value) next.set('keyword', value);
    else next.delete('keyword');
    setSearchParams(next, { replace: true });
  };

  const handleStatusChange = (value: ProjectStatus | '') => {
    setStatusFilter(value);
    const next = new URLSearchParams(searchParams);
    if (value) next.set('status', value);
    else next.delete('status');
    setSearchParams(next, { replace: true });
  };

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      handleSearch(keyword);
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-6">
      {/* Top bar */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">我的项目</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            共 {total} 个项目，管理你的所有短剧创作
          </p>
        </div>
        <button
          onClick={() => navigate('/create')}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" />
          新建项目
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3 rounded-xl border bg-white p-4 shadow-sm sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSearch(keyword);
            }}
            placeholder="搜索项目名称..."
            className="h-10 w-full rounded-lg border border-input bg-background pl-9 pr-4 text-sm outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {filterOptions.map((opt) => (
            <button
              key={opt.value || 'all'}
              onClick={() => handleStatusChange(opt.value)}
              className={`rounded-lg px-3.5 py-2 text-sm font-medium transition-colors ${
                statusFilter === opt.value
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted/50 text-foreground/70 hover:bg-muted hover:text-foreground'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Grid */}
      {loading ? (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="animate-pulse overflow-hidden rounded-xl border bg-white shadow-sm">
              <div className="aspect-video bg-muted" />
              <div className="p-5">
                <div className="h-4 w-24 rounded bg-muted" />
                <div className="mt-2 h-3 w-16 rounded bg-muted" />
                <div className="mt-4 h-3 w-full rounded bg-muted" />
              </div>
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed bg-white py-20">
          <FolderOpen className="h-12 w-12 text-muted-foreground/40" />
          <h3 className="mt-4 text-base font-medium text-foreground">
            暂无项目
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            开始创建你的第一个 AI 短剧项目吧
          </p>
          <div className="mt-5 flex items-center gap-3">
            <button
              onClick={() => navigate('/create')}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90"
            >
              <Plus className="h-4 w-4" />
              新建项目
            </button>
            <button
              onClick={handleCreateDemo}
              disabled={creatingDemo}
              className="inline-flex items-center gap-2 rounded-lg border border-primary/40 bg-primary/5 px-5 py-2.5 text-sm font-medium text-primary hover:bg-primary/10 disabled:opacity-50"
            >
              <Sparkles className="h-4 w-4" />
              {creatingDemo ? '创建中...' : '一键创建示例项目'}
            </button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {items.map((project, idx) => (
            <Link
              key={project.id}
              to={`/project/${project.id}`}
              className="group overflow-hidden rounded-xl border bg-white shadow-sm transition-all hover:-translate-y-1 hover:shadow-lg"
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
              <div className="p-5">
                <h3 className="truncate text-sm font-semibold text-foreground group-hover:text-primary">
                  {project.title}
                </h3>
                {project.description && (
                  <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">
                    {project.description}
                  </p>
                )}
                <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <Clock className="h-3.5 w-3.5" />
                    {formatDuration(project.durationSeconds || 0)}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Film className="h-3.5 w-3.5" />
                    {project.id.slice(0, 8)}
                  </span>
                </div>
                <div className="mt-2 border-t border-border pt-2 text-xs text-muted-foreground">
                  更新于 {formatTimeAgo(project.updatedAt)}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
};

export default ProjectsPage;
