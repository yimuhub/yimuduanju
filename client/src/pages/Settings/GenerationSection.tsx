import { useState } from 'react';
import { toast } from 'sonner';

export const GEN_DEFAULTS_KEY = 'yimu-gen-defaults';

export interface GenDefaults {
  aspectRatio: string;
  artStyle: string;
  budgetMode: string;
  shotDuration: number;
  subtitleEnabled: boolean;
}

export const loadGenDefaults = (): GenDefaults => {
  try {
    const raw = localStorage.getItem(GEN_DEFAULTS_KEY);
    if (raw) return { shotDuration: 8, subtitleEnabled: true, ...JSON.parse(raw) } as GenDefaults;
  } catch {
    /* ignore */
  }
  return {
    aspectRatio: '9:16',
    artStyle: 'realistic',
    budgetMode: 'balanced',
    shotDuration: 8,
    subtitleEnabled: true,
  };
};

const GenerationSection = () => {
  const [saved, setSaved] = useState(loadGenDefaults);
  const [aspectRatio, setAspectRatio] = useState(saved.aspectRatio);
  const [artStyle, setArtStyle] = useState(saved.artStyle);
  const [budgetMode, setBudgetMode] = useState(saved.budgetMode);
  const [shotDuration, setShotDuration] = useState(saved.shotDuration);
  const [subtitleEnabled, setSubtitleEnabled] = useState(saved.subtitleEnabled);

  return (
    <>
      <div>
        <h1 className="text-xl font-semibold text-foreground">生成设置</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          配置新建项目时的默认参数
        </p>
      </div>

      <div className="space-y-6">
        <div className="rounded-xl border bg-card p-6 shadow-sm">
          <h2 className="text-base font-semibold text-foreground">视频参数</h2>
          <div className="mt-5 grid grid-cols-2 gap-5">
            <div>
              <label className="text-sm font-medium text-foreground">
                默认视频比例
              </label>
              <select
                value={aspectRatio}
                onChange={(e) => setAspectRatio(e.target.value)}
                className="mt-2 h-10 w-full rounded-xl border border-input bg-card px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
              >
                <option value="9:16">9:16（竖屏）</option>
                <option value="16:9">16:9（横屏）</option>
                <option value="1:1">1:1（方形）</option>
              </select>
            </div>
            <div>
              <label className="text-sm font-medium text-foreground">
                默认画风
              </label>
              <select
                value={artStyle}
                onChange={(e) => setArtStyle(e.target.value)}
                className="mt-2 h-10 w-full rounded-xl border border-input bg-card px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
              >
                <option value="realistic">写实</option>
                <option value="live_action">真人实景</option>
                <option value="anime_2d">日漫</option>
                <option value="chinese_comic">国漫</option>
                <option value="xianxia">仙侠</option>
                <option value="cg_cyberpunk">赛博朋克</option>
                <option value="guofeng_3d">国风3D</option>
              </select>
            </div>
          </div>
        </div>

        <div className="rounded-xl border bg-card p-6 shadow-sm">
          <h2 className="text-base font-semibold text-foreground">预算模式</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            选择默认的预算与质量平衡策略
          </p>
          <div className="mt-4 grid grid-cols-4 gap-3">
            {[
              { value: 'quality_first', label: '质量优先', desc: '最高画质' },
              { value: 'balanced', label: '均衡', desc: '质量与成本平衡' },
              { value: 'cost_first', label: '成本优先', desc: '控制费用' },
              { value: 'fast_first', label: '速度优先', desc: '最快生成' },
            ].map((opt) => (
              <button
                key={opt.value}
                onClick={() => setBudgetMode(opt.value)}
                className={`rounded-xl border p-4 text-left transition-all ${
                  budgetMode === opt.value
                    ? 'border-primary bg-primary/5'
                    : 'border-input bg-card hover:border-primary/50'
                }`}
              >
                <div className="text-sm font-semibold text-foreground">
                  {opt.label}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {opt.desc}
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-xl border bg-card p-6 shadow-sm">
          <h2 className="text-base font-semibold text-foreground">
            分镜与字幕
          </h2>
          <div className="mt-5 grid grid-cols-2 gap-5">
            <div>
              <label className="text-sm font-medium text-foreground">
                分镜默认时长（秒）
              </label>
              <input
                type="number"
                min={4}
                max={15}
                value={shotDuration}
                onChange={(e) => setShotDuration(Number(e.target.value))}
                className="mt-2 h-10 w-full rounded-xl border border-input bg-card px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                建议 8-10 秒；4-6 秒适合快切，10-15 秒适合完整动作/对白
              </p>
            </div>
            <div className="flex items-center">
              <div className="flex-1">
                <div className="text-sm font-medium text-foreground">
                  字幕默认开启
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  新建项目时自动生成字幕
                </div>
              </div>
              <button
                onClick={() => setSubtitleEnabled(!subtitleEnabled)}
                className={`relative h-6 w-11 rounded-full transition-colors ${
                  subtitleEnabled ? 'bg-primary' : 'bg-muted'
                }`}
              >
                <span
                  className={`absolute top-0.5 h-5 w-5 rounded-full bg-card shadow-sm transition-transform ${
                    subtitleEnabled ? 'translate-x-5' : 'translate-x-0.5'
                  }`}
                />
              </button>
            </div>
          </div>
        </div>

        {/* P1 修复：保存按钮之前无 onClick；现持久化到本机，一键创作读取 */}
        <button
          onClick={() => {
            localStorage.setItem(
              GEN_DEFAULTS_KEY,
              JSON.stringify({ aspectRatio, artStyle, budgetMode, shotDuration, subtitleEnabled }),
            );
            toast.success('默认参数已保存在本机，新建项目时自动套用');
          }}
          className="w-max rounded-xl bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90"
        >
          保存设置
        </button>
        <p className="-mt-3 text-xs text-muted-foreground">仅保存在本机浏览器</p>
      </div>
    </>
  );
};

export default GenerationSection;
