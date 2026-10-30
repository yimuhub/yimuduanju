import { useEffect, useState } from 'react';
import { getCostSummary } from '@client/src/api/dashboard';
import type { CostSummary } from '@shared/api.interface';
import { toast } from 'sonner';

const JOB_TYPE_LABELS: Record<string, string> = {
  text: '文本任务',
  image: '图片生成',
  video: '视频生成',
  tts: '配音任务',
  parse_script: '剧本解析',
  storyboard: '分镜任务',
  qc: '质检任务',
  edit: '剪辑任务',
  script: '剧本技能',
};

const BUDGET_KEY = 'yimu-budget-monthly';
const THRESHOLD_KEY = 'yimu-budget-threshold';

const BudgetSection = () => {
  // 预算设置仅保存在本机（后端暂无预算配置表），如实标注
  const [monthlyBudget, setMonthlyBudget] = useState(() =>
    Number(localStorage.getItem(BUDGET_KEY) ?? 5000),
  );
  const [alertThreshold, setAlertThreshold] = useState(() =>
    Number(localStorage.getItem(THRESHOLD_KEY) ?? 80),
  );
  const [summary, setSummary] = useState<CostSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    getCostSummary()
      .then((res) => {
        setSummary(res);
        setLoadError(false);
      })
      .catch(() => {
        // P1 修复：接口失败展示空状态，不再展示写死假数
        setLoadError(true);
      })
      .finally(() => setLoading(false));
  }, []);

  const saveSettings = () => {
    localStorage.setItem(BUDGET_KEY, String(monthlyBudget));
    localStorage.setItem(THRESHOLD_KEY, String(alertThreshold));
    toast.success('预算设置已保存在本机');
  };

  // P1 修复前 monthlyCost=1256.8 / tokens=2568000 等均为写死假数，现全部来自后端落库
  const monthlyCost = summary?.monthlyCost ?? 0;
  // 服务端统一预算（MONTHLY_BUDGET_CAP_CNY）优先；未配置时用本机设置
  const serverCap = summary?.budgetCap ?? null;
  const effectiveBudget = serverCap ?? monthlyBudget;
  const byType = summary?.jobsByType ?? [];
  const countOf = (t: string) => byType.find((x) => x.jobType === t)?.count ?? 0;
  const usageCards = [
    { label: '本月任务', value: String(summary?.monthlyJobs ?? 0), unit: '个' },
    { label: '图片生成', value: String(countOf('image')), unit: '张' },
    { label: '视频生成', value: String(countOf('video')), unit: '个' },
    { label: '配音任务', value: String(countOf('tts')), unit: '个' },
  ];
  const maxTypeCost = Math.max(0.01, ...byType.map((x) => x.cost));

  return (
    <>
      <div>
        <h1 className="text-xl font-semibold text-foreground">预算与用量</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          查看本月消耗与设置预算上限（费用按任务成功结算价汇总，单价为估算值，以 Provider 账单为准）
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center rounded-xl border bg-card py-20 text-muted-foreground">
          加载中...
        </div>
      ) : loadError ? (
        <div className="rounded-xl border bg-card p-6 text-center shadow-sm">
          <div className="text-sm font-medium text-foreground">费用数据加载失败</div>
          <p className="mt-1 text-sm text-muted-foreground">
            请确认后端服务正常后重试，不展示估算假数
          </p>
          <button
            onClick={() => window.location.reload()}
            className="mt-4 rounded-xl bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90"
          >
            重新加载
          </button>
        </div>
      ) : (
        <>
          <div className="rounded-xl border bg-card p-6 shadow-sm">
            <div className="text-sm text-muted-foreground">本月费用</div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-4xl font-bold text-foreground">
                ¥{monthlyCost.toFixed(2)}
              </span>
              <span className="text-sm text-emerald-400">
                占预算 {((monthlyCost / Math.max(0.01, effectiveBudget)) * 100).toFixed(1)}%
              </span>
              {monthlyCost >= effectiveBudget * (alertThreshold / 100) && (
                <span className="text-sm font-medium text-red-400">
                  已达预警线（{alertThreshold}%）
                </span>
              )}
            </div>
            <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-brand-gradient"
                style={{
                  width: `${Math.min(100, (monthlyCost / Math.max(0.01, effectiveBudget)) * 100)}%`,
                }}
              />
            </div>
            <div className="mt-2 text-xs text-muted-foreground">
              历史累计 ¥{(summary?.totalCost ?? 0).toFixed(2)}
              {serverCap !== null && (
                <span> · 服务端统一预算 ¥{serverCap.toFixed(2)}（超限将拒绝新任务）</span>
              )}
            </div>
          </div>

          <div className="grid grid-cols-4 gap-4">
            {usageCards.map((item) => (
              <div
                key={item.label}
                className="rounded-xl border bg-card p-5 shadow-sm"
              >
                <div className="text-sm text-muted-foreground">{item.label}</div>
                <div className="mt-2 text-2xl font-bold text-foreground">
                  {item.value}
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {item.unit}
                </div>
              </div>
            ))}
          </div>

          <div className="rounded-xl border bg-card p-6 shadow-sm">
            <h2 className="text-base font-semibold text-foreground">
              本月各类型费用
            </h2>
            {byType.length === 0 ? (
              <p className="mt-4 text-sm text-muted-foreground">
                本月暂无任务消费，完成一次生成后此处会展示真实费用分布
              </p>
            ) : (
              <div className="mt-6 flex h-40 items-end justify-between gap-2">
                {byType.map((item) => (
                  <div
                    key={item.jobType}
                    className="flex flex-1 flex-col items-center gap-2"
                  >
                    <div
                      className="w-full rounded-t-lg bg-gradient-to-t from-primary/80 to-primary/50"
                      style={{ height: `${Math.max(4, (item.cost / maxTypeCost) * 100)}%` }}
                      title={`¥${item.cost.toFixed(2)} / ${item.count}次`}
                    />
                    <span className="text-xs text-muted-foreground">
                      {JOB_TYPE_LABELS[item.jobType] ?? item.jobType}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      <div className="rounded-xl border bg-card p-6 shadow-sm">
        <h2 className="text-base font-semibold text-foreground">预算设置</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          {serverCap !== null
            ? '服务端已配置统一预算（见上方），以下本机设置仅作展示参考'
            : '服务端未配置统一预算，以下设置仅保存在本机浏览器；如需强制拦截，在服务端设置 MONTHLY_BUDGET_CAP_CNY'}
        </p>
        <div className="mt-5 grid grid-cols-2 gap-5">
          <div>
            <label className="text-sm font-medium text-foreground">
              月度预算上限（元）
            </label>
            <input
              type="number"
              value={monthlyBudget}
              onChange={(e) => setMonthlyBudget(Number(e.target.value))}
              className="mt-2 h-10 w-full rounded-xl border border-input bg-card px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
          </div>
          <div>
            <label className="text-sm font-medium text-foreground">
              预警阈值（%）
            </label>
            <input
              type="number"
              value={alertThreshold}
              onChange={(e) => setAlertThreshold(Number(e.target.value))}
              className="mt-2 h-10 w-full rounded-xl border border-input bg-card px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
          </div>
        </div>
        <button
          onClick={saveSettings}
          className="mt-6 rounded-xl bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90"
        >
          保存设置
        </button>
      </div>
    </>
  );
};

export default BudgetSection;
