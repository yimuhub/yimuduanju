/**
 * 项目资产 · Studio 右坞版
 * -------------------------------------------------------------
 * 旧版 `lg:grid-cols-6` 用的是「视口断点」，1680 宽的屏幕会命中 6 列，
 * 但右坞实际只有 548px，每列被压到 ~80px，图与文字都糊成一团。
 * 这里改成容器驱动的网格：
 *   repeat(auto-fill, minmax(140px, 1fr))
 *   → 标准 548px 得 3 列；宽屏 820px 得 5 列；超宽 1100px 得 6–7 列；
 *     窄坞 320px 自动降为 1 列，全程不依赖 window 宽度、无横向滚动。
 * 筛选、搜索、预览模式、删除、左右切换预览全部保留。
 */
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  FolderOpen,
  Image as ImageIcon,
  Film,
  Music,
  FileText,
  Search,
  Eye,
  ScanEye,
  ListFilter,
} from 'lucide-react';
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
  if (v.includes('video')) return <Film size={16} />;
  if (v.includes('audio') || v.includes('voice') || v.includes('music')) return <Music size={16} />;
  if (v.includes('document') || v.includes('text') || v.includes('script')) return <FileText size={16} />;
  return <ImageIcon size={16} />;
};

const typeLabel = (t?: string) => {
  const v = (t || '').toLowerCase();
  if (v.includes('video')) return '视频';
  if (v.includes('audio') || v.includes('voice') || v.includes('music')) return '音频';
  if (v.includes('document') || v.includes('text') || v.includes('script')) return '文档';
  return '图片';
};

const metaText = (a: Asset) => {
  if (a.durationSeconds) return `${a.durationSeconds}s`;
  if (a.fileSize) return `${(a.fileSize / 1024).toFixed(0)} KB`;
  return a.sourceType || '—';
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
    <div className="as">
      {/* ① 标题 + 搜索 + 预览模式 */}
      <header className="as-head">
        <div className="as-head-l">
          <span className="as-kicker">ASSETS / 项目资产</span>
          <h2>项目资产</h2>
          <p>本项目生成的图片、视频与音频 · 共 {items.length} 个</p>
        </div>
        <div className="as-head-r">
          <label className="as-search">
            <Search size={13} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索资产"
              aria-label="搜索资产"
            />
            {search ? <button type="button" onClick={() => setSearch('')} aria-label="清空搜索">×</button> : null}
          </label>
          <div className="as-mode" role="group" aria-label="预览模式">
            <button
              type="button"
              className={previewMode === 'simple' ? 'on' : ''}
              onClick={() => setPreviewMode('simple')}
              title="精简预览：无边框沉浸查看"
            >
              <ScanEye size={12} /> 精简
            </button>
            <button
              type="button"
              className={previewMode === 'detail' ? 'on' : ''}
              onClick={() => setPreviewMode('detail')}
              title="详情预览：带边框与完整元信息"
            >
              <ListFilter size={12} /> 详情
            </button>
          </div>
        </div>
      </header>

      {/* ② 类型筛选 */}
      <div className="as-bar">
        <div className="as-types">
          {typeTabs.map((t) => (
            <button
              key={t}
              type="button"
              className={activeType === t ? 'on' : ''}
              onClick={() => setActiveType(t)}
            >
              {t}
            </button>
          ))}
        </div>
        <span className="as-count num">{filtered.length} / {items.length}</span>
      </div>

      {error ? <div className="as-alert">{error}</div> : null}

      {/* ③ 资产网格：列数由容器宽度决定 */}
      {loading ? (
        <div className="as-loading">正在读取项目资产…</div>
      ) : filtered.length === 0 ? (
        <div className="as-empty">
          <span className="as-empty-ico"><FolderOpen size={20} /></span>
          <b>{items.length === 0 ? '还没有资产' : '没有匹配的资产'}</b>
          <p>{items.length === 0 ? '生成的图片、视频、音频会自动归档到此处' : '换个关键词或类型筛选试试'}</p>
        </div>
      ) : (
        <div className="as-grid">
          {filtered.map((a) => (
            <div
              key={a.id}
              className="as-card"
              onClick={() => setSelected(a)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelected(a); } }}
              title={`${a.name || '未命名资产'} · ${typeLabel(a.assetType)}`}
            >
              <div className="as-thumb">
                {isImage(a) ? (
                  <MediaOrMissing src={mediaSrc(a)} alt={a.name} className="as-media" />
                ) : isVideo(a) ? (
                  mediaSrc(a) ? (
                    <video
                      src={mediaSrc(a)}
                      className="as-media"
                      muted
                      playsInline
                      preload="metadata"
                      onError={(e) => {
                        (e.currentTarget as HTMLVideoElement).style.display = 'none';
                        const parent = e.currentTarget.parentElement;
                        if (parent && !parent.querySelector('[data-missing]')) {
                          const span = document.createElement('span');
                          span.dataset.missing = '1';
                          span.className = 'as-ph';
                          span.textContent = '未获取';
                          parent.appendChild(span);
                        }
                      }}
                    />
                  ) : <span className="as-ph">未获取</span>
                ) : (
                  <span className="as-ph as-ph-ico">{typeIcon(a.assetType)}</span>
                )}
                <span className="as-badge">{typeLabel(a.assetType)} · v{a.version}</span>
                {a.locked ? <span className="as-badge as-badge-lock">锁定</span> : null}
                <span className="as-hover"><Eye size={14} /> 预览</span>
              </div>
              <div className="as-meta">
                <b title={a.name}>{a.name || '未命名资产'}</b>
                <span>{metaText(a)}<i />{a.sourceType === 'generated' ? 'AI 生成' : a.sourceType === 'uploaded' ? '上传' : '资产'}</span>
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
