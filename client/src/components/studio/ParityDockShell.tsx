/**
 * 一幕编辑器 Dockview 壳。
 *
 * 默认布局与 OpenMotion 一致：左侧素材、中间预览 + 时间线、右侧检查器。
 * 所有面板可拖拽换位、调整大小、折叠；布局按项目持久化。
 * 业务组件只挂在面板内容里，EDL 仍由 WorkbenchContext / EdlContext 唯一持有。
 */
import { useEffect, useRef, type MutableRefObject } from 'react';
import { FolderOpen, SlidersHorizontal } from 'lucide-react';
import {
  DockviewReact,
  type DockviewApi,
  type DockviewReadyEvent,
} from 'dockview-react';
import 'dockview-react/dist/styles/dockview.css';
import {
  ParityDockTab,
  ParityInspectorPanel,
  ParityLibraryPanel,
  ParityPoolPanel,
  ParityPreviewPanel,
  ParityTimelinePanel,
} from './ParityDockPanels';
import { useParityEditorUI } from './ParityEditorContext';

const COMPONENTS = {
  library: ParityLibraryPanel,
  preview: ParityPreviewPanel,
  timeline: ParityTimelinePanel,
  inspector: ParityInspectorPanel,
  pool: ParityPoolPanel,
};

const TAB_COMPONENTS = { parityTab: ParityDockTab };

const DEFAULT_WIDTHS = { left: 372, right: 430, timeline: 360 };
const STORAGE_PREFIX = 'yimu:parity:dock:';

interface Props {
  projectId: string | null;
  apiRef: MutableRefObject<DockviewApi | null>;
  onReady?: (api: DockviewApi) => void;
}

function createDefaultLayout(api: DockviewApi) {
  const library = api.addPanel({
    id: 'library',
    component: 'library',
    tabComponent: 'parityTab',
    title: '素材',
    initialWidth: DEFAULT_WIDTHS.left,
  });
  const preview = api.addPanel({
    id: 'preview',
    component: 'preview',
    tabComponent: 'parityTab',
    title: '播放器',
    position: { direction: 'right' },
  });
  const timeline = api.addPanel({
    id: 'timeline',
    component: 'timeline',
    tabComponent: 'parityTab',
    title: '时间线',
    position: { referencePanel: 'preview', direction: 'below' },
    initialHeight: DEFAULT_WIDTHS.timeline,
  });
  const inspector = api.addPanel({
    id: 'inspector',
    component: 'inspector',
    tabComponent: 'parityTab',
    title: '检查器',
    position: { referencePanel: 'preview', direction: 'right' },
    initialWidth: DEFAULT_WIDTHS.right,
  });
  api.addPanel({
    id: 'pool',
    component: 'pool',
    tabComponent: 'parityTab',
    title: '素材池',
    position: { referencePanel: 'inspector', direction: 'within' },
    inactive: true,
  });
  api.getPanel('preview')?.api.setActive();
  // addPanel 的 initialWidth 对根组不生效；布局完成后再按预览优先的默认比例夹一次。
  requestAnimationFrame(() => {
    try {
      library.group.api.setSize({ width: DEFAULT_WIDTHS.left });
      inspector.group.api.setSize({ width: DEFAULT_WIDTHS.right });
      timeline.group.api.setSize({ height: DEFAULT_WIDTHS.timeline });
      preview.group.api.setActive?.();
    } catch {
      // 布局尚未完成时忽略，Dockview 会保留可用尺寸。
    }
  });
}

export const ParityDockShell = ({ projectId, apiRef, onReady }: Props) => {
  const ui = useParityEditorUI();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const saveTimer = useRef<number | null>(null);
  const uiRef = useRef(ui);
  uiRef.current = ui;

  useEffect(() => {
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
  }, []);

  // 预览优先：窗口先收检查器，再收素材栏；402px 以下两边都收，时间线优先保留高度。
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let raf = 0;
    let settle = 0;
    const widthOf = (cls: string) =>
      (root.querySelector(`.parity-dock-panel.${cls}`)?.closest('.dv-groupview') as HTMLElement | null)
        ?.getBoundingClientRect().width ?? 0;
    const fit = () => {
      raf = 0;
      const total = root.clientWidth;
      if (!total) return;
      // 极矮窗口优先保预览：时间线从 360 收到 128，只留工具条与当前轨道。
      if (root.clientHeight < 460) {
        const tl = apiRef.current?.getPanel('timeline');
        try {
          tl?.group.api.setConstraints({ minimumHeight: 96, maximumHeight: 180 });
          tl?.group.api.setSize({ height: 128 });
        } catch { /* 布局未就绪 */ }
      }
      const left = widthOf('is-library');
      const right = widthOf('is-inspector');
      if (total - left - right < 560 && right > 60) {
        uiRef.current.toggleSide('right');
        return;
      }
      if (total - left < 520 && left > 60) uiRef.current.toggleSide('left');
      // 折叠动画结束后再夹一次：Dockview 会按 sashes 重新分配，个别宽度会回弹到 80+。
      if (settle) window.clearTimeout(settle);
      settle = window.setTimeout(() => {
        const api = apiRef.current;
        for (const side of ['left', 'right'] as const) {
          if (!uiRef.current.collapseState[side]) continue;
          const id = side === 'left' ? 'library' : 'inspector';
          try { api?.getPanel(id)?.group.api.setSize({ width: 48 }); } catch { /* 布局未就绪 */ }
        }
      }, 240);
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(fit);
    };
    const ro = new ResizeObserver(schedule);
    ro.observe(root);
    schedule();
    return () => {
      ro.disconnect();
      if (raf) cancelAnimationFrame(raf);
      if (settle) window.clearTimeout(settle);
    };
  }, []);

  const handleReady = (event: DockviewReadyEvent) => {
    const api = event.api;
    apiRef.current = api;
    const key = `${STORAGE_PREFIX}${projectId ?? 'global'}`;
    let restored = false;
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        const parsed = JSON.parse(raw);
        api.fromJSON(parsed);
        restored = ['library', 'preview', 'timeline', 'inspector'].every((id) => Boolean(api.getPanel(id)));
      }
    } catch {
      // 布局损坏只回默认，不影响工程数据。
      restored = false;
    }
    if (!restored) {
      api.clear();
      createDefaultLayout(api);
    }
    onReady?.(api);

    api.onDidLayoutChange(() => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => {
        try {
          localStorage.setItem(key, JSON.stringify(api.toJSON()));
        } catch {
          // localStorage 不可用时只在本次会话内保留布局。
        }
      }, 350);
    });
  };

  return (
    <div
      className={`parity-dock-wrap${ui.collapseState.left ? ' is-left-collapsed' : ''}${ui.collapseState.right ? ' is-right-collapsed' : ''}`}
      ref={rootRef}
    >
      {ui.collapseState.left ? (
        <button type="button" className="dock-collapse-rail left" aria-label="展开素材面板" onClick={() => ui.toggleSide('left')}>
          <FolderOpen size={16} />
          <span>素材</span>
        </button>
      ) : null}
      {ui.collapseState.right ? (
        <button type="button" className="dock-collapse-rail right" aria-label="展开检查器" onClick={() => ui.toggleSide('right')}>
          <SlidersHorizontal size={16} />
          <span>检查器</span>
        </button>
      ) : null}
      <DockviewReact
        className="parity-dock dv-theme"
        components={COMPONENTS}
        tabComponents={TAB_COMPONENTS}
        defaultTabComponent={ParityDockTab}
        onReady={handleReady}
      />
    </div>
  );
};

