/**
 * 神剪三分栏尺寸回归：桌面尺寸必须在窄屏/矮屏被夹紧，
 * 不能因为 localStorage 里存着 700px 侧栏或 460px 时间线就把工作区压成 0。
 */
import { DEFAULT_PANE_LAYOUT, normalizePaneLayout } from '@shared/pane-layout';

describe('normalizePaneLayout', () => {
  it('无持久化记录时使用默认 286 / 318 / 自动时间线', () => {
    expect(normalizePaneLayout(null, 1440, 900)).toEqual(DEFAULT_PANE_LAYOUT);
  });

  it('桌面尺寸在 464×322 下被夹到可用范围', () => {
    const out = normalizePaneLayout({ libraryWidth: 700, inspectorWidth: 600, timelineHeight: 460 }, 464, 322);
    expect(out.libraryWidth).toBe(180);
    expect(out.inspectorWidth).toBe(220);
    expect(out.timelineHeight).toBe(172);
  });

  it('宽屏下允许放大，但不能挤掉舞台最小宽度', () => {
    const out = normalizePaneLayout({ libraryWidth: 700, inspectorWidth: 600, timelineHeight: 460 }, 1200, 900);
    expect(out.libraryWidth).toBe(340);
    expect(out.inspectorWidth).toBe(240);
    expect(out.timelineHeight).toBe(460);
  });

  it('未拖过时间线时保持 null，让 CSS clamp 决定高度', () => {
    expect(normalizePaneLayout({ libraryWidth: 320, inspectorWidth: 300 }, 1440, 900).timelineHeight).toBeNull();
  });

  it('非法字段回落到默认值，不产生 NaN', () => {
    const out = normalizePaneLayout({ libraryWidth: Number.NaN, inspectorWidth: -10 } as never, 1440, 900);
    expect(out.libraryWidth).toBe(DEFAULT_PANE_LAYOUT.libraryWidth);
    expect(out.inspectorWidth).toBe(220);
    expect(Number.isFinite(out.libraryWidth)).toBe(true);
  });
});
