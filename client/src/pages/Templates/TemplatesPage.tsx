import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Search, Sparkles, Filter, Plus, Pencil, Trash2 } from 'lucide-react';
import { templates as templatesApi } from '@client/src/api';
import type { Template, TemplateType } from '@shared/api.interface';
import { logger } from '@client/src/utils/logger';
import { toast } from 'sonner';
import { showConfirm } from '@client/src/components/ui/confirm';
import PageHeader from '@client/src/components/PageHeader';
import { templateCover } from '@client/src/data/styleCovers';
import TemplateDetailModal, {
  getGradient,
  getTypeLabel,
  getTypeColor,
  formatDuration,
} from './TemplateDetailModal';

type TabKey = 'all' | TemplateType;

const TABS: { key: TabKey; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'duration', label: '时长模板' },
  { key: 'genre', label: '题材模板' },
  { key: 'style', label: '形态模板' },
];

const STYLE_OPTIONS = [
  { value: '', label: '全部风格' },
  { value: 'realistic', label: '写实' },
  { value: 'live_action', label: '真人实景' },
  { value: 'anime_2d', label: '日漫' },
  { value: 'chinese_comic', label: '国漫' },
  { value: 'xianxia', label: '仙侠' },
  { value: 'cg_cyberpunk', label: '赛博朋克' },
  { value: 'guofeng_3d', label: '国风3D' },
];

const DURATION_OPTIONS = [
  { value: '', label: '全部时长' },
  { value: '30', label: '30秒以内' },
  { value: '60', label: '60秒' },
  { value: '90', label: '90秒' },
  { value: '120', label: '2分钟以上' },
];

/**
 * 内置模板封面：按模板名匹配原创风格图（见 data/styleCovers）。
 * 模板 id 是运行时 uuid，自定义模板按名称 hash 复用同一套封面。
 */
const tplCoverUrl = templateCover;

