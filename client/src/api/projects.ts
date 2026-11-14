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
  PipelineRecoverResult,
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
  // 类型对齐：服务端返回 { success: true }（projects.controller delete）
  axiosForBackend
    .delete<{ success: boolean }>(`/api/projects/${id}`)
    .then((res) => res.data);

export const quickCreate = (data: QuickCreateRequest) =>
  axiosForBackend
    .post<QuickCreateResponse>('/api/projects/quick-create', data)
    .then((res) => res.data);

export const getProgress = (id: string) =>
  axiosForBackend
    .get<ProjectProgressResponse>(`/api/projects/${id}/progress`)
    .then((res) => res.data);

/** 阶段确认门：script=确认剧本→物化分镜；storyboard=确认分镜→前置资产串行链；preview=分镜预览确认→视频段；final=确认成片 */
export const approveProject = (
  id: string,
  stage: 'script' | 'storyboard' | 'preview' | 'final',
) =>
  axiosForBackend
    .post<Project>(`/api/projects/${id}/approve`, { stage })
    .then((res) => res.data);

/**
 * 失败续跑（对标 huobao POST /tasks/:id/recover）：诊断项目全部非终态/失败任务，
 * 可续跑（上游已建单）的从上游续拉不重复计费，需重做的重新排队；已写入镜头的
 * 产物字段一律保留。流程总控页失败段的「诊断并续跑」按钮调用。
 */
export const recoverPipeline = (id: string) =>
  axiosForBackend
    .post<PipelineRecoverResult>(`/api/projects/${id}/pipeline/recover`)
    .then((res) => res.data);
