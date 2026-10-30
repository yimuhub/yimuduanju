import { useEffect, useState } from 'react';
import {
  X,
  Download,
  Trash2,
  Image as ImageIcon,
  Video,
  Music,
  FileText,
  ChevronLeft,
  ChevronRight,
  FolderKanban,
} from 'lucide-react';
import type { Asset } from '@shared/api.interface';
import { assets as assetsApi } from '@client/src/api';

const formatFileSize = (bytes?: number): string => {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const formatDuration = (seconds?: number): string => {
  if (!seconds) return '';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
};

const getTypeIcon = (type: string) => {
  switch (type) {
    case 'image':
      return ImageIcon;
    case 'video':
      return Video;
    case 'audio':
      return Music;
    case 'subtitle':
      return FileText;
    default:
      return FileText;
  }
};

// 全站统一品牌语言：资产占位底统一为品牌红浅底（类型区分交给图标与标签）
const getTypeGradient = (_type: string): string =>
  'from-primary/20 via-primary/10 to-primary/5';

const getSourceLabel = (source: string): string => {
  switch (source) {
    case 'generated':
      return 'AI生成';
    case 'uploaded':
      return '上传';
    default:
      return source;
  }
};

const TYPE_LABELS: Record<string, string> = {
  image: '图片',
  video: '视频',
  audio: '音频',
  subtitle: '字幕',
};

interface AssetPreviewModalProps {
  asset: Asset;
  onClose: () => void;
  onDelete: (id: string) => void;
  /** 资产归属项目名（可无） */
  projectName?: string;
  /** 列表内左右切换 */
  hasPrev?: boolean;
  hasNext?: boolean;
  onPrev?: () => void;
  onNext?: () => void;
  /** 第几张 / 共几张 */
  position?: { index: number; total: number };
}

const AssetPreviewModal = ({
  asset,
  onClose,
  onDelete,
  projectName,
  hasPrev,
  hasNext,
  onPrev,
  onNext,
  position,
}: AssetPreviewModalProps) => {
  const [mediaFailed, setMediaFailed] = useState(false);
  const Icon = getTypeIcon(asset.assetType);
  const typeLabel = TYPE_LABELS[asset.assetType] || asset.assetType;
  const url = assetsApi.mediaUrl(asset);
  const canShowMedia = !!url && !mediaFailed;

  // 键盘左右切换 + Esc 关闭（媒体地址变化时重置加载失败状态）
  useEffect(() => {
    setMediaFailed(false);
  }, [asset.id, url]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft' && hasPrev) onPrev?.();
      if (e.key === 'ArrowRight' && hasNext) onNext?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, hasPrev, hasNext, onPrev, onNext]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl overflow-hidden rounded-2xl bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b p-4">
          <div className="min-w-0">
            <h3 className="truncate text-base font-semibold text-foreground">
              {asset.name}
            </h3>
            <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
              {projectName && (
                <span className="inline-flex items-center gap-1">
                  <FolderKanban className="h-3 w-3" />
                  {projectName}
                </span>
              )}
              {position && (
                <span>
                  {position.index} / {position.total}
                </span>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div
          className={`relative flex items-center justify-center bg-gradient-to-br ${getTypeGradient(
            asset.assetType,
          )} min-h-[240px] aspect-video overflow-hidden`}
        >
          {asset.assetType === 'image' && canShowMedia ? (
            <img
              src={url}
              alt={asset.name}
              className="max-h-full max-w-full object-contain"
              onError={() => setMediaFailed(true)}
            />
          ) : asset.assetType === 'video' && canShowMedia ? (
            <video
              src={url}
              controls
              playsInline
              className="max-h-full max-w-full"
              onError={() => setMediaFailed(true)}
            />
          ) : asset.assetType === 'audio' && canShowMedia ? (
            <audio src={url} controls className="w-4/5" onError={() => setMediaFailed(true)} />
          ) : mediaFailed || (asset.assetType === 'image' && !canShowMedia) || (asset.assetType === 'video' && !canShowMedia) ? (
            <span className="text-sm font-medium text-muted-foreground">未获取</span>
          ) : (
            <Icon className="h-20 w-20 text-primary/40" />
          )}
          {/* 左右切换：同一份过滤结果内逐张浏览 */}
          {hasPrev && (
            <button
              onClick={onPrev}
              className="absolute left-3 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur transition-transform hover:scale-110"
              aria-label="上一个"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
          )}
          {hasNext && (
            <button
              onClick={onNext}
              className="absolute right-3 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur transition-transform hover:scale-110"
              aria-label="下一个"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          )}
          {canShowMedia && asset.durationSeconds && (
            <span className="absolute right-4 top-4 rounded-md bg-black/60 px-2 py-1 text-sm text-white">
              {formatDuration(asset.durationSeconds)}
            </span>
          )}
          {url && mediaFailed && (
            <span className="absolute bottom-3 rounded-md bg-black/60 px-2 py-1 text-xs text-white">
              未获取（源地址不可达）
            </span>
          )}
        </div>

        <div className="grid grid-cols-3 gap-4 p-5">
          <div>
            <div className="text-xs text-muted-foreground">类型</div>
            <div className="mt-1 text-sm font-medium text-foreground">
              {typeLabel}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">大小</div>
            <div className="mt-1 text-sm font-medium text-foreground">
              {formatFileSize(asset.fileSize)}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">来源</div>
            <div className="mt-1 text-sm font-medium text-foreground">
              {getSourceLabel(asset.sourceType)}
            </div>
          </div>
          {asset.width && asset.height && (
            <div>
              <div className="text-xs text-muted-foreground">分辨率</div>
              <div className="mt-1 text-sm font-medium text-foreground">
                {asset.width} × {asset.height}
              </div>
            </div>
          )}
          {asset.generationModel && (
            <div>
              <div className="text-xs text-muted-foreground">生成模型</div>
              <div className="mt-1 text-sm font-medium text-foreground">
                {asset.generationModel}
              </div>
            </div>
          )}
          <div>
            <div className="text-xs text-muted-foreground">版本</div>
            <div className="mt-1 text-sm font-medium text-foreground">
              v{asset.version}
            </div>
          </div>
        </div>

        {asset.generationPrompt && (
          <div className="border-t px-5 py-4">
            <div className="text-xs text-muted-foreground">生成提示词</div>
            <div className="mt-1 text-sm text-foreground">
              {asset.generationPrompt}
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2 border-t p-4">
          <button
            onClick={() => onDelete(asset.id)}
            className="flex items-center gap-1.5 rounded-xl border border-input px-4 py-2 text-sm font-medium text-red-3000 hover:bg-red-500/15"
          >
            <Trash2 className="h-4 w-4" />
            删除
          </button>
          <a
            href={url || '#'}
            target="_blank"
            rel="noreferrer"
            className={`flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90 ${!url ? 'pointer-events-none opacity-50' : ''}`}
          >
            <Download className="h-4 w-4" />
            下载
          </a>
        </div>
      </div>
    </div>
  );
};

export default AssetPreviewModal;
export {
  formatFileSize,
  formatDuration,
  getTypeIcon,
  getTypeGradient,
  getSourceLabel,
  TYPE_LABELS,
};
