import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowUpRight, Clapperboard, Coins, Film, FolderKanban, Images,
  Loader2, Send, Sparkles, Clock,
} from 'lucide-react';
import { dashboard as dashboardApi, generation as generationApi } from '@client/src/api';
import type { DashboardStats, GenerationJob, ProjectListItem } from '@shared/api.interface';

/**
 * 数据看板（3.0 生产力工作台版）：
 * 取代旧营销式 hero 页——信息密度优先，全部真实数据：
 * KPI 行 / 生成任务（实时进度）/ 最近项目（行式）/ 活动流，5s 静默刷新。
 */

const JOB_LABELS: Record<string, string> = { text: '文本', image: '图片', video: '视频', tts: '配音', parse_script: '剧本解析', script: '剧本' };
const JOB_STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: '排队', cls: 'bg-amber-500/15 text-amber-400' },
  running: { label: '生成中', cls: 'bg-blue-500/15 text-blue-400' },
  succeeded: { label: '完成', cls: 'bg-emerald-500/15 text-emerald-400' },
  failed: { label: '失败', cls: 'bg-red-500/15 text-red-400' },
  cancelled: { label: '取消', cls: 'bg-muted text-muted-foreground' },
};
const PROJECT_STATUS: Record<string, { label: string; cls: string }> = {
  draft: { label: '草稿', cls: 'bg-muted text-muted-foreground' },
  script_ready: { label: '剧本就绪', cls: 'bg-sky-500/15 text-sky-400' },
  assets_generating: { label: '资产生成中', cls: 'bg-blue-500/15 text-blue-400' },
  storyboard_ready: { label: '分镜就绪', cls: 'bg-indigo-500/15 text-indigo-400' },
  rendering: { label: '成片中', cls: 'bg-violet-500/15 text-violet-400' },
  completed: { label: '已完成', cls: 'bg-emerald-500/15 text-emerald-400' },
  failed: { label: '失败', cls: 'bg-red-500/15 text-red-400' },
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
  const [quickPrompt, setQuickPrompt] = useState('');
  const [loading, setLoading] = useState(true);
  // 问候语使用本地昵称（与账户页 yimu.account.nickname 保持一致），默认「一幕用户」
  const [nickname] = useState(() => localStorage.getItem('yimu.account.nickname') || '一幕用户');

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

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 5000);
    return () => clearInterval(t);
  }, [load]);

  const kpis = [
    { label: '项目总数', value: stats?.totalProjects ?? 0, icon: FolderKanban, cls: 'bg-sky-500/15 text-sky-400' },
    { label: '生成镜头', value: stats?.totalShots ?? 0, icon: Film, cls: 'bg-violet-500/15 text-violet-400' },
    { label: '产出资产', value: stats?.totalAssets ?? 0, icon: Images, cls: 'bg-emerald-500/15 text-emerald-400' },
    { label: '累计费用', value: `¥${(stats?.totalCost ?? 0).toFixed(2)}`, icon: Coins, cls: 'bg-amber-500/15 text-amber-400' },
  ];

  const runningJobs = jobs.filter((j) => j.status === 'running' || j.status === 'pending');
  const activeJobs = runningJobs.length > 0 ? runningJobs : jobs.slice(0, 6);

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      {/* 顶栏：问候 + 快速开拍条（生产力导向，无营销横幅） */}
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
        <div className="flex w-full max-w-md items-center gap-2 rounded-xl border border-input bg-card p-1.5 pl-3.5 shadow-sm focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20">
          <Sparkles className="h-4 w-4 shrink-0 text-primary" />
          <input
            value={quickPrompt}
            onChange={(e) => setQuickPrompt(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && quickPrompt.trim()) navigate('/'); }}
            onFocus={() => navigate('/')}
            placeholder="一句话开拍，回车进入创作作战室…"
            className="h-8 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <button
            onClick={() => navigate('/')}
            className="btn-gradient flex h-8 shrink-0 items-center gap-1 rounded-lg px-3 text-xs font-semibold"
          >
            开拍 <Send className="h-3 w-3" />
          </button>
        </div>
      </div>

      {/* KPI 行 */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
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

      <div className="grid gap-4 lg:grid-cols-5">
        {/* 左：生成任务 + 最近项目 */}
        <div className="space-y-4 lg:col-span-3">
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
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${st.cls}`}>{st.label}</span>
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
                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${st.cls}`}>{st.label}</span>
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
        <section className="rounded-xl border border-border bg-card lg:col-span-2">
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
