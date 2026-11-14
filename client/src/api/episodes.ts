import { axiosForBackend } from '@client/src/api/http';
import type {
  Character,
  Episode,
  EpisodeProgress,
  HandoffState,
  Scene,
  Shot,
} from '@shared/api.interface';

/** 按集确认门阶段（对齐 server/modules/episodes/dto.ts） */
export type EpisodeApproveStage = 'script' | 'storyboard' | 'preview' | 'final';

/**
 * 集（长篇多集架构，migration 0024）前端 API。
 * 端点与 server/modules/episodes/episodes.controller.ts 一一对应：
 * /api/projects/:projectId/episodes[...]
 */

const base = (projectId: string) => `/api/projects/${projectId}/episodes`;

/** 集列表（按 season/number 升序）；season 缺省返回全部季 */
export const listEpisodes = (projectId: string, season?: number) =>
  axiosForBackend
    .get<Episode[]>(base(projectId), { params: season !== undefined ? { season } : undefined })
    .then((res) => res.data);

/** 全项目管线进度按集聚合（任务面板按集分组的数据源） */
export const listEpisodeProgress = (projectId: string) =>
  axiosForBackend
    .get<EpisodeProgress[]>(`${base(projectId)}/progress`)
    .then((res) => res.data);

export const getEpisode = (projectId: string, episodeId: string) =>
  axiosForBackend.get<Episode>(`${base(projectId)}/${episodeId}`).then((res) => res.data);

/**
 * 新建集：季内集号服务端自动递增（上限 500）；首个集会把项目切到开集模式
 * （projects.has_episodes=true）并置为活跃集，前端无需单独调「开启多集模式」。
 */
export const createEpisode = (
  projectId: string,
  data: { title?: string; season?: number } = {},
) =>
  axiosForBackend
    .post<Episode>(base(projectId), data)
    .then((res) => res.data);

/**
 * 更新集：title / status（单向推进）/ locked；active=true 等效 activate。
 */
export const updateEpisode = (
  projectId: string,
  episodeId: string,
  data: { title?: string; status?: Episode['status']; locked?: boolean; active?: boolean },
) =>
  axiosForBackend
    .patch<Episode>(`${base(projectId)}/${episodeId}`, data)
    .then((res) => res.data);

/** 删除集：挂 shots/scenes 时必须显式 force=true（应用层级联） */
export const deleteEpisode = (projectId: string, episodeId: string, force = false) =>
  axiosForBackend
    .delete<{ deleted: true }>(
      `${base(projectId)}/${episodeId}${force ? '?force=true' : ''}`,
    )
    .then((res) => res.data);

// ========== 按集查询（前端按集加载：选择集后 storyboard/scenes/characters 走这里） ==========

export const listEpisodeShots = (projectId: string, episodeId: string) =>
  axiosForBackend
    .get<Shot[]>(`${base(projectId)}/${episodeId}/shots`)
    .then((res) => res.data);

export const listEpisodeScenes = (projectId: string, episodeId: string) =>
  axiosForBackend
    .get<Scene[]>(`${base(projectId)}/${episodeId}/scenes`)
    .then((res) => res.data);

/** 集内角色 = 本集专属 + 全剧公共资产（episode_id IS NULL） */
export const listEpisodeCharacters = (projectId: string, episodeId: string) =>
  axiosForBackend
    .get<Character[]>(`${base(projectId)}/${episodeId}/characters`)
    .then((res) => res.data);

// ========== 跨集交接账本（B2） ==========

export const getHandoff = (projectId: string, episodeId: string) =>
  axiosForBackend
    .get<HandoffState>(`${base(projectId)}/${episodeId}/handoff`)
    .then((res) => res.data);

export const appendFact = (projectId: string, episodeId: string, text: string) =>
  axiosForBackend
    .post<HandoffState>(`${base(projectId)}/${episodeId}/handoff/facts`, { text })
    .then((res) => res.data);

export const resolveProp = (projectId: string, episodeId: string, name: string, holder: string) =>
  axiosForBackend
    .post<HandoffState>(`${base(projectId)}/${episodeId}/handoff/props`, { name, holder })
    .then((res) => res.data);

export const upsertRelation = (
  projectId: string,
  episodeId: string,
  a: string,
  b: string,
  status: string,
) =>
  axiosForBackend
    .post<HandoffState>(`${base(projectId)}/${episodeId}/handoff/relations`, { a, b, status })
    .then((res) => res.data);

// ========== 按集流水线 ==========

export const getEpisodeProgress = (projectId: string, episodeId: string) =>
  axiosForBackend
    .get<EpisodeProgress>(`${base(projectId)}/${episodeId}/progress`)
    .then((res) => res.data);

/** 按集确认门：stage = script|storyboard|preview|final */
export const approveEpisodeStage = (
  projectId: string,
  episodeId: string,
  stage: EpisodeApproveStage,
) =>
  axiosForBackend
    .post<Episode>(`${base(projectId)}/${episodeId}/approve/${stage}`)
    .then((res) => res.data);

/** 切换当前活跃集（project.metadata.activeEpisodeId），后续新建 shots 自动归入 */
export const activateEpisode = (projectId: string, episodeId: string) =>
  axiosForBackend
    .post<{ active: true }>(`${base(projectId)}/${episodeId}/activate`)
    .then((res) => res.data);
