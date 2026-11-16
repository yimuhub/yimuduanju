/**
 * 素材导入对话框（时间线工具条「导入素材」入口）
 * -------------------------------------------------------------
 * 三类来源，对应生产里真实的「复用素材」诉求：
 *   1. 本地电脑：复用 POST /projects/:id/uploads（≤25MB，白名单），上传即成为本项目资产；
 *   2. 其他任务/项目：listProjects + listAssets(projectId) 列出产物，选中即「引用」——
 *      不复制文件，直接用 fileUrl 落到时间线片段，这就是跨任务复用的语义；
 *   3. 资产包（.yimupack / JSON 清单）：平台定义的素材包格式，一次导入一整套
 *      （名称 + 公网/本地上传 URL + 类型 + 时长），逐条校验 URL 与类型，非法整包拒绝。
 *      zip 压缩包不在浏览器解压范围，仍走「本地文件」多选。
 *
 * 组件只负责「选素材」，落到哪条轨/哪个时刻交回调用方（StudioTimeline）决定，
 * 与拖放插入走同一条 addVideo / addAudio 路径，不另起一套写入逻辑。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import { FileVideo, FolderOpen, Image, Loader2, Music2, Package, Search, Upload } from 'lucide-react';
import {
  listAssets,
  mediaUrl,
  uploadLocalFile,
} from '@client/src/api/assets';
import { listProjects } from '@client/src/api/projects';
import type { Asset, ProjectListItem } from '@shared/api.interface';

/** 交给时间线的素材描述（与 timeline-dnd 的载荷同构） */
export interface ImportedMedia {
  name: string;
  url: string;
  kind: 'video' | 'image' | 'audio';
  durationSeconds?: number;
  sourceAssetId?: string;
}

type Tab = 'local' | 'other' | 'pack';

const kindOf = (a: Asset): ImportedMedia['kind'] => {
  const t = (a.assetType || '').toLowerCase();
  if (t === 'audio' || t === 'voice' || t === 'music' || t === 'sfx') return 'audio';
  if (t === 'image' || t === 'start_frame' || t === 'frame') return 'image';
  return 'video';
};

const toImported = (a: Asset): ImportedMedia | null => {
  const url = mediaUrl(a);
  if (!url) return null;
  return {
    name: a.name || '未命名素材',
    url,
    kind: kindOf(a),
    durationSeconds: a.durationSeconds || undefined,
    sourceAssetId: a.id,
  };
};

const KindIcon = ({ kind }: { kind: ImportedMedia['kind'] }) =>
  kind === 'audio' ? (
    <Music2 size={14} />
  ) : kind === 'image' ? (
    <Image size={14} />
  ) : (
    <FileVideo size={14} />
  );

