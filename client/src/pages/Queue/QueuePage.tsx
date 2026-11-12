/**
 * 全站排队 · 方案 V8
 * ---------------------------------------------------------------------------
 * 用户诉求：同时跑三四个项目时，不知道任务按什么顺序排队；希望能暂停/终止
 * 前面的任务让后面自动跟上，并能调整顺序。
 *
 * 页面纪律：
 * ① 默认严格按后端 /api/queue/overview 返回的顺序展示（= queue_seq ASC
 *    = 消费器真实认领顺序），前端不做任何二次排序，所见即所得。
 * ② 暂停/终止只改变任务状态，claim 跳过它们 → 后面的任务自动补位。
 * ③ 调序、轮转重排都是显式人工动作，需要用户点击（轮转要二次确认）。
 * ④ 三种 UI 模式（studio / classic / geek）共用本页，靠 @container 自适应。
 */
import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import {
  Activity,
  ArrowDown,
  ArrowUp,
  ChevronsDown,
  ChevronsUp,
  CirclePause,
  CirclePlay,
  Clock3,
  ListOrdered,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  Shuffle,
  Square,
} from 'lucide-react';
import PageHeader from '@client/src/components/PageHeader';
import { Button } from '@client/src/components/ui/button';
import { showConfirm } from '@client/src/components/ui/confirm';
import { useVisibleInterval } from '@client/src/lib/hooks';
import * as queueApi from '@client/src/api/queue';
import type {
  JobStatus,
  JobType,
  QueueItem,
  QueueMoveDirection,
  QueueOverviewResponse,
} from '@shared/api.interface';

const STATUS_META: Record<JobStatus, { label: string; pill: string }> = {
  pending: { label: '等待中', pill: 'pill-neutral' },
  queued: { label: '已入队', pill: 'pill-neutral' },
  running: { label: '执行中', pill: 'pill-run' },
  succeeded: { label: '已完成', pill: 'pill-ok' },
  failed: { label: '失败', pill: 'pill-fail' },
  cancelled: { label: '已终止', pill: 'pill-neutral' },
  retrying: { label: '重试中', pill: 'pill-wait' },
  paused: { label: '已暂停', pill: 'pill-wait' },
};

const TYPE_LABEL: Record<JobType, string> = {
  text: '文本生成',
  image: '首帧 / 图像',
  video: '视频生成',
  tts: '语音合成',
  parse_script: '剧本解析',
  storyboard: '分镜生成',
  qc: '质检',
  edit: '剪辑合成',
  script: '剧本技能',
  boards: '分镜表',
  asset_prep: '资产定妆',
};

const BLOCK_LABEL: Record<string, string> = {
  waiting_first_frame: '等首帧',
  first_frame_failed: '首帧失败',
  first_frame_missing: '首帧缺失',
  waiting_assets: '等资产定妆',
};

const isMovable = (s: JobStatus) =>
  s === 'pending' || s === 'queued' || s === 'retrying';

const fmtDuration = (ms: number): string => {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s} 秒`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} 分 ${s % 60} 秒`;
  const h = Math.floor(m / 60);
  return `${h} 小时 ${m % 60} 分`;
};

const errText = (e: unknown): string =>
  (e as { message?: string; response?: { data?: { message?: string } } } | null)?.response?.data?.message ??
  (e as { message?: string } | null)?.message ??
  '未知错误';

export default function QueuePage() {
  const [data, setData] = useState<QueueOverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | JobStatus>('all');
  const [projectFilter, setProjectFilter] = useState<string>('all');
  const [keyword, setKeyword] = useState('');

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await queueApi.queueOverview();
      setData(res);
      setError(null);
    } catch (e) {
      setError(`加载全站排队失败：${errText(e)}`);
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  // 挂载立即拉一次；页签隐藏时自动暂停轮询，回到前台补拉
  useVisibleInterval(() => {
    if (autoRefresh) void load(true);
  }, 5000);

  const run = useCallback(
    async (
      key: string,
      fn: () => Promise<{ message?: string } | { globallyPaused: boolean; message: string } | { reordered: number; message: string }>,
      fallbackMsg: string,
    ) => {
      setBusy(key);
      try {
        const res = await fn();
        toast.success(res.message || fallbackMsg);
        await load(true);
      } catch (e) {
        toast.error(`操作失败：${errText(e)}`);
      } finally {
        setBusy(null);
      }
    },
    [load],
  );

  const items = useMemo(() => {
    if (!data) return [];
    const q = keyword.trim().toLowerCase();
    return data.items.filter((j) => {
      if (statusFilter !== 'all' && j.status !== statusFilter) return false;
      if (projectFilter !== 'all' && (j.projectId ?? '__no_project__') !== projectFilter) return false;
      if (q) {
        const hay = [
          j.projectTitle,
          j.providerName,
          j.modelName,
          j.id,
          TYPE_LABEL[j.jobType],
          j.targetId,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [data, statusFilter, projectFilter, keyword]);

  const onMove = (item: QueueItem, direction: QueueMoveDirection) =>
    void run(`move:${item.id}:${direction}`, () => queueApi.moveQueueJob(item.id, direction), '顺序已调整');

  const onPause = (item: QueueItem) =>
    void run(`pause:${item.id}`, () => queueApi.pauseQueueJob(item.id), '任务已暂停，后续任务将自动补位');

  const onResume = (item: QueueItem) =>
    void run(`resume:${item.id}`, () => queueApi.resumeQueueJob(item.id), '任务已恢复到原排队位置');

  const onTerminate = async (item: QueueItem) => {
    const danger =
      item.status === 'running'
        ? '该任务正在执行：本地会立即终止，但供应商侧可能仍在生成并产生费用，且不会被记账。'
        : '依赖它的下游任务也会被一并终止。';
    const ok = await showConfirm(
      `确定终止 #${item.position}（${TYPE_LABEL[item.jobType]} · ${item.projectTitle ?? '无项目'}）吗？${danger}此操作不可逆。`,
    );
    if (!ok) return;
    await run(`terminate:${item.id}`, () => queueApi.terminateQueueJob(item.id), '任务已终止');
  };

  const onGlobalPause = (paused: boolean) =>
    void run('global', () => queueApi.setQueueGlobalPause(paused), paused ? '全站已暂停' : '全站已恢复');

  const onRoundRobin = async () => {
    const ok = await showConfirm(
      '按项目轮转重排会改变当前排队顺序（每个项目轮流一条），用于避免单个项目批量任务挡住其它项目。确定执行吗？',
    );
    if (!ok) return;
    await run('round-robin', () => queueApi.roundRobinQueue(), '已重排');
  };

  const statCards = data
    ? [
        { label: '等待 / 已入队', value: data.stats.pending + data.stats.queued, icon: ListOrdered },
        { label: '执行中', value: data.stats.running, icon: Activity },
        { label: '已暂停', value: data.stats.paused, icon: Pause },
        { label: '依赖阻断', value: data.stats.blocked, icon: Clock3 },
      ]
    : [];

  return (
    <div className="@container mx-auto w-full max-w-6xl space-y-5 p-4 @md:p-6">
      <PageHeader
        title="全站排队"
        icon={ListOrdered}
        description="所有项目共用一条队列，默认严格按提交顺序执行。可暂停 / 终止前面的任务，后面的会自动补位；也可手动调整顺序。"
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
              {loading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
              刷新
            </Button>
            <Button
              variant={data?.globallyPaused ? 'default' : 'outline'}
              size="sm"
              onClick={() => onGlobalPause(!data?.globallyPaused)}
              disabled={busy === 'global'}
            >
              {data?.globallyPaused ? <Play /> : <Pause />}
              {data?.globallyPaused ? '恢复全站消费' : '暂停全站消费'}
            </Button>
          </>
        }
      />

      {/* 消费器状态条：模式 / 并发 / 队列深度 / 刷新开关 */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border bg-card px-4 py-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <Activity className="h-3.5 w-3.5" />
          消费模式 <b className="font-medium text-foreground">{data?.worker.mode ?? '—'}</b>
        </span>
        <span>并发 <b className="font-medium text-foreground">{data?.worker.concurrency ?? 0}</b></span>
        <span>BullMQ 等待 <b className="font-medium text-foreground">{data?.worker.waiting ?? 0}</b></span>
        <span>BullMQ 执行 <b className="font-medium text-foreground">{data?.worker.active ?? 0}</b></span>
        <span className="ml-auto flex items-center gap-2">
          <label className="flex cursor-pointer items-center gap-1.5">
            <input
              type="checkbox"
              className="accent-current"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
            />
            自动刷新（5 秒）
          </label>
          {data?.generatedAt && (
            <span className="hidden @md:inline">
              更新于 {new Date(data.generatedAt).toLocaleTimeString('zh-CN')}
            </span>
          )}
        </span>
      </div>

      {/* 统计 + 一键公平化 */}
      <div className="grid grid-cols-2 gap-3 @md:grid-cols-4">
        {statCards.map((s) => (
          <div key={s.label} className="rounded-lg border bg-card px-4 py-3">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <s.icon className="h-3.5 w-3.5" />{s.label}
            </div>
            <div className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{s.value}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card px-4 py-3">
        <Button variant="outline" size="sm" onClick={() => void onRoundRobin()} disabled={busy === 'round-robin'}>
          <Shuffle />按项目轮转重排
        </Button>
        <span className="text-xs text-muted-foreground">
          默认按提交顺序；仅当你觉得某个项目批量任务挡住其它项目时，才用它做一次公平化重排。
        </span>
      </div>

      {/* 各项目排队深度 */}
      {data && data.projects.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">按项目筛选：</span>
          <button
            type="button"
            onClick={() => setProjectFilter('all')}
            className={`rounded-md border px-2.5 py-1 text-xs ${projectFilter === 'all' ? 'bg-secondary font-medium text-foreground' : 'text-muted-foreground'}`}
          >
            全部 · {data.total}
          </button>
          {data.projects.map((p) => (
            <button
              key={p.projectId}
              type="button"
              onClick={() => setProjectFilter(projectFilter === p.projectId ? 'all' : p.projectId)}
              title={`等待 ${p.waiting} / 执行 ${p.running} / 暂停 ${p.paused}`}
              className={`max-w-[16rem] truncate rounded-md border px-2.5 py-1 text-xs ${projectFilter === p.projectId ? 'bg-secondary font-medium text-foreground' : 'text-muted-foreground'}`}
            >
              {p.projectTitle} · {p.waiting} 待 / {p.running} 跑
              {p.paused > 0 ? ` / ${p.paused} 停` : ''}
            </button>
          ))}
        </div>
      )}

      {/* 过滤条 */}
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as 'all' | JobStatus)}
          className="h-8 rounded-md border bg-background px-2 text-xs text-foreground"
        >
          <option value="all">全部状态</option>
          {(['pending', 'queued', 'running', 'retrying', 'paused'] as JobStatus[]).map((s) => (
            <option key={s} value={s}>{STATUS_META[s].label}</option>
          ))}
        </select>
        <input
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="搜索项目 / 供应商 / 任务 ID"
          className="h-8 w-56 rounded-md border bg-background px-2 text-xs text-foreground placeholder:text-muted-foreground"
        />
        <span className="text-xs text-muted-foreground">显示 {items.length} / {data?.total ?? 0} 条</span>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-xs text-destructive">
          {error}
        </div>
      )}

      {/* 队列表：顺序 = 后端 queue_seq ASC，不二次排序 */}
      <div className="overflow-hidden rounded-lg border bg-card">
        <div className="flex items-center gap-2 border-b bg-muted/30 px-4 py-2 text-xs font-medium text-muted-foreground">
          <span className="w-10 shrink-0 text-right">顺序</span>
          <span className="min-w-0 flex-1">任务 / 项目 / 说明</span>
          <span className="hidden shrink-0 @md:inline">操作</span>
        </div>

        {loading && !data ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />加载全站排队…
          </div>
        ) : items.length === 0 ? (
          <div className="py-16 text-center text-sm text-muted-foreground">
            当前没有符合筛选条件的排队任务。新任务提交后会自动按提交顺序出现在这里。
          </div>
        ) : (
          items.map((item) => {
            const meta = STATUS_META[item.status] ?? STATUS_META.pending;
            const movable = isMovable(item.status);
            const keyBusy = busy !== null;
            return (
              <div
                key={item.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-3 py-2.5 last:border-b-0 hover:bg-muted/30"
              >
                <div className="w-10 shrink-0 text-right font-mono text-xs text-muted-foreground">
                  #{item.position}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`pill ${meta.pill}`}>{meta.label}</span>
                    <span className="text-sm font-medium text-foreground">{TYPE_LABEL[item.jobType]}</span>
                    {item.projectId && item.projectId !== '__no_project__' ? (
                      <Link
                        to={`/project/${item.projectId}/tasks`}
                        className="max-w-[16rem] truncate text-xs text-muted-foreground hover:text-primary"
                        title="打开该项目的任务页"
                      >
                        {item.projectTitle}
                      </Link>
                    ) : (
                      <span className="text-xs text-muted-foreground">{item.projectTitle}</span>
                    )}
                    {item.blockedReason && (
                      <span className="rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[11px] text-amber-600">
                        被阻断：{BLOCK_LABEL[item.blockedReason] ?? item.blockedReason}（暂不参与认领）
                      </span>
                    )}
                    {item.pausedByDependency && (
                      <span className="text-[11px] text-muted-foreground">因前置任务暂停而级联暂停</span>
                    )}
                    {item.status === 'running' && item.progress > 0 && (
                      <span className="text-[11px] text-muted-foreground">进度 {item.progress}%</span>
                    )}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                    <span>队列号 {item.queueSeq}</span>
                    <span>{item.status === 'running' ? '已运行' : '已等待'} {fmtDuration(item.waitedMs)}</span>
                    {item.providerName && (
                      <span className="truncate">{item.providerName}{item.modelName ? ` / ${item.modelName}` : ''}</span>
                    )}
                    {item.retryCount > 0 && <span>重试 {item.retryCount}/{item.maxRetries}</span>}
                    {item.dependsOnJobId && <span>依赖 {item.dependsOnJobId.slice(0, 8)}</span>}
                    <span className="font-mono">{item.id.slice(0, 8)}</span>
                    {item.errorMessage && (
                      <span className="max-w-[24rem] truncate text-destructive" title={item.errorMessage}>
                        {item.errorMessage}
                      </span>
                    )}
                  </div>
                </div>

                <div className="ml-auto flex shrink-0 items-center gap-1">
                  <MoveButton title="置顶" disabled={!movable || keyBusy} onClick={() => onMove(item, 'top')}>
                    <ChevronsUp />
                  </MoveButton>
                  <MoveButton title="上移" disabled={!movable || keyBusy} onClick={() => onMove(item, 'up')}>
                    <ArrowUp />
                  </MoveButton>
                  <MoveButton title="下移" disabled={!movable || keyBusy} onClick={() => onMove(item, 'down')}>
                    <ArrowDown />
                  </MoveButton>
                  <MoveButton title="置底" disabled={!movable || keyBusy} onClick={() => onMove(item, 'bottom')}>
                    <ChevronsDown />
                  </MoveButton>
                  <span className="mx-1 h-5 w-px bg-border" />
                  {item.status === 'paused' ? (
                    <MoveButton title="恢复（回到原位置）" disabled={keyBusy} onClick={() => onResume(item)}>
                      <CirclePlay />
                    </MoveButton>
                  ) : (
                    <MoveButton
                      title={movable ? '暂停（后面的任务自动补位）' : '执行中的任务只能终止'}
                      disabled={!movable || keyBusy}
                      onClick={() => onPause(item)}
                    >
                      <CirclePause />
                    </MoveButton>
                  )}
                  <MoveButton
                    title="终止（不可逆，级联终止下游）"
                    disabled={keyBusy}
                    danger
                    onClick={() => void onTerminate(item)}
                  >
                    <Square />
                  </MoveButton>
                </div>
              </div>
            );
          })
        )}
      </div>

      <p className="text-xs leading-relaxed text-muted-foreground">
        说明：顺序号即消费器的真实认领顺序。暂停 / 终止的任务不再参与认领，后面的任务会自动补位；
        被「等首帧 / 等资产」阻断的任务也不参与认领，等前置产物就绪后自动解封。
        「暂停 / 恢复全站消费」为进程级开关，重启后自动恢复，不会改变任何任务的排队位置。
      </p>
    </div>
  );
}

/** 行内小图标按钮：发丝线 + 底色差，不用渐变 / 阴影 / 上浮缩放 */
function MoveButton({
  title,
  disabled,
  danger,
  onClick,
  children,
}: {
  title: string;
  disabled?: boolean;
  danger?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex h-7 w-7 items-center justify-center rounded border border-transparent text-muted-foreground transition-colors hover:border-border hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30 [&_svg]:h-3.5 [&_svg]:w-3.5 ${danger ? 'hover:text-destructive' : ''}`}
    >
      {children}
    </button>
  );
}
