import { useEffect, useState } from 'react';
import { BadgeCheck, Pencil } from 'lucide-react';
import { billing as billingApi } from '@client/src/api';
import type { OfficialChannelInfo, PriceItem } from '@shared/api.interface';
import { toast } from 'sonner';

/**
 * 官方直供（供应商商业化核心页）：
 * 通道状态 + 一键配置 + 三栏价格对比（官方价 / 市场参考价 / 省多少）。
 * Key 只写不显；价格调整实时生效全网任务结算。
 */
const OfficialSection = () => {
  const [info, setInfo] = useState<OfficialChannelInfo | null>(null);
  const [prices, setPrices] = useState<PriceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);

  const load = () => {
    setLoading(true);
    Promise.all([billingApi.getOfficial(), billingApi.getPricing()])
      .then(([o, p]) => {
        setInfo(o);
        setPrices(p.filter((x) => x.isActive));
        setBaseUrl(o.baseUrl || '');
      })
      .catch(() => toast.error('官方通道信息加载失败'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const handleToggle = async () => {
    if (!info) return;
    if (!info.enabled && !info.hasApiKey && !apiKey) {
      setEditing(true);
      toast.error('请先填写 Base URL 与 API Key');
      return;
    }
    setSaving(true);
    try {
      const next = await billingApi.updateOfficial({ enabled: !info.enabled });
      setInfo(next);
      toast.success(next.enabled ? '官方直供已启用，新任务将优先走官方通道' : '官方直供已停用');
    } catch {
      toast.error('操作失败');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveConfig = async () => {
    if (!baseUrl.trim()) {
      toast.error('请填写 Base URL');
      return;
    }
    setSaving(true);
    try {
      const next = await billingApi.updateOfficial({
        baseUrl: baseUrl.trim(),
        ...(apiKey ? { apiKey } : {}),
        enabled: true,
      });
      setInfo(next);
      setApiKey('');
      setEditing(false);
      toast.success('官方通道已配置并启用');
    } catch {
      toast.error('保存失败');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="py-16 text-center text-muted-foreground">加载中...</div>;
  }

  return (
    <>
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold text-foreground">
          <BadgeCheck className="h-5 w-5 text-amber-600" />
          官方直供通道
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          为本系统深度调优的官方模型矩阵：同环节更对味、同质量更便宜。启用后新任务自动优先走官方通道。
        </p>
      </div>

      <div className="rounded-xl border bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-base font-semibold text-foreground">
                {info?.displayName || '官方直供通道'}
              </span>
              <span
                className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                  info?.enabled
                    ? 'bg-emerald-50 text-emerald-600'
                    : 'bg-muted text-muted-foreground'
                }`}
              >
                {info?.enabled ? '已启用' : '未启用'}
              </span>
              {info?.hasApiKey && (
                <span className="rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-600">
                  Key 已配置
                </span>
              )}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {info?.baseUrl || '未配置接入地址'} · 价格版本 {info?.priceVersion || 'v1'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setEditing((e) => !e)}
              className="inline-flex items-center gap-1.5 rounded-xl border px-4 py-2 text-sm font-medium hover:bg-muted/50"
            >
              <Pencil className="h-4 w-4" />
              配置
            </button>
            <button
              onClick={handleToggle}
              disabled={saving}
              className={`rounded-xl px-5 py-2 text-sm font-medium text-white shadow-sm disabled:opacity-50 ${
                info?.enabled
                  ? 'bg-muted-foreground/50 hover:bg-muted-foreground/60'
                  : 'bg-amber-600 hover:bg-amber-700'
              }`}
            >
              {saving ? '处理中...' : info?.enabled ? '停用' : '启用官方直供'}
            </button>
          </div>
        </div>

        {editing && (
          <div className="mt-5 grid grid-cols-1 gap-4 rounded-xl bg-muted/30 p-4 md:grid-cols-2">
            <div>
              <label className="text-sm font-medium">Base URL</label>
              <input
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://api.official.example/v1"
                className="mt-1.5 h-10 w-full rounded-xl border border-input bg-white px-3 text-sm outline-none focus:border-primary"
              />
            </div>
            <div>
              <label className="text-sm font-medium">API Key（只写不显，留空表示不更换）</label>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-..."
                className="mt-1.5 h-10 w-full rounded-xl border border-input bg-white px-3 text-sm outline-none focus:border-primary"
              />
            </div>
            <div className="md:col-span-2">
              <button
                onClick={handleSaveConfig}
                disabled={saving}
                className="rounded-xl bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
              >
                {saving ? '保存中...' : '保存并启用'}
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="rounded-xl border bg-white p-6 shadow-sm">
        <h2 className="text-base font-semibold text-foreground">价格对比（每次调用）</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          官方结算价 vs 市场参考价；调价实时生效后续任务结算
        </p>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 pr-4 font-medium">环节</th>
                <th className="py-2 pr-4 font-medium">官方价</th>
                <th className="py-2 pr-4 font-medium">市场参考</th>
                <th className="py-2 font-medium">省</th>
              </tr>
            </thead>
            <tbody>
              {prices.map((p) => {
                const saved =
                  p.marketPriceCny !== null
                    ? Math.round((p.marketPriceCny - p.unitPriceCny) * 100) / 100
                    : null;
                return (
                  <tr key={p.modelKey} className="border-b last:border-0">
                    <td className="py-2.5 pr-4">
                      <div className="font-medium text-foreground">{p.displayName}</div>
                      <div className="text-xs text-muted-foreground">
                        {p.modelKey} · {p.tier}
                      </div>
                    </td>
                    <td className="py-2.5 pr-4 font-semibold text-emerald-600">
                      ¥{p.unitPriceCny.toFixed(2)}
                    </td>
                    <td className="py-2.5 pr-4 text-muted-foreground">
                      {p.marketPriceCny !== null ? `¥${p.marketPriceCny.toFixed(2)}` : '-'}
                    </td>
                    <td className="py-2.5 font-medium text-primary">
                      {saved !== null && saved > 0 ? `¥${saved.toFixed(2)}` : '-'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
};

export default OfficialSection;
