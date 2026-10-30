import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ListTodo,
  PanelRightClose,
  Loader2,
  RotateCcw,
  Images,
  Activity,
  Film,
  Image as ImageIcon,
  Music,
  FileText,
  ArrowRight,
} from 'lucide-react';
import { generation, assets as assetsApi, dashboard as dashboardApi } from '@client/src/api';
import { mediaUrl } from '@client/src/api/assets';
import type { Asset, GenerationJob } from '@shared/api.interface';

/**
 * 三段式布局 · 右侧助手坞（Z Code 式 Agent 工作台常驻面板）。
 * 三个标签：任务（实时生成任务轮询）/ 资产（近期产出缩略网格）/ 动态（平台活动时间线）。
 * xl 以上屏幕默认展开，可通过顶栏按钮或坞内按钮收起；窄屏（<xl）不占布局。
 * 收起状态持久化到 localStorage，跨页面保持。AI 对话在独立「AI助手」页（/ai-assistant）。
 */

const JOB_TYPE_LABELS: Record<string, string> = {
  text: '文本',
  image: '图片',
  video: '视频',
  tts: '配音',
  voice: '配音',
};

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-amber-500/15 text-amber-400',
  running: 'bg-blue-500/15 text-blue-400',
  succeeded: 'bg-emerald-500/15 text-emerald-400',
  failed: 'bg-red-500/15 text-red-400',
  cancelled: 'bg-muted text-muted-foreground',
};

const STATUS_LABELS: Record<string, string> = {
  pending: '排队中',
  running: '生成中',
  succeeded: '已完成',
  failed: '失败',
  cancelled: '已取消',
};

const shortId = (id: string | undefined) => (id ? id.slice(0, 8) : '—');

const timeAgo = (iso: string) => {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return '刚刚';
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  return `${Math.floor(h / 24)} 天前`;
};

type DockTab = 'jobs' | 'assets' | 'activity';

const ASSET_TYPE_ICONS: Record<string, typeof ImageIcon> = {
  video: Film,
  image: ImageIcon,
  audio: Music,
  subtitle: FileText,
};

