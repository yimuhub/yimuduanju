/**
 * 质检「失败任务」口径：只算仍未被重试成功取代的失败。
 *
 * 历史坑（2026-11-16 唐朝甜宠番外二 确认成片 400）：
 * 镜头视频任务在 11-14 撞上游 503 失败，次日重试成功并写回 shots.video_url，
 * 但 generation_jobs 里那条 failed 行还在。质检把它当成「当前错误」，
 * pass 永远 false → 成片确认门永久 400，重跑质检也没用（分数是另一维度算的）。
 *
 * 判定：同一 target（jobType|targetType|targetId）存在「晚于该次失败」的成功任务，
 * 这次失败即视为已被重试覆盖；失败发生在最后一次成功之后，则仍是活错误。
 */

export interface QcJobLike {
  jobType: string;
  targetType?: string | null;
  targetId?: string | null;
  status: string;
  createdAt?: Date | string | null;
  completedAt?: Date | string | null;
}

function toMs(v: Date | string | null | undefined, fallback = 0): number {
  if (!v) return fallback;
  const t = v instanceof Date ? v.getTime() : new Date(v).getTime();
  return Number.isFinite(t) ? t : fallback;
}

function targetKey(job: QcJobLike): string | null {
  if (!job.targetId) return null;
  return `${job.jobType}|${job.targetType ?? ''}|${job.targetId}`;
}

/** 每个 target 最后一次成功任务的完成时间（无 target 的任务不参与） */
export function lastSuccessByTarget(jobs: QcJobLike[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const j of jobs) {
    if (j.status !== 'succeeded') continue;
    const key = targetKey(j);
    if (!key) continue;
    const at = toMs(j.completedAt ?? j.createdAt);
    if (at > (map.get(key) ?? 0)) map.set(key, at);
  }
  return map;
}

/** 该失败是否已被后续成功任务覆盖 */
export function isSupersededFailure(
  job: QcJobLike,
  lastSuccessAt: Map<string, number>,
): boolean {
  if (job.status !== 'failed') return false;
  const key = targetKey(job);
  if (!key) return false;
  const succeededAt = lastSuccessAt.get(key);
  if (succeededAt === undefined) return false;
  return toMs(job.createdAt, 0) < succeededAt;
}

/** 质检应报告为「当前问题」的失败任务 */
export function collectLiveFailedJobs<T extends QcJobLike>(jobs: T[]): T[] {
  const lastSuccess = lastSuccessByTarget(jobs);
  return jobs.filter((j) => j.status === 'failed' && !isSupersededFailure(j, lastSuccess));
}
