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
import WizardSettings from './WizardSettings';
import { loadGenDefaults } from '../Settings/GenerationSection';

const modeTabs: { key: CreationMode; label: string; icon: typeof Zap }[] = [
  { key: 'quick', label: '极速模式', icon: Zap },
  { key: 'script', label: '剧本模式', icon: FileText },
  { key: 'professional', label: '专业模式', icon: Sliders },
];

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

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {/* Header */}
      <div className="text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-primary via-orange-500 to-purple-500 text-white shadow-lg">
          <Wand2 className="h-7 w-7" />
        </div>
        <h1 className="mt-4 text-2xl font-bold text-foreground">一键创作</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          输入创意，AI 自动完成从剧本到成片的全流程
        </p>
      </div>

      {/* Mode tabs */}
      <div className="flex justify-center">
        <div className="inline-flex rounded-xl border bg-white p-1 shadow-sm">
          {modeTabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => handleModeChange(tab.key)}
              disabled={generating}
              className={`inline-flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-medium transition-all ${
                mode === tab.key
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-foreground/70 hover:text-foreground'
              }`}
            >
              <tab.icon className="h-4 w-4" />
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* 内容模式（通用/短剧/广告）：决定时长画幅默认值与后续技能/QC口径 */}
      <div className="flex justify-center">
        <div className="inline-flex items-center gap-1 rounded-xl border bg-white p-1 shadow-sm">
          <span className="px-2 text-xs text-muted-foreground">内容</span>
          {CONTENT_MODES.map((m) => (
            <button
              key={m.id}
              title={m.description}
              onClick={() => handleContentModeChange(m.id)}
              disabled={generating}
              className={`rounded-lg px-4 py-1.5 text-sm font-medium transition-all ${
                contentMode === m.id
                  ? 'bg-foreground text-background shadow-sm'
                  : 'text-foreground/70 hover:text-foreground'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {/* Stepper（连接线随进度着色，完成后打勾） */}
      <div className="flex items-center justify-center rounded-xl border bg-white px-5 py-3 shadow-sm">
        {steps.map((step, idx) => (
          <div key={step.num} className="flex items-center">
            <div className="flex items-center gap-2">
              <div
                className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold transition-colors ${
                  currentStep > step.num
                    ? 'bg-emerald-500 text-white'
                    : currentStep === step.num
                    ? 'bg-primary text-white shadow-sm shadow-primary/30'
                    : 'bg-muted text-muted-foreground'
                }`}
              >
                {currentStep > step.num ? <Check className="h-4 w-4" /> : step.num}
              </div>
              <span
                className={`text-sm ${
                  currentStep >= step.num
                    ? 'font-medium text-foreground'
                    : 'text-muted-foreground'
                }`}
              >
                {step.label}
              </span>
            </div>
            {idx < steps.length - 1 && (
              <div
                className={`mx-4 h-0.5 w-20 rounded-full transition-colors sm:w-32 ${
                  currentStep > step.num ? 'bg-emerald-400' : 'bg-border'
                }`}
              />
            )}
          </div>
        ))}
      </div>

      {error && !generating && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Generation progress view */}
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

      {/* Form views */}
      {!generating && (
        <>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* Main content */}
          <div className="space-y-6 lg:col-span-2">
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
          </div>

          {/* Right settings panel：参数分组卡片（WizardSettings 内部按时长/画幅/画风/导演分组） */}
          <div className="space-y-5">
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
          </div>
        </div>

        {/* 底部固定操作条：预估 / 无 Key 提示 / 生成，滚动到哪里都在手边 */}
        <div className="sticky bottom-4 z-30 mt-2">
          <div className="flex flex-col gap-3 rounded-2xl border bg-white/95 p-3 shadow-lg shadow-black/5 backdrop-blur sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1">
              {/* W2 生成前预估：本次约扣多少、对比市场省多少，下单前确定 */}
              {estimate ? (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                  <span className="font-medium">本次预估</span>
                  <span className="text-base font-bold">¥{estimate.total.toFixed(2)}</span>
                  <span className="text-emerald-700/80">
                    市场参考 ¥{estimate.marketTotal.toFixed(2)} · 省 ¥{estimate.saved.toFixed(2)}
                  </span>
                  <button
                    onClick={() => setEstimate(null)}
                    className="underline hover:text-emerald-900"
                  >
                    重新预估
                  </button>
                </div>
              ) : (
                <button
                  onClick={handleEstimate}
                  disabled={estimating || !canGenerate}
                  className="rounded-xl border border-primary/40 bg-primary/5 px-4 py-2 text-xs font-medium text-primary hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {estimating ? '预估中...' : '预估本次费用'}
                </button>
              )}
              {hasUsableProvider === false && (
                <button
                  onClick={() => navigate('/settings')}
                  className="mt-2 flex w-full items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-left text-xs text-amber-800 hover:bg-amber-100 sm:max-w-md"
                >
                  <span className="font-medium">尚未配置模型服务，任务将排队等待</span>
                  <span className="ml-auto shrink-0 underline">去配置</span>
                </button>
              )}
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              <button
                onClick={handleStartGenerate}
                disabled={!canGenerate}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-primary via-orange-500 to-purple-500 px-8 py-3 text-sm font-semibold text-white shadow-lg shadow-primary/20 transition-all hover:shadow-xl hover:shadow-primary/30 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
              >
                <Sparkles className="h-4 w-4" />
                {mode === 'script' ? '确认并生成' : '开始生成'}
              </button>
              <p className="hidden text-[11px] text-muted-foreground sm:block">
                剧本解析约数十秒；图片/视频按 Provider 排队执行
              </p>
            </div>
          </div>
        </div>
        </>
      )}
    </div>
  );
};

export default CreateWizardPage;
