import { axiosForBackend } from '@client/src/api/http';
import type { AssistantChatResponse } from '@shared/api.interface';

/** 后端模型网关超时 60s，这里留 15s 余量；超时给可读提示而不是一直转圈 */
const CHAT_TIMEOUT_MS = 75_000;

export const chat = (message: string) =>
  axiosForBackend
    .post<AssistantChatResponse>('/api/assistant/chat', { message }, { timeout: CHAT_TIMEOUT_MS })
    .then((res) => res.data)
    .catch((err: unknown) => {
      const e = err as { code?: string; message?: string; response?: { data?: { message?: string } } };
      const upstream = e.response?.data?.message;
      if (upstream) throw new Error(upstream);
      if (e.code === 'ECONNABORTED' || /timeout/i.test(e.message ?? '')) {
        throw new Error('AI 回复超时（60 秒未返回），请重试或缩短输入');
      }
      throw err;
    });
