import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  Hand,
  ListChecks,
  Loader2,
} from 'lucide-react';
import type {
  GenerationJob,
  JobStatus,
  JobType,
  ProjectProgressResponse,
} from '@shared/api.interface';

interface PipelineCardProps {
  projectId: string;
  progress: ProjectProgressResponse | null;
  jobs: GenerationJob[];
  shotStats: { done: number; render: number; pending: number; total: number };
  sceneCount: number;
  clipCount: number;
  durationSec: number;
  onNavigate: (path: string) => void;
}

const STEP_DESC: Record<string, string> = {
  draft: '确认创意、时长与画风，项目从这里开始。',
  parsing: 'Agent 读取剧本，拆出场次与镜头结构。',
  planning: '规划节奏、镜头数量与生成策略。',
  bible_ready: '提取人物、场景与视觉风格，形成制作圣经。',
  storyboard_ready: '生成分镜清单；确认后进入首帧与资产生成。',
  assets_generating: '为人物、场景与镜头生成参考图和首帧。',
  video_generating: '按分镜逐个生成镜头视频。',
  audio_generating: '生成配音与背景音乐，准备合成。',
  editing: '按时间线合成画面、字幕与音轨。',
  qc: '检查画质、时长与人物场景一致性。',
  ready: '成片已完成，可以预览、微调并导出。',
};

/** 每个阶段关联的任务类型（与服务端进度聚合口径一致） */
const STEP_JOBS: Record<string, JobType[]> = {
  parsing: ['script', 'parse_script', 'boards'],
  planning: ['script', 'boards'],
  bible_ready: ['boards'],
  storyboard_ready: ['parse_script', 'boards', 'storyboard'],
  assets_generating: ['image'],
  video_generating: ['video'],
  audio_generating: ['tts'],
  editing: ['edit'],
  qc: ['qc'],
};

const STEP_VIEW: Record<string, { path: string; label: string }> = {
  draft: { path: 'flow', label: '流程总控' },
  parsing: { path: 'script', label: '查看剧本' },
  planning: { path: 'flow', label: '查看规划' },
  bible_ready: { path: 'bible', label: '制作圣经' },
  storyboard_ready: { path: 'storyboard', label: '查看分镜' },
  assets_generating: { path: 'assets', label: '查看资产' },
  video_generating: { path: 'storyboard', label: '查看镜头' },
  // timeline 已并入 Studio 外壳底部：StudioShell 会把它重定向回项目并展开面板
  audio_generating: { path: 'timeline', label: '展开时间线' },
  editing: { path: 'timeline', label: '展开时间线' },
  qc: { path: 'qc', label: '查看质检' },
  ready: { path: 'export', label: '去导出' },
};

const JOB_LABEL: Record<JobType, string> = {
  text: '文本',
  image: '图片',
  video: '视频',
  tts: '配音',
  parse_script: '剧本物化',
  storyboard: '分镜',
  qc: '质检',
  edit: '合成',
  script: '剧本生成',
  boards: '分镜物化',
};

const STATUS_LABEL: Record<JobStatus, string> = {
  pending: '排队',
  queued: '排队',
  running: '运行中',
  retrying: '重试中',
  succeeded: '完成',
  failed: '失败',
  cancelled: '已取消',
};

const isActiveStatus = (s: JobStatus) =>
  s === 'pending' || s === 'queued' || s === 'running' || s === 'retrying';

/** 同一目标只认最新一次任务：失败后重试成功的旧失败不再算「待处理」 */
export const latestByTarget = (list: GenerationJob[]) => {
  const map = new Map<string, GenerationJob>();
  for (const j of list) {
    const key = `${j.jobType}:${j.targetId ?? j.id}`;
    const cur = map.get(key);
    if (!cur || new Date(j.updatedAt).getTime() > new Date(cur.updatedAt).getTime()) {
      map.set(key, j);
    }
  }
  return [...map.values()];
};

export const countOpenFailures = (jobs: GenerationJob[]) =>
  latestByTarget(jobs).filter((j) => j.status === 'failed').length;

