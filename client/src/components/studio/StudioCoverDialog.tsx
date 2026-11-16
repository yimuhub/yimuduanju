/**
 * 项目封面（剪映式「封面」）
 * -------------------------------------------------------------
 * 封面只认项目图片资产：首帧 / 生成图 / 本地上传图。
 * 选中后 PATCH 项目 thumbnailUrl，项目卡片与工作台立刻复用这张图。
 * 不把封面塞进时间线，避免用户误删封面片段后封面消失。
 */
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Image as ImageIcon, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import { listAssets, mediaUrl } from '@client/src/api/assets';
import { updateProject } from '@client/src/api/projects';
import type { Asset } from '@shared/api.interface';
import { probeMediaOpenable } from '@client/src/lib/media-validate';
import { isImageUrl } from '@client/src/lib/media-kind';

const IMAGE_ASSET_TYPES = new Set(['image', 'start_frame', 'end_frame', 'frame', 'cover', 'keyframe']);

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
  const [items, setItems] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    listAssets({ projectId, page: 1, pageSize: 100 })
      .then((res) => {
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
        setItems(images);
      })
      .catch(() => toast.error('项目图片资产加载失败'))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [projectId]);

  const choose = async (a: Asset) => {
    const url = mediaUrl(a);
    if (!url) return;
    setSavingId(a.id);
    try {
      const ok = await probeMediaOpenable(url, 'image', 5000);
      if (!ok) {
        toast.error('这张图片无法打开，换一张试试');
        return;
      }
      await updateProject(projectId, { thumbnailUrl: url });
      toast.success('封面已更新，项目卡片会同步显示', { duration: 1800 });
      window.dispatchEvent(new CustomEvent('yimu:project-updated', { detail: { projectId } }));
      onSaved?.(url);
      onClose();
    } catch (e) {
      toast.error(`封面保存失败：${(e as Error).message}`);
    } finally {
      setSavingId(null);
    }
  };

  return createPortal(
    <div className="imp-mask" onClick={onClose}>
      <div className="imp-modal cover-modal" onClick={(e) => e.stopPropagation()}>
        <div className="imp-head">
          <div>
            <b>设置项目封面</b>
            <small>从项目图片资产中选一张；封面不会进入时间线，也不会被误删</small>
          </div>
          <button type="button" className="imp-close" title="关闭" onClick={onClose}>
            <X size={15} />
          </button>
        </div>
        <div className="imp-body">
          {loading ? (
            <div className="imp-empty"><Loader2 size={16} className="spin" /> 加载项目图片…</div>
          ) : items.length === 0 ? (
            <div className="imp-empty">
              <ImageIcon size={18} /> 项目里还没有可用图片；先在分镜生成首帧，或从素材导入图片
            </div>
          ) : (
            <div className="imp-grid cover-grid">
              {items.map((a) => {
                const url = mediaUrl(a);
                const active = currentUrl && currentUrl === url;
                return (
                  <button
                    key={a.id}
                    type="button"
                    className={`cover-card${active ? ' on' : ''}`}
                    title={`使用「${a.name || '未命名图片'}」作为封面`}
                    disabled={savingId === a.id}
                    onClick={() => void choose(a)}
                  >
                    <span className="cover-thumb">
                      <img src={url} alt="" loading="lazy" />
                      {active ? <b><Check size={12} />  当前封面</b> : null}
                      {savingId === a.id ? <i><Loader2 size={16} className="spin" /></i> : null}
                    </span>
                    <span className="cover-name">{a.name || '未命名图片'}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <div className="imp-foot">
          <span>封面只用于项目卡片/作品列表；成片导出仍以时间线为准</span>
          <div className="spacer" />
          <button type="button" className="imp-cancel" onClick={onClose}>取消</button>
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default StudioCoverDialog;