const RightDock = ({ onClose }: { onClose: () => void }) => {
  const navigate = useNavigate();
  const [tab, setTab] = useState<DockTab>('jobs');

  // ---- 任务动态 ----
  const [jobs, setJobs] = useState<GenerationJob[]>([]);
  const [jobsLoading, setJobsLoading] = useState(true);
  const [jobsError, setJobsError] = useState<string | null>(null);

  const loadJobs = useCallback(async () => {
    try {
      const res = await generation.listJobs({ page: 1, pageSize: 20 });
      setJobs(res.items ?? []);
      setJobsError(null);
    } catch (e) {
      setJobsError((e as Error).message);
    } finally {
      setJobsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab !== 'jobs') return;
    void loadJobs();
    const timer = setInterval(() => void loadJobs(), 5000);
    return () => clearInterval(timer);
  }, [tab, loadJobs]);

  // ---- 近期资产 ----
  const [recentAssets, setRecentAssets] = useState<Asset[]>([]);
  const [assetsLoading, setAssetsLoading] = useState(true);
  const [assetsError, setAssetsError] = useState<string | null>(null);

  const loadAssets = useCallback(async () => {
    try {
      const res = await assetsApi.listAssets({ page: 1, pageSize: 8 });
      setRecentAssets(res.items ?? []);
      setAssetsError(null);
    } catch (e) {
      setAssetsError((e as Error).message);
    } finally {
      setAssetsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab !== 'assets') return;
    void loadAssets();
  }, [tab, loadAssets]);

  // ---- 平台动态 ----
  const [activity, setActivity] = useState<
    { id: string; type: string; message: string; createdAt: string }[]
  >([]);
  const [activityLoading, setActivityLoading] = useState(true);
  const [activityError, setActivityError] = useState<string | null>(null);

  const loadActivity = useCallback(async () => {
    try {
      const res = await dashboardApi.getActivityFeed(15);
      setActivity(res ?? []);
      setActivityError(null);
    } catch (e) {
      setActivityError((e as Error).message);
    } finally {
      setActivityLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab !== 'activity') return;
    void loadActivity();
  }, [tab, loadActivity]);

  const tabBtn = (id: DockTab, label: string, Icon: typeof ListTodo) => (
    <button
      type="button"
      onClick={() => setTab(id)}
      className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium transition-colors ${
        tab === id
          ? 'bg-primary/10 text-primary'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground'
      }`}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  );

  return (
    <aside className="hidden h-full w-[320px] shrink-0 flex-col border-l border-sidebar-border bg-sidebar xl:flex">
      {/* 坞头 */}
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-sidebar-border px-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          助手坞
        </span>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="收起助手坞"
        >
          <PanelRightClose className="h-4 w-4" />
        </button>
      </div>

      {/* 标签切换：任务 / 资产 / 动态 */}
      <div className="flex shrink-0 gap-1 border-b border-sidebar-border p-2">
        {tabBtn('jobs', '任务', ListTodo)}
        {tabBtn('assets', '资产', Images)}
        {tabBtn('activity', '动态', Activity)}
      </div>

      {tab === 'jobs' && (
        <div className="flex-1 overflow-y-auto p-2.5">
          {jobsLoading && jobs.length === 0 ? (
            <div className="flex h-32 items-center justify-center text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
            </div>
          ) : jobsError ? (
            <div className="space-y-2 p-2 text-center text-xs text-muted-foreground">
              <p>任务列表加载失败：{jobsError}</p>
              <button
                type="button"
                onClick={() => void loadJobs()}
                className="inline-flex items-center gap-1 rounded-md border border-input px-2 py-1 hover:bg-muted"
              >
                <RotateCcw className="h-3 w-3" /> 重试
              </button>
            </div>
          ) : jobs.length === 0 ? (
            <div className="p-4 text-center text-xs text-muted-foreground">
              暂无生成任务。在项目工作台或画布里发起生成后，这里会实时展示进度。
            </div>
          ) : (
            <ul className="space-y-1.5">
              {jobs.map((job) => (
                <li key={job.id}>
                  <button
                    type="button"
                    onClick={() =>
                      job.projectId
                        ? navigate(`/project/${job.projectId}/tasks`)
                        : undefined
                    }
                    className="w-full rounded-lg border border-transparent bg-background px-2.5 py-2 text-left transition-colors hover:border-input hover:bg-muted/60"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-xs font-medium text-foreground">
                        {JOB_TYPE_LABELS[job.jobType] ?? job.jobType} · {shortId(job.id)}
                      </span>
                      <span
                        className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                          STATUS_STYLES[job.status] ?? 'bg-muted text-muted-foreground'
                        }`}
                      >
                        {STATUS_LABELS[job.status] ?? job.status}
                      </span>
                    </div>
                    {job.status === 'running' && (
                      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-primary transition-all"
                          style={{ width: `${Math.min(100, Math.max(2, job.progress || 2))}%` }}
                        />
                      </div>
                    )}
                    {job.status === 'failed' && job.errorMessage && (
                      <p className="mt-1 line-clamp-2 text-[10px] leading-snug text-red-3000">
                        {job.errorMessage}
                      </p>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === 'assets' && (
        <div className="flex-1 overflow-y-auto p-2.5">
          {assetsLoading && recentAssets.length === 0 ? (
            <div className="flex h-32 items-center justify-center text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
            </div>
          ) : assetsError ? (
            <div className="space-y-2 p-2 text-center text-xs text-muted-foreground">
              <p>资产加载失败：{assetsError}</p>
              <button
                type="button"
                onClick={() => void loadAssets()}
                className="inline-flex items-center gap-1 rounded-md border border-input px-2 py-1 hover:bg-muted"
              >
                <RotateCcw className="h-3 w-3" /> 重试
              </button>
            </div>
          ) : recentAssets.length === 0 ? (
            <div className="p-4 text-center text-xs text-muted-foreground">
              暂无资产。生成的图片、视频与音频会自动归档到这里。
            </div>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-1.5">
                {recentAssets.map((asset) => {
                  const TypeIcon = ASSET_TYPE_ICONS[asset.assetType] ?? FileText;
                  const thumb = asset.thumbnailUrl || mediaUrl(asset);
                  return (
                    <button
                      key={asset.id}
                      type="button"
                      onClick={() => navigate('/assets')}
                      title={asset.name}
                      className="group relative aspect-square overflow-hidden rounded-lg border border-border/70 bg-muted/40 transition-colors hover:border-primary/40"
                    >
                      {thumb ? (
                        <img
                          src={thumb}
                          alt={asset.name}
                          loading="lazy"
                          className="h-full w-full object-cover transition-transform group-hover:scale-105"
                          onError={(e) => {
                            e.currentTarget.style.display = 'none';
                          }}
                        />
                      ) : (
                        <span className="flex h-full w-full items-center justify-center bg-primary/5 text-primary/50">
                          <TypeIcon className="h-4 w-4" />
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              <button
                type="button"
                onClick={() => navigate('/assets')}
                className="mt-2.5 flex w-full items-center justify-center gap-1 rounded-lg border border-input bg-background py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
              >
                进入资产库 <ArrowRight className="h-3 w-3" />
              </button>
            </>
          )}
        </div>
      )}

      {tab === 'activity' && (
        <div className="flex-1 overflow-y-auto p-3">
          {activityLoading && activity.length === 0 ? (
            <div className="flex h-32 items-center justify-center text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
            </div>
          ) : activityError ? (
            <div className="space-y-2 text-center text-xs text-muted-foreground">
              <p>动态加载失败：{activityError}</p>
              <button
                type="button"
                onClick={() => void loadActivity()}
                className="inline-flex items-center gap-1 rounded-md border border-input px-2 py-1 hover:bg-muted"
              >
                <RotateCcw className="h-3 w-3" /> 重试
              </button>
            </div>
          ) : activity.length === 0 ? (
            <p className="py-8 text-center text-xs text-muted-foreground">暂无动态</p>
          ) : (
            <ol className="relative space-y-3 border-l border-border pl-4">
              {activity.map((a) => (
                <li key={a.id} className="relative">
                  <span className="absolute -left-[21px] top-1.5 h-1.5 w-1.5 rounded-full bg-primary/60 ring-2 ring-sidebar" />
                  <p className="line-clamp-3 text-xs leading-relaxed text-foreground/85">
                    {a.message}
                  </p>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">{timeAgo(a.createdAt)}</p>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </aside>
  );
};

export default RightDock;
