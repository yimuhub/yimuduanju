/**
 * 同构版左侧素材库：只服务 Parity，不覆盖经典版。
 * 结构按剪映素材面板重做：72 模块栏 / 标题 + 导入 / 分类胶囊 / 搜索 / 双列卡片 / 底部计数。
 * 数据仍走同一份资产 API，拖拽、双击插入、预览、删除都复用真实能力。
 */
import { useEffect, useMemo, useState } from 'react';
import {
  AudioLines,
  Captions,
  Clapperboard,
  Film,
  Filter,
  Folder,
  Image as ImageIcon,
  Music2,
  Plus,
  Search,
  SlidersHorizontal,
  Sparkles,
  Sticker,
  Trash2,
  Type,
  Upload,
} from 'lucide-react';
import { toast } from 'sonner';
import { probeVideoHasAudio } from '@client/src/lib/media-audio';
import MediaPreviewDialog, { type MediaKind } from '@client/src/components/MediaPreviewDialog';
import { deleteAsset, listAssets, listByProject, mediaUrl } from '@client/src/api/assets';
import type { Asset } from '@shared/api.interface';
import { useStudio } from './StudioShell';
import { useEdl } from './EdlContext';
import { clearTimelineDrag, startTimelineDrag } from '@client/src/lib/timeline-dnd';
import { ShenJianPresets } from './ShenJianPresets';

type RailTab = 'media' | 'audio' | 'text' | 'sticker' | 'effect' | 'transition' | 'caption' | 'filter' | 'adjust';
type KindTab = 'all' | 'video' | 'image' | 'audio' | 'text';
type Scope = 'project' | 'platform';

const RAIL: Array<{ key: RailTab; label: string; icon: React.ReactNode }> = [
  { key: 'media', label: '媒体', icon: <Film /> },
  { key: 'audio', label: '音频', icon: <AudioLines /> },
  { key: 'text', label: '文本', icon: <Type /> },
  { key: 'sticker', label: '贴纸', icon: <Sticker /> },
  { key: 'effect', label: '特效', icon: <Sparkles /> },
  { key: 'transition', label: '转场', icon: <Clapperboard /> },
  { key: 'caption', label: '字幕', icon: <Captions /> },
  { key: 'filter', label: '滤镜', icon: <Filter /> },
  { key: 'adjust', label: '调节', icon: <SlidersHorizontal /> },
];

const TITLE: Record<RailTab, string> = {
  media: '媒体',
  audio: '音频',
  text: '文本',
  sticker: '贴纸',
  effect: '特效',
  transition: '转场',
  caption: '字幕',
  filter: '滤镜',
  adjust: '调节',
};

