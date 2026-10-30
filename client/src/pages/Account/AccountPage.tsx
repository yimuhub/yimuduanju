/**
 * 用户中心 · 个人资料 / 会员与套餐 / 用量统计 / 快捷设置
 */
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  UserCircle,
  Check,
  Pencil,
  Crown,
  Gem,
  Rocket,
  Wallet,
  Layers,
  Cpu,
  ChevronRight,
} from 'lucide-react';
import { toast } from 'sonner';
import { dashboard } from '@client/src/api';
import type { CostSummary, DashboardStats } from '@shared/api.interface';
import PageHeader from '@client/src/components/PageHeader';

const NICKNAME_KEY = 'yimu.account.nickname';

interface PlanCard {
  key: string;
  name: string;
  price: string;
  period: string;
  desc: string;
  perks: string[];
  current?: boolean;
  icon: typeof Gem;
}

const PLANS: PlanCard[] = [
  {
    key: 'free',
    name: '免费版',
    price: '¥0',
    period: '/月',
    desc: '体验完整创作链路',
    perks: ['每月 20 个生成任务', '基础画风与模板', '720P 导出', '社区支持'],
    icon: Gem,
  },
  {
    key: 'pro',
    name: '专业版',
    price: '¥99',
    period: '/月',
    desc: '个人创作者主力档',
    perks: ['无限生成任务', '全风格库 + 剧本技能', '1080P 导出与去水印', '优先排队通道'],
    current: true,
    icon: Crown,
  },
  {
    key: 'studio',
    name: '工作室版',
    price: '¥399',
    period: '/月',
    desc: '多人协作与产能优先',
    perks: ['含 5 个协作席位', '旗舰模型独享额度', '4K 导出 / 批量导出', '专属客户成功经理'],
    icon: Rocket,
  },
];

