import { axiosForBackend } from '@client/src/api/http';
import type { QcReport, VisualAuditReport } from '@shared/api.interface';

export const listReports = (projectId: string) =>
  axiosForBackend
    .get<QcReport[]>(`/api/projects/${projectId}/qc/reports`)
    .then((res) => res.data);

export const getReport = (projectId: string, id: string) =>
  // 断链修复：服务端路由为 GET /api/projects/:projectId/qc/:id（reports/:id 会 404）
  axiosForBackend
    .get<QcReport>(`/api/projects/${projectId}/qc/${id}`)
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

/**
 * 角色一致性看图审计（对标 ArcReel inspect_images）：定妆照 + 场景图 + 最新分镜
 * 首帧逐一对照角色 LOCK 锚点审计，结果写 qc 审计表（auditType=visual）。
 */
export const runVisualAudit = (projectId: string) =>
  axiosForBackend
    .post<VisualAuditReport>(`/api/projects/${projectId}/qc/visual-audit`)
    .then((res) => res.data);

export const getLatestVisualAudit = (projectId: string) =>
  axiosForBackend
    .get<VisualAuditReport | null>(`/api/projects/${projectId}/qc/visual-audit/latest`)
    .then((res) => res.data);
