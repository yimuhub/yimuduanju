import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Check,
  Clock,
  Users,
  Film,
  Clapperboard,
  FolderOpen,
  DollarSign,
  Play,
  RefreshCw,
  Download,
  Sparkles,
  BookOpen,
} from 'lucide-react';
import { projects, generation, bible, storyboard, assets, providers as providersApi } from '@client/src/api';
import type {
  Project,
  ContentMode,
  ProjectStatus,
  GenerationJob,
  Character,
  Scene,
  Shot,
  Asset,
  ModelProvider,
  SeriesLedger,
} from '@shared/api.interface';
import { CONTENT_MODES } from '@shared/content-modes';
import { logger } from '@client/src/utils/logger';

const STATUS_STEPS: { key: ProjectStatus; label: string }[] = [
  { key: 'draft', label: '草稿' },
  { key: 'parsing', label: '解析剧本' },
  { key: 'planning', label: '规划中' },
  { key: 'bible_ready', label: '圣经就绪' },
  { key: 'storyboard_ready', label: '分镜就绪' },
  { key: 'assets_generating', label: '资产生成' },
  { key: 'video_generating', label: '视频生成' },
  { key: 'audio_generating', label: '音频生成' },
  { key: 'editing', label: '剪辑中' },
  { key: 'qc', label: '质检中' },
  { key: 'ready', label: '已就绪' },
  { key: 'exported', label: '已导出' },
];

// 小白可读性：任务类型与状态展示中文，不再露出内部枚举
const JOB_TYPE_LABELS: Record<string, string> = {
  text: '文本',
  image: '首帧图',
  video: '视频',
  tts: '配音',
  parse_script: '剧本解析',
  script: '剧本生成',
  boards: '分镜表',
  qc: '质检',
  edit: '剪辑合成',
  storyboard: '故事板',
};
const JOB_STATUS_LABELS: Record<string, string> = {
  pending: '排队中',
  queued: '已入队',
  running: '生成中',
  succeeded: '已完成',
  failed: '失败',
  cancelled: '已取消',
  retrying: '重试中',
};

