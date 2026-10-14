import { useEffect, useState } from 'react';
import {
  Cpu,
  SlidersHorizontal,
  Wallet,
  User,
  Plus,
  Pencil,
  Trash2,
  Star,
  Activity,
  X,
  Eye,
  EyeOff,
  AlertCircle,
  Check,
  Database,
  RefreshCw,
  Type,
  Image as ImageIcon,
  Video,
  Mic,
  Search,
  ChevronDown,
} from 'lucide-react';
import { providers as providersApi } from '@client/src/api';
import type {
  ModelProvider,
  CreateProviderRequest,
  ProviderType,
  FormatType,
  ModelCapabilities,
  ProviderApiKeyItem,
  ProviderTestResult,
  ProviderModelItem,
  ProviderFetchModelsResult,
} from '@shared/api.interface';
import { classifyModelId, MODEL_FIELD_GUIDE, MODEL_KIND_LABELS, type ModelKind } from '@shared/model-classify';
import { FREE_AGNES_MODELS, isFreeAgnesModel } from '@shared/agnes';
import { toast } from 'sonner';
import { showConfirm } from '@client/src/components/ui/confirm';

const PROVIDER_TYPE_LABELS: Record<ProviderType, string> = {
  volcengine_ark: '火山引擎方舟',
  openai_proxy: 'OpenAI 兼容中转站',
  custom: '自定义',
  official: '官方直供 ★',
};

const PROVIDER_TYPE_COLORS: Record<ProviderType, string> = {
  volcengine_ark: 'bg-blue-50 text-blue-600',
  openai_proxy: 'bg-purple-50 text-purple-600',
  custom: 'bg-gray-50 text-gray-600',
  official: 'bg-amber-50 text-amber-700',
};

const CAPABILITY_LABELS: { key: keyof ModelCapabilities; label: string; hint?: string }[] = [
  { key: 'text', label: '文本' },
  { key: 'image', label: '图片' },
  { key: 'video', label: '视频' },
  { key: 'tts', label: '配音' },
  { key: 'videoReference', label: '参考视频直喂(R2V)', hint: '开启后视频任务把镜头白模（公网URL）透传给模型；Key到位后按官方文档核对字段' },
];

interface ProviderFormData extends CreateProviderRequest {
  apiKey?: string;
}

const emptyForm: ProviderFormData = {
  name: '',
  providerType: 'volcengine_ark',
  baseUrl: '',
  apiKey: '',
  textModel: '',
  imageModel: '',
  videoModel: '',
  ttsModel: '',
  ttsVoice: '',
  promptPrefix: '',
  modelParams: undefined,
  formatType: 'volcengine_ark',
  capabilities: { text: true, image: false, video: false, tts: false },
  isDefault: false,
};

interface ProviderSectionProps {
  providers: ModelProvider[];
  loading: boolean;
  onRefresh: () => void;
}

