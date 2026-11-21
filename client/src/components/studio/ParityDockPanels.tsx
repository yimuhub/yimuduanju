/**
 * 同构版 Dockview 面板。
 *
 * 每个面板只渲染既有业务组件，不复制 EDL、不另存状态。
 * 面板标题与图标统一，Tab 条由 Dockview 负责拖拽/换位/滚动。
 */
import { type ComponentType, type ReactNode } from 'react';
import {
  Clock3,
  FolderOpen,
  LayoutGrid,
  Maximize2,
  MonitorPlay,
  SlidersHorizontal,
  Eye,
} from 'lucide-react';
import type { IDockviewPanelHeaderProps, IDockviewPanelProps } from 'dockview-react';
import { ParityLibrary } from './ParityLibrary';
import { ShenJianStage } from './ShenJianStage';
import { ShenJianInspectorParity } from './ShenJianInspectorParity';
import { ShenJianShotPool } from './ShenJianShotPool';
import { ParityTimeline } from './ParityTimeline';
import { useParityEditorUI } from './ParityEditorContext';

export type DockPanelId = 'library' | 'preview' | 'timeline' | 'inspector' | 'pool';

const PANEL_META: Record<string, { label: string; icon: ComponentType<{ size?: number; className?: string }> }> = {
  library: { label: '素材', icon: FolderOpen },
  preview: { label: '播放器', icon: MonitorPlay },
  timeline: { label: '时间线', icon: Clock3 },
  inspector: { label: '检查器', icon: SlidersHorizontal },
  pool: { label: '素材池', icon: LayoutGrid },
};

/** Dockview 默认 Tab 只有文字；这里补 16px 图标，和 OpenMotion 的面板条一致。 */
export const ParityDockTab = ({ api }: IDockviewPanelHeaderProps) => {
  const meta = PANEL_META[api.id] ?? { label: api.title ?? api.id, icon: LayoutGrid };
  const Icon = meta.icon;
  return (
    <span className="parity-dock-tab">
      <Icon size={14} />
      <span>{meta.label}</span>
     </span>
  );
};

const PanelShell = ({ children, className = '' }: { children: ReactNode; className?: string }) => (
  <div className={`parity-dock-panel ${className}`}>{children}</div>
);

export const ParityLibraryPanel = (_props: IDockviewPanelProps) => {
  const ui = useParityEditorUI();
  return (
    <PanelShell className="is-library">
      <ParityLibrary onImport={ui.openImport} />
    </PanelShell>
  );
};

export const ParityPreviewPanel = (_props: IDockviewPanelProps) => {
  const ui = useParityEditorUI();
  const shellRef = ui.stageRef;
  return (
    <PanelShell className="is-preview">
      <div className="parity-stage-shell" ref={shellRef}>
        <div className="parity-stage-head">
          <div className="parity-stage-title">
            <b>播放器</b>
            <span>·</span>
            <span>时间线 01</span>
            <i>{ui.ratio} 预览</i>
          </div>
          <div className="parity-stage-actions">
            <button
              type="button"
              className={ui.safe ? 'on' : ''}
              data-tip="安全框：检查字幕与主体是否出画"
              onClick={() => ui.setSafe((v) => !v)}
            >
              <Eye size={15} />
            </button>
            <button
              type="button"
              data-tip="全屏预览 (F)"
              onClick={() => {
                if (document.fullscreenElement) void document.exitFullscreen();
                else void shellRef.current?.requestFullscreen?.();
              }}
            >
              <Maximize2 size={15} />
            </button>
          </div>
        </div>
        <ShenJianStage ratio={ui.ratio} safe={ui.safe} onToggleSafe={() => ui.setSafe((v) => !v)} grade={ui.grade} />
      </div>
    </PanelShell>
  );
};

export const ParityTimelinePanel = (_props: IDockviewPanelProps) => {
  const ui = useParityEditorUI();
  return (
    <PanelShell className="is-timeline">
      <ParityTimeline snapOn={ui.snapOn} setSnapOn={ui.setSnapOn} />
    </PanelShell>
  );
};

export const ParityInspectorPanel = (_props: IDockviewPanelProps) => {
  const ui = useParityEditorUI();
  return (
    <PanelShell className="is-inspector">
      <ShenJianInspectorParity grade={ui.grade} setGrade={ui.setGrade} />
    </PanelShell>
  );
};

export const ParityPoolPanel = (_props: IDockviewPanelProps) => {
  const ui = useParityEditorUI();
  return (
    <PanelShell className="is-pool">
      <ShenJianShotPool onBack={() => { ui.setRightTab('inspector'); ui.focusPanel('inspector'); }} />
    </PanelShell>
  );
};
