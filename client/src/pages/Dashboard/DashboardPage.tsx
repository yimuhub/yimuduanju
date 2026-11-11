import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowUpRight, Clapperboard, Coins, Film, FolderKanban, Images,
  Loader2, Clock,
} from 'lucide-react';
import { dashboard as dashboardApi, generation as generationApi } from '@client/src/api';
import type { DashboardStats, GenerationJob, ProjectListItem } from '@shared/api.interface';
import { getNickname } from '@client/src/lib/identity';
import { useVisibleInterval } from '@client/src/lib/hooks';

/**
 * 数据看板（3.0 生产力工作台版）：
 * 取代旧营销式 hero 页——信息密度优先，全部真实数据：
 * KPI 行 / 生成任务（实时进度）/ 最近项目（行式）/ 活动流，5s 静默刷新。
 */

const JOB_LABELS: Record<string, string> = { text: '文本', image: '图片', video: '视频', tts: '配音', parse_script: '剧本解析', script: '剧本' };
// 状态胶囊：统一 .pill 规范（5 色板：蓝=运行 绿=成功 琥珀=等待 红=失败 灰=中性）
const JOB_STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: '排队', cls: 'pill-wait' },
  running: { label: '生成中', cls: 'pill-run' },
  succeeded: { label: '完成', cls: 'pill-ok' },
  failed: { label: '失败', cls: 'pill-fail' },
  cancelled: { label: '取消', cls: 'pill-neutral' },
};
const PROJECT_STATUS: Record<string, { label: string; cls: string }> = {
  draft: { label: '草稿', cls: 'pill-neutral' },
  script_ready: { label: '剧本就绪', cls: 'pill-ok' },
  assets_generating: { label: '资产生成中', cls: 'pill-run' },
  storyboard_ready: { label: '分镜就绪', cls: 'pill-ok' },
  rendering: { label: '成片中', cls: 'pill-run' },
  completed: { label: '已完成', cls: 'pill-ok' },
  failed: { label: '失败', cls: 'pill-fail' },
};

const timeAgo = (iso: string) => {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return '刚刚';
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  return `${Math.floor(h / 24)} 天前`;
};

