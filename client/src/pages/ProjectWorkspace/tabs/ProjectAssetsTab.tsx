import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { FolderOpen, Image as ImageIcon, Film, Music, FileText, Upload, Search, Eye } from 'lucide-react';
import { assets } from '@client/src/api';
import type { Asset } from '@shared/api.interface';
import { logger } from '@client/src/utils/logger';
import { MediaOrMissing } from '@client/src/components/MediaOrMissing';
import AssetPreviewModal from '@client/src/pages/Assets/AssetPreviewModal';
import { useAssetPreviewMode } from '@client/src/pages/Assets/previewMode';
import { showConfirm } from '@client/src/components/ui/confirm';
import { toast } from 'sonner';

const mediaSrc = (a: Asset): string | undefined => assets.mediaUrl(a);

const typeTabs = ['全部', '图片', '视频', '音频', '文档'];
const typeFilter = (t: string): string | undefined => {
  if (t === '全部') return undefined;
  if (t === '图片') return 'image';
  if (t === '视频') return 'video';
  if (t === '音频') return 'audio';
  if (t === '文档') return 'document';
  return undefined;
};

const typeIcon = (t?: string) => {
  const v = (t || '').toLowerCase();
  if (v.includes('video')) return <Film className="h-4 w-4" />;
  if (v.includes('audio') || v.includes('voice') || v.includes('music')) return <Music className="h-4 w-4" />;
  if (v.includes('document') || v.includes('text') || v.includes('script')) return <FileText className="h-4 w-4" />;
  return <ImageIcon className="h-4 w-4" />;
};