const AccountPage = () => {
  const navigate = useNavigate();
  const [nickname, setNickname] = useState(
    () => localStorage.getItem(NICKNAME_KEY) || '一幕用户',
  );
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(nickname);
  const [cost, setCost] = useState<CostSummary | null>(null);
  const [stats, setStats] = useState<DashboardStats | null>(null);

  useEffect(() => {
    dashboard.getCostSummary().then(setCost).catch(() => {});
    dashboard.getStats().then(setStats).catch(() => {});
  }, []);

  const saveNickname = () => {
    const trimmed = nameDraft.trim();
    if (!trimmed) {
      toast.error('昵称不能为空');
      return;
    }
    setNickname(trimmed);
    localStorage.setItem(NICKNAME_KEY, trimmed);
    setEditingName(false);
    toast.success('昵称已保存');
  };

  const handleUpgrade = () => {
    toast('商业化版本即将上线，敬请期待');
  };

  const monthlyCost = cost?.monthlyCost ?? 0;
  const budgetCap = cost?.budgetCap ?? null;
  // 预算内进度：未设预算上限时按月度展示用量占比（费用本身即真实值）
  const usagePct =
    budgetCap && budgetCap > 0
      ? Math.min(100, Math.round((monthlyCost / budgetCap) * 100))
      : null;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title="用户中心"
        icon={UserCircle}
        description="账户资料、套餐权益与本月用量"
      />

      {/* 个人资料 + 会员卡 */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-5">
        <div className="rounded-xl border bg-white p-5 shadow-sm lg:col-span-2">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-gradient text-lg font-semibold text-primary-foreground">
              YM
            </div>
            <div className="min-w-0 flex-1">
              {editingName ? (
                <div className="flex items-center gap-2">
                  <input
                    value={nameDraft}
                    onChange={(e) => setNameDraft(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && saveNickname()}
                    autoFocus
                    className="h-8 w-full rounded-lg border border-input px-2 text-sm outline-none focus:border-primary"
                  />
                  <button
                    onClick={saveNickname}
                    className="shrink-0 rounded-lg bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground"
                  >
                    保存
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="truncate text-base font-semibold text-foreground">
                    {nickname}
                  </span>
                  <button
                    onClick={() => {
                      setNameDraft(nickname);
                      setEditingName(true);
                    }}
                    className="rounded-lg p-1 text-muted-foreground hover:bg-muted hover:text-primary"
                    aria-label="编辑昵称"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                user@yimu.studio
              </p>
            </div>
          </div>
          <div className="mt-4 space-y-2 border-t border-border pt-4 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">累计项目</span>
              <span className="font-medium text-foreground">{stats?.totalProjects ?? '—'}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">累计镜头</span>
              <span className="font-medium text-foreground">{stats?.totalShots ?? '—'}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">资产总数</span>
              <span className="font-medium text-foreground">{stats?.totalAssets ?? '—'}</span>
            </div>
          </div>
        </div>

        {/* 会员卡（品牌红渐变，与全站唯一品牌语言一致） */}
        <div className="relative overflow-hidden rounded-xl bg-brand-gradient p-5 text-white shadow-sm lg:col-span-3">
          <div className="absolute -right-8 -top-8 h-32 w-32 rounded-full bg-white/15 blur-2xl" />
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Crown className="h-5 w-5 text-white" />
              <span className="text-base font-semibold">专业版会员</span>
            </div>
            <span className="rounded-full bg-white/10 px-3 py-1 text-xs text-white/80 backdrop-blur">
              2026-12-31 到期
            </span>
          </div>
          <p className="mt-3 text-xs leading-relaxed text-white/70">
            权益：无限生成任务 · 全风格库 · 剧本技能 · 1080P 去水印导出 · 优先排队
          </p>
          <div className="mt-4 flex items-center gap-4 border-t border-white/10 pt-4 text-xs text-white/60">
            <span>本月已用 {cost?.monthlyJobs ?? 0} 个任务</span>
            <span>本月费用 ¥{monthlyCost.toFixed(2)}</span>
          </div>
        </div>
      </div>

      {/* 用量统计 */}
      <div className="rounded-xl border bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Wallet className="h-4 w-4 text-primary" />
            本月用量
          </h2>
          <Link to="/dashboard" className="text-xs font-medium text-primary hover:underline">
            查看数据看板
          </Link>
        </div>
        <div className="mt-4 grid grid-cols-1 gap-5 sm:grid-cols-3">
          <div className="rounded-xl bg-muted/50 p-4">
            <div className="text-xs text-muted-foreground">本月费用</div>
            <div className="mt-1 text-2xl font-bold text-foreground">
              ¥{monthlyCost.toFixed(2)}
            </div>
            {budgetCap !== null && (
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-border">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{ width: `${usagePct ?? 0}%` }}
                />
              </div>
            )}
            <div className="mt-1.5 text-[11px] text-muted-foreground">
              {budgetCap !== null
                ? `预算 ¥${budgetCap}，已用 ${usagePct}%`
                : '累计费用 ¥' + (cost?.totalCost ?? 0).toFixed(2)}
            </div>
          </div>
          <div className="rounded-xl bg-muted/50 p-4">
            <div className="text-xs text-muted-foreground">本月任务数</div>
            <div className="mt-1 text-2xl font-bold text-foreground">
              {cost?.monthlyJobs ?? 0}
            </div>
            <div className="mt-1.5 text-[11px] text-muted-foreground">
              进行中 {stats?.runningJobs ?? 0} · 今日完成 {stats?.completedToday ?? 0}
            </div>
          </div>
          <div className="rounded-xl bg-muted/50 p-4">
            <div className="text-xs text-muted-foreground">按任务类型</div>
            <div className="mt-2 space-y-1.5">
              {(cost?.jobsByType ?? []).slice(0, 4).map((j) => (
                <div key={j.jobType} className="flex items-center justify-between text-xs">
                  <span className="rounded bg-white px-1.5 py-0.5 font-medium text-foreground/70">
                    {j.jobType}
                  </span>
                  <span className="text-muted-foreground">
                    {j.count} 次 · ¥{j.cost.toFixed(2)}
                  </span>
                </div>
              ))}
              {(cost?.jobsByType ?? []).length === 0 && (
                <p className="text-xs text-muted-foreground">本月暂无任务记录</p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 套餐卡 */}
      <div>
        <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Layers className="h-4 w-4 text-primary" />
          套餐方案
        </h2>
        <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-3">
          {PLANS.map((plan) => {
            const Icon = plan.icon;
            return (
              <div
                key={plan.key}
                className={`relative rounded-xl border bg-white p-5 shadow-sm ${
                  plan.current ? 'border-primary/50 ring-1 ring-primary/20' : ''
                }`}
              >
                {plan.current && (
                  <span className="absolute right-4 top-4 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                    当前
                  </span>
                )}
                <div className="flex items-center gap-2">
                  <Icon className={`h-4 w-4 ${plan.current ? 'text-primary' : 'text-muted-foreground'}`} />
                  <span className="text-sm font-semibold text-foreground">{plan.name}</span>
                </div>
                <div className="mt-2 flex items-baseline gap-1">
                  <span className="text-2xl font-bold text-foreground">{plan.price}</span>
                  <span className="text-xs text-muted-foreground">{plan.period}</span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{plan.desc}</p>
                <ul className="mt-3 space-y-1.5">
                  {plan.perks.map((perk) => (
                    <li key={perk} className="flex items-start gap-1.5 text-xs text-foreground/80">
                      <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
                      {perk}
                    </li>
                  ))}
                </ul>
                <button
                  onClick={handleUpgrade}
                  disabled={plan.current}
                  className={`mt-4 w-full rounded-xl py-2 text-sm font-medium transition-colors ${
                    plan.current
                      ? 'cursor-default bg-muted text-muted-foreground'
                      : 'bg-primary text-primary-foreground hover:bg-primary/90'
                  }`}
                >
                  {plan.current ? '使用中' : '升级'}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* 快捷设置入口 */}
      <div className="rounded-xl border bg-white p-2 shadow-sm">
        <button
          onClick={() => navigate('/settings')}
          className="flex w-full items-center justify-between rounded-lg px-3 py-3 text-sm transition-colors hover:bg-muted/60"
        >
          <span className="flex items-center gap-2.5">
            <Cpu className="h-4 w-4 text-primary" />
            <span className="font-medium text-foreground">供应商与模型绑定</span>
            <span className="text-xs text-muted-foreground">管理 API Key、模型通道与生成默认值</span>
          </span>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </button>
      </div>
    </div>
  );
};

export default AccountPage;
