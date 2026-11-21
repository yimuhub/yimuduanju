import { axiosForBackend } from '@client/src/api/http';
import type {
  Asset,
  AssetListParams,
  AssetListResponse,
  AssetMetadata,
} from '@shared/api.interface';

export const listAssets = (params: AssetListParams = {}) =>
  axiosForBackend
    .get<AssetListResponse>('/api/assets', { params })
    .then((res) => res.data);

/** 按项目取全部资产（创作作战室右侧产出面板使用） */
export const listByProject = (projectId: string) =>
  axiosForBackend
    .get<Asset[]>(`/api/assets/by-project/${projectId}`)
    .then((res) => res.data);

/** 镜头历史版本：同镜同类型多次生成的产物链（version 倒序，最新在前） */
export const listShotHistory = (shotId: string, assetType?: string) =>
  axiosForBackend
    .get<Asset[]>(`/api/assets/shot/${shotId}/history`, {
      params: assetType ? { assetType } : undefined,
    })
    .then((res) => res.data);

/** 回退镜头产物到某个历史版本（写回 shots.videoUrl 或 startFrameUrl） */
export const revertShotAsset = (
  shotId: string,
  assetId: string,
  assetType: 'video' | 'image',
) =>
  axiosForBackend
    .post<Asset>(`/api/assets/shot/${shotId}/revert`, { assetId, assetType })
    .then((res) => res.data);

/** 媒体展示地址：本地 /uploads 直连；远程走后端代理取流（可自动落盘） */
export const mediaUrl = (asset: Pick<Asset, 'id' | 'fileUrl'>): string | undefined => {
  if (!asset.fileUrl) return undefined;
  if (asset.fileUrl.startsWith('/uploads/')) return asset.fileUrl;
  if (asset.fileUrl.startsWith('data:') || asset.fileUrl.startsWith('blob:')) return asset.fileUrl;
  return `/api/assets/${asset.id}/content`;
};

export const getAsset = (id: string) =>
  axiosForBackend.get<Asset>(`/api/assets/${id}`).then((res) => res.data);

/** G16 素材媒体元数据（ffprobe 探测）：探测失败返回 200 + 全 null 字段 */
export const getAssetMetadata = (id: string) =>
  axiosForBackend.get<AssetMetadata>(`/api/assets/${id}/metadata`).then((res) => res.data);

export const createAsset = (data: Partial<Asset>) =>
  axiosForBackend.post<Asset>('/api/assets', data).then((res) => res.data);

export const updateAsset = (id: string, data: Partial<Asset>) =>
  axiosForBackend
    .patch<Asset>(`/api/assets/${id}`, data)
    .then((res) => res.data);

export const deleteAsset = (id: string) =>
  axiosForBackend
    .delete<{ id: string }>(`/api/assets/${id}`)
    .then((res) => res.data);

// 白模产线 · 本地二进制上传（白模 webm/照片落盘，octet-stream，复用 axios CSRF 链路）
// 注：listProjectAssets 走 projects 控制器的 GET api/projects/:id/assets（已存在），项目维度的全量资产用 listAssets({ projectId }) 分页版。
/** 单请求上限：与服务端 MAX_BYTES 对齐；超过就走分片 */
const SINGLE_UPLOAD_MAX = 25 * 1024 * 1024;

export const uploadLocalFile = async (
  projectId: string,
  blob: Blob,
  filename: string,
  durationSeconds?: number,
  onProgress?: (percent: number) => void,
): Promise<{ asset: Asset; fileUrl: string }> => {
  if (blob.size <= SINGLE_UPLOAD_MAX) {
    return axiosForBackend
      .post<{ asset: Asset; fileUrl: string }>(
        `/api/projects/${projectId}/uploads${
          durationSeconds ? `?durationSeconds=${durationSeconds}` : ''
        }`,
        blob,
        {
          headers: { 'Content-Type': blob.type || 'application/octet-stream', 'X-Filename': filename },
          timeout: 10 * 60_000,
          onUploadProgress: (e) => {
            if (onProgress && e.total) onProgress(Math.round((e.loaded / e.total) * 100));
          },
        },
      )
      .then((res) => res.data);
  }

  // 大文件：init → 逐片 PUT → complete（服务端按序追加，完成后一次登记资产）
  const init = await axiosForBackend
    .post<{ uploadId: string; chunkSize: number }>(
      `/api/projects/${projectId}/uploads/chunks`,
      {
        filename,
        mimeType: blob.type || 'application/octet-stream',
        totalSize: blob.size,
        durationSeconds,
      },
      { timeout: 60_000 },
    )
    .then((res) => res.data);
  const chunkSize = Math.max(1, Math.min(init.chunkSize || 8 * 1024 * 1024, 12 * 1024 * 1024));
  const totalParts = Math.ceil(blob.size / chunkSize);
  for (let i = 0; i < totalParts; i += 1) {
    const start = i * chunkSize;
    const part = blob.slice(start, Math.min(blob.size, start + chunkSize));
    // eslint-disable-next-line no-await-in-loop
    await axiosForBackend.put(
      `/api/projects/${projectId}/uploads/chunks/${init.uploadId}/part?index=${i}`,
      part,
      {
        headers: { 'Content-Type': 'application/octet-stream' },
        timeout: 5 * 60_000,
        onUploadProgress: (e) => {
          if (!onProgress) return;
          const done = start + (e.loaded ?? 0);
          onProgress(Math.min(99, Math.round((done / blob.size) * 100)));
        },
      },
    );
  }
  const done = await axiosForBackend
    .post<{ asset: Asset; fileUrl: string }>(
      `/api/projects/${projectId}/uploads/chunks/${init.uploadId}/complete`,
      {},
      { timeout: 120_000 },
    )
    .then((res) => res.data);
  onProgress?.(100);
  return done;
};

export const listProjectAssets = (projectId: string) =>
  axiosForBackend
    .get<Asset[]>(`/api/projects/${projectId}/assets`)
    .then((res) => res.data);

export const presignUpload = (fileName: string, contentType: string) =>
  axiosForBackend
    .get<{ uploadUrl: string; fileUrl: string; mode: string }>('/api/storage/presign', {
      params: { fileName, contentType },
    })
    .then((res) => res.data);
