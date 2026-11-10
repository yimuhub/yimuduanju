import { axiosForBackend, getCsrfToken } from '@client/src/api/http';
import type {
  ChatMessage,
  ChatSession,
  ChatSessionDetail,
  CreateChatSessionRequest,
  StreamChatRequest,
} from '@shared/api.interface';

/** 会话与消息：全部落库，刷新/切页/换设备都能恢复（同账号） */
export const createChatSession = (body: CreateChatSessionRequest = {}) =>
  axiosForBackend.post<ChatSession>('/api/assistant/sessions', body).then((r) => r.data);

export const listChatSessions = (projectId?: string) =>
  axiosForBackend
    .get<ChatSession[]>('/api/assistant/sessions', { params: projectId ? { projectId } : {} })
    .then((r) => r.data);

export const getChatSession = (id: string) =>
  axiosForBackend.get<ChatSessionDetail>(`/api/assistant/sessions/${id}`).then((r) => r.data);

export const updateChatSessionTitle = (id: string, title: string) =>
  axiosForBackend
    .post<ChatSession>(`/api/assistant/sessions/${id}/title`, { title })
    .then((r) => r.data);

export const suggestChatTitle = (text: string, sessionId?: string) =>
  axiosForBackend
    .post<{ title: string }>('/api/assistant/suggest-title', { text, sessionId })
    .then((r) => r.data.title);

export const linkChatSession = (id: string, projectId: string, title?: string) =>
  axiosForBackend
    .post<ChatSession>(`/api/assistant/sessions/${id}/link`, { projectId, title })
    .then((r) => r.data);

export interface StreamChatHandlers {
  onUser?: (message: ChatMessage) => void;
  onDelta?: (delta: string) => void;
  onDone?: (message: ChatMessage) => void;
  onError?: (message: string) => void;
}

/**
 * 流式对话（fetch + SSE）。返回的 promise 在流结束时 resolve。
 * abort 后已生成的部分内容由服务端保管（重新进入会话可见）。
 */
export async function streamChatSession(
  sessionId: string,
  body: StreamChatRequest,
  handlers: StreamChatHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const token = getCsrfToken();
  const res = await fetch(`/api/assistant/sessions/${sessionId}/messages/stream`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'X-Suda-Csrf-Token': token } : {}),
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const data = (await res.json()) as { message?: string };
      if (data?.message) detail = data.message;
    } catch {
      /* 非 JSON 错误体 */
    }
    throw new Error(detail);
  }
  if (!res.body) throw new Error('浏览器不支持流式响应');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const dispatch = (block: string) => {
    let event = 'delta';
    const dataLines: string[] = [];
    for (const rawLine of block.split('\n')) {
      const line = rawLine.trimEnd();
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
    }
    if (dataLines.length === 0) return;
    let payload: { delta?: string; message?: ChatMessage | string } = {};
    try {
      payload = JSON.parse(dataLines.join('\n'));
    } catch {
      return;
    }
    if (event === 'user' && payload.message && typeof payload.message !== 'string') {
      handlers.onUser?.(payload.message);
      return;
    }
    if (event === 'done' && payload.message && typeof payload.message !== 'string') {
      handlers.onDone?.(payload.message);
      return;
    }
    if (event === 'error') {
      handlers.onError?.(
        typeof payload.message === 'string' ? payload.message : 'AI 回复失败',
      );
      return;
    }
    if (typeof payload.delta === 'string' && payload.delta) handlers.onDelta?.(payload.delta);
  };

  try {
    for (;;) {
      // eslint-disable-next-line no-await-in-loop
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split('\n\n');
      buffer = blocks.pop() ?? '';
      for (const block of blocks) dispatch(block);
    }
    if (buffer.trim()) dispatch(buffer);
  } catch (e) {
    // 用户主动停止：不是错误，保留已生成内容
    if ((e as { name?: string } | null)?.name === 'AbortError') return;
    throw e;
  }
}