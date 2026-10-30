import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Cpu,
  SlidersHorizontal,
  Wallet,
  Network,
  Settings2,
  CheckCircle2,
  Circle,
} from 'lucide-react';
import { providers as providersApi } from '@client/src/api';
import type { ModelProvider } from '@shared/api.interface';
import { logger } from '@client/src/utils/logger';
import { toast } from 'sonner';
import PageHeader from '@client/src/components/PageHeader';
import ProviderSection from './ProviderSection';
import GenerationSection, { loadGenDefaults } from './GenerationSection';
import BudgetSection from './BudgetSection';
import OfficialSection from './OfficialSection';
import StageBindingsSection from './StageBindingsSection';
// P1 诚信：个人设置页全为假按钮/假身份，已下线（有账号体系后再上）；文件保留

type SettingsAnchor = 'providers' | 'bindings' | 'billing' | 'preferences';

const NAV_ITEMS: {
  key: SettingsAnchor;
  label: string;
  desc: string;
  icon: typeof Cpu;
}[] = [
  { key: 'providers', label: '供应商', desc: '模型服务与 Key 管理', icon: Cpu },
  { key: 'bindings', label: '模型绑定', desc: '分环节模型指定', icon: Network },
  { key: 'billing', label: '计费', desc: '用量、预算与官方直供', icon: Wallet },
  { key: 'preferences', label: '偏好', desc: '生成默认参数', icon: SlidersHorizontal },
];

const BUDGET_MODE_LABELS: Record<string, string> = {
  quality_first: '质量优先',
  balanced: '均衡',
  cost_first: '成本优先',
  fast_first: '速度优先',
};

const CAP_KEYS = ['text', 'image', 'video', 'tts'] as const;
const CAP_NAMES: Record<(typeof CAP_KEYS)[number], string> = {
  text: '文本',
  image: '图片',
  video: '视频',
  tts: '配音',
};

const sectionId = (key: SettingsAnchor) => `settings-${key}`;

