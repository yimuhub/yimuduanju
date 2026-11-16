/**
 * 全功能编辑 · 右侧「项目素材库」
 * -------------------------------------------------------------
 * 数据真源 = 当前项目资产表（GET /api/assets/by-project/:id），不是前端副本。
 * 结构按来源分成可折叠文件夹，贴近 NLE 的媒体池：
 *   · 本项目生成：分镜成片、首帧、配音、音乐等
 *   · 其他任务导入：从别的项目引用后落到本项目的记录
 *   · 剪映 / 资产包：兼容导入的外部素材
 * 素材可拖进时间线（与镜头池同一套 DnD 协议），点卡片弹窗预览，可删除。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, FileImage, Film, Music2, Search, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import MediaPreviewDialog, { type MediaKind } from '@client/src/components/MediaPreviewDialog';
import { deleteAsset, listByProject, mediaUrl } from '@client/src/api/assets';
import type { Asset } from '@shared/api.interface';
import { useStudio } from './StudioShell';
import { clearTimelineDrag, startTimelineDrag } from '@client/src/lib/timeline-dnd';

type FolderKey = string;

const FOLDER_LABEL: Record<FolderKey, string> = {
  local: '本项目生成',
  imported: '其他任务导入',
  jianying: '剪映草稿包',
  pack: '资产包',
};

const kindOf = (a: Asset): MediaKind => {
  const t = (a.assetType || '').toLowerCase();
  if (t === 'audio' || t === 'voice' || t === 'music' || t === 'sfx') return 'audio';
  if (t === 'image' || t === 'frame' || t === 'start_frame') return 'image';
  return 'video';
};

const folderOf = (a: Asset): FolderKey => {
  if (a.sourceType === 'jianying') return 'jianying';
  if (a.sourceType === 'pack') return 'pack';
  if (a.sourceType === 'imported') {
    // 导入时资产名带「[项目名] 」前缀：按来源项目自动分文件夹，避免所有外部素材混成一堆
    const project = /^\[([^\]]+)\]/.exec(a.name || '')?.[1];
    return project ? `imported:${project}` : 'imported';
  }
  return 'local';
};

const folderLabel = (key: FolderKey): string =>
  key.startsWith('imported:')
    ? `其他任务 · ${key.slice('imported:'.length)}`
    : FOLDER_LABEL[key as keyof typeof FOLDER_LABEL] ?? '其他素材';

const KindIcon = ({ kind }: { kind: MediaKind }) => {
  if (kind === 'audio') return <Music2 size={11} />;
  if (kind === 'image') return <FileImage size={11} />;
  return <Film size={11} />;
};

export const StudioAssetLibrary = () => {
  const { projectId } = useStudio();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [open, setOpen] = useState<Record<FolderKey, boolean>>({
    local: true,
    imported: true,
    jianying: true,
    pack: true,
  });
  const [preview, setPreview] = useState<{ asset: Asset; url: string; kind: MediaKind } | null>(null);

  const refresh = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const rows = await listByProject(projectId);
      setAssets(rows);
    } catch {
      /* 素材库读失败不阻断剪辑，时间线仍可用 */
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void refresh();
    const onChange = () => void refresh();
    window.addEventListener('yimu:assets-changed', onChange);
    return () => window.removeEventListener('yimu:assets-changed', onChange);
  }, [refresh]);

  const filtered = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    if (!q) return assets;
    return assets.filter((a) => (a.name || '').toLowerCase().includes(q));
  }, [assets, keyword]);

  const folders = useMemo(() => {
    const map = new Map<FolderKey, Asset[]>();
    for (const a of filtered) {
      const key = folderOf(a);
      const list = map.get(key);
      if (list) list.push(a);
      else map.set(key, [a]);
    }
    const baseOrder = ['local', 'jianying', 'pack', 'imported'];
    return [...map.entries()]
      .map(([key, items]) => ({ key, label: folderLabel(key), items }))
      .sort((a, b) => {
        const ai = baseOrder.indexOf(a.key);
        const bi = baseOrder.indexOf(b.key);
        if (ai !== bi) return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
        return a.label.localeCompare(b.label, 'zh-CN');
      });
  }, [filtered]);

  const remove = async (a: Asset) => {
    const ok = window.confirm(
      `删除素材「${a.name}」？\n\n资产库记录会被删除；时间线里已经引用的片段可能失效，请先确认没有在用。`,
    );
    if (!ok) return;
    try {
      await deleteAsset(a.id);
      setAssets((prev) => prev.filter((x) => x.id !== a.id));
      toast.success('素材已从项目资产库删除');
    } catch {
      toast.error('删除失败，请稍后重试');
    }
  };

  return (
    <div className="sp-assets">
      <div className="sp-assets-search">
        <Search size={12} />
        <input
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="搜索项目素材…"
        />
        <button type="button" className="sp-import mini" onClick={() => window.dispatchEvent(new CustomEvent('yimu:studio-import'))}>
          <Upload size={11} />
          导入
        </button>
      </div>

      <div className="sp-assets-list">
        {loading && assets.length === 0 ? <div className="sp-empty">读取项目资产库…</div> : null}
        {!loading && folders.length === 0 ? (
          <div className="sp-empty">项目里还没有素材<br />用「导入」拉电脑文件或其他任务产物</div>
        ) : null}
        {folders.map((folder) => (
          <div className="sp-folder" key={folder.key}>
            <button
              type="button"
              className="sp-folder-head"
              onClick={() => setOpen((prev) => ({ ...prev, [folder.key]: !prev[folder.key] }))}
            >
              {open[folder.key] ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              <b>{folder.label}</b>
              <span className="num">{folder.items.length}</span>
            </button>
            {open[folder.key]
              ? folder.items.map((a) => {
                  const kind = kindOf(a);
                  const url = mediaUrl(a);
                  return (
                    <div className="sp-asset" key={a.id}>
                      <button
                        type="button"
                        className="sp-asset-main"
                        draggable={!!url}
                        title={`${a.name} · 拖到时间线即可使用`}
                        onClick={() => url && setPreview({ asset: a, url, kind })}
                        onDragStart={(e) => {
                          if (!url) return;
                          startTimelineDrag(e, {
                            kind,
                            url,
                            name: a.name || '未命名素材',
                            durationSeconds: a.durationSeconds || (kind === 'image' ? 5 : undefined),
                          });
                        }}
                        onDragEnd={() => clearTimelineDrag()}
                      >
                        <span className={`sp-asset-ico ${kind}`}>
                          {a.thumbnailUrl ? <img src={a.thumbnailUrl} alt="" loading="lazy" /> : <KindIcon kind={kind} />}
                        </span>
                        <span className="sp-asset-meta">
                          <b>{a.name || '未命名素材'}</b>
                          <small>
                            {kind === 'audio' ? '音频' : kind === 'image' ? '图片' : '视频'}
                            {a.durationSeconds ? ` · ${a.durationSeconds.toFixed(1)}s` : ''}
                          </small>
                        </span>
                      </button>
                      <button type="button" className="sp-del" title="从项目资产库删除" onClick={() => void remove(a)}>
                        <Trash2 size={11} />
                      </button>
                    </div>
                  );
                })
              : null}
          </div>
        ))}
      </div>

      {preview ? (
        <MediaPreviewDialog
          url={preview.url}
          kind={preview.kind}
          title={preview.asset.name}
          onClose={() => setPreview(null)}
        />
      ) : null}
    </div>
  );
};

export default StudioAssetLibrary;
