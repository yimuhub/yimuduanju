/**
 * 一幕·神剪 · 左侧素材库（原型同款两栏）
 * 数据全部来自真实项目资产表与平台资产表，预览/删除/拖入时间线均走现有能力。
 */
import { useEffect, useMemo, useState } from 'react';
import {
  AudioLines,
  Captions,
  ChevronDown,
  Clapperboard,
  Film,
  Filter,
  Folder,
  Music2,
  SlidersHorizontal,
  Sparkles,
  Sticker,
  Trash2,
  Type,
  Upload,
} from 'lucide-react';
import { toast } from 'sonner';
import MediaPreviewDialog, { type MediaKind } from '@client/src/components/MediaPreviewDialog';
import { deleteAsset, listAssets, listByProject, mediaUrl } from '@client/src/api/assets';
import type { Asset } from '@shared/api.interface';
import { useStudio } from './StudioShell';
import { useEdl } from './EdlContext';
import { clearTimelineDrag, startTimelineDrag } from '@client/src/lib/timeline-dnd';

type RailTab = 'media' | 'audio' | 'text' | 'sticker' | 'effect' | 'transition' | 'caption' | 'filter' | 'adjust';
type SubTab = 'all' | 'video' | 'image' | 'audio' | 'text';
type FolderKey = 'project' | 'platform' | 'other';

