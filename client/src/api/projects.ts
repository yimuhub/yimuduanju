import { axiosForBackend } from '@client/src/api/http';
import type {
  Project,
  ProjectListParams,
  ProjectListResponse,
  CreateProjectRequest,
  UpdateProjectRequest,
  QuickCreateRequest,
  QuickCreateResponse,
  ProjectProgressResponse,
} from '@shared/api.interface';

export const listProjects = (params: ProjectListParams = {}) =>
  axiosForBackend
    .get<ProjectListResponse>('/api/projects', { params })
    .then((res) => res.data);

export const getProject = (id: string) =>
  axiosForBackend
    .get<Project>(`/api/projects/${id}`)
    .then((res) => res.data);

export const createProject = (data: CreateProjectRequest) =>
  axiosForBackend
    .post<Project>('/api/projects', data)
    .then((res) => res.data);

export const updateProject = (id: string, data: UpdateProjectRequest) =>
  axiosForBackend
    .patch<Project>(`/api/projects/${id}`, data)
    .then((res) => res.data);

export const deleteProject = (id: string) =>
  axiosForBackend
    .delete<{ id: string }>(`/api/projects/${id}`)
    .then((res) => res.data);

export const quickCreate = (data: QuickCreateRequest) =>
  axiosForBackend
    .post<QuickCreateResponse>('/api/projects/quick-create', data)
    .then((res) => res.data);

export const getProgress = (id: string) =>
  axiosForBackend
    .get<ProjectProgressResponse>(`/api/projects/${id}/progress`)
    .then((res) => res.data);
