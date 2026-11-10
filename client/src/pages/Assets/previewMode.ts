/**
 * 资产预览模式（资产库 + 项目资产页共用）
 * simple：只展示视频 / 图片 / 声音 / 字幕本身（默认）
 * detail：保留类型、大小、来源、分辨率、模型、提示词等详情
 */
import { useState } from 'react';

export type AssetPreviewMode = 'simple' | 'detail';

const KEY = 'yimu.assetPreviewMode';

export const loadPreviewMode = (): AssetPreviewMode => {
  try {
    return localStorage.getItem(KEY) === 'detail' ? 'detail' : 'simple';
  } catch {
    return 'simple';
  }
};

export const savePreviewMode = (mode: AssetPreviewMode) => {
  try {
    localStorage.setItem(KEY, mode);
  } catch {
    /* 隐私模式写失败：本次会话仍生效 */
  }
};

export function useAssetPreviewMode() {
  const [mode, setMode] = useState<AssetPreviewMode>(loadPreviewMode);
  const change = (next: AssetPreviewMode) => {
    setMode(next);
    savePreviewMode(next);
  };
  return [mode, change] as const;
}
