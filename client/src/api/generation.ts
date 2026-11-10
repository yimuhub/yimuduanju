import { axiosForBackend, getCsrfToken } from '@client/src/api/http';
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

/** SSE 任务流快照（GET /api/generation/jobs/stream，2s 全量推送） */
export interface JobStreamSnapshot {
  jobs: GenerationJob[];
  terminal: boolean;
  total?: number;
}

/**
 * 订阅任务流（fetch + SSE）。EventSource 无法携带 X-Suda-Csrf-Token，
 * 框架对 /api/* 全方法校验会直接 403，因此改走 fetch 流式读取；
 * 断流或不可用时回调 onError，调用方降级为轮询。
 * 返回 cleanup（中止请求并关闭流）。
 */
export const openJobStream = (
  projectId: string | undefined,
  onData: (snap: JobStreamSnapshot) => void,
  onError?: () => void,
): (() => void) => {
  if (typeof fetch === 'undefined') {
    onError?.();
    return () => {};
  }
  const qs = projectId ? `?projectId=${encodeURIComponent(projectId)}` : '';
  const token = getCsrfToken();
  const controller = new AbortController();
  let closed = false;

  const dispatch = (block: string) => {
    const dataLines: string[] = [];
    for (const line of block.split('\n')) {
      if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
    }
    if (dataLines.length === 0) return;
    try {
      onData(JSON.parse(dataLines.join('\n')) as JobStreamSnapshot);
    } catch {
      /* 忽略坏帧 */
    }
  };

  void (async () => {
    try {
      const res = await fetch(`/api/generation/jobs/stream${qs}`, {
        credentials: 'include',
        headers: token ? { 'X-Suda-Csrf-Token': token } : {},
        signal: controller.signal,
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx = buffer.indexOf('\n\n');
        while (idx >= 0) {
          dispatch(buffer.slice(0, idx));
          buffer = buffer.slice(idx + 2);
          idx = buffer.indexOf('\n\n');
        }
      }
      if (!closed) onError?.();
    } catch (e) {
      if (!closed && (e as { name?: string } | null)?.name !== 'AbortError') onError?.();
    }
  })();

  return () => {
    closed = true;
    controller.abort();
  };
};
