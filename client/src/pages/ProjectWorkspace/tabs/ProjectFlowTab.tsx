import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Check,
  CircleDashed,
  Loader2,
  XCircle,
  Hand,
  ListTodo,
  ScrollText,
  Film,
  Download,
  Grid3X3,
  RefreshCw,
} from 'lucide-react';
import { projects } from '@client/src/api';
import type { GenerationProgress, ProjectProgressResponse } from '@shared/api.interface';
import { toast } from 'sonner';
import { logger } from '@client/src/utils/logger';

/**
 * 流程总控页（docs/流程重构方案-v2.md S3/S5）：
 * 九段流水线可视化——当前段高亮、已完成打勾、待确认段显示「去确认」按钮。
 * 数据源为既有 GET /api/projects/:id/progress（5s 轮询），配合新增的
 * POST /api/projects/:id/approve 三道门：门未过不自动进入下一段。
 * 开拍后用户在此「知道去哪等、等到哪一步、下一步点什么」。
 */

const GATE_META: Record<
  NonNullable<ProjectProgressResponse['nextGate']>,
  { label: string; desc: string; button: string }
> = {
  script: {
    label: '门 1 · 剧本确认',
    desc: '剧本已生成，审阅满意后确认，系统自动物化分镜（未确认不进入下一段）',
    button: '确认剧本，物化分镜',
  },
  storyboard: {
    label: '门 2 · 分镜确认',
    desc: '分镜已就绪。确认后系统自动连跑：首帧图 → 视频 → 配音 → 剪辑 → 质检，中途零操作',
    button: '确认分镜，开始生成',
  },
  final: {
    label: '门 3 · 成片确认',
    desc: '成片已合成并通过质检，确认后项目标记为「成片就绪」，可前往导出页下载',
    button: '确认成片',
  },
};

const stepIcon = (step: GenerationProgress) => {
  if (step.status === 'completed') return <Check className="h-4 w-4" />;
  if (step.status === 'failed') return <XCircle className="h-4 w-4" />;
  if (step.status === 'running') return <Loader2 className="h-4 w-4 animate-spin" />;
  return <CircleDashed className="h-4 w-4" />;
};

const stepStyle = (step: GenerationProgress, isCurrent: boolean) => {
  if (step.status === 'completed')
    return { dot: 'bg-primary text-white', text: 'text-foreground' };
  if (step.status === 'failed')
    return { dot: 'bg-red-500/150 text-white', text: 'text-red-400' };
  if (step.status === 'running')
    return {
      dot: 'bg-primary/10 text-primary ring-2 ring-primary/40',
      text: isCurrent ? 'text-primary font-semibold' : 'text-foreground',
    };
  return { dot: 'bg-muted text-muted-foreground', text: 'text-muted-foreground' };
};

