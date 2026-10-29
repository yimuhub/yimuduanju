import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  CheckCircle2,
  Circle,
  Film,
  FileText,
  Image as ImageIcon,
  Loader2,
  Mic,
  Play,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Users,
  Video,
  Wand2,
} from 'lucide-react';
import {
  bible as bibleApi,
  exportApi,
  projects as projectsApi,
  qc as qcApi,
  storyboard as storyboardApi,
} from '@client/src/api';
import type {
  Character,
  Project,
  QcReport,
  Scene,
  Shot,
} from '@shared/api.interface';
import { toast } from 'sonner';

/**
 * 一键成片独立流水线页（/project/:id/canvas-auto）
 * 解决原 /canvas-auto 与 /canvas 渲染同一 PavoCanvas 组件未拆分的问题，
 * 提供「剧本 → 角色圣经 → 分镜拆解 → 首帧图批量生成 → 视频批量生成 → 角色配音批量生成 → 质检 → 音画字幕一体合成 MP4」
 * 8 步可视化确认与一键全自动连跑能力。
 */
export default function CanvasAutoPage() {
  const { id: projectId } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [project, setProject] = useState<Project | null>(null);
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [shots, setShots] = useState<Shot[]>([]);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [latestQc, setLatestQc] = useState<QcReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [runningStage, setRunningStage] = useState<string | null>(null);
  const [assembledUrl, setAssembledUrl] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    if (!projectId) return;
    try {
      const [proj, scList, shList, chList, qcRep] = await Promise.all([
        projectsApi.getProject(projectId).catch(() => null),
        storyboardApi.listScenes(projectId).catch(() => []),
        storyboardApi.listAllShots(projectId).catch(() => []),
        bibleApi.listCharacters(projectId).catch(() => []),
        qcApi.getLatestReport(projectId).catch(() => null),
      ]);
      setProject(proj);
      setScenes(scList);
      setShots(shList);
      setCharacters(chList);
      setLatestQc(qcRep);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void loadAll();
    const timer = setInterval(() => {
      void loadAll();
    }, 5000);
    return () => clearInterval(timer);
  }, [loadAll]);

  const shotsWithImage = shots.filter((s) => Boolean(s.startFrameUrl)).length;
  const shotsWithVideo = shots.filter((s) => Boolean(s.videoUrl)).length;
  const dialogueShots = shots.filter((s) => Boolean(s.dialogue || s.subtitleText));
  const shotsWithVoice = shots.filter((s) => Boolean(s.voiceUrl)).length;

  /** 阶段 1：解析剧本拆解分镜 */
  const handleParseScript = async () => {
    if (!projectId || !project?.scriptText) {
      toast.error('请先在「剧本」页填写或生成剧本文本');
      return;
    }
    setRunningStage('storyboard');
    try {
      await storyboardApi.parseScript({
        projectId,
        scriptText: project.scriptText,
      });
      toast.success('剧本已解析并拆解分镜');
      await loadAll();
    } catch (e) {
      toast.error(`解析失败：${(e as Error).message}`);
    } finally {
      setRunningStage(null);
    }
  };

  /** 阶段 2：批量生成全部缺失的首帧关键帧 */
  const handleBatchImages = async () => {
    if (!projectId) return;
    setRunningStage('keyframes');
    try {
      const res = await storyboardApi.batchGenerate(projectId, { type: 'image' });
      toast.success(`已提交 ${res.jobIds?.length ?? 0} 个镜头首帧生成任务`);
      await loadAll();
    } catch (e) {
      toast.error(`批量生成首帧失败：${(e as Error).message}`);
    } finally {
      setRunningStage(null);
    }
  };

  /** 阶段 3：批量生成全部镜头视频 */
  const handleBatchVideos = async () => {
    if (!projectId) return;
    setRunningStage('videos');
    try {
      const res = await storyboardApi.batchGenerate(projectId, { type: 'video' });
      toast.success(`已提交 ${res.jobIds?.length ?? 0} 个镜头视频生成任务`);
      await loadAll();
    } catch (e) {
      toast.error(`批量生成视频失败：${(e as Error).message}`);
    } finally {
      setRunningStage(null);
    }
  };

  /** 阶段 4：批量生成全部角色配音 */
  const handleBatchVoices = async () => {
    if (!projectId) return;
    setRunningStage('voices');
    try {
      const res = await storyboardApi.batchGenerate(projectId, { type: 'voice' });
      toast.success(`已提交 ${res.jobIds?.length ?? 0} 个镜头配音任务（自动匹配角色专属音色）`);
      await loadAll();
    } catch (e) {
      toast.error(`批量生成配音失败：${(e as Error).message}`);
    } finally {
      setRunningStage(null);
    }
  };

  /** 阶段 5：执行成片规则质检 */
  const handleRunQc = async () => {
    if (!projectId) return;
    setRunningStage('qc');
    try {
      const rep = await qcApi.createReport(projectId);
      setLatestQc(rep);
      toast.success(`质检完成：综合得分 ${rep.overallScore} 分`);
    } catch (e) {
      toast.error(`质检失败：${(e as Error).message}`);
    } finally {
      setRunningStage(null);
    }
  };

  /** 阶段 6：一键合成带配音与字幕的最终 MP4 成片 */
  const handleAssembleMp4 = async () => {
    if (!projectId) return;
    setRunningStage('export');
    try {
      const res = await exportApi.assembleVideo(projectId);
      if (res.asset?.fileUrl) {
        setAssembledUrl(res.asset.fileUrl);
      }
      toast.success(`成片合成成功（共 ${res.clips} 个镜头，总长 ${res.durationSeconds}s）`);
      await loadAll();
    } catch (e) {
      toast.error(`成片合成失败：${(e as Error).message}`);
    } finally {
      setRunningStage(null);
    }
  };

  /** 一键全自动投递：同时将首帧、视频、配音全部排入后台队列 */
  const handleFullAutoEnqueue = async () => {
    if (!projectId) return;
    setRunningStage('auto_all');
    try {
      if (shots.length === 0 && project?.scriptText) {
        await storyboardApi.parseScript({
          projectId,
          scriptText: project.scriptText,
        });
      }
      const res = await Promise.all([
        storyboardApi.batchGenerate(projectId, { type: 'image' }),
        storyboardApi.batchGenerate(projectId, { type: 'video' }),
        storyboardApi.batchGenerate(projectId, { type: 'voice' }),
      ]);
      const jobCount = res.reduce((n, r) => n + (r.jobIds?.length ?? 0), 0);
      toast.success(`全自动流水线已启动：共投递 ${jobCount} 个生成任务至后台队列`);
      await loadAll();
    } catch (e) {
      toast.error(`全自动投递失败：${(e as Error).message}`);
    } finally {
      setRunningStage(null);
    }
  };

  const stages = [
    {
      id: 'script',
      step: 1,
      title: '剧本与创意定稿',
      icon: FileText,
      done: Boolean(project?.scriptText && project.scriptText.trim().length > 10),
      metric: project?.scriptText ? `${project.scriptText.length} 字` : '待编写剧本',
      desc: '一句话扩写或剧本精修，奠定全剧分场与台词基调',
      actionLabel: '编辑剧本',
      onAction: () => navigate(`/project/${projectId}/script`),
    },
    {
      id: 'bible',
      step: 2,
      title: '角色设定与音色锚定',
      icon: Users,
      done: characters.length > 0,
      metric: `${characters.length} 个角色`,
      desc: '锁定角色标准外貌描述、参考图与专属 TTS 配音音色',
      actionLabel: '管理角色',
      onAction: () => navigate(`/project/${projectId}/characters`),
    },
    {
      id: 'storyboard',
      step: 3,
      title: '分场与分镜故事板拆解',
      icon: Film,
      done: shots.length > 0,
      metric: `${scenes.length} 场 / ${shots.length} 镜`,
      desc: '自动拆解景别、机位、运镜与单镜时长',
      actionLabel: shots.length > 0 ? '查看分镜表' : '一键拆解分镜',
      onAction: shots.length > 0 ? () => navigate(`/project/${projectId}/storyboard`) : handleParseScript,
    },
    {
      id: 'keyframes',
      step: 4,
      title: '首帧关键帧批量生成',
      icon: ImageIcon,
      done: shots.length > 0 && shotsWithImage === shots.length,
      metric: `${shotsWithImage} / ${shots.length} 镜已生图`,
      desc: '自动注入角色参考图与画风提示词，生成全部镜头首帧',
      actionLabel: '批量生成首帧',
      onAction: handleBatchImages,
    },
    {
      id: 'videos',
      step: 5,
      title: '镜头动态视频批量生成',
      icon: Video,
      done: shots.length > 0 && shotsWithVideo === shots.length,
      metric: `${shotsWithVideo} / ${shots.length} 镜已生视频`,
      desc: '基于首帧/尾帧/白模参考生成动态视频片段',
      actionLabel: '批量生成视频',
      onAction: handleBatchVideos,
    },
    {
      id: 'voices',
      step: 6,
      title: '多角色台词配音生成',
      icon: Mic,
      done: dialogueShots.length > 0 ? shotsWithVoice >= dialogueShots.length : shotsWithVoice > 0,
      metric: `${shotsWithVoice} / ${dialogueShots.length || shots.length} 镜已配音`,
      desc: '按镜头绑定角色或台词前缀自动匹配专属音色生成 WAV 语音',
      actionLabel: '批量生成配音',
      onAction: handleBatchVoices,
    },
    {
      id: 'qc',
      step: 7,
      title: '工业级规则质检与修复',
      icon: ShieldCheck,
      done: Boolean(latestQc && latestQc.overallScore >= 80),
      metric: latestQc ? `${latestQc.overallScore} 分 (${latestQc.pass ? '通过' : '待优化'})` : '未质检',
      desc: '检测缺图/缺视频/对白超长/前 3 秒钩子/尾镜 CTA 与角色一致性',
      actionLabel: '立即执行质检',
      onAction: handleRunQc,
    },
    {
      id: 'export',
      step: 8,
      title: '音画字一体化成片合成',
      icon: Sparkles,
      done: Boolean(assembledUrl || project?.status === 'ready' || project?.status === 'exported'),
      metric: assembledUrl ? '已合成 MP4' : '待合成成片',
      desc: '服务端 FFmpeg 自动拼接镜头视频、混流角色配音并内嵌字幕轨',
      actionLabel: '一键合成 MP4 成片',
      onAction: handleAssembleMp4,
    },
  ];

  return (
    <div className="min-h-screen bg-[#F6F7F9] text-foreground">
      {/* Top Header */}
      <header className="sticky top-0 z-20 flex items-center justify-between border-b bg-white px-6 py-4 shadow-sm">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate(`/project/${projectId}`)}
            className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted/50 hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            返回工作台
          </button>
          <div>
            <div className="flex items-center gap-2">
              <span className="rounded-md bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
                一键成片流水线
              </span>
              <h1 className="text-base font-semibold text-foreground">
                {project?.title || '短剧项目'}
              </h1>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              从剧本、角色资产、分镜首帧、动态视频、多角色配音到音画字幕合成的 8 步工业化看板
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={() => void loadAll()}
            className="flex items-center gap-1.5 rounded-lg border bg-white px-3 py-2 text-xs font-medium text-foreground hover:bg-muted/40"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            刷新进度
          </button>
          <button
            onClick={() => navigate(`/project/${projectId}/canvas-free3`)}
            className="flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/5 px-3.5 py-2 text-xs font-medium text-primary hover:bg-primary/10"
          >
            切换至自由画布 3
          </button>
          <button
            onClick={handleFullAutoEnqueue}
            disabled={runningStage !== null}
            className="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-primary via-orange-500 to-purple-500 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:opacity-95 disabled:opacity-50"
          >
            {runningStage === 'auto_all' ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Wand2 className="h-3.5 w-3.5" />
            )}
            一键全自动投递全流程
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-6 p-6">
        {loading ? (
          <div className="flex items-center justify-center rounded-2xl border bg-white py-24 text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-5 w-5 animate-spin text-primary" />
            正在同步项目流水线状态...
          </div>
        ) : (
          <>
            {/* 8-Step Pipeline Grid */}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
              {stages.map((st) => {
                const Icon = st.icon;
                const isBusy = runningStage === st.id;
                return (
                  <div
                    key={st.id}
                    className={`flex flex-col justify-between rounded-2xl border bg-white p-5 shadow-sm transition-all ${
                      st.done ? 'border-emerald-200/80' : 'border-border'
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between">
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                          STEP {st.step}
                        </span>
                        {st.done ? (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600">
                            <CheckCircle2 className="h-4 w-4" />
                            已就绪
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs text-amber-600">
                            <Circle className="h-3.5 w-3.5" />
                            待推进
                          </span>
                        )}
                      </div>

                      <div className="mt-3 flex items-center gap-2.5">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                          <Icon className="h-5 w-5" />
                        </div>
                        <div>
                          <h3 className="text-sm font-semibold text-foreground">{st.title}</h3>
                          <p className="text-xs font-medium text-primary">{st.metric}</p>
                        </div>
                      </div>

                      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                        {st.desc}
                      </p>
                    </div>

                    <button
                      onClick={() => void st.onAction()}
                      disabled={isBusy}
                      className="mt-4 flex w-full items-center justify-center gap-1.5 rounded-xl border border-primary/30 bg-primary/5 py-2 text-xs font-semibold text-primary transition-colors hover:bg-primary hover:text-white disabled:opacity-50"
                    >
                      {isBusy ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Play className="h-3.5 w-3.5" />
                      )}
                      {st.actionLabel}
                    </button>
                  </div>
                );
              })}
            </div>

            {/* 成片预览或分镜矩阵预览 */}
            {assembledUrl && (
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50/50 p-5">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <h3 className="text-sm font-semibold text-emerald-900">
                      🎉 音画字幕一体化成片已生成就绪
                    </h3>
                    <p className="mt-1 text-xs text-emerald-700">
                      成片地址：{assembledUrl}（已归档至项目资产库，包含配音轨与内嵌字幕轨）
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <a
                      href={assembledUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700"
                    >
                      播放 / 下载成片 MP4
                    </a>
                    <button
                      onClick={() => navigate(`/project/${projectId}/export`)}
                      className="rounded-xl border border-emerald-300 bg-white px-4 py-2 text-xs font-semibold text-emerald-800 hover:bg-emerald-100"
                    >
                      导出剪映草稿与字幕包
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* 镜头矩阵实时状态一览 */}
            <div className="rounded-2xl border bg-white p-5 shadow-sm">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-foreground">
                    全片分镜生产矩阵（共 {shots.length} 镜）
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    实时显示每一镜的首帧图、动态视频与角色配音就绪状态，点击任意镜头可进入导演台精修
                  </p>
                </div>
                <button
                  onClick={() => navigate(`/project/${projectId}/director`)}
                  className="rounded-lg border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted/50"
                >
                  打开三栏导演台
                </button>
              </div>

              {shots.length === 0 ? (
                <div className="py-12 text-center text-xs text-muted-foreground">
                  暂无分镜数据，请先点击上方「STEP 3 · 一键拆解分镜」
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
                  {shots.map((sh) => (
                    <div
                      key={sh.id}
                      onClick={() => navigate(`/project/${projectId}/director`)}
                      className="cursor-pointer overflow-hidden rounded-xl border border-border/80 bg-muted/10 transition-shadow hover:shadow-md"
                    >
                      <div className="relative aspect-video bg-gray-900">
                        {sh.startFrameUrl ? (
                          <img
                            src={sh.startFrameUrl}
                            alt={`镜头 #${sh.shotNumber}`}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="flex h-full items-center justify-center text-xs text-gray-400">
                            待生成首帧
                          </div>
                        )}
                        <span className="absolute left-2 top-2 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-white">
                          镜 #{sh.shotNumber} · {sh.duration ?? 4}s
                        </span>
                      </div>
                      <div className="p-3">
                        <p className="line-clamp-2 text-xs text-foreground">
                          {sh.dialogue || sh.visualPrompt || '无描述'}
                        </p>
                        <div className="mt-2 flex items-center gap-1.5 text-[10px]">
                          <span
                            className={`rounded px-1.5 py-0.5 ${
                              sh.startFrameUrl
                                ? 'bg-emerald-50 text-emerald-600'
                                : 'bg-gray-100 text-gray-500'
                            }`}
                          >
                            {sh.startFrameUrl ? '首帧✓' : '缺首帧'}
                          </span>
                          <span
                            className={`rounded px-1.5 py-0.5 ${
                              sh.videoUrl
                                ? 'bg-blue-50 text-blue-600'
                                : 'bg-gray-100 text-gray-500'
                            }`}
                          >
                            {sh.videoUrl ? '视频✓' : '缺视频'}
                          </span>
                          <span
                            className={`rounded px-1.5 py-0.5 ${
                              sh.voiceUrl
                                ? 'bg-purple-50 text-purple-600'
                                : 'bg-gray-100 text-gray-500'
                            }`}
                          >
                            {sh.voiceUrl ? '配音✓' : '缺配音'}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
