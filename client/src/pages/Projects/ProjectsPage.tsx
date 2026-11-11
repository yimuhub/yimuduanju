/**
 * 我的项目 · 行式列表（信息密度优先基准）
 * 顶部搜索 + 状态筛选 + 排序；行内状态小圆点徽章；hover 才出现的打开/画布/删除操作
 */
import { useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Plus,
  Search,
  FolderOpen,
  Sparkles,
  ArrowUpDown,
  Clapperboard,
  Workflow,
  Trash2,
  ArrowRight,
  LayoutGrid,
  List,
} from 'lucide-react';
import { projects, storyboard } from '@client/src/api';
import type { ProjectListItem, ProjectStatus } from '@shared/api.interface';
import { DEMO_SCRIPT } from '@client/src/utils/demoScript';
import { toast } from 'sonner';
import { showConfirm } from '@client/src/components/ui/confirm';
import PageHeader from '@client/src/components/PageHeader';
import { styleOptions } from '@client/src/pages/CreateWizard/WizardSettings';
import { styleCover } from '@client/src/data/styleCovers';

type ViewMode = 'card' | 'list';
const VIEW_KEY = 'yimu.projectsView';
const artStyleLabel = (style?: string): string =>
  styleOptions.find((s) => s.value === style)?.label ?? style ?? '';

/** 状态徽章：小圆点 + 文案（面向流程语义分色，而非每个状态一色） */
const statusBadge = (status: ProjectStatus): { label: string; dot: string; pill: string } => {
  switch (status) {
    case 'ready':
    case 'exported':
      return { label: status === 'ready' ? '已完成' : '已导出', dot: 'bg-emerald-400', pill: 'pill-ok' };
    case 'failed':
      return { label: '失败', dot: 'bg-red-400', pill: 'pill-fail' };
    case 'draft':
      return { label: '草稿', dot: 'bg-muted-foreground/60', pill: 'pill-neutral' };
    case 'parsing':
    case 'planning':
    case 'bible_ready':
    case 'storyboard_ready':
      return { label: '前期制作', dot: 'bg-blue-400', pill: 'pill-run' };
    default:
      // assets/video/audio generating, editing, qc —— 生成管线阶段
      return { label: '生成中', dot: 'bg-blue-400', pill: 'pill-run' };
  }
};

type SortKey = 'updatedAt' | 'createdAt' | 'duration';

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'updatedAt', label: '最近更新' },
  { key: 'createdAt', label: '创建时间' },
  { key: 'duration', label: '片长' },
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