const fmtSec = (sec: number) => {
  const s = Math.max(0, Math.round(sec));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

const fmtTime = (iso?: string) => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
};

type RowState = 'done' | 'run' | 'gate' | 'wait' | 'fail';

/**
 * 生产流程卡：每一步都可展开，看到这一步做了什么、关联任务与失败原因；
 * 有待确认的门时，对应步骤会变成「待确认」并给出继续入口。
 */
export const PipelineCard = ({
  projectId,
  progress,
  jobs,
  shotStats,
  sceneCount,
  clipCount,
  durationSec,
  onNavigate,
}: PipelineCardProps) => {
  const [expanded, setExpanded] = useState<string[]>([]);
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem('yimu.pipe.collapsed') === '1';
    } catch {
      return false;
    }
  });

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('yimu.pipe.collapsed', next ? '1' : '0');
      } catch {
        /* 隐私模式下忽略 */
      }
      return next;
    });
  };

  const gateStep =
    progress?.nextGate === 'script'
      ? 'parsing'
      : progress?.nextGate === 'storyboard'
        ? 'storyboard_ready'
        : progress?.nextGate === 'final'
          ? 'qc'
          : null;

  // 新焦点（当前运行步骤 / 待确认门）自动展开一次，用户手动收起后不再强制打开
  useEffect(() => {
    const focus = gateStep ?? progress?.currentStep;
    if (!focus) return;
    setExpanded((prev) => (prev.includes(focus) ? prev : [...prev, focus]));
  }, [gateStep, progress?.currentStep]);

  const jobsByStep = useMemo(() => {
    const map = new Map<string, GenerationJob[]>();
    for (const [step, types] of Object.entries(STEP_JOBS)) {
      map.set(
        step,
        jobs.filter((j) => types.includes(j.jobType)),
      );
    }
    return map;
  }, [jobs]);

  if (!progress || progress.steps.length === 0) return null;

  const activeCount = jobs.filter((j) => isActiveStatus(j.status)).length;
  const failedCount = latestByTarget(jobs).filter((j) => j.status === 'failed').length;
  const focusStep =
    gateStep ??
    progress.currentStep ??
    [...progress.steps].reverse().find((s) => s.status === 'completed')?.step;
  const currentLabel =
    progress.steps.find((s) => s.step === focusStep)?.stepLabel ?? '尚未开始';

  const toggle = (step: string) =>
    setExpanded((prev) => (prev.includes(step) ? prev.filter((s) => s !== step) : [...prev, step]));

  return (
    <section className="pipe">
      <header className="pipe-head">
        <button
          type="button"
          className="pipe-title"
          aria-expanded={!collapsed}
          onClick={toggleCollapsed}
          title={collapsed ? '展开制作流程' : '收起制作流程'}
        >
          <ListChecks className="ico" />
          <span>制作流程</span>
          <ChevronDown className={`pipe-fold${collapsed ? '' : ' open'}`} />
        </button>
        {activeCount > 0 ? (
          <span className="pipe-glance run">
            <i className="dot" />
            {activeCount} 运行中
          </span>
        ) : null}
        {failedCount > 0 ? (
          <span className="pipe-glance fail">
            <i className="dot" />
            {failedCount} 失败
          </span>
        ) : null}
        <div className="pipe-meta">
          <span className="num">{progress.overallProgress}%</span>
          <span className="pipe-overall" aria-hidden="true">
            <i style={{ width: `${Math.max(2, progress.overallProgress)}%` }} />
          </span>
        </div>
      </header>

      {collapsed ? (
        <button type="button" className="pipe-now" onClick={toggleCollapsed}>
          <span className="pipe-now-label">当前</span>
          <b>{currentLabel}</b>
          {progress.nextGate ? <span className="pipe-chip gate">待确认</span> : null}
          <span className="pipe-now-hint">展开 {progress.steps.length} 个步骤</span>
          <ChevronRight />
        </button>
      ) : (
        <>
          <div className="pipe-links">
            <button
              type="button"
              className="pipe-link"
              onClick={() => onNavigate(`/project/${projectId}/flow`)}
            >
              流程总控 <ArrowRight />
            </button>
            <button
              type="button"
              className="pipe-link"
              onClick={() => onNavigate(`/project/${projectId}/tasks`)}
            >
              任务队列 <ArrowRight />
            </button>
          </div>

          <ol className="pipe-list">
        {progress.steps.map((s, idx) => {
          const stepJobs = jobsByStep.get(s.step) ?? [];
          const openFailures = latestByTarget(stepJobs).filter((j) => j.status === 'failed');
          const counts = {
            total: stepJobs.length,
            done: stepJobs.filter((j) => j.status === 'succeeded').length,
            active: stepJobs.filter((j) => isActiveStatus(j.status)).length,
            failed: openFailures.length,
          };
          const firstFailed = openFailures[0];
          const state: RowState =
            s.step === gateStep
              ? 'gate'
              : counts.failed > 0 || s.status === 'failed'
                ? 'fail'
                : s.step === 'draft' && s.status === 'running'
                  ? 'wait'
                  : s.status === 'completed'
                    ? 'done'
                    : s.status === 'running'
                      ? 'run'
                      : 'wait';
          const open = expanded.includes(s.step);
          const view = STEP_VIEW[s.step];
          const activeJobs = stepJobs
            .filter((j) => j.status === 'failed' || isActiveStatus(j.status))
            .sort(
              (a, b) =>
                (a.status === 'failed' ? 0 : 1) - (b.status === 'failed' ? 0 : 1) ||
                new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
            )
            .slice(0, 3);

          const facts: { label: string; value: string }[] = [];
          if (s.step === 'parsing' || s.step === 'planning') {
            if (sceneCount) facts.push({ label: '场次', value: `${sceneCount} 个` });
            if (shotStats.total) facts.push({ label: '镜头', value: `${shotStats.total} 个` });
            if (s.step === 'planning' && durationSec) {
              facts.push({ label: '总时长', value: fmtSec(durationSec) });
            }
          }
          if (s.step === 'bible_ready' && sceneCount) {
            facts.push({ label: '场次', value: `${sceneCount} 个` });
          }
          if (s.step === 'storyboard_ready') {
            facts.push({ label: '场次', value: `${sceneCount} 个` });
            facts.push({ label: '镜头', value: `${shotStats.total} 个` });
            if (shotStats.done) facts.push({ label: '已有首帧', value: `${shotStats.done} 个` });
          }
          if (s.step === 'assets_generating' || s.step === 'video_generating') {
            if (counts.total) {
              facts.push({ label: '任务', value: `${counts.total} 个` });
              if (counts.done) facts.push({ label: '完成', value: `${counts.done} 个` });
              if (counts.active) facts.push({ label: '进行中', value: `${counts.active} 个` });
            } else {
              facts.push({ label: '镜头', value: `${shotStats.total} 个` });
              facts.push({ label: '已就绪', value: `${shotStats.done} 个` });
              if (shotStats.render) facts.push({ label: '渲染中', value: `${shotStats.render} 个` });
            }
          }
          if (s.step === 'audio_generating' && counts.total) {
            facts.push({ label: '配音任务', value: `${counts.total} 个` });
            if (counts.done) facts.push({ label: '完成', value: `${counts.done} 个` });
          }
          if (s.step === 'editing' || s.step === 'ready') {
            if (clipCount) facts.push({ label: '片段', value: `${clipCount} 个` });
            if (durationSec) facts.push({ label: '时长', value: fmtSec(durationSec) });
          }
          if (s.step === 'qc' && counts.total) {
            facts.push({ label: '质检任务', value: `${counts.total} 个` });
            if (counts.done) facts.push({ label: '报告', value: `${counts.done} 份` });
          }

          return (
            <li key={s.step} className={`pipe-step ${state}${open ? ' open' : ''}`}>
              <button
                type="button"
                className="pipe-row"
                aria-expanded={open}
                onClick={() => toggle(s.step)}
              >
                <span className="pipe-node">
                  {state === 'done' ? (
                    <Check />
                  ) : state === 'run' ? (
                    <Loader2 className="spin" />
                  ) : state === 'gate' ? (
                    <Hand />
                  ) : state === 'fail' ? (
                    <AlertTriangle />
                  ) : (
                    <span className="pipe-no">{idx + 1}</span>
                  )}
                </span>
                <span className="pipe-label">{s.stepLabel}</span>
                {state === 'run' ? (
                  <span className="pipe-prog" aria-hidden="true">
                    <i style={{ width: `${Math.max(3, s.progress)}%` }} />
                  </span>
                ) : null}
                <span className={`pipe-chip ${state}`}>
                  {state === 'done'
                    ? '完成'
                    : state === 'run'
                      ? `进行中 ${s.progress}%`
                      : state === 'gate'
                        ? '待确认'
                        : state === 'fail'
                          ? counts.failed > 1
                            ? `失败 ${counts.failed}`
                            : '失败'
                          : '等待'}
                </span>
                <ChevronRight className="pipe-car" />
              </button>

              {open ? (
                <div className="pipe-body">
                  <p className="pipe-desc">
                    {STEP_DESC[s.step] ?? '这一步由 Agent 自动执行。'}
                    {state === 'gate' ? ' 现在需要你确认后才能继续。' : null}
                  </p>

                  {facts.length > 0 ? (
                    <div className="pipe-facts">
                      {facts.map((f) => (
                        <span key={f.label} className="pipe-fact">
                          {f.label} <b>{f.value}</b>
                        </span>
                      ))}
                    </div>
                  ) : null}

                  {counts.total > 0 ? (
                    <div className="pipe-jobs">
                      <div className="pipe-job-sum">
                        <span>任务 {counts.total}</span>
                        {counts.done ? <span className="ok">完成 {counts.done}</span> : null}
                        {counts.active ? <span className="run">进行中 {counts.active}</span> : null}
                        {counts.failed ? <span className="fail">失败 {counts.failed}</span> : null}
                      </div>
                      {activeJobs.map((j) => (
                        <div key={j.id} className="pipe-job">
                          <span className={`dot ${j.status}`} />
                          <span className="jt">{JOB_LABEL[j.jobType]}</span>
                          <span className={`st ${j.status}`}>{STATUS_LABEL[j.status]}</span>
                          {isActiveStatus(j.status) ? <span className="num">{j.progress}%</span> : null}
                          <span className="num time">{fmtTime(j.updatedAt)}</span>
                        </div>
                      ))}
                    </div>
                  ) : null}

                  {firstFailed?.errorMessage ? (
                    <div className="pipe-error">
                      {JOB_LABEL[firstFailed.jobType]}失败：{firstFailed.errorMessage}
                    </div>
                  ) : null}

                  <div className="pipe-actions">
                    {state === 'gate' ? (
                      <button
                        type="button"
                        className="btn pri"
                        onClick={() =>
                          document
                            .getElementById('studio-gate-card')
                            ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                        }
                      >
                        <Hand className="ico" /> 去确认
                      </button>
                    ) : null}
                    {view ? (
                      <button
                        type="button"
                        className="btn"
                        onClick={() => onNavigate(`/project/${projectId}/${view.path}`)}
                      >
                        {view.label} <ArrowRight className="ico" />
                      </button>
                    ) : null}
                    {state === 'fail' || counts.failed > 0 ? (
                      <button
                        type="button"
                        className="btn"
                        onClick={() => onNavigate(`/project/${projectId}/tasks`)}
                      >
                        去任务队列处理
                      </button>
                    ) : null}
                    {counts.active > 0 ? (
                      <button
                        type="button"
                        className="btn"
                        onClick={() => onNavigate(`/project/${projectId}/tasks`)}
                      >
                        查看运行中的任务
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </li>
          );
        })}
          </ol>
        </>
      )}
    </section>
  );
};