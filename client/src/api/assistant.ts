import { axiosForBackend } from '@client/src/api/http';
import type { AssistantChatResponse } from '@shared/api.interface';

export const chat = (message: string) =>
  axiosForBackend
    .post<AssistantChatResponse>('/api/assistant/chat', { message })
    .then((res) => res.data);
