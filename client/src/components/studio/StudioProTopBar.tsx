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
        <span>/ 剪辑</span>
      </div>
      <span className="pro-save" title={`当前版本 v${APP_VERSION}`}>
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
          title="设置项目封面（从项目图片素材里选一张，不进入时间线）"
          onClick={() => fire('yimu:open-cover')}
        >
          <ImageIcon size={13} />
          封面
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
