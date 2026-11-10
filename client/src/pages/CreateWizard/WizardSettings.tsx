import {
  Clock,
  Film,
  Palette,
  BookOpen,
  DollarSign,
  Settings,
  Check,
} from 'lucide-react';
import type {
  BudgetMode,
  ArtStyle,
  AspectRatio,
} from '@shared/api.interface';

const durationOptions = [
  { label: '30s', value: 30 },
  { label: '60s', value: 60 },
  { label: '90s', value: 90 },
  { label: '3min', value: 180 },
  { label: '5min', value: 300 },
];

const ratioOptions: { label: string; value: AspectRatio }[] = [
  { label: '9:16 竖屏', value: '9:16' },
  { label: '16:9 横屏', value: '16:9' },
  { label: '1:1 方形', value: '1:1' },
];

// export：供一键创作页右栏「实时摘要」读取画风/预算中文名（TriPane 工作台）
export const styleOptions: { label: string; value: ArtStyle; gradient: string; desc: string; image: string }[] = [
  { label: '写实仿真人', value: 'realistic', gradient: 'from-rose-400/30 to-orange-400/30', desc: '真人质感，都市情感/悬疑首选', image: '/styles/realistic.png' },
  { label: '真人实景', value: 'live_action', gradient: 'from-stone-400/30 to-amber-400/30', desc: '实拍感强代入，家庭伦理/职场首选', image: '/styles/live_action.png' },
  { label: '2D 日漫', value: 'anime_2d', gradient: 'from-blue-400/30 to-indigo-400/30', desc: '经典二维，校园青春/奇幻', image: '/styles/anime_2d.png' },
  { label: '韩漫', value: 'manhwa', gradient: 'from-pink-400/30 to-purple-400/30', desc: '高颜值条漫，霸总复仇', image: '/styles/manhwa.png' },
  { label: '国漫', value: 'chinese_comic', gradient: 'from-red-400/30 to-amber-400/30', desc: '国风二次元，仙侠武侠', image: '/styles/chinese_comic.png' },
  { label: '乙女向', value: 'otome', gradient: 'from-pink-300/30 to-rose-300/30', desc: '唯美少女漫，甜宠恋爱', image: '/styles/otome.png' },
  { label: '3D 国风', value: 'guofeng_3d', gradient: 'from-emerald-400/30 to-teal-400/30', desc: '三维国风建模，大制作古装神话', image: '/styles/guofeng_3d.png' },
  { label: '仙侠', value: 'xianxia', gradient: 'from-cyan-400/30 to-sky-400/30', desc: '修仙世界，云雾缭绕', image: '/styles/xianxia.png' },
  { label: '卡通', value: 'cartoon', gradient: 'from-yellow-400/30 to-orange-400/30', desc: 'Q版轻松，搞笑日常', image: '/styles/cartoon.png' },
  { label: '赛博朋克', value: 'cg_cyberpunk', gradient: 'from-purple-400/30 to-fuchsia-400/30', desc: '霓虹未来都市，科幻动作', image: '/styles/cg_cyberpunk.png' },
  { label: '国风2D', value: 'guofeng_2d', gradient: 'from-red-500/30 to-orange-500/30', desc: '新国潮仙侠宫廷，赛璐璐东方古韵', image: '/styles/guofeng_2d.png' },
  { label: '扁平风', value: 'flat_2d', gradient: 'from-muted-foreground/20 to-muted-foreground/10', desc: '极简几何，职场科普广告', image: '/styles/flat_2d.png' },
  { label: '90s日漫', value: 'anime_90s', gradient: 'from-amber-400/30 to-yellow-400/30', desc: '手绘怀旧治愈，青春家庭', image: '/styles/anime_90s.png' },
  { label: '都市罗曼史', value: 'urban_romance', gradient: 'from-indigo-400/30 to-violet-400/30', desc: '成熟言情，冷调电影光影', image: '/styles/urban_romance.png' },
  { label: '3D动漫', value: 'anime_3d', gradient: 'from-sky-400/30 to-blue-400/30', desc: '赛璐珞渲染，明快治愈', image: '/styles/anime_3d.png' },
  { label: '传统3D', value: 'traditional_3d', gradient: 'from-teal-500/30 to-emerald-500/30', desc: 'PBR传统色，典雅大气', image: '/styles/traditional_3d.png' },
  { label: '黏土定格', value: 'clay_stopmotion', gradient: 'from-orange-300/30 to-amber-300/30', desc: '手工黏土，童真治愈', image: '/styles/clay_stopmotion.png' },
  { label: '国风赛博', value: 'guofeng_cyber', gradient: 'from-cyan-500/30 to-purple-500/30', desc: '东方美学×全息霓虹', image: '/styles/guofeng_cyber.png' },
  { label: '古风真人', value: 'ancient_real', gradient: 'from-stone-500/30 to-orange-500/30', desc: '实拍纪实，甜宠古偶', image: '/styles/ancient_real.png' },
  { label: '都市真人', value: 'modern_city_real', gradient: 'from-muted-foreground/20 to-muted-foreground/10', desc: '院线级克制诗意', image: '/styles/modern_city_real.png' },
  { label: '甜宠真人', value: 'urban_sweet_real', gradient: 'from-rose-300/30 to-pink-300/30', desc: '直球温暖现代生活', image: '/styles/urban_sweet_real.png' },
];

