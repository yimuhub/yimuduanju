import { useEffect, useState, useCallback, useRef, Fragment } from 'react';
import { useParams } from 'react-router-dom';
import {
  RefreshCw,
  XCircle,
  Eye,
  Filter,
  ChevronDown,
  Layers,
} from 'lucide-react';
import { generation } from '@client/src/api';
import type { GenerationJob, JobStatus, JobType } from '@shared/api.interface';
import { logger } from '@client/src/utils/logger';
import { showConfirm } from '@client/src/components/ui/confirm';

const statusFilters: { value: JobStatus | 'all'; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'running', label: '进行中' },
  { value: 'succeeded', label: '已完成' },
  { value: 'failed', label: '失败' },
  { value: 'cancelled', label: '已取消' },
  { value: 'pending', label: '等待中' },
];

const typeFilters: { value: JobType | 'all'; label: string }[] = [
  { value: 'all', label: '全部类型' },
  { value: 'image', label: '图像生成' },
  { value: 'video', label: '视频生成' },
  { value: 'tts', label: '语音合成' },
  { value: 'text', label: '文本生成' },
  { value: 'storyboard', label: '分镜生成' },
  { value: 'qc', label: '质检' },
  { value: 'parse_script', label: '剧本解析' },
  { value: 'script', label: '剧本技能' },
];

const statusInfoMap: Record<JobStatus, { label: string; className: string; barClass: string }> = {
  pending: { label: '等待中', className: 'bg-gray-100 text-gray-600', barClass: 'bg-gray-400' },
  queued: { label: '排队中', className: 'bg-gray-100 text-gray-600', barClass: 'bg-gray-400' },
  running: { label: '进行中', className: 'bg-blue-50 text-blue-600', barClass: 'bg-blue-500' },
  succeeded: { label: '已完成', className: 'bg-green-50 text-green-600', barClass: 'bg-green-500' },
  failed: { label: '失败', className: 'bg-red-50 text-red-600', barClass: 'bg-red-500' },
  cancelled: { label: '已取消', className: 'bg-gray-100 text-gray-600', barClass: 'bg-gray-400' },
  retrying: { label: '重试中', className: 'bg-amber-50 text-amber-600', barClass: 'bg-amber-500' },
};

const typeLabelMap: Record<JobType, string> = {
  text: '文本生成',
  image: '图像生成',
  video: '视频生成',
  tts: '语音合成',
  parse_script: '剧本解析',
  storyboard: '分镜生成',
  qc: '质检',
  edit: '剪辑',
  script: '剧本技能',
  boards: '分镜表',
};