const isGif = (a: Asset) => /\.gif(?:[?#]|$)/i.test(a.fileUrl || '') || /gif/i.test(a.mimeType || '');
const isAudio = (a: Asset) => /audio/i.test(a.mimeType || '') || ['audio', 'voice', 'music', 'sfx'].includes((a.assetType || '').toLowerCase());
const isImage = (a: Asset) => /image/i.test(a.mimeType || '') || ['image', 'frame', 'start_frame', 'cover'].includes((a.assetType || '').toLowerCase());
const isVideo = (a: Asset) => /video/i.test(a.mimeType || '') || (a.assetType || '').toLowerCase() === 'video';
const kindOf = (a: Asset): MediaKind => (isAudio(a) ? 'audio' : isVideo(a) ? 'video' : 'image');
const typeLabel = (a: Asset) => (isAudio(a) ? '音频' : isGif(a) ? 'GIF' : isImage(a) ? '图片' : isVideo(a) ? '视频' : '素材');
const fmtDur = (s?: number) => {
  if (!s || !Number.isFinite(s)) return '';
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
};

export const ParityLibrary = ({ onImport }: { onImport: () => void }) => {
  const { projectId, data, curT } = useStudio();
  const edl = useEdl();
  const [rail, setRail] = useState<RailTab>('media');
  const [kind, setKind] = useState<KindTab>('all');
  const [scope, setScope] = useState<Scope>('project');
  const [query, setQuery] = useState('');
  const [projectAssets, setProjectAssets] = useState<Asset[]>([]);
  const [platformAssets, setPlatformAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ asset: Asset; url: string; kind: MediaKind } | null>(null);
  const [broken, setBroken] = useState<Record<string, boolean>>({});

  const refresh = useMemo(
    () => async () => {
      if (!projectId) return;
      setLoading(true);
      try {
        const [mine, all] = await Promise.all([
          listByProject(projectId),
          listAssets({ page: 1, pageSize: 100 }),
        ]);
        setProjectAssets(mine);
        setPlatformAssets(all.items ?? []);
      } catch {
        toast.error('素材库读取失败，请稍后重试');
      } finally {
        setLoading(false);
      }
    },
    [projectId],
  );

  useEffect(() => {
    void refresh();
    const onChange = () => void refresh();
    window.addEventListener('yimu:assets-changed', onChange);
    return () => window.removeEventListener('yimu:assets-changed', onChange);
  }, [refresh]);

  useEffect(() => {
    const onModule = (e: Event) => {
      const next = (e as CustomEvent).detail as RailTab;
      if (RAIL.some((r) => r.key === next)) setRail(next);
    };
    window.addEventListener('yimu:shenjian-module', onModule);
    return () => window.removeEventListener('yimu:shenjian-module', onModule);
  }, []);

  const pool = scope === 'project' ? projectAssets : platformAssets;
  const visible = useMemo(() => {
    let rows = pool.filter((a) => a.status !== 'failed' && mediaUrl(a));
    if (rail === 'audio') rows = rows.filter(isAudio);
    if (rail === 'text') rows = rows.filter((a) => (a.assetType || '').toLowerCase() === 'text');
    if (kind !== 'all') {
      if (kind === 'video') rows = rows.filter(isVideo);
      if (kind === 'image') rows = rows.filter((a) => isImage(a) || isGif(a));
      if (kind === 'audio') rows = rows.filter(isAudio);
      if (kind === 'text') rows = rows.filter((a) => (a.assetType || '').toLowerCase() === 'text');
    }
    const q = query.trim().toLowerCase();
    if (q) rows = rows.filter((a) => (a.name || '').toLowerCase().includes(q));
    return rows;
  }, [pool, rail, kind, query]);

  const isAssetTab = rail === 'media' || rail === 'audio';
  const selectedAsset = visible.find((a) => a.id === selected) ?? null;

  const addAt = (a: Asset, url: string, mediaKind: MediaKind) => {
    const at = Math.max(0, curT);
    const name = a.name || '未命名素材';
    if (mediaKind === 'audio') {
      edl.addAudio({ name, url, durationSeconds: a.durationSeconds }, at);
      toast.success('已插入播放头位置');
      return;
    }
    void probeVideoHasAudio(url).then((hasAudio) => {
      edl.addVideo({ name, url, durationSeconds: a.durationSeconds || 5, shotId: null, hasAudio }, at);
      toast.success(hasAudio ? '已插入播放头位置 · 自动带原声轨' : '已插入播放头位置');
    });
  };

  const remove = async (a: Asset) => {
    if (!window.confirm(`从项目资产库删除「${a.name}」？\n\n时间线已引用的片段可能失效。`)) return;
    try {
      await deleteAsset(a.id);
      setProjectAssets((prev) => prev.filter((x) => x.id !== a.id));
      toast.success('素材已删除');
    } catch {
      toast.error('删除失败，请稍后重试');
    }
  };

  return (
    <aside className="library parity-library" aria-label="同构版素材库">
      <nav className="lib-rail parity-rail">
        {RAIL.map((item) => (
          <button
            key={item.key}
            type="button"
            className={`rail-btn${rail === item.key ? ' on' : ''}`}
            data-tip={item.label}
            onClick={() => {
              setRail(item.key);
              setKind(item.key === 'audio' ? 'audio' : item.key === 'text' || item.key === 'caption' ? 'text' : 'all');
              setSelected(null);
            }}
          >
            {item.icon}
            <span>{item.label}</span>
          </button>
        ))}
      </nav>

      <div className="lib-main parity-lib-main">
        <div className="parity-lib-head">
          <div>
            <div className="parity-lib-title">{TITLE[rail]}</div>
            <div className="parity-lib-sub">本项目素材 · {projectAssets.length} 项</div>
          </div>
          <div className="parity-lib-actions">
            {isAssetTab ? (
              <button type="button" className="parity-import" onClick={onImport} title="导入本地素材">
                <Upload />
                导入
              </button>
            ) : null}
            <button type="button" className="parity-icon-btn" title="按来源项目自动分组" onClick={() => toast.info('素材按来源项目自动分组，无需手动建文件夹', { duration: 2200 })}>
              <Folder />
            </button>
          </div>
        </div>

        {isAssetTab ? (
          <>
            <div className="parity-kind-tabs">
              {(['all', 'video', 'image', 'audio', 'text'] as KindTab[]).map((k) => (
                <button key={k} type="button" className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>
                  {k === 'all' ? '全部' : k === 'video' ? '视频' : k === 'image' ? '图片' : k === 'audio' ? '音频' : '文本'}
                </button>
              ))}
            </div>

            <div className="parity-search">
              <Search />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索素材、花字、特效" />
              {query ? <button type="button" onClick={() => setQuery('')}>清除</button> : null}
            </div>

            <div className="parity-scope">
              <button type="button" className={scope === 'project' ? 'on' : ''} onClick={() => setScope('project')}>本项目</button>
              <button type="button" className={scope === 'platform' ? 'on' : ''} onClick={() => setScope('platform')}>平台素材</button>
              <span>{visible.length} 项</span>
            </div>

            <div className="parity-lib-scroll">
              {loading ? <div className="parity-lib-empty">读取真实资产库…</div> : null}
              {!loading && visible.length === 0 ? (
                <div className="parity-lib-empty">
                  <div className="parity-empty-ico"><Film /></div>
                  <b>{query ? '没有匹配的素材' : '这个分类还没有真实素材'}</b>
                  <p>{query ? '换个关键词，或切到「全部」。' : '从本机导入视频、图片或音频，拖到时间线即可开始。'}</p>
                  {!query ? <button type="button" onClick={onImport}><Plus /> 导入素材</button> : null}
                </div>
              ) : null}

              <div className="parity-media-grid">
                {visible.map((a) => {
                  const url = mediaUrl(a);
                  if (!url) return null;
                  const mediaKind = kindOf(a);
                  const gif = isGif(a);
                  const isBroken = !!broken[a.id];
                  return (
                    <div
                      key={a.id}
                      className={`parity-media-card${selected === a.id ? ' selected' : ''}${isBroken ? ' broken' : ''}`}
                      draggable={!isBroken}
                      onDragStart={(e) => startTimelineDrag(e, {
                        kind: mediaKind,
                        url,
                        name: a.name || '未命名素材',
                        durationSeconds: a.durationSeconds || (mediaKind === 'image' ? 5 : undefined),
                      })}
                      onDragEnd={clearTimelineDrag}
                      onClick={() => setSelected(a.id)}
                      onDoubleClick={() => addAt(a, url, mediaKind)}
                      title={`${a.name} · 单击选择，双击插入播放头，拖到时间线`}
                    >
                      <div className="parity-media-thumb">
                        {mediaKind === 'audio' ? (
                          <span className="parity-audio-thumb"><Music2 /></span>
                        ) : mediaKind === 'video' && !gif ? (
                          <video src={url} muted preload="metadata" onError={() => setBroken((p) => ({ ...p, [a.id]: true }))} />
                        ) : (
                          <img src={url} alt={a.name} loading="lazy" onError={() => setBroken((p) => ({ ...p, [a.id]: true }))} />
                        )}
                        <span className="parity-type">{typeLabel(a)}</span>
                        {a.durationSeconds ? <span className="parity-dur">{fmtDur(a.durationSeconds)}</span> : null}
                        {mediaKind === 'video' ? <span className="parity-play">▶</span> : null}
                      </div>
                      <div className="parity-media-name">{a.name || '未命名素材'}</div>
                      {isBroken ? <span className="parity-broken">无法打开</span> : (
                        <button
                          type="button"
                          className="parity-del"
                          title="从项目资产库删除"
                          onClick={(e) => { e.stopPropagation(); void remove(a); }}
                        >
                          <Trash2 />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="parity-lib-foot">
              <span>{scope === 'project' ? '本项目素材' : '平台素材'} · {visible.length} 项</span>
              <span>本地</span>
            </div>

            {selectedAsset ? (
              <div className="parity-lib-selection">
                <span className="parity-selection-dot" />
                <b>{selectedAsset.name}</b>
                <span>{typeLabel(selectedAsset)}</span>
                <button type="button" onClick={() => {
                  const url = mediaUrl(selectedAsset);
                  if (url) setPreview({ asset: selectedAsset, url, kind: kindOf(selectedAsset) });
                }}>预览</button>
                <button type="button" onClick={() => {
                  const url = mediaUrl(selectedAsset);
                  if (url) addAt(selectedAsset, url, kindOf(selectedAsset));
                }}>插入</button>
              </div>
            ) : null}
          </>
        ) : (
          <div className="parity-preset-body">
            <ShenJianPresets rail={rail as 'text' | 'sticker' | 'effect' | 'transition' | 'caption' | 'filter' | 'adjust'} />
          </div>
        )}
      </div>

      {preview ? (
        <MediaPreviewDialog
          url={preview.url}
          kind={preview.kind}
          title={preview.asset.name}
          onClose={() => setPreview(null)}
        />
      ) : null}
    </aside>
  );
};

export default ParityLibrary;
