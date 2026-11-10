import { axiosForBackend } from '@client/src/api/http';
import type {
  Character,
  Location,
  Prop,
  WorldView,
  StyleBible,
  CreateCharacterRequest,
  UpdateCharacterRequest,
  CreateLocationRequest,
  UpdateLocationRequest,
  CreatePropRequest,
  UpdatePropRequest,
  GenerateBibleRequest,
  GenerateBibleResponse,
  GeneratePropsResponse,
} from '@shared/api.interface';

export const getWorldView = (projectId: string) =>
  axiosForBackend
    .get<WorldView>(`/api/projects/${projectId}/bible/worldview`)
    .then((res) => res.data);

export const updateWorldView = (projectId: string, data: WorldView) =>
  axiosForBackend
    .put<WorldView>(`/api/projects/${projectId}/bible/worldview`, data)
    .then((res) => res.data);

export const getStyleBible = (projectId: string) =>
  axiosForBackend
    .get<StyleBible>(`/api/projects/${projectId}/bible/style`)
    .then((res) => res.data);

export const updateStyleBible = (projectId: string, data: StyleBible) =>
  axiosForBackend
    .put<StyleBible>(`/api/projects/${projectId}/bible/style`, data)
    .then((res) => res.data);

export const listCharacters = (projectId: string) =>
  axiosForBackend
    .get<Character[]>(`/api/projects/${projectId}/bible/characters`)
    .then((res) => res.data);

export const getCharacter = (projectId: string, id: string) =>
  axiosForBackend
    .get<Character>(`/api/projects/${projectId}/bible/characters/${id}`)
    .then((res) => res.data);

export const createCharacter = (
  projectId: string,
  data: CreateCharacterRequest,
) =>
  axiosForBackend
    .post<Character>(`/api/projects/${projectId}/bible/characters`, data)
    .then((res) => res.data);

export const updateCharacter = (
  projectId: string,
  id: string,
  data: UpdateCharacterRequest,
) =>
  axiosForBackend
    .patch<Character>(
      `/api/projects/${projectId}/bible/characters/${id}`,
      data,
    )
    .then((res) => res.data);

export const deleteCharacter = (projectId: string, id: string) =>
  axiosForBackend
    .delete<{ id: string }>(
      `/api/projects/${projectId}/bible/characters/${id}`,
    )
    .then((res) => res.data);

export const listLocations = (projectId: string) =>
  axiosForBackend
    .get<Location[]>(`/api/projects/${projectId}/bible/locations`)
    .then((res) => res.data);

export const getLocation = (projectId: string, id: string) =>
  axiosForBackend
    .get<Location>(`/api/projects/${projectId}/bible/locations/${id}`)
    .then((res) => res.data);

export const createLocation = (
  projectId: string,
  data: CreateLocationRequest,
) =>
  axiosForBackend
    .post<Location>(`/api/projects/${projectId}/bible/locations`, data)
    .then((res) => res.data);

export const updateLocation = (
  projectId: string,
  id: string,
  data: UpdateLocationRequest,
) =>
  axiosForBackend
    .patch<Location>(`/api/projects/${projectId}/bible/locations/${id}`, data)
    .then((res) => res.data);

export const deleteLocation = (projectId: string, id: string) =>
  axiosForBackend
    .delete<{ id: string }>(`/api/projects/${projectId}/bible/locations/${id}`)
    .then((res) => res.data);

/** P1 断链修复：人物/场景图生成走嵌套端点（之前调用不存在的 /api/generation/image，必 404） */
export const generateCharacterImage = (projectId: string, id: string) =>
  axiosForBackend
    .post<{ jobId: string }>(
      `/api/projects/${projectId}/bible/characters/${id}/generate-image`,
    )
    .then((res) => res.data);

/** W4 一致性：标准描述一键补全 */
export const completeCharacterDescription = (projectId: string, id: string) =>
  axiosForBackend
    .post<Character>(
      `/api/projects/${projectId}/bible/characters/${id}/complete-description`,
    )
    .then((res) => res.data);

export const generateLocationImage = (projectId: string, id: string) =>
  axiosForBackend
    .post<{ jobId: string }>(
      `/api/projects/${projectId}/bible/locations/${id}/generate-image`,
    )
    .then((res) => res.data);

/** 人物「1 张主图 + 四视图」形象包：一次提交缺口的独立生成任务 */
export const generateIdentityKit = (projectId: string, id: string) =>
  axiosForBackend
    .post<{ jobIds: string[] }>(
      `/api/projects/${projectId}/bible/characters/${id}/generate-identity-kit`,
    )
    .then((res) => res.data);

export const listProps = (projectId: string) =>
  axiosForBackend
    .get<Prop[]>(`/api/projects/${projectId}/bible/props`)
    .then((res) => res.data);

export const getProp = (projectId: string, id: string) =>
  axiosForBackend
    .get<Prop>(`/api/projects/${projectId}/bible/props/${id}`)
    .then((res) => res.data);

export const createProp = (projectId: string, data: CreatePropRequest) =>
  axiosForBackend
    .post<Prop>(`/api/projects/${projectId}/bible/props`, data)
    .then((res) => res.data);

export const updateProp = (projectId: string, id: string, data: UpdatePropRequest) =>
  axiosForBackend
    .patch<Prop>(`/api/projects/${projectId}/bible/props/${id}`, data)
    .then((res) => res.data);

export const deleteProp = (projectId: string, id: string) =>
  axiosForBackend
    .delete<{ id: string }>(`/api/projects/${projectId}/bible/props/${id}`)
    .then((res) => res.data);

/** 道具页 AI 一键生成：只从剧本抽取道具，不改动世界观/人物/场景 */
export const generateProps = (
  projectId: string,
  data: GenerateBibleRequest = {},
) =>
  axiosForBackend
    .post<GeneratePropsResponse>(
      `/api/projects/${projectId}/bible/props/generate`,
      data,
    )
    .then((res) => res.data);

/** 道具设定图生成任务：完成后自动回写 props.referenceImageUrls */
export const generatePropImage = (projectId: string, id: string) =>
  axiosForBackend
    .post<{ jobId: string }>(
      `/api/projects/${projectId}/bible/props/${id}/generate-image`,
    )
    .then((res) => res.data);

/**
 * 一键生成完整制作圣经：世界观 + 风格 + 人物 + 场景 + 道具。
 * 不传 scriptText 时服务端自行读取项目剧本 / 场次 / 简介。
 * source=fallback 表示模型不可用，返回的是按剧本规则生成的可编辑草稿。
 */
export const generateBible = (
  projectId: string,
  data: GenerateBibleRequest = {},
) =>
  axiosForBackend
    .post<GenerateBibleResponse>(
      `/api/projects/${projectId}/bible/generate`,
      data,
    )
    .then((res) => res.data);
