/**
 * 通用 Lightbox：图片/视频点击放大查看（portal 挂 body，避免被画布/弹层的
 * stacking context 裁切）。Esc / 点击遮罩关闭；带标题与说明，深色玻璃语言。
 * 分镜节点关键帧预览、工作台分镜卡片、历史缩略图共用。
 */
import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, Download } from 'lucide-react';

interface LightboxProps {
  url: string;
  kind?: 'image' | 'video';
  title?: string;
  caption?: string;
  onClose: () => void;
}

const Lightbox = ({ url, kind = 'image', title, caption, onClose }: LightboxProps) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // 须挂到 body：画布 / 工作台都建立了 stacking context，内嵌 fixed 会被裁切
  return createPortal(
    <div
      className="fixed inset-0 z-[300] flex flex-col items-center justify-center bg-black/85 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title || '图片预览'}
    >
      <div className="mb-2 flex w-full max-w-4xl items-center justify-between gap-3" onClick={(e) => e.stopPropagation()}>
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-white/95">{title || (kind === 'video' ? '视频预览' : '图片预览')}</h3>
          {caption && <p className="mt-0.5 truncate text-xs text-white/55">{caption}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <a
            href={url}
            download
            className="flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-white/70 hover:bg-white/10 hover:text-white"
            title="下载"
          >
            <Download className="h-3.5 w-3.5" />
            下载
          </a>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-white/70 hover:bg-white/10 hover:text-white"
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div
        className="flex max-h-[82vh] w-full max-w-4xl items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-white/5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {kind === 'video' ? (
          <video src={url} controls autoPlay className="max-h-[82vh] w-full" />
        ) : (
          <img src={url} alt={title || '预览大图'} className="max-h-[82vh] w-auto max-w-full object-contain" />
        )}
      </div>
    </div>,
    document.body,
  );
};

export default Lightbox;