export const StudioImportDialog = ({
  projectId,
  onPick,
  onClose,
}: {
  projectId?: string;
  /** 选中素材：调用方负责落到时间线（播放头位置/轨道由它决定） */
  onPick: (media: ImportedMedia) => void;
  onClose: () => void;
}) => {
  const [tab, setTab] = useState<Tab>('local');
  const [uploading, setUploading] = useState(false);
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [otherProject, setOtherProject] = useState('');
  const [otherAssets, setOtherAssets] = useState<Asset[]>([]);
  const [loadingOther, setLoadingOther] = useState(false);
  const [keyword, setKeyword] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  /** 资产包：清单文件解析后的条目（含 URL/类型/时长） */
  const [pack, setPack] = useState<{ name: string; items: ImportedMedia[] } | null>(null);
  const packRef = useRef<HTMLInputElement>(null);

  // 打开时拉项目列表（给「其他任务」Tab 用）
  useEffect(() => {
    listProjects({ pageSize: 100 })
      .then((res) => {
        const list = res?.items ?? [];
        setProjects(list.filter((p) => p.id !== projectId));
      })
      .catch(() => undefined);
  }, [projectId]);

  // 切换来源项目 → 拉它的可复用产物（图片/视频/音频）
  const loadOtherAssets = useCallback((pid: string) => {
    setOtherProject(pid);
    setOtherAssets([]);
    if (!pid) return;
    setLoadingOther(true);
    Promise.all([
      listAssets({ projectId: pid, pageSize: 100 }),
    ])
      .then(([res]) => {
        const usable = (res?.items ?? []).filter((a) => {
          const t = (a.assetType || '').toLowerCase();
          return (
            (t === 'video' || t === 'image' || t === 'audio' || t === 'start_frame' || t === 'voice' || t === 'music' || t === 'sfx') &&
            !!mediaUrl(a)
          );
        });
        setOtherAssets(usable);
      })
      .catch(() => toast.error('该项目素材加载失败'))
      .finally(() => setLoadingOther(false));
  }, []);

  const onFiles = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0 || !projectId) return;
      setUploading(true);
      let ok = 0;
      for (const file of Array.from(files)) {
        // eslint-disable-next-line no-await-in-loop
        try {
          const probe = document.createElement(file.type.startsWith('audio/') ? 'audio' : 'video');
          const durationSeconds = await new Promise<number | undefined>((resolve) => {
            let done = false;
            const finish = (v?: number) => {
              if (done) return;
              done = true;
              resolve(v);
            };
            probe.preload = 'metadata';
            probe.onloadedmetadata = () =>
              finish(Number.isFinite(probe.duration) ? probe.duration : undefined);
            probe.onerror = () => finish(undefined);
            probe.src = URL.createObjectURL(file);
            setTimeout(() => finish(undefined), 2000);
          });
          URL.revokeObjectURL(probe.src);
          const res = await uploadLocalFile(projectId, file, file.name, durationSeconds);
          const kind: ImportedMedia['kind'] = file.type.startsWith('audio/')
            ? 'audio'
            : file.type.startsWith('image/')
              ? 'image'
              : 'video';
          const url = res.fileUrl || mediaUrl(res.asset);
          if (url) {
            onPick({
              name: file.name,
              url,
              kind,
              durationSeconds,
              sourceAssetId: res.asset?.id,
            });
            ok += 1;
          }
        } catch (err) {
          const status = (err as { response?: { status?: number } })?.response?.status;
          toast.error(`「${file.name}」上传失败${status === 413 ? '（超过 25MB 上限）' : ''}`);
        }
      }
      setUploading(false);
      if (ok > 0) {
        toast.success(`已导入 ${ok} 个素材并插入时间线`, { duration: 1800 });
        onClose();
      }
    },
    [onPick, onClose, projectId],
  );

  /**
   * 读资产包清单（.yimupack / .json）：
   * {"format":"yimu-pack","name":"…","items":[{"name":"…","url":"https://…","kind":"video","durationSeconds":6}]}
   * 只接受 http(s) 或 /uploads/ 的 URL——避免把 javascript:/data: 之类塞进播放链路。
   */
  const onPackFile = useCallback(async (file: File | null) => {
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text) as {
        format?: unknown;
        name?: unknown;
        items?: unknown;
      };
      if (data.format && data.format !== 'yimu-pack') {
        throw new Error('format 必须是 yimu-pack');
      }
      if (!Array.isArray(data.items) || data.items.length === 0) {
        throw new Error('items 为空');
      }
      const items: ImportedMedia[] = data.items.map((raw) => {
        const it = raw as {
          name?: unknown;
          url?: unknown;
          kind?: unknown;
          durationSeconds?: unknown;
          sourceAssetId?: unknown;
        };
        const url = typeof it.url === 'string' ? it.url.trim() : '';
        if (!/^(https?:\/\/|\/uploads\/)/.test(url)) throw new Error(`非法素材地址：${url || '空'}`);
        const kind = it.kind === 'audio' || it.kind === 'image' ? it.kind : 'video';
        if (it.kind && it.kind !== kind) throw new Error(`未知素材类型：${String(it.kind)}`);
        return {
          name: typeof it.name === 'string' && it.name.trim() ? it.name.trim() : '未命名素材',
          url,
          kind,
          durationSeconds:
            Number.isFinite(Number(it.durationSeconds)) && Number(it.durationSeconds) > 0
              ? Number(it.durationSeconds)
              : undefined,
          sourceAssetId:
            typeof it.sourceAssetId === 'string' ? it.sourceAssetId : undefined,
        };
      });
      if (items.length > 200) throw new Error('单个资产包最多 200 条');
      setPack({
        name: typeof data.name === 'string' && data.name.trim() ? data.name.trim() : file.name,
        items,
      });
    } catch (e) {
      setPack(null);
      toast.error(`资产包解析失败：${(e as Error).message}`);
    }
  }, []);

  const filteredOthers = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    if (!q) return otherAssets;
    return otherAssets.filter((a) => (a.name || '').toLowerCase().includes(q));
  }, [otherAssets, keyword]);

  // Portal 到 body：时间线 .tl 带 z-index 建立了层叠上下文，fixed 遮罩留在其中会被挤压/裁剪
  return createPortal(
    <div className="tl-picker-mask tl-import-mask" onClick={onClose}>
      <div className="tl-import" onClick={(e) => e.stopPropagation()}>
        <div className="tl-picker-head">
          <b>导入素材</b>
          <button type="button" title="关闭" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="tl-import-tabs">
          <button
            type="button"
            className={tab === 'local' ? 'on' : ''}
            onClick={() => setTab('local')}
          >
            <Upload size={13} /> 本地文件
          </button>
          <button
            type="button"
            className={tab === 'other' ? 'on' : ''}
            onClick={() => setTab('other')}
          >
            <FolderOpen size={13} /> 其他任务
          </button>
          <button
            type="button"
            className={tab === 'pack' ? 'on' : ''}
            onClick={() => setTab('pack')}
          >
            <Package size={13} /> 资产包
          </button>
        </div>

        {tab === 'local' ? (
          <div className="tl-import-body">
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
            <button
              type="button"
              className="tl-import-drop"
              disabled={uploading || !projectId}
              onClick={() => fileRef.current?.click()}
            >
              {uploading ? <Loader2 size={26} className="spin" /> : <Upload size={26} />}
              <b>{uploading ? '正在导入…' : '点击选择电脑里的素材'}</b>
              <span>视频 / 音频 / 图片，可多选 · 单个 ≤ 25MB</span>
              <span className="hint">导入后按素材类型落到播放头所在的对应轨道</span>
            </button>
          </div>
        ) : null}

        {tab === 'other' ? (
          <div className="tl-import-body">
            <div className="tl-import-row">
              <select
                value={otherProject}
                onChange={(e) => loadOtherAssets(e.target.value)}
              >
                <option value="">选择其他任务 / 项目…</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
              </select>
              <label className="tl-import-search">
                <Search size={12} />
                <input
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  placeholder="按名称筛选"
                />
              </label>
            </div>
            <div className="tl-picker-list">
              {!otherProject ? (
                <div className="empty">先选一个任务，列出它产出的可复用素材</div>
              ) : loadingOther ? (
                <div className="empty">
                  <Loader2 size={13} className="spin" /> 加载中…
                </div>
              ) : filteredOthers.length === 0 ? (
                <div className="empty">这个任务还没有可复用的视频 / 图片 / 音频</div>
              ) : (
                filteredOthers.map((a) => {
                  const media = toImported(a);
                  if (!media) return null;
                  return (
                    <button key={a.id} type="button" onClick={() => { onPick(media); onClose(); }}>
                      <KindIcon kind={media.kind} />
                      <span className="nm">{a.name || '未命名素材'}</span>
                      <span className="du num">
                        {a.durationSeconds ? `${a.durationSeconds.toFixed(1)}s` : kindLabel(media.kind)}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
            <p className="tl-import-note">引用素材不会复制文件：删除源任务资产可能影响这里的片段。</p>
          </div>
        ) : null}

        {tab === 'pack' ? (
          <div className="tl-import-body">
            {pack ? (
              <>
                <div className="tl-import-row">
                  <b className="tl-import-packname">{pack.name}</b>
                  <span className="tl-import-note">{pack.items.length} 条素材</span>
                </div>
                <div className="tl-picker-list">
                  {pack.items.map((it, i) => (
                    <button
                      key={`${it.url}-${i}`}
                      type="button"
                      onClick={() => {
                        onPick(it);
                        onClose();
                      }}
                    >
                      <KindIcon kind={it.kind} />
                      <span className="nm">{it.name}</span>
                      <span className="du num">
                        {it.durationSeconds
                          ? `${it.durationSeconds.toFixed(1)}s`
                          : kindLabel(it.kind)}
                      </span>
                    </button>
                  ))}
                </div>
                <div className="tl-import-row">
                  <button
                    type="button"
                    className="tl-import-primary"
                    onClick={() => {
                      pack.items.forEach((it) => onPick(it));
                      toast.success(`已插入 ${pack.items.length} 条资产包素材`);
                      onClose();
                    }}
                  >
                    全部插入时间线
                  </button>
                  <button type="button" onClick={() => setPack(null)}>
                    换一个资产包
                  </button>
                </div>
              </>
            ) : (
              <div className="tl-import-pack">
                <Package size={28} />
                <b>导入资产包（.yimupack / JSON）</b>
                <p>
                  资产包是一份素材清单：名称 + 地址 + 类型 + 时长。导入后可逐条插入，也可一键全部插入。
                  zip 压缩包请解压后用「本地文件」多选。
                </p>
                <button type="button" onClick={() => packRef.current?.click()}>
                  选择资产包文件
                </button>
                <input
                  ref={packRef}
                  type="file"
                  accept=".yimupack,.json,application/json"
                  hidden
                  onChange={(e) => {
                    void onPackFile(e.target.files?.[0] ?? null);
                    e.target.value = '';
                  }}
                />
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
};

const kindLabel = (k: ImportedMedia['kind']) =>
  k === 'audio' ? '音频' : k === 'image' ? '图片' : '视频';
