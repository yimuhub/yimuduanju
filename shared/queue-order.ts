/**
 * 全站排队排序契约（V8）· 单一真源
 * ---------------------------------------------------------------------------
 * 队列顺序只由 `generation_jobs.queue_seq` 决定（数据库序列自增 = 提交顺序）。
 * 这里集中定义「哪些状态还在排队页里」「哪些状态可以人工暂停/调序」，
 * 避免 service / worker / 前端各写一份字符串数组导致口径漂移。
 */
import type { JobStatus, QueueMoveDirection } from './api.interface';

/** 排队页可见、尚未终结的状态 */
export const QUEUE_OPEN_STATUSES: readonly JobStatus[] = [
  'pending',
  'queued',
  'running',
  'retrying',
  'paused',
];

/** 还没开跑、可暂停 / 可调序的状态；running 的任务只提供终止 */
export const QUEUE_NOT_STARTED_STATUSES: readonly JobStatus[] = [
  'pending',
  'queued',
  'retrying',
];

/** 消费器唯一认领的状态：paused / cancelled / 终态都会被跳过 → 后面的任务自动补位 */
export const QUEUE_CLAIM_STATUS: JobStatus = 'pending';

export function isQueueOpen(status: string): boolean {
  return (QUEUE_OPEN_STATUSES as readonly string[]).includes(status);
}

export function isQueueMovable(status: string): boolean {
  return (QUEUE_NOT_STARTED_STATUSES as readonly string[]).includes(status);
}

/** 模拟一轮认领：按 queue_seq 取第一个「pending 且无 blockedReason」的任务 */
export function selectNextClaim<T extends {
  queueSeq: number;
  status: string;
  blockedReason?: string | null;
}>(ordered: T[]): T | null {
  return (
    ordered.find(
      (item) => item.status === QUEUE_CLAIM_STATUS && !item.blockedReason,
    ) ?? null
  );
}

export function compareQueueSeq<T extends { queueSeq: number }>(a: T, b: T): number {
  return a.queueSeq - b.queueSeq;
}

/**
 * 按项目轮转重排（可选的一键公平化）。
 * 稳定：桶按「该项目第一次出现的位置」排序，桶内严格保持原提交顺序；
 * 每轮从每个桶各取一条。单个项目时原样返回，绝不无故打乱镜序。
 */
export function roundRobinByProject<T extends { projectId?: string | null }>(
  ordered: readonly T[],
): T[] {
  if (ordered.length < 2) return [...ordered];
  const buckets = new Map<string, T[]>();
  for (const item of ordered) {
    const key = item.projectId ?? '__no_project__';
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(item);
  }
  if (buckets.size < 2) return [...ordered];
  const out: T[] = [];
  for (let round = 0; out.length < ordered.length; round += 1) {
    let added = false;
    for (const bucket of buckets.values()) {
      const item = bucket[round];
      if (item) {
        out.push(item);
        added = true;
      }
    }
    if (!added) break;
  }
  return out;
}

export const QUEUE_MOVE_DIRECTIONS: readonly QueueMoveDirection[] = [
  'up',
  'down',
  'top',
  'bottom',
];
