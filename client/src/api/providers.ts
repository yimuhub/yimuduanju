import { axiosForBackend } from '@client/src/api/http';
import type {
  ModelProvider,
  CreateProviderRequest,
  UpdateProviderRequest,
  ProviderApiKeyItem,
  ProviderTestResult,
  ProviderConnectionRequest,
  ProviderFetchModelsResult,
} from '@shared/api.interface';

export const listProviders = () =>
  axiosForBackend
    .get<ModelProvider[]>('/api/providers')
    .then((res) => res.data);

export const getProvider = (id: string) =>
  axiosForBackend
    .get<ModelProvider>(`/api/providers/${id}`)
    .then((res) => res.data);

export const createProvider = (data: CreateProviderRequest) =>
  axiosForBackend
    .post<ModelProvider>('/api/providers', data)
    .then((res) => res.data);

export const updateProvider = (id: string, data: UpdateProviderRequest) =>
  axiosForBackend
    .patch<ModelProvider>(`/api/providers/${id}`, data)
    .then((res) => res.data);

export const deleteProvider = (id: string) =>
  axiosForBackend
    .delete<{ id: string }>(`/api/providers/${id}`)
    .then((res) => res.data);

export const testProvider = (id: string) =>
  axiosForBackend
    .post<ProviderTestResult>(`/api/providers/${id}/test`)
    .then((res) => res.data);

/** 用表单参数直接测试连通性（不保存） */
export const testProviderConnection = (data: ProviderConnectionRequest) =>
  axiosForBackend
    .post<ProviderTestResult>('/api/providers/test-connection', data)
    .then((res) => res.data);

/** 获取该密钥下的模型列表 */
export const fetchProviderModels = (data: ProviderConnectionRequest) =>
  axiosForBackend
    .post<ProviderFetchModelsResult>('/api/providers/fetch-models', data)
    .then((res) => res.data);

export const setDefaultProvider = (id: string) =>
  axiosForBackend
    .post<ModelProvider>(`/api/providers/${id}/set-default`)
    .then((res) => res.data);

/** 多 Key 管理（Key 本体只写不显，列表仅返回脱敏标识） */
export const listApiKeys = (id: string) =>
  axiosForBackend
    .get<ProviderApiKeyItem[]>(`/api/providers/${id}/keys`)
    .then((res) => res.data);

export const addApiKey = (id: string, data: { label?: string; apiKey: string }) =>
  axiosForBackend
    .post<ProviderApiKeyItem>(`/api/providers/${id}/keys`, data)
    .then((res) => res.data);

export const activateApiKey = (id: string, keyId: string) =>
  axiosForBackend
    .post<ProviderApiKeyItem[]>(`/api/providers/${id}/keys/${keyId}/activate`)
    .then((res) => res.data);

export const removeApiKey = (id: string, keyId: string) =>
  axiosForBackend
    .delete<void>(`/api/providers/${id}/keys/${keyId}`)
    .then((res) => res.data);

export interface StageBinding {
  stage: string;
  providerId?: string;
  providerName?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  updatedAt?: string;
}

/** B1 分环节模型绑定：list */
export const listStageBindings = () =>
  axiosForBackend.get<StageBinding[]>('/api/providers/stage-bindings').then((res) => res.data);

/** B1 分环节模型绑定：set（空对象 = 清空为默认） */
export const setStageBinding = (
  stage: string,
  data: { providerId?: string | null; model?: string; temperature?: number; maxTokens?: number },
) =>
  axiosForBackend.post<StageBinding>(`/api/providers/stage-bindings/${stage}`, data).then((res) => res.data);

/** B1 分环节模型绑定：clear */
export const clearStageBinding = (stage: string) =>
  axiosForBackend.delete<{ cleared: boolean }>(`/api/providers/stage-bindings/${stage}`).then((res) => res.data);

/** B3 按能力探活（文本/图片/配音各一次最小真实调用） */
export const probeProvider = (id: string, capability: 'text' | 'image' | 'tts') =>
  axiosForBackend
    .post<{ ok: boolean; message: string; latencyMs?: number; url?: string; reply?: string }>(
      `/api/providers/${id}/probe`,
      { capability },
    )
    .then((res) => res.data);
