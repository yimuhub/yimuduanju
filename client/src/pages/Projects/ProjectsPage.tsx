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
} from 'lucide-react';
import { projects, storyboard } from '@client/src/api';
import type { ProjectListItem, ProjectStatus } from '@shared/api.interface';
import { DEMO_SCRIPT } from '@client/src/utils/demoScript';
import { toast } from 'sonner';
import { showConfirm } from '@client/src/components/ui/confirm';

/** 状态徽章：小圆点 + 文案（面向流程语义分色，而非每个状态一色） */
const statusBadge = (status: ProjectStatus): { label: string; dot: string } => {
  switch (status) {
    case 'ready':
    case 'exported':
      return { label: status === 'ready' ? '已完成' : '已导出', dot: 'bg-emerald-500' };
    case 'failed':
      return { label: '失败', dot: 'bg-red-500' };
    case 'draft':
      return { label: '草稿', dot: 'bg-slate-400' };
    case 'parsing':
    case 'planning':
    case 'bible_ready':
    case 'storyboard_ready':
      return { label: '前期制作', dot: 'bg-blue-500' };
    default:
      // assets/video/audio generating, editing, qc —— 生成管线阶段
      return { label: '生成中', dot: 'bg-amber-500' };
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
  const [creatingDemo, setCreatingDemo] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

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
    <div className="space-y-5">
      {/* 顶部：标题 + 新建 */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">我的项目</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            共 {total} 个项目，管理你的所有短剧创作
          </p>
        </div>
        <button
          onClick={() => navigate('/create')}
          className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" />
          新建项目
        </button>
      </div>

      {/* 工具条：搜索 + 状态筛选 + 排序 */}
      <div className="flex flex-col gap-3 rounded-xl border bg-white p-3 shadow-sm lg:flex-row lg:items-center">
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
        <div className="flex items-center gap-2 lg:border-l lg:border-border lg:pl-3">
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
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* 列表体 */}
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex animate-pulse items-center gap-4 rounded-xl border bg-white p-4">
              <div className="h-9 w-9 rounded-lg bg-muted" />
              <div className="flex-1 space-y-2">
                <div className="h-3.5 w-40 rounded bg-muted" />
                <div className="h-3 w-24 rounded bg-muted" />
              </div>
              <div className="h-3 w-16 rounded bg-muted" />
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        /* 空状态：回作战室开拍 */
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed bg-white py-20">
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
      ) : (
        <div className="overflow-hidden rounded-xl border bg-white shadow-sm">
          {sortedItems.map((project) => {
            const badge = statusBadge(project.status);
            return (
              <div
                key={project.id}
                onClick={() => navigate(`/project/${project.id}`)}
                className="group flex cursor-pointer items-center gap-4 border-b border-border px-4 py-3.5 transition-colors last:border-b-0 hover:bg-muted/50"
              >
                {/* 状态小圆点徽章 */}
                <span
                  className={`flex shrink-0 items-center gap-1.5 rounded-full bg-muted/70 px-2.5 py-1 text-xs font-medium text-foreground/70`}
                  title={project.status}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${badge.dot} ${deletingId === project.id ? 'animate-pulse' : ''}`} />
                  {badge.label}
                </span>

                {/* 名称 + 描述 */}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-foreground group-hover:text-primary">
                    {project.title}
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="shrink-0">{formatDuration(project.durationSeconds || 0)}</span>
                    {project.description && (
                      <span className="hidden truncate sm:inline">· {project.description}</span>
                    )}
                  </div>
                </div>

                {/* 元信息 */}
                <div className="hidden shrink-0 text-right text-xs text-muted-foreground md:block">
                  <div>更新于 {formatTimeAgo(project.updatedAt)}</div>
                  {project.artStyle && <div className="mt-0.5">{project.artStyle}</div>}
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
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-foreground/60 hover:bg-red-50 hover:text-red-500"
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
