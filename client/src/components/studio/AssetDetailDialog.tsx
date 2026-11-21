/**
 * 素材详情浮层（G16 · OpenMotion AssetCard/MediaPreviewDialog 对齐）
 * -------------------------------------------------------------
 * 大预览 + ffprobe 元数据表（分辨率 / 时长 / 视频编码 / 音频编码 / 帧率 /
 * 码率 / 像素格式 / 大小）。元数据走 W5 已实现的 GET /api/assets/:id/metadata，
 * 探测失败的字段显示「—」，全空时提示「暂无探测结果」。
 * 纯展示组件：由 ParityLibrary / ShenJianLibrary 的卡片「详情」入口挂载。
 */
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Loader2 } from 'lucide-react';
import type { Asset, AssetMetadata } from '@shared/api.interface';
import { getAssetMetadata, mediaUrl } from '@client/src/api/assets';
import type { MediaKind } from '@client/src/components/MediaPreviewDialog';

const fmtDuration = (s: number | null) => {
  if (s == null || !Number.isFinite(s)) return null;
  const m = Math.floor(s / 60);
  const sec = s - m * 60;
  return m > 0 ? `${m} 分 ${sec.toFixed(2)} 秒` : `${sec.toFixed(2)} 秒`;
};

const fmtSize = (b: number | null) => {
  if (b == null || !Number.isFinite(b) || b <= 0) return null;
  if (b >= 1024 * 1024 * 1024) return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`;
  if (b >= 1024 * 1024) return `${(b / 1024 / 1024).toFixed(2)} MB`;
  return `${(b / 1024).toFixed(1)} KB`;
};

const fmtBitRate = (b: number | null) => {
  if (b == null || !Number.isFinite(b) || b <= 0) return null;
  if (b >= 1_000_000) return `${(b / 1_000_000).toFixed(2)} Mbps`;
  return `${Math.round(b / 1000)} kbps`;
};

const fmtFps = (v: number | null) => (v == null || !Number.isFinite(v) ? null : `${Math.round(v * 100) / 100} fps`);

export const AssetDetailDialog = ({
  asset,
  kind,
  onClose,
}: {
  asset: Asset;
  kind: MediaKind;
  onClose: () => void;
}) => {
  const [meta, setMeta] = useState<AssetMetadata | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const url = mediaUrl(asset);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    getAssetMetadata(asset.id)
      .then((m) => {
        if (alive) setMeta(m);
      })
      .catch((e) => {
        if (alive) setError((e as Error).message || '元数据读取失败');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [asset.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const resolution =
    meta?.width && meta?.height ? `${meta.width} × ${meta.height}` : asset.width && asset.height ? `${asset.width} × ${asset.height}` : null;
  const rows: Array<{ label: string; value: string | null }> = [
    { label: '分辨率', value: resolution },
    { label: '时长', value: fmtDuration(meta?.durationSeconds ?? null) ?? (asset.durationSeconds ? `${asset.durationSeconds.toFixed(2)} 秒（登记值）` : null) },
    { label: '视频编码', value: meta?.videoCodec ?? null },
    { label: '音频编码', value: meta?.audioCodec ?? null },
    { label: '帧率', value: fmtFps(meta?.fps ?? null) },
    { label: '码率', value: fmtBitRate(meta?.bitRate ?? null) },
    { label: '像素格式', value: meta?.pixFmt ?? null },
    { label: '大小', value: fmtSize(meta?.sizeBytes ?? null) ?? (asset.fileSize ? `${(asset.fileSize / 1024 / 1024).toFixed(2)} MB（登记值）` : null) },
  ];

  // 必须挂到 body：素材库面板有 container-type / overflow 裁切，嵌套 fixed 会被裁掉
  return createPortal(
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/80 p-4" onClick={onClose} role="dialog" aria-modal="true" aria-label="素材详情">
      <div
        className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <h3 className="truncate text-sm font-semibold text-foreground">{asset.name || '素材详情'}</h3>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="关闭"
          >
            ✕
          </button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-4 md:flex-row">
          <div className="flex min-h-[200px] flex-1 items-center justify-center overflow-hidden rounded-xl bg-black/90 p-3">
            {url ? (
              kind === 'video' ? (
                <video src={url} controls playsInline className="max-h-[56vh] max-w-full rounded-lg" />
              ) : kind === 'audio' ? (
                <audio src={url} controls className="w-4/5" />
              ) : (
                <img src={url} alt={asset.name} className="max-h-[56vh] max-w-full object-contain" />
              )
            ) : (
              <span className="text-xs text-muted-foreground">素材没有可预览的媒体地址</span>
            )}
          </div>
          <div className="w-full shrink-0 md:w-64">
            <div className="mb-2 text-xs font-semibold text-muted-foreground">媒体元数据</div>
            {loading ? (
              <div className="flex items-center gap-2 py-3 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                正在探测媒体信息…
              </div>
            ) : error ? (
              <div className="py-3 text-xs text-destructive">{error}</div>
            ) : (
              <dl className="divide-y divide-border rounded-xl border border-border text-xs">
                {rows.map((r) => (
                  <div key={r.label} className="flex items-center justify-between gap-3 px-3 py-2">
                    <dt className="shrink-0 text-muted-foreground">{r.label}</dt>
                    <dd className="truncate text-right font-medium text-foreground" title={r.value ?? undefined}>
                      {r.value ?? '—'}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
            {!loading && !error && rows.every((r) => !r.value) ? (
              <div className="mt-2 text-xs text-muted-foreground">探测失败或非媒体文件，暂无元数据。</div>
            ) : null}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default AssetDetailDialog;
