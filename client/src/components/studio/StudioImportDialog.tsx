/**
 * 素材导入 · 全量资产 / 项目素材 / 平台素材 / 资产包
 * -------------------------------------------------------------
 * 交互原则（商业交付版）：
 *   1. 先预览、后确认：任何素材点开先弹窗，确认才写入本项目素材库；
 *   2. 导入只进素材库，不直接落时间线；落轨由用户从右侧素材库拖入；
 *   3. 只有 status=ready、非 mock、并且浏览器真的能解码打开的素材才可选；
 *   4. 支持全选可用、批量导入；支持整个平台资产库（跨项目汇总 + 类型/项目筛选）。
 *
 * 剪映兼容沿用 lib/jianying-import：明文 zip/json 直接提取进素材库；
 * 6.0+ 加密包明确报错，不破解。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import {
  Check,
  FileImage,
  Film,
  FolderOpen,
  Globe2,
  Loader2,
  Music2,
  Package,
  Search,
  Upload,
  X,
} from 'lucide-react';
import {
  createAsset,
  listAssets,
  listByProject,
  mediaUrl,
  updateAsset,
  uploadLocalFile,
} from '@client/src/api/assets';
import { listProjects } from '@client/src/api/projects';
import type { Asset, ProjectListItem } from '@shared/api.interface';
import { importJianyingPackage } from '@client/src/lib/jianying-import';
import { probeMediaOpenable, probeMediaReachable } from '@client/src/lib/media-validate';
import { isGifUrl } from '@client/src/lib/media-kind';
import MediaPreviewDialog from '@client/src/components/MediaPreviewDialog';

/** 交给项目资产库的素材描述 */
export interface ImportedMedia {
  name: string;
  url: string;
  kind: 'video' | 'image' | 'audio';
  durationSeconds?: number;
  sourceAssetId?: string;
  sourceProjectId?: string;
  sourceProjectName?: string;
  fileUrl?: string;
  thumbnailUrl?: string;
  mimeType?: string;
  sourceType?: 'imported' | 'pack' | 'jianying';
}

type Tab = 'local' | 'project' | 'platform' | 'pack';
type TypeFilter = 'all' | 'video' | 'image' | 'audio';
type Availability = 'checking' | 'ok' | 'bad';

interface PreviewItem {
  media: ImportedMedia;
  title: string;
  sourceLabel: string;
}

const kindOf = (a: Asset): ImportedMedia['kind'] => {
  const t = (a.assetType || '').toLowerCase();
  if (t === 'audio' || t === 'voice' || t === 'music' || t === 'sfx') return 'audio';
  if (t === 'image' || t === 'start_frame' || t === 'frame' || t === 'cover') return 'image';
  return 'video';
};

const toImported = (
  a: Asset,
  source?: { projectId?: string; projectName?: string; sourceType?: ImportedMedia['sourceType'] },
): ImportedMedia | null => {
  const url = mediaUrl(a);
  if (!url) return null;
  return {
    name: a.name || '未命名素材',
    url,
    kind: kindOf(a),
    durationSeconds: a.durationSeconds || undefined,
    sourceAssetId: a.id,
    sourceProjectId: source?.projectId ?? a.projectId,
    sourceProjectName: source?.projectName,
    fileUrl: a.fileUrl,
    thumbnailUrl: a.thumbnailUrl,
    mimeType: a.mimeType,
    sourceType: source?.sourceType,
  };
};

const isAssetSane = (a: Asset): boolean =>
  (a.status || '').toLowerCase() === 'ready' &&
  !a.mock &&
  Boolean(a.fileUrl) &&
  !(typeof a.fileSize === 'number' && a.fileSize <= 0);

const keyOf = (m: ImportedMedia): string =>
  m.sourceAssetId ? `asset:${m.sourceAssetId}` : `url:${m.url}|${m.name}`;

const typeLabel = (k: ImportedMedia['kind']) =>
  k === 'audio' ? '音频' : k === 'image' ? '图片' : '视频';

const KindIcon = ({ kind }: { kind: ImportedMedia['kind'] }) =>
  kind === 'audio' ? <Music2 size={14} /> : kind === 'image' ? <FileImage size={14} /> : <Film size={14} />;

