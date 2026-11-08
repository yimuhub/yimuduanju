import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Save, Globe, Palette, Camera, Sparkles, ChevronDown, Check } from 'lucide-react';
import { bible } from '@client/src/api';
import type { WorldView, StyleBible } from '@shared/api.interface';
import { logger } from '@client/src/utils/logger';

const ProjectBibleTab = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [worldView, setWorldView] = useState<WorldView>({
    era: '', geography: '', socialRules: '', artStyle: '', colorSystem: '',
  });
  const [style, setStyle] = useState<StyleBible>({
    visualStyle: '', cameraLanguage: '', colorPalette: '', lighting: '', texture: '', motionLanguage: '', subtitleStyle: '',
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<'all' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedTip, setSavedTip] = useState(false);
  // 分组折叠（长表单可折叠已填分组；默认展开，切到某组即收起整卡）
  const [collapsed, setCollapsed] = useState<{ world: boolean; style: boolean }>({ world: false, style: false });
  const toggleCollapse = (k: 'world' | 'style') =>
    setCollapsed((prev) => ({ ...prev, [k]: !prev[k] }));

  useEffect(() => {
    if (!id) return;
    Promise.all([
      bible.getWorldView(id).catch((e) => { logger.error('wv', String(e)); return null; }),
      bible.getStyleBible(id).catch((e) => { logger.error('st', String(e)); return null; }),
    ]).then(([wv, st]) => {
      if (wv) setWorldView(wv);
      if (st) setStyle(st);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [id]);

  // 顶部统一「保存全部」：世界观 + 风格圣经一次提交（任一失败整体提示，成功的部分已落库）
  const saveAll = async () => {
    if (!id) return;
    setSaving('all');
    setError(null);
    try {
      await Promise.all([
        bible.updateWorldView(id, worldView),
        bible.updateStyleBible(id, style),
      ]);
      setSavedTip(true); setTimeout(() => setSavedTip(false), 2000);
    } catch (err) { logger.error('save bible', String(err)); setError('保存制作圣经失败，请稍后重试'); }
    finally { setSaving(null); }
  };

  const filled = (obj: WorldView | StyleBible) =>
    Object.values(obj).filter((v) => (v ?? '').trim()).length;

  // 紧凑字段输入：统一高度（h-[52px]）、8px 纵向间距、具体占位文案
  const field = (label: string, key: keyof WorldView, placeholder: string) => (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      <textarea
        value={worldView[key] || ''}
        onChange={(e) => setWorldView({ ...worldView, [key]: e.target.value })}
        rows={2}
        className="h-[52px] w-full resize-none rounded-lg border border-input px-3 py-2 text-sm leading-[1.4] outline-none transition-colors placeholder:text-muted-foreground/50 focus:border-primary focus:ring-2 focus:ring-primary/20"
        placeholder={placeholder}
      />
    </div>
  );

  const sfield = (label: string, key: keyof StyleBible, placeholder: string) => (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      <textarea
        value={style[key] || ''}
        onChange={(e) => setStyle({ ...style, [key]: e.target.value })}
        rows={2}
        className="h-[52px] w-full resize-none rounded-lg border border-input px-3 py-2 text-sm leading-[1.4] outline-none transition-colors placeholder:text-muted-foreground/50 focus:border-primary focus:ring-2 focus:ring-primary/20"
        placeholder={placeholder}
      />
    </div>
  );

  const worldFilled = filled(worldView);
  const styleFilled = filled(style);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-foreground">制作圣经</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            世界观与风格定义，确保全片角色、场景、镜头的一致性
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* 统一保存入口：一次提交世界观 + 风格圣经 */}
          <button
            onClick={saveAll}
            disabled={saving === 'all' || loading}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {savedTip ? <Check className="h-4 w-4" /> : <Save className="h-4 w-4" />}
            {saving === 'all' ? '保存中...' : savedTip ? '已全部保存' : '保存全部'}
          </button>
          <button onClick={() => navigate(`/project/${id}/canvas-free3`)} className="flex items-center gap-1.5 rounded-lg border border-input bg-card px-3.5 py-2 text-sm font-medium text-foreground hover:border-primary hover:text-primary">
            <Sparkles className="h-4 w-4" /> 去自由画布
          </button>
        </div>
      </div>

      {error && <div className="rounded-lg border border-red-500/30 bg-red-500/15 p-3 text-sm text-red-400">{error}</div>}

      {loading ? (
        <div className="rounded-xl border bg-card p-12 text-center text-sm text-muted-foreground">加载中...</div>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* 世界观（可折叠卡片） */}
          <div className="self-start rounded-xl border bg-card p-5 shadow-sm">
            <button
              onClick={() => toggleCollapse('world')}
              className="mb-1 flex w-full items-center justify-between gap-2"
              aria-expanded={!collapsed.world}
            >
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10"><Globe className="h-4 w-4 text-primary" /></div>
                <div className="text-left">
                  <h3 className="text-base font-semibold text-foreground">世界观</h3>
                  <p className="text-xs text-muted-foreground">时代 · 地理 · 社会规则 · 美术风格 · 色彩体系</p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">已填 {worldFilled}/5</span>
                <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${collapsed.world ? '-rotate-90' : ''}`} />
              </div>
            </button>
            {!collapsed.world && (
              <div className="mt-3 space-y-2">
                {field('时代背景', 'era', '如：近未来 2049·雨夜都市')}
                {field('地理环境', 'geography', '如：沿海巨型城市，旧城区与高空新区割裂')}
                {field('社会规则', 'socialRules', '如：财阀掌控秩序，地下情报交易盛行')}
                {field('美术风格', 'artStyle', '如：赛博朋克 × 新中式元素')}
                {field('色彩系统', 'colorSystem', '如：青橙对比，霓虹冷色主导')}
              </div>
            )}
          </div>

          {/* 风格圣经（可折叠卡片） */}
          <div className="self-start rounded-xl border bg-card p-5 shadow-sm">
            <button
              onClick={() => toggleCollapse('style')}
              className="mb-1 flex w-full items-center justify-between gap-2"
              aria-expanded={!collapsed.style}
            >
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10"><Palette className="h-4 w-4 text-primary" /></div>
                <div className="text-left">
                  <h3 className="text-base font-semibold text-foreground">风格圣经</h3>
                  <p className="text-xs text-muted-foreground">视觉 · 镜头 · 色彩 · 光影 · 运动 · 字幕风格</p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">已填 {styleFilled}/7</span>
                <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${collapsed.style ? '-rotate-90' : ''}`} />
              </div>
            </button>
            {!collapsed.style && (
              <div className="mt-3 space-y-2">
                {sfield('视觉风格', 'visualStyle', '如：电影感写实，轻微胶片颗粒')}
                {sfield('镜头语言', 'cameraLanguage', '如：手持跟拍 + 特写快切，情绪镜头缓推')}
                {sfield('色彩体系', 'colorPalette', '如：主色青蓝，点缀霓虹粉与暖橙')}
                {sfield('光影风格', 'lighting', '如：低调布光，霓虹轮廓光，夜戏为主')}
                {sfield('质感纹理', 'texture', '如：湿漉街面反射，金属与皮革质感')}
                {sfield('运动语言', 'motionLanguage', '如：快节奏剪切，关键瞬间升格慢动作')}
                {sfield('字幕风格', 'subtitleStyle', '如：底部居中白字黑边，14px')}
              </div>
            )}
          </div>

          {/* 底部提示 */}
          <div className="flex items-start gap-3 rounded-xl border border-primary/20 bg-primary/5 p-4 lg:col-span-2">
            <Camera className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <div className="text-sm text-foreground/80">
              <span className="font-semibold text-foreground">一致性提示：</span>
              完整的制作圣经（世界观 + 风格）会在生成分镜、关键帧、镜头视频时自动作为 Prompt 上下文，保证角色形象、场景结构、色彩光影在全部镜头中保持一致。
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ProjectBibleTab;
