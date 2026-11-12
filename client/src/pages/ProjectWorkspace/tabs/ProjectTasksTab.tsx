/**
 * 任务队列 · Studio 舞台版（重设计）
 * -------------------------------------------------------------
 * 旧版把「任务数 / SSE 状态 / 消费器并发」全塞进一行副标题，
 * 再配一张 8 列密表，视觉上又长又挤。这里改成：
 *   ① 概览指标卡（总数 / 进行中 / 已完成 / 失败 / 累计费用）
 *   ② 连接状态独立成 pill，消费器信息收进说明
 *   ③ 状态筛选带实时计数，类型筛选独立
 *   ④ 任务行改为卡片式列表，主次信息分层，详情展开区独立
 * 所有原有能力（SSE 实时流、断线降级轮询、完成通知、单任务刷新进度、
 * 重试 / 取消 / 一键重试全部失败、变体组采纳、详情展开）一律保留。
 */
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
  Activity,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Radio,
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
  { value: 'paused', label: '已暂停' },
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

// 状态胶囊：统一 .pill 5 色板（见 tailwind-theme.css）
const statusInfoMap: Record<JobStatus, { label: string; className: string; barClass: string }> = {
  pending: { label: '等待中', className: 'pill-neutral', barClass: 'bg-muted-foreground/50' },
  queued: { label: '排队中', className: 'pill-neutral', barClass: 'bg-muted-foreground/50' },
  running: { label: '进行中', className: 'pill-run', barClass: 'bg-blue-400' },
  succeeded: { label: '已完成', className: 'pill-ok', barClass: 'bg-emerald-400' },
  failed: { label: '失败', className: 'pill-fail', barClass: 'bg-red-400' },
  cancelled: { label: '已取消', className: 'pill-neutral', barClass: 'bg-muted-foreground/50' },
  retrying: { label: '重试中', className: 'pill-wait', barClass: 'bg-amber-400' },
  paused: { label: '已暂停', className: 'pill-wait', barClass: 'bg-amber-400' },
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
  asset_prep: '资产定妆',
};