/** 视频首帧缩略：进入视口才加载，避免 240 张卡片同时解码视频拖慢弹窗 */
const VideoFrame = ({ src }: { src: string }) => {
  const hostRef = useRef<HTMLSpanElement | null>(null);
  const [visible, setVisible] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const el = hostRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: '220px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <span ref={hostRef} className="imp-vframe">
      {visible && !failed ? (
        <video
          src={src}
          muted
          playsInline
          preload="metadata"
          onLoadedMetadata={(e) => {
            try {
              const v = e.currentTarget;
              if (Number.isFinite(v.duration) && v.duration > 0.3) v.currentTime = 0.25;
            } catch {
              /* 首帧定位失败时保留默认首帧 */
            }
          }}
          onError={() => setFailed(true)}
        />
      ) : (
        <KindIcon kind="video" />
      )}
    </span>
  );
};

const Thumb = ({ asset, media }: { asset?: Asset; media: ImportedMedia }) => {
  const thumb = asset?.thumbnailUrl || (media.kind === 'image' ? media.url : undefined);
  return (
    <span className={`imp-thumb ${media.kind}`}>
      {thumb ? (
        <img src={thumb} alt="" loading="lazy" />
      ) : media.kind === 'video' ? (
        <VideoFrame src={media.url} />
      ) : (
        <KindIcon kind={media.kind} />
      )}
      {isGifUrl(media.url) ? <b className="imp-gif">GIF</b> : null}
      <em>{typeLabel(media.kind)}</em>
    </span>
  );
};

