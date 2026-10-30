import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search,
  Upload,
  Image as ImageIcon,
  Eye,
  Trash2,
  X,
  Download,
  ArrowUpDown,
  Sparkles,
} from 'lucide-react';
import { assets as assetsApi, projects as projectsApi } from '@client/src/api';
import type { Asset, ProjectListItem } from '@shared/api.interface';
import { logger } from '@client/src/utils/logger';
import { toast } from 'sonner';
import AssetPreviewModal, {
  formatFileSize,
  formatDuration,
  getTypeIcon,
  getTypeGradient,
  getSourceLabel,
  TYPE_LABELS,
} from './AssetPreviewModal';
import { showConfirm } from '@client/src/components/ui/confirm';
import PageHeader from '@client/src/components/PageHeader';

type AssetTypeFilter = 'all' | 'image' | 'video' | 'audio' | 'subtitle';
type SortKey = 'newest' | 'oldest' | 'largest' | 'name';

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'newest', label: '最新优先' },
  { key: 'oldest', label: '最早优先' },
  { key: 'largest', label: '体积最大' },
  { key: 'name', label: '名称 A-Z' },
];

const TYPE_FILTERS: { key: AssetTypeFilter; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'image', label: '图片' },
  { key: 'video', label: '视频' },
  { key: 'audio', label: '音频' },
  { key: 'subtitle', label: '字幕' },
];

const getTypeColor = (type: string): string => {
  switch (type) {
    case 'image':
      return 'bg-blue-500/15 text-blue-400';
    case 'video':
      return 'bg-purple-50 text-purple-600';
    case 'audio':
      return 'bg-emerald-500/15 text-emerald-400';
    case 'subtitle':
      return 'bg-amber-500/15 text-amber-400';
    default:
      return 'bg-muted text-muted-foreground';
  }
};

/** 卡片缩略图：图片/视频必须真渲染 fileUrl，失败/无地址显示「未获取」 */
const AssetThumb = ({ asset }: { asset: Asset }) => {
  const [failed, setFailed] = useState(false);
  const url = assetsApi.mediaUrl(asset);
  if (asset.assetType === 'audio' || asset.assetType === 'subtitle') {
    const TypeIcon = getTypeIcon(asset.assetType);
    return <TypeIcon className="h-10 w-10 text-primary/40" />;
  }
  if (failed || !url) {
    return (
      <span className="text-xs font-medium text-muted-foreground">未获取</span>
    );
  }
  if (asset.assetType === 'image') {
    return (
      <img
        src={url}
        alt={asset.name}
        loading="lazy"
        className="h-full w-full object-cover"
        onError={() => setFailed(true)}
      />
    );
  }
  if (asset.assetType === 'video') {
    return (
      <video
        src={url}
        muted
        playsInline
        preload="metadata"
        className="h-full w-full object-cover"
        onError={() => setFailed(true)}
      />
    );
  }
  return <span className="text-xs font-medium text-muted-foreground">未获取</span>;
};

