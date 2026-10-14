import { useEffect, useState } from 'react';
import { Cpu, RotateCcw, Save } from 'lucide-react';
import { providers as providersApi } from '@client/src/api';
import type { StageBinding } from '@client/src/api/providers';
import type { ModelProvider } from '@shared/api.interface';
import { STAGE_METAS } from '@shared/stage-bindings';
import { classifyModelId, MODEL_KIND_LABELS, type ModelKind } from '@shared/model-classify';
import { logger } from '@client/src/utils/logger';
import { toast } from 'sonner';

/**
 * B1 分环节模型绑定（移植 ToonFlow agentDeploy）：
 * 每个生产环节独立指定供应商+模型+温度，未绑定回落供应商默认。
 */
const StageBindingsSection = ({ providers }: { providers: ModelProvider[] }) => {
  const [bindings, setBindings] = useState<StageBinding[]>([]);
  const [drafts, setDrafts] = useState<Record<string, { providerId?: string; model?: string; temperature?: string; maxTokens?: string }>>({});
  const [saving, setSaving] = useState<string | null>(null);

  const load = () => {
    providersApi
      .listStageBindings()
      .then((list) => {
        setBindings(list);
        const d: typeof drafts = {};
        for (const b of list) {
          d[b.stage] = {
            providerId: b.providerId ?? '',
            model: b.model ?? '',
            temperature: b.temperature !== undefined ? String(b.temperature) : '',
            maxTokens: b.maxTokens !== undefined ? String(b.maxTokens) : '',
          };
          // 已绑供应商直接预拉模型列表，下拉即选
          if (b.providerId) void fetchModelsFor(b.stage, b.providerId);
        }
        setDrafts(d);
      })
      .catch((e) => logger.warn('加载环节绑定失败', e));
  };

  useEffect(() => {
    load();
  }, []);

  const bindingOf = (stage: string) => bindings.find((b) => b.stage === stage);

  // 供应商的模型列表（选定供应商后自动拉取，可手填覆盖）
  const [modelOptions, setModelOptions] = useState<Record<string, { id: string; kind: string }[]>>({});
  const [loadingModels, setLoadingModels] = useState<string | null>(null);

  const fetchModelsFor = async (stage: string, providerId: string) => {
    const provider = providers.find((p) => p.id === providerId);
    if (!provider?.baseUrl) {
      setModelOptions((prev) => ({ ...prev, [stage]: [] }));
      return;
    }
    setLoadingModels(stage);
    try {
      // 用已保存的生效 Key 拉取（多 Key 行优先），失败则保留手填
      const res = await providersApi.fetchProviderModels({
        baseUrl: provider.baseUrl,
        providerId,
      });
      if (res.success && res.models) {
        setModelOptions((prev) => ({
          ...prev,
          [stage]: res.models!.map((m) => ({ id: m.id, kind: m.kind ?? classifyModelId(m.id) })),
        }));
      } else {
        setModelOptions((prev) => ({ ...prev, [stage]: [] }));
        toast.error(`模型列表获取失败：${res.message ?? '未知错误'}，可手动填写`);
      }
    } catch (e) {
      setModelOptions((prev) => ({ ...prev, [stage]: [] }));
      logger.warn('拉取供应商模型失败', String(e));
    } finally {
      setLoadingModels(null);
    }
  };

  const pickProvider = (stage: string, providerId: string) => {
    setDrafts((p) => ({ ...p, [stage]: { ...p[stage], providerId } }));
    if (providerId) void fetchModelsFor(stage, providerId);
    else setModelOptions((prev) => ({ ...prev, [stage]: [] }));
  };

  const save = async (stage: string) => {
    const d = drafts[stage] ?? {};
    setSaving(stage);
    try {
      const temp = d.temperature?.trim() ? Number(d.temperature) : undefined;
      const toks = d.maxTokens?.trim() ? Number(d.maxTokens) : undefined;
      const updated = await providersApi.setStageBinding(stage, {
        providerId: d.providerId?.trim() || null,
        model: d.model?.trim() || undefined,
        temperature: temp,
        maxTokens: toks,
      });
      setBindings((prev) => {
        const rest = prev.filter((b) => b.stage !== stage);
        return [...rest, updated];
      });
      toast.success('环节绑定已保存');
    } catch (e) {
      logger.error('保存环节绑定失败', String(e));
      toast.error('保存失败，请检查参数');
    } finally {
      setSaving(null);
    }
  };

  const clear = async (stage: string) => {
    setSaving(stage);
    try {
      await providersApi.clearStageBinding(stage);
      setBindings((prev) => prev.filter((b) => b.stage !== stage));
      setDrafts((prev) => ({ ...prev, [stage]: {} }));
      toast.success('已恢复默认');
    } catch (e) {
      logger.error('清除环节绑定失败', String(e));
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="rounded-xl border bg-white p-6 shadow-sm">
      <div className="flex items-center gap-2">
        <Cpu className="h-4 w-4 text-primary" />
        <h3 className="text-base font-semibold text-foreground">分环节模型绑定</h3>
      </div>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
        每个生产环节独立指定供应商＋模型（温度只影响文本/技能类）。不绑定的环节自动回落供应商默认配置。
      </p>
      <div className="mt-4 space-y-3">
        {STAGE_METAS.map((s) => {
          const b = bindingOf(s.key);
          const d = drafts[s.key] ?? {};
          const bound = b?.providerId || b?.model;
          return (
            <div key={s.key} className="rounded-lg border border-border/60 p-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium text-foreground">{s.label}</div>
                  <div className="text-[11px] text-muted-foreground">{s.desc}</div>
                </div>
                {bound ? (
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                    已绑定{b.providerName ? ` · ${b.providerName}` : ''}{b.model ? ` / ${b.model.slice(0, 20)}` : ''}
                  </span>
                ) : (
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">跟随默认</span>
                )}
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <select
                  value={d.providerId ?? ''}
                  onChange={(e) => pickProvider(s.key, e.target.value)}
                  className="h-9 rounded-lg border border-input bg-white px-2 text-xs outline-none focus:border-primary"
                >
                  <option value="">默认供应商</option>
                  {providers.filter((p) => p.enabled).map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
                <input
                  value={d.model ?? ''}
                  onChange={(e) => setDrafts((p) => ({ ...p, [s.key]: { ...p[s.key], model: e.target.value } }))}
                  placeholder={loadingModels === s.key ? '拉取模型列表中…' : '模型名（下拉选或手填）'}
                  list={`models-${s.key}`}
                  className="h-9 rounded-lg border border-input bg-white px-2 text-xs outline-none focus:border-primary"
                />
                <datalist id={`models-${s.key}`}>
                  {(modelOptions[s.key] ?? []).map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.id}（{MODEL_KIND_LABELS[(m.kind ?? 'unknown') as ModelKind] ?? m.kind}）
                    </option>
                  ))}
                </datalist>
                <input
                  value={d.temperature ?? ''}
                  onChange={(e) => setDrafts((p) => ({ ...p, [s.key]: { ...p[s.key], temperature: e.target.value } }))}
                  placeholder="温度 0-2（文本）"
                  inputMode="decimal"
                  className="h-9 rounded-lg border border-input bg-white px-2 text-xs outline-none focus:border-primary"
                />
                <input
                  value={d.maxTokens ?? ''}
                  onChange={(e) => setDrafts((p) => ({ ...p, [s.key]: { ...p[s.key], maxTokens: e.target.value } }))}
                  placeholder="上限 token"
                  inputMode="numeric"
                  className="h-9 rounded-lg border border-input bg-white px-2 text-xs outline-none focus:border-primary"
                />
              </div>
              <div className="mt-2 flex gap-2">
                <button
                  onClick={() => save(s.key)}
                  disabled={saving === s.key}
                  className="flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
                >
                  <Save className="h-3 w-3" /> {saving === s.key ? '保存中…' : '保存'}
                </button>
                {bound && (
                  <button
                    onClick={() => clear(s.key)}
                    disabled={saving === s.key}
                    className="flex items-center gap-1 rounded-lg border border-input px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
                  >
                    <RotateCcw className="h-3 w-3" /> 恢复默认
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default StageBindingsSection;