const RAIL: { key: RailTab; label: string; icon: React.ReactNode }[] = [
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

const RAIL_TITLE: Record<RailTab, string> = {
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

/** 项目名前缀 → 其他任务文件夹 */
const sourceProjectOf = (a: Asset) => /^\[([^\]]+)\]/.exec(a.name || '')?.[1] || '';

export const ShenJianLibrary = ({ onImport }: { onImport: () => void }) => {
  const { projectId, data, curT } = useStudio();
  const edl = useEdl();
  const [rail, setRail] = useState<RailTab>('media');
  const [sub, setSub] = useState<SubTab>('all');
  const [folder, setFolder] = useState<FolderKey>('project');
  const [projectAssets, setProjectAssets] = useState<Asset[]>([]);
  const [platformAssets, setPlatformAssets] = useState<Asset[]>([]);
  const [platformTotal, setPlatformTotal] = useState(0);
  const [loading, setLoading] = useState(false);
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
        setPlatformTotal(all.total ?? all.items?.length ?? 0);
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

  const pool = useMemo(() => {
    if (folder === 'project') return projectAssets;
    if (folder === 'platform') return platformAssets;
    return platformAssets.filter((a) => a.projectId && a.projectId !== projectId);
  }, [folder, projectAssets, platformAssets, projectId]);

  const visible = useMemo(() => {
    let rows = pool.filter((a) => a.status !== 'failed' && mediaUrl(a));
    if (rail === 'audio') rows = rows.filter(isAudio);
    if (rail === 'text') rows = rows.filter((a) => (a.assetType || '').toLowerCase() === 'text');
    if (sub === 'video') rows = rows.filter(isVideo);
    if (sub === 'image') rows = rows.filter((a) => isImage(a) || isGif(a));
    if (sub === 'audio') rows = rows.filter(isAudio);
    if (sub === 'text') rows = rows.filter((a) => (a.assetType || '').toLowerCase() === 'text');
    return rows;
  }, [pool, rail, sub]);

  const folders = useMemo(() => {
    const map = new Map<string, number>();
    for (const a of projectAssets) {
      const key = sourceProjectOf(a);
      map.set(key, (map.get(key) || 0) + 1);
    }
    return map;
  }, [projectAssets]);

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

  const addAt = (a: Asset, url: string, kind: MediaKind) => {
    const at = Math.max(0, curT);
    const name = a.name || '未命名素材';
    if (kind === 'audio') {
      edl.addAudio({ name, url, durationSeconds: a.durationSeconds }, at);
    } else {
      edl.addVideo({ name, url, durationSeconds: a.durationSeconds || 5, shotId: null }, at);
    }
    toast.success('已插入播放头位置');
  };

  return (
    <aside className="library" aria-label="神剪素材库">
      <nav className="lib-rail">
        {RAIL.map((item) => (
          <button
            key={item.key}
            type="button"
            className={`rail-btn${rail === item.key ? ' on' : ''}`}
            data-tip={item.label}
            onClick={() => {
              setRail(item.key);
              setFolder('project');
              if (item.key === 'audio') setSub('audio');
              else if (item.key === 'text' || item.key === 'caption') setSub('text');
              else setSub('all');
            }}
          >
            {item.icon}
            {item.label}
          </button>
        ))}
      </nav>

      <div className="lib-main">
        <div className="lib-head">
          <div className="lib-title">{RAIL_TITLE[rail]}</div>
          <div className="lib-actions">
            <button
              type="button"
              className="icon-btn"
              data-tip="按项目自动分组：导入其他任务后会形成独立文件夹"
              onClick={() => toast.info('素材按来源项目自动分组，无需手动建文件夹', { duration: 2200 })}
            >
              <Folder />
            </button>
            <button type="button" className="import-btn" data-tip="导入本地视频/图片/音频，或从其他项目、平台资产库导入" onClick={onImport}>
              <Upload />
              导入
            </button>
          </div>
        </div>

        <div className="lib-subtabs">
          {(['all', 'video', 'image', 'audio', 'text'] as SubTab[]).map((s) => (
            <button
              key={s}
              type="button"
              className={sub === s ? 'on' : ''}
              onClick={() => setSub(s)}
            >
              {s === 'all' ? '全部' : s === 'video' ? '视频' : s === 'image' ? '图片' : s === 'audio' ? '音频' : '文本'}
            </button>
          ))}
        </div>

        <div className="lib-scroll">
          <button type="button" className={`folder${folder === 'project' ? ' on' : ''}`} onClick={() => setFolder('project')}>
            <ChevronDown />
            <Folder />
            <span>{data.project?.title || '本项目'} · 本项目</span>
            <span className="count">{projectAssets.length}</span>
          </button>
          {[...folders.entries()]
            .filter(([name]) => name)
            .map(([name, count]) => (
              <button
                type="button"
                key={name}
                className={`folder${folder === 'other' ? ' on' : ''}`}
                onClick={() => setFolder('other')}
                data-tip={`其他任务 · ${name}：导入后自动形成文件夹`}
              >
                <Folder />
                <span>其他任务 · {name}</span>
                <span className="count">{count}</span>
              </button>
            ))}
          <button type="button" className={`folder${folder === 'platform' ? ' on' : ''}`} onClick={() => setFolder('platform')}>
            <Folder />
            <span>平台资产库</span>
            <span className="count">{platformTotal.toLocaleString()}</span>
          </button>

          {loading ? <div className="insp-empty">读取真实资产库…</div> : null}
          {!loading && visible.length === 0 ? (
            <div className="insp-empty">
              这个分类还没有真实素材。<br />
              用「导入」从本机或其他任务拉素材。
            </div>
          ) : null}

          <div className="media-grid">
            {visible.map((a) => {
              const url = mediaUrl(a);
              if (!url) return null;
              const kind = kindOf(a);
              const gif = isGif(a);
              const brokenThis = !!broken[a.id];
              return (
                <div
                  key={a.id}
                  className={`media-card${brokenThis ? ' broken' : ''}`}
                  draggable={!brokenThis}
                  data-kind={kind}
                  data-name={a.name}
                  data-dur={a.durationSeconds || 0}
                  onDragStart={(e) => {
                    startTimelineDrag(e, {
                      kind,
                      url,
                      name: a.name || '未命名素材',
                      durationSeconds: a.durationSeconds || (kind === 'image' ? 5 : undefined),
                    });
                  }}
                  onDragEnd={clearTimelineDrag}
                  onDoubleClick={() => addAt(a, url, kind)}
                  title={`${a.name} · 拖到时间线 · 双击插入播放头`}
                >
                  <button
                    type="button"
                    className="media-open"
                    disabled={brokenThis}
                    onClick={() => {
                      if (brokenThis) {
                        toast.error('这个素材无法打开，已禁止预览与拖拽');
                        return;
                      }
                      setPreview({ asset: a, url, kind });
                    }}
                    aria-label={`预览 ${a.name}`}
                  >
                    {kind === 'audio' ? (
                      <span className="media-audio"><Music2 /></span>
                    ) : kind === 'video' && !gif ? (
                      <video src={url} muted preload="metadata" onError={() => setBroken((p) => ({ ...p, [a.id]: true }))} />
                    ) : (
                      <img
                        src={url}
                        alt={a.name}
                        loading="lazy"
                        onError={() => setBroken((p) => ({ ...p, [a.id]: true }))}
                      />
                    )}
                    <span className="type">{typeLabel(a)}</span>
                    {a.durationSeconds ? <span className="dur">{fmtDur(a.durationSeconds)}</span> : null}
                    <span className="name">{a.name || '未命名素材'}</span>
                  </button>
                  {brokenThis ? <span className="broken-tag">无法打开</span> : (
                    <button type="button" className="card-del" title="从项目资产库删除" onClick={() => void remove(a)}>
                      <Trash2 />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="lib-foot">
          <span>{folder === 'project' ? '本项目资产' : folder === 'platform' ? '平台资产库' : '其他任务'}</span>
          <div className="progressbar"><i style={{ width: `${Math.min(100, Math.round((visible.length / Math.max(1, pool.length)) * 100))}%` }} /></div>
          <span>{visible.length}/{pool.length}</span>
        </div>
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

export default ShenJianLibrary;
