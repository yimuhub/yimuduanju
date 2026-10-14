import { useEffect, useState } from 'react';
import {
  Cpu,
  SlidersHorizontal,
  Wallet,
  BadgeCheck,
  Network,
} from 'lucide-react';
import { providers as providersApi } from '@client/src/api';
import type { ModelProvider } from '@shared/api.interface';
import { logger } from '@client/src/utils/logger';
import { toast } from 'sonner';
import ProviderSection from './ProviderSection';
import GenerationSection from './GenerationSection';
import BudgetSection from './BudgetSection';
import OfficialSection from './OfficialSection';
import StageBindingsSection from './StageBindingsSection';
// P1 诚信：个人设置页全为假按钮/假身份，已下线（有账号体系后再上）；文件保留

type SettingsTab = 'providers' | 'stages' | 'official' | 'generation' | 'budget';

const NAV_ITEMS: { key: SettingsTab; label: string; icon: typeof Cpu }[] = [
  { key: 'providers', label: '模型 Provider', icon: Cpu },
  { key: 'stages', label: '分环节模型', icon: Network },
  { key: 'official', label: '官方直供 ★', icon: BadgeCheck },
  { key: 'generation', label: '生成设置', icon: SlidersHorizontal },
  { key: 'budget', label: '预算与用量', icon: Wallet },
];

const SettingsPage = () => {
  const [activeTab, setActiveTab] = useState<SettingsTab>('providers');
  const [providers, setProviders] = useState<ModelProvider[]>([]);
  const [loading, setLoading] = useState(false);

  const loadProviders = () => {
    setLoading(true);
    providersApi
      .listProviders()
      .then((res) => setProviders(res))
      .catch((e) => {
        // P1 诚信修复：后端不可用时展示空列表+报错，不再用假 Provider 冒充；
        // 之前失败会载入 3 条假数据，用户可能误配置、误生成
        logger.warn('加载 Provider 失败', e);
        setProviders([]);
        toast.error('模型服务加载失败，请确认后端服务正常后重试');
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadProviders();
  }, []);

  return (
    <div className="flex gap-6">
      {/* Left Sidebar Navigation */}
      <div className="w-56 shrink-0">
        <div className="rounded-xl border bg-white p-3 shadow-sm">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.key}
                onClick={() => setActiveTab(item.key)}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                  activeTab === item.key
                    ? 'bg-primary/10 text-primary'
                    : 'text-foreground hover:bg-muted/50'
                }`}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Right Content Area */}
      <div className="flex-1 space-y-6">
        {activeTab === 'providers' && (
          <ProviderSection
            providers={providers}
            loading={loading}
            onRefresh={loadProviders}
          />
        )}
        {activeTab === 'official' && <OfficialSection />}
        {activeTab === 'stages' && <StageBindingsSection providers={providers} />}
        {activeTab === 'generation' && <GenerationSection />}
        {activeTab === 'budget' && <BudgetSection />}
      </div>
    </div>
  );
};

export default SettingsPage;