const ProjectFlowTab = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [progress, setProgress] = useState<ProjectProgressResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [approving, setApproving] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!id) return;
    projects
      .getProgress(id)
      .then((p) => {
        setProgress(p);
        setError(null);
      })
      .catch((err) => {
        logger.error('load progress failed:', String(err));
        setError('加载进度失败');
      });
  }, [id]);

  useEffect(() => {
    load();
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, [load]);

  const handleApprove = async (gate: NonNullable<ProjectProgressResponse['nextGate']>) => {
    if (!id || approving) return;
    setApproving(gate);
    try {
      await projects.approveProject(id, gate);
      toast.success(`已确认${GATE_META[gate].label.replace(/^门 \d · /, '')}，流水线继续推进`);
      load();
    } catch (err) {
      logger.error('approve failed:', String(err));
      toast.error(`确认失败：${(err as Error).message}`);
    } finally {
      setApproving(null);
    }
  };

  const nextGate = progress?.nextGate ?? null;
  const overall = progress?.overallProgress ?? 0;

  const jumpButtons = [
    { to: `/project/${id}/script`, label: '去剧本', icon: ScrollText },
    { to: `/project/${id}/storyboard`, label: '去分镜', icon: Grid3X3 },
    { to: `/project/${id}/tasks`, label: '任务队列', icon: ListTodo },
    { to: `/project/${id}/export`, label: '去导出', icon: Download },
  ];

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/15 p-4 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* 总览：整体进度 + 下一步 */}
      <div className="rounded-xl border bg-card p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-foreground">流水线总控</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {progress
                ? `当前阶段：${progress.steps.find((s) => s.step === progress.currentStep)?.stepLabel ?? progress.overallStatus} · 整体进度 ${overall}%`
                : '加载中...'}
            </p>
          </div>
          <button
            onClick={load}
            className="flex items-center gap-1.5 rounded-lg border border-input bg-card px-3 py-2 text-sm font-medium text-foreground hover:bg-muted/50"
          >
            <RefreshCw className="h-4 w-4" /> 刷新
          </button>
        </div>
        <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-brand-gradient transition-all"
            style={{ width: `${Math.max(2, overall)}%` }}
          />
        </div>

        {/* 待确认门：唯一需要用户操作的地方 */}
        {nextGate && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/30 bg-amber-500/15 px-4 py-3">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-sm font-semibold text-amber-300">
                <Hand className="h-4 w-4" /> {GATE_META[nextGate].label}
              </div>
              <p className="mt-1 text-xs leading-relaxed text-amber-300/80">
                {GATE_META[nextGate].desc}
              </p>
            </div>
            <button
              onClick={() => handleApprove(nextGate)}
              disabled={approving === nextGate}
              className="shrink-0 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm hover:opacity-90 disabled:opacity-50"
            >
              {approving === nextGate ? '确认中…' : GATE_META[nextGate].button}
            </button>
          </div>
        )}
        {!nextGate && progress && (
          <p className="mt-4 rounded-xl bg-primary/5 px-4 py-3 text-xs text-muted-foreground">
            {progress.overallStatus === 'ready' || progress.overallStatus === 'exported'
              ? '🎬 全流程已完成，可前往「导出」页播放或下载成片。'
              : progress.overallStatus === 'failed'
                ? '流程中有环节失败，请前往「任务队列」定位失败任务并重试。'
                : '流水线自动段进行中，无需操作——完成每一段会自动进入下一段，可随时到「任务队列」看实时进度。'}
          </p>
        )}
      </div>

      {/* 九段流水线（竖向进度栏，对标火宝左侧进度栏） */}
      <div className="rounded-xl border bg-card p-6 shadow-sm">
        <h3 className="text-base font-semibold text-foreground">流水线步骤</h3>
        <div className="mt-4 space-y-0">
          {(progress?.steps ?? []).map((step, idx) => {
            const isCurrent = step.step === progress?.currentStep;
            const style = stepStyle(step, isCurrent);
            return (
              <div key={step.step} className="flex gap-3">
                {/* 左侧：节点 + 连线 */}
                <div className="flex flex-col items-center">
                  <div
                    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${style.dot}`}
                  >
                    {stepIcon(step)}
                  </div>
                  {idx < (progress?.steps.length ?? 0) - 1 && (
                    <div
                      className={`w-0.5 flex-1 py-0.5 ${
                        step.status === 'completed' ? 'bg-primary' : 'bg-muted'
                      }`}
                      style={{ minHeight: 22 }}
                    />
                  )}
                </div>
                {/* 右侧：步骤信息 */}
                <div className="min-w-0 flex-1 pb-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className={`text-sm ${style.text}`}>
                      {step.stepLabel}
                      {isCurrent && (
                        <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                          当前
                        </span>
                      )}
                    </span>
                    {step.status === 'running' && (
                      <span className="text-xs text-muted-foreground">{step.progress}%</span>
                    )}
                  </div>
                  {step.status === 'running' && (
                    <div className="mt-1.5 h-1 max-w-xs overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary transition-all"
                        style={{ width: `${Math.min(100, Math.max(4, step.progress))}%` }}
                      />
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          {!progress && (
            <div className="text-sm text-muted-foreground">加载中...</div>
          )}
        </div>
      </div>

      {/* 快速跳转 */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {jumpButtons.map((b) => (
          <button
            key={b.to}
            onClick={() => navigate(b.to)}
            className="flex flex-col items-center gap-2 rounded-xl border bg-card p-4 text-sm font-medium text-foreground shadow-sm hover:border-primary hover:text-primary"
          >
            <b.icon className="h-5 w-5 text-primary" />
            {b.label}
          </button>
        ))}
      </div>

      {/* 成片入口：ready 后突出显示 */}
      {progress && ['ready', 'exported'].includes(progress.overallStatus) && (
        <button
          onClick={() => navigate(`/project/${id}/export`)}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground shadow-sm hover:opacity-90"
        >
          <Film className="h-4 w-4" /> 成片就绪，去播放 / 导出
        </button>
      )}
    </div>
  );
};

export default ProjectFlowTab;
