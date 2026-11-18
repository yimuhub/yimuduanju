export type ShenJianPaneLayout = {
  libraryWidth: number;
  inspectorWidth: number;
  timelineHeight: number | null;
};

export const DEFAULT_PANE_LAYOUT: ShenJianPaneLayout = {
  libraryWidth: 286,
  inspectorWidth: 318,
  timelineHeight: null,
};

export const MIN_LIBRARY_WIDTH = 180;
export const MIN_INSPECTOR_WIDTH = 220;
export const MIN_STAGE_WIDTH = 260;
export const MIN_TIMELINE_HEIGHT = 120;

export const clampPaneValue = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/** 把持久化布局按当前视口夹紧，避免桌面尺寸在窄屏/矮屏把工作区压成 0。 */
export function normalizePaneLayout(
  raw: Partial<ShenJianPaneLayout> | null | undefined,
  viewportWidth = 1440,
  viewportHeight = 900,
): ShenJianPaneLayout {
  const lib = typeof raw?.libraryWidth === 'number' && Number.isFinite(raw.libraryWidth) ? raw.libraryWidth : DEFAULT_PANE_LAYOUT.libraryWidth;
  const ins = typeof raw?.inspectorWidth === 'number' && Number.isFinite(raw.inspectorWidth) ? raw.inspectorWidth : DEFAULT_PANE_LAYOUT.inspectorWidth;
  const maxLib = Math.max(MIN_LIBRARY_WIDTH, viewportWidth - ins - MIN_STAGE_WIDTH);
  const maxIns = Math.max(MIN_INSPECTOR_WIDTH, viewportWidth - lib - MIN_STAGE_WIDTH);
  const maxTl = Math.max(MIN_TIMELINE_HEIGHT, viewportHeight - 150);
  return {
    libraryWidth: clampPaneValue(lib, MIN_LIBRARY_WIDTH, maxLib),
    inspectorWidth: clampPaneValue(ins, MIN_INSPECTOR_WIDTH, maxIns),
    timelineHeight:
      typeof raw?.timelineHeight === 'number' && Number.isFinite(raw.timelineHeight)
        ? clampPaneValue(raw.timelineHeight, MIN_TIMELINE_HEIGHT, maxTl)
        : null,
  };
}
