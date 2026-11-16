import { axiosForBackend } from '@client/src/api/http';
import type { AssembleFinalVideoRequest, AssembleFinalVideoResult, Asset, PerShotExportRequest, PerShotExportResult } from '@shared/api.interface';

/**
 * 服务端成片合成：镜头按镜序 ffmpeg 拼接 → 可选 BGM 混音 → 可选硬字幕烧录
 * → 落盘 → 登记项目资产 + 自动提取封面（商业交付级：短剧发布必须带字幕）。
 */
export const assembleVideo = (projectId: string, payload?: AssembleFinalVideoRequest) =>
  axiosForBackend
    .post<AssembleFinalVideoResult>(
      `/api/projects/${projectId}/export/assemble`,
      payload ?? {},
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
 * 改走 axios 取 blob（自动带 X-Suda-Csrf-Token）再触发浏览器保存。
 *
 * 文件名优先读后端给的 Content-Disposition：
 *   /export/final.mp4 这类端点的 URL 末段是「final.mp4」，只有响应头里才有项目名。
 *   旧实现一律用 URL 末段，导出成片下载下来永远叫 final.mp4 —— 与「文件名 = 项目名」
 *   的要求直接冲突。顺序：filename*（RFC 5987，带中文）> filename="..." > URL 末段。
 */
export const downloadDeliverable = async (url: string): Promise<void> => {
  const res = await axiosForBackend.get(url, { responseType: 'blob' });
  const disposition = String(res.headers?.['content-disposition'] ?? '');
  const star = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
  const plain = /filename="([^"]+)"/i.exec(disposition);
  let fileName = '';
  if (star) {
    try {
      fileName = decodeURIComponent(star[1].trim());
    } catch {
      fileName = star[1].trim();
    }
  } else if (plain) {
    fileName = plain[1];
  }
  if (!fileName) {
    fileName = decodeURIComponent(url.split('?')[0].split('/').pop() || 'download');
  }
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

/**
 * 逐镜导出（migration 0025）：每个有视频的镜头独立产出一条归一化 MP4 并登记资产，
 * 可选烧录该镜自己的字幕；单镜失败不阻断整批。
 */
export const exportPerShot = (projectId: string, payload?: PerShotExportRequest) =>
  axiosForBackend
    .post<PerShotExportResult>(`/api/projects/${projectId}/export/per-shot`, payload ?? {})
    .then((res) => res.data);