export const StudioImportDialog = ({
  projectId,
  onClose,
  onImported,
}: {
  projectId?: string;
  onClose: () => void;
  /** 导入完成（素材已进本项目资产库），调用方刷新素材库即可，不落时间线 */
  onImported?: (count: number) => void;
}) => {
  const [tab, setTab] = useState<Tab>('project');
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [projectScope, setProjectScope] = useState('');
  /** 平台 Tab 独立作用域：默认全平台，不受「项目素材」下拉影响 */
  const [platformScope, setPlatformScope] = useState('__all__');
  const [projectAssets, setProjectAssets] = useState<Asset[]>([]);
  const [platformAssets, setPlatformAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  /** 资产可能有上千条：默认先显示 240，按需加载更多，避免一次渲染 DOM 卡死 */
  const [displayLimit, setDisplayLimit] = useState(240);
  const [availability, setAvailability] = useState<Record<string, Availability>>({});
  const [selected, setSelected] = useState<Record<string, ImportedMedia>>({});
  const [preview, setPreview] = useState<PreviewItem | null>(null);
  const [previewChecking, setPreviewChecking] = useState(false);
  const [importing, setImporting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [pack, setPack] = useState<{ name: string; items: ImportedMedia[] } | null>(null);
  const [importingPack, setImportingPack] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const packRef = useRef<HTMLInputElement>(null);

  const projectName = useMemo(() => {
    const map = new Map(projects.map((p) => [p.id, p.title]));
    return (id?: string) => (id ? map.get(id) || '其他任务' : '平台素材');
  }, [projects]);

  // 项目列表
  useEffect(() => {
    listProjects({ pageSize: 100 })
      .then((res) => {
        const list = res?.items ?? [];
        setProjects(list.filter((p) => p.id !== projectId));
        setProjectScope((prev) => prev || list.find((p) => p.id !== projectId)?.id || '');
      })
      .catch(() => undefined);
  }, [projectId]);

  // 当前项目素材（供「本项目」参考，也可复用；默认显示其他项目）
  const loadProject = useCallback(async (pid: string) => {
    if (!pid) {
      setProjectAssets([]);
      return;
    }
    setLoading(true);
    try {
      const rows = await listByProject(pid);
      setProjectAssets((rows ?? []).filter(Boolean));
    } catch {
      toast.error('该项目素材加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab === 'project' && projectScope) void loadProject(projectScope);
  }, [tab, projectScope, loadProject]);

  // 整个平台：分页拉全量（最多 1000 条，避免一次把前端压死）
  const loadPlatform = useCallback(async (pid?: string) => {
    setLoading(true);
    try {
      const all: Asset[] = [];
      for (let page = 1; page <= 10; page += 1) {
        // eslint-disable-next-line no-await-in-loop
        const res = await listAssets({ page, pageSize: 100, projectId: pid || undefined });
        all.push(...(res.items ?? []));
        if ((res.items ?? []).length === 0 || all.length >= 300) break;
      }
      setPlatformAssets(all.slice(0, 300));
    } catch {
      toast.error('平台资产库加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab === 'platform') void loadPlatform(platformScope === '__all__' ? undefined : platformScope);
  }, [tab, platformScope, loadPlatform]);

  const scopedPlatform = useMemo(() => {
    if (!platformScope || platformScope === '__all__') return platformAssets;
    return platformAssets.filter((a) => a.projectId === platformScope);
  }, [platformAssets, platformScope]);

  const filteredAssets = useMemo(() => {
    const raw = tab === 'platform' ? scopedPlatform : projectAssets;
    const q = keyword.trim().toLowerCase();
    return raw.filter((a) => {
      if (!isAssetSane(a)) return false;
      if (typeFilter !== 'all' && kindOf(a) !== typeFilter) return false;
      return !q || (a.name || '').toLowerCase().includes(q);
    });
  }, [tab, scopedPlatform, projectAssets, keyword, typeFilter]);
  const currentAssets = useMemo(
    () => filteredAssets.slice(0, displayLimit),
    [filteredAssets, displayLimit],
  );
  useEffect(() => {
    setDisplayLimit(240);
  }, [tab, projectScope, platformScope, keyword, typeFilter]);

  const currentPack = useMemo(() => {
    if (tab !== 'pack' || !pack) return [];
    const q = keyword.trim().toLowerCase();
    return pack.items.filter((m) => {
      if (typeFilter !== 'all' && m.kind !== typeFilter) return false;
      return !q || m.name.toLowerCase().includes(q);
    });
  }, [tab, pack, keyword, typeFilter]);

  // 校验：只对当前可见列表做真实解码探测（并发 4）
  useEffect(() => {
    if (tab !== 'project' && tab !== 'platform') return undefined;
    const list = currentAssets;
    if (list.length === 0) return undefined;
    let cancelled = false;
    let index = 0;
    const worker = async () => {
      while (!cancelled) {
        const at = index;
        index += 1;
        if (at >= list.length) return;
        const a = list[at];
        if (availability[a.id]) continue;
        setAvailability((prev) => (prev[a.id] ? prev : { ...prev, [a.id]: 'checking' }));
        const media = toImported(a);
        const ok = Boolean(media) && (await probeMediaReachable(media!.url, 4000));
        if (cancelled) return;
        setAvailability((prev) => ({ ...prev, [a.id]: ok ? 'ok' : 'bad' }));
      }
    };
    void Promise.all(Array.from({ length: 8 }, () => worker()));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentAssets, tab]);

  const markBad = useCallback((media: ImportedMedia) => {
    if (media.sourceAssetId) {
      setAvailability((prev) => ({ ...prev, [media.sourceAssetId!]: 'bad' }));
    }
  }, []);

  const openPreview = useCallback(async (media: ImportedMedia, sourceLabel: string) => {
    if (media.sourceAssetId && availability[media.sourceAssetId] === 'bad') {
      toast.error('该素材文件不完整或已损坏，无法预览/导入');
      return;
    }
    setPreviewChecking(true);
    const ok = await probeMediaOpenable(media.url, media.kind, 6000);
    setPreviewChecking(false);
    if (!ok) {
      markBad(media);
      toast.error('无法打开该素材：文件可能未生成完整、已损坏或地址失效');
      return;
    }
    setPreview({ media, title: media.name, sourceLabel });
  }, [availability, markBad]);

  const copyToLibrary = useCallback(
    async (media: ImportedMedia): Promise<boolean> => {
      if (!projectId) return false;
      // 本地上传已经建过资产，不重复建
      if (media.sourceProjectId === projectId && media.sourceAssetId) return true;
      try {
        await createAsset({
          projectId,
          assetType: media.kind,
          name:
            media.sourceProjectName && media.sourceProjectName !== projectName(projectId)
              ? `[${media.sourceProjectName}] ${media.name}`.slice(0, 200)
              : media.name.slice(0, 200),
          fileUrl: media.fileUrl || media.url,
          thumbnailUrl: media.thumbnailUrl,
          durationSeconds: media.durationSeconds,
          mimeType: media.mimeType,
          sourceType: media.sourceType || 'imported',
          sourceId: media.sourceAssetId,
        });
        return true;
      } catch {
        return false;
      }
    },
    [projectId, projectName],
  );

  const importMany = useCallback(
    async (items: ImportedMedia[]) => {
      if (!projectId || items.length === 0) return;
      setImporting(true);
      setProgress({ done: 0, total: items.length });
      let ok = 0;
      // 同一来源资产只落一条：反复「全选导入」不会在素材库里堆重复副本
      const existingSourceIds = new Set(
        (await listByProject(projectId).catch(() => []))
          .map((a) => a.sourceId)
          .filter((id): id is string => Boolean(id)),
      );
      for (let i = 0; i < items.length; i += 1) {
        const item = items[i];
        if (item.sourceAssetId && existingSourceIds.has(item.sourceAssetId)) {
          ok += 1;
          setProgress({ done: i + 1, total: items.length });
          continue;
        }
        // eslint-disable-next-line no-await-in-loop
        const done = await copyToLibrary(item);
        if (done) {
          ok += 1;
          if (item.sourceAssetId) existingSourceIds.add(item.sourceAssetId);
        }
        setProgress({ done: i + 1, total: items.length });
      }
      setImporting(false);
      setProgress(null);
      if (ok > 0) {
        window.dispatchEvent(new CustomEvent('yimu:assets-changed'));
        toast.success(`已导入 ${ok} 条素材到项目素材库，可从右侧拖入时间线`, { duration: 2200 });
        onImported?.(ok);
        onClose();
      } else {
        toast.error('没有素材导入成功，请检查素材地址或稍后重试');
      }
    },
    [projectId, copyToLibrary, onImported, onClose],
  );

  // 本地文件：上传即成为本项目资产；上传后只提示进素材库，不落时间线
  const onFiles = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0 || !projectId) return;
      setUploading(true);
      const created: string[] = [];
      for (const file of Array.from(files)) {
        // eslint-disable-next-line no-await-in-loop
        try {
          const ext = file.name.split('.').pop()?.replace(/[^a-z0-9]/gi, '').slice(0, 8) || 'bin';
          const headerName = `upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
          const res = await uploadLocalFile(projectId, file, headerName);
          if (res.asset?.id) {
            await updateAsset(res.asset.id, { name: file.name.slice(0, 80) }).catch(() => undefined);
            created.push(file.name);
          }
        } catch (err) {
          const status = (err as { response?: { status?: number } })?.response?.status;
          toast.error(`「${file.name}」上传失败${status === 413 ? '（文件过大）' : ''}`);
        }
      }
      setUploading(false);
      if (created.length > 0) {
        window.dispatchEvent(new CustomEvent('yimu:assets-changed'));
        toast.success(`已上传 ${created.length} 个素材到项目素材库，可从右侧拖入时间线`, { duration: 2200 });
        onImported?.(created.length);
        onClose();
      }
    },
    [projectId, onImported, onClose],
  );

  const onPackFile = useCallback(async (file: File | null) => {
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text) as {
        format?: unknown; name?: unknown; items?: unknown; materials?: unknown; tracks?: unknown;
      };
      if (data.materials || data.tracks) {
        if (!projectId) throw new Error('缺少项目 ID');
        setImportingPack(true);
        const res = await importJianyingPackage(file, projectId);
        toast.success(`已从剪映草稿提取 ${res.imported} 条素材到项目素材库`, { duration: 2400 });
        res.warnings.forEach((w) => toast.info(w, { duration: 3200 }));
        window.dispatchEvent(new CustomEvent('yimu:assets-changed'));
        onImported?.(res.imported);
        onClose();
        return;
      }
      if (data.format && data.format !== 'yimu-pack') throw new Error('format 必须是 yimu-pack');
      if (!Array.isArray(data.items) || data.items.length === 0) throw new Error('items 为空');
      const items: ImportedMedia[] = data.items.map((raw) => {
        const it = raw as Record<string, unknown>;
        const url = typeof it.url === 'string' ? it.url.trim() : '';
        if (!/^(https?:\/\/|\/uploads\/)/.test(url)) throw new Error(`非法素材地址：${url || '空'}`);
        const kind = it.kind === 'audio' || it.kind === 'image' ? it.kind : 'video';
        return {
          name: typeof it.name === 'string' && it.name.trim() ? it.name.trim() : '未命名素材',
          url,
          kind,
          durationSeconds:
            Number.isFinite(Number(it.durationSeconds)) && Number(it.durationSeconds) > 0
              ? Number(it.durationSeconds)
              : undefined,
          sourceAssetId: typeof it.sourceAssetId === 'string' ? it.sourceAssetId : undefined,
          sourceType: 'pack' as const,
        };
      });
      if (items.length > 200) throw new Error('单个资产包最多 200 条');
      setPack({ name: typeof data.name === 'string' && data.name.trim() ? data.name.trim() : file.name, items });
    } catch (e) {
      setPack(null);
      toast.error(`资产包解析失败：${(e as Error).message}`);
    } finally {
      setImportingPack(false);
    }
  }, [projectId, onImported, onClose]);

  const onZipFile = useCallback(async (file: File | null) => {
    if (!file || !projectId) return;
    setImportingPack(true);
    try {
      const res = await importJianyingPackage(file, projectId);
      toast.success(`已导入 ${res.imported} 条素材到项目素材库`, { duration: 2400 });
      res.warnings.forEach((w) => toast.info(w, { duration: 3200 }));
      window.dispatchEvent(new CustomEvent('yimu:assets-changed'));
      onImported?.(res.imported);
      onClose();
    } catch (e) {
      toast.error(`导入失败：${(e as Error).message}`, { duration: 4200 });
    } finally {
      setImportingPack(false);
    }
  }, [projectId, onImported, onClose]);

  const toggleSelect = (media: ImportedMedia) => {
    const key = keyOf(media);
    setSelected((prev) => {
      const next = { ...prev };
      if (next[key]) delete next[key];
      else next[key] = media;
      return next;
    });
  };

  const visibleSelectable = useMemo(() => {
    if (tab === 'project' || tab === 'platform') {
      return currentAssets
        .filter((a) => availability[a.id] === 'ok')
        .map((a) => toImported(a, { projectId: a.projectId, projectName: projectName(a.projectId), sourceType: 'imported' }))
        .filter((m): m is ImportedMedia => Boolean(m));
    }
    return currentPack;
  }, [tab, currentAssets, availability, currentPack, projectName]);

  const allVisibleSelected = visibleSelectable.length > 0 && visibleSelectable.every((m) => selected[keyOf(m)]);
  const toggleAll = () => {
    if (allVisibleSelected) {
      const keys = new Set(visibleSelectable.map(keyOf));
      setSelected((prev) => {
        const next = { ...prev };
        for (const k of keys) delete next[k];
        return next;
      });
    } else {
      setSelected((prev) => {
        const next = { ...prev };
        for (const m of visibleSelectable) next[keyOf(m)] = m;
        return next;
      });
    }
  };
  const selectedCount = Object.keys(selected).length;

  const card = (a: Asset) => {
    const media = toImported(a, {
      projectId: a.projectId,
      projectName: projectName(a.projectId),
      sourceType: 'imported',
    });
    if (!media) return null;
    const st = availability[a.id] || 'checking';
    const disabled = st !== 'ok';
    const checked = Boolean(selected[keyOf(media)]);
    return (
      <div
        key={a.id}
        className={`imp-card${disabled ? ' disabled' : ''}${checked ? ' picked' : ''}`}
        role="button"
        tabIndex={disabled ? -1 : 0}
        onClick={() => !disabled && !previewChecking && void openPreview(media, projectName(a.projectId))}
        onKeyDown={(e) => {
          if (!disabled && (e.key === 'Enter' || e.key === ' ')) void openPreview(media, projectName(a.projectId));
        }}
      >
        <Thumb asset={a} media={media} />
        <div className="imp-card-info">
          <b title={a.name || '未命名素材'}>{a.name || '未命名素材'}</b>
          <small>
            {projectName(a.projectId)} · {typeLabel(media.kind)}
            {media.durationSeconds ? ` · ${media.durationSeconds.toFixed(1)}s` : ''}
          </small>
        </div>
        <label className="imp-check" onClick={(e) => e.stopPropagation()} title="勾选后批量导入">
          <input
            type="checkbox"
            checked={checked}
            disabled={disabled}
            onChange={() => toggleSelect(media)}
          />
          <span>{checked ? <Check size={11} /> : null}</span>
        </label>
        {st === 'checking' ? (
          <span className="imp-state checking"><Loader2 size={11} className="spin" /> 校验中</span>
        ) : st === 'bad' ? (
          <span className="imp-state bad" title="文件不完整或无法解码">不可用</span>
        ) : null}
      </div>
    );
  };

  const packCard = (media: ImportedMedia) => {
    const checked = Boolean(selected[keyOf(media)]);
    return (
      <div
        key={keyOf(media)}
        className={`imp-card${checked ? ' picked' : ''}`}
        role="button"
        tabIndex={0}
        onClick={() => !previewChecking && void openPreview(media, pack?.name || '资产包')}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') void openPreview(media, pack?.name || '资产包');
        }}
      >
        <Thumb media={media} />
        <div className="imp-card-info">
          <b title={media.name}>{media.name}</b>
          <small>{typeLabel(media.kind)}{media.durationSeconds ? ` · ${media.durationSeconds.toFixed(1)}s` : ''}</small>
        </div>
        <label className="imp-check" onClick={(e) => e.stopPropagation()}>
          <input type="checkbox" checked={checked} onChange={() => toggleSelect(media)} />
          <span>{checked ? <Check size={11} /> : null}</span>
        </label>
      </div>
    );
  };

  const typeChips: { key: TypeFilter; label: string }[] = [
    { key: 'all', label: '全部' },
    { key: 'video', label: '视频' },
    { key: 'image', label: '图片' },
    { key: 'audio', label: '音频' },
  ];

  return createPortal(
    <div className="imp-mask" onClick={onClose}>
      <div className="imp-modal" onClick={(e) => e.stopPropagation()}>
        <div className="imp-head">
          <div>
            <b>导入素材到项目素材库</b>
            <small>先预览确认，再进素材库；不会直接插入时间线</small>
          </div>
          <button type="button" className="imp-close" title="关闭" onClick={onClose}>
            <X size={15} />
          </button>
        </div>

        <div className="imp-tabs">
          <button type="button" className={tab === 'project' ? 'on' : ''} onClick={() => setTab('project')}>
            <FolderOpen size={13} /> 项目素材
          </button>
          <button type="button" className={tab === 'platform' ? 'on' : ''} onClick={() => setTab('platform')}>
            <Globe2 size={13} /> 整个平台资产库
          </button>
          <button type="button" className={tab === 'local' ? 'on' : ''} onClick={() => setTab('local')}>
            <Upload size={13} /> 本地文件
          </button>
          <button type="button" className={tab === 'pack' ? 'on' : ''} onClick={() => setTab('pack')}>
            <Package size={13} /> 资产包 / 剪映
          </button>
        </div>

        {tab === 'project' || tab === 'platform' ? (
          <div className="imp-filters">
            <select
              value={tab === 'platform' ? platformScope : projectScope}
              onChange={(e) => (tab === 'platform' ? setPlatformScope(e.target.value) : setProjectScope(e.target.value))}
            >
              {tab === 'platform' ? <option value="__all__">全部项目</option> : null}
              {tab === 'platform' ? null : <option value="">选择其他任务 / 项目…</option>}
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.title}</option>
              ))}
            </select>
            <label className="imp-search">
              <Search size={12} />
              <input value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="按名称筛选" />
            </label>
            <div className="imp-types">
              {typeChips.map((c) => (
                <button key={c.key} type="button" className={typeFilter === c.key ? 'on' : ''} onClick={() => setTypeFilter(c.key)}>
                  {c.label}
                </button>
              ))}
            </div>
            <button type="button" className={`imp-select-all${allVisibleSelected ? ' on' : ''}`} onClick={toggleAll} disabled={visibleSelectable.length === 0}>
              {allVisibleSelected ? '取消全选' : `全选可用（${visibleSelectable.length}）`}
            </button>
          </div>
        ) : null}

        <div className="imp-body">
          {tab === 'project' || tab === 'platform' ? (
            loading ? (
              <div className="imp-empty"><Loader2 size={16} className="spin" /> 正在加载素材…</div>
            ) : !projectScope && tab === 'project' ? (
              <div className="imp-empty">先选择一个任务，列出它产出的可复用素材</div>
            ) : currentAssets.length === 0 ? (
              <div className="imp-empty">没有符合筛选条件的视频 / 图片 / 音频</div>
            ) : (
              <>
                <div className="imp-grid">{currentAssets.map(card)}</div>
                {filteredAssets.length > currentAssets.length ? (
                  <div className="imp-more-wrap">
                    <button type="button" className="imp-cancel" onClick={() => setDisplayLimit((n) => n + 240)}>
                      显示更多（已显示 {currentAssets.length}/{filteredAssets.length}）
                    </button>
                  </div>
                ) : null}
              </>
            )
          ) : null}

          {tab === 'local' ? (
            <div className="imp-local">
              <input
                ref={fileRef}
                type="file"
                multiple
                accept="video/*,audio/*,image/*"
                hidden
                onChange={(e) => {
                  void onFiles(e.target.files);
                  e.target.value = '';
                }}
              />
              <button type="button" className="imp-drop" disabled={uploading || !projectId} onClick={() => fileRef.current?.click()}>
                {uploading ? <Loader2 size={26} className="spin" /> : <Upload size={26} />}
                <b>{uploading ? '正在上传…' : '点击选择电脑里的素材'}</b>
                <span>视频 / 音频 / 图片，可多选 · 单个 ≤ 25MB</span>
                <em>上传完成后只进入项目素材库，不会直接落到时间线</em>
              </button>
            </div>
          ) : null}

          {tab === 'pack' ? (
            pack ? (
              <>
                <div className="imp-pack-head">
                  <b>{pack.name}</b>
                  <span>{pack.items.length} 条素材</span>
                  <button type="button" onClick={() => { setPack(null); setSelected({}); }}>换一个包</button>
                </div>
                {currentPack.length === 0 ? (
                  <div className="imp-empty">没有符合筛选条件的素材</div>
                ) : (
                  <div className="imp-grid">{currentPack.map(packCard)}</div>
                )}
              </>
            ) : (
              <div className="imp-local">
                <input
                  ref={packRef}
                  type="file"
                  accept=".yimupack,.json,.zip,application/json,application/zip"
                  hidden
                  onChange={(e) => {
                    const file = e.target.files?.[0] ?? null;
                    if (file && /\.zip$/i.test(file.name)) void onZipFile(file);
                    else void onPackFile(file);
                    e.target.value = '';
                  }}
                />
                <button type="button" className="imp-drop" disabled={importingPack} onClick={() => packRef.current?.click()}>
                  {importingPack ? <Loader2 size={26} className="spin" /> : <Package size={26} />}
                  <b>{importingPack ? '正在导入…' : '选择资产包 / 剪映草稿包'}</b>
                  <span>支持 .yimupack 清单、剪映 5.9 明文 zip/json、普通素材 zip</span>
                  <em>剪映 6.0+ 加密草稿无法解密，会明确提示</em>
                </button>
              </div>
            )
          ) : null}
        </div>

        <div className="imp-foot">
          <span>
            {tab === 'project' || tab === 'platform'
              ? `已选 ${selectedCount} 条 · 仅可导入校验通过的素材${filteredAssets.length > currentAssets.length ? ` · 当前列表 ${currentAssets.length}/${filteredAssets.length}` : ''}`
              : `已选 ${selectedCount} 条`}
          </span>
          <div className="spacer" />
          {progress ? <span className="imp-progress">{progress.done}/{progress.total}</span> : null}
          <button type="button" className="imp-cancel" onClick={onClose}>取消</button>
          <button
            type="button"
            className="imp-primary"
            disabled={importing || selectedCount === 0}
            onClick={() => void importMany(Object.values(selected))}
          >
            {importing ? <Loader2 size={13} className="spin" /> : null}
            导入选中到素材库
          </button>
        </div>
      </div>

      {preview ? (
        <MediaPreviewDialog
          url={preview.media.url}
          kind={preview.media.kind}
          title={`${preview.title} · ${preview.sourceLabel}`}
          onClose={() => setPreview(null)}
          footer={
            <>
              <button type="button" className="imp-cancel" onClick={() => setPreview(null)}>取消</button>
              <button
                type="button"
                className="imp-primary"
                disabled={importing}
                onClick={() => void importMany([preview.media])}
              >
                {importing ? <Loader2 size={13} className="spin" /> : null}
                确认导入素材库
              </button>
            </>
          }
        />
      ) : null}
    </div>,
    document.body,
  );
};

export default StudioImportDialog;