const ProjectTasksTab = () => {
  const { id } = useParams<{ id: string }>();
  const [jobs, setJobs] = useState<GenerationJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<JobStatus | 'all'>('all');
  const [typeFilter, setTypeFilter] = useState<JobType | 'all'>('all');
  const [total, setTotal] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [pollingIds, setPollingIds] = useState<Set<string>>(new Set());
  const [workerInfo, setWorkerInfo] = useState<{ mode: string; concurrency: number; waiting: number; active: number } | null>(null);
  useEffect(() => {
    generation.workerStats().then(setWorkerInfo).catch(() => {});
  }, []);
  // 上一轮活跃任务，用于检测“刚完成”并通知
  const prevActiveRef = useRef<Set<string>>(new Set());

  const notifyCompleted = useCallback((job: GenerationJob) => {
    try {
      if (typeof Notification === 'undefined') return;
      if (Notification.permission === 'granted') {
        new Notification('一木·YIMU AI 视频创作平台 · 任务完成', {
          body: `${typeLabelMap[job.jobType] || job.jobType}已完成，可前往查看`,
        });
      } else if (Notification.permission === 'default') {
        void Notification.requestPermission();
      }
    } catch {
      // 通知失败不影响主流程
    }
  }, []);

  const fetchJobs = useCallback(() => {
    if (!id) return;
    const params: { projectId: string; pageSize: number; page: number; status?: JobStatus; jobType?: JobType } = {
      projectId: id,
      pageSize: 50,
      page: 1,
    };
    if (statusFilter !== 'all') params.status = statusFilter;
    if (typeFilter !== 'all') params.jobType = typeFilter;

    generation.listJobs(params)
      .then((data) => {
        // P1 体验：检测本轮新完成的任务并通知（之前跑完只能靠人盯）
        const prevActive = prevActiveRef.current;
        const nowActive = new Set<string>();
        for (const job of data.items) {
          if (['pending', 'queued', 'running', 'retrying'].includes(job.status)) {
            nowActive.add(job.id);
          } else if (job.status === 'succeeded' && prevActive.has(job.id)) {
            notifyCompleted(job);
          }
        }
        prevActiveRef.current = nowActive;
        if (nowActive.size > 0 && typeof Notification !== 'undefined' && Notification.permission === 'default') {
          void Notification.requestPermission();
        }
        setJobs(data.items);
        setTotal(data.total);
        setError(null);
      })
      .catch((err) => {
        logger.error('Failed to load jobs:', String(err));
        setError('加载任务列表失败');
      })
      .finally(() => setLoading(false));
  }, [id, statusFilter, typeFilter, notifyCompleted]);

  useEffect(() => {
    setLoading(true);
    fetchJobs();
  }, [fetchJobs]);

  // P1 修复：仅当存在未完成任务时轮询，且页面不可见时跳过；之前无条件 5s 请求
  const hasActiveJobs = jobs.some((j) =>
    ['pending', 'queued', 'running', 'retrying'].includes(j.status),
  );
  useEffect(() => {
    if (!hasActiveJobs) return;
    const timer = setInterval(() => {
      if (!document.hidden) fetchJobs();
    }, 5000);
    const onVisible = () => {
      if (!document.hidden) fetchJobs();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [fetchJobs, hasActiveJobs]);

  const handleRetry = async (jobId: string) => {
    try {
      await generation.retryJob(jobId);
      fetchJobs();
    } catch (err) {
      logger.error('Retry failed:', String(err));
      setError('重试失败');
    }
  };

  const handleCancel = async (jobId: string) => {
    // V8 取消的诚实边界：只停本地状态机，远端任务可能继续跑并计费（与 ToonFlow 同级局限）
    if (!await showConfirm('取消后本地不再跟进，但远端可能继续执行并计费。确定取消吗？')) return;
    try {
      await generation.cancelJob(jobId);
      fetchJobs();
    } catch (err) {
      logger.error('Cancel failed:', String(err));
      setError('取消失败');
    }
  };

  // P1 体验：手动刷新单个运行中任务的真实进度（之前只能等 5s 整表轮询）
  const handlePoll = async (jobId: string) => {
    setPollingIds((prev) => new Set(prev).add(jobId));
    try {
      const updated = await generation.pollJob(jobId);
      setJobs((prev) => prev.map((j) => (j.id === jobId ? updated : j)));
    } catch (err) {
      logger.error('Poll failed:', String(err));
    } finally {
      setPollingIds((prev) => {
        const next = new Set(prev);
        next.delete(jobId);
        return next;
      });
    }
  };

  const renderDetail = (job: GenerationJob) => {
    const rows: { label: string; value: string }[] = [
      { label: '任务 ID', value: job.id },
      { label: '重试', value: `${job.retryCount || 0} / ${job.maxRetries ?? 3}` },
    ];
    if (job.errorMessage) rows.push({ label: '失败原因', value: job.errorMessage });
    if (job.inputData) {
      const prompt = (job.inputData as Record<string, unknown>).prompt;
      if (typeof prompt === 'string' && prompt) {
        rows.push({ label: '输入', value: prompt.length > 200 ? `${prompt.slice(0, 200)}…` : prompt });
      }
    }
    if (job.outputData) {
      const out = job.outputData as Record<string, unknown>;
      const url = typeof out.url === 'string' ? out.url : undefined;
      rows.push({ label: '产物', value: url ? url.slice(0, 120) : JSON.stringify(out).slice(0, 200) });
    }
    return (
      <div className="space-y-1.5 px-1 py-1">
        {rows.map((r) => (
          <div key={r.label} className="flex gap-2 text-xs">
            <span className="shrink-0 text-muted-foreground">{r.label}：</span>
            <span className="break-all text-foreground">{r.value}</span>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-600">
          {error}
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground">任务队列</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            共 {total} 个任务
            {hasActiveJobs ? ' · 有进行中任务时每 5 秒自动刷新' : ' · 无进行中任务，已暂停自动刷新'}
            {workerInfo && ` · 消费器${workerInfo.mode === 'queue' ? `并发${workerInfo.concurrency}（排队${workerInfo.waiting}，执行${workerInfo.active}）` : workerInfo.mode === 'inline' ? '单机串行降级' : '未启动'}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchJobs}
            className="flex items-center gap-1.5 rounded-lg border border-input bg-white px-3 py-2 text-sm font-medium text-foreground hover:bg-muted/50"
          >
            <RefreshCw className="h-4 w-4" />
            刷新
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1 rounded-lg border border-input bg-white p-1">
          {statusFilters.map((filter) => (
            <button
              key={filter.value}
              onClick={() => setStatusFilter(filter.value)}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                statusFilter === filter.value
                  ? 'bg-primary text-white'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {filter.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1.5">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as JobType | 'all')}
            className="h-9 rounded-lg border border-input bg-white px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
          >
            {typeFilters.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Table */}
      <VariantGroups jobs={jobs} onAdopted={fetchJobs} onError={setError} />
      <div className="overflow-hidden rounded-xl border bg-white shadow-sm">
        {loading ? (
          <div className="p-6 text-center text-sm text-muted-foreground">加载中...</div>
        ) : jobs.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground">
            暂无任务
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/30">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground whitespace-nowrap">任务类型</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground whitespace-nowrap">目标</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground whitespace-nowrap">状态</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground whitespace-nowrap">进度</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground whitespace-nowrap">模型</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground whitespace-nowrap">费用</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground whitespace-nowrap">开始时间</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground whitespace-nowrap">操作</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => {
                  // P1 修复：未知状态兜底（之前新增状态直接 info undefined 崩溃）
                  const info = statusInfoMap[job.status] ?? {
                    label: job.status,
                    className: 'bg-gray-100 text-gray-600',
                    barClass: 'bg-gray-400',
                  };
                  const isRunning = job.status === 'running';
                  const expanded = expandedId === job.id;
                  const polling = pollingIds.has(job.id);
                  return (
                    <Fragment key={job.id}>
                      <tr className="border-t border-border hover:bg-muted/20">
                      <td className="px-4 py-3 font-medium text-foreground whitespace-nowrap">
                        {typeLabelMap[job.jobType] || job.jobType}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground max-w-[160px] truncate">
                        {job.targetType || '-'}
                        {job.targetId && ` · ${job.targetId.slice(0, 8)}`}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${info.className}`}>
                          {info.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 min-w-[140px]">
                        <div className="flex items-center gap-2">
                          <div className="relative h-1.5 flex-1 min-w-[80px] overflow-hidden rounded-full bg-muted">
                            <div
                              className={`h-full rounded-full ${info.barClass} ${isRunning ? 'animate-pulse' : ''}`}
                              style={{ width: `${Math.min(job.progress || 0, 100)}%` }}
                            />
                          </div>
                          <span className="w-10 text-right text-xs text-muted-foreground">
                            {job.progress || 0}%
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                        {job.modelName || job.providerName || '-'}
                      </td>
                      <td className="px-4 py-3 text-foreground whitespace-nowrap">
                        ¥{job.cost?.toFixed(2) || '0.00'}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap text-xs">
                        {job.startedAt
                          ? new Date(job.startedAt).toLocaleString('zh-CN', {
                              month: '2-digit',
                              day: '2-digit',
                              hour: '2-digit',
                              minute: '2-digit',
                            })
                          : '-'}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => setExpandedId(expanded ? null : job.id)}
                            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
                            title={expanded ? '收起详情' : '查看详情'}
                          >
                            {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                          </button>
                          {(job.status === 'running' || job.status === 'pending') && (
                            <button
                              onClick={() => handlePoll(job.id)}
                              disabled={polling}
                              className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:text-primary disabled:opacity-50"
                              title="立即刷新该任务进度"
                            >
                              <RefreshCw className={`h-3.5 w-3.5 ${polling ? 'animate-spin' : ''}`} />
                            </button>
                          )}
                          {job.status === 'failed' && (
                            <button
                              onClick={() => handleRetry(job.id)}
                              className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:text-primary"
                              title="重试"
                            >
                              <RefreshCw className="h-3.5 w-3.5" />
                            </button>
                          )}
                          {(job.status === 'running' || job.status === 'pending' || job.status === 'queued') && (
                            <button
                              onClick={() => handleCancel(job.id)}
                              className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:text-red-500"
                              title="取消"
                            >
                              <XCircle className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                    {expanded && (
                      <tr className="border-t border-border bg-muted/10">
                        <td colSpan={8} className="px-4 py-3">
                          {renderDetail(job)}
                        </td>
                      </tr>
                    )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default ProjectTasksTab;

/**
 * V2 变体组视图：同一 variantGroup 的成功视频并排（运镜/状态/产物），
 * 一键采纳为成片。不成功的变体只展示状态，不可采纳。
 */
const VariantGroups = ({
  jobs,
  onAdopted,
  onError,
}: {
  jobs: GenerationJob[];
  onAdopted: () => void;
  onError: (msg: string | null) => void;
}) => {
  const [adopting, setAdopting] = useState<string | null>(null);
  const groups = new Map<string, GenerationJob[]>();
  for (const j of jobs) {
    const g = (j.inputData as Record<string, unknown> | undefined)?.variantGroup;
    if (j.jobType === 'video' && typeof g === 'string' && g) {
      const list = groups.get(g) ?? [];
      list.push(j);
      groups.set(g, list);
    }
  }
  if (groups.size === 0) return null;

  const adopt = async (jobId: string) => {
    setAdopting(jobId);
    try {
      await generation.adoptJob(jobId);
      onError(null);
      onAdopted();
    } catch (e) {
      logger.error('Adopt failed:', String(e));
      onError('采纳失败（仅已成功的变体可采纳）');
    } finally {
      setAdopting(null);
    }
  };

  return (
    <div className="mb-4 space-y-3">
      {[...groups.entries()].map(([gid, list]) => (
        <div key={gid} className="rounded-xl border bg-white p-4 shadow-sm">
          <div className="mb-2 flex items-center gap-2">
            <Layers className="h-4 w-4 text-primary" />
            <span className="text-sm font-semibold text-foreground">变体组 {gid}</span>
            <span className="text-xs text-muted-foreground">
              {list.filter((j) => j.status === 'succeeded').length} / {list.length} 成功
            </span>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {list.map((j) => {
              const input = (j.inputData as Record<string, unknown> | undefined) ?? {};
              const movement = typeof input.variantMovement === 'string' ? input.variantMovement : '—';
              const out = (j.outputData as Record<string, unknown> | undefined) ?? {};
              const url = typeof out.url === 'string' ? out.url : undefined;
              const done = j.status === 'succeeded' && url;
              return (
                <div key={j.id} className="rounded-lg border border-border/60 p-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-foreground">运镜 {movement}</span>
                    <span className="text-[10px] text-muted-foreground">{j.status}</span>
                  </div>
                  {url && j.status === 'succeeded' ? (
                    <video src={url} controls preload="metadata" className="mt-1.5 aspect-video w-full rounded-md bg-black" />
                  ) : (
                    <div className="mt-1.5 flex aspect-video w-full items-center justify-center rounded-md bg-muted text-[11px] text-muted-foreground">
                      {j.status === 'failed' ? '生成失败' : '等待成片'}
                    </div>
                  )}
                  <button
                    onClick={() => adopt(j.id)}
                    disabled={!done || adopting === j.id}
                    title={done ? '设为该镜头的成片视频' : '仅已成功的变体可采纳'}
                    className="mt-1.5 w-full rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground disabled:opacity-40"
                  >
                    {adopting === j.id ? '采纳中…' : '采纳为成片'}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
};
