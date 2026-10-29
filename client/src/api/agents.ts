import { axiosForBackend } from '@client/src/api/http';
import type {
  AgentMessage,
  SendAgentMessageRequest,
} from '@shared/api.interface';

export const listMessages = (projectId: string) =>
  axiosForBackend
    .get<AgentMessage[]>(`/api/projects/${projectId}/agents/messages`)
    .then((res) => res.data);

export const sendMessage = (projectId: string, data: SendAgentMessageRequest) =>
  axiosForBackend
    .post<AgentMessage>(
      `/api/projects/${projectId}/agents/messages`,
      data,
    )
    .then((res) => res.data);

export const clearMessages = (projectId: string) =>
  axiosForBackend
    .delete<{ cleared: number }>(
      `/api/projects/${projectId}/agents/messages`,
    )
    .then((res) => res.data);

// P1 诚信清理：已删除调用不存在路由（404）的 listAgents；智能体列表为前端静态配置。

/** Agent 注册表项（3.0：后端动态下发，前端不再写死 Agent 列表） */
export interface AgentRegistryItem {
  id: string;
  name: string;
  avatar: string;
  persona: string;
  skillSlugs: string[];
  tools: string[];
  sort: number;
  source: string;
}

export const listRegistry = () =>
  axiosForBackend
    .get<AgentRegistryItem[]>('/api/agents/registry')
    .then((res) => res.data);
