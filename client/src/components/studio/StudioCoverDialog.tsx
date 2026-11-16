/**
 * 一幕·神剪 · 项目封面编辑器
 * -------------------------------------------------------------
 * 剪映式封面不是“选一张缩略图”，而是“底图 + 标题排版”。
 * 这里提供：
 *   · 底图：项目图片资产里任选；
 *   · 模板：海报压角 / 居中标题 / 底部色带 / 极简角标 / 纯图；
 *   · 可编辑标题、副标题、字号、颜色、对齐、纵向位置；
 *   · 保存时在本地 canvas 合成 720p 封面图，上传后回写项目 thumbnailUrl，
 *     同时把排版配置写进 project.metadata.cover，下次打开还能继续改。
 * 封面不进入时间线，也不会被误删。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Check,
  Image as ImageIcon,
  LayoutTemplate,
  Loader2,
  Palette,
  Type,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { listAssets, mediaUrl, uploadLocalFile } from '@client/src/api/assets';
import { getProject, updateProject } from '@client/src/api/projects';
import type { Asset, Project, ProjectCoverConfig } from '@shared/api.interface';
import { probeMediaOpenable } from '@client/src/lib/media-validate';
import { isImageUrl } from '@client/src/lib/media-kind';

const IMAGE_ASSET_TYPES = new Set(['image', 'start_frame', 'end_frame', 'frame', 'cover', 'keyframe']);

const TEMPLATES: { id: ProjectCoverConfig['template']; label: string; hint: string }[] = [
  { id: 'poster', label: '海报压角', hint: '左下大标题 + 副标题' },
  { id: 'center', label: '居中标题', hint: '居中主视觉，适合人物海报' },
  { id: 'band', label: '底部色带', hint: '底部深色带，标题更清晰' },
  { id: 'minimal', label: '极简角标', hint: '左上角小标题，留白更多' },
  { id: 'plain', label: '纯图无字', hint: '只保留底图' },
];

const DEFAULT_CONFIG = (title: string, imageUrl: string): ProjectCoverConfig => ({
  imageUrl,
  title: title || '未命名作品',
  subtitle: '一幕 · AI 精品短剧',
  template: 'poster',
  fontSize: 68,
  color: '#ffffff',
  align: 'left',
  position: 0.72,
  showSubtitle: true,
});

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

const wrapText = (ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] => {
  const lines: string[] = [];
  let line = '';
  for (const ch of Array.from(text)) {
    const next = line + ch;
    if (ctx.measureText(next).width > maxWidth && line) {
      lines.push(line);
      line = ch;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
};

const drawCover = (
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement | null,
  cfg: ProjectCoverConfig,
  w: number,
  h: number,
) => {
  ctx.clearRect(0, 0, w, h);
  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, '#1b1d21');
  bg.addColorStop(1, '#090a0c');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  if (img && img.naturalWidth > 0) {
    // object-fit: cover，人物主体不被拉伸
    const scale = Math.max(w / img.naturalWidth, h / img.naturalHeight);
    const dw = img.naturalWidth * scale;
    const dh = img.naturalHeight * scale;
    ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
  }

  if (cfg.template === 'plain') return;

  // 统一压暗，保证白字在亮画面上也能读
  const veil = ctx.createLinearGradient(0, 0, 0, h);
  veil.addColorStop(0, 'rgba(0,0,0,.16)');
  veil.addColorStop(0.55, 'rgba(0,0,0,.28)');
  veil.addColorStop(1, 'rgba(0,0,0,.82)');
  ctx.fillStyle = veil;
  ctx.fillRect(0, 0, w, h);

  const anchorY = clamp(cfg.position, 0.12, 0.9);
  if (cfg.template === 'band') {
    ctx.fillStyle = 'rgba(8,9,10,.72)';
    ctx.fillRect(0, h * 0.68, w, h * 0.32);
    ctx.fillStyle = '#ff403a';
    ctx.fillRect(w * 0.075, h * 0.68, w * 0.045, h * 0.005);
  }
  if (cfg.template === 'minimal') {
    ctx.fillStyle = 'rgba(8,9,10,.55)';
    ctx.fillRect(w * 0.06, h * 0.075, w * 0.45, h * 0.115);
    ctx.fillStyle = '#ff403a';
    ctx.fillRect(w * 0.06, h * 0.075, w * 0.012, h * 0.115);
  }

  const px = Math.max(22, cfg.fontSize * (w / 720));
  const subPx = Math.max(12, px * 0.38);
  const titleFont = `800 ${px}px "PingFang SC","Hiragino Sans GB","Noto Sans CJK SC","Microsoft YaHei",sans-serif`;
  const subFont = `500 ${subPx}px "PingFang SC","Hiragino Sans GB","Noto Sans CJK SC","Microsoft YaHei",sans-serif`;
  const maxW = w * (cfg.template === 'minimal' ? 0.52 : 0.82);
  const align = cfg.template === 'center' ? 'center' : cfg.align;
  const x = align === 'left' ? w * 0.08 : align === 'right' ? w * 0.92 : w * 0.5;
  const textAlign: CanvasTextAlign = align;

  ctx.textAlign = textAlign;
  ctx.textBaseline = 'top';
  ctx.font = titleFont;
  const titleLines = wrapText(ctx, cfg.title || '未命名作品', maxW);
  const lineH = px * 1.18;
  const subH = cfg.showSubtitle && cfg.subtitle ? subPx * 1.7 : 0;
  const totalH = titleLines.length * lineH + subH;
  const top = clamp(anchorY * h, h * 0.08, h - totalH - h * 0.06);

  if (cfg.template === 'center') {
    ctx.fillStyle = '#ff403a';
    ctx.fillRect(w * 0.5 - w * 0.055, top - px * 0.5, w * 0.11, Math.max(2, px * 0.025));
  }

  titleLines.forEach((line, i) => {
    const y = top + i * lineH;
    ctx.save();
    ctx.font = titleFont;
    ctx.fillStyle = 'rgba(0,0,0,.55)';
    ctx.fillText(line, x + px * 0.035, y + px * 0.045);
    ctx.strokeStyle = 'rgba(0,0,0,.5)';
    ctx.lineWidth = Math.max(2, px * 0.045);
    ctx.strokeText(line, x, y);
    ctx.fillStyle = cfg.color;
    ctx.fillText(line, x, y);
    ctx.restore();
  });

  if (cfg.showSubtitle && cfg.subtitle) {
    const y = top + titleLines.length * lineH + subPx * 0.25;
    ctx.font = subFont;
    ctx.fillStyle = 'rgba(255,255,255,.78)';
    ctx.fillText(cfg.subtitle, x, y);
  }

  if (cfg.template !== 'minimal') {
    ctx.font = `600 ${Math.max(9, subPx * 0.9)}px "PingFang SC","Noto Sans CJK SC",sans-serif`;
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(255,255,255,.55)';
    ctx.fillText('YIMU · 一幕', w * 0.92, h * 0.92);
  }
};

export const StudioCoverDialog = ({
  projectId,
  currentUrl,
  onClose,
  onSaved,
}: {
  projectId: string;
  currentUrl?: string | null;
  onClose: () => void;
  onSaved?: (url: string) => void;
}) => {
  const [project, setProject] = useState<Project | null>(null);
  const [items, setItems] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string>('');
  const [config, setConfig] = useState<ProjectCoverConfig>(DEFAULT_CONFIG('', ''));
  const [saving, setSaving] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [imgReady, setImgReady] = useState(false);

  const ratio = useMemo(() => {
    const a = project?.aspectRatio;
    if (a === '16:9') return { w: 960, h: 540, css: '16 / 9' };
    if (a === '1:1') return { w: 720, h: 720, css: '1 / 1' };
    return { w: 720, h: 1280, css: '9 / 16' };
  }, [project?.aspectRatio]);

  useEffect(() => {
    let alive = true;
    Promise.all([
      getProject(projectId),
      listAssets({ projectId, page: 1, pageSize: 100 }),
    ])
      .then(([p, res]) => {
        if (!alive) return;
        const seen = new Set<string>();
        const images = (res.items || []).filter((a) => {
          if (!a.fileUrl || a.mock) return false;
          if ((a.status || '').toLowerCase() !== 'ready') return false;
          const type = (a.assetType || '').toLowerCase();
          const image = IMAGE_ASSET_TYPES.has(type) || isImageUrl(mediaUrl(a));
          if (!image || seen.has(mediaUrl(a))) return false;
          seen.add(mediaUrl(a));
          return true;
        });
        setProject(p);
        setItems(images);
        const cover = p.metadata?.cover;
        const chosen = cover?.imageUrl || currentUrl || p.thumbnailUrl || mediaUrl(images[0]) || '';
        setSelected(chosen);
        setConfig(cover ? { ...cover, imageUrl: chosen } : DEFAULT_CONFIG(p.title, chosen));
      })
      .catch(() => toast.error('项目封面资产加载失败'))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [projectId, currentUrl]);

  useEffect(() => {
    if (!selected) {
      setImgReady(false);
      return;
    }
    const img = new window.Image();
    imgRef.current = img;
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      if (imgRef.current === img) setImgReady(true);
    };
    img.onerror = () => {
      if (imgRef.current === img) setImgReady(false);
    };
    img.src = selected;
  }, [selected]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = ratio.w;
    canvas.height = ratio.h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    drawCover(ctx, imgReady ? imgRef.current : null, config, ratio.w, ratio.h);
  }, [config, imgReady, ratio.h, ratio.w]);

  const choose = async (a: Asset) => {
    const url = mediaUrl(a);
    if (!url) return;
    const ok = await probeMediaOpenable(url, 'image', 5000).catch(() => false);
    if (!ok) {
      toast.error('这张图片无法打开，换一张试试');
      return;
    }
    setSelected(url);
    setConfig((c) => ({ ...c, imageUrl: url }));
    setPickerOpen(false);
  };

  const applyTemplate = (t: ProjectCoverConfig['template']) => {
    setConfig((c) => ({
      ...c,
      template: t,
      align: t === 'center' ? 'center' : t === 'minimal' ? 'left' : c.align,
      position: t === 'center' ? 0.42 : t === 'minimal' ? 0.1 : 0.72,
      fontSize: t === 'minimal' ? 42 : t === 'center' ? 76 : 68,
    }));
  };

  const save = async () => {
    const canvas = canvasRef.current;
    if (!canvas || !selected || saving) return;
    setSaving(true);
    try {
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
      if (!blob) throw new Error('封面合成失败');
      const uploaded = await uploadLocalFile(projectId, blob, `封面-${Date.now()}.jpg`);
      const assetUrl = uploaded.fileUrl || mediaUrl(uploaded.asset);
      if (!assetUrl) throw new Error('封面文件地址为空');
      const p = project ?? (await getProject(projectId));
      const nextConfig: ProjectCoverConfig = {
        ...config,
        imageUrl: selected,
        assetUrl,
        updatedAt: new Date().toISOString(),
      };
      await updateProject(projectId, {
        thumbnailUrl: assetUrl,
        metadata: {
          ...(p.metadata ?? {
            totalShots: 0,
            totalScenes: 0,
            totalCharacters: 0,
            estimatedCost: 0,
            estimatedTime: 0,
          }),
          cover: nextConfig,
        },
      });
      toast.success('封面已保存，项目卡片会同步显示', { duration: 1800 });
      window.dispatchEvent(new CustomEvent('yimu:project-updated', { detail: { projectId } }));
      onSaved?.(assetUrl);
      onClose();
    } catch (e) {
      toast.error(`封面保存失败：${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div className="imp-mask" onClick={onClose}>
      <div className="imp-modal cover-editor-modal" onClick={(e) => e.stopPropagation()}>
        <div className="imp-head">
          <div>
            <b>项目封面 · 神剪封面编辑</b>
            <small>底图 + 标题排版；封面不会进入时间线，保存后项目卡片同步显示</small>
          </div>
          <button type="button" className="imp-close" title="关闭" onClick={onClose}>
            <X size={15} />
          </button>
        </div>
        <div className="imp-body cover-editor-body">
          {loading ? (
            <div className="imp-empty"><Loader2 size={16} className="spin" /> 加载项目图片…</div>
          ) : items.length === 0 ? (
            <div className="imp-empty">
              <ImageIcon size={18} /> 项目里还没有可用图片；先在分镜生成首帧，或从素材导入图片
            </div>
          ) : (
            <div className="cover-editor-grid">
              <div className="cover-canvas-wrap" style={{ aspectRatio: ratio.css }}>
                <canvas ref={canvasRef} className="cover-canvas" />
                {!imgReady ? <span className="cover-canvas-tip">底图加载中/不可用</span> : null}
              </div>
              <div className="cover-side">
                <div className="cover-side-block">
                  <div className="cover-side-h"><LayoutTemplate size={13} /> 封面模式</div>
                  <div className="cover-modes">
                    {TEMPLATES.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        className={`cover-mode${config.template === t.id ? ' on' : ''}`}
                        title={t.hint}
                        onClick={() => applyTemplate(t.id)}
                      >
                        <b>{t.label}</b>
                        <small>{t.hint}</small>
                      </button>
                    ))}
                  </div>
                </div>

                <label className="cover-field">
                  <span><Type size={12} /> 主标题</span>
                  <input
                    value={config.title}
                    maxLength={32}
                    onChange={(e) => setConfig((c) => ({ ...c, title: e.target.value }))}
                  />
                </label>
                <label className="cover-field">
                  <span>副标题</span>
                  <input
                    value={config.subtitle ?? ''}
                    maxLength={40}
                    onChange={(e) => setConfig((c) => ({ ...c, subtitle: e.target.value }))}
                  />
                </label>
                <label className="cover-check">
                  <input
                    type="checkbox"
                    checked={config.showSubtitle}
                    onChange={(e) => setConfig((c) => ({ ...c, showSubtitle: e.target.checked }))}
                  />
                  显示副标题
                </label>

                <div className="cover-side-block">
                  <div className="cover-side-h"><Type size={13} /> 字号 {config.fontSize}</div>
                  <input
                    type="range"
                    min={36}
                    max={120}
                    step={2}
                    value={config.fontSize}
                    onChange={(e) => setConfig((c) => ({ ...c, fontSize: Number(e.target.value) }))}
                  />
                </div>

                <div className="cover-side-block">
                  <div className="cover-side-h"><Palette size={13} /> 文字颜色</div>
                  <div className="cover-colors">
                    {['#ffffff', '#ffe9c7', '#ffb3af', '#ff403a', '#c7f1ff'].map((color) => (
                      <button
                        key={color}
                        type="button"
                        className={`cover-color${config.color === color ? ' on' : ''}`}
                        style={{ background: color }}
                        title={color}
                        onClick={() => setConfig((c) => ({ ...c, color }))}
                      />
                    ))}
                    <input
                      type="color"
                      value={config.color}
                      title="自定义颜色"
                      onChange={(e) => setConfig((c) => ({ ...c, color: e.target.value }))}
                    />
                  </div>
                </div>

                <div className="cover-side-block">
                  <div className="cover-side-h">对齐 / 纵向位置</div>
                  <div className="cover-aligns">
                    {([['left', AlignLeft], ['center', AlignCenter], ['right', AlignRight]] as const).map(([v, Icon]) => (
                      <button
                        key={v}
                        type="button"
                        className={`cover-align${config.align === v ? ' on' : ''}`}
                        title={v === 'left' ? '左对齐' : v === 'center' ? '居中' : '右对齐'}
                        onClick={() => setConfig((c) => ({ ...c, align: v }))}
                      >
                        <Icon size={14} />
                      </button>
                    ))}
                    <input
                      type="range"
                      min={0.12}
                      max={0.9}
                      step={0.01}
                      value={config.position}
                      title="文字纵向位置"
                      onChange={(e) => setConfig((c) => ({ ...c, position: Number(e.target.value) }))}
                    />
                  </div>
                </div>

                <button type="button" className="cover-change" onClick={() => setPickerOpen((v) => !v)}>
                  <ImageIcon size={13} /> {pickerOpen ? '收起底图库' : '更换底图'}
                </button>
                {pickerOpen ? (
                  <div className="cover-strip">
                    {items.map((a) => {
                      const url = mediaUrl(a);
                      return (
                        <button
                          key={a.id}
                          type="button"
                          className={`cover-strip-item${url === selected ? ' on' : ''}`}
                          title={a.name}
                          onClick={() => void choose(a)}
                        >
                          <img src={url} alt="" loading="lazy" />
                          {url === selected ? <Check size={11} /> : null}
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            </div>
          )}
        </div>
        <div className="imp-foot">
          <span>封面只用于项目卡片 / 作品列表；成片导出仍以时间线为准</span>
          <div className="spacer" />
          <button type="button" className="imp-cancel" onClick={onClose}>取消</button>
          <button type="button" className="imp-primary" disabled={!selected || saving} onClick={() => void save()}>
            {saving ? <Loader2 size={13} className="spin" /> : <Check size={13} />}
            {saving ? '正在合成…' : '保存封面'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default StudioCoverDialog;