const TemplatesPage = () => {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<TabKey>('all');
  const [keyword, setKeyword] = useState('');
  const [styleFilter, setStyleFilter] = useState('');
  const [durationFilter, setDurationFilter] = useState('');
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(
    null,
  );
  // P1 深链：?template=<id> 自动打开详情（Dashboard 热门模板入口）
  const [searchParams, setSearchParams] = useSearchParams();
  const deepTemplateId = searchParams.get('template');

  useEffect(() => {
    setLoading(true);
    templatesApi
      .listTemplates({
        templateType: activeTab === 'all' ? undefined : activeTab,
        keyword: keyword || undefined,
        pageSize: 50,
      })
      .then((res) => {
        // P1 修复：后端暂不支持风格/时长过滤，在客户端对真实结果过滤；
        // 之前该逻辑藏在 mock 兜底里，真后端下筛选 silently 失效
        let items = res.items;
        if (styleFilter) items = items.filter((t) => t.artStyle === styleFilter);
        if (durationFilter) {
          const target = Number(durationFilter);
          items = items.filter((t) => {
            if (target === 30) return t.durationSeconds <= 30;
            if (target === 120) return t.durationSeconds >= 120;
            return Math.abs(t.durationSeconds - target) < 15;
          });
        }
        setTemplates(items);
        setLoadError(false);
        // 深链打开详情
        if (deepTemplateId) {
          const found = res.items.find((t) => t.id === deepTemplateId);
          if (found) setSelectedTemplate(found);
          else {
            templatesApi
              .getTemplate(deepTemplateId)
              .then((t) => setSelectedTemplate(t))
              .catch(() => toast.error('模板不存在或已删除'));
          }
        }
      })
      .catch((e) => {
        // P1 诚信修复：失败展示空列表+报错，不再用 8 条假模板冒充
        logger.error('load templates failed', String(e));
        setTemplates([]);
        setLoadError(true);
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, keyword, styleFilter, durationFilter]);

  const handleUseTemplate = (tpl: Template) => {
    // W5 打点：使用次数供热门排序
    templatesApi.trackUse(tpl.id).catch(() => {});
    navigate(`/create?templateId=${tpl.id}`);
  };

  // P1 模板管理（增删改）
  const [showForm, setShowForm] = useState(false);
  const [editingTpl, setEditingTpl] = useState<Template | null>(null);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    templateType: 'full' as TemplateType,
    durationSeconds: 60,
    aspectRatio: '9:16',
  });

  const reloadTemplates = () => {
    setLoading(true);
    templatesApi
      .listTemplates({ pageSize: 50 })
      .then((res) => {
        setTemplates(res.items);
        setLoadError(false);
      })
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  };

  const handleSaveTemplate = async () => {
    if (!formData.name.trim() || saving) return;
    setSaving(true);
    try {
      if (editingTpl) {
        await templatesApi.updateTemplate(editingTpl.id, {
          name: formData.name.trim(),
          templateType: formData.templateType,
          durationSeconds: Number(formData.durationSeconds) || 60,
          aspectRatio: formData.aspectRatio as Template['aspectRatio'],
        });
        toast.success('模板已更新');
      } else {
        await templatesApi.createTemplate({
          name: formData.name.trim(),
          templateType: formData.templateType,
          durationSeconds: Number(formData.durationSeconds) || 60,
          aspectRatio: formData.aspectRatio as Template['aspectRatio'],
        });
        toast.success('模板已创建');
      }
      setShowForm(false);
      setEditingTpl(null);
      reloadTemplates();
    } catch {
      toast.error('保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteTemplate = async (tpl: Template) => {
    if (!await showConfirm(`确定删除模板「${tpl.name}」吗？`)) return;
    try {
      await templatesApi.deleteTemplate(tpl.id);
      setTemplates((prev) => prev.filter((t) => t.id !== tpl.id));
      toast.success('已删除');
    } catch {
      toast.error('删除失败');
    }
  };

  const templateCount = useMemo(() => templates.length, [templates]);

  return (
    /* @container：窄坞（极客模式右栏）内自动降列，避免 3:4 封面卡片挤压成竖排文字 */
    <div className="@container space-y-6">
      <PageHeader
        title="模板中心"
        description={`精选模板，一键套用快速创作 · 共 ${templateCount} 个模板`}
        actions={
          /* P1 修复：模板增删改之前只能调 curl；现补管理入口 */
          <button
            onClick={() => {
              setEditingTpl(null);
              setFormData({ name: '', templateType: 'full', durationSeconds: 60, aspectRatio: '9:16' });
              setShowForm(true);
            }}
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" />
            新建模板
          </button>
        }
      />

      <div className="flex flex-wrap gap-2">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`rounded-full px-5 py-2 text-sm font-medium transition-all ${
              activeTab === tab.key
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'border border-input bg-card text-foreground hover:border-primary hover:text-primary'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜索模板名称..."
            className="h-10 w-full rounded-xl border border-input bg-card pl-10 pr-4 text-sm outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
        </div>
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <select
            value={styleFilter}
            onChange={(e) => setStyleFilter(e.target.value)}
            className="h-10 rounded-xl border border-input bg-card px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
          >
            {STYLE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <select
            value={durationFilter}
            onChange={(e) => setDurationFilter(e.target.value)}
            className="h-10 rounded-xl border border-input bg-card px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
          >
            {DURATION_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          加载中...
        </div>
      ) : loadError ? (
        <div className="flex flex-col items-center justify-center rounded-xl border bg-card py-20 shadow-sm">
          <p className="text-sm font-medium text-foreground">模板加载失败</p>
          <p className="mt-1 text-sm text-muted-foreground">请确认后端服务正常后重试</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-4 rounded-xl bg-primary px-6 py-2 text-sm font-medium text-primary-foreground"
          >
            重新加载
          </button>
        </div>
      ) : templates.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          <Sparkles className="mb-3 h-10 w-10 opacity-50" />
          <p>暂无匹配的模板</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 @sm:grid-cols-2 @4xl:grid-cols-3 @5xl:grid-cols-4">
          {templates.map((tpl) => (
            <div
              key={tpl.id}
              onClick={() => setSelectedTemplate(tpl)}
              className="group relative cursor-pointer overflow-hidden rounded-xl border bg-card shadow-sm transition-all hover:-translate-y-1 hover:shadow-lg"
            >
              <div
                className={`relative aspect-[3/4] overflow-hidden bg-gradient-to-br ${getGradient(
                  tpl.artStyle,
                )} flex items-center justify-center`}
              >
                {/* 无封面时用静态生成的 SVG 封面；SVG 缺失再回退渐变占位 */}
                {tpl.thumbnailUrl ? (
                  <img src={tpl.thumbnailUrl} alt={tpl.name} className="absolute inset-0 h-full w-full object-cover" />
                ) : (
                  <img
                    src={tplCoverUrl(tpl.name)}
                    alt={tpl.name}
                    loading="lazy"
                    className="absolute inset-0 h-full w-full object-cover"
                    onError={(e) => {
                      e.currentTarget.style.display = 'none';
                    }}
                  />
                )}
                <span
                  className={`absolute left-3 top-3 rounded-full bg-card/85 px-2.5 py-1 text-xs font-medium backdrop-blur ${getTypeColor(
                    tpl.templateType,
                  )}`}
                >
                  {getTypeLabel(tpl.templateType)}
                </span>
                <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleUseTemplate(tpl);
                    }}
                    className="rounded-full bg-card px-6 py-2.5 text-sm font-semibold text-foreground shadow-lg transition-transform hover:scale-105"
                  >
                    使用模板
                  </button>
                </div>
              </div>
              <div className="p-4">
                <h3 className="truncate text-sm font-semibold text-foreground">
                  {tpl.name}
                </h3>
                {tpl.description && (
                  <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">
                    {tpl.description}
                  </p>
                )}
                <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                  <span className="flex shrink-0 items-center gap-1 whitespace-nowrap">
                    ⏱ {formatDuration(tpl.durationSeconds)}
                  </span>
                  {/* W5 市场：使用次数展示；0 次不展示，避免冷启动难看 */}
                  {(tpl.useCount ?? 0) > 0 && (
                    <span className="whitespace-nowrap rounded bg-primary/10 px-1.5 py-0.5 font-medium text-primary">
                      {tpl.useCount} 人用过
                    </span>
                  )}
                  <span className="whitespace-nowrap">{tpl.aspectRatio}</span>
                </div>
                {/* 管理动作收纳为 hover 小图标，浏览态不打扰 */}
                <div className="absolute right-2 top-2 z-10 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingTpl(tpl);
                      setFormData({
                        name: tpl.name,
                        templateType: tpl.templateType,
                        durationSeconds: tpl.durationSeconds,
                        aspectRatio: tpl.aspectRatio,
                      });
                      setShowForm(true);
                    }}
                    className="rounded-lg bg-card/90 p-1.5 text-foreground/70 shadow-sm backdrop-blur hover:text-primary"
                    aria-label="编辑模板"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteTemplate(tpl);
                    }}
                    className="rounded-lg bg-card/90 p-1.5 text-foreground/70 shadow-sm backdrop-blur hover:text-red-300"
                    aria-label="删除模板"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setShowForm(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl bg-card p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold">
              {editingTpl ? '编辑模板' : '新建模板'}
            </h3>
            <div className="mt-4 space-y-3">
              <div>
                <label className="text-sm font-medium">名称</label>
                <input
                  value={formData.name}
                  onChange={(e) => setFormData((p) => ({ ...p, name: e.target.value }))}
                  placeholder="如：都市悬疑 90 秒"
                  className="mt-1.5 h-10 w-full rounded-xl border border-input px-3 text-sm outline-none focus:border-primary"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm font-medium">类型</label>
                  <select
                    value={formData.templateType}
                    onChange={(e) => setFormData((p) => ({ ...p, templateType: e.target.value as TemplateType }))}
                    className="mt-1.5 h-10 w-full rounded-xl border border-input bg-card px-3 text-sm outline-none focus:border-primary"
                  >
                    <option value="full">完整</option>
                    <option value="duration">时长</option>
                    <option value="genre">题材</option>
                    <option value="style">风格</option>
                  </select>
                </div>
                <div>
                  <label className="text-sm font-medium">时长（秒）</label>
                  <input
                    type="number"
                    value={formData.durationSeconds}
                    onChange={(e) => setFormData((p) => ({ ...p, durationSeconds: Number(e.target.value) }))}
                    className="mt-1.5 h-10 w-full rounded-xl border border-input px-3 text-sm outline-none focus:border-primary"
                  />
                </div>
              </div>
              <div>
                <label className="text-sm font-medium">画幅</label>
                <select
                  value={formData.aspectRatio}
                  onChange={(e) => setFormData((p) => ({ ...p, aspectRatio: e.target.value }))}
                  className="mt-1.5 h-10 w-full rounded-xl border border-input bg-card px-3 text-sm outline-none focus:border-primary"
                >
                  <option value="9:16">9:16 竖屏</option>
                  <option value="16:9">16:9 横屏</option>
                  <option value="1:1">1:1 方形</option>
                </select>
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setShowForm(false)}
                className="rounded-xl border border-input px-4 py-2 text-sm font-medium hover:bg-muted/50"
              >
                取消
              </button>
              <button
                onClick={handleSaveTemplate}
                disabled={saving || !formData.name.trim()}
                className="rounded-xl bg-primary px-5 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
              >
                {saving ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedTemplate && (
        <TemplateDetailModal
          template={selectedTemplate}
          onClose={() => {
            setSelectedTemplate(null);
            // 清除深链参数，避免刷新重复弹
            if (deepTemplateId) {
              const next = new URLSearchParams(searchParams);
              next.delete('template');
              setSearchParams(next, { replace: true });
            }
          }}
          onUse={handleUseTemplate}
        />
      )}
    </div>
  );
};

export default TemplatesPage;