/** 无 thumbnailUrl 的项目按标题 hash 稳定取 8 张静态生成的通用封面之一 */
const projCoverUrl = (title: string): string => {
  let h = 0;
  for (let i = 0; i < title.length; i++) h = (h * 31 + title.charCodeAt(i)) >>> 0;
  return `/covers/proj-${(h % 8) + 1}.svg`;
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
    (searchParams.get('status') as ProjectStatus) || '',
  );
  const [sortKey, setSortKey] = useState<SortKey>('updatedAt');
  const [view, setView] = useState<ViewMode>(() => {
    try {
      return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'card';
    } catch {
      return 'card';
    }
  });
  const [creatingDemo, setCreatingDemo] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const changeView = (next: ViewMode) => {
    setView(next);
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {
      /* 隐私模式写失败：本次会话仍生效 */
    }
  };

  /** 封面：优先项目缩略图，其次按画风取原创风格图，最后回退 hash 静态封面 */
  const coverOf = (project: ProjectListItem) =>
    project.thumbnailUrl || styleCover(project.artStyle) || projCoverUrl(project.title);

  const handleCoverError = (e: React.SyntheticEvent<HTMLImageElement>, project: ProjectListItem) => {
    const img = e.currentTarget;
    if (img.dataset.fallback === '1') {
      img.src = projCoverUrl(project.title);
      img.dataset.fallback = '2';
      return;
    }
    if (img.dataset.fallback === '2') {
      img.style.display = 'none';
      return;
    }
    img.dataset.fallback = '1';
    img.src = styleCover(project.artStyle);
  };

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
        pageSize: 50,
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

  const sortedItems = useMemo(() => {
    const list = [...items];
    list.sort((a, b) => {
      if (sortKey === 'duration') return (b.durationSeconds || 0) - (a.durationSeconds || 0);
      if (sortKey === 'createdAt')
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });
    return list;
  }, [items, sortKey]);

  const handleDelete = async (project: ProjectListItem) => {
    if (!await showConfirm(`确定删除项目「${project.title}」吗？其分镜与资产关联将一并解除。`)) return;
    setDeletingId(project.id);
    try {
      await projects.deleteProject(project.id);
      setItems((prev) => prev.filter((p) => p.id !== project.id));
      setTotal((t) => Math.max(0, t - 1));
      toast.success('项目已删除');
    } catch {
      toast.error('删除失败，请重试');
    } finally {
      setDeletingId(null);
    }
  };

  const filterOptions: { label: string; value: ProjectStatus | '' }[] = [
    { label: '全部', value: '' },
    { label: '草稿', value: 'draft' },
    { label: '制作中', value: 'video_generating' },
    { label: '已完成', value: 'ready' },
    { label: '失败', value: 'failed' },
  ];

  return (
    /* @container：在极客模式右坞 ~400px 窄签内渲染时，工具条/行内断点按容器宽度降级 */
    <div className="@container space-y-5">
      {/* 顶部：标题 + 新建（全站统一页头） */}
      <PageHeader
        title="我的项目"
        description={`共 ${total} 个项目，管理你的所有短剧创作`}
        actions={
          <button
            onClick={() => navigate('/create')}
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" />
            新建项目
          </button>
        }
      />

      {/* 工具条：搜索 + 状态筛选 + 排序（窄容器内纵向堆叠，@2xl 起横排） */}
      <div className="flex flex-col gap-3 rounded-xl border bg-card p-3 shadow-sm @2xl:flex-row @2xl:items-center">
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
            className="h-9 w-full rounded-lg border border-input bg-background pl-9 pr-4 text-sm outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {filterOptions.map((opt) => (
            <button
              key={opt.value || 'all'}
              onClick={() => handleStatusChange(opt.value)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                statusFilter === opt.value
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted/50 text-foreground/70 hover:bg-muted hover:text-foreground'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 @2xl:border-l @2xl:border-border @2xl:pl-3">
          <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground" />
          <select
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
            className="h-9 rounded-lg border border-input bg-background px-2 text-sm outline-none focus:border-primary"
          >
            {SORT_OPTIONS.map((opt) => (
              <option key={opt.key} value={opt.key}>
                {opt.label}
              </option>
            ))}
          </select>
          {/* 卡片 / 列表 双视图切换 */}
          <div
            className="flex items-center gap-0.5 rounded-lg border border-input bg-background p-0.5"
            role="group"
            aria-label="视图切换"
          >
            <button
              type="button"
              title="卡片视图"
              aria-label="卡片视图"
              onClick={() => changeView('card')}
              className={`flex h-8 w-8 items-center justify-center rounded-md transition-colors ${
                view === 'card'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-foreground/60 hover:bg-muted hover:text-foreground'
              }`}
            >
              <LayoutGrid className="h-4 w-4" />
            </button>
            <button
              type="button"
              title="列表视图"
              aria-label="列表视图"
              onClick={() => changeView('list')}
              className={`flex h-8 w-8 items-center justify-center rounded-md transition-colors ${
                view === 'list'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-foreground/60 hover:bg-muted hover:text-foreground'
              }`}
            >
              <List className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/15 p-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {/* 列表体：卡片 / 列表双视图（偏好持久化） */}
      {loading ? (
        view === 'card' ? (
          <div className="grid grid-cols-1 gap-5 @sm:grid-cols-2 @4xl:grid-cols-3 @5xl:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="animate-pulse overflow-hidden rounded-xl border bg-card">
                <div className="aspect-[3/4] bg-muted" />
                <div className="space-y-2 p-4">
                  <div className="h-3.5 w-3/4 rounded bg-muted" />
                  <div className="h-3 w-1/2 rounded bg-muted" />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex animate-pulse items-center gap-4 rounded-xl border bg-card p-4">
                <div className="h-[72px] w-[108px] rounded-lg bg-muted" />
                <div className="flex-1 space-y-2">
                  <div className="h-3.5 w-40 rounded bg-muted" />
                  <div className="h-3 w-24 rounded bg-muted" />
                </div>
                <div className="h-3 w-16 rounded bg-muted" />
              </div>
            ))}
          </div>
        )
      ) : items.length === 0 ? (
        /* 空状态：回作战室开拍 */
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed bg-card py-20">
          <FolderOpen className="h-12 w-12 text-muted-foreground/40" />
          <h3 className="mt-4 text-base font-medium text-foreground">
            {keyword || statusFilter ? '没有匹配的项目' : '还没有项目'}
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {keyword || statusFilter
              ? '换个关键词或筛选条件试试'
              : '回创作作战室，一句话描述创意即可开拍'}
          </p>
          <div className="mt-5 flex items-center gap-3">
            <button
              onClick={() => navigate('/')}
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90"
            >
              <Sparkles className="h-4 w-4" />
              回作战室开拍
            </button>
            <button
              onClick={handleCreateDemo}
              disabled={creatingDemo}
              className="inline-flex items-center gap-2 rounded-xl border border-primary/40 bg-primary/5 px-5 py-2.5 text-sm font-medium text-primary hover:bg-primary/10 disabled:opacity-50"
            >
              <Clapperboard className="h-4 w-4" />
              {creatingDemo ? '创建中...' : '一键创建示例项目'}
            </button>
          </div>
        </div>
      ) : view === 'card' ? (
        <div className="grid grid-cols-1 gap-5 @sm:grid-cols-2 @4xl:grid-cols-3 @5xl:grid-cols-4">
          {sortedItems.map((project) => {
            const badge = statusBadge(project.status);
            return (
              <article
                key={project.id}
                onClick={() => navigate(`/project/${project.id}`)}
                className="group cursor-pointer overflow-hidden rounded-xl border bg-card shadow-sm transition-all hover:-translate-y-1 hover:shadow-lg"
              >
                {/* 大封面：缩略图 / 画风封面 / 静态封面三级回退 */}
                <div className="relative aspect-[3/4] overflow-hidden bg-muted">
                  <img
                    src={coverOf(project)}
                    alt={project.title}
                    loading="lazy"
                    className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                    onError={(e) => handleCoverError(e, project)}
                  />
                  <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-black/25" />
                  <div className="absolute left-3 top-3">
                    <span
                      className={`pill ${badge.pill} bg-black/50 backdrop-blur`}
                      title={project.status}
                    >
                      <span
                        className={`pill-dot ${deletingId === project.id ? 'animate-pulse' : ''}`}
                      />
                      {badge.label}
                    </span>
                  </div>

                  {/* hover 操作：打开 / 画布 / 删除 */}
                  <div className="absolute right-3 top-3 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(`/project/${project.id}`);
                      }}
                      title="打开项目"
                      className="flex h-8 w-8 items-center justify-center rounded-lg bg-black/45 text-white backdrop-blur hover:bg-black/65"
                    >
                      <ArrowRight className="h-4 w-4" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(`/project/${project.id}/canvas-free3`);
                      }}
                      title="进入画布"
                      className="flex h-8 w-8 items-center justify-center rounded-lg bg-black/45 text-white backdrop-blur hover:bg-black/65"
                    >
                      <Workflow className="h-4 w-4" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(project);
                      }}
                      title="删除项目"
                      className="flex h-8 w-8 items-center justify-center rounded-lg bg-black/45 text-white backdrop-blur hover:bg-red-500/80"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>

                  {/* 标题 + 关键元信息压在封面底部 */}
                  <div className="absolute inset-x-0 bottom-0 p-4">
                    <h3 className="truncate text-base font-semibold text-white">
                      {project.title}
                    </h3>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-white/70">
                      <span>{formatDuration(project.durationSeconds || 0)}</span>
                      {project.artStyle && <span>· {artStyleLabel(project.artStyle)}</span>}
                      <span>· {formatTimeAgo(project.updatedAt)}</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-3 px-4 py-3">
                  <p className="min-w-0 truncate text-xs text-muted-foreground">
                    {project.description || '点击进入项目工作台'}
                  </p>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      navigate(`/project/${project.id}`);
                    }}
                    className="shrink-0 text-xs font-medium text-primary hover:underline"
                  >
                    打开
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
          {sortedItems.map((project) => {
            const badge = statusBadge(project.status);
            return (
              <div
                key={project.id}
                onClick={() => navigate(`/project/${project.id}`)}
                className="group flex cursor-pointer items-center gap-4 border-b border-border px-4 py-3.5 transition-colors last:border-b-0 hover:bg-muted/50"
              >
                {/* 项目封面：108×72 大封面 + 缩略图 / 画风封面 / 静态封面三级回退 */}
                <div className="h-[72px] w-[108px] shrink-0 overflow-hidden rounded-lg border border-border/60 bg-muted">
                  <img
                    src={coverOf(project)}
                    alt=""
                    loading="lazy"
                    className="h-full w-full object-cover"
                    onError={(e) => handleCoverError(e, project)}
                  />
                </div>

                {/* 状态小圆点徽章 */}
                <span className={`pill ${badge.pill}`} title={project.status}>
                  <span
                    className={`pill-dot ${deletingId === project.id ? 'animate-pulse' : ''}`}
                  />
                  {badge.label}
                </span>

                {/* 名称 + 描述 */}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-foreground group-hover:text-primary">
                    {project.title}
                  </div>
                  <div className="mt-0.5 flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                    <span className="shrink-0">{formatDuration(project.durationSeconds || 0)}</span>
                    {project.artStyle && (
                      <span className="shrink-0">· {artStyleLabel(project.artStyle)}</span>
                    )}
                    {project.description && (
                      <span className="hidden min-w-0 truncate @sm:inline">
                        · {project.description}
                      </span>
                    )}
                  </div>
                </div>

                {/* 元信息（窄容器内隐藏，避免挤压行内文字） */}
                <div className="hidden shrink-0 text-right text-xs text-muted-foreground @md:block">
                  <div>更新于 {formatTimeAgo(project.updatedAt)}</div>
                </div>

                {/* hover 操作：打开 / 画布 / 删除 */}
                <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      navigate(`/project/${project.id}`);
                    }}
                    title="打开项目"
                    className="flex h-8 items-center gap-1 rounded-lg px-2 text-xs font-medium text-primary hover:bg-primary/10"
                  >
                    打开
                    <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      navigate(`/project/${project.id}/canvas-free3`);
                    }}
                    title="进入画布"
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-foreground/60 hover:bg-muted hover:text-foreground"
                  >
                    <Workflow className="h-4 w-4" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(project);
                    }}
                    title="删除项目"
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-foreground/60 hover:bg-red-500/15 hover:text-red-300"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default ProjectsPage;
