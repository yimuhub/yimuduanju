/**
 * 线性剪辑时间线 API（P2 镜头清单编辑 / P3 EDL / P4 导出）
 * -------------------------------------------------------------
 * 路由契约见 shared/api.interface.ts 底部「线性剪辑」注释块：
 *   POST /api/projects/:projectId/storyboard/shots/reorder    ReorderShotsRequest → Shot[]
 *   POST /api/projects/:projectId/storyboard/shots/:id/split  SplitShotRequest    → SplitShotResult
 *   GET  /api/projects/:projectId/timeline                    → TimelineDocument
 *   PUT  /api/projects/:projectId/timeline                    SaveTimelineRequest → TimelineDocument
 *   POST /api/projects/:projectId/timeline/export             ExportTimelineRequest → ExportTimelineResult
 *
 * 全部走 axiosForBackend（自动携带 CSRF 头）。后端未就绪时会抛错，
 * 由调用方（useTimelineEditor）toast 报错并回滚乐观更新。
 */
import { axiosForBackend } from '@client/src/api/http';
import type { TimelineOp, TimelineOpDiff } from '@shared/timeline-ops';
import type {
  Shot,
  ReorderShotsRequest,
  SplitShotRequest,
  SplitShotResult,
  TimelineDocument,
  SaveTimelineRequest,
  ExportTimelineRequest,
  ExportTimelineResult,
  TimelineThumbnails,
  TimelineWaveform,
} from '@shared/api.interface';

/** P2：按数组顺序重排镜头（服务端重编 sortOrder/shotNumber），返回全量镜头 */
export const reorderShots = (projectId: string, shotIds: string[]) =>
  axiosForBackend
    .post<Shot[]>(
      `/api/projects/${projectId}/storyboard/shots/reorder`,
      { shotIds } satisfies ReorderShotsRequest,
    )
    .then((res) => res.data);

/** P2：在镜头内 atSecond 秒处分割为两条（视频文件不切，按入出点取段） */
export const splitShot = (projectId: string, shotId: string, atSecond: number) =>
  axiosForBackend
    .post<SplitShotResult>(
      `/api/projects/${projectId}/storyboard/shots/${shotId}/split`,
      { atSecond } satisfies SplitShotRequest,
    )
    .then((res) => res.data);

/** P3：读取剪辑工程 EDL（本期前端暂未接入，预留） */
export const getTimeline = (projectId: string) =>
  axiosForBackend
    .get<TimelineDocument>(`/api/projects/${projectId}/timeline`)
    .then((res) => res.data);

/** P3：整体保存剪辑工程（事务替换，预留） */
export const saveTimeline = (projectId: string, data: SaveTimelineRequest) =>
  axiosForBackend
    .put<TimelineDocument>(`/api/projects/${projectId}/timeline`, data)
    .then((res) => res.data);

/**
 * 对话驱动剪辑：服务端事务应用一批动作（版本校验 + 审计 + 幂等）。
 * 客户端先本地 dry-run 同款纯函数，再调这里落库。
 */
export interface AgentTimelineOpsRequest {
  baseVersion: number;
  ops: TimelineOp[];
  summary?: string;
  idempotencyKey?: string;
  sessionId?: string;
  messageId?: string;
}

export interface AgentTimelineOpsResponse {
  doc: TimelineDocument;
  diffs: TimelineOpDiff[];
  auditId: string;
  idempotent: boolean;
}

export const applyTimelineAgentOps = (
  projectId: string,
  data: AgentTimelineOpsRequest,
) =>
  axiosForBackend
    .post<AgentTimelineOpsResponse>(
      `/api/projects/${projectId}/timeline/agent-ops`,
      data,
    )
    .then((res) => res.data);

/** 最近 Agent 剪辑审计记录（只读回放） */
export interface TimelineAgentOpRecord {
  id: string;
  summary: string | null;
  status: string;
  baseVersion: number;
  resultVersion: number;
  createdAt: string;
  diffs: TimelineOpDiff[];
}

export const listTimelineAgentOps = (projectId: string, limit = 20) =>
  axiosForBackend
    .get<TimelineAgentOpRecord[]>(`/api/projects/${projectId}/timeline/agent-ops`, {
      params: { limit },
    })
    .then((res) => res.data);

/** P4：按 EDL 导出成片（预留） */
export const exportTimeline = (projectId: string, data: ExportTimelineRequest = {}) =>
  axiosForBackend
    .post<ExportTimelineResult>(`/api/projects/${projectId}/timeline/export`, data)
    .then((res) => res.data);

/** 视频片段帧缩略图 sprite（服务端抽帧 + 缓存，返回切片元数据） */
export const getThumbnails = (
  projectId: string,
  url: string,
  interval = 1,
  tileWidth = 168,
) =>
  axiosForBackend
    .get<TimelineThumbnails>(`/api/projects/${projectId}/timeline/thumbnails`, {
      params: { url, interval, tileWidth },
    })
    .then((res) => res.data);

/** 音频片段波形 peaks（服务端解码 + 缓存，固定点数由前端重采样） */
export const getWaveform = (projectId: string, url: string, points = 1000) =>
  axiosForBackend
    .get<TimelineWaveform>(`/api/projects/${projectId}/timeline/waveform`, {
      params: { url, points },
    })
    .then((res) => res.data);