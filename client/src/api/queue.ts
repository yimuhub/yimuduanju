/**
 * 全站排队 API（/api/queue/*）
 * 与 generation.listJobs 的区别：这里按「真实执行顺序」返回未完成的任务，
 * 并带项目名、等待时长、依赖原因与各项目排队深度；所有写操作都是人工干预。
 */
import { axiosForBackend } from '@client/src/api/http';
import type {
  KeyLanesResponse,
  PinProjectKeyResult,
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

/** 密钥车道：一把 Key = 一条独立并发车道（并发额度 / 在途 / 冷却 / 钉住的项目） */
export const keyLanes = () =>
  axiosForBackend.get<KeyLanesResponse>('/api/queue/key-lanes').then((res) => res.data);

/** 给项目钉一把 Key；keyId 传 null 表示解钉 */
export const pinProjectKey = (projectId: string, keyId: string | null) =>
  axiosForBackend
    .post<PinProjectKeyResult>(`/api/queue/projects/${projectId}/pin-key`, { keyId })
    .then((res) => res.data);

/** 重算排队任务的通道路由：改完「环节绑定」后点一下，老任务才会走新模型 */
export const recalculateRoutes = () =>
  axiosForBackend
    .post<{ updated: number; skipped: number; message: string }>('/api/queue/recalculate-routes')
    .then((res) => res.data);
