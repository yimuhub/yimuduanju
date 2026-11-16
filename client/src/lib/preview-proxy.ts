/** 神剪 · 流畅档预览代理地址（540p，服务端一次转码后缓存） */
export const previewProxyUrl = (projectId: string, src: string): string =>
  `/api/projects/${encodeURIComponent(projectId)}/timeline/preview-proxy?src=${encodeURIComponent(src)}`;
