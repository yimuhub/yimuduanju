import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Lightbulb,
  Crosshair,
} from 'lucide-react';
import { qc } from '@client/src/api';
import type { QcReport, QcIssue } from '@shared/api.interface';
import { logger } from '@client/src/utils/logger';

const scoreItems: { key: keyof QcReport; label: string }[] = [
  { key: 'characterConsistency', label: '角色一致性' },
  { key: 'sceneConsistency', label: '场景一致性' },
  { key: 'motionQuality', label: '画面质量' },
  { key: 'audioSync', label: '音频同步' },
  { key: 'subtitleAccuracy', label: '字幕准确度' },
  { key: 'storyCoherence', label: '故事连贯性' },
  { key: 'technicalQuality', label: '技术质量' },
];

const severityConfig: Record<string, { label: string; className: string; icon: typeof AlertTriangle }> = {
  critical: { label: '严重', className: 'bg-red-500/15 text-red-400 border-red-500/30', icon: XCircle },
  high: { label: '高', className: 'bg-red-500/15 text-red-400 border-red-500/30', icon: AlertTriangle },
  medium: { label: '中', className: 'bg-amber-500/15 text-amber-400 border-amber-500/30', icon: AlertTriangle },
  low: { label: '低', className: 'bg-blue-500/15 text-blue-400 border-blue-500/30', icon: AlertTriangle },
};

const getSeverityInfo = (severity: string) =>
  severityConfig[severity] || severityConfig.medium;

const getVerdict = (score: number, thresholdPass: number, thresholdReview: number) => {
  if (score >= thresholdPass) return { label: 'PASS', className: 'bg-green-500/15 text-green-400 border-green-500/30', icon: CheckCircle2 };
  if (score >= thresholdReview) return { label: 'REVIEW', className: 'bg-amber-500/15 text-amber-400 border-amber-500/30', icon: AlertTriangle };
  return { label: 'RETRY', className: 'bg-red-500/15 text-red-400 border-red-500/30', icon: XCircle };
};

// Ring progress component using conic-gradient
const RingProgress = ({ score, size = 88, strokeWidth = 8 }: { score: number; size?: number; strokeWidth?: number }) => {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="hsl(var(--muted))"
          strokeWidth={strokeWidth}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="hsl(2 85% 60%)"
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className="transition-all duration-500"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-base font-bold text-foreground">{Math.round(score)}</span>
      </div>
    </div>
  );
};

