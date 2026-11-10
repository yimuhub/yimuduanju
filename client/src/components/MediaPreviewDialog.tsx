/**
 * 统一媒体预览弹窗：视频 / 图片 / 音频一律弹窗播放，不再跳转新页面。
 * Studio 预览「预览视频」、项目资产卡片、自由画布历史资产共用。
 */
import { useEffect } from 'react';
import { X, Download } from 'lucide-react';

export type MediaKind = 'video' | 'image' | 'audio';

interface MediaPreviewDialogProps {
  url: string;
  kind: MediaKind;
  title?: string;
  onClose: () => void;
}

const MediaPreviewDialog = ({ url, kind, title, onClose }: MediaPreviewDialogProps) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title || '媒体预览'}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <h3 className="truncate text-sm font-semibold text-foreground">
            {title || (kind === 'video' ? '视频预览' : kind === 'audio' ? '音频预览' : '图片预览')}
          </h3>
          <div className="flex shrink-0 items-center gap-1.5">
            <a
              href={url}
              download
              className="flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
              title="下载"
            >
              <Download className="h-3.5 w-3.5" />
              下载
            </a>
            <button
              type="button"
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="关闭"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="flex min-h-[240px] items-center justify-center overflow-auto bg-black/90 p-3">
          {kind === 'video' ? (
            <video
              src={url}
              controls
              autoPlay
              playsInline
              className="max-h-[72vh] max-w-full rounded-lg"
            />
          ) : kind === 'audio' ? (
            <audio src={url} controls autoPlay className="w-4/5" />
          ) : (
            <img src={url} alt={title || '图片预览'} className="max-h-[72vh] max-w-full object-contain" />
          )}
        </div>
      </div>
    </div>
  );
};

export default MediaPreviewDialog;