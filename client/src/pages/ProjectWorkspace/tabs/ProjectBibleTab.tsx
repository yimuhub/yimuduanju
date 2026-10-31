import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Save, Globe, Palette, Camera, Sparkles, BookOpen } from 'lucide-react';
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
  const [saving, setSaving] = useState<'world' | 'style' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedTip, setSavedTip] = useState<null | 'world' | 'style'>(null);

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

  const saveWorld = async () => {
    if (!id) return;
    setSaving('world');
    try {
      await bible.updateWorldView(id, worldView);
      setSavedTip('world'); setTimeout(() => setSavedTip(null), 2000);
    } catch (err) { logger.error('save wv', String(err)); setError('保存世界观失败'); }
    finally { setSaving(null); }
  };

  const saveStyle = async () => {
    if (!id) return;
    setSaving('style');
    try {
      await bible.updateStyleBible(id, style);
      setSavedTip('style'); setTimeout(() => setSavedTip(null), 2000);
    } catch (err) { logger.error('save st', String(err)); setError('保存风格圣经失败'); }
    finally { setSaving(null); }
  };

  const field = (label: string, key: keyof WorldView) => (
    <div>
      <label className="text-sm font-medium text-foreground">{label}</label>
      <textarea
        value={worldView[key] || ''}
        onChange={(e) => setWorldView({ ...worldView, [key]: e.target.value })}
        rows={2}
        className="mt-1.5 w-full resize-none rounded-lg border border-input px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
        placeholder="填写..."
      />
    </div>
  );

  const sfield = (label: string, key: keyof StyleBible) => (
    <div>
      <label className="text-sm font-medium text-foreground">{label}</label>
      <textarea
        value={style[key] || ''}
        onChange={(e) => setStyle({ ...style, [key]: e.target.value })}
        rows={2}
        className="mt-1.5 w-full resize-none rounded-lg border border-input px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
        placeholder="填写..."
      />
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-foreground">制作圣经</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            世界观与风格定义，确保全片角色、场景、镜头的一致性
          </p>
        </div>
        <button onClick={() => navigate(`/project/${id}/canvas-free3`)} className="flex items-center gap-1.5 rounded-lg border border-input bg-card px-3.5 py-2 text-sm font-medium text-foreground hover:border-primary hover:text-primary">
          <Sparkles className="h-4 w-4" /> 去无限画布
        </button>
      </div>

      {error && <div className="rounded-lg border border-red-500/30 bg-red-500/15 p-3 text-sm text-red-400">{error}</div>}

      {loading ? (
        <div className="rounded-xl border bg-card p-12 text-center text-sm text-muted-foreground">加载中...</div>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* 世界观 */}
          <div className="rounded-xl border bg-card p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10"><Globe className="h-4 w-4 text-primary" /></div>
                <div>
                  <h3 className="text-base font-semibold text-foreground">世界观</h3>
                  <p className="text-xs text-muted-foreground">时代 · 地理 · 社会规则 · 美术风格 · 色彩体系</p>
                </div>
              </div>
              <button onClick={saveWorld} disabled={saving === 'world'} className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
                <Save className="h-3.5 w-3.5" /> {saving === 'world' ? '保存中...' : savedTip === 'world' ? '已保存' : '保存'}
              </button>
            </div>
            <div className="space-y-4">
              {field('时代背景', 'era')}
              {field('地理环境', 'geography')}
              {field('社会规则', 'socialRules')}
              {field('美术风格', 'artStyle')}
              {field('色彩系统', 'colorSystem')}
            </div>
          </div>

          {/* 风格圣经 */}
          <div className="rounded-xl border bg-card p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10"><Palette className="h-4 w-4 text-primary" /></div>
                <div>
                  <h3 className="text-base font-semibold text-foreground">风格圣经</h3>
                  <p className="text-xs text-muted-foreground">视觉 · 镜头 · 色彩 · 光影 · 运动 · 字幕风格</p>
                </div>
              </div>
              <button onClick={saveStyle} disabled={saving === 'style'} className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
                <Save className="h-3.5 w-3.5" /> {saving === 'style' ? '保存中...' : savedTip === 'style' ? '已保存' : '保存'}
              </button>
            </div>
            <div className="space-y-4">
              {sfield('视觉风格', 'visualStyle')}
              {sfield('镜头语言', 'cameraLanguage')}
              {sfield('色彩体系', 'colorPalette')}
              {sfield('光影风格', 'lighting')}
              {sfield('质感纹理', 'texture')}
              {sfield('运动语言', 'motionLanguage')}
              {sfield('字幕风格', 'subtitleStyle')}
            </div>
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