// 未结束状态：含人工暂停。暂停任务仍占队列位、可在「全站排队」页恢复，
// 因此 SSE 断线降级轮询也必须继续，否则恢复后本页不会刷新。
const ACTIVE_STATUSES = ['pending', 'queued', 'running', 'retrying', 'paused'];

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
      if (ACTIVE_STATUSES.includes(job.status)) {
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
  const hasActiveJobs = allJobs.some((j) => ACTIVE_STATUSES.includes(j.status));
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

  const stats = useMemo(() => ({
    total: allJobs.length,
    active: allJobs.filter((j) => ACTIVE_STATUSES.includes(j.status)).length,
    done: allJobs.filter((j) => j.status === 'succeeded').length,
    failed: allJobs.filter((j) => j.status === 'failed').length,
    cost: allJobs.reduce((sum, j) => sum + (j.cost || 0), 0),
  }), [allJobs]);

  const countOf = (v: JobStatus | 'all') =>
    v === 'all' ? allJobs.length : allJobs.filter((j) => j.status === v).length;

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
      <div className="tq-detail-grid">
        {rows.map((r) => (
          <div key={r.label} className="tq-detail-row">
            <span>{r.label}</span>
            <b>{r.value}</b>
          </div>
        ))}
      </div>
    );
  };

  const workerText = workerInfo
    ? workerInfo.mode === 'queue'
      ? `消费器并发 ${workerInfo.concurrency} · 排队 ${workerInfo.waiting} · 执行 ${workerInfo.active}`
      : workerInfo.mode === 'inline' ? '单机串行降级' : '消费器未启动'
    : '';

  return (
    <div className="tq">
      {error ? <div className="tq-alert"><AlertCircle size={14} />{error}</div> : null}

      {/* ① 页头 */}
      <header className="tq-head">
        <div className="tq-head-l">
          <span className="tq-kicker">QUEUE / 生产队列</span>
          <h2>任务队列</h2>
          <p>后台生成任务的实时进度、重试与取消</p>
        </div>
        <div className="tq-head-r">
          <span className={`tq-conn${sseDown ? ' warn' : ''}`} title={workerText}>
            <Radio size={12} />
            {sseDown ? '降级轮询 · 5s' : 'SSE 实时推送'}
          </span>
          {failedJobs.length > 0 ? (
            <button
              type="button"
              className="tq-btn tq-btn-danger"
              onClick={handleRetryAllFailed}
              disabled={retryingAll}
              title="一键重试全部失败任务"
            >
              {retryingAll ? <Loader2 size={13} className="spin" /> : <RotateCcw size={13} />}
              重试全部失败 <b className="num">{failedJobs.length}</b>
            </button>
          ) : null}
          <button type="button" className="tq-btn" onClick={fetchJobs} title="刷新任务列表">
            <RefreshCw size={13} /> 刷新
          </button>
        </div>
      </header>

      {/* ② 概览指标 */}
      <div className="tq-stats">
        <div className="tq-stat">
          <span className="tq-stat-ico"><Activity size={14} /></span>
          <span>任务总数</span><b className="num">{stats.total}</b>
        </div>
        <div className="tq-stat run">
          <span className="tq-stat-ico"><Loader2 size={14} /></span>
          <span>进行中</span><b className="num">{stats.active}</b>
        </div>
        <div className="tq-stat ok">
          <span className="tq-stat-ico"><CheckCircle2 size={14} /></span>
          <span>已完成</span><b className="num">{stats.done}</b>
        </div>
        <div className="tq-stat bad">
          <span className="tq-stat-ico"><AlertCircle size={14} /></span>
          <span>失败</span><b className="num">{stats.failed}</b>
        </div>
        <div className="tq-stat">
          <span className="tq-stat-ico"><Layers size={14} /></span>
          <span>累计费用</span><b className="num">¥{stats.cost.toFixed(2)}</b>
        </div>
      </div>
      {workerText ? <div className="tq-worker">{workerText}</div> : null}

      {/* ③ 筛选 */}
      <div className="tq-bar">
        <div className="tq-status" role="group" aria-label="按状态筛选">
          {statusFilters.map((f) => (
            <button
              key={f.value}
              type="button"
              className={statusFilter === f.value ? 'on' : ''}
              onClick={() => setStatusFilter(f.value)}
            >
              {f.label}<i className="num">{countOf(f.value)}</i>
            </button>
          ))}
        </div>
        <label className="tq-type">
          <Filter size={13} />
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as JobType | 'all')}
            aria-label="按任务类型筛选"
          >
            {typeFilters.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
          <ChevronDown size={12} />
        </label>
      </div>

      {/* ④ 变体组 + 任务列表 */}
      <VariantGroups jobs={jobs} onAdopted={fetchJobs} onError={setError} />

      <div className="tq-list">
        <div className="tq-list-h">
          <span>任务 / 目标</span><span>状态</span><span>进度</span>
          <span>模型</span><span>费用</span><span>开始时间</span><span>操作</span>
        </div>
        {loading ? (
          <div className="tq-empty">正在读取任务队列…</div>
        ) : jobs.length === 0 ? (
          <div className="tq-empty">当前筛选条件下暂无任务</div>
        ) : (
          jobs.map((job) => {
            // P1 修复：未知状态兜底（之前新增状态直接 info undefined 崩溃）
            const info = statusInfoMap[job.status] ?? {
              label: job.status,
              className: 'pill-neutral',
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
                <div className={`tq-row${expanded ? ' open' : ''}`}>
                  <div className="tq-row-main">
                    <span className="tq-row-ico"><Layers size={13} /></span>
                    <div>
                      <b>{typeLabelMap[job.jobType] || job.jobType}</b>
                      <span>{job.targetType || '—'}{job.targetId ? ` · ${job.targetId.slice(0, 8)}` : ''}</span>
                    </div>
                  </div>
                  <div className="tq-row-st">
                    <span className={`pill ${info.className}`}>{info.label}</span>
                  </div>
                  <div className="tq-row-pg">
                    <div className="tq-bar-mini"><span className={info.barClass} style={{ width: `${Math.min(job.progress || 0, 100)}%` }} /></div>
                    <i className="num">{job.progress || 0}%</i>
                  </div>
                  <div className="tq-row-model" title={job.modelName || job.providerName || ''}>
                    {job.modelName || job.providerName || '—'}
                  </div>
                  <div className="tq-row-cost num">
                    ¥{job.cost?.toFixed(2) || '0.00'}
                    {isMock ? <em title="占位产物（mock 演练通道），未计费，不能当作真实出片">演示</em> : null}
                  </div>
                  <div className="tq-row-time num">
                    {job.startedAt
                      ? new Date(job.startedAt).toLocaleString('zh-CN', {
                          month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
                        })
                      : '—'}
                  </div>
                  <div className="tq-row-act">
                    <button
                      type="button"
                      className={`tq-ico${expanded ? ' on' : ''}`}
                      onClick={() => setExpandedId(expanded ? null : job.id)}
                      title={expanded ? '收起详情' : '查看详情'}
                      aria-label={expanded ? '收起详情' : '查看详情'}
                    >
                      {expanded ? <ChevronDown size={13} /> : <Eye size={13} />}
                    </button>
                    {(job.status === 'running' || job.status === 'pending') ? (
                      <button type="button" className="tq-ico" onClick={() => handlePoll(job.id)} disabled={polling} title="立即刷新该任务进度" aria-label="刷新进度">
                        <RefreshCw size={13} className={polling ? 'spin' : ''} />
                      </button>
                    ) : null}
                    {job.status === 'failed' ? (
                      <button type="button" className="tq-ico" onClick={() => handleRetry(job.id)} title="重试" aria-label="重试">
                        <RotateCcw size={13} />
                      </button>
                    ) : null}
                    {(job.status === 'running' || job.status === 'pending' || job.status === 'queued') ? (
                      <button type="button" className="tq-ico danger" onClick={() => handleCancel(job.id)} title="取消" aria-label="取消">
                        <XCircle size={13} />
                      </button>
                    ) : null}
                  </div>
                </div>
                {expanded ? <div className="tq-detail">{renderDetail(job)}</div> : null}
              </Fragment>
            );
          })
        )}
      </div>
      <div className="tq-foot">共 {jobs.length} 条 · {sseDown ? 'SSE 不可用，已降级轮询' : 'SSE 实时推送中'}{isRunningHint(hasActiveJobs)}</div>
    </div>
  );
};

