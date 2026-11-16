/**
 * 成片确认门的质检裁定（纯函数，便于回归测试）。
 *
 * 背景：质检分三档（PASS / REVIEW / FAIL），UI 上 REVIEW 明确标「需人工复核」，
 * 但旧实现只认 pass === true —— 88 分的成片永远点不动「确认成片」，
 * 表现为前端只弹「Request failed with status code 400」的死锁。
 *
 * 裁定规则：
 * - PASS（score >= thresholdPass）：直接放行，无需覆盖。
 * - REVIEW（thresholdReview <= score < thresholdPass）：放行，但打 override 标记，
 *   由本次人工确认承担拍板责任并留审计痕迹。
 * - FAIL（score < thresholdReview）：硬拦，返回可读原因。
 *
 * 注意：镜头成片 M/N 齐备是另一道硬校验（pipeline-readiness），
 * 不在本函数内，不能被复核带放行绕过。
 */

export interface QcGateInput {
  /** 最近一次质检总分（0-100） */
  score: number;
  /** PASS 线，默认 90 */
  thresholdPass?: number;
  /** 复核线，默认 80 */
  thresholdReview?: number;
  /** 问题条数，仅用于文案 */
  issueCount?: number;
  /** 质检报告自身的 pass 字段；缺报告时为 undefined */
  pass?: boolean;
}

export interface QcGateDecision {
  /** 是否放行成片确认 */
  allow: boolean;
  /** 是否属于「复核带人工放行」（需要写审计痕迹） */
  override: boolean;
  /** 被拦时给用户看的原因 */
  reason?: string;
}

export const QC_DEFAULT_THRESHOLD_PASS = 90;
export const QC_DEFAULT_THRESHOLD_REVIEW = 80;

export function decideQcGate(input: QcGateInput): QcGateDecision {
  const thresholdPass = clamp(input.thresholdPass ?? QC_DEFAULT_THRESHOLD_PASS);
  const thresholdReview = Math.min(
    clamp(input.thresholdReview ?? QC_DEFAULT_THRESHOLD_REVIEW),
    thresholdPass,
  );
  const score = clamp(input.score ?? 0);
  const issueCount = Math.max(0, Math.round(input.issueCount ?? 0));

  if (input.pass === true) return { allow: true, override: false };
  if (score >= thresholdPass) return { allow: true, override: false };
  if (score >= thresholdReview) return { allow: true, override: true };

  return {
    allow: false,
    override: false,
    reason:
      `质检未通过（${score} 分，低于复核线 ${thresholdReview} 分 / ${issueCount} 条问题），` +
      '请修复后重新质检再确认成片',
  };
}

function clamp(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

/** 质检 issue 分类 → 人能看懂的中文（用于成片门/质检任务的失败原因文案） */
export const QC_CATEGORY_LABELS: Record<string, string> = {
  job: '生成任务失败',
  image: '缺首帧图',
  motion: '缺成片',
  audio: '缺配音',
  subtitle: '字幕',
  previz: '分镜可拍性',
  character: '角色一致性',
  consistency: '一致性',
  scene: '场景',
  empty: '空项目',
  overflow: '问题过多',
};

export interface QcIssueLike {
  category?: string;
  severity?: string;
}

export interface QcIssueSummary {
  total: number;
  errors: number;
  /** 出现最多的 2 个分类（中文），如「分镜可拍性、字幕」 */
  top: string;
}

export function summarizeQcIssues(issues: QcIssueLike[] | null | undefined): QcIssueSummary {
  const list = Array.isArray(issues) ? issues : [];
  const byCategory = new Map<string, number>();
  let errors = 0;
  for (const it of list) {
    const key = it?.category ?? 'other';
    byCategory.set(key, (byCategory.get(key) ?? 0) + 1);
    if (it?.severity === 'error') errors += 1;
  }
  const top = [...byCategory.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([k]) => QC_CATEGORY_LABELS[k] ?? k)
    .join('、');
  return { total: list.length, errors, top };
}

/**
 * 质检未通过时给用户看的原因。
 * 旧实现把「请补齐失败镜头后重新质检」写死，哪怕真实原因是字幕缺失或景别单一，
 * 用户照着提示去补镜头永远补不好 —— 文案必须由 issue 统计得出。
 */
export function qcFailureReason(score: number, issues: QcIssueLike[] | null | undefined): string {
  const { total, errors, top } = summarizeQcIssues(issues);
  const detail = top ? `（${top}）` : '';
  if (total === 0) return `质检未通过：${score} 分未达通过线`;
  if (errors > 0) return `质检未通过：${errors} 个错误、共 ${total} 条问题${detail}`;
  return `质检未通过：${total} 条问题${detail}`;
}

