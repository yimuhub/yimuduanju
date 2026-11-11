import { axiosForBackend } from '@client/src/api/http';
import type {
  Scene,
  Segment,
  Shot,
  ParseScriptRequest,
  ParseScriptResponse,
  GenerationJob,
  ScriptJobResponse,
  StorySkillInfo,
  StoryStylePreset,
  StoryGenreInfo,
  BlockedVideoSummary,
} from '@shared/api.interface';
import type { ProjectDiagnosis } from '@shared/artifact-state';

export const parseScript = (data: ParseScriptRequest) =>
  // P1 断链修复：旧地址 /api/storyboard/parse-script 服务端不存在（404）；
  // 改走嵌套路由，projectId 以 URL 为准
  axiosForBackend
    .post<ParseScriptResponse>(
      `/api/projects/${data.projectId}/storyboard/parse-script`,
      { scriptText: data.scriptText },
    )
    .then((res) => res.data);

export const listScenes = (projectId: string) =>
  axiosForBackend
    .get<Scene[]>(`/api/projects/${projectId}/storyboard/scenes`)
    .then((res) => res.data);

export const getScene = (projectId: string, id: string) =>
  axiosForBackend
    .get<Scene>(`/api/projects/${projectId}/storyboard/scenes/${id}`)
    .then((res) => res.data);

export const createScene = (
  projectId: string,
  data: Partial<Scene>,
) =>
  axiosForBackend
    .post<Scene>(`/api/projects/${projectId}/storyboard/scenes`, data)
    .then((res) => res.data);

export const updateScene = (
  projectId: string,
  id: string,
  data: Partial<Scene>,
) =>
  axiosForBackend
    .patch<Scene>(`/api/projects/${projectId}/storyboard/scenes/${id}`, data)
    .then((res) => res.data);

export const deleteScene = (projectId: string, id: string) =>
  axiosForBackend
    .delete<{ id: string }>(
      `/api/projects/${projectId}/storyboard/scenes/${id}`,
    )
    .then((res) => res.data);

export const listShots = (projectId: string, sceneId: string) =>
  axiosForBackend
    .get<Shot[]>(
      `/api/projects/${projectId}/storyboard/scenes/${sceneId}/shots`,
    )
    .then((res) => res.data);

/** P1 N+1 修复：一次取回全项目镜头（后端支持 ?sceneId 可选过滤），替代按场景逐个查询 */
export const listAllShots = (projectId: string) =>
  axiosForBackend
    .get<Shot[]>(`/api/projects/${projectId}/storyboard/shots`)
    .then((res) => res.data);

/**
 * 片段列表（场 → 片段 → 镜 的中间层）。
 * 一段 = 同一空间内一段连续动作，≤15 秒含 2-4 镜；轴线与资产引用挂在段上。
 */
export const listSegments = (projectId: string) =>
  axiosForBackend
    .get<Segment[]>(`/api/projects/${projectId}/storyboard/segments`)
    .then((res) => res.data);

/**
 * 一致性体检：产物四态（可用/缺失/过期/阻塞）+ 跳轴、景别、段超长等结构问题。
 * 这是「为什么成片不连贯」在分镜阶段的可见化入口。
 */
export const getConsistency = (projectId: string, requireVideo = false) =>
  axiosForBackend
    .get<ProjectDiagnosis>(
      `/api/projects/${projectId}/storyboard/consistency${requireVideo ? '?requireVideo=true' : ''}`,
    )
    .then((res) => res.data);

/** 存量项目补三级结构：按「≤15 秒 / 2-4 镜」把现有镜头归段并回填 3 秒节拍 */
export const rebuildSegments = (projectId: string) =>
  axiosForBackend
    .post<{ segments: number; shots: number }>(
      `/api/projects/${projectId}/storyboard/segments/rebuild`,
      {},
    )
    .then((res) => res.data);

export const getShot = (projectId: string, shotId: string) =>
  axiosForBackend
    .get<Shot>(`/api/projects/${projectId}/storyboard/shots/${shotId}`)
    .then((res) => res.data);

/** 新建镜头（后端 POST /storyboard/shots 已存在）；时间线「撤销删除」用于重建镜头 */
export const createShot = (projectId: string, data: Partial<Shot>) =>
  axiosForBackend
    .post<Shot>(`/api/projects/${projectId}/storyboard/shots`, data)
    .then((res) => res.data);

export const updateShot = (
  projectId: string,
  shotId: string,
  data: Partial<Shot>,
) =>
  axiosForBackend
    .patch<Shot>(
      `/api/projects/${projectId}/storyboard/shots/${shotId}`,
      data,
    )
    .then((res) => res.data);

export const generateShotImageAt = (projectId: string, shotId: string) =>
  // P1 断链修复：旧 generateShotImage 调不存在的扁平地址（404），改走嵌套端点
  axiosForBackend
    .post<{ jobId: string }>(
      `/api/projects/${projectId}/storyboard/shots/${shotId}/generate-image`,
    )
    .then((res) => res.data);

/** 因首帧未就绪被暂停的视频（按镜头聚合），用于分镜页恢复提示 */
export const listBlockedVideos = (projectId: string) =>
  axiosForBackend
    .get<BlockedVideoSummary>(
      `/api/projects/${projectId}/storyboard/blocked-videos`,
    )
    .then((res) => res.data);

/** 一键为首帧失败/缺失的镜头重新发起首帧 */
export const recoverBlockedVideos = (projectId: string) =>
  axiosForBackend
    .post<{ retried: number; skipped: number; failed: number }>(
      `/api/projects/${projectId}/storyboard/blocked-videos/recover`,
    )
    .then((res) => res.data);