const ProjectQcTab = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [report, setReport] = useState<QcReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [runningQc, setRunningQc] = useState(false);
  // P1 升级：历史报告趋势（重跑→重检的分数变化肉眼可见）
  const [history, setHistory] = useState<QcReport[]>([]);

  const fetchHistory = () => {
    if (!id) return;
    qc.listReports(id)
      .then((data) => setHistory(data.slice(0, 5)))
      .catch(() => {});
  };

  useEffect(() => {
    fetchHistory();
  }, [id]);

  const fetchLatest = () => {
    if (!id) return;
    setLoading(true);
    qc.getLatestReport(id)
      .then((data) => {
        setReport(data);
        setError(null);
      })
      .catch((err) => {
        logger.error('Failed to load QC report:', String(err));
        if (err?.response?.status === 404) {
          setReport(null);
        } else {
          setError('加载质检报告失败');
        }
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchLatest();
  }, [id]);

  const handleRunQc = async () => {
    if (!id) return;
    setRunningQc(true);
    try {
      const newReport = await qc.createReport(id);
      setReport(newReport);
      fetchHistory();
    } catch (err) {
      logger.error('QC failed:', String(err));
      setError('发起质检失败');
    } finally {
      setRunningQc(false);
    }
  };

  // W4 AI critic 回环：对问题镜头一键重跑，修复后重新质检可提分
  const [retrying, setRetrying] = useState(false);
  const handleRetryFailed = async () => {
    if (!id) return;
    setRetrying(true);
    try {
      const res = await qc.retryFailedShots(id);
      if (res.jobIds.length === 0 && res.errors.length === 0) {
        setError('暂无可重跑的问题镜头');
      } else {
        navigate(`/project/${id}/tasks`);
      }
    } catch (err) {
      logger.error('Retry failed shots failed:', String(err));
      setError('发起重跑失败');
    } finally {
      setRetrying(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="rounded-xl border bg-card p-6 shadow-sm">
          <div className="text-sm text-muted-foreground">加载中...</div>
        </div>
      </div>
    );
  }

  if (!report) {
    return (
      <div className="space-y-6">
        {error && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/15 p-4 text-sm text-red-400">
            {error}
          </div>
        )}

        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-foreground">质检报告</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              AI 自动质检，检测一致性与质量问题
            </p>
          </div>
          <button
            onClick={handleRunQc}
            disabled={runningQc}
            className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90 disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${runningQc ? 'animate-spin' : ''}`} />
            {runningQc ? '质检中...' : '开始质检'}
          </button>
        </div>

        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed bg-card p-16 shadow-sm">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
            <AlertTriangle className="h-8 w-8 text-primary" />
          </div>
          <h3 className="mt-4 text-base font-semibold text-foreground">尚未质检</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            点击「开始质检」对成片进行全面质量检测
          </p>
          <button
            onClick={handleRunQc}
            disabled={runningQc}
            className="mt-6 rounded-lg bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90 disabled:opacity-50"
          >
            {runningQc ? '质检进行中...' : '立即质检'}
          </button>
        </div>
      </div>
    );
  }

  const verdict = getVerdict(report.overallScore, report.thresholdPass, report.thresholdReview);
  const VerdictIcon = verdict.icon;

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/15 p-4 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-foreground">质检报告</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            生成于 {new Date(report.createdAt).toLocaleString('zh-CN')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleRunQc}
            disabled={runningQc}
            className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90 disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${runningQc ? 'animate-spin' : ''}`} />
            {runningQc ? '质检中...' : '重新质检'}
          </button>
          <button
            onClick={handleRetryFailed}
            disabled={retrying}
            title="对报告中的问题镜头自动创建重跑任务，修复后重新质检可提分"
            className="flex items-center gap-2 rounded-lg border border-primary/40 bg-primary/5 px-4 py-2 text-sm font-medium text-primary hover:bg-primary/10 disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${retrying ? 'animate-spin' : ''}`} />
            {retrying ? '发起中...' : '一键重跑问题镜头'}
          </button>
        </div>
      </div>

      {/* Overall score + verdict */}
      <div className="rounded-xl border bg-card p-8 shadow-sm">
        <div className="flex flex-col items-center gap-4 md:flex-row md:gap-8">
          <div className="flex flex-col items-center">
            <RingProgress score={report.overallScore} size={140} strokeWidth={12} />
            <div className="mt-3 text-sm text-muted-foreground">综合评分</div>
          </div>

          <div className="flex-1">
            <div className="flex items-center gap-3">
              <span
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-bold ${verdict.className}`}
              >
                <VerdictIcon className="h-4 w-4" />
                {verdict.label}
              </span>
            </div>
            <p className="mt-3 text-sm text-muted-foreground">
              {report.pass
                ? '恭喜！成片通过质量检测，可直接导出。'
                : '成片存在一些质量问题，建议修复后重新质检。'}
            </p>
            {/* P1 升级：手机端审批——通过去导出，打回去修镜头 */}
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                onClick={() => navigate(`/project/${id}/export`)}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90"
              >
                通过，去导出
              </button>
              <button
                onClick={() => navigate(`/project/${id}/storyboard`)}
                className="rounded-lg border border-input bg-card px-4 py-2 text-sm font-medium text-foreground hover:border-primary hover:text-primary"
              >
                打回，去修镜头
              </button>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">通过阈值：</span>
                <span className="font-medium text-foreground">{report.thresholdPass} 分</span>
              </div>
              <div>
                <span className="text-muted-foreground">复审阈值：</span>
                <span className="font-medium text-foreground">{report.thresholdReview} 分</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Dimension scores */}
      <div className="rounded-xl border bg-card p-6 shadow-sm">
        <h3 className="text-base font-semibold text-foreground">各项评分</h3>
        <div className="mt-5 grid grid-cols-2 gap-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7">
          {scoreItems.map((item) => {
            const score = (report[item.key] as number) || 0;
            return (
              <div key={item.key} className="flex flex-col items-center gap-2">
                <RingProgress score={score} size={64} strokeWidth={6} />
                <div className="text-xs text-center text-muted-foreground">{item.label}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Issues */}
      <div className="rounded-xl border bg-card p-6 shadow-sm">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-primary" />
          <h3 className="text-base font-semibold text-foreground">问题列表</h3>
          <span className="ml-1 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
            {report.issues?.length || 0}
          </span>
        </div>
        {(!report.issues || report.issues.length === 0) ? (
          <div className="mt-4 rounded-lg border border-green-500/30 bg-green-500/15 p-4 text-sm text-green-400">
            未发现质量问题
          </div>
        ) : (
          <div className="mt-4 space-y-2">
            {report.issues.map((issue: QcIssue, idx: number) => {
              const sev = getSeverityInfo(issue.severity);
              const SevIcon = sev.icon;
              return (
                <div
                  key={idx}
                  className={`flex items-start gap-3 rounded-lg border p-3 ${sev.className}`}
                >
                  <SevIcon className="mt-0.5 h-4 w-4 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold uppercase">{sev.label}</span>
                      <span className="rounded bg-card/60 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        {issue.category}
                      </span>
                      {issue.shotId && (
                        <button
                          onClick={() => navigate(`/project/${id}/storyboard`)}
                          title="跳到分镜页修复该镜头（描述中带有镜头编号）"
                          className="inline-flex items-center gap-1 rounded bg-card/60 px-1.5 py-0.5 text-[10px] font-medium text-primary hover:bg-card"
                        >
                          <Crosshair className="h-3 w-3" />
                          镜头 {issue.shotId.slice(0, 8)} · 去修复
                        </button>
                      )}
                    </div>
                    <p className="mt-1 text-sm">{issue.description}</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* History trend */}
      {history.length > 1 && (
        <div className="rounded-xl border bg-card p-6 shadow-sm">
          <h3 className="text-base font-semibold text-foreground">历次评分对比</h3>
          <div className="mt-4 flex h-28 items-end gap-3">
            {[...history].reverse().map((h, i) => (
              <div key={h.id} className="flex flex-1 flex-col items-center gap-1.5">
                <span className="text-xs font-semibold text-foreground">{Math.round(h.overallScore)}</span>
                <div
                  className={`w-full rounded-t-md ${i === history.length - 1 ? 'bg-primary' : 'bg-primary/30'}`}
                  style={{ height: `${Math.max(6, (h.overallScore / 100) * 80)}px` }}
                  title={`${new Date(h.createdAt).toLocaleString('zh-CN')} · ${Math.round(h.overallScore)} 分`}
                />
                <span className="text-[10px] text-muted-foreground">
                  {i === history.length - 1 ? '本次' : `前${history.length - 1 - i}次`}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recommendations */}
      <div className="rounded-xl border bg-card p-6 shadow-sm">
        <div className="flex items-center gap-2">
          <Lightbulb className="h-5 w-5 text-amber-300" />
          <h3 className="text-base font-semibold text-foreground">优化建议</h3>
        </div>
        {(!report.recommendations || report.recommendations.length === 0) ? (
          <div className="mt-4 text-sm text-muted-foreground">
            暂无建议
          </div>
        ) : (
          <ul className="mt-4 space-y-2">
            {report.recommendations.map((rec, idx) => (
              <li key={idx} className="flex items-start gap-2 text-sm">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                <div>
                  <span className="font-medium text-foreground">{rec.category}：</span>
                  <span className="text-muted-foreground">{rec.suggestion}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

export default ProjectQcTab;
