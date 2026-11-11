import { useCallback, useEffect, useState } from 'react';
import { ListTodo, Image as ImageIcon, Activity, PanelRightClose, Loader2, Film } from 'lucide-react';
import { assets as assetsApi, dashboard as dashboardApi, generation as generationApi } from '@client/src/api';
import type { Asset, GenerationJob } from '@shared/api.interface';
import { useVisibleInterval } from '@client/src/lib/hooks';

/**
 * 经典模式 · 右侧助手坞
 * ─────────────────────────────────────────────
 * 三个页签：生成任务 / 资产库速览 / 平台动态；顶栏按钮可收起（localStorage 持久）。
 * 数据全部来自真实接口：generation.listJobs / assets.listAssets / dashboard.getActivityFeed。
 * 适配深色 token（bg-sidebar / border-sidebar-border / 深色状态徽标）。
 */

const JOB_STATUS_LABELS: Record<string, string> = {
  pending: '排队中', running: '生成中', succeeded: '已完成', failed: '失败', cancelled: '已取消',
};

/** 任务状态 → 统一 .pill 语义色（5 色板，见 tailwind-theme.css） */
const JOB_STATUS_PILL: Record<string, string> = {
  pending: 'pill-wait', queued: 'pill-wait', retrying: 'pill-wait',
  running: 'pill-run',
  succeeded: 'pill-ok', completed: 'pill-ok',
  failed: 'pill-fail',
};

type DockTab = 'jobs' | 'assets' | 'activity';

const TABS: { id: DockTab; label: string; icon: typeof ListTodo }[] = [
  { id: 'jobs', label: '任务', icon: ListTodo },
  { id: 'assets', label: '资产', icon: ImageIcon },
  { id: 'activity', label: '动态', icon: Activity },
];

const ClassicRightDock = ({ onClose }: { onClose: () => void }) => {
  const [tab, setTab] = useState<DockTab>('jobs');

  // ---- 任务 ----
  const [jobs, setJobs] = useState<GenerationJob[]>([]);
  const [jobsLoading, setJobsLoading] = useState(true);

  // ---- 资产 ----
  const [assets, setAssets] = useState<Asset[]>([]);
  const [assetsLoading, setAssetsLoading] = useState(false);

  // ---- 动态 ----
  const [activity, setActivity] = useState<{ id: string; message: string; createdAt: string }[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);

  const loadJobs = useCallback(async () => {
    try {
      const res = await generationApi.listJobs({ page: 1, pageSize: 20 });
      setJobs(res.items ?? []);
    } catch { /* 静默 */ } finally {
      setJobsLoading(false);
    }
  }, []);

  // 页签不可见时暂停任务轮询（useVisibleInterval 挂载即拉一次 + 回前台补拉）
  useVisibleInterval(() => { if (tab === 'jobs') void loadJobs(); }, 5000);

  useEffect(() => {
    if (tab === 'assets') {
      setAssetsLoading(true);
      void assetsApi.listAssets({ page: 1, pageSize: 18 })
        .then((r) => setAssets(r.items ?? []))
        .catch(() => setAssets([]))
        .finally(() => setAssetsLoading(false));
    }
    if (tab === 'activity') {
      setActivityLoading(true);
      void dashboardApi.getActivityFeed(15)
        .then((r) => setActivity(r ?? []))
        .catch(() => setActivity([]))
        .finally(() => setActivityLoading(false));
    }
  }, [tab]);

  const loading = tab === 'jobs' ? jobsLoading : tab === 'assets' ? assetsLoading : activityLoading;

  return (
    <aside className="hidden h-full w-[340px] shrink-0 flex-col border-l border-sidebar-border bg-sidebar xl:flex">
      {/* tab 头：紧凑单行（h-10），页签 + 收起钮 */}
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-sidebar-border px-1.5">
        <div className="flex items-center gap-0.5">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
                tab === id
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              <Icon className="h-3.5 w-3.5" /> {label}
            </button>
          ))}
        </div>
        <button
          onClick={onClose}
          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label="收起助手坞"
          title="收起助手坞"
        >
          <PanelRightClose className="h-4 w-4" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2.5">
        {loading ? (
          <div className="flex h-24 items-center justify-center text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        ) : tab === 'jobs' ? (
          jobs.length === 0 ? (
            <div className="flex flex-col items-center gap-1.5 px-4 py-10 text-center">
              <ListTodo className="h-6 w-6 text-muted-foreground/50" />
              <p className="text-xs font-medium text-foreground/70">暂无生成任务</p>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                在创作作战室发起一句话创作后，任务进度会实时滚动到这里
              </p>
            </div>
          ) : (
            <ul className="space-y-2">
              {jobs.map((j) => (
                <li key={j.id} className="rounded-lg border border-transparent bg-card px-2.5 py-2.5 hover:border-input">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-xs font-medium text-foreground">{j.jobType} · {j.id.slice(0, 8)}</span>
                    <span className={`pill ${JOB_STATUS_PILL[j.status] ?? 'pill-neutral'}`}>
                      {JOB_STATUS_LABELS[j.status] ?? j.status}
                    </span>
                  </div>
                  {j.status === 'running' && (
                    <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${Math.min(100, Math.max(2, j.progress || 2))}%` }} />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )
        ) : tab === 'assets' ? (
          assets.length === 0 ? (
            <div className="flex flex-col items-center gap-1.5 px-4 py-10 text-center">
              <ImageIcon className="h-6 w-6 text-muted-foreground/50" />
              <p className="text-xs font-medium text-foreground/70">暂无资产</p>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                生成的图片 / 视频 / 配音会自动归档到这里，可随时取用
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {assets.map((a) => (
                <div key={a.id} className="overflow-hidden rounded-lg border border-border bg-card">
                  {a.assetType === 'image' ? (
                    <img src={`/api/assets/${a.id}/content`} alt={a.name} loading="lazy" className="h-20 w-full object-cover" />
                  ) : (
                    <div className="flex h-20 items-center justify-center text-muted-foreground">
                      {a.assetType === 'video' ? <Film className="h-6 w-6" /> : <ImageIcon className="h-6 w-6" />}
                    </div>
                  )}
                  <p className="truncate px-1.5 py-1 text-[10px] text-muted-foreground">{a.name}</p>
                </div>
              ))}
            </div>
          )
        ) : activity.length === 0 ? (
          <div className="flex flex-col items-center gap-1.5 px-4 py-10 text-center">
            <Activity className="h-6 w-6 text-muted-foreground/50" />
            <p className="text-xs font-medium text-foreground/70">暂无动态</p>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              创建项目或生成资产后，平台最新动态会按时间线展示在这里
            </p>
          </div>
        ) : (
          <ol className="relative space-y-3 border-l border-border pl-4 pt-1">
            {activity.map((a) => (
              <li key={a.id} className="relative">
                <span className="absolute -left-[21px] top-1.5 h-1.5 w-1.5 rounded-full bg-primary/60 ring-2 ring-sidebar" />
                <p className="line-clamp-3 text-[11px] leading-relaxed text-foreground/85">{a.message}</p>
                <p className="mt-0.5 text-[10px] text-muted-foreground">
                  {(() => {
                    const m = Math.floor((Date.now() - new Date(a.createdAt).getTime()) / 60000);
                    return m < 1 ? '刚刚' : m < 60 ? `${m} 分钟前` : m < 1440 ? `${Math.floor(m / 60)} 小时前` : `${Math.floor(m / 1440)} 天前`;
                  })()}
                </p>
              </li>
            ))}
          </ol>
        )}
      </div>
    </aside>
  );
};

export default ClassicRightDock;
