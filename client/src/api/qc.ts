import { axiosForBackend } from '@client/src/api/http';
import type { QcReport } from '@shared/api.interface';

export const listReports = (projectId: string) =>
  axiosForBackend
    .get<QcReport[]>(`/api/projects/${projectId}/qc/reports`)
    .then((res) => res.data);

export const getReport = (projectId: string, id: string) =>
  axiosForBackend
    .get<QcReport>(`/api/projects/${projectId}/qc/reports/${id}`)
    .then((res) => res.data);

export const createReport = (projectId: string) =>
  // P1 断链修复：旧地址 POST .../qc/reports 服务端不存在（404，“开始质检”点了没反应）；
  // 服务端触发路由为 POST /api/projects/:id/qc
  axiosForBackend
    .post<QcReport>(`/api/projects/${projectId}/qc`)
    .then((res) => res.data);

export const retryFailedShots = (projectId: string) =>
  axiosForBackend
    .post<{ jobIds: string[]; retriedShots: number; skipped: number; errors: string[] }>(
      `/api/projects/${projectId}/qc/retry-failed`,
    )
    .then((res) => res.data);

export const getLatestReport = (projectId: string) =>
  axiosForBackend
    .get<QcReport>(`/api/projects/${projectId}/qc/latest`)
    .then((res) => res.data);