export const generateShotVideoAt = (projectId: string, shotId: string) =>
  // P1 断链修复：同上
  axiosForBackend
    .post<{ jobId: string }>(
      `/api/projects/${projectId}/storyboard/shots/${shotId}/generate-video`,
    )
    .then((res) => res.data);

export const generateShotVoiceAt = (projectId: string, shotId: string) =>
  axiosForBackend
    .post<{ jobId: string }>(
      `/api/projects/${projectId}/storyboard/shots/${shotId}/generate-voice`,
    )
    .then((res) => res.data);

export const deleteShot = (projectId: string, shotId: string) =>
  axiosForBackend
    .delete<void>(`/api/projects/${projectId}/storyboard/shots/${shotId}`)
    .then((res) => res.data);

export const rerunShot = (
  projectId: string,
  shotId: string,
  data: { type: 'image' | 'video' | 'voice' },
) =>
  // P1 断链修复：旧地址 /api/storyboard/rerun-shot 服务端不存在（404）；
  // 签名改为 (projectId, shotId, {type})，调用方同步更新
  axiosForBackend
    .post<GenerationJob>(
      `/api/projects/${projectId}/storyboard/shots/${shotId}/rerun`,
      data,
    )
    .then((res) => res.data);

export const batchGenerate = (
  projectId: string,
  data: { type: 'image' | 'video' | 'voice'; shotIds?: string[] },
) =>
  axiosForBackend
    .post<{ jobIds: string[] }>(
      `/api/projects/${projectId}/storyboard/batch-generate`,
      data,
    )
    .then((res) => res.data);

export const listStorySkills = () =>
  axiosForBackend
    .get<{ skills: StorySkillInfo[]; styles: StoryStylePreset[]; genres: StoryGenreInfo[] }>('/api/story-skills')
    .then((res) => res.data);

export const adaptNovel = (
  projectId: string,
  data: { novelText: string; styleId?: string; rewriteEnabled?: boolean },
) =>
  axiosForBackend
    .post<ScriptJobResponse>(
      `/api/projects/${projectId}/storyboard/adapt-novel`,
      data,
    )
    .then((res) => res.data);

export const rewriteScript = (
  projectId: string,
  data: { scriptText?: string; directives?: string; styleId?: string },
) =>
  axiosForBackend
    .post<ScriptJobResponse>(
      `/api/projects/${projectId}/storyboard/rewrite`,
      data,
    )
    .then((res) => res.data);

export const createAd = (
  projectId: string,
  data: { productBrief: string; styleId?: string; genreId?: string },
) =>
  axiosForBackend
    .post<ScriptJobResponse>(
      `/api/projects/${projectId}/storyboard/create-ad`,
      data,
    )
    .then((res) => res.data);

export interface RigBeat {
  rig: string;
  durationSeconds: number;
  note: string;
}

export const rigScene = (
  projectId: string,
  data: { description: string; totalSeconds?: number },
) =>
  axiosForBackend
    .post<{ skillId: string; beats: RigBeat[] }>(
      `/api/projects/${projectId}/storyboard/rig-scene`,
      data,
    )
    .then((res) => res.data);

export const createShotVariants = (
  projectId: string,
  shotId: string,
  data: { count?: number },
) =>
  axiosForBackend
    .post<{ groupId: string; jobIds: string[] }>(
      `/api/projects/${projectId}/storyboard/shots/${shotId}/variants`,
      data,
    )
    .then((res) => res.data);

export const designCharacters = (
  projectId: string,
  data: { brief: string; styleId?: string; genreId?: string },
) =>
  axiosForBackend
    .post<{ characters: { id: string; name: string }[] }>(
      `/api/projects/${projectId}/storyboard/design-characters`,
      data,
    )
    .then((res) => res.data);

export const scriptToBoards = (
  projectId: string,
  data: { scriptText: string; styleId?: string; genreId?: string; replaceExisting?: boolean },
) =>
  axiosForBackend
    .post<ScriptJobResponse>(
      `/api/projects/${projectId}/storyboard/script-to-boards`,
      data,
    )
    .then((res) => res.data);

export const generateStyleImages = (data: { styleIds?: string[]; providerName?: string }) =>
  axiosForBackend
    .post<{ results: { styleId: string; ok: boolean; file?: string; error?: string }[] }>(
      '/api/story-skills/styles/generate',
      data,
    )
    .then((res) => res.data);

export const oneClickGenerate = (projectId: string, data: { shotIds?: string[] }) =>
  axiosForBackend
    .post<{ image: { jobIds: string[]; reused: string[] }; video: { jobIds: string[]; reused: string[] } }>(
      `/api/projects/${projectId}/storyboard/one-click`,
      data,
    )
    .then((res) => res.data);

/** 旧分镜时长补齐：把低于内容下限的镜头抬到 8-15s，不触发新任务 */
export const normalizeShotDurations = (projectId: string) =>
  axiosForBackend
    .post<{ updated: number; total: number }>(
      `/api/projects/${projectId}/storyboard/normalize-durations`,
      {},
    )
    .then((res) => res.data);

export const generateCharacterSheet = (
  projectId: string,
  characterId: string,
  data: { styleId?: string },
) =>
  axiosForBackend
    .post<{ jobId: string }>(
      `/api/projects/${projectId}/storyboard/characters/${characterId}/sheet`,
      data,
    )
    .then((res) => res.data);
