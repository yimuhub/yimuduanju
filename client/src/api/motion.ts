import { axiosForBackend } from '@client/src/api/http';
import type { MotionDocument, MotionProject } from '@shared/html-motion';

export type MotionRenderJob = {
  id: string;
  projectId: string;
  status: 'queued' | 'capturing' | 'encoding' | 'done' | 'failed';
  progress: number;
  message: string;
  outputUrl?: string;
  error?: string;
};

export const listMotionProjects = () =>
  axiosForBackend.get<MotionProject[]>('/api/motion/projects').then((r) => r.data);

export const createMotionProject = (data: { title?: string; document?: MotionDocument }) =>
  axiosForBackend.post<MotionProject>('/api/motion/projects', data).then((r) => r.data);

export const getMotionProject = (id: string) =>
  axiosForBackend.get<MotionProject>(`/api/motion/projects/${id}`).then((r) => r.data);

export const updateMotionProject = (
  id: string,
  data: { title?: string; document?: MotionDocument },
) => axiosForBackend.patch<MotionProject>(`/api/motion/projects/${id}`, data).then((r) => r.data);

export const deleteMotionProject = (id: string) =>
  axiosForBackend.delete(`/api/motion/projects/${id}`).then((r) => r.data);

export const startMotionRender = (id: string) =>
  axiosForBackend.post<MotionRenderJob>(`/api/motion/projects/${id}/render`).then((r) => r.data);

export const getMotionRender = (jobId: string) =>
  axiosForBackend.get<MotionRenderJob>(`/api/motion/render/${jobId}`).then((r) => r.data);