const isRunningHint = (active: boolean) => (active ? ' · 有进行中的任务，进度持续更新' : '');

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
    <div className="tq-vg">
      {[...groups.entries()].map(([gid, list]) => (
        <div key={gid} className="tq-vg-card">
          <div className="tq-vg-h">
            <Layers size={13} />
            <b>变体组 {gid}</b>
            <span>{list.filter((j) => j.status === 'succeeded').length} / {list.length} 成功</span>
          </div>
          <div className="tq-vg-grid">
            {list.map((j) => {
              const input = (j.inputData as Record<string, unknown> | undefined) ?? {};
              const movement = typeof input.variantMovement === 'string' ? input.variantMovement : '—';
              const out = (j.outputData as Record<string, unknown> | undefined) ?? {};
              const url = typeof out.url === 'string' ? out.url : undefined;
              const done = j.status === 'succeeded' && url;
              return (
                <div key={j.id} className="tq-vg-item">
                  <div className="tq-vg-item-h">
                    <span>运镜 {movement}</span><em>{j.status}</em>
                  </div>
                  {url && j.status === 'succeeded' ? (
                    <video src={url} controls preload="metadata" className="tq-vg-video" />
                  ) : (
                    <div className="tq-vg-ph">{j.status === 'failed' ? '生成失败' : '等待成片'}</div>
                  )}
                  <button
                    type="button"
                    className="tq-vg-btn"
                    onClick={() => adopt(j.id)}
                    disabled={!done || adopting === j.id}
                    title={done ? '设为该镜头的成片视频' : '仅已成功的变体可采纳'}
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
