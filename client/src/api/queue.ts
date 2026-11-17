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

/** 给项目钉一把 Key；keyId 传 null 表示解钉；mode=exclusive 表示该 Key 只服务此项目 */
export const pinProjectKey = (
  projectId: string,
  keyId: string | null,
  mode?: 'shared' | 'exclusive',
) =>
  axiosForBackend
    .post<PinProjectKeyResult>(`/api/queue/projects/${projectId}/pin-key`, { keyId, mode })
    .then((res) => res.data);

/** 重算排队任务的通道路由：改完「环节绑定」后点一下，老任务才会走新模型 */
export const recalculateRoutes = () =>
  axiosForBackend
    .post<{ updated: number; skipped: number; message: string }>('/api/queue/recalculate-routes')
    .then((res) => res.data);


/** 重启：终止/失败/暂停的任务重新回到排队 */
export const restartQueueJob = (id: string) =>
  axiosForBackend
    .post<QueueActionResult>(`/api/queue/jobs/${id}/restart`)
    .then((res) => res.data);

/** 全部冻结：排队任务暂停，执行中任务终止；之后可逐个恢复/重启 */
export const pauseAllQueueJobs = () =>
  axiosForBackend
    .post<{ paused: number; terminated: number; message: string }>('/api/queue/jobs/pause-all')
    .then((res) => res.data);


/** 单项目暂停：项目状态变「暂停中」，任务暂停/终止 */
export const pauseProjectJobs = (projectId: string) =>
  axiosForBackend
    .post<{ paused: number; terminated: number; message: string }>(`/api/queue/projects/${projectId}/pause`)
    .then((res) => res.data);

/** 单项目重启：恢复项目状态并重新排队 */
export const resumeProjectJobs = (projectId: string) =>
  axiosForBackend
    .post<{ resumed: number; status: string; message: string }>(`/api/queue/projects/${projectId}/resume`)
    .then((res) => res.data);
