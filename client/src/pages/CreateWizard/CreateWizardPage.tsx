import { useEffect, useState, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Wand2,
  Sparkles,
  Zap,
  FileText,
  Sliders,
  Check,
  Upload,
  Loader2,
  ChevronRight,
  ChevronLeft,
} from 'lucide-react';
import { projects, providers as providersApi, storyboard, templates as templatesApi, billing as billingApi, generation as generationApi } from '@client/src/api';
import type {
  CreationMode,
  ContentMode,
  BudgetMode,
  ArtStyle,
  AspectRatio,
  StoryGenreInfo,
  ProjectProgressResponse,
  ProjectStatus,
  CostEstimateResponse,
} from '@shared/api.interface';
import { CONTENT_MODES, contentModeById } from '@shared/content-modes';
import { toast } from 'sonner';
import GenerationProgressView from './GenerationProgressView';
import WizardSettings, { budgetOptions, styleOptions } from './WizardSettings';
import TriPane from '@client/src/components/TriPane';
import { loadGenDefaults } from '../Settings/GenerationSection';

const modeTabs: { key: CreationMode; label: string; icon: typeof Zap }[] = [
  { key: 'quick', label: '极速模式', icon: Zap },
  { key: 'script', label: '剧本模式', icon: FileText },
  { key: 'professional', label: '专业模式', icon: Sliders },
];

// 时长展示：整分钟显示「N 分钟」，否则显示秒
const fmtDuration = (s: number) => (s % 60 === 0 ? `${s / 60} 分钟` : `${s} 秒`);

// 右栏摘要行
const SummaryRow = ({ label, value }: { label: string; value: string }) => (
  <div className="flex items-center justify-between gap-3 text-xs">
    <span className="shrink-0 text-muted-foreground">{label}</span>
    <span className="truncate text-right font-medium text-foreground">{value}</span>
  </div>
);