/** 多 Key 管理（Key 本体只写不显；轮换：先加新 Key → 验证 → 激活 → 删旧 Key） */
const ProviderKeysManager = ({ providerId }: { providerId: string }) => {
  const [keys, setKeys] = useState<ProviderApiKeyItem[]>([]);
  const [loadingKeys, setLoadingKeys] = useState(true);
  const [label, setLabel] = useState('');
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);

  const reload = () => {
    setLoadingKeys(true);
    providersApi
      .listApiKeys(providerId)
      .then((list) => setKeys(list))
      .catch(() => toast.error('Key 列表加载失败'))
      .finally(() => setLoadingKeys(false));
  };

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providerId]);

  const handleAdd = async () => {
    if (!value.trim() || busy) return;
    setBusy(true);
    try {
      const item = await providersApi.addApiKey(providerId, {
        label: label.trim() || undefined,
        apiKey: value.trim(),
      });
      setKeys((prev) => [item, ...prev.filter((k) => k.id !== item.id)]);
      setLabel('');
      setValue('');
      toast.success(item.isActive ? '已添加并激活（当前无生效 Key）' : '已添加，去激活后生效');
    } catch {
      toast.error('添加失败');
    } finally {
      setBusy(false);
    }
  };

  const handleActivate = async (keyId: string) => {
    try {
      const list = await providersApi.activateApiKey(providerId, keyId);
      setKeys(list);
      toast.success('已切换生效 Key');
    } catch {
      toast.error('切换失败');
    }
  };

  const handleRemove = async (key: ProviderApiKeyItem) => {
    if (!await showConfirm(`确定删除 Key「${key.label}(${key.maskedKey})」吗？`)) return;
    try {
      await providersApi.removeApiKey(providerId, key.id);
      setKeys((prev) => prev.filter((k) => k.id !== key.id));
      toast.success('已删除');
    } catch {
      toast.error('删除失败');
    }
  };

  return (
    <div className="mt-3 rounded-lg bg-muted/40 p-3">
      <div className="text-xs font-medium text-foreground">API Key 管理（多 Key 轮换）</div>
      {loadingKeys ? (
        <p className="mt-2 text-xs text-muted-foreground">加载中...</p>
      ) : keys.length === 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">
          暂无附加 Key（使用主 Key 行）。建议生产 Key 与测试 Key 分开存放。
        </p>
      ) : (
        <div className="mt-2 space-y-1.5">
          {keys.map((k) => (
            <div
              key={k.id}
              className="flex items-center gap-2 rounded-lg border border-border bg-white px-2.5 py-1.5 text-xs"
            >
              <span className="font-medium text-foreground">{k.label}</span>
              <code className="text-muted-foreground">{k.maskedKey}</code>
              {k.isActive ? (
                <span className="rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-600">
                  生效中
                </span>
              ) : (
                <button
                  onClick={() => handleActivate(k.id)}
                  className="rounded-full bg-primary/10 px-2 py-0.5 font-medium text-primary hover:bg-primary/20"
                >
                  设为生效
                </button>
              )}
              <button
                onClick={() => handleRemove(k)}
                className="ml-auto text-muted-foreground hover:text-red-500"
              >
                删除
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="mt-2 flex gap-2">
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="备注（如 生产Key）"
          className="h-9 w-32 rounded-lg border border-input bg-white px-2.5 text-xs outline-none focus:border-primary"
        />
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="粘贴新 Key（只写不显）"
          type="password"
          className="h-9 flex-1 rounded-lg border border-input bg-white px-2.5 text-xs outline-none focus:border-primary"
        />
        <button
          onClick={handleAdd}
          disabled={busy || !value.trim()}
          className="h-9 shrink-0 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground disabled:opacity-50"
        >
          添加
        </button>
      </div>
    </div>
  );
};

const ProviderSection = ({ providers, loading, onRefresh }: ProviderSectionProps) => {
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<ProviderFormData>(emptyForm);
  const [showApiKey, setShowApiKey] = useState(false);
  const [testResult, setTestResult] = useState<ProviderTestResult | null>(null);
  const [probeMsg, setProbeMsg] = useState<string | null>(null);
  const [probing, setProbing] = useState<string | null>(null);

  /** B3 按能力探活：各一次最小真实调用（视频太贵不探，用成片任务验证） */
  const handleProbe = async (capability: 'text' | 'image' | 'tts') => {
    if (!editingId) {
      setProbeMsg('探活仅对已保存的供应商可用（先保存）');
      return;
    }
    setProbing(capability);
    try {
      const res = await providersApi.probeProvider(editingId, capability);
      setProbeMsg(
        res.ok
          ? `探活成功${res.latencyMs !== undefined ? `（${res.latencyMs}ms）` : ''}${res.reply ? `：${res.reply}` : ''}${res.url ? `：${res.url.slice(0, 60)}` : ''}`
          : `探活失败：${res.message}`,
      );
    } catch (e) {
      setProbeMsg(`探活失败：${(e as Error)?.message ?? '未知错误'}`);
    } finally {
      setProbing(null);
    }
  };
  const [testing, setTesting] = useState(false);
  // 三档测试（对标 ArcReel）：offline 零成本格式校验 / preview 零成本请求预览 / live 真实请求
  const [testMode, setTestMode] = useState<'offline' | 'preview' | 'live'>('live');
  const [saving, setSaving] = useState(false);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [fetchedModels, setFetchedModels] = useState<ProviderModelItem[]>([]);
  // 手填逃生舱：下拉里没有时切手填（中转站无 /models 等场景）
  const [customFields, setCustomFields] = useState<Set<string>>(new Set());
  // 模型列表拉取状态（失败原因直接展示，不再静默）
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [modelsResult, setModelsResult] = useState<ProviderFetchModelsResult | null>(null);
  const [modelsFilter, setModelsFilter] = useState('');
  const [keysOpenId, setKeysOpenId] = useState<string | null>(null);
  // P0 修复：删除 localProviders 镜像 state，直接使用 providers prop；
  // 之前渲染期 setState 有无限重渲染风险，且失败时伪造本地数据导致 UI 与后端永久不一致

  const openCreateModal = () => {
    setFormData(emptyForm);
    setEditingId(null);
    setTestResult(null);
    setProbeMsg(null);
    setShowApiKey(false);
    setFetchedModels([]);
    setCustomFields(new Set());
    setModelsError(null);
    setModelsResult(null);
    setModelsFilter('');
    setShowModal(true);
  };

  const openEditModal = (provider: ModelProvider) => {
    setFormData({
      name: provider.name,
      providerType: provider.providerType,
      baseUrl: provider.baseUrl,
      textModel: provider.textModel,
      imageModel: provider.imageModel,
      videoModel: provider.videoModel,
      ttsModel: provider.ttsModel,
      ttsVoice: provider.ttsVoice,
      promptPrefix: provider.promptPrefix ?? '',
      modelParams: provider.modelParams,
      formatType: provider.formatType,
      capabilities: { ...provider.capabilities },
      isDefault: provider.isDefault,
    });
    setEditingId(provider.id);
    setTestResult(null);
    setShowApiKey(false);
    setFetchedModels([]);
    setCustomFields(new Set());
    setModelsError(null);
    setShowModal(true);
    // 编辑态自动拉该供应商的模型列表（用已保存的生效 Key），下拉直选
    if (provider.baseUrl) {
      setFetchingModels(true);
      providersApi
        .fetchProviderModels({ baseUrl: provider.baseUrl, providerId: provider.id })
        .then((res) => {
          if (res.success && res.models) {
            setFetchedModels(res.models);
            setModelsError(null);
          } else {
            setModelsError(res.message ?? '模型列表获取失败，可手动填写');
          }
        })
        .catch((e) => setModelsError(`模型列表获取失败：${(e as Error)?.message ?? '网络错误'}，可手动填写`))
        .finally(() => setFetchingModels(false));
    }
    setModelsResult(null);
    setModelsFilter('');
    setShowModal(true);
  };

  const handleTestConnection = async () => {
    setTesting(true);
    setTestResult(null);
    setProbeMsg(null);
    try {
      // 编辑已有 provider 且未改 key 时用已保存的测试；否则用表单参数直接测
      if (editingId && !formData.apiKey) {
        const res = await providersApi.testProvider(editingId);
        setTestResult(res);
      } else {
        const res = await providersApi.testProviderConnection({
          baseUrl: formData.baseUrl,
          apiKey: formData.apiKey,
          formatType: formData.formatType,
          mode: testMode,
          // 编辑态且表单 Key 为空时，后端用已保存的生效 Key（多 Key 行优先）
          providerId: editingId ?? undefined,
          // /models 404 时用文本模型做最小调用验证（约 1 token）
          model: formData.textModel || undefined,
        });
        setTestResult(res);
      }
    } catch (e: any) {
      setTestResult({
        success: false,
        message: `连接失败：${e?.response?.data?.message || e?.message || '请检查配置'}`,
      });
    } finally {
      setTesting(false);
    }
  };

  const handleFetchModels = async () => {
    setFetchingModels(true);
    setModelsResult(null);
    setFetchedModels([]);
    try {
      const res = await providersApi.fetchProviderModels({
        baseUrl: formData.baseUrl,
        apiKey: formData.apiKey,
        formatType: formData.formatType,
        providerId: editingId ?? undefined,
      });
      setModelsResult(res);
      if (res.success && res.models) {
        setFetchedModels(res.models);
        setModelsError(null);
      } else {
        setModelsError(res.message ?? '模型列表获取失败，可手动填写');
      }
    } catch (e: any) {
      setModelsResult({
        success: false,
        message: `获取失败：${e?.response?.data?.message || e?.message || '请检查配置'}`,
      });
    } finally {
      setFetchingModels(false);
    }
  };

  const fillModel = (field: 'textModel' | 'imageModel' | 'videoModel' | 'ttsModel', modelId: string) => {
    setFormData((p) => ({ ...p, [field]: modelId }));
  };

  /**
   * 一键自动归类：按模型名规律把拉到的模型填进对应空字段。
   * 只填空字段（已有值不动，手动优先）；unknown 类跳过并告知。
   */
  const [autoAssignMsg, setAutoAssignMsg] = useState<string | null>(null);
  const autoAssignModels = () => {
    const fieldOf: Record<string, 'textModel' | 'imageModel' | 'videoModel' | 'ttsModel'> = {
      text: 'textModel',
      image: 'imageModel',
      video: 'videoModel',
      tts: 'ttsModel',
    };
    const filled: string[] = [];
    const skippedUnknown: string[] = [];
    setFormData((prev) => {
      const next = { ...prev };
      for (const m of fetchedModels) {
        const kind = classifyModelId(m.id);
        const field = fieldOf[kind];
        if (!field) {
          if (!skippedUnknown.includes(m.id)) skippedUnknown.push(m.id);
          continue;
        }
        if (!next[field]) {
          next[field] = m.id;
          filled.push(`${MODEL_KIND_LABELS[kind as ModelKind]}←${m.id.slice(0, 24)}`);
        }
      }
      return next;
    });
    const parts: string[] = [];
    if (filled.length > 0) parts.push(`已填 ${filled.length} 项：${filled.join('、')}`);
    else parts.push('四个字段都已有值，未覆盖（如需重填请先清空）');
    if (skippedUnknown.length > 0) parts.push(`${skippedUnknown.length} 个未知类型已跳过（${skippedUnknown.slice(0, 3).join('、')}${skippedUnknown.length > 3 ? '…' : ''}），请手动指定`);
    setAutoAssignMsg(parts.join('；'));
  };

  const handleSave = async () => {
    if (!formData.name || !formData.baseUrl) return;
    setSaving(true);
    try {
      if (editingId) {
        await providersApi.updateProvider(editingId, formData);
        toast.success('已保存');
      } else {
        await providersApi.createProvider(formData);
        toast.success('已添加');
      }
      setShowModal(false);
      onRefresh();
    } catch (e: any) {
      // P0 修复：失败只报错、不落本地、不关弹窗；之前伪造 prov-Date.now() 数据导致 UI 与后端永久不一致
      toast.error(`保存失败：${e?.response?.data?.error?.message || e?.message || '请检查网络与配置'}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!await showConfirm('确定要删除这个 Provider 吗？')) return;
    try {
      await providersApi.deleteProvider(id);
      toast.success('已删除');
      onRefresh();
    } catch (e: any) {
      toast.error(`删除失败：${e?.response?.data?.error?.message || e?.message || '请稍后重试'}`);
    }
  };

  const handleSetDefault = async (id: string) => {
    try {
      await providersApi.setDefaultProvider(id);
      onRefresh();
    } catch (e: any) {
      toast.error(`设置默认失败：${e?.response?.data?.error?.message || e?.message || '请稍后重试'}`);
    }
  };

  const handleToggleEnabled = async (id: string, enabled: boolean) => {
    try {
      await providersApi.updateProvider(id, { enabled });
      onRefresh();
    } catch (e: any) {
      toast.error(`操作失败：${e?.response?.data?.error?.message || e?.message || '请稍后重试'}`);
    }
  };

  const toggleCapability = (key: keyof ModelCapabilities) => {
    setFormData((prev) => ({
      ...prev,
      capabilities: { ...prev.capabilities!, [key]: !prev.capabilities![key] },
    }));
  };

  const displayProviders = providers;

  return (
    <>
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">
            模型服务管理
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            配置你的 AI 模型服务，支持火山方舟、OpenAI 兼容中转站、自定义 API
          </p>
        </div>
        <button
          onClick={openCreateModal}
          className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" />
          添加模型服务
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          加载中...
        </div>
      ) : (
        <div className="space-y-3">
          {displayProviders.map((provider) => (
            <div
              key={provider.id}
              className="rounded-xl border bg-white p-5 shadow-sm transition-shadow hover:shadow-md"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-4">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10">
                    <Cpu className="h-6 w-6 text-primary" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-base font-semibold text-foreground">
                        {provider.name}
                      </h3>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          PROVIDER_TYPE_COLORS[provider.providerType]
                        }`}
                      >
                        {PROVIDER_TYPE_LABELS[provider.providerType]}
                      </span>
                      {provider.isDefault && (
                        <span className="flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-600">
                          <Star className="h-3 w-3 fill-current" />
                          默认
                        </span>
                      )}
                      {!provider.enabled && (
                        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
                          已禁用
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {provider.baseUrl}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {CAPABILITY_LABELS.map((cap) => (
                        <span
                          key={cap.key}
                          className={`rounded-md px-2 py-0.5 text-xs ${
                            provider.capabilities[cap.key]
                              ? 'bg-emerald-50 text-emerald-600'
                              : 'bg-gray-100 text-gray-400'
                          }`}
                        >
                          {cap.label}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
                <button
                  onClick={() =>
                    handleToggleEnabled(provider.id, !provider.enabled)
                  }
                  className={`relative h-6 w-11 rounded-full transition-colors ${
                    provider.enabled ? 'bg-primary' : 'bg-gray-200'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${
                      provider.enabled ? 'translate-x-5' : 'translate-x-0.5'
                    }`}
                  />
                </button>
              </div>
              {keysOpenId === provider.id && (
                <ProviderKeysManager providerId={provider.id} />
              )}
              <div className="mt-4 flex items-center justify-between border-t pt-3">
                <div className="flex gap-3">
                  <button
                    onClick={() =>
                      setKeysOpenId((cur) => (cur === provider.id ? null : provider.id))
                    }
                    className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary"
                  >
                    <Database className="h-3.5 w-3.5" />
                    {keysOpenId === provider.id ? '收起 Key' : '管理 Key'}
                    {typeof provider.activeKeyCount === 'number' && provider.activeKeyCount > 0 && (
                      <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px]">
                        {provider.activeKeyCount} 生效
                      </span>
                    )}
                  </button>
                  <button
                    onClick={() => handleSetDefault(provider.id)}
                    disabled={provider.isDefault}
                    className={`flex items-center gap-1.5 text-xs ${
                      provider.isDefault
                        ? 'text-gray-400'
                        : 'text-muted-foreground hover:text-primary'
                    }`}
                  >
                    <Star className="h-3.5 w-3.5" />
                    设为默认
                  </button>
                  <button
                    onClick={() => {
                      providersApi.testProvider(provider.id).catch(() => {});
                      toast('测试请求已发送');
                    }}
                    className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary"
                  >
                    <Activity className="h-3.5 w-3.5" />
                    测试连接
                  </button>
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={() => openEditModal(provider)}
                    className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    编辑
                  </button>
                  <button
                    onClick={() => handleDelete(provider.id)}
                    className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-red-500"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    删除
                  </button>
                </div>
              </div>
            </div>
          ))}
          {displayProviders.length === 0 && (
            <div className="flex flex-col items-center justify-center rounded-xl border bg-white py-16 text-muted-foreground">
              <Cpu className="mb-3 h-10 w-10 opacity-50" />
              <p>暂无模型服务，点击上方按钮添加</p>
            </div>
          )}
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setShowModal(false)}
        >
          <div
            className="max-h-[90vh] w-full max-w-2xl overflow-hidden rounded-2xl bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between bg-gradient-to-r from-primary/10 via-primary/5 to-transparent p-5">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-lg font-bold text-primary-foreground shadow-sm">
                  {formData.name ? formData.name.charAt(0) : <Cpu className="h-5 w-5" />}
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-foreground">
                    {editingId ? '编辑模型服务' : '添加模型服务'}
                  </h2>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {formData.formatType === 'mock' ? '本地 Mock 通道（免 Key 调试）' : formData.formatType === 'volcengine_ark' ? '火山方舟格式' : formData.formatType === 'agnes' ? 'Agnes 专用（测试版）' : 'OpenAI 兼容格式'} · 配好 Key 后可一键拉模型
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowModal(false)}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-white/70"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="max-h-[62vh] space-y-5 overflow-y-auto p-5">
              <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">连接信息</div>
              <div>
                <label className="text-sm font-medium text-foreground">
                  服务名称 <span className="text-primary">*</span>
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) =>
                    setFormData((p) => ({ ...p, name: e.target.value }))
                  }
                  placeholder="如：火山方舟主账号"
                  className="mt-2 h-10 w-full rounded-xl border border-input bg-white px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                />
              </div>

              <div>
                <label className="text-sm font-medium text-foreground">
                  服务类型
                </label>
                <select
                  value={formData.providerType}
                  onChange={(e) =>
                    setFormData((p) => ({
                      ...p,
                      providerType: e.target.value as ProviderType,
                      formatType:
                        e.target.value === 'volcengine_ark'
                          ? 'volcengine_ark'
                          : 'openai',
                    }))
                  }
                  className="mt-2 h-10 w-full rounded-xl border border-input bg-white px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                >
                  <option value="volcengine_ark">火山引擎方舟</option>
                  <option value="openai_proxy">OpenAI 兼容中转站</option>
                  <option value="custom">自定义</option>
                </select>
              </div>

              <div>
                <label className="text-sm font-medium text-foreground">
                  Base URL <span className="text-primary">*</span>
                </label>
                <input
                  type="text"
                  value={formData.baseUrl || ''}
                  onChange={(e) =>
                    setFormData((p) => ({ ...p, baseUrl: e.target.value }))
                  }
                  placeholder="https://ark.cn-beijing.volces.com/api/v3"
                  className="mt-2 h-10 w-full rounded-xl border border-input bg-white px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                />
              </div>

              <div>
                <label className="text-sm font-medium text-foreground">
                  API Key <span className="text-primary">*</span>
                </label>
                <div className="relative mt-2">
                  <input
                    type={showApiKey ? 'text' : 'password'}
                    value={formData.apiKey || ''}
                    onChange={(e) =>
                      setFormData((p) => ({ ...p, apiKey: e.target.value }))
                    }
                    placeholder={editingId ? '••••••••（留空表示不修改）' : '输入 API Key'}
                    className="h-10 w-full rounded-xl border border-input bg-white px-3 pr-10 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                  />
                  <button
                    type="button"
                    onClick={() => setShowApiKey(!showApiKey)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showApiKey ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>

              <div className="mt-5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">模型绑定（下拉直选）</div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {MODEL_FIELD_GUIDE.map((g) => {
                  const fieldKind = g.field === 'textModel' ? 'text' : g.field === 'imageModel' ? 'image' : g.field === 'videoModel' ? 'video' : 'tts';
                  const current = ((formData as unknown as Record<string, string>)[g.field] || '');
                  // Agnes 测试通道：下拉只列免费白名单（收费模型名即使手填也会在保存后警告）
                  const agnesOnly = formData.formatType === 'agnes';
                  const options = fetchedModels.filter((m) => {
                    const kind = m.kind ?? classifyModelId(m.id);
                    if (kind !== fieldKind) return false;
                    if (agnesOnly && !isFreeAgnesModel(m.id)) return false;
                    return true;
                  });
                  const unknowns = fetchedModels.filter((m) => (m.kind ?? classifyModelId(m.id)) === 'unknown');
                  const inList = options.some((m) => m.id === current) || unknowns.some((m) => m.id === current);
                  // 默认永远下拉；只有用户显式点铅笔，或已有值不在列表里时才手填
                  const custom = customFields.has(g.field) || (current !== '' && (options.length > 0 || unknowns.length > 0) && !inList);
                  const FieldIcon = g.field === 'textModel' ? Type : g.field === 'imageModel' ? ImageIcon : g.field === 'videoModel' ? Video : Mic;
                  return (
                    <div key={g.field} className="rounded-xl border border-border/60 bg-muted/20 p-3">
                      <div className="flex items-center justify-between">
                        <label className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                          <FieldIcon className="h-3.5 w-3.5 text-primary" />
                          {g.label}模型
                        </label>
                        {!custom ? (
                          <button
                            type="button"
                            title="切换为手动填写"
                            onClick={() => setCustomFields((prev) => new Set(prev).add(g.field))}
                            className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-white hover:text-foreground"
                          >
                            <Pencil className="h-3 w-3" /> 手填
                          </button>
                        ) : (
                          <button
                            type="button"
                            title="返回下拉选择"
                            onClick={() => {
                              setCustomFields((prev) => {
                                const next = new Set(prev);
                                next.delete(g.field);
                                return next;
                              });
                            }}
                            className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-white hover:text-foreground"
                          >
                            <ChevronDown className="h-3 w-3" /> 下拉
                          </button>
                        )}
                      </div>
                      {custom ? (
                        <input
                          type="text"
                          value={current}
                          onChange={(e) =>
                            setFormData((p) => ({ ...p, [g.field]: e.target.value }))
                          }
                          placeholder="手动填写模型名"
                          className="mt-2 h-10 w-full rounded-xl border border-input bg-white px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                        />
                      ) : (
                        <select
                          value={inList ? current : ''}
                          onChange={(e) => {
                            setFormData((p) => ({ ...p, [g.field]: e.target.value }));
                          }}
                          className="mt-2 h-10 w-full rounded-xl border border-input bg-white px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                        >
                          <option value="">
                            {fetchingModels
                              ? '正在拉取模型列表…'
                              : options.length > 0 || unknowns.length > 0
                                ? `请选择${g.label}模型（共${options.length + unknowns.length}个）…`
                                : '暂无列表：先点下方"获取模型列表"'}
                          </option>
                          {options.map((m) => (
                            <option key={m.id} value={m.id}>{m.id}</option>
                          ))}
                          {unknowns.length > 0 && (
                            <optgroup label="未知类型（自行确认）">
                              {unknowns.map((m) => (
                                <option key={m.id} value={m.id}>{m.id}</option>
                              ))}
                            </optgroup>
                          )}
                        </select>
                      )}
                      <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">{g.desc}</p>
                      {agnesOnly && current !== '' && !isFreeAgnesModel(current) && (
                        <p className="mt-1 text-[11px] font-medium text-amber-700">
                          该模型不在免费名单内，Agnes 测试通道只接免费模型（{FREE_AGNES_MODELS.join('、')}），将产生费用或调用失败。
                        </p>
                      )}
                    </div>
                  );
                })}
                {modelsError && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-800">
                    模型列表拉取失败：{modelsError}
                  </div>
                )}
              </div>

              <div>
                <label className="text-sm font-medium text-foreground">
                  默认音色
                </label>
                <input
                  type="text"
                  value={formData.ttsVoice || ''}
                  onChange={(e) =>
                    setFormData((p) => ({ ...p, ttsVoice: e.target.value }))
                  }
                  placeholder="zh_female_miaomiao"
                  className="mt-2 h-10 w-full rounded-xl border border-input bg-white px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                />
              </div>

              <div className="mt-5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">高级（可选）</div>
              <div>
                <label className="text-sm font-medium text-foreground">
                  附加提示词
                  <span className="ml-1 text-[11px] font-normal text-muted-foreground">每次文本/图片/视频调用自动追加（文本走 system，图片逗号拼，视频另起一段）</span>
                </label>
                <textarea
                  value={(formData as { promptPrefix?: string }).promptPrefix || ''}
                  onChange={(e) =>
                    setFormData((p) => ({ ...p, promptPrefix: e.target.value }))
                  }
                  placeholder="如：所有输出必须用简体中文；图片一律竖构图"
                  rows={2}
                  className="mt-2 w-full resize-y rounded-xl border border-input bg-white px-3 py-2 text-sm outline-none placeholder:text-muted-foreground/60 focus:border-primary focus:ring-2 focus:ring-primary/20"
                />
              </div>

              <div>
                <label className="text-sm font-medium text-foreground">
                  能力自描述
                  <span className="ml-1 text-[11px] font-normal text-muted-foreground">声明模型支持的规格，生成时按表校验（逗号分隔，留空=不限）</span>
                </label>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  <input
                    type="text"
                    value={(formData.modelParams?.videoDurations ?? []).join(',')}
                    onChange={(e) =>
                      setFormData((p) => ({
                        ...p,
                        modelParams: {
                          ...(p.modelParams ?? {}),
                          videoDurations: e.target.value
                            .split(/[，,]/)
                            .map((s) => Number(s.trim()))
                            .filter((n) => Number.isFinite(n) && n > 0),
                        },
                      }))
                    }
                    placeholder="视频时长s，如 4,8,12"
                    className="h-10 rounded-xl border border-input bg-white px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                  />
                  <input
                    type="text"
                    value={(formData.modelParams?.videoSizes ?? []).join(',')}
                    onChange={(e) =>
                      setFormData((p) => ({
                        ...p,
                        modelParams: {
                          ...(p.modelParams ?? {}),
                          videoSizes: e.target.value.split(/[，,]/).map((s) => s.trim()).filter(Boolean),
                        },
                      }))
                    }
                    placeholder="视频尺寸，如 720p,1080p"
                    className="h-10 rounded-xl border border-input bg-white px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                  />
                  <input
                    type="text"
                    value={(formData.modelParams?.imageSizes ?? []).join(',')}
                    onChange={(e) =>
                      setFormData((p) => ({
                        ...p,
                        modelParams: {
                          ...(p.modelParams ?? {}),
                          imageSizes: e.target.value.split(/[，,]/).map((s) => s.trim()).filter(Boolean),
                        },
                      }))
                    }
                    placeholder="图片尺寸，如 1024x1024"
                    className="h-10 rounded-xl border border-input bg-white px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                  />
                </div>
              </div>

              <div>
                <label className="text-sm font-medium text-foreground">
                  支持能力
                </label>
                <div className="mt-2 flex flex-wrap gap-2">
                  {CAPABILITY_LABELS.map((cap) => (
                    <button
                      key={cap.key}
                      type="button"
                      title={cap.hint ?? cap.label}
                      onClick={() => toggleCapability(cap.key)}
                      className={`rounded-lg border px-3 py-1.5 text-sm transition-colors ${
                        formData.capabilities?.[cap.key]
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-input bg-white text-muted-foreground hover:border-primary/50'
                      }`}
                    >
                      {cap.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-sm font-medium text-foreground">
                  兼容格式
                </label>
                <select
                  value={formData.formatType}
                  onChange={(e) =>
                    setFormData((p) => ({
                      ...p,
                      formatType: e.target.value as FormatType,
                    }))
                  }
                  className="mt-2 h-10 w-full rounded-xl border border-input bg-white px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                >
                  <option value="openai">OpenAI 兼容格式（通用规则）</option>
                  <option value="volcengine_ark">火山方舟格式（通用规则）</option>
                  <option value="agnes">Agnes 专用（测试版独立规则，仅免费模型）</option>
                </select>
                {formData.formatType === 'agnes' && (
                  <p className="mt-1 text-[11px] leading-relaxed text-amber-700">
                    Agnes 测试通道：视频走官方双接口（720P/9:16），只接免费模型；暂无配音能力，配音任务会直接提示。
                  </p>
                )}
              </div>

              <div className="flex items-center justify-between rounded-xl border p-3">
                <div>
                  <div className="text-sm font-medium text-foreground">
                    设为默认 Provider
                  </div>
                  <div className="text-xs text-muted-foreground">
                    新建任务时优先使用此 Provider
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setFormData((p) => ({ ...p, isDefault: !p.isDefault }))
                  }
                  className={`relative h-6 w-11 rounded-full transition-colors ${
                    formData.isDefault ? 'bg-primary' : 'bg-gray-200'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${
                      formData.isDefault ? 'translate-x-5' : 'translate-x-0.5'
                    }`}
                  />
                </button>
              </div>

              {testResult && (
                <div
                  className={`flex items-start gap-3 rounded-xl p-3 ${
                    testResult.success ? 'bg-emerald-50' : 'bg-red-50'
                  }`}
                >
                  {testResult.success ? (
                    <Check className="mt-0.5 h-5 w-5 text-emerald-600" />
                  ) : (
                    <AlertCircle className="mt-0.5 h-5 w-5 text-red-500" />
                  )}
                  <div>
                    <div
                      className={`text-sm font-medium ${
                        testResult.success
                          ? 'text-emerald-700'
                          : 'text-red-600'
                      }`}
                    >
                      {testResult.success ? '连接成功' : '连接失败'}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {testResult.message}
                      {testResult.latencyMs !== undefined &&
                        ` · 延迟 ${testResult.latencyMs}ms`}
                    </div>
                    {testResult.url && (
                      <div className="mt-1 break-all text-[11px] text-muted-foreground/80">
                        实际请求：{testResult.url}
                      </div>
                    )}
                    {editingId && (
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <span className="text-[11px] text-muted-foreground">按能力探活（最小真实调用，视频太贵不探）：</span>
                        {(['text', 'image', 'tts'] as const).map((c) => (
                          <button
                            key={c}
                            type="button"
                            disabled={probing !== null}
                            onClick={() => handleProbe(c)}
                            className="rounded-lg border border-input px-2.5 py-1 text-[11px] text-foreground hover:border-primary hover:text-primary disabled:opacity-50"
                          >
                            {probing === c ? '探活中…' : c === 'text' ? '探活文本' : c === 'image' ? '探活图片' : '探活配音'}
                          </button>
                        ))}
                      </div>
                    )}
                    {probeMsg && (
                      <div className="mt-1 text-[11px] text-muted-foreground">{probeMsg}</div>
                    )}
                    {testResult.preview && (
                      <pre className="mt-2 max-h-40 overflow-auto rounded-lg bg-black/80 p-2 text-[11px] leading-relaxed text-green-200">
                        {JSON.stringify(testResult.preview, null, 2)}
                      </pre>
                    )}
                  </div>
                </div>
              )}

              {/* 模型列表 */}
              {modelsResult && (
                <div
                  className={`rounded-xl p-3 ${
                    modelsResult.success ? 'bg-emerald-50' : 'bg-red-50'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {modelsResult.success ? (
                      <Check className="h-4 w-4 text-emerald-600" />
                    ) : (
                      <AlertCircle className="h-4 w-4 text-red-500" />
                    )}
                    <span
                      className={`text-sm font-medium ${
                        modelsResult.success ? 'text-emerald-700' : 'text-red-600'
                      }`}
                    >
                      {modelsResult.success
                        ? `获取成功，共 ${fetchedModels.length} 个模型`
                        : '获取失败'}
                    </span>
                    {modelsResult.latencyMs !== undefined && (
                      <span className="text-xs text-muted-foreground">
                        · {modelsResult.latencyMs}ms
                      </span>
                    )}
                  </div>
                  {!modelsResult.success && modelsResult.message && (
                    <div className="mt-1 text-xs text-muted-foreground">
                      {modelsResult.message}
                    </div>
                  )}
                </div>
              )}

              {fetchedModels.length > 0 && (
                <div className="rounded-xl border">
                  <div className="border-b p-3">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <input
                        type="text"
                        value={modelsFilter}
                        onChange={(e) => setModelsFilter(e.target.value)}
                        placeholder="搜索模型名称..."
                        className="h-9 w-full rounded-lg border border-input bg-white pl-9 pr-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                      />
                    </div>
                    <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
                      <span>点击右侧图标将模型填入对应字段（手动优先）；徽标为系统按命名规律的猜测，仅供参考：</span>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={autoAssignModels}
                        className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
                      >
                        一键自动归类（只填空字段）
                      </button>
                      <span className="flex items-center gap-1"><Type className="h-3 w-3" />文本</span>
                      <span className="flex items-center gap-1"><ImageIcon className="h-3 w-3" />图片</span>
                      <span className="flex items-center gap-1"><Video className="h-3 w-3" />视频</span>
                      <span className="flex items-center gap-1"><Mic className="h-3 w-3" />配音</span>
                    </div>
                    {autoAssignMsg && (
                      <div className="mt-2 rounded-lg bg-muted/60 p-2 text-[11px] leading-relaxed text-foreground/80">
                        {autoAssignMsg}
                      </div>
                    )}
                  </div>
                  <div className="max-h-56 overflow-y-auto">
                    {fetchedModels
                      .filter((m) =>
                        m.id.toLowerCase().includes(modelsFilter.toLowerCase()),
                      )
                      .map((m) => (
                        <div
                          key={m.id}
                          className="flex items-center justify-between border-b px-3 py-2 last:border-b-0 hover:bg-muted/30"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <div className="truncate text-sm font-medium text-foreground">
                                {m.id}
                              </div>
                              <span
                                title="系统按命名规律的猜测，仅供参考，以手动选择为准"
                                className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${
                                  (m.kind ?? classifyModelId(m.id)) === 'unknown'
                                    ? 'bg-gray-100 text-gray-500'
                                    : 'bg-primary/10 text-primary'
                                }`}
                              >
                                {MODEL_KIND_LABELS[(m.kind ?? classifyModelId(m.id)) as ModelKind] ?? '未知'}
                              </span>
                            </div>
                            {m.owned_by && (
                              <div className="text-xs text-muted-foreground">
                                {m.owned_by}
                              </div>
                            )}
                          </div>
                          <div className="flex shrink-0 gap-1">
                            <button
                              type="button"
                              title="填入文本模型"
                              onClick={() => fillModel('textModel', m.id)}
                              className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-primary/10 hover:text-primary"
                            >
                              <Type className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              title="填入图片模型"
                              onClick={() => fillModel('imageModel', m.id)}
                              className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-primary/10 hover:text-primary"
                            >
                              <ImageIcon className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              title="填入视频模型"
                              onClick={() => fillModel('videoModel', m.id)}
                              className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-primary/10 hover:text-primary"
                            >
                              <Video className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              title="填入配音模型"
                              onClick={() => fillModel('ttsModel', m.id)}
                              className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-primary/10 hover:text-primary"
                            >
                              <Mic className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between border-t p-4">
              <div className="flex gap-2">
                <select
                  value={testMode}
                  onChange={(e) => setTestMode(e.target.value as 'offline' | 'preview' | 'live')}
                  title="offline=格式校验零成本 / preview=请求预览零成本 / live=真实请求"
                  className="h-[38px] rounded-xl border border-input bg-white px-2 text-xs text-muted-foreground outline-none focus:border-primary"
                >
                  <option value="live">真实请求</option>
                  <option value="preview">请求预览（免费）</option>
                  <option value="offline">格式校验（免费）</option>
                </select>
                <button
                  onClick={handleTestConnection}
                  disabled={
                    testing ||
                    !formData.baseUrl ||
                    (testMode === 'live' && !formData.apiKey && !editingId)
                  }
                  className="flex items-center gap-2 rounded-xl border border-input px-4 py-2 text-sm font-medium text-foreground hover:border-primary hover:text-primary disabled:opacity-50"
                >
                  <Activity className="h-4 w-4" />
                  {testing ? '测试中...' : '测试连通性'}
                </button>
                <button
                  onClick={handleFetchModels}
                  disabled={fetchingModels || !formData.baseUrl || (!formData.apiKey && !editingId)}
                  className="flex items-center gap-2 rounded-xl border border-input px-4 py-2 text-sm font-medium text-foreground hover:border-primary hover:text-primary disabled:opacity-50"
                >
                  {fetchingModels ? (
                    <RefreshCw className="h-4 w-4 animate-spin" />
                  ) : (
                    <Database className="h-4 w-4" />
                  )}
                  {fetchingModels ? '获取中...' : '获取模型列表'}
                </button>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowModal(false)}
                  className="rounded-xl border border-input px-4 py-2 text-sm font-medium text-foreground hover:bg-muted/50"
                >
                  取消
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving || !formData.name || !formData.baseUrl}
                  className="rounded-xl bg-primary px-5 py-2 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90 disabled:opacity-50"
                >
                  {saving ? '保存中...' : '保存'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default ProviderSection;
