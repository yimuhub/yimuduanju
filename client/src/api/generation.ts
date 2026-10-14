import { axiosForBackend } from '@client/src/api/http';
import type {
  GenerationJob,
  JobListParams,
  JobListResponse,
} from '@shared/api.interface';

export const listJobs = (params: JobListParams = {}) =>
  axiosForBackend
    .get<JobListResponse>('/api/generation/jobs', { params })
    .then((res) => res.data);

export const getJob = (id: string) =>
  axiosForBackend
    .get<GenerationJob>(`/api/generation/jobs/${id}`)
    .then((res) => res.data);

export const cancelJob = (id: string) =>
  axiosForBackend
    .post<GenerationJob>(`/api/generation/jobs/${id}/cancel`)
    .then((res) => res.data);

export const retryJob = (id: string) =>
  axiosForBackend
    .post<GenerationJob>(`/api/generation/jobs/${id}/retry`)
    .then((res) => res.data);

export const pollJob = (id: string) =>
  axiosForBackend
    .get<GenerationJob>(`/api/generation/jobs/${id}/poll`)
    .then((res) => res.data);

// P1 诚信清理：已删除调用不存在路由（404）的 generateText/generateImage/
// generateVideo/generateTTS/batchGenerateShots；任务统一走 jobs 接口创建与轮询。

export const adoptJob = (id: string) =>
  axiosForBackend
    .post<GenerationJob>(`/api/generation/jobs/${id}/adopt`)
    .then((res) => res.data);

export const workerStats = () =>
  axiosForBackend
    .get<{ mode: string; concurrency: number; waiting: number; active: number }>(
      '/api/generation/worker-stats',
    )
    .then((res) => res.data);
