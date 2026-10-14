import { axiosForBackend } from '@client/src/api/http';
import type { DashboardStats, ProjectListItem, CostSummary } from '@shared/api.interface';

export const getStats = () =>
  axiosForBackend
    .get<DashboardStats>('/api/dashboard/stats')
    .then((res) => res.data);

/** P1 计费真实化：费用汇总全部来自后端落库求和 */
export const getCostSummary = () =>
  axiosForBackend
    .get<CostSummary>('/api/dashboard/cost-summary')
    .then((res) => res.data);

export const getRecentProjects = (limit = 5) =>
  axiosForBackend
    .get<ProjectListItem[]>('/api/dashboard/recent-projects', {
      params: { limit },
    })
    .then((res) => res.data);

export const getActivityFeed = (limit = 10) =>
  axiosForBackend
    .get<{ id: string; type: string; message: string; createdAt: string }[]>(
      '/api/dashboard/activity',
      { params: { limit } },
    )
    .then((res) => res.data);

export const getUsageTrend = (days = 7) =>
  axiosForBackend
    .get<{ date: string; cost: number; jobs: number }[]>(
      '/api/dashboard/usage-trend',
      { params: { days } },
    )
    .then((res) => res.data);