// export：供一键创作页右栏「实时摘要」读取预算档中文名
export const budgetOptions: { label: string; value: BudgetMode; desc: string }[] = [
  { label: '质量优先', value: 'quality_first', desc: '最佳画质，成本较高' },
  { label: '均衡', value: 'balanced', desc: '质量与成本平衡' },
  { label: '成本优先', value: 'cost_first', desc: '控制预算，质量可控' },
  { label: '速度优先', value: 'fast_first', desc: '最快生成，快速出片' },
];

interface WizardSettingsProps {
  duration: number;
  setDuration: (v: number) => void;
  aspectRatio: AspectRatio;
  setAspectRatio: (v: AspectRatio) => void;
  artStyle: ArtStyle;
  setArtStyle: (v: ArtStyle) => void;
  budgetMode: BudgetMode;
  setBudgetMode: (v: BudgetMode) => void;
  isProfessional?: boolean;
  shotCount?: number;
  setShotCount?: (v: number) => void;
  shotDuration?: number;
  setShotDuration?: (v: number) => void;
  shotSizePref?: string;
  setShotSizePref?: (v: string) => void;
  cameraStyle?: string;
  setCameraStyle?: (v: string) => void;
  voicePreset?: string;
  setVoicePreset?: (v: string) => void;
  subtitleEnabled?: boolean;
  setSubtitleEnabled?: (v: boolean) => void;
  showSkillToggle?: boolean;
  expandScript?: boolean;
  setExpandScript?: (v: boolean) => void;
  // S2 题材（ToonFlow story_skills 移植）：风格定长相，题材定写法
  genres?: { id: string; label: string; description: string }[];
  genreId?: string;
  setGenreId?: (v: string | undefined) => void;
}