const ProjectOverviewTab = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [project, setProject] = useState<Project | null>(null);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [shots, setShots] = useState<Shot[]>([]);
  const [assetList, setAssetList] = useState<Asset[]>([]);
  const [jobs, setJobs] = useState<GenerationJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [enabledProviders, setEnabledProviders] = useState<ModelProvider[]>([]);

  useEffect(() => {
    providersApi
      .listProviders()
      .then((list) => setEnabledProviders(list.filter((p) => p.enabled)))
      .catch(() => {});
  }, []);

  const handleProviderOverride = async (providerName: string | null) => {
    if (!id) return;
    try {
      const updated = await projects.updateProject(id, {
        providerOverride: providerName ? { providerName } : null,
      } as never);
      setProject(updated);
    } catch (err) {
      logger.error('update provider override failed', String(err));
      setError('供应商覆盖设置失败');
    }
  };

  const handleContentMode = async (contentMode: ContentMode) => {
    if (!id) return;
    try {
      const updated = await projects.updateProject(id, { contentMode } as never);
      setProject(updated);
      setError(null);
    } catch (err) {
      logger.error('update content mode failed', String(err));
      setError('内容模式切换失败');
    }
  };

  useEffect(() => {
    if (!id) return;
    setLoading(true);

    Promise.allSettled([
      projects.getProject(id),
      bible.listCharacters(id),
      storyboard.listScenes(id),
      // P1 升级：取全量任务供费用构成聚合（展示仍取前 5）
      generation.listJobs({ projectId: id, pageSize: 100, page: 1 }),
      assets.listProjectAssets(id),
    ])
      .then(async (results) => {
        const [projRes, charRes, sceneRes, jobsRes, assetRes] = results;

        if (projRes.status === 'fulfilled') setProject(projRes.value);
        if (charRes.status === 'fulfilled') setCharacters(charRes.value);
        if (sceneRes.status === 'fulfilled') {
          setScenes(sceneRes.value);
          // P1 N+1 修复：一次取全量镜头（之前按场景逐个查询）
          try {
            const allShots = await storyboard.listAllShots(id);
            setShots(allShots);
          } catch {
            // ignore
          }
        }
        if (jobsRes.status === 'fulfilled') setJobs(jobsRes.value.items);
        if (assetRes.status === 'fulfilled') setAssetList(assetRes.value);
      })
      .catch((err) => {
        logger.error('Overview load error:', String(err));
        setError('加载数据失败');
      })
      .finally(() => setLoading(false));
  }, [id]);

  const currentStatus: ProjectStatus = project?.status || 'draft';
  const currentIdx = STATUS_STEPS.findIndex((s) => s.key === currentStatus);

  // P1 升级：单项目费用构成（按任务类型聚合；之前只有总数，不知道钱烧在哪）
  const costByType = useMemo(() => {
    const map = new Map<string, { count: number; cost: number }>();
    for (const job of jobs) {
      const entry = map.get(job.jobType) || { count: 0, cost: 0 };
      entry.count += 1;
      entry.cost += job.cost || 0;
      map.set(job.jobType, entry);
    }
    return [...map.entries()]
      .map(([jobType, v]) => ({ jobType, ...v }))
      .sort((a, b) => b.cost - a.cost);
  }, [jobs]);

  const stats = [
    { label: '人物数', value: characters.length, icon: Users, color: 'text-blue-500 bg-blue-50' },
    { label: '场景数', value: scenes.length, icon: Film, color: 'text-purple-500 bg-purple-50' },
    { label: '分镜数', value: shots.length, icon: Clapperboard, color: 'text-amber-500 bg-amber-50' },
    { label: '资产数', value: assetList.length, icon: FolderOpen, color: 'text-green-500 bg-green-50' },
    { label: '总费用', value: `¥${project?.totalCost?.toFixed(2) || '0.00'}`, icon: DollarSign, color: 'text-primary bg-primary/10' },
    { label: '预计时长', value: `${project?.durationSeconds || 0}s`, icon: Clock, color: 'text-indigo-500 bg-indigo-50' },
  ];

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-600">
          {error}
        </div>
      )}

      {/* Status timeline */}
      <div className="rounded-xl border bg-white p-6 shadow-sm">
        <h3 className="text-base font-semibold text-foreground">项目进度</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          当前阶段：{STATUS_STEPS[currentIdx]?.label || '草稿'}
        </p>
        <div className="mt-5 overflow-x-auto">
          <div className="flex min-w-full items-start gap-0 pb-2">
            {STATUS_STEPS.map((step, idx) => {
              const isCompleted = idx < currentIdx;
              const isCurrent = idx === currentIdx;
              return (
                <div
                  key={step.key}
                  className="flex min-w-0 flex-1 flex-col items-center"
                >
                  <div
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                      isCompleted
                        ? 'bg-primary text-white'
                        : isCurrent
                          ? 'bg-primary/10 text-primary ring-2 ring-primary/30'
                          : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    {isCompleted ? (
                      <Check className="h-4 w-4" />
                    ) : (
                      idx + 1
                    )}
                  </div>
                  <div className="mt-2 w-full text-center">
                    <div
                      className={`truncate text-xs font-medium ${
                        isCompleted || isCurrent
                          ? 'text-foreground'
                          : 'text-muted-foreground'
                      }`}
                    >
                      {step.label}
                    </div>
                  </div>
                  {/* connector line */}
                  {idx < STATUS_STEPS.length - 1 && (
                    <div className="relative -top-8 left-1/2 h-0.5 w-full translate-y-0">
                      <div className="absolute inset-0 bg-muted" />
                      {isCompleted && (
                        <div className="absolute inset-y-0 left-0 bg-primary" style={{ width: '100%' }} />
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className="rounded-xl border bg-white p-4 shadow-sm"
          >
            <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${stat.color}`}>
              <stat.icon className="h-5 w-5" />
            </div>
            <div className="mt-3 text-2xl font-semibold text-foreground">
              {stat.value}
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              {stat.label}
            </div>
          </div>
        ))}
      </div>

      {/* Quick actions + recent activity */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Quick actions */}
        <div className="rounded-xl border bg-white p-6 shadow-sm">
          <h3 className="text-base font-semibold text-foreground">快速操作</h3>
          <div className="mt-4 grid grid-cols-2 gap-3">
            {/* P1 修复：快捷操作之前全是死按钮；现分别跳到任务/剧本/分镜/导出页 */}
            <button
              onClick={() => navigate(`/project/${id}/tasks`)}
              className="flex flex-col items-center gap-2 rounded-lg border border-input bg-white p-3 text-xs font-medium text-foreground hover:border-primary hover:text-primary"
            >
              <Play className="h-5 w-5 text-primary" />
              继续生成
            </button>
            <button
              onClick={() => navigate(`/project/${id}/script`)}
              className="flex flex-col items-center gap-2 rounded-lg border border-input bg-white p-3 text-xs font-medium text-foreground hover:border-primary hover:text-primary"
            >
              <RefreshCw className="h-5 w-5 text-primary" />
              重新解析
            </button>
            <button
              onClick={() => navigate(`/project/${id}/storyboard`)}
              className="flex flex-col items-center gap-2 rounded-lg border border-input bg-white p-3 text-xs font-medium text-foreground hover:border-primary hover:text-primary"
            >
              <Sparkles className="h-5 w-5 text-primary" />
              批量生成
            </button>
            <button
              onClick={() => navigate(`/project/${id}/export`)}
              className="flex flex-col items-center gap-2 rounded-lg border border-input bg-white p-3 text-xs font-medium text-foreground hover:border-primary hover:text-primary"
            >
              <Download className="h-5 w-5 text-primary" />
              导出成片
            </button>
          </div>
        </div>

        {/* Recent jobs */}
        <div className="rounded-xl border bg-white p-6 shadow-sm lg:col-span-2">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-semibold text-foreground">最近活动</h3>
            <span className="text-xs text-muted-foreground">前 5 条</span>
          </div>
          {loading ? (
            <div className="mt-4 text-sm text-muted-foreground">加载中...</div>
          ) : jobs.length === 0 ? (
            <div className="mt-6 text-center text-sm text-muted-foreground">
              暂无生成任务
            </div>
          ) : (
            <div className="mt-4 space-y-2">
              {jobs.slice(0, 5).map((job) => (
                <div
                  key={job.id}
                  className="flex items-center justify-between rounded-lg border border-border/60 bg-muted/20 p-3"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-foreground">
                      {JOB_TYPE_LABELS[job.jobType] || job.jobType}
                      <span className="ml-2 text-xs font-normal text-muted-foreground">
                        {job.errorMessage ? job.errorMessage.slice(0, 40) : `任务 ${job.id.slice(0, 8)}`}
                      </span>
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {job.modelName || '默认模型'} · 费用 ¥{job.cost?.toFixed(2) || '0.00'}
                    </div>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${
                      job.status === 'succeeded'
                        ? 'bg-green-50 text-green-600'
                        : job.status === 'running'
                          ? 'bg-blue-50 text-blue-600'
                          : job.status === 'failed'
                            ? 'bg-red-50 text-red-600'
                            : 'bg-gray-100 text-gray-600'
                    }`}
                  >
                    {JOB_STATUS_LABELS[job.status] || job.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Series ledger */}
      <SeriesLedgerCard
        project={project}
        characters={characters}
        scenes={scenes}
        onSaved={setProject}
        onError={setError}
      />

      {/* Cost breakdown */}
      <div className="rounded-xl border bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-foreground">费用构成</h3>
          <span className="text-sm text-muted-foreground">
            累计 <span className="font-semibold text-foreground">¥{project?.totalCost?.toFixed(2) || '0.00'}</span>
          </span>
        </div>
        {costByType.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">暂无消费，生成任务成功后此处展示各环节花费</p>
        ) : (
          <div className="mt-4 space-y-2">
            {costByType.map((item) => {
              const max = costByType[0]?.cost || 1;
              return (
                <div key={item.jobType} className="flex items-center gap-3 text-sm">
                  <span className="w-20 shrink-0 text-muted-foreground">{JOB_TYPE_LABELS[item.jobType] || item.jobType}</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-primary to-[#FF7A3A]"
                      style={{ width: `${Math.max(4, (item.cost / max) * 100)}%` }}
                    />
                  </div>
                  <span className="w-16 shrink-0 text-right text-muted-foreground">{item.count} 次</span>
                  <span className="w-20 shrink-0 text-right font-medium text-foreground">
                    ¥{item.cost.toFixed(2)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Content mode */}
      <div className="rounded-xl border bg-white p-6 shadow-sm">
        <h3 className="text-base font-semibold text-foreground">内容模式</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          短剧走钩子前置口径，广告片走 Hook+PAS+CTA 口径；切换只影响默认值与质检建议，不锁死流程
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {CONTENT_MODES.map((m) => (
            <button
              key={m.id}
              title={m.description}
              onClick={() => handleContentMode(m.id)}
              className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                (project?.contentMode ?? 'general') === m.id
                  ? 'bg-primary text-primary-foreground'
                  : 'border border-input bg-white text-foreground/70 hover:border-primary hover:text-primary'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {/* Provider override */}
      <div className="rounded-xl border bg-white p-6 shadow-sm">
        <h3 className="text-base font-semibold text-foreground">本项目供应商</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          覆盖全局默认，仅本项目任务走指定通道；清空则跟随全局（含官方直供）
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <select
            value={project?.providerOverride?.providerName ?? ''}
            onChange={(e) => handleProviderOverride(e.target.value || null)}
            className="h-10 min-w-[220px] rounded-xl border border-input bg-white px-3 text-sm outline-none focus:border-primary"
          >
            <option value="">跟随全局默认</option>
            {enabledProviders.map((p) => (
              <option key={p.id} value={p.name}>
                {p.name}
              </option>
            ))}
          </select>
          {project?.providerOverride?.providerName && (
            <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
              已覆盖：{project.providerOverride.providerName}
            </span>
          )}
        </div>
      </div>

      {/* Project info */}
      <div className="rounded-xl border bg-white p-6 shadow-sm">
        <h3 className="text-base font-semibold text-foreground">项目信息</h3>        <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-4">
          <div>
            <div className="text-xs text-muted-foreground">项目模式</div>
            <div className="mt-1 text-sm font-medium text-foreground">
              {project?.mode || '-'}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">艺术风格</div>
            <div className="mt-1 text-sm font-medium text-foreground">
              {project?.artStyle || '-'}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">画面比例</div>
            <div className="mt-1 text-sm font-medium text-foreground">
              {project?.aspectRatio || '-'}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">创建时间</div>
            <div className="mt-1 text-sm font-medium text-foreground">
              {project ? new Date(project.createdAt).toLocaleDateString('zh-CN') : '-'}
            </div>
          </div>
          <div className="col-span-2 md:col-span-4">
            <div className="text-xs text-muted-foreground">项目描述</div>
            <div className="mt-1 text-sm text-foreground">
              {project?.description || '暂无描述'}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProjectOverviewTab;

/**
 * P2-1 系列记忆账本卡：人物/场景实时派生（不存快照），不可逆事实人工维护，
 * 存 metadata.series。做连续短剧/多集时，人物关系与状态不再靠人脑记。
 */
const SeriesLedgerCard = ({
  project,
  characters,
  scenes,
  onSaved,
  onError,
}: {
  project: Project | null;
  characters: Character[];
  scenes: Scene[];
  onSaved: (p: Project) => void;
  onError: (msg: string | null) => void;
}) => {
  const ledger = (project?.metadata as unknown as { series?: SeriesLedger } | undefined)?.series;
  const [factsText, setFactsText] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const shown = factsText ?? (ledger?.facts ?? []).join('\n');

  const save = async () => {
    if (!project) return;
    setSaving(true);
    try {
      const facts = shown.split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 50);
      const updated = await projects.updateProject(project.id, {
        metadata: {
          ...((project.metadata ?? {}) as object),
          series: { facts, updatedAt: new Date().toISOString() },
        },
      } as never);
      onSaved(updated);
      setFactsText(null);
      onError(null);
    } catch (e) {
      logger.error('save series ledger failed', String(e));
      onError('系列记忆保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl border bg-white p-6 shadow-sm">
      <div className="flex items-center gap-2">
        <BookOpen className="h-4 w-4 text-primary" />
        <h3 className="text-base font-semibold text-foreground">系列记忆</h3>
        <span className="text-xs text-muted-foreground">
          {characters.length} 人物 · {scenes.length} 场景（自动汇总）
        </span>
      </div>
      {characters.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {characters.map((c) => (
            <span
              key={c.id}
              title={c.canonicalDescription || c.name}
              className="rounded-full bg-muted px-2.5 py-1 text-xs text-foreground/80"
            >
              {c.name}
            </span>
          ))}
        </div>
      )}
      <p className="mt-3 text-xs text-muted-foreground">
        不可逆事实（每行一条：伤势/死亡/关系变化/关键道具归属），跨集不再漂移
      </p>
      <textarea
        value={shown}
        onChange={(e) => setFactsText(e.target.value)}
        placeholder="如：第3集阿强右腿受伤；第5集项链给了小美"
        rows={3}
        className="mt-2 w-full resize-y rounded-lg border border-input bg-white p-3 text-sm outline-none placeholder:text-muted-foreground/60 focus:border-primary"
      />
      <div className="mt-2 flex items-center gap-2">
        <button
          onClick={save}
          disabled={saving || !project}
          className="rounded-lg bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {saving ? '保存中…' : '保存记忆'}
        </button>
        {ledger?.updatedAt && (
          <span className="text-[10px] text-muted-foreground">
            更新于 {new Date(ledger.updatedAt).toLocaleString('zh-CN')}
          </span>
        )}
      </div>
    </div>
  );
};
