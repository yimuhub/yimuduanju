import { useEffect, useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Grid3X3,
  List,
  Sparkles,
  Play,
  RefreshCw,
  Lock,
  Trash2,
  ChevronUp,
  ChevronDown,
  Filter,
  Mic,
  Clapperboard,
  History,
  RotateCcw,
  AlertTriangle,
  Captions,
  ShieldCheck,
} from 'lucide-react';
import { storyboard, assets, projects } from '@client/src/api';
import type { Shot, Scene, Segment, Asset, BlockedVideoSummary } from '@shared/api.interface';
import type { ProjectDiagnosis } from '@shared/artifact-state';
import { logger } from '@client/src/utils/logger';
import { showConfirm } from '@client/src/components/ui/confirm';
import { toast } from 'sonner';
import { MediaOrMissing } from '@client/src/components/MediaOrMissing';

// 状态胶囊：统一 .pill 5 色板（见 tailwind-theme.css）
const statusConfig: Record<string, { label: string; className: string }> = {
  draft: { label: '草稿', className: 'pill-neutral' },
  queued: { label: '排队中', className: 'pill-wait' },
  pending: { label: '等待中', className: 'pill-neutral' },
  generating: { label: '生成中', className: 'pill-run' },
  running: { label: '生成中', className: 'pill-run' },
  ready: { label: '已就绪', className: 'pill-ok' },
  completed: { label: '已完成', className: 'pill-ok' },
  succeeded: { label: '已完成', className: 'pill-ok' },
  failed: { label: '失败', className: 'pill-fail' },
};

const getStatusInfo = (status: string) =>
  statusConfig[status] || { label: status, className: 'pill-neutral' };

const shotSizeLabels: Record<string, string> = {
  close_up: '特写',
  close_up_shot: '特写',
  medium_close_up: '近景',
  medium_shot: '中景',
  medium_long_shot: '全景',
  long_shot: '远景',
  wide_shot: '全景',
  extreme_close_up: '大特写',
  over_the_shoulder: '过肩',
};

