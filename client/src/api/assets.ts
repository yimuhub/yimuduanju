import { axiosForBackend } from '@client/src/api/http';
import type {
  Asset,
  AssetListParams,
  AssetListResponse,
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
export const uploadLocalFile = (
  projectId: string,
  blob: Blob,
  filename: string,
  durationSeconds?: number,
) =>
  axiosForBackend
    .post<{ asset: Asset; fileUrl: string }>(
      `/api/projects/${projectId}/uploads${
        durationSeconds ? `?durationSeconds=${durationSeconds}` : ''
      }`,
      blob,
      {
        headers: {
          'Content-Type': blob.type || 'application/octet-stream',
          'X-Filename': filename,
        },
      },
    )
    .then((res) => res.data);

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