const DashboardPage = () => {
  const navigate = useNavigate();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [jobs, setJobs] = useState<GenerationJob[]>([]);
  const [recent, setRecent] = useState<ProjectListItem[]>([]);
  const [activity, setActivity] = useState<{ id: string; type: string; message: string; createdAt: string }[]>([]);
  const [loading, setLoading] = useState(true);
  // 问候语昵称：单一来源 lib/identity（挂载时读取，切页即最新）
  const [nickname] = useState(getNickname);

  const load = useCallback(async () => {
    const [s, j, r, a] = await Promise.all([
      dashboardApi.getStats().catch(() => null),
      generationApi.listJobs({ page: 1, pageSize: 8 }).catch(() => ({ items: [] as GenerationJob[] })),
      dashboardApi.getRecentProjects(6).catch(() => [] as ProjectListItem[]),
      dashboardApi.getActivityFeed(8).catch(() => []),
    ]);
    setStats(s);
    setJobs((j as { items: GenerationJob[] }).items ?? []);
    setRecent(r ?? []);
    setActivity(a ?? []);
    setLoading(false);
  }, []);

  // 页签不可见时暂停轮询（useVisibleInterval 挂载即拉一次 + 回前台补拉）
  useVisibleInterval(() => void load(), 5000);

  const kpis = [
    { label: '项目总数', value: stats?.totalProjects ?? 0, icon: FolderKanban, cls: 'bg-sky-500/15 text-sky-400' },
    { label: '生成镜头', value: stats?.totalShots ?? 0, icon: Film, cls: 'bg-violet-500/15 text-violet-400' },
    { label: '产出资产', value: stats?.totalAssets ?? 0, icon: Images, cls: 'bg-emerald-500/15 text-emerald-400' },
    { label: '累计费用', value: `¥${(stats?.totalCost ?? 0).toFixed(2)}`, icon: Coins, cls: 'bg-amber-500/15 text-amber-400' },
  ];

  const runningJobs = jobs.filter((j) => j.status === 'running' || j.status === 'pending');
  const activeJobs = runningJobs.length > 0 ? runningJobs : jobs.slice(0, 6);

  return (
    /* @container：页面会以 ~400px 窄签（极客模式右坞）或整页（经典模式）两种宽度渲染，
       网格断点全部改为容器查询，窄坞内自动降级为少列，避免 KPI 数字被裁切 */
    <div className="@container mx-auto max-w-6xl space-y-5">
      {/* 顶栏：问候（去掉了原「快速开拍」假输入条：输入不落地、仅跳转，与侧栏导航重复） */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-foreground">
            {new Date().getHours() < 12 ? '早上好' : new Date().getHours() < 18 ? '下午好' : '晚上好'}，{nickname}
          </h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {stats && stats.runningJobs > 0
              ? `${stats.runningJobs} 个任务正在生成 · 今日完成 ${stats.completedToday}`
              : '流水线空闲，适合开一部新剧'}
          </p>
        </div>
      </div>

      {/* KPI 行 */}
      <div className="grid grid-cols-2 gap-3 @2xl:grid-cols-3 @4xl:grid-cols-4">
        {kpis.map((k) => (
          <div key={k.label} className="glass-card p-4">
            <div className="flex items-center justify-between">
              <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${k.cls}`}>
                <k.icon className="h-4 w-4" />
              </span>
            </div>
            <div className="mt-2.5 text-2xl font-bold tabular-nums tracking-tight text-foreground">{k.value}</div>
            <div className="text-xs text-muted-foreground">{k.label}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 @4xl:grid-cols-5">
        {/* 左：生成任务 + 最近项目 */}
        <div className="space-y-4 @4xl:col-span-3">
          <section className="rounded-xl border border-border bg-card">
            <header className="flex items-center justify-between border-b border-border px-4 py-3">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <Loader2 className={`h-4 w-4 text-primary ${runningJobs.length ? 'animate-spin' : 'hidden'}`} />
                生成任务
              </h2>
              <button onClick={() => navigate('/')} className="text-xs text-muted-foreground hover:text-primary">
                全部任务 →
              </button>
            </header>
            {loading ? (
              <div className="flex h-32 items-center justify-center"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
            ) : activeJobs.length === 0 ? (
              <p className="px-4 py-8 text-center text-xs text-muted-foreground">暂无任务 · 在作战室发起生成后这里实时滚动</p>
            ) : (
              <ul className="divide-y divide-border">
                {activeJobs.map((j) => {
                  const st = JOB_STATUS[j.status] ?? JOB_STATUS.cancelled;
                  return (
                    <li key={j.id} className="flex items-center gap-3 px-4 py-2.5">
                      <span className="w-14 shrink-0 text-xs font-medium text-foreground">{JOB_LABELS[j.jobType] ?? j.jobType}</span>
                      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{j.id.slice(0, 8)} · {j.modelName ?? j.providerName ?? '—'}</span>
                      {j.status === 'running' && (
                        <span className="hidden w-24 sm:block">
                          <span className="block h-1 overflow-hidden rounded-full bg-muted">
                            <span className="block h-full rounded-full bg-primary transition-all" style={{ width: `${Math.max(4, j.progress || 4)}%` }} />
                          </span>
                        </span>
                      )}
                      <span className={`pill ${st.cls}`}>{st.label}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="rounded-xl border border-border bg-card">
            <header className="flex items-center justify-between border-b border-border px-4 py-3">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <Clapperboard className="h-4 w-4 text-primary" /> 最近项目
              </h2>
              <button onClick={() => navigate('/projects')} className="text-xs text-muted-foreground hover:text-primary">
                全部项目 →
              </button>
            </header>
            {recent.length === 0 ? (
              <p className="px-4 py-8 text-center text-xs text-muted-foreground">还没有项目 · 回作战室一句话开拍</p>
            ) : (
              <ul className="divide-y divide-border">
                {recent.map((p) => {
                  const st = PROJECT_STATUS[p.status] ?? PROJECT_STATUS.draft;
                  return (
                    <li key={p.id}>
                      <button
                        onClick={() => navigate(`/project/${p.id}`)}
                        className="group flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/40"
                      >
                        <span className={`pill ${st.cls}`}>{st.label}</span>
                        <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground group-hover:text-primary">{p.title}</span>
                        <span className="hidden shrink-0 items-center gap-1 text-[11px] text-muted-foreground sm:flex">
                          <Clock className="h-3 w-3" /> {timeAgo(p.updatedAt ?? p.createdAt)}
                        </span>
                        <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40 group-hover:text-primary" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>

        {/* 右：活动流 */}
        <section className="rounded-xl border border-border bg-card @4xl:col-span-2">
          <header className="border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold text-foreground">动态</h2>
          </header>
          {activity.length === 0 ? (
            <p className="px-4 py-8 text-center text-xs text-muted-foreground">暂无动态</p>
          ) : (
            <ul className="divide-y divide-border">
              {activity.map((a) => (
                <li key={a.id} className="px-4 py-2.5">
                  <p className="line-clamp-2 text-xs leading-relaxed text-foreground/85">{a.message}</p>
                  <p className="mt-1 text-[10px] text-muted-foreground">{timeAgo(a.createdAt)}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
};

export default DashboardPage;
