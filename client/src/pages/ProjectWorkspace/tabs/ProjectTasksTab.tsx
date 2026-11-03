import { useEffect, useState, useCallback, useRef, useMemo, Fragment } from 'react';
import { useParams } from 'react-router-dom';
import {
  RefreshCw,
  XCircle,
  Eye,
  Filter,
  ChevronDown,
  Layers,
  RotateCcw,
} from 'lucide-react';
import { toast } from 'sonner';
import { generation } from '@client/src/api';
import { openJobStream } from '@client/src/api/generation';
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
  pending: { label: '等待中', className: 'bg-muted text-muted-foreground', barClass: 'bg-muted-foreground/50' },
  queued: { label: '排队中', className: 'bg-muted text-muted-foreground', barClass: 'bg-muted-foreground/50' },
  running: { label: '进行中', className: 'bg-blue-500/15 text-blue-400', barClass: 'bg-blue-500/150' },
  succeeded: { label: '已完成', className: 'bg-green-500/15 text-green-400', barClass: 'bg-green-500/150' },
  failed: { label: '失败', className: 'bg-red-500/15 text-red-400', barClass: 'bg-red-500/150' },
  cancelled: { label: '已取消', className: 'bg-muted text-muted-foreground', barClass: 'bg-muted-foreground/50' },
  retrying: { label: '重试中', className: 'bg-amber-500/15 text-amber-400', barClass: 'bg-amber-500/150' },
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
  // 全量任务（SSE 快照或兜底轮询写入），展示时在前端做状态/类型过滤
  const [allJobs, setAllJobs] = useState<GenerationJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<JobStatus | 'all'>('all');
  const [typeFilter, setTypeFilter] = useState<JobType | 'all'>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [pollingIds, setPollingIds] = useState<Set<string>>(new Set());
  const [workerInfo, setWorkerInfo] = useState<{ mode: string; concurrency: number; waiting: number; active: number } | null>(null);
  // SSE 断线标记：降级回 5s 轮询（DramaClaw stream-client 模式）
  const [sseDown, setSseDown] = useState(false);
  const [retryingAll, setRetryingAll] = useState(false);
  useEffect(() => {
    generation.workerStats().then(setWorkerInfo).catch(() => {});
  }, []);
  // 上一轮活跃任务，用于检测“刚完成”并通知
  const prevActiveRef = useRef<Set<string>>(new Set());

  const notifyCompleted = useCallback((job: GenerationJob) => {
    try {
      if (typeof Notification === 'undefined') return;
      if (Notification.permission === 'granted') {
        new Notification('一幕·YIMU AI 短剧创作平台 · 任务完成', {
          body: `${typeLabelMap[job.jobType] || job.jobType}已完成，可前往查看`,
        });
      } else if (Notification.permission === 'default') {
        void Notification.requestPermission();
      }
    } catch {
      // 通知失败不影响主流程
    }
  }, []);

  const applyJobs = useCallback((items: GenerationJob[]) => {
    const prevActive = prevActiveRef.current;
    const nowActive = new Set<string>();
    for (const job of items) {
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
    setAllJobs(items);
    setError(null);
  }, [notifyCompleted]);

  const fetchJobs = useCallback(() => {
    if (!id) return;
    generation.listJobs({ projectId: id, pageSize: 100, page: 1 })
      .then((data) => {
        applyJobs(data.items);
      })
      .catch((err) => {
        logger.error('Failed to load jobs:', String(err));
        setError('加载任务列表失败');
      })
      .finally(() => setLoading(false));
  }, [id, applyJobs]);

  useEffect(() => {
    setLoading(true);
    fetchJobs();
  }, [fetchJobs]);

  // SSE 实时任务流（2s 快照，含状态/进度/失败原因）；断线降级回轮询
  useEffect(() => {
    if (!id || sseDown) return;
    const close = openJobStream(
      id,
      (snap) => {
        applyJobs(snap.jobs ?? []);
        setLoading(false);
      },
      () => setSseDown(true),
    );
    return close;
  }, [id, sseDown, applyJobs]);

  // 前端过滤（状态/类型），SSE 全量快照本地筛选
  const jobs = useMemo(
    () =>
      allJobs.filter(
        (j) =>
          (statusFilter === 'all' || j.status === statusFilter) &&
          (typeFilter === 'all' || j.jobType === typeFilter),
      ),
    [allJobs, statusFilter, typeFilter],
  );

  // P1 修复：仅当存在未完成任务时轮询，且页面不可见时跳过；之前无条件 5s 请求
  const hasActiveJobs = allJobs.some((j) =>
    ['pending', 'queued', 'running', 'retrying'].includes(j.status),
  );
  useEffect(() => {
    if (!sseDown || !hasActiveJobs) return;
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
  }, [fetchJobs, hasActiveJobs, sseDown]);

  const failedJobs = useMemo(
    () => allJobs.filter((j) => j.status === 'failed'),
    [allJobs],
  );

  // P2 断点9：失败任务聚合重试入口（之前只有逐任务重试）
  const handleRetryAllFailed = async () => {
    if (failedJobs.length === 0 || retryingAll) return;
    if (!await showConfirm(`将重试全部 ${failedJobs.length} 个失败任务，继续吗？`)) return;
    setRetryingAll(true);
    let ok = 0;
    let fail = 0;
    for (const j of failedJobs) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await generation.retryJob(j.id);
        ok += 1;
      } catch {
        fail += 1;
      }
    }
    if (ok > 0) toast.success(`已重新投递 ${ok} 个失败任务${fail > 0 ? `，${fail} 个失败` : ''}`);
    else toast.error('重试失败，请稍后再试');
    setRetryingAll(false);
    if (sseDown) fetchJobs();
  };

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
      setAllJobs((prev) => prev.map((j) => (j.id === jobId ? updated : j)));
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
      const input = job.inputData as Record<string, unknown>;
      const blockedReason = typeof input.blockedReason === 'string' ? input.blockedReason : undefined;
      if (blockedReason) {
        const blockedText =
          blockedReason === 'first_frame_failed'
            ? '等待首帧重试成功（首帧生成失败，视频暂不运行、不计费）'
            : blockedReason === 'first_frame_missing'
              ? '缺少本镜首帧（首帧任务缺失，视频暂不运行、不计费）'
              : '等待本镜首帧生成完成';
        rows.push({ label: '等待原因', value: blockedText });
      }
      const prompt = input.prompt;
      if (typeof prompt === 'string' && prompt) {
        rows.push({ label: '输入', value: prompt.length > 200 ? `${prompt.slice(0, 200)}…` : prompt });
      }
    }
    if (job.outputData) {
      const out = job.outputData as Record<string, unknown>;
      const url = typeof out.url === 'string' ? out.url : undefined;
      const isMock = out.mock === true;
      rows.push({
        label: '产物',
        value: `${isMock ? '[演示占位] ' : ''}${url ? url.slice(0, 120) : JSON.stringify(out).slice(0, 200)}`,
      });
      if (isMock) {
        rows.push({
          label: '产物来源',
          value: 'mock 演练通道（占位内容，不产生上游费用，未计费）',
        });
      }
      const billing = (out.billing ?? {}) as Record<string, unknown>;
      const charged = billing.charged;
      if (typeof charged === 'number') {
        const free = typeof billing.free === 'string' ? billing.free : undefined;
        rows.push({
          label: '实际计费',
          value: `¥${charged.toFixed(4)}${free ? `（${free}）` : ''}`,
        });
      }
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
        <div className="rounded-lg border border-red-500/30 bg-red-500/15 p-4 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground">任务队列</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            共 {allJobs.length} 个任务
            {sseDown
              ? hasActiveJobs
                ? ' · SSE 不可用，已降级轮询（有进行中任务时每 5 秒刷新）'
                : ' · SSE 不可用，已降级轮询（无进行中任务，已暂停刷新）'
              : ' · SSE 实时推送中'}
            {workerInfo && ` · 消费器${workerInfo.mode === 'queue' ? `并发${workerInfo.concurrency}（排队${workerInfo.waiting}，执行${workerInfo.active}）` : workerInfo.mode === 'inline' ? '单机串行降级' : '未启动'}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {failedJobs.length > 0 && (
            <button
              onClick={handleRetryAllFailed}
              disabled={retryingAll}
              title="一键重试全部失败任务"
              className="flex items-center gap-1.5 rounded-lg border border-red-500/30 bg-red-500/15 px-3 py-2 text-sm font-medium text-red-400 hover:bg-red-500/20 disabled:opacity-50"
            >
              <RotateCcw className={`h-4 w-4 ${retryingAll ? 'animate-spin' : ''}`} />
              {retryingAll ? '重试中…' : `重试全部失败（${failedJobs.length}）`}
            </button>
          )}
          <button
            onClick={fetchJobs}
            className="flex items-center gap-1.5 rounded-lg border border-input bg-card px-3 py-2 text-sm font-medium text-foreground hover:bg-muted/50"
          >
            <RefreshCw className="h-4 w-4" />
            刷新
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1 rounded-lg border border-input bg-card p-1">
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
            className="h-9 rounded-lg border border-input bg-card px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
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
      <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
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
                    className: 'bg-muted text-muted-foreground',
                    barClass: 'bg-muted-foreground/50',
                  };
                  const isRunning = job.status === 'running';
                  const expanded = expandedId === job.id;
                  const polling = pollingIds.has(job.id);
                  // mock 演练产物：占位内容、未计费，必须在列表里就能看出来
                  const isMock =
                    (job.outputData as Record<string, unknown> | undefined)?.mock === true;
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
                        {isMock && (
                          <span
                            className="ml-1.5 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-600"
                            title="占位产物（mock 演练通道），未计费，不能当作真实出片"
                          >
                            演示
                          </span>
                        )}
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
                              className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:text-red-3000"
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
        <div key={gid} className="rounded-xl border bg-card p-4 shadow-sm">
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
