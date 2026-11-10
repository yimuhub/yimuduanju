import { axiosForBackend } from '@client/src/api/http';
import type { Asset } from '@shared/api.interface';

/** 服务端成片合成：镜头按镜序 ffmpeg 拼接 → 落盘 → 登记项目资产 */
export const assembleVideo = (projectId: string) =>
  axiosForBackend
    .post<{ asset: Asset; clips: number; durationSeconds: number }>(
      `/api/projects/${projectId}/export/assemble`,
    )
    .then((res) => res.data);

/**
 * 远端媒体经服务端代理取流（同源，绕开浏览器 CORS，修复浏览器端合成 "Failed to fetch"）。
 * 本地 /uploads、blob:、data: 地址原样返回，不走代理。
 */
export const mediaProxyUrl = (projectId: string, url: string): string => {
  if (!/^https?:\/\//i.test(url)) return url;
  return `/api/projects/${projectId}/export/media?url=${encodeURIComponent(url)}`;
};

/**
 * 交付物下载：裸 <a href> 导航无法携带 CSRF 头（框架对 /api/* 全方法校验）会 403。
 * 改走 axios 取 blob（自动带 X-Suda-Csrf-Token）再触发浏览器保存。文件名取 URL 末段。
 */
export const downloadDeliverable = async (url: string): Promise<void> => {
  const res = await axiosForBackend.get(url, { responseType: 'blob' });
  const fileName = decodeURIComponent(url.split('?')[0].split('/').pop() || 'download');
  const blobUrl = URL.createObjectURL(res.data as Blob);
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
};

/** 导出清单（readiness 检查用）：走 axios 带 CSRF 头，裸 fetch 会 403 */
export const getManifest = (projectId: string) =>
  axiosForBackend
    .get(`/api/projects/${projectId}/export/manifest.json`)
    .then((res) => res.data);
