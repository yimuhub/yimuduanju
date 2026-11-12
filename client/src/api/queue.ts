/**
 * 全站排队 API（/api/queue/*）
 * 与 generation.listJobs 的区别：这里按「真实执行顺序」返回未完成的任务，
 * 并带项目名、等待时长、依赖原因与各项目排队深度；所有写操作都是人工干预。
 */
import { axiosForBackend } from '@client/src/api/http';
import type {
  QueueActionResult,
  QueueMoveDirection,
  QueueOverviewResponse,
} from '@shared/api.interface';

export const queueOverview = () =>
  axiosForBackend
    .get<QueueOverviewResponse>('/api/queue/overview')
    .then((res) => res.data);

export const pauseQueueJob = (id: string) =>
  axiosForBackend
    .post<QueueActionResult>(`/api/queue/jobs/${id}/pause`)
    .then((res) => res.data);

export const resumeQueueJob = (id: string) =>
  axiosForBackend
    .post<QueueActionResult>(`/api/queue/jobs/${id}/resume`)
    .then((res) => res.data);

export const terminateQueueJob = (id: string) =>
  axiosForBackend
    .post<QueueActionResult>(`/api/queue/jobs/${id}/terminate`)
    .then((res) => res.data);

export const moveQueueJob = (id: string, direction: QueueMoveDirection) =>
  axiosForBackend
    .post<QueueActionResult>(`/api/queue/jobs/${id}/move`, { direction })
    .then((res) => res.data);

export const roundRobinQueue = () =>
  axiosForBackend
    .post<{ reordered: number; message: string }>('/api/queue/round-robin')
    .then((res) => res.data);

export const setQueueGlobalPause = (paused: boolean) =>
  axiosForBackend
    .post<{ globallyPaused: boolean; message: string }>('/api/queue/global-pause', { paused })
    .then((res) => res.data);