const WizardSettings = ({
  duration,
  setDuration,
  aspectRatio,
  setAspectRatio,
  artStyle,
  setArtStyle,
  budgetMode,
  setBudgetMode,
  isProfessional,
  shotCount,
  setShotCount,
  shotDuration,
  setShotDuration,
  shotSizePref,
  setShotSizePref,
  cameraStyle,
  setCameraStyle,
  voicePreset,
  setVoicePreset,
  subtitleEnabled,
  setSubtitleEnabled,
  showSkillToggle,
  expandScript,
  setExpandScript,
  genres,
  genreId,
  setGenreId,
}: WizardSettingsProps) => {
  return (
    <div className="space-y-5">
      {/* Duration */}
      <div className="rounded-xl border bg-card p-5 shadow-sm">
        <div className="mb-3 flex items-center gap-2">
          <Clock className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold text-foreground">时长</span>
        </div>
        <div className="grid grid-cols-5 gap-2">
          {durationOptions.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setDuration(opt.value)}
              className={`rounded-lg py-2 text-xs font-medium transition-colors ${
                duration === opt.value
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted/50 text-foreground/70 hover:bg-muted'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Ratio */}
      <div className="rounded-xl border bg-card p-5 shadow-sm">
        <div className="mb-3 flex items-center gap-2">
          <Film className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold text-foreground">视频比例</span>
        </div>
        <div className="space-y-2">
          {ratioOptions.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setAspectRatio(opt.value)}
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                aspectRatio === opt.value
                  ? 'bg-primary/10 text-primary ring-1 ring-primary/30'
                  : 'bg-muted/30 text-foreground/70 hover:bg-muted/50'
              }`}
            >
              <Check
                className={`h-4 w-4 ${
                  aspectRatio === opt.value ? 'opacity-100' : 'opacity-0'
                }`}
              />
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Art style */}
      <div className="rounded-xl border bg-card p-5 shadow-sm">
        <div className="mb-3 flex items-center gap-2">
          <Palette className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold text-foreground">画风选择</span>
          <span className="text-[10px] text-muted-foreground">定长相（21 种含 ToonFlow 移植）</span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {styleOptions.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setArtStyle(opt.value)}
              className={`relative overflow-hidden rounded-lg p-3 text-left text-xs font-medium transition-all ${
                artStyle === opt.value
                  ? 'ring-2 ring-primary ring-offset-1'
                  : 'hover:ring-1 hover:ring-primary/40'
              }`}
            >
              <div
                className={`absolute inset-0 bg-gradient-to-br ${opt.gradient}`}
              />
              {/* 样式图：/styles/<id>.png 由样式图管线生成，缺失时自动隐藏走渐变底 */}
              <img
                src={opt.image}
                alt={opt.label}
                loading="lazy"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none';
                }}
                className="relative mb-1.5 aspect-square w-full rounded-md object-cover"
              />
              <span className="relative block text-foreground">{opt.label}</span>
              <span className="relative mt-0.5 block text-[10px] font-normal text-foreground/60">{opt.desc}</span>
              {artStyle === opt.value && (
                <Check className="absolute right-1.5 top-1.5 h-4 w-4 text-primary" />
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Genre (S2: style decides look, genre decides writing) */}
      {genres && genres.length > 0 && setGenreId && (
        <div className="rounded-xl border bg-card p-5 shadow-sm">
          <div className="mb-3 flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-primary" />
            <span className="text-sm font-semibold text-foreground">题材选择</span>
            <span className="text-[10px] text-muted-foreground">定写法（可不选）</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setGenreId(undefined)}
              className={`rounded-lg p-2.5 text-left text-xs font-medium transition-all ${
                !genreId ? 'ring-2 ring-primary ring-offset-1' : 'hover:ring-1 hover:ring-primary/40'
              }`}
            >
              <span className="block text-foreground">不限题材</span>
              <span className="mt-0.5 block text-[10px] font-normal text-foreground/60">通用写法</span>
            </button>
            {genres.map((g) => (
              <button
                key={g.id}
                title={g.description}
                onClick={() => setGenreId(g.id)}
                className={`rounded-lg p-2.5 text-left text-xs font-medium transition-all ${
                  genreId === g.id ? 'ring-2 ring-primary ring-offset-1' : 'hover:ring-1 hover:ring-primary/40'
                }`}
              >
                <span className="block text-foreground">{g.label}</span>
                <span className="mt-0.5 block text-[10px] font-normal text-foreground/60">{g.description}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Budget */}      <div className="rounded-xl border bg-card p-5 shadow-sm">
        <div className="mb-3 flex items-center gap-2">
          <DollarSign className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold text-foreground">预算模式</span>
        </div>
        <div className="space-y-2">
          {budgetOptions.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setBudgetMode(opt.value)}
              className={`w-full rounded-lg px-3 py-2 text-left transition-colors ${
                budgetMode === opt.value
                  ? 'bg-primary/10 text-primary ring-1 ring-primary/30'
                  : 'bg-muted/30 text-foreground/70 hover:bg-muted/50'
              }`}
            >
              <div className="text-sm font-medium">{opt.label}</div>
              <div className="mt-0.5 text-xs opacity-70">{opt.desc}</div>
            </button>
          ))}
        </div>
      </div>

      {/* 剧本技能开关：一句话是否经 LLM 扩写成剧本 */}
      {showSkillToggle && setExpandScript && (
        <div className="rounded-xl border bg-card p-5 shadow-sm">
          <div className="mb-1 flex items-center gap-2">
            <Settings className="h-4 w-4 text-primary" />
            <span className="text-sm font-semibold text-foreground">剧本技能</span>
          </div>
          <label className="flex cursor-pointer items-center justify-between gap-3 pt-1">
            <span className="text-sm text-foreground">
              AI 扩写剧本
              <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                开启：一句话先由剧本技能扩写成钩子前置的完整剧本再分镜（需模型 Key）；关闭：离线启发式直接拆分
              </span>
            </span>
            <input
              type="checkbox"
              checked={expandScript ?? true}
              onChange={(e) => setExpandScript(e.target.checked)}
              className="h-4 w-4 shrink-0 accent-primary"
            />
          </label>
        </div>
      )}

      {/* Pro mode extra settings */}
      {isProfessional && setShotCount && setShotDuration && setShotSizePref && setCameraStyle && setVoicePreset && setSubtitleEnabled && (
        <div className="rounded-xl border bg-card p-5 shadow-sm">
          <div className="mb-3 flex items-center gap-2">
            <Settings className="h-4 w-4 text-primary" />
            <span className="text-sm font-semibold text-foreground">专业参数</span>
          </div>
          <div className="space-y-4">
            <div>
              <div className="flex items-center justify-between text-xs">
                <label className="font-medium text-foreground">分镜数</label>
                <span className="text-primary">{shotCount} 个</span>
              </div>
              <input
                type="range"
                min="5"
                max="60"
                value={shotCount}
                onChange={(e) => setShotCount(Number(e.target.value))}
                className="mt-2 w-full accent-primary"
              />
            </div>
            <div>
              <div className="flex items-center justify-between text-xs">
                <label className="font-medium text-foreground">镜头时长</label>
                <span className="text-primary">{shotDuration} 秒</span>
              </div>
              <input
                type="range"
                min="4"
                max="15"
                value={shotDuration}
                onChange={(e) => setShotDuration(Number(e.target.value))}
                className="mt-2 w-full accent-primary"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-foreground">
                景别偏好
              </label>
              <select
                value={shotSizePref}
                onChange={(e) => setShotSizePref(e.target.value)}
                className="mt-1.5 h-9 w-full rounded-lg border border-input px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
              >
                <option value="mixed">混合</option>
                <option value="close_up">近景为主</option>
                <option value="wide">全景为主</option>
                <option value="medium">中景为主</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-foreground">
                运镜风格
              </label>
              <select
                value={cameraStyle}
                onChange={(e) => setCameraStyle(e.target.value)}
                className="mt-1.5 h-9 w-full rounded-lg border border-input px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
              >
                <option value="dynamic">动态运镜</option>
                <option value="stable">稳定纪实</option>
                <option value="dramatic">戏剧张力</option>
                <option value="minimal">极简固定</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-foreground">
                配音音色
              </label>
              <select
                value={voicePreset}
                onChange={(e) => setVoicePreset(e.target.value)}
                className="mt-1.5 h-9 w-full rounded-lg border border-input px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
              >
                <option value="warm_female">温暖女声</option>
                <option value="cool_female">清冷女声</option>
                <option value="deep_male">磁性男声</option>
                <option value="young_male">年轻男声</option>
                <option value="child">童声</option>
              </select>
            </div>
            <label className="flex items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                checked={subtitleEnabled}
                onChange={(e) => setSubtitleEnabled(e.target.checked)}
                className="h-4 w-4 accent-primary"
              />
              自动生成字幕
            </label>
          </div>
        </div>
      )}
    </div>
  );
};

export default WizardSettings;