const CreateWizardPage = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const urlMode = (searchParams.get('mode') as CreationMode) || 'quick';

  const [mode, setMode] = useState<CreationMode>(urlMode);
  const [currentStep, setCurrentStep] = useState(1);
  const [prompt, setPrompt] = useState('');
  // P1 修复：读取生成设置的本机默认值（之前设置页存了也白存）
  const [duration, setDuration] = useState(90);
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('9:16');
  const [artStyle, setArtStyle] = useState<ArtStyle>('realistic');
  const [budgetMode, setBudgetMode] = useState<BudgetMode>('balanced');
  const [shotDuration, setShotDuration] = useState(4);
  const [subtitleEnabled, setSubtitleEnabled] = useState(true);
  // 剧本技能总开关：一句话扩写 / 小说改编是否做吸引力改造（默认开）
  const [expandScript, setExpandScript] = useState(true);
  // 双模式：内容模式（通用/短剧/广告），切换时带入时长与画幅默认值（用户可再改）
  const [contentMode, setContentMode] = useState<ContentMode>('general');
  // S2 题材（ToonFlow story_skills 移植）：风格定长相，题材定写法，透传给扩写技能
  const [genreId, setGenreId] = useState<string | undefined>(undefined);
  const [genreOptions, setGenreOptions] = useState<StoryGenreInfo[]>([]);
  useEffect(() => {
    storyboard.listStorySkills()
      .then((res) => setGenreOptions(res.genres ?? []))
      .catch(() => {});
  }, []);
  const handleContentModeChange = (m: ContentMode) => {
    setContentMode(m);
    const meta = contentModeById(m);
    setDuration(meta.defaultDurationSeconds);
    setAspectRatio(meta.defaultAspectRatio as AspectRatio);
  };

  useEffect(() => {
    const d = loadGenDefaults();
    setAspectRatio((d.aspectRatio as AspectRatio) || '9:16');
    setArtStyle((d.artStyle as ArtStyle) || 'realistic');
    setBudgetMode((d.budgetMode as BudgetMode) || 'balanced');
    if (d.shotDuration) setShotDuration(d.shotDuration);
    setSubtitleEnabled(d.subtitleEnabled !== false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [scriptText, setScriptText] = useState('');
  const [parseResult, setParseResult] = useState<{ charactersCount: number; scenesCount: number } | null>(null);
  const [parsing, setParsing] = useState(false);
  // 剧本技能：小说改编 / 深度改写（跑完回填 textarea 待确认再解析）
  const [skillRunning, setSkillRunning] = useState<null | 'novel' | 'rewrite'>(null);
  const [skillError, setSkillError] = useState('');

  const pollSkillJob = async (projectId: string, jobId: string): Promise<void> => {
    const deadline = Date.now() + 180000;
    for (;;) {
      if (Date.now() > deadline) throw new Error('技能执行超时，请稍后在任务页查看');
      await new Promise((r) => setTimeout(r, 2500));
      const job = await generationApi.getJob(jobId);
      if (job.status === 'succeeded') return;
      if (job.status === 'failed' || job.status === 'cancelled') {
        throw new Error(job.errorMessage || '技能执行失败');
      }
    }
  };

  const ensureScriptProject = async (): Promise<string> => {
    if (projectId) return projectId;
    const project = await projects.createProject({
      title: scriptText.slice(0, 20) || '剧本项目',
      mode: 'script',
      scriptText,
    });
    setProjectId(project.id);
    return project.id;
  };

  const handleAdaptNovel = async () => {
    if (!scriptText.trim() || skillRunning) return;
    setSkillRunning('novel');
    setSkillError('');
    try {
      const pid = await ensureScriptProject();
      const { jobId } = await storyboard.adaptNovel(pid, {
        novelText: scriptText,
        styleId: artStyle,
        rewriteEnabled: expandScript,
      });
      await pollSkillJob(pid, jobId);
      const updated = await projects.getProject(pid);
      if (updated.scriptText) setScriptText(updated.scriptText);
      setParseResult(null);
      toast.success('小说已转写为剧本，请确认后点解析预览');
    } catch (err) {
      setSkillError(err instanceof Error ? err.message : '转写失败');
    } finally {
      setSkillRunning(null);
    }
  };

  const handleRewriteSkill = async () => {
    if (!scriptText.trim() || skillRunning) return;
    setSkillRunning('rewrite');
    setSkillError('');
    try {
      const pid = await ensureScriptProject();
      const { jobId } = await storyboard.rewriteScript(pid, {
        scriptText,
        styleId: artStyle,
      });
      await pollSkillJob(pid, jobId);
      const updated = await projects.getProject(pid);
      if (updated.scriptText) setScriptText(updated.scriptText);
      setParseResult(null);
      toast.success('剧本已深度改造，请确认后点解析预览');
    } catch (err) {
      setSkillError(err instanceof Error ? err.message : '改写失败');
    } finally {
      setSkillRunning(null);
    }
  };

  // Generation state
  const [generating, setGenerating] = useState(false);
  const [projectId, setProjectId] = useState<string>('');
  const [progress, setProgress] = useState<ProjectProgressResponse | null>(null);
  const [error, setError] = useState<string>('');

  // W2 生成前预估（抄 Opus credit 预估：下单前明确本次约扣多少、省多少）
  const [estimate, setEstimate] = useState<CostEstimateResponse | null>(null);
  const [estimating, setEstimating] = useState(false);
  const handleEstimate = async () => {
    setEstimating(true);
    try {
      // 按专业参数估算镜头数；极速/剧本模式按片长估算
      const shots =
        mode === 'professional'
          ? Math.max(1, Math.min(120, Math.floor(shotCount)))
          : Math.max(4, Math.min(60, Math.round(duration / 4)));
      const tier =
        budgetMode === 'quality_first'
          ? 'flagship'
          : budgetMode === 'cost_first'
            ? 'budget'
            : 'balanced';
      const res = await billingApi.estimateCost({
        tier,
        counts: {
          // 一句话扩写开时会先跑一次剧本技能任务
          ...(mode === 'script' ? {} : expandScript ? { script: 1 } : { parse_script: 1 }),
          image: shots,
          video: shots,
          ...(subtitleEnabled ? { tts: shots } : {}),
        },
      });
      setEstimate(res);
    } catch {
      toast.error('费用预估失败，请稍后重试');
    } finally {
      setEstimating(false);
    }
  };

  // Professional mode params
  const [shotCount, setShotCount] = useState(20);
  const [shotSizePref, setShotSizePref] = useState('mixed');
  const [cameraStyle, setCameraStyle] = useState('dynamic');
  const [voicePreset, setVoicePreset] = useState('warm_female');

  // P1 Key 门禁：无可用 Provider（已启用且配 Key）时提示去配置，不阻塞输入；
  // 无 Key 时任务保持 pending 等待配置，配置后消费器自动执行
  const [hasUsableProvider, setHasUsableProvider] = useState<boolean | null>(null);
  useEffect(() => {
    providersApi
      .listProviders()
      .then((list) =>
        setHasUsableProvider(list.some((p) => p.enabled && p.hasApiKey)),
      )
      .catch(() => setHasUsableProvider(false));
  }, []);

  // P1 模板套用：?templateId= 预填参数（之前该参数无人消费，模板“使用”按钮形同虚设）
  const templateId = searchParams.get('templateId');
  useEffect(() => {
    if (!templateId) return;
    templatesApi
      .getTemplate(templateId)
      .then((tpl) => {
        if (tpl.durationSeconds) setDuration(tpl.durationSeconds);
        if (tpl.aspectRatio) setAspectRatio(tpl.aspectRatio);
        if (tpl.artStyle) setArtStyle(tpl.artStyle as ArtStyle);
        if (tpl.genre) setPrompt((p) => p || `${tpl.genre}短剧：${tpl.description || tpl.name}`);
        const cfg = tpl.config;
        if (cfg) {
          if (cfg.shotCount) setShotCount(cfg.shotCount);
          if (cfg.shotDuration) setShotDuration(cfg.shotDuration);
          if (cfg.shotSizes?.length) {
            const first = cfg.shotSizes[0];
            setShotSizePref(
              first.includes('近') || first.includes('特写') || first.toLowerCase().includes('close')
                ? 'closeup'
                : first.includes('远') || first.includes('全') || first.toLowerCase().includes('wide')
                  ? 'wide'
                  : 'mixed',
            );
          }
          if (cfg.cameraMovements?.length) {
            const first = cfg.cameraMovements[0];
            setCameraStyle(
              first.includes('静') || first.toLowerCase().includes('static')
                ? 'static'
                : first.includes('推') || first.includes('拉')
                  ? 'cinematic'
                  : 'dynamic',
            );
          }
          if (cfg.voicePreset) setVoicePreset(cfg.voicePreset);
          if (cfg.subtitleEnabled !== undefined) setSubtitleEnabled(cfg.subtitleEnabled);
          setMode('professional');
        }
        toast.success(`已套用模板「${tpl.name}」，请确认参数后生成`);
      })
      .catch(() => toast.error('模板加载失败，请手动设置参数'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateId]);
  useEffect(() => {
    providersApi
      .listProviders()
      .then((list) =>
        setHasUsableProvider(list.some((p) => p.enabled && p.hasApiKey)),
      )
      .catch(() => setHasUsableProvider(false));
  }, []);

  useEffect(() => {
    if (urlMode && modeTabs.some((t) => t.key === urlMode)) {
      setMode(urlMode);
    }
  }, [urlMode]);

  // Poll progress
  useEffect(() => {
    if (!generating || !projectId) return;

    let timer: ReturnType<typeof setTimeout>;
    let cancelled = false;
    // P1 修复：组件卸载后不再 setState/navigate（之前成功分支的 800ms 跳转未清理）
    const poll = async () => {
      try {
        const data = await projects.getProgress(projectId);
        if (cancelled) return;
        setProgress(data);

        // 分镜就绪即可进工作台：极速模式物化后若死等 ready/exported，进度会永远停在
        // 「分镜故事板」（后续图/视频在工作台可见）
        const enterable: ProjectStatus[] = [
          'storyboard_ready',
          'assets_generating',
          'video_generating',
          'audio_generating',
          'editing',
          'qc',
          'ready',
          'exported',
        ];
        if (enterable.includes(data.overallStatus)) {
          setGenerating(false);
          setTimeout(() => {
            if (!cancelled) navigate(`/project/${projectId}`);
          }, 800);
          return;
        }
        if (data.overallStatus === 'failed') {
          setGenerating(false);
          setError('生成失败，请重试');
          return;
        }
      } catch {
        // ignore poll errors, continue
      }
      if (!cancelled) timer = setTimeout(poll, 2000);
    };

    timer = setTimeout(poll, 2000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [generating, projectId, navigate]);

  const handleModeChange = (newMode: CreationMode) => {
    setMode(newMode);
    setCurrentStep(1);
  };

  const canGenerate = useMemo(() => {
    if (mode === 'quick') return prompt.trim().length > 0;
    if (mode === 'script') return scriptText.trim().length > 0 && parseResult !== null;
    if (mode === 'professional') return prompt.trim().length > 0;
    return false;
  }, [mode, prompt, scriptText, parseResult]);

  const handleParseScript = async () => {
    if (!scriptText.trim()) return;
    try {
      setParsing(true);
      setError('');
      const project = await projects.createProject({
        title: scriptText.slice(0, 20) || '剧本项目',
        mode: 'script',
        scriptText,
      });
      const result = await storyboard.parseScript({
        scriptText,
        projectId: project.id,
      });
      setParseResult({
        charactersCount: result.charactersCount,
        scenesCount: result.scenesCount,
      });
      setProjectId(project.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : '解析失败');
    } finally {
      setParsing(false);
    }
  };

  const handleStartGenerate = async () => {
    if (!canGenerate) return;
    try {
      setError('');
      setGenerating(true);
      setCurrentStep(3);

      if (mode === 'quick') {
        const res = await projects.quickCreate({
          prompt,
          durationSeconds: duration,
          aspectRatio,
          artStyle,
          budgetMode,
          expandScript,
          contentMode,
          genreId,
        });
        setProjectId(res.projectId);
      } else if (mode === 'script' && projectId) {
        // Project already created during parsing, trigger generation flow
        // For now we just show progress on the existing project
        setProjectId(projectId);
      } else if (mode === 'professional') {
        // P1 专业模式透传：之前 6 个导演参数被丢弃，现经 quickCreate 存入项目并由物化消费
        const res = await projects.quickCreate({
          prompt,
          durationSeconds: duration,
          aspectRatio,
          artStyle,
          budgetMode,
          expandScript,
          mode: 'professional',
          contentMode,
          genreId,
          professional: {
            shotCount,
            shotDuration,
            shotSizePref,
            cameraStyle,
            voicePreset,
            subtitleEnabled,
          },
        });
        setProjectId(res.projectId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建失败');
      setGenerating(false);
    }
  };

  const steps = [
    { num: 1, label: '输入创意' },
    { num: 2, label: '参数设置' },
    { num: 3, label: '生成中' },
  ];

  const getModeIcon = () => {
    if (mode === 'quick') return { icon: Sparkles, gradient: 'from-red-500 to-orange-500', title: '一句话描述你想做的短剧' };
    if (mode === 'script') return { icon: FileText, gradient: 'from-blue-500 to-indigo-500', title: '粘贴或输入剧本内容' };
    return { icon: Sliders, gradient: 'from-purple-500 to-pink-500', title: '创意描述' };
  };

  const modeConfig = getModeIcon();

  // ---- TriPane Agent 工作台派生值（纯展示，不改业务逻辑） ----
  // 展示用步骤：生成中固定第 3 步；失败/完成后回到可编辑步骤（不改 currentStep 状态）
  const activeStep = generating ? 3 : Math.min(currentStep, 2);
  const modeMeta = modeTabs.find((t) => t.key === mode);
  const artStyleLabel = styleOptions.find((o) => o.value === artStyle)?.label ?? artStyle;
  const budgetLabel = budgetOptions.find((o) => o.value === budgetMode)?.label ?? budgetMode;
  // 步骤门禁：第 1 步可点回退；第 2 步需输入通过校验（与 canGenerate 同口径）；第 3 步仅随生成进入
  const canJumpToStep = (n: number) => !generating && (n === 1 || (n === 2 && canGenerate));

  // ---- 左栏：三模式选择 + 步骤 1-2-3 指示器（当前步高亮、可点回退） ----
  const stepNav = (
    <div className="flex h-full min-h-0 flex-col gap-6 overflow-y-auto p-4">
      {/* 品牌头 */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-gradient text-white shadow-md">
          <Wand2 className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <div className="text-sm font-bold text-foreground">一键创作</div>
          <div className="truncate text-[11px] text-muted-foreground">AI 全流程创作工作台</div>
        </div>
      </div>

      {/* 创作模式（原顶部 Mode tabs 移入左栏） */}
      <div>
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">创作模式</div>
        <div className="space-y-1.5">
          {modeTabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => handleModeChange(tab.key)}
              disabled={generating}
              className={`flex w-full items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left text-sm font-medium transition-all disabled:cursor-not-allowed disabled:opacity-60 ${
                mode === tab.key
                  ? 'border-primary/40 bg-primary/10 text-primary shadow-sm'
                  : 'border-border bg-white text-foreground/70 hover:border-primary/30 hover:text-foreground'
              }`}
            >
              <tab.icon className="h-4 w-4 shrink-0" />
              {tab.label}
              {mode === tab.key && <Check className="ml-auto h-3.5 w-3.5 shrink-0" />}
            </button>
          ))}
        </div>
      </div>

      {/* 步骤指示器（原 Stepper 移入左栏；当前步高亮，已完成步可点回退） */}
      <div>
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">创作步骤</div>
        <div className="space-y-1">
          {steps.map((step) => {
            const done = activeStep > step.num;
            const current = activeStep === step.num;
            const clickable = canJumpToStep(step.num) && !current;
            return (
              <button
                key={step.num}
                onClick={() => clickable && setCurrentStep(step.num)}
                disabled={!clickable}
                title={clickable ? `回到「${step.label}」` : undefined}
                className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm transition-all ${
                  current
                    ? 'border border-primary/40 bg-primary/10 font-semibold text-primary shadow-sm'
                    : done
                      ? 'text-foreground/70 hover:bg-muted'
                      : 'cursor-default text-muted-foreground/60'
                }`}
              >
                <span
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${
                    done
                      ? 'bg-emerald-500 text-white'
                      : current
                        ? 'bg-brand-gradient text-white'
                        : 'bg-muted text-muted-foreground'
                  }`}
                >
                  {done ? <Check className="h-3.5 w-3.5" /> : step.num}
                </span>
                {step.label}
              </button>
            );
          })}
        </div>
      </div>

      <p className="mt-auto rounded-xl bg-muted/50 px-3 py-2.5 text-[11px] leading-relaxed text-muted-foreground">
        左侧切模式与步骤，中间填写内容，右侧实时摘要确认后一键开拍。
      </p>
    </div>
  );

  // ---- 中栏：当前步骤的表单内容（全部逻辑/状态/校验复用，仅重排位置） ----
  const centerContent = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex-1 space-y-4 overflow-y-auto p-4 sm:p-5">
        {error && !generating && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* Generation progress view（步骤 3：生成中） */}
        {generating && progress && (
          <GenerationProgressView
            steps={progress.steps}
            currentStep={progress.currentStep}
            overallProgress={progress.overallProgress}
            currentMessage={
              progress.steps.find((s) => s.status === 'running')?.message
            }
          />
        )}

        {generating && !progress && (
          <div className="flex flex-col items-center justify-center rounded-xl border bg-white p-16 shadow-sm">
            <Loader2 className="h-10 w-10 animate-spin text-primary" />
            <p className="mt-4 text-sm text-muted-foreground">正在创建项目...</p>
          </div>
        )}

        {/* 步骤 1：输入创意 */}
        {!generating && activeStep === 1 && (
          <>
          {/* 内容模式（通用/短剧/广告）：决定时长画幅默认值与后续技能/QC口径 */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">内容类型</span>
            {CONTENT_MODES.map((m) => (
              <button
                key={m.id}
                title={m.description}
                onClick={() => handleContentModeChange(m.id)}
                disabled={generating}
                className={`rounded-lg px-4 py-1.5 text-sm font-medium transition-all ${
                  contentMode === m.id
                    ? 'bg-foreground text-background shadow-sm'
                    : 'border border-border bg-white text-foreground/70 hover:text-foreground'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
          <div className="rounded-xl border bg-white p-6 shadow-sm">
              <div className="mb-4 flex items-center gap-2">
                <div className={`flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br ${modeConfig.gradient} text-white`}>
                  <modeConfig.icon className="h-4 w-4" />
                </div>
                <label className="text-base font-semibold text-foreground">
                  {modeConfig.title}
                </label>
              </div>

              {mode === 'script' ? (
                <>
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <button
                      onClick={handleAdaptNovel}
                      disabled={!scriptText.trim() || skillRunning !== null}
                      title="把粘贴的小说原文压缩改编为短剧剧本（钩子前置、悬念结尾）"
                      className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {skillRunning === 'novel' ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Sparkles className="h-4 w-4" />
                      )}
                      {skillRunning === 'novel' ? '转写中...' : '小说转剧本'}
                    </button>
                    <button
                      onClick={handleRewriteSkill}
                      disabled={!scriptText.trim() || skillRunning !== null}
                      title="对当前剧本做一次深度改造（钩子前置、节拍加密），原意保留"
                      className="inline-flex items-center gap-2 rounded-lg border border-primary bg-primary/5 px-4 py-2 text-sm font-medium text-primary transition-colors hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {skillRunning === 'rewrite' ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Wand2 className="h-4 w-4" />
                      )}
                      {skillRunning === 'rewrite' ? '改写中...' : '深度改写'}
                    </button>
                    <label className="ml-auto flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={expandScript}
                        onChange={(e) => setExpandScript(e.target.checked)}
                        className="h-4 w-4 accent-primary"
                      />
                      改写增强（关则忠实转换）
                    </label>
                  </div>
                  {skillError && (
                    <div className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                      {skillError}
                    </div>
                  )}
                  <textarea
                    value={scriptText}
                    onChange={(e) => {
                      setScriptText(e.target.value);
                      setParseResult(null);
                    }}
                    placeholder="在此粘贴你的剧本内容（TXT / MD 格式）...&#10;&#10;支持：场景描述、人物对话、动作说明等。AI 将自动解析人物、场景、分镜。"
                    className="h-64 w-full resize-none rounded-xl border border-input bg-muted/30 p-4 text-sm outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20"
                  />
                  <div className="mt-3 flex items-center justify-between">
                    <div className="text-xs text-muted-foreground">
                      {scriptText.length} 字
                    </div>
                    <button
                      onClick={handleParseScript}
                      disabled={!scriptText.trim() || parsing}
                      className="inline-flex items-center gap-2 rounded-lg border border-primary bg-primary/5 px-4 py-2 text-sm font-medium text-primary transition-colors hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {parsing ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Upload className="h-4 w-4" />
                      )}
                      解析预览
                    </button>
                  </div>
                  {parseResult && (
                    <div className="mt-4 flex gap-4 rounded-lg bg-emerald-50 p-4">
                      <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white">
                        <Check className="h-4 w-4" />
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-medium text-emerald-800">
                          剧本解析完成
                        </p>
                        <p className="mt-1 text-xs text-emerald-700">
                          识别到 {parseResult.charactersCount} 个角色，
                          {parseResult.scenesCount} 个场景
                        </p>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <>
                  <textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder={
                      mode === 'quick'
                        ? '如：做一部 90 秒、国风、悬疑、女主复仇短剧...'
                        : '详细描述你的短剧创意、故事梗概、人物设定...'
                    }
                    className={`w-full resize-none rounded-xl border border-input bg-muted/30 p-4 text-sm outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20 ${
                      mode === 'professional' ? 'h-32' : 'h-40'
                    }`}
                  />
                  <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                    <span>建议输入 20-200 字</span>
                    <span>{prompt.length} 字</span>
                  </div>
                </>
              )}
            </div>

            {/* 步骤 1 底部导航：创意校验通过后进入参数设置 */}
            <div className="flex flex-wrap items-center justify-end gap-3">
              <span className="text-xs text-muted-foreground">
                {mode === 'script'
                  ? parseResult
                    ? '剧本已解析，可继续设置参数'
                    : '粘贴剧本并完成「解析预览」后继续'
                  : canGenerate
                    ? '创意就绪，继续设置参数'
                    : '输入创意后继续'}
              </span>
              <button
                onClick={() => setCurrentStep(2)}
                disabled={!canGenerate}
                className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm transition-all hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                下一步：参数设置
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </>
        )}

        {/* 步骤 2：参数设置（WizardSettings 全量复用，按时长/画幅/画风/导演分组） */}
        {!generating && activeStep === 2 && (
          <>
            <WizardSettings
              duration={duration}
              setDuration={setDuration}
              aspectRatio={aspectRatio}
              setAspectRatio={setAspectRatio}
              artStyle={artStyle}
              setArtStyle={setArtStyle}
              budgetMode={budgetMode}
              setBudgetMode={setBudgetMode}
              isProfessional={mode === 'professional'}
              shotCount={shotCount}
              setShotCount={setShotCount}
              shotDuration={shotDuration}
              setShotDuration={setShotDuration}
              shotSizePref={shotSizePref}
              setShotSizePref={setShotSizePref}
              cameraStyle={cameraStyle}
              setCameraStyle={setCameraStyle}
              voicePreset={voicePreset}
              setVoicePreset={setVoicePreset}
              subtitleEnabled={subtitleEnabled}
              setSubtitleEnabled={setSubtitleEnabled}
              showSkillToggle={mode === 'quick' || mode === 'professional'}
              expandScript={expandScript}
              setExpandScript={setExpandScript}
              genres={genreOptions}
              genreId={genreId}
              setGenreId={setGenreId}
            />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <button
                onClick={() => setCurrentStep(1)}
                className="inline-flex items-center gap-1.5 rounded-xl border border-input bg-white px-4 py-2 text-sm font-medium text-foreground/70 transition-colors hover:bg-muted"
              >
                <ChevronLeft className="h-4 w-4" />
                上一步：修改创意
              </button>
              <span className="text-xs text-muted-foreground">确认参数后，点右栏「开始生成」开拍 →</span>
            </div>
          </>
        )}
      </div>
    </div>
  );

  // ---- 右栏：实时摘要面板（已选参数卡 + 费用预估 + 常驻生成按钮） ----
  const summaryPanel = (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto p-4">
      <div className="mb-3 flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-primary" />
        <span className="text-sm font-semibold text-foreground">实时摘要</span>
      </div>

      {/* 已选参数卡 */}
      <div className="rounded-xl border bg-white p-4 shadow-sm">
        <div className="mb-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">已选参数</div>
        <div className="space-y-2">
          <SummaryRow label="模式" value={modeMeta?.label ?? mode} />
          <SummaryRow label="内容" value={contentModeById(contentMode).label} />
          <SummaryRow label="时长" value={fmtDuration(duration)} />
          <SummaryRow label="画幅" value={aspectRatio} />
          <SummaryRow label="画风" value={artStyleLabel} />
          <SummaryRow label="预算" value={budgetLabel} />
          {mode === 'professional' && (
            <SummaryRow label="分镜" value={`${shotCount} 个 · 每镜 ${shotDuration} 秒`} />
          )}
        </div>
      </div>

      {/* W2 费用预估：本次约扣多少、对比市场省多少（原底部操作条移入右栏常驻） */}
      <div className="mt-3">
        {estimate ? (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-emerald-800">本次预估</span>
              <button
                onClick={() => setEstimate(null)}
                className="text-[11px] text-emerald-700 underline hover:text-emerald-900"
              >
                重新预估
              </button>
            </div>
            <div className="mt-1 text-xl font-bold text-emerald-900">¥{estimate.total.toFixed(2)}</div>
            <p className="mt-0.5 text-[11px] text-emerald-700/80">
              市场参考 ¥{estimate.marketTotal.toFixed(2)} · 省 ¥{estimate.saved.toFixed(2)}
            </p>
          </div>
        ) : (
          <button
            onClick={handleEstimate}
            disabled={estimating || !canGenerate}
            className="w-full rounded-xl border border-primary/40 bg-primary/5 px-4 py-2.5 text-xs font-medium text-primary hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {estimating ? '预估中...' : '预估本次费用'}
          </button>
        )}
      </div>

      {/* 常驻操作区（钉底）：无 Key 提示 + 生成按钮 */}
      <div className="mt-auto space-y-2 pt-4">
        {hasUsableProvider === false && (
          <button
            onClick={() => navigate('/settings')}
            className="flex w-full items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-left text-[11px] text-amber-800 hover:bg-amber-100"
          >
            <span className="font-medium">尚未配置模型服务，任务将排队等待</span>
            <span className="ml-auto shrink-0 underline">去配置</span>
          </button>
        )}
        <button
          onClick={handleStartGenerate}
          disabled={!canGenerate || generating}
          className="btn-brand flex w-full items-center justify-center gap-2 rounded-xl px-6 py-3 text-sm font-semibold shadow-lg"
        >
          {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {generating ? '生成中...' : mode === 'script' ? '确认并生成' : '开始生成'}
        </button>
        <p className="text-center text-[11px] leading-relaxed text-muted-foreground">
          剧本解析约数十秒；图片/视频按 Provider 排队执行
        </p>
      </div>
    </div>
  );

  return (
    <TriPane
      className="mx-auto max-w-[1500px]"
      leftKey="createwizard.left"
      rightKey="createwizard.right"
      defaultLeftWidth={250}
      maxLeftWidth={360}
      left={stepNav}
      center={centerContent}
      right={summaryPanel}
    />
  );
};

export default CreateWizardPage;
