/**
 * 全功能编辑 · 顶部项目工具条
 * -------------------------------------------------------------
 * 对应剪映式工作台的顶栏：项目身份 + 保存状态 + 撤销/重做 + 对比/导出入口。
 * 撤销/重做走 window 事件委托给 StudioTimeline（EDL 撤销栈的唯一持有者），
 * 不在这里另存一份状态，避免两套历史。
 */
import { useNavigate } from 'react-router-dom';
import { HelpCircle, ImageIcon, Redo2, Share2, Undo2 } from 'lucide-react';
import { useStudio } from './StudioShell';
import { APP_VERSION } from '@client/src/lib/version';
import { exportJianyingDraft } from '@client/src/api/timeline';
import { toast } from 'sonner';

export const StudioProTopBar = () => {
  const { data, projectId, setProEdit } = useStudio();
  const navigate = useNavigate();

  const fire = (name: string) => window.dispatchEvent(new CustomEvent(name));
  /** 离开剪辑工作台去别的页面前先退出全功能编辑，否则编辑壳会把目标页挡住 */
  const go = (path: string) => {
    setProEdit(false);
    navigate(path);
  };

  return (
    <div className="pro-topbar">
      <div className="pro-crumb">
        <b>{data.project?.title ?? '未命名项目'}</b>
        <span>/ 神剪</span>
      </div>
      <span className="pro-save" title={`一幕·神剪 v${APP_VERSION}`}>
        <i />
        自动保存 · v{APP_VERSION}
      </span>

      <div className="pro-top-actions">
        <button
          type="button"
          className="pro-icon"
          title="撤销 (⌘Z)"
          onClick={() => fire('yimu:timeline-undo')}
        >
          <Undo2 size={15} />
        </button>
        <button
          type="button"
          className="pro-icon"
          title="重做 (⌘⇧Z)"
          onClick={() => fire('yimu:timeline-redo')}
        >
          <Redo2 size={15} />
        </button>
        <button
          type="button"
          className="pro-icon"
          title="时间线快捷键"
          onClick={() => fire('yimu:timeline-shortcuts')}
        >
          <HelpCircle size={15} />
        </button>
        <button
          type="button"
          className="pro-btn"
          title="打开分镜页，对照镜头与时间线"
          onClick={() => projectId && go(`/project/${projectId}/storyboard`)}
        >
          <Share2 size={13} />
          对比
        </button>
        <button
          type="button"
          className="pro-btn"
          title="神剪封面编辑：底图 + 标题排版，不进入时间线"
          onClick={() => fire('yimu:open-cover')}
        >
          <ImageIcon size={13} />
          封面
        </button>
        <button
          type="button"
          className="pro-btn"
          title="导出剪映草稿 ZIP：draft_content.json + Resources，可放进剪映草稿目录继续精修"
          onClick={async () => {
            if (!projectId) return;
            try {
              const blob = await exportJianyingDraft(projectId);
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `${data.project?.title ?? '神剪草稿'}-剪映草稿.zip`;
              a.click();
              setTimeout(() => URL.revokeObjectURL(url), 30_000);
              toast.success('剪映草稿已导出：解压后放进剪映草稿目录', { duration: 3200 });
            } catch (err) {
              toast.error((err as Error)?.message ?? '剪映草稿导出失败', { duration: 4200 });
            }
          }}
        >
          剪映草稿
        </button>
        <button
          type="button"
          className="pro-btn primary"
          title="打开导出页，导出当前时间线成片"
          onClick={() => projectId && go(`/project/${projectId}/export`)}
        >
          导出成片
        </button>
      </div>
    </div>
  );
};

export default StudioProTopBar;
