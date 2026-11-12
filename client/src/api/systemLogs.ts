import { axiosForBackend } from '@client/src/api/http';

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'UNKNOWN';

export interface LogFileInfo {
  name: string;
  size: number;
  modifiedAt: string;
  kind: 'server' | 'trace' | 'gateway' | 'events' | 'other';
}

export interface LogEntry {
  source: string;
  ts: string | null;
  level: LogLevel;
  context: string | null;
  message: string;
  traceId: string | null;
  raw: string;
}

export interface EntriesResponse {
  items: LogEntry[];
  scanned: number;
  files: string[];
  truncated: boolean;
}

export interface SystemLogEvent {
  ts: string;
  level: Exclude<LogLevel, 'UNKNOWN'>;
  category: 'upstream' | 'job' | 'exception' | 'worker' | 'artifact' | 'system';
  message: string;
  projectId?: string;
  jobId?: string;
  traceId?: string;
  provider?: string;
  httpStatus?: number;
  detail?: Record<string, unknown>;
}

export interface ErrorDiagnosis {
  code: string;
  title: string;
  cause: string;
  suggestions: string[];
  severity: 'critical' | 'error' | 'warning';
  retryable: boolean;
}

export interface FailureItem {
  id: string;
  projectId: string | null;
  projectTitle: string | null;
  jobType: string;
  targetType: string | null;
  targetId: string | null;
  status: string;
  providerName: string | null;
  errorMessage: string | null;
  retryCount: number;
  createdAt: string | null;
  completedAt: string | null;
  diagnosis: ErrorDiagnosis;
}

export interface LogOverview {
  logFiles: number;
  logBytes: number;
  structuredEvents: number;
  failedJobs24h: number;
  failedJobsTotal: number;
  topCauses: { code: string; title: string; count: number }[];
}

export interface DiagnoseResponse {
  job: Record<string, unknown> | null;
  /** 任务被重试成功后 errorMessage 已清空：这里保留找回的历史失败文本 */
  historicalError: string | null;
  diagnosis: ErrorDiagnosis;
  relatedEvents: SystemLogEvent[];
  relatedLogs: LogEntry[];
  referenceCheck: { path: string; exists: boolean; size?: number }[];
  suggestions: string[];
}

const api = {
  files: () =>
    axiosForBackend.get<LogFileInfo[]>('/api/system-logs/files').then((r) => r.data),

  overview: () =>
    axiosForBackend.get<LogOverview>('/api/system-logs/overview').then((r) => r.data),

  entries: (params: {
    file?: string;
    level?: string;
    q?: string;
    traceId?: string;
    since?: string;
    until?: string;
    limit?: number;
  }) =>
    axiosForBackend
      .get<EntriesResponse>('/api/system-logs/entries', { params })
      .then((r) => r.data),

  events: (params: {
    level?: string;
    category?: string;
    q?: string;
    projectId?: string;
    jobId?: string;
    limit?: number;
  } = {}) =>
    axiosForBackend
      .get<SystemLogEvent[]>('/api/system-logs/events', { params })
      .then((r) => r.data),

  failures: (params: { projectId?: string; q?: string; limit?: number } = {}) =>
    axiosForBackend
      .get<{ items: FailureItem[]; total: number }>('/api/system-logs/failures', { params })
      .then((r) => r.data),

  diagnose: (jobId: string) =>
    axiosForBackend
      .get<DiagnoseResponse>(`/api/system-logs/diagnose/${encodeURIComponent(jobId)}`)
      .then((r) => r.data),
};

export const systemLogsApi = api;