const AssetsPage = () => {
  const navigate = useNavigate();
  const [assetType, setAssetType] = useState<AssetTypeFilter>('all');
  const [keyword, setKeyword] = useState('');
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);
  const [showUpload, setShowUpload] = useState(false);
  const [loadError, setLoadError] = useState(false);
  // P1 资产隔离：项目归属（上传必填，列表可按项目过滤）
  const [projectList, setProjectList] = useState<ProjectListItem[]>([]);
  const [projectFilter, setProjectFilter] = useState('');
  const [uploadProjectId, setUploadProjectId] = useState('');
  // URL 模式上传表单（文件直传需对象存储，见路线图；先以 URL 登记真实可用）
  const [uploadName, setUploadName] = useState('');
  const [uploadUrl, setUploadUrl] = useState('');
  const [uploadType, setUploadType] = useState('image');
  const [uploading, setUploading] = useState(false);
  // 客户端排序（列表接口不支持 sort 参数）
  const [sortKey, setSortKey] = useState<SortKey>('newest');

  useEffect(() => {
    projectsApi
      .listProjects({ pageSize: 100 })
      .then((res) => {
        setProjectList(res.items);
        if (!uploadProjectId && res.items.length > 0) setUploadProjectId(res.items[0].id);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setLoading(true);
    assetsApi
      .listAssets({
        assetType: assetType === 'all' ? undefined : assetType,
        keyword: keyword.trim() || undefined,
        projectId: projectFilter || undefined,
        pageSize: 50,
      })
      .then((res) => {
        setAssets(res.items);
        setLoadError(false);
      })
      .catch((e) => {
        // P1 诚信修复：失败展示空状态+报错，不再用假资产冒充
        logger.error('load assets failed', String(e));
        setAssets([]);
        setLoadError(true);
      })
      .finally(() => setLoading(false));
  }, [assetType, keyword, projectFilter]);

  const handleDelete = async (id: string) => {
    if (!await showConfirm('确定删除此资产？')) return;
    try {
      await assetsApi.deleteAsset(id);
      setAssets((prev) => prev.filter((a) => a.id !== id));
      if (selectedAsset?.id === id) setSelectedAsset(null);
    } catch (e) {
      // P1 修复：删除失败不再本地移除（之前假删，刷新又回来）
      logger.error('delete asset failed', String(e));
      toast.error('删除失败，请重试');
    }
  };

  // 客户端排序（列表接口无 sort 参数）
  const sortedAssets = useMemo(() => {
    const list = [...assets];
    switch (sortKey) {
      case 'oldest':
        return list.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      case 'largest':
        return list.sort((a, b) => (b.fileSize || 0) - (a.fileSize || 0));
      case 'name':
        return list.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
      default:
        return list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }
  }, [assets, sortKey]);

  // 项目名映射：预览弹窗展示资产归属
  const projectNameById = useMemo(() => {
    const map: Record<string, string> = {};
    projectList.forEach((p) => {
      map[p.id] = p.title;
    });
    return map;
  }, [projectList]);

  const selectedIndex = selectedAsset
    ? sortedAssets.findIndex((a) => a.id === selectedAsset.id)
    : -1;
  const hasPrev = selectedIndex > 0;
  const hasNext = selectedIndex >= 0 && selectedIndex < sortedAssets.length - 1;
  const stepPreview = (dir: -1 | 1) => {
    if (selectedIndex < 0) return;
    const next = sortedAssets[selectedIndex + dir];
    if (next) setSelectedAsset(next);
  };

  const handleUrlUpload = async () => {
    if (!uploadName.trim() || !uploadUrl.trim() || uploading) return;
    if (!uploadProjectId) {
      toast.error('请选择归属项目');
      return;
    }
    setUploading(true);
    try {
      const created = await assetsApi.createAsset({
        name: uploadName.trim(),
        assetType: uploadType,
        fileUrl: uploadUrl.trim(),
        sourceType: 'uploaded',
        projectId: uploadProjectId,
      });
      setAssets((prev) => [created, ...prev]);
      setUploadName('');
      setUploadUrl('');
      setShowUpload(false);
      toast.success('资产已登记');
    } catch (e) {
      logger.error('upload asset failed', String(e));
      toast.error('登记失败，请检查地址后重试');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="资产库"
        description={`管理所有图片、视频、音频等素材资产 · 共 ${assets.length} 个`}
        actions={
          <button
            onClick={() => setShowUpload(true)}
            className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90"
          >
            <Upload className="h-4 w-4" />
            上传资产
          </button>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜索资产名称..."
            className="h-10 w-full rounded-xl border border-input bg-card pl-10 pr-4 text-sm outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {TYPE_FILTERS.map((filter) => (
            <button
              key={filter.key}
              onClick={() => setAssetType(filter.key)}
              className={`rounded-full px-4 py-2 text-sm font-medium transition-all ${
                assetType === filter.key
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'border border-input bg-card text-foreground hover:border-primary hover:text-primary'
              }`}
            >
              {filter.label}
            </button>
          ))}
          {/* P1 资产隔离：按项目过滤 */}
          {projectList.length > 0 && (
            <select
              value={projectFilter}
              onChange={(e) => setProjectFilter(e.target.value)}
              title="按项目过滤"
              className="h-9 rounded-full border border-input bg-card px-3 text-sm outline-none focus:border-primary"
            >
              <option value="">全部项目</option>
              {projectList.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
          )}
          <div className="flex items-center gap-1.5">
            <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground" />
            <select
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as SortKey)}
              className="h-9 rounded-full border border-input bg-card px-3 text-sm outline-none focus:border-primary"
            >
              {SORT_OPTIONS.map((opt) => (
                <option key={opt.key} value={opt.key}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          加载中...
        </div>
      ) : loadError ? (
        <div className="flex flex-col items-center justify-center rounded-xl border bg-card py-20 shadow-sm">
          <p className="text-sm font-medium text-foreground">资产加载失败</p>
          <p className="mt-1 text-sm text-muted-foreground">请确认后端服务正常后重试</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-4 rounded-xl bg-primary px-6 py-2 text-sm font-medium text-primary-foreground"
          >
            重新加载
          </button>
        </div>
      ) : assets.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed bg-card py-20 text-muted-foreground">
          <ImageIcon className="mb-3 h-10 w-10 opacity-40" />
          <p className="text-sm font-medium text-foreground">
            {keyword || assetType !== 'all' || projectFilter ? '没有匹配的资产' : '资产库还是空的'}
          </p>
          <p className="mt-1 text-xs">
            {keyword || assetType !== 'all' || projectFilter
              ? '换个筛选条件试试'
              : '生成任务产出的图片/视频/音频会自动归档到这里'}
          </p>
          <div className="mt-5 flex items-center gap-3">
            <button
              onClick={() => navigate('/create')}
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90"
            >
              <Sparkles className="h-4 w-4" />
              去创作产出资产
            </button>
            <button
              onClick={() => setShowUpload(true)}
              className="inline-flex items-center gap-2 rounded-xl border border-primary/40 bg-primary/5 px-5 py-2.5 text-sm font-medium text-primary hover:bg-primary/10"
            >
              <Upload className="h-4 w-4" />
              登记外部素材
            </button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          {sortedAssets.map((asset) => {
            const isMedia =
              asset.assetType === 'video' || asset.assetType === 'audio';

            return (
              <div
                key={asset.id}
                onClick={() => setSelectedAsset(asset)}
                // P1 性能：长列表渲染优化（百条以上卡顿缓解；完整虚拟滚动见路线图）
                style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 240px' }}
                className="group cursor-pointer overflow-hidden rounded-xl border bg-card shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md"
              >
                <div
                  className={`relative aspect-square bg-gradient-to-br ${getTypeGradient(
                    asset.assetType,
                  )} flex items-center justify-center overflow-hidden`}
                >
                  <AssetThumb asset={asset} />

                  <span
                    className={`absolute left-2 top-2 rounded-full px-2 py-0.5 text-xs font-medium ${getTypeColor(
                      asset.assetType,
                    )}`}
                  >
                    {TYPE_LABELS[asset.assetType] || asset.assetType}
                  </span>

                  {asset.durationSeconds && isMedia && (
                    <span className="absolute bottom-2 right-2 rounded-md bg-black/60 px-1.5 py-0.5 text-xs text-white">
                      {formatDuration(asset.durationSeconds)}
                    </span>
                  )}

                  <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedAsset(asset);
                      }}
                      className="flex h-9 w-9 items-center justify-center rounded-full bg-card text-foreground shadow-lg hover:scale-110"
                      title="预览"
                    >
                      <Eye className="h-4 w-4" />
                    </button>
                    {assetsApi.mediaUrl(asset) && (
                      <a
                        href={assetsApi.mediaUrl(asset)}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="flex h-9 w-9 items-center justify-center rounded-full bg-card text-foreground shadow-lg hover:scale-110"
                        title="下载 / 原图打开"
                      >
                        <Download className="h-4 w-4" />
                      </a>
                    )}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(asset.id);
                      }}
                      className="flex h-9 w-9 items-center justify-center rounded-full bg-card text-red-3000 shadow-lg hover:scale-110"
                      title="删除"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                <div className="p-3">
                  <h3 className="truncate text-xs font-medium text-foreground">
                    {asset.name}
                  </h3>
                  <div className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground">
                    <span>{formatFileSize(asset.fileSize)}</span>
                    <span>{getSourceLabel(asset.sourceType)}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {selectedAsset && (
        <AssetPreviewModal
          asset={selectedAsset}
          onClose={() => setSelectedAsset(null)}
          onDelete={handleDelete}
          projectName={
            selectedAsset.projectId
              ? projectNameById[selectedAsset.projectId]
              : undefined
          }
          hasPrev={hasPrev}
          hasNext={hasNext}
          onPrev={() => stepPreview(-1)}
          onNext={() => stepPreview(1)}
          position={
            selectedIndex >= 0
              ? { index: selectedIndex + 1, total: sortedAssets.length }
              : undefined
          }
        />
      )}

      {showUpload && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setShowUpload(false)}
        >
          <div
            className="w-full max-w-md overflow-hidden rounded-2xl bg-card shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b p-5">
              <h3 className="text-lg font-semibold text-foreground">
                上传资产
              </h3>
              <button
                onClick={() => setShowUpload(false)}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-5">
              {/* P1 修复：上传弹窗之前是摆设（点了只关窗）。文件直传需对象存储，
                  先以 URL 登记模式真实可用 */}
              <div className="space-y-3">
                <div>
                  <label className="text-sm font-medium">归属项目 *</label>
                  <select
                    value={uploadProjectId}
                    onChange={(e) => setUploadProjectId(e.target.value)}
                    className="mt-1.5 h-10 w-full rounded-xl border border-input bg-card px-3 text-sm outline-none focus:border-primary"
                  >
                    <option value="">请选择项目</option>
                    {projectList.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.title}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-sm font-medium">资产名称</label>
                  <input
                    value={uploadName}
                    onChange={(e) => setUploadName(e.target.value)}
                    placeholder="如：主角定妆照"
                    className="mt-1.5 h-10 w-full rounded-xl border border-input px-3 text-sm outline-none focus:border-primary"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">文件地址（URL）</label>
                  <input
                    value={uploadUrl}
                    onChange={(e) => setUploadUrl(e.target.value)}
                    placeholder="https://..."
                    className="mt-1.5 h-10 w-full rounded-xl border border-input px-3 text-sm outline-none focus:border-primary"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">类型</label>
                  <select
                    value={uploadType}
                    onChange={(e) => setUploadType(e.target.value)}
                    className="mt-1.5 h-10 w-full rounded-xl border border-input bg-card px-3 text-sm outline-none focus:border-primary"
                  >
                    <option value="image">图片</option>
                    <option value="video">视频</option>
                    <option value="audio">音频</option>
                    <option value="subtitle">字幕</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 border-t p-4">
              <button
                onClick={() => setShowUpload(false)}
                className="rounded-xl border border-input px-4 py-2 text-sm font-medium text-foreground hover:bg-muted/50"
              >
                取消
              </button>
              <button
                onClick={handleUrlUpload}
                disabled={uploading || !uploadName.trim() || !uploadUrl.trim()}
                className="rounded-xl bg-primary px-5 py-2 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90 disabled:opacity-50"
              >
                {uploading ? '登记中...' : '确认登记'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AssetsPage;