const ProjectStoryboardTab = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  // 画布「在工作台打开」深链：/storyboard?shot=<id> 自动展开并定位该镜头（画布 ↔ 工作台双向打通）
  const [searchParams] = useSearchParams();
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [shots, setShots] = useState<Shot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedScene, setSelectedScene] = useState<string>('all');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [batching, setBatching] = useState(false);
  const [regeneratingIds, setRegeneratingIds] = useState<Set<string>>(new Set());
  // P2 修复（方案断点7）：提示词编辑搬进行卡片展开区——改 prompt 与重跑单镜同处完成
  const [promptDrafts, setPromptDrafts] = useState<Record<string, string>>({});
  const [savingPromptIds, setSavingPromptIds] = useState<Set<string>>(new Set());
  // 镜头历史版本：同镜多次生成的产物链，支持回退到旧版（解决主成片被覆盖不可回退）
  const [historyMap, setHistoryMap] = useState<Record<string, Asset[]>>({});
  const [historyLoading, setHistoryLoading] = useState<Set<string>>(new Set());
  const [revertingIds, setRevertingIds] = useState<Set<string>>(new Set());
  // 首帧受阻汇总：哪些镜头的视频因首帧未就绪被暂停，以及是否已有在途首帧任务
  const [blocked, setBlocked] = useState<BlockedVideoSummary | null>(null);
  const [recovering, setRecovering] = useState(false);
  // 画面字幕：默认关（字幕后期统一添加）；存 projects.metadata.videoSubtitles，
  // 只影响保存之后提交的视频任务，已生成/已排队的任务不回溯。
  const [videoSubtitles, setVideoSubtitles] = useState(false);
  const [subtitlePrefSaving, setSubtitlePrefSaving] = useState(false);
  // 片段（场 → 片段 → 镜）与一致性体检：把「哪里不连贯」在分镜阶段就摆出来
  const [segments, setSegments] = useState<Segment[]>([]);
  const [diagnosis, setDiagnosis] = useState<ProjectDiagnosis | null>(null);
  const [rebuildingSegments, setRebuildingSegments] = useState(false);

  const handleRebuildSegments = async () => {
    if (!id || rebuildingSegments) return;
    setRebuildingSegments(true);
    try {
      const r = await storyboard.rebuildSegments(id);
      toast.success(`已按规则归段：${r.segments} 段 / ${r.shots} 镜`, { duration: 2400 });
      await refreshDiagnosis();
    } catch (err) {
      logger.error('Rebuild segments failed:', String(err));
      toast.error('重建片段失败');
    } finally {
      setRebuildingSegments(false);
    }
  };

  const refreshDiagnosis = async () => {
    if (!id) return;
    try {
      const [d, segs] = await Promise.all([
        storyboard.getConsistency(id),
        storyboard.listSegments(id),
      ]);
      setDiagnosis(d);
      setSegments(segs);
    } catch (err) {
      // 体检是辅助信息，失败不挡住分镜主流程
      logger.error('Load consistency failed:', String(err));
    }
  };

  const toggleVideoSubtitles = async () => {
    if (!id || subtitlePrefSaving) return;
    const next = !videoSubtitles;
    setSubtitlePrefSaving(true);
    try {
      // 先取最新 metadata 再合并，避免覆盖期间流水线确认门等并发写入
      const fresh = await projects.getProject(id);
      const baseMeta = (fresh.metadata ?? {}) as Record<string, unknown>;
      await projects.updateProject(id, {
        metadata: { ...baseMeta, videoSubtitles: next },
      } as never);
      setVideoSubtitles(next);
      toast.success(
        next ? '已开启画面内字幕：之后提交的视频会生成字幕' : '已关闭画面内字幕：之后提交的视频保持干净，字幕后期添加',
        { duration: 2400 },
      );
    } catch (err) {
      logger.error('Save video subtitle pref failed:', String(err));
      toast.error('画面字幕设置保存失败');
    } finally {
      setSubtitlePrefSaving(false);
    }
  };

  const loadHistory = async (shot: Shot) => {
    setHistoryLoading((prev) => new Set(prev).add(shot.id));
    try {
      const video = await assets.listShotHistory(shot.id, 'video').catch(() => [] as Asset[]);
      const image = await assets.listShotHistory(shot.id, 'image').catch(() => [] as Asset[]);
      setHistoryMap((prev) => ({ ...prev, [shot.id]: [...video, ...image] }));
    } catch (err) {
      logger.error('Load shot history failed:', String(err));
      setHistoryMap((prev) => ({ ...prev, [shot.id]: [] }));
    } finally {
      setHistoryLoading((prev) => {
        const next = new Set(prev);
        next.delete(shot.id);
        return next;
      });
    }
  };

  const revertTo = async (shot: Shot, asset: Asset) => {
    if (!id) return;
    const assetType = asset.assetType === 'image' ? 'image' : 'video';
    setRevertingIds((prev) => new Set(prev).add(asset.id));
    try {
      await assets.revertShotAsset(shot.id, asset.id, assetType);
      // 回退后本地产物引用即时更新，避免用户刷新才看到变化
      setShots((prev) =>
        prev.map((s) => {
          if (s.id !== shot.id) return s;
          return assetType === 'image'
            ? { ...s, startFrameUrl: asset.fileUrl }
            : { ...s, videoUrl: asset.fileUrl, status: 'ready' };
        }),
      );
      toast.success(`已回退到 ${assetType === 'image' ? '首帧' : '成片'} v${asset.version ?? 1}`);
    } catch (err) {
      logger.error('Revert shot asset failed:', String(err));
      toast.error('回退失败');
    } finally {
      setRevertingIds((prev) => {
        const next = new Set(prev);
        next.delete(asset.id);
        return next;
      });
    }
  };

  const handleSavePrompt = async (shot: Shot, rerun?: 'image') => {
    if (!id) return;
    const draft = promptDrafts[shot.id];
    if (draft === undefined) return;
    setSavingPromptIds((prev) => new Set(prev).add(shot.id));
    try {
      await storyboard.updateShot(id, shot.id, { visualPrompt: draft });
      setShots((prev) =>
        prev.map((s) => (s.id === shot.id ? { ...s, visualPrompt: draft } : s)),
      );
      setPromptDrafts((prev) => {
        const next = { ...prev };
        delete next[shot.id];
        return next;
      });
      if (rerun === 'image') {
        await storyboard.rerunShot(id, shot.id, { type: 'image' });
        toast.success('提示词已保存，已重跑该镜首帧');
      } else {
        toast.success('提示词已保存');
      }
    } catch (err) {
      logger.error('Save prompt failed:', String(err));
      toast.error('提示词保存失败');
    } finally {
      setSavingPromptIds((prev) => {
        const next = new Set(prev);
        next.delete(shot.id);
        return next;
      });
    }
  };

  // P1 配音闭环：试听 + 不满意重配（之前配音只有 URL 存着，无处可听）
  const handleVoice = async (shot: Shot) => {
    if (!id) return;
    setRegeneratingIds((prev) => new Set(prev).add(shot.id));
    try {
      await storyboard.generateShotVoiceAt(id, shot.id);
      toast.success('配音任务已发起，可在任务页查看进度');
    } catch (err) {
      logger.error('Voice failed:', String(err));
      setError('配音发起失败');
    } finally {
      setTimeout(() => {
        setRegeneratingIds((prev) => {
          const next = new Set(prev);
          next.delete(shot.id);
          return next;
        });
      }, 2000);
    }
  };
  const handleBatchGenerate = async () => {
    if (!id || shots.length === 0 || batching) return;
    if (!await showConfirm(`将为全部 ${shots.length} 个镜头创建图片生成任务，继续吗？`)) return;
    setBatching(true);
    try {
      await storyboard.batchGenerate(id, { type: 'image' });
      navigate(`/project/${id}/tasks`);
    } catch (err) {
      logger.error('Batch generate failed:', String(err));
      setError('批量生成发起失败');
    } finally {
      setBatching(false);
    }
  };

  const handleOneClick = async () => {
    if (!id || shots.length === 0 || batching) return;
    if (!await showConfirm(`一键成片：先批量生成全部 ${shots.length} 镜首帧图，再批量生成视频（图优先认领），继续吗？`)) return;
    setBatching(true);
    try {
      const res = await storyboard.oneClickGenerate(id, {});
      navigate(`/project/${id}/tasks`);
    } catch (err) {
      logger.error('One-click generate failed:', String(err));
      setError('一键成片发起失败');
    } finally {
      setBatching(false);
    }
  };

  // 首帧受阻恢复：把「视频为什么不动」变成可操作入口，而不是让用户猜
  const refreshBlocked = async () => {
    if (!id) return;
    try {
      setBlocked(await storyboard.listBlockedVideos(id));
    } catch (err) {
      logger.error('Load blocked videos failed:', String(err));
    }
  };

  const handleRecoverBlocked = async () => {
    if (!id || recovering) return;
    setRecovering(true);
    try {
      const res = await storyboard.recoverBlockedVideos(id);
      if (res.retried > 0) {
        toast.success(
          `已为 ${res.retried} 个镜头重新生成首帧${res.skipped > 0 ? `，${res.skipped} 个已在排队中` : ''}${res.failed > 0 ? `，${res.failed} 个发起失败` : ''}`,
        );
      } else if (res.skipped > 0) {
        toast.info('这些镜头的首帧已在生成中，请等待完成');
      } else {
        toast.info('没有需要恢复的镜头');
      }
      await refreshBlocked();
    } catch (err) {
      logger.error('Recover blocked videos failed:', String(err));
      toast.error('恢复失败');
    } finally {
      setRecovering(false);
    }
  };

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    void refreshBlocked();
    void refreshDiagnosis();
    // 画面字幕开关：读项目 metadata（旧项目无字段 = 默认关）
    projects.getProject(id)
      .then((p) => {
        const meta = (p.metadata ?? {}) as {
          videoSubtitles?: boolean;
          professional?: { videoSubtitles?: boolean };
        };
        setVideoSubtitles(meta.videoSubtitles === true || meta.professional?.videoSubtitles === true);
      })
      .catch((err) => logger.error('Load project subtitle pref failed:', String(err)));
    storyboard.listScenes(id)
      .then(async (sceneData) => {
        setScenes(sceneData);
        // P1 N+1 修复：一次取全量镜头（之前按场景逐个查询）
        try {
          const allShots = await storyboard.listAllShots(id);
          setShots(allShots.sort((a, b) => a.shotNumber - b.shotNumber));
          // 画布深链 ?shot=<id>：展开并滚动定位到该镜头
          const targetShot = searchParams.get('shot');
          if (targetShot && allShots.some((s) => s.id === targetShot)) {
            setExpandedId(targetShot);
            setTimeout(() => {
              document.getElementById(`shot-card-${targetShot}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }, 300);
          }
        } catch {
          // skip
        }
      })
      .catch((err) => {
        logger.error('Failed to load storyboard:', String(err));
        setError('加载分镜失败');
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const filteredShots = selectedScene === 'all'
    ? shots
    : shots.filter((s) => s.sceneId === selectedScene);
  // 受阻镜头查找表：卡片上直接标出「视频已暂停」，避免用户只看到「失败」不知道原因
  const blockedByShot = new Map((blocked?.items ?? []).map((i) => [i.shotId, i]));

  const handleRerun = async (shot: Shot, type: 'image' | 'video') => {
    if (!id) return;
    setRegeneratingIds((prev) => new Set(prev).add(shot.id));
    try {
      // P1 断链修复：rerun 签名已改为 (projectId, shotId, {type})
      await storyboard.rerunShot(id, shot.id, { type });
      // 重跑首帧可能解除视频阻断，刷新面板块状态
      void refreshBlocked();
    } catch (err) {
      logger.error('Rerun failed:', String(err));
      setError('重生成失败');
    } finally {
      setTimeout(() => {
        setRegeneratingIds((prev) => {
          const next = new Set(prev);
          next.delete(shot.id);
          return next;
        });
      }, 2000);
    }
  };

  const handleMove = async (index: number, direction: 'up' | 'down') => {
    if (!id) return;
    if (direction === 'up' && index === 0) return;
    if (direction === 'down' && index === filteredShots.length - 1) return;
    const newShots = [...filteredShots];
    const targetIdx = direction === 'up' ? index - 1 : index + 1;
    const a = newShots[index];
    const b = newShots[targetIdx];
    // P1 修复：排序持久化到后端（交换 shotNumber；之前只改本地，刷新即丢）
    try {
      await storyboard.updateShot(id, a.id, { shotNumber: b.shotNumber });
      await storyboard.updateShot(id, b.id, { shotNumber: a.shotNumber });
      setShots((prev) =>
        prev
          .map((s) =>
            s.id === a.id ? { ...s, shotNumber: b.shotNumber }
            : s.id === b.id ? { ...s, shotNumber: a.shotNumber }
            : s,
          )
          .sort((x, y) => x.shotNumber - y.shotNumber),
      );
    } catch (err) {
      logger.error('Move shot failed:', String(err));
      setError('调整顺序失败');
    }
  };

  const handleDelete = async (shotId: string) => {
    if (!id) return;
    if (!await showConfirm('确定删除这个分镜吗？')) return;
    // P1 修复：删除落库（之前只删本地，刷新即恢复）
    try {
      await storyboard.deleteShot(id, shotId);
      setShots((prev) => prev.filter((s) => s.id !== shotId));
      toast.success('已删除');
    } catch (err) {
      logger.error('Delete shot failed:', String(err));
      setError('删除失败');
    }
  };

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/15 p-4 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground">分镜故事板</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            共 {shots.length} 个分镜 · {segments.length} 个片段 · {scenes.length} 个场景
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <select
              value={selectedScene}
              onChange={(e) => setSelectedScene(e.target.value)}
              className="h-9 rounded-lg border border-input bg-card px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
            >
              <option value="all">全部场景</option>
              {scenes.map((scene) => (
                <option key={scene.id} value={scene.id}>
                  场景 {scene.sceneNumber}：{scene.title || scene.summary?.slice(0, 15) || scene.id.slice(0, 8)}
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={toggleVideoSubtitles}
            disabled={subtitlePrefSaving}
            title={
              videoSubtitles
                ? '当前开启：模型会在画面内生成字幕，后期字幕可能叠加'
                : '默认关闭：模型不生成画面字幕/文字，字幕由后期统一添加'
            }
            aria-pressed={videoSubtitles}
            className={`flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm transition-colors disabled:opacity-60 ${
              videoSubtitles
                ? 'border-primary bg-primary/5 text-primary'
                : 'border-input bg-card text-muted-foreground hover:text-foreground'
            }`}
          >
            <Captions className="h-4 w-4" />
            画面字幕 · {videoSubtitles ? '开' : '关'}
          </button>

          <div className="flex items-center rounded-lg border border-input bg-card p-0.5">
            <button
              onClick={() => setViewMode('grid')}
              className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors ${
                viewMode === 'grid' ? 'bg-primary/10 text-primary' : 'text-muted-foreground'
              }`}
              title="网格视图"
            >
              <Grid3X3 className="h-4 w-4" />
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors ${
                viewMode === 'list' ? 'bg-primary/10 text-primary' : 'text-muted-foreground'
              }`}
              title="列表视图"
            >
              <List className="h-4 w-4" />
            </button>
          </div>

          <button
            onClick={handleBatchGenerate}
            disabled={batching || shots.length === 0}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90 disabled:opacity-50"
          >
            <span className="flex items-center gap-1.5">
              <Sparkles className="h-4 w-4" />
              {batching ? '发起中...' : `批量生成图片（${shots.length} 镜）`}
            </span>
          </button>
          <button
            onClick={handleOneClick}
            disabled={batching || shots.length === 0}
            title="先图后片一次建完，去任务页看进度，成片用导出页合成"
            className="rounded-lg border border-primary px-4 py-2 text-sm font-medium text-primary hover:bg-primary/5 disabled:opacity-50"
          >
            <span className="flex items-center gap-1.5">
              <Clapperboard className="h-4 w-4" />
              {batching ? '发起中...' : '一键成片'}
            </span>
          </button>
        </div>
      </div>

      {/* 一致性体检：产物四态 + 跳轴/景别/段超长/未绑资产。
          这一块的存在意义是「把不连贯的原因提前摆出来」，而不是等成片才发现。 */}
      {diagnosis && (() => {
        const all = [
          ...diagnosis.issues,
          ...diagnosis.shots.flatMap((d) => d.issues),
        ];
        const errors = all.filter((i) => i.level === 'error');
        const warns = all.filter((i) => i.level === 'warn');
        const top = [...errors, ...warns].slice(0, 4);
        return (
          <div className="rounded-xl border border-input bg-card p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                <ShieldCheck className={`h-4 w-4 ${diagnosis.passed ? 'text-emerald-600' : 'text-amber-600'}`} />
                一致性体检
                <span className={diagnosis.passed ? 'text-emerald-600' : 'text-amber-600'}>
                  {diagnosis.passed ? '通过' : `${errors.length} 项阻塞`}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                <span>可用 {diagnosis.counts.current}</span>
                {diagnosis.counts.missing > 0 && (
                  <span className="text-amber-600">缺失 {diagnosis.counts.missing}</span>
                )}
                {diagnosis.counts.stale > 0 && (
                  <span className="text-amber-600">过期 {diagnosis.counts.stale}</span>
                )}
                {diagnosis.counts.blocked > 0 && (
                  <span className="text-red-500">阻塞 {diagnosis.counts.blocked}</span>
                )}
                <button
                  onClick={() => void refreshDiagnosis()}
                  className="inline-flex items-center gap-1 rounded-md border border-input px-2 py-1 hover:text-foreground"
                  title="重新体检"
                >
                  <RefreshCw className="h-3 w-3" />
                  重新体检
                </button>
                {segments.length === 0 && shots.length > 0 && (
                  <button
                    onClick={() => void handleRebuildSegments()}
                    disabled={rebuildingSegments}
                    className="inline-flex items-center gap-1 rounded-md border border-primary/40 px-2 py-1 text-primary hover:bg-primary/5 disabled:opacity-60"
                    title="按「≤15 秒 / 2-4 镜」把现有镜头归段，并回填 3 秒节拍（不改镜头内容）"
                  >
                    <RefreshCw className={`h-3 w-3 ${rebuildingSegments ? 'animate-spin' : ''}`} />
                    {rebuildingSegments ? '归段中…' : '按规则重建片段'}
                  </button>
                )}
              </div>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">{diagnosis.summary}</p>
            {top.length > 0 && (
              <ul className="mt-3 space-y-1.5">
                {top.map((it, idx) => (
                  <li key={`${it.code}-${idx}`} className="flex items-start gap-2 text-xs">
                    <span
                      className={`shrink-0 rounded px-1.5 py-0.5 ${
                        it.level === 'error'
                          ? 'bg-red-500/10 text-red-500'
                          : it.level === 'warn'
                            ? 'bg-amber-500/10 text-amber-600'
                            : 'bg-muted text-muted-foreground'
                      }`}
                    >
                      {it.level === 'error' ? '阻塞' : it.level === 'warn' ? '告警' : '建议'}
                    </span>
                    <span className="text-muted-foreground">{it.message}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })()}

      {/* 首帧受阻恢复入口：把「视频为什么不动」变成可执行动作 */}
      {blocked && blocked.totalJobs > 0 && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-sm font-medium text-amber-600">
                <AlertTriangle className="h-4 w-4" />
                {blocked.totalJobs} 个视频任务已暂停
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {blocked.needAction > 0 ? (
                  <>
                    其中 {blocked.needAction} 个镜头首帧生成失败或缺失，视频在首帧就绪前不会运行、也不会计费。
                    受影响镜头：
                    {blocked.items
                      .filter((i) => i.reason !== 'waiting_first_frame' && !i.hasActiveImageJob)
                      .map((i) => `#${i.shotNumber}`)
                      .join('、')}
                  </>
                ) : (
                  '首帧正在生成中，完成后视频会自动继续，无需操作。'
                )}
              </p>
            </div>
            {blocked.needAction > 0 && (
              <button
                onClick={handleRecoverBlocked}
                disabled={recovering}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-amber-500/90 disabled:opacity-50"
              >
                <RefreshCw className={`h-4 w-4 ${recovering ? 'animate-spin' : ''}`} />
                {recovering ? '恢复中…' : `重试首帧（${blocked.needAction} 镜）`}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Shots grid */}
      {loading ? (
        <div className="text-sm text-muted-foreground">加载中...</div>
      ) : filteredShots.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-card p-12 text-center">
          <div className="text-sm text-muted-foreground">
            暂无分镜，请先生成分镜故事板
          </div>
        </div>
      ) : viewMode === 'grid' ? (
        <div className="cq-cols grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {filteredShots.map((shot, idx) => {
            const statusInfo = getStatusInfo(shot.status);
            const isExpanded = expandedId === shot.id;
            const isRegenerating = regeneratingIds.has(shot.id);
            const blockedInfo = blockedByShot.get(shot.id);
            return (
              <div
                key={shot.id}
                id={`shot-card-${shot.id}`}
                className={`overflow-hidden rounded-xl border bg-card shadow-sm transition-all hover:shadow-md ${
                  searchParams.get('shot') === shot.id ? 'ring-2 ring-primary/50' : ''
                }`}
              >
                {/* Thumbnail */}
                <div
                  className="relative aspect-[9/16] w-full cursor-pointer"
                  onClick={() => setExpandedId(isExpanded ? null : shot.id)}
                >
                  <MediaOrMissing
                    src={shot.startFrameUrl}
                    alt={`Shot ${shot.shotNumber}`}
                    className="h-full w-full"
                  />
                  {isRegenerating && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-xs font-medium text-white backdrop-blur-sm">
                      生成中...
                    </div>
                  )}
                  {shot.locked && (
                    <div className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-sm">
                      <Lock className="h-3 w-3" />
                    </div>
                  )}
                  <div className="absolute left-2 top-2 rounded-md bg-black/50 px-1.5 py-0.5 text-xs font-medium text-white backdrop-blur-sm">
                    #{shot.shotNumber}
                  </div>
                  {shot.mock && (
                    <div
                      className="absolute bottom-2 left-2 flex items-center gap-1 rounded-md bg-amber-500/90 px-1.5 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm"
                      title="当前首帧/成片来自 mock 演练通道：占位内容、未计费，不能当作真实出片"
                    >
                      <AlertTriangle className="h-3 w-3" />
                      演示
                    </div>
                  )}
                </div>

                {/* Info */}
                <div className="p-3">
                  <div className="flex items-center justify-between gap-1">
                    <div className="flex items-center gap-1">
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                        {shotSizeLabels[shot.shotSize] || shot.shotSize || '中景'}
                      </span>
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                        {shot.movement || '固定'}
                      </span>
                    </div>
                    {blockedInfo && (
                      <span
                        title={
                          blockedInfo.reason === 'waiting_first_frame'
                            ? '首帧生成中，完成后视频自动继续'
                            : '首帧失败/缺失，视频已暂停且未计费；重试首帧后自动继续'
                        }
                        className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-600"
                      >
                        视频已暂停
                      </span>
                    )}
                    <span
                      className={`pill ${statusInfo.className}`}
                    >
                      {statusInfo.label}
                    </span>
                  </div>
                  <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">
                    {shot.visualPrompt || shot.action || '暂无描述'}
                  </p>

                  {/* Actions */}
                  <div className="mt-3 flex items-center gap-1">
                    <button
                      onClick={() => handleRerun(shot, 'image')}
                      disabled={isRegenerating}
                      className="flex flex-1 items-center justify-center gap-1 rounded-md border border-input bg-card py-1 text-[11px] font-medium text-foreground hover:border-primary hover:text-primary disabled:opacity-50"
                    >
                      <RefreshCw className="h-3 w-3" />
                      重生成
                    </button>
                    <button
                      onClick={() => handleRerun(shot, 'video')}
                      disabled={isRegenerating}
                      className="flex flex-1 items-center justify-center gap-1 rounded-md border border-input bg-card py-1 text-[11px] font-medium text-foreground hover:border-primary hover:text-primary disabled:opacity-50"
                    >
                      <Play className="h-3 w-3" />
                      生成视频
                    </button>
                    <button
                      onClick={() => handleMove(idx, 'up')}
                      className="flex h-6 w-6 items-center justify-center rounded-md border border-input bg-card text-muted-foreground hover:text-foreground"
                      title="上移"
                    >
                      <ChevronUp className="h-3 w-3" />
                    </button>
                    <button
                      onClick={() => handleMove(idx, 'down')}
                      className="flex h-6 w-6 items-center justify-center rounded-md border border-input bg-card text-muted-foreground hover:text-foreground"
                      title="下移"
                    >
                      <ChevronDown className="h-3 w-3" />
                    </button>
                    <button
                      onClick={() => handleDelete(shot.id)}
                      className="flex h-6 w-6 items-center justify-center rounded-md border border-input bg-card text-muted-foreground hover:text-red-300"
                      title="删除"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </div>

                {/* Expanded detail */}
                {isExpanded && (
                  <div className="border-t border-border bg-muted/20 p-3">
                    <div className="space-y-1.5 text-xs">
                      {/* P2 行内提示词编辑：改完可就地重跑单镜，不再跳导演台 */}
                      <div>
                        <span className="font-medium text-foreground">画面提示词：</span>
                        <textarea
                          value={promptDrafts[shot.id] ?? shot.visualPrompt ?? ''}
                          onChange={(e) =>
                            setPromptDrafts((prev) => ({ ...prev, [shot.id]: e.target.value }))
                          }
                          rows={3}
                          placeholder="描述这一镜的画面（将用于生成首帧图与视频）"
                          className="mt-1 w-full resize-y rounded-md border border-input bg-card p-2 text-xs outline-none focus:border-primary"
                        />
                        <div className="mt-1.5 flex items-center gap-1.5">
                          <button
                            onClick={() => handleSavePrompt(shot)}
                            disabled={
                              savingPromptIds.has(shot.id) ||
                              (promptDrafts[shot.id] ?? shot.visualPrompt ?? '') === (shot.visualPrompt ?? '')
                            }
                            className="rounded-md border border-input bg-card px-2 py-1 text-[11px] font-medium hover:border-primary hover:text-primary disabled:opacity-40"
                          >
                            {savingPromptIds.has(shot.id) ? '保存中…' : '保存'}
                          </button>
                          <button
                            onClick={() => handleSavePrompt(shot, 'image')}
                            disabled={savingPromptIds.has(shot.id) || !promptDrafts[shot.id]}
                            title="保存提示词并重跑该镜首帧"
                            className="inline-flex items-center gap-1 rounded-md border border-primary/40 bg-primary/5 px-2 py-1 text-[11px] font-medium text-primary hover:bg-primary/10 disabled:opacity-40"
                          >
                            <RefreshCw className="h-3 w-3" />
                            保存并重跑首帧
                          </button>
                        </div>
                      </div>
                      {shot.dialogue && (
                        <div>
                          <span className="font-medium text-foreground">台词：</span>
                          <span className="text-muted-foreground">{shot.dialogue}</span>
                        </div>
                      )}
                      {shot.action && (
                        <div>
                          <span className="font-medium text-foreground">动作：</span>
                          <span className="text-muted-foreground">{shot.action}</span>
                        </div>
                      )}
                      <div>
                        <span className="font-medium text-foreground">时长：</span>
                        <span className="text-muted-foreground">{shot.duration}s</span>
                      </div>
                      <div>
                        <span className="font-medium text-foreground">镜头：</span>
                        <span className="text-muted-foreground">
                          {shot.cameraAngle || '平视'} · {shot.lens || '标准'}
                        </span>
                      </div>
                      {/* P1 配音闭环：有配音可试听，无配音有对白可一键生成 */}
                      <div>
                        <span className="font-medium text-foreground">配音：</span>
                        {shot.voiceUrl ? (
                          <span className="mt-1 block">
                            <audio controls preload="none" src={shot.voiceUrl} className="h-8 w-full" />
                            <button
                              onClick={() => handleVoice(shot)}
                              disabled={isRegenerating}
                              className="mt-1.5 inline-flex items-center gap-1 rounded-md border border-input bg-card px-2 py-1 text-[11px] font-medium hover:border-primary hover:text-primary disabled:opacity-50"
                            >
                              <Mic className="h-3 w-3" />
                              不满意，重配
                            </button>
                          </span>
                        ) : shot.dialogue ? (
                          <button
                            onClick={() => handleVoice(shot)}
                            disabled={isRegenerating}
                            className="ml-1 inline-flex items-center gap-1 rounded-md border border-input bg-card px-2 py-1 text-[11px] font-medium hover:border-primary hover:text-primary disabled:opacity-50"
                          >
                            <Mic className="h-3 w-3" />
                            生成配音
                          </button>
                        ) : (
                          <span className="text-muted-foreground">暂无（先填写对白）</span>
                        )}
                      </div>
                      {/* 镜头历史版本：多次生成保留产物链，可回退到旧版（解决主成片被覆盖不可回退） */}
                      <div>
                        <span className="font-medium text-foreground">历史版本：</span>
                        {!historyMap[shot.id] ? (
                          <button
                            onClick={() => loadHistory(shot)}
                            disabled={historyLoading.has(shot.id)}
                            className="ml-1 inline-flex items-center gap-1 rounded-md border border-input bg-card px-2 py-1 text-[11px] font-medium hover:border-primary hover:text-primary disabled:opacity-50"
                          >
                            <History className="h-3 w-3" />
                            {historyLoading.has(shot.id) ? '加载中…' : '查看历史版本'}
                          </button>
                        ) : historyMap[shot.id].length === 0 ? (
                          <span className="text-muted-foreground">暂无历史版本（每次重生成后自动保留旧版）</span>
                        ) : (
                          <div className="mt-1.5 space-y-1">
                            {historyMap[shot.id].map((asset) => (
                              <div
                                key={asset.id}
                                className="flex items-center justify-between gap-2 rounded-md border border-border bg-card px-2 py-1"
                              >
                                <div className="flex min-w-0 items-center gap-2">
                                  <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                                    {asset.assetType === 'image' ? '首帧' : '成片'} v{asset.version ?? 1}
                                  </span>
                                  <span className="truncate text-[11px] text-muted-foreground">
                                    {asset.createdAt
                                      ? new Date(asset.createdAt).toLocaleString('zh-CN', {
                                          month: '2-digit',
                                          day: '2-digit',
                                          hour: '2-digit',
                                          minute: '2-digit',
                                        })
                                      : ''}
                                  </span>
                                </div>
                                <button
                                  onClick={() => revertTo(shot, asset)}
                                  disabled={revertingIds.has(asset.id)}
                                  title="回退到该版本"
                                  className="inline-flex shrink-0 items-center gap-1 rounded-md border border-input bg-card px-1.5 py-0.5 text-[10px] font-medium text-foreground hover:border-primary hover:text-primary disabled:opacity-50"
                                >
                                  <RotateCcw className="h-3 w-3" />
                                  {revertingIds.has(asset.id) ? '回退中' : '回退'}
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        /* List view */
        <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-muted/30">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">#</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">预览</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">景别</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">描述</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">状态</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">操作</th>
              </tr>
            </thead>
            <tbody>
              {filteredShots.map((shot, idx) => {
                const statusInfo = getStatusInfo(shot.status);
                return (
                  <tr key={shot.id} className="border-t border-border">
                    <td className="px-4 py-3 font-medium text-foreground">
                      #{shot.shotNumber}
                    </td>
                    <td className="px-4 py-3">
                      <div className="h-12 w-8 overflow-hidden rounded bg-muted">
                        <MediaOrMissing
                          src={shot.startFrameUrl}
                          className="h-full w-full"
                        />
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {shotSizeLabels[shot.shotSize] || shot.shotSize || '-'}
                    </td>
                    <td className="px-4 py-3 max-w-[200px] truncate text-muted-foreground">
                      {shot.visualPrompt || shot.action || '-'}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`pill ${statusInfo.className}`}>
                        {statusInfo.label}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => handleRerun(shot, 'image')}
                          className="rounded-md border border-input px-2 py-1 text-xs text-foreground hover:border-primary hover:text-primary"
                        >
                          重生成
                        </button>
                        <button
                          onClick={() => handleDelete(shot.id)}
                          className="rounded-md border border-input px-2 py-1 text-xs text-muted-foreground hover:border-red-300 hover:text-red-300"
                        >
                          删除
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default ProjectStoryboardTab;
