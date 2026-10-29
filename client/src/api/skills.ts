import { axiosForBackend } from '@client/src/api/http';

/** Skill 注册表项（3.0 harness 化：流水线槽位按产品线动态注入） */
export interface SkillItem {
  id: string;
  slug: string;
  name: string;
  line: string;
  slot: string;
  description: string;
  body: string;
  enabled: boolean;
  version: number;
  source: string;
}

export const listSkills = (line?: string) =>
  axiosForBackend
    .get<SkillItem[]>('/api/skills', { params: line ? { line } : undefined })
    .then((res) => res.data);

export const setSkillEnabled = (slug: string, enabled: boolean) =>
  axiosForBackend
    .patch<SkillItem>(`/api/skills/${slug}/enabled`, { enabled })
    .then((res) => res.data);

export const updateSkillBody = (slug: string, body: string) =>
  axiosForBackend
    .patch<SkillItem>(`/api/skills/${slug}/body`, { body })
    .then((res) => res.data);
