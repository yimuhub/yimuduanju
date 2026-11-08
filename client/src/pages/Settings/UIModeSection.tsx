import { useState } from 'react';
import { Sparkles, PanelLeft, MonitorCog } from 'lucide-react';
import { readUIMode, switchUIMode, type UIMode } from '@client/src/lib/uiMode';

/**
 * 设置 → 偏好 · 界面模式选择卡
 * ─────────────────────────────────────────────
 * 与 lib/uiMode.ts 的三模式枚举一致（studio / classic / geek），选择即切换
 * （switchUIMode 写档后整页跳转，两套外壳干净重建）。已设置的用户保持其选择，
 * 新用户默认进入 Studio 模式。
 */

const MODE_CARDS: {
  mode: UIMode;
  label: string;
  desc: string;
  icon: typeof Sparkles;
}[] = [
  {
    mode: 'studio',
    label: 'Studio 模式',
    desc: '方案 F：导航轨 + 舞台 + 产出坞 + 时间线（默认）',
    icon: Sparkles,
  },
  {
    mode: 'classic',
    label: '经典模式',
    desc: '固定侧边栏 + 顶栏 + 整页导航 + 助手坞',
    icon: PanelLeft,
  },
  {
    mode: 'geek',
    label: '极客模式',
    desc: '三栏作战室：会话 | 对话 | 功能签右栏',
    icon: MonitorCog,
  },
];

const UIModeSection = () => {
  // 挂载时读取当前档（切换即整页跳转，无需订阅变更）
  const [current, setCurrent] = useState<UIMode>(() => readUIMode());

  return (
    <div className="rounded-xl border bg-card p-6 shadow-sm">
      <h2 className="text-base font-semibold text-foreground">界面模式</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        选择整体界面外壳，选择后立即生效（当前模式高亮）
      </p>
      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        {MODE_CARDS.map(({ mode, label, desc, icon: Icon }) => {
          const active = current === mode;
          return (
            <button
              key={mode}
              onClick={() => {
                setCurrent(mode);
                switchUIMode(mode);
              }}
              aria-pressed={active}
              className={`flex flex-col items-start gap-2 rounded-xl border p-4 text-left transition-colors ${
                active
                  ? 'border-primary bg-primary/5 ring-2 ring-primary/20'
                  : 'border-input bg-background hover:border-primary/40'
              }`}
            >
              <span className="flex w-full items-center gap-2">
                <Icon className={`h-4 w-4 shrink-0 ${active ? 'text-primary' : 'text-muted-foreground'}`} />
                <span className="text-sm font-semibold text-foreground">{label}</span>
                {active && (
                  <span className="pill pill-ok ml-auto !h-5 !px-2 !text-[10px]">当前</span>
                )}
              </span>
              <span className="text-xs leading-relaxed text-muted-foreground">{desc}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default UIModeSection;
