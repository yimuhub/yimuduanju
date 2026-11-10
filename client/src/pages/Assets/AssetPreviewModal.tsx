/**
 * 资产预览 · 两种明确形态
 * -------------------------------------------------------------
 *  simple（默认，无边框沉浸版）
 *    没有卡片容器、没有边框 / 圆角 / 阴影 / 顶栏底栏分割线；
 *    媒体直接浮在暗场里，工具是半透明圆形悬浮按钮，点击遮罩即关。
 *  detail（详情版）
 *    保留完整的带边框卡片：标题栏、媒体区、元信息网格、操作栏。
 * 两态共用同一份媒体渲染与键盘 / 翻页逻辑，模式由资产页顶部的
 * 「精简 / 详情」开关控制并持久化到 localStorage。
 *
 * 通过 createPortal 挂到 document.body：弹框原本嵌在右坞 .dock 的
 * stacking context 里，自身 z-index 再高也盖不过 IDE 状态栏，会导致
 * 底部下载 / 删除按钮被压住不可点。
 */
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
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
import type { AssetPreviewMode } from './previewMode';

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
  /**
   * 预览模式：simple 无边框沉浸看媒体（默认）；detail 带边框展示完整元信息。
   * 由资产库 / 项目资产顶部的「精简 / 详情」开关控制并持久到本机。
   */
  mode?: AssetPreviewMode;
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
  mode = 'simple',
}: AssetPreviewModalProps) => {
  const [mediaFailed, setMediaFailed] = useState(false);
  const Icon = getTypeIcon(asset.assetType);
  const typeLabel = TYPE_LABELS[asset.assetType] || asset.assetType;
  const url = assetsApi.mediaUrl(asset);
  const canShowMedia = !!url && !mediaFailed;
  const simple = mode === 'simple';

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

  const media = (
    <>
      {asset.assetType === 'image' && canShowMedia ? (
        <img
          src={url}
          alt={asset.name}
          className="apm-media"
          onError={() => setMediaFailed(true)}
        />
      ) : asset.assetType === 'video' && canShowMedia ? (
        <video
          src={url}
          controls
          autoPlay
          playsInline
          className="apm-media"
          onError={() => setMediaFailed(true)}
        />
      ) : asset.assetType === 'audio' && canShowMedia ? (
        <audio src={url} controls className="apm-audio" onError={() => setMediaFailed(true)} />
      ) : mediaFailed || (asset.assetType === 'image' && !canShowMedia) || (asset.assetType === 'video' && !canShowMedia) ? (
        <span className="apm-missing">未获取</span>
      ) : (
        <Icon className="apm-bigico" />
      )}
      {canShowMedia && asset.durationSeconds ? (
        <span className="apm-dur num">{formatDuration(asset.durationSeconds)}</span>
      ) : null}
      {url && mediaFailed ? <span className="apm-missing-hint">未获取（源地址不可达）</span> : null}
    </>
  );

  const navButtons = (
    <>
      {hasPrev ? (
        <button type="button" onClick={onPrev} className="apm-rbtn apm-nav prev" aria-label="上一个">
          <ChevronLeft size={17} />
        </button>
      ) : null}
      {hasNext ? (
        <button type="button" onClick={onNext} className="apm-rbtn apm-nav next" aria-label="下一个">
          <ChevronRight size={17} />
        </button>
      ) : null}
    </>
  );

  const deleteBtn = (
    <button type="button" className="apm-rbtn danger" onClick={() => onDelete(asset.id)} title="删除资产" aria-label="删除资产">
      <Trash2 size={15} />
    </button>
  );
  const downloadBtn = (
    <a
      href={url || '#'}
      download={asset.name || undefined}
      className={`apm-rbtn${!url ? ' disabled' : ''}`}
      title="下载资产"
      aria-label="下载资产"
    >
      <Download size={15} />
    </a>
  );

  /* ---------------- 精简版：无边框沉浸 ---------------- */
  if (simple) {
    return createPortal(
      <div className="apm-mask apm-mask-simple" onClick={onClose} role="presentation">
        <div className="apm-immersive" onClick={(e) => e.stopPropagation()}>
          <div className="apm-float top">
            <span className="apm-caption">
              {position ? <b className="num">{position.index} / {position.total}</b> : null}
              <span>{typeLabel}</span>
            </span>
            <button type="button" className="apm-rbtn" onClick={onClose} title="关闭 (Esc)" aria-label="关闭">
              <X size={16} />
            </button>
          </div>

          <div className="apm-canvas">
            {media}
            {navButtons}
          </div>

          <div className="apm-float bottom">
            <span className="apm-name" title={asset.name}>{asset.name || '未命名资产'}</span>
            <div className="apm-tools">
              {downloadBtn}
              {deleteBtn}
              <span className="apm-hint">点击空白处关闭 · ← → 切换</span>
            </div>
          </div>
        </div>
      </div>,
      document.body,
    );
  }

  /* ---------------- 详情版：带边框卡片 ---------------- */
  return createPortal(
    <div className="apm-mask" onClick={onClose} role="presentation">
      <div className="apm-card" onClick={(e) => e.stopPropagation()}>
        <div className="apm-card-h">
          <div className="apm-card-h-l">
            <h3 title={asset.name}>{asset.name}</h3>
            <div className="apm-card-sub">
              {projectName ? (
                <span><FolderKanban size={11} />{projectName}</span>
              ) : null}
              <span>{typeLabel}</span>
              {position ? <span className="num">{position.index} / {position.total}</span> : null}
            </div>
          </div>
          <button type="button" className="apm-rbtn" onClick={onClose} title="关闭 (Esc)" aria-label="关闭">
            <X size={16} />
          </button>
        </div>

        <div className="apm-card-media">
          {media}
          {navButtons}
        </div>

        <div className="apm-fields">
          <div><span>类型</span><b>{typeLabel}</b></div>
          <div><span>大小</span><b>{formatFileSize(asset.fileSize)}</b></div>
          <div>
            <span>来源</span>
            <b>
              {getSourceLabel(asset.sourceType)}
              {asset.mock ? <em>演示占位</em> : null}
            </b>
          </div>
          {asset.width && asset.height ? (
            <div><span>分辨率</span><b className="num">{asset.width} × {asset.height}</b></div>
          ) : null}
          {asset.generationModel ? (
            <div><span>生成模型</span><b>{asset.generationModel}</b></div>
          ) : null}
          <div><span>版本</span><b className="num">v{asset.version}</b></div>
        </div>

        {asset.generationPrompt ? (
          <div className="apm-prompt">
            <span>生成提示词</span>
            <p>{asset.generationPrompt}</p>
          </div>
        ) : null}

        <div className="apm-card-f">
          <button type="button" className="apm-btn danger" onClick={() => onDelete(asset.id)}>
            <Trash2 size={14} /> 删除
          </button>
          <a
            href={url || '#'}
            download={asset.name || undefined}
            className={`apm-btn primary${!url ? ' disabled' : ''}`}
          >
            <Download size={14} /> 下载
          </a>
        </div>
      </div>
    </div>,
    document.body,
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
