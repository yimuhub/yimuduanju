import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { FolderOpen, Image as ImageIcon, Film, Music, FileText, Upload, Search, ExternalLink } from 'lucide-react';
import { assets } from '@client/src/api';
import type { Asset } from '@shared/api.interface';
import { logger } from '@client/src/utils/logger';
import { MediaOrMissing } from '@client/src/components/MediaOrMissing';

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

  const load = () => {
    if (!id) return;
    setLoading(true);
    assets.listProjectAssets(id)
      .then((list) => setItems(list))
      .catch((err) => { logger.error('assets', String(err)); setError('加载资产失败'); })
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [id]);

  const filtered = items.filter((a) => {
    const typeOk = activeType === '全部' || (a.assetType || '').toLowerCase().includes(typeFilter(activeType) || '');
    const kw = search.trim().toLowerCase();
    const kwOk = !kw || (a.name || '').toLowerCase().includes(kw) || (a.generationPrompt || '').toLowerCase().includes(kw);
    return typeOk && kwOk;
  });

  const isImage = (a: Asset) => (a.assetType || '').toLowerCase().includes('image') || /\.(png|jpe?g|webp|gif)$/i.test(a.fileUrl || '');
  const isVideo = (a: Asset) => (a.assetType || '').toLowerCase().includes('video') || /\.(mp4|mov|webm)$/i.test(a.fileUrl || '');

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-foreground">项目资产</h2>
          <p className="mt-1 text-sm text-muted-foreground">本项目生成的全部图片、视频、音频资产 · 共 {items.length} 个</p>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索资产..."
            className="h-9 w-56 rounded-lg border border-input bg-white pl-9 pr-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
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
                : 'border border-input bg-white text-foreground hover:border-primary hover:text-primary'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-600">{error}</div>}

      {loading ? (
        <div className="rounded-xl border bg-white p-12 text-center text-sm text-muted-foreground">加载中...</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-white p-12 text-center">
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
            <div key={a.id} className="group overflow-hidden rounded-xl border bg-white shadow-sm transition-shadow hover:shadow-md">
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
                  <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-primary/10 via-[#FF7A3A]/10 to-purple-500/10">
                    {typeIcon(a.assetType)}
                  </div>
                )}
                <span className="absolute left-2 top-2 rounded bg-black/40 px-1.5 py-0.5 text-[9px] font-medium text-white backdrop-blur-sm">
                  {a.assetType || 'asset'} · v{a.version}
                </span>
                {a.locked && <span className="absolute right-2 top-2 rounded bg-amber-500/80 px-1.5 py-0.5 text-[9px] font-medium text-white">锁定</span>}
              </div>
              <div className="p-2.5">
                <div className="truncate text-xs font-medium text-foreground">{a.name || '未命名资产'}</div>
                <div className="mt-0.5 flex items-center justify-between text-[10px] text-muted-foreground">
                  <span>{a.durationSeconds ? `${a.durationSeconds}s` : a.fileSize ? `${(a.fileSize / 1024).toFixed(0)}KB` : a.sourceType}</span>
                  {mediaSrc(a) && (
                    <a href={mediaSrc(a)} target="_blank" rel="noreferrer" className="flex items-center gap-0.5 text-primary hover:underline">
                      <ExternalLink className="h-3 w-3" /> 打开
                    </a>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default ProjectAssetsTab;
