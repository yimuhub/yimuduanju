import { axiosForBackend } from '@client/src/api/http';
import type { Template, TemplateType } from '@shared/api.interface';

export const listTemplates = (params: {
  templateType?: TemplateType;
  category?: string;
  keyword?: string;
  page?: number;
  pageSize?: number;
} = {}) =>
  axiosForBackend
    .get<{ items: Template[]; total: number; page: number; pageSize: number }>(
      '/api/templates',
      { params },
    )
    .then((res) => res.data);

export const getTemplate = (id: string) =>
  axiosForBackend.get<Template>(`/api/templates/${id}`).then((res) => res.data);

export const createTemplate = (data: Partial<Template>) =>
  axiosForBackend.post<Template>('/api/templates', data).then((res) => res.data);

export const updateTemplate = (id: string, data: Partial<Template>) =>
  axiosForBackend
    .patch<Template>(`/api/templates/${id}`, data)
    .then((res) => res.data);

export const deleteTemplate = (id: string) =>
  axiosForBackend
    .delete<{ id: string }>(`/api/templates/${id}`)
    .then((res) => res.data);

/** W5 模板市场：使用打点 */
export const trackUse = (id: string) =>
  axiosForBackend.post<Template>(`/api/templates/${id}/use`).then((res) => res.data);

/** W5 模板市场：项目存为模板 */
export const saveAsTemplate = (projectId: string, name?: string) =>
  axiosForBackend
    .post<Template>('/api/templates/from-project', { projectId, name })
    .then((res) => res.data);

// P1 诚信清理：后端不存在 /apply 与 /save-as 接口，旧函数调用必 404，已删除；
// 模板套用走“一键创作 ?templateId= 预填”链路（见 CreateWizardPage）。