const SettingsPage = () => {
  const [activeAnchor, setActiveAnchor] = useState<SettingsAnchor>('providers');
  const [providers, setProviders] = useState<ModelProvider[]>([]);
  const [loading, setLoading] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const loadProviders = () => {
    setLoading(true);
    providersApi
      .listProviders()
      .then((res) => setProviders(res))
      .catch((e) => {
        // P1 诚信修复：后端不可用时展示空列表+报错，不再用假 Provider 冒充
        logger.warn('加载 Provider 失败', e);
        setProviders([]);
        toast.error('模型服务加载失败，请确认后端服务正常后重试');
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadProviders();
  }, []);

  // 滚动监听：让左侧锚点高亮跟随右侧区块
  useEffect(() => {
    const scroller = wrapRef.current?.closest('main') ?? null;
    if (!scroller) return;
    const onScroll = () => {
      const el = wrapRef.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top;
      let current: SettingsAnchor = 'providers';
      for (const item of NAV_ITEMS) {
        const sec = document.getElementById(sectionId(item.key));
        if (sec && sec.getBoundingClientRect().top - top <= 96) {
          current = item.key;
        }
      }
      setActiveAnchor(current);
    };
    scroller.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => scroller.removeEventListener('scroll', onScroll);
  }, []);

  const jumpTo = (key: SettingsAnchor) => {
    document
      .getElementById(sectionId(key))
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setActiveAnchor(key);
  };

  // 顶部状态卡：数据全部来自真实接口/本机真实设置，不造假数
  const enabledProviders = useMemo(
    () => providers.filter((p) => p.enabled),
    [providers],
  );
  const coverage = useMemo(
    () =>
      CAP_KEYS.map((cap) => ({
        cap,
        covered: enabledProviders.some(
          (p) => p.capabilities?.[cap] && p[cap === 'text' ? 'textModel' : cap === 'image' ? 'imageModel' : cap === 'video' ? 'videoModel' : 'ttsModel'],
        ),
      })),
    [enabledProviders],
  );
  const coveredCount = coverage.filter((c) => c.covered).length;
  const budgetMode = BUDGET_MODE_LABELS[loadGenDefaults().budgetMode] ?? '均衡';

  return (
    <div className="space-y-6">
      <PageHeader
        title="设置"
        icon={Settings2}
        description="模型供应商、分环节模型绑定、计费预算与生成偏好"
      />
      <div ref={wrapRef} className="flex gap-6">
      {/* 左侧锚点子导航（pane-hide-narrow：在极客模式右栏窄签容器内自动收起，避免横向溢出） */}
      <aside className="pane-hide-narrow w-56 shrink-0">
        <div className="sticky top-0 space-y-4 py-1">
          <div className="rounded-xl border bg-card p-3 shadow-sm">
            <div className="flex items-center gap-1.5 px-2 pb-2 pt-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              <Settings2 className="h-3.5 w-3.5" />
              设置导航
            </div>
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const active = activeAnchor === item.key;
              return (
                <button
                  key={item.key}
                  onClick={() => jumpTo(item.key)}
                  className={`mb-0.5 flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${
                    active
                      ? 'bg-primary/10 text-primary'
                      : 'text-foreground hover:bg-muted/50'
                  }`}
                >
                  <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${active ? 'text-primary' : 'text-muted-foreground'}`} />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{item.label}</span>
                    <span className="block text-[11px] text-muted-foreground">
                      {item.desc}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
          <p className="px-2 text-[11px] leading-relaxed text-muted-foreground">
            「一幕 · YIMU AI 短剧创作平台」建议先配好一家供应商并完成连通测试，再开始生成任务。
          </p>
        </div>
      </aside>

      {/* 右侧：状态卡 + 锚点区块 */}
      <div className="min-w-0 flex-1 space-y-8">
        {/* 顶部状态卡 */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="rounded-xl border bg-card p-5 shadow-sm">
            <div className="text-xs text-muted-foreground">已配供应商</div>
            <div className="mt-2 flex items-baseline gap-1.5">
              <span className="text-3xl font-bold text-foreground">
                {loading ? '–' : providers.length}
              </span>
              <span className="text-xs text-muted-foreground">
                家（启用 {enabledProviders.length}）
              </span>
            </div>
          </div>
          <div className="rounded-xl border bg-card p-5 shadow-sm">
            <div className="text-xs text-muted-foreground">模型覆盖</div>
            <div className="mt-2 flex items-baseline gap-1.5">
              <span className="text-3xl font-bold text-foreground">
                {loading ? '–' : `${coveredCount}/4`}
              </span>
              <span className="text-xs text-muted-foreground">类能力就绪</span>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {coverage.map(({ cap, covered }) => (
                <span
                  key={cap}
                  className={`flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] ${
                    covered
                      ? 'bg-emerald-500/15 text-emerald-400'
                      : 'bg-muted text-muted-foreground'
                  }`}
                >
                  {covered ? (
                    <CheckCircle2 className="h-3 w-3" />
                  ) : (
                    <Circle className="h-3 w-3" />
                  )}
                  {CAP_NAMES[cap]}
                </span>
              ))}
            </div>
          </div>
          <div className="rounded-xl border bg-card p-5 shadow-sm">
            <div className="text-xs text-muted-foreground">预算档</div>
            <div className="mt-2 flex items-baseline gap-1.5">
              <span className="text-3xl font-bold text-foreground">
                {loading ? '–' : budgetMode}
              </span>
            </div>
            <div className="mt-2 text-[11px] text-muted-foreground">
              在「偏好」中调整默认预算策略，用量明细见「计费」
            </div>
          </div>
        </div>

        <section id={sectionId('providers')} className="scroll-mt-4 space-y-6">
          <ProviderSection
            providers={providers}
            loading={loading}
            onRefresh={loadProviders}
          />
        </section>

        <section id={sectionId('bindings')} className="scroll-mt-4">
          <StageBindingsSection providers={providers} />
        </section>

        <section id={sectionId('billing')} className="space-y-6">
          <BudgetSection />
          <OfficialSection />
        </section>

        <section id={sectionId('preferences')}>
          <GenerationSection />
        </section>
      </div>
      </div>
    </div>
  );
};

export default SettingsPage;
