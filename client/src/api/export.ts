import { axiosForBackend } from '@client/src/api/http';
import type { Asset } from '@shared/api.interface';

/** 服务端成片合成：镜头按镜序 ffmpeg 拼接 → 落盘 → 登记项目资产 */
export const assembleVideo = (projectId: string) =>
  axiosForBackend
    .post<{ asset: Asset; clips: number; durationSeconds: number }>(
      `/api/projects/${projectId}/export/assemble`,
    )
    .then((res) => res.data);