const ProjectAssetsTab = () => {
  const { id } = useParams<{ id: string }>();
  const [items, setItems] = useState<Asset[]>([]);
  const [activeType, setActiveType] = useState('全部');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Asset | null>(null);
  const [previewMode, setPreviewMode] = useAssetPreviewMode();

  const load = () => {
    if (!id) return;
    setLoading(true);
    assets.listProjectAssets(id)
      .then((list) => setItems(list))
      .catch((err) => { logger.error('assets', String(err)); setError('加载资产失败'); })
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [id]);

  const handleDelete = async (assetId: string) => {
    if (!await showConfirm('确定删除此资产？')) return;
    try {
      await assets.deleteAsset(assetId);
      setItems((prev) => prev.filter((a) => a.id !== assetId));
      if (selected?.id === assetId) setSelected(null);
    } catch (e) {
      logger.error('delete asset failed', String(e));
      toast.error('删除失败，请重试');
    }
  };

  const filtered = items.filter((a) => {
    const typeOk = activeType === '全部' || (a.assetType || '').toLowerCase().includes(typeFilter(activeType) || '');
    const kw = search.trim().toLowerCase();
    const kwOk = !kw || (a.name || '').toLowerCase().includes(kw) || (a.generationPrompt || '').toLowerCase().includes(kw);
    return typeOk && kwOk;
  });

  const isImage = (a: Asset) => (a.assetType || '').toLowerCase().includes('image') || /\.(png|jpe?g|webp|gif)$/i.test(a.fileUrl || '');
  const isVideo = (a: Asset) => (a.assetType || '').toLowerCase().includes('video') || /\.(mp4|mov|webm)$/i.test(a.fileUrl || '');

  const selectedIndex = selected ? filtered.findIndex((a) => a.id === selected.id) : -1;
  const stepSelected = (delta: number) => {
    if (selectedIndex < 0 || filtered.length === 0) return;
    const next = (selectedIndex + delta + filtered.length) % filtered.length;
    setSelected(filtered[next]);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-foreground">项目资产</h2>
          <p className="mt-1 text-sm text-muted-foreground">本项目生成的全部图片、视频、音频资产 · 共 {items.length} 个</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex overflow-hidden rounded-lg border border-input bg-card text-xs">
            {([
              ['simple', '精简预览'],
              ['detail', '详情预览'],
            ] as const).map(([m, label]) => (
              <button
                key={m}
                onClick={() => setPreviewMode(m)}
                className={`px-2.5 py-1.5 transition-colors ${
                  previewMode === m
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索资产..."
              className="h-9 w-56 rounded-lg border border-input bg-card pl-9 pr-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
          </div>
        </div>
      </div>

      <div className="flex gap-2">
        {typeTabs.map((t) => (
          <button
            key={t}
            onClick={() => setActiveType(t)}
            className={`rounded-full px-4 py-1.5 text-sm transition-colors ${
              activeType === t
                ? 'bg-primary text-primary-foreground'
                : 'border border-input bg-card text-foreground hover:border-primary hover:text-primary'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {error && <div className="rounded-lg border border-red-500/30 bg-red-500/15 p-3 text-sm text-red-400">{error}</div>}

      {loading ? (
        <div className="rounded-xl border bg-card p-12 text-center text-sm text-muted-foreground">加载中...</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-card p-12 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <FolderOpen className="h-6 w-6 text-muted-foreground" />
          </div>
          <div className="text-sm text-muted-foreground">
            {items.length === 0 ? '暂无资产，生成的图片、视频、音频会自动归档到此处' : '没有匹配的资产'}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-6">
          {filtered.map((a) => (
            <div
              key={a.id}
              onClick={() => setSelected(a)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter') setSelected(a); }}
              className="group cursor-pointer overflow-hidden rounded-xl border bg-card shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md"
            >
              <div className="relative aspect-square">
                {isImage(a) ? (
                  <MediaOrMissing
                    src={mediaSrc(a)}
                    alt={a.name}
                    className="h-full w-full"
                  />
                ) : isVideo(a) ? (
                  mediaSrc(a) ? (
                    <video
                      src={mediaSrc(a)}
                      className="h-full w-full object-cover"
                      muted
                      playsInline
                      preload="metadata"
                      onError={(e) => {
                        (e.currentTarget as HTMLVideoElement).style.display = 'none';
                        const parent = e.currentTarget.parentElement;
                        if (parent && !parent.querySelector('[data-missing]')) {
                          const span = document.createElement('span');
                          span.dataset.missing = '1';
                          span.className =
                            'absolute inset-0 flex items-center justify-center bg-muted text-xs font-medium text-muted-foreground';
                          span.textContent = '未获取';
                          parent.appendChild(span);
                        }
                      }}
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-muted">
                      <span className="text-xs font-medium text-muted-foreground">未获取</span>
                    </div>
                  )
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-primary/5">
                    {typeIcon(a.assetType)}
                  </div>
                )}
                <span className="absolute left-2 top-2 rounded bg-black/40 px-1.5 py-0.5 text-[9px] font-medium text-white backdrop-blur-sm">
                  {a.assetType || 'asset'} · v{a.version}
                </span>
                {a.locked && <span className="absolute right-2 top-2 rounded bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-medium text-white">锁定</span>}
                <div className="absolute inset-0 flex items-center justify-center bg-black/35 opacity-0 transition-opacity group-hover:opacity-100">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-card text-foreground shadow-lg">
                    <Eye className="h-4 w-4" />
                  </span>
                </div>
              </div>
              <div className="p-2.5">
                <div className="truncate text-xs font-medium text-foreground">{a.name || '未命名资产'}</div>
                <div className="mt-0.5 flex items-center justify-between text-[10px] text-muted-foreground">
                  <span>{a.durationSeconds ? `${a.durationSeconds}s` : a.fileSize ? `${(a.fileSize / 1024).toFixed(0)}KB` : a.sourceType}</span>
                  <span className="flex items-center gap-0.5 text-primary">
                    <Eye className="h-3 w-3" /> 点击预览
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {selected && (
        <AssetPreviewModal
          asset={selected}
          mode={previewMode}
          onClose={() => setSelected(null)}
          onDelete={handleDelete}
          hasPrev={filtered.length > 1}
          hasNext={filtered.length > 1}
          onPrev={() => stepSelected(-1)}
          onNext={() => stepSelected(1)}
          position={selectedIndex >= 0 ? { index: selectedIndex + 1, total: filtered.length } : undefined}
        />
      )}
    </div>
  );
};

export default ProjectAssetsTab;
