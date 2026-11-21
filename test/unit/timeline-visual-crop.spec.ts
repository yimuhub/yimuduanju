/**
 * 源画面裁切（C1）纯函数单测
 * -------------------------------------------------------------
 * 覆盖：normalizeCrop 归一化（空值 / 全零 / 单边夹紧 / 两边合计回缩 / 非法输入）、
 *       buildCropFilterArgs（无裁切返回空串不追加 / 四边按源尺寸计算）、
 *       cropTransform（预览 transform 与导出同源同序）、
 *       cinematicCropPreset（2.35:1 电影感按画幅算上下裁切）。
 * 导出滤镜链里 crop 插在最前（源空间），单测锁住「与预览同一份数据」的换算底线。
 */
import {
  buildCropFilterArgs,
  cinematicCropPreset,
  CROP_EDGE_MAX,
  CROP_SUM_MAX,
  cropTransform,
  normalizeCrop,
} from '../../shared/timeline-visual';

describe('normalizeCrop', () => {
  it('空输入与全零返回 null（= 不裁，保持旧行为）', () => {
    expect(normalizeCrop(null)).toBeNull();
    expect(normalizeCrop(undefined)).toBeNull();
    expect(normalizeCrop({ left: 0, right: 0, top: 0, bottom: 0 })).toBeNull();
  });

  it('非法数值按 0 处理，正常值原样保留', () => {
    expect(normalizeCrop({ left: Number.NaN, right: 'x' as unknown as number, top: 0, bottom: 0 })).toBeNull();
    expect(normalizeCrop({ left: Number.NaN, right: 'x' as unknown as number, top: 0.1, bottom: 0 })).toEqual({
      left: 0,
      right: 0,
      top: 0.1,
      bottom: 0,
    });
    expect(normalizeCrop({ left: 0.1, right: 0, top: 0.05, bottom: 0 })).toEqual({
      left: 0.1,
      right: 0,
      top: 0.05,
      bottom: 0,
    });
  });

  it('单边夹紧到 0–0.45', () => {
    expect(CROP_EDGE_MAX).toBe(0.45);
    expect(normalizeCrop({ left: 0.6, right: -0.2, top: 0, bottom: 0 })).toEqual({
      left: 0.45,
      right: 0,
      top: 0,
      bottom: 0,
    });
  });

  it('两边合计超过 0.9 时按比例回缩且不超过合计上限', () => {
    expect(CROP_SUM_MAX).toBeLessThan(0.9);
    const capped = normalizeCrop({ left: 0.45, right: 0.45, top: 0, bottom: 0 });
    expect(capped).not.toBeNull();
    expect(capped!.left + capped!.right).toBeCloseTo(CROP_SUM_MAX, 6);
    // 居中意图保持：左右仍相等
    expect(capped!.left).toBeCloseTo(capped!.right, 6);
    // 不对称裁切同样按比例回缩，单边不超上限
    const lopsided = normalizeCrop({ left: 0.45, right: 0.44, top: 0, bottom: 0 })!;
    expect(lopsided.left + lopsided.right).toBeCloseTo(CROP_SUM_MAX, 6);
    expect(Math.max(lopsided.left, lopsided.right)).toBeLessThanOrEqual(CROP_EDGE_MAX);
  });

  it('上下合计独立回缩，不影响左右', () => {
    const v = normalizeCrop({ left: 0.1, right: 0, top: 0.45, bottom: 0.45 })!;
    expect(v.left).toBe(0.1);
    expect(v.top + v.bottom).toBeCloseTo(CROP_SUM_MAX, 6);
  });
});

describe('buildCropFilterArgs', () => {
  it('无裁切返回空串（调用方不追加滤镜）', () => {
    expect(buildCropFilterArgs(null)).toBe('');
    expect(buildCropFilterArgs(undefined)).toBe('');
    expect(buildCropFilterArgs({ left: 0, right: 0, top: 0, bottom: 0 })).toBe('');
  });

  it('按源尺寸四边计算：crop=iw*(1-l-r):ih*(1-t-b):iw*l:ih*t', () => {
    expect(buildCropFilterArgs({ left: 0.1, right: 0, top: 0, bottom: 0 })).toBe(
      'crop=iw*0.900:ih*1.000:iw*0.100:ih*0.000',
    );
    expect(buildCropFilterArgs({ left: 0, right: 0.2, top: 0.05, bottom: 0.05 })).toBe(
      'crop=iw*0.800:ih*0.900:iw*0.000:ih*0.050',
    );
    expect(buildCropFilterArgs({ left: 0.1, right: 0.1, top: 0.2, bottom: 0.2 })).toBe(
      'crop=iw*0.800:ih*0.600:iw*0.100:ih*0.200',
    );
  });

  it('超限输入先归一化再进滤镜（导出与预览同源）', () => {
    // 左右各 0.45 → 合计回缩到 0.89：宽 0.11，起点仍居中
    const args = buildCropFilterArgs({ left: 0.45, right: 0.45, top: 0, bottom: 0 });
    expect(args).toBe(`crop=iw*${(1 - CROP_SUM_MAX).toFixed(3)}:ih*1.000:iw*${(CROP_SUM_MAX / 2).toFixed(3)}:ih*0.000`);
  });
});

describe('cropTransform', () => {
  it('无裁切返回空串，调用方保留既有 transform', () => {
    expect(cropTransform(null)).toBe('');
    expect(cropTransform({ left: 0, right: 0, top: 0, bottom: 0 })).toBe('');
  });

  it('左右各裁 10%：横向放大 1/0.8，居中裁切不平移', () => {
    expect(cropTransform({ left: 0.1, right: 0.1, top: 0, bottom: 0 })).toBe(
      'scale(1.2500, 1.0000) translate(0.000%, 0.000%)',
    );
  });

  it('单边裁切：scale 补宽 + translate 把裁切区中心对回画幅中心', () => {
    // left=0.1：裁切区中心 (1+0.1-0)/2=0.55，需要左移 5% 元素宽
    expect(cropTransform({ left: 0.1, right: 0, top: 0, bottom: 0 })).toBe(
      'scale(1.1111, 1.0000) translate(-5.000%, 0.000%)',
    );
    // top=0.05, bottom=0.15：纵向中心 0.45，需下移 5% 元素高
    expect(cropTransform({ left: 0, right: 0, top: 0.05, bottom: 0.15 })).toBe(
      'scale(1.0000, 1.2500) translate(0.000%, 5.000%)',
    );
  });

  it('映射正确性：裁切区两端点经 transform 后恰好铺满 0–1（数值演算）', () => {
    const l = 0.1;
    const r = 0.05;
    const sx = 1 / (1 - l - r);
    const tx = ((r - l) / 2) * 100 / 100; // 平移（元素宽占比）
    // 源坐标 p 经 translate 再 scale（transform-origin 50%）映射：
    const map = (p: number) => 0.5 + (p + tx - 0.5) * sx;
    expect(map(l)).toBeCloseTo(0, 6);
    expect(map(1 - r)).toBeCloseTo(1, 6);
  });
});

describe('cinematicCropPreset', () => {
  it('9:16 竖屏：上下各裁约 38% 得到 2.35:1', () => {
    const v = cinematicCropPreset(1080, 1920)!;
    expect(v.left).toBe(0);
    expect(v.right).toBe(0);
    expect(v.top).toBeCloseTo(v.bottom, 6);
    // 裁后可视高度比 = 1080/2.35/1920（预设值量化到 0.1%，精度 2 位小数）
    expect(1 - v.top - v.bottom).toBeCloseTo(1080 / 2.35 / 1920, 2);
    expect(v.top).toBeLessThanOrEqual(CROP_EDGE_MAX);
  });

  it('16:9 横屏：上下各裁约 12.2%', () => {
    const v = cinematicCropPreset(1920, 1080)!;
    expect(1 - v.top - v.bottom).toBeCloseTo(1920 / 2.35 / 1080, 2);
  });

  it('画幅已比 2.35:1 更宽或入参非法时返回 null', () => {
    expect(cinematicCropPreset(2350, 1000)).toBeNull();
    expect(cinematicCropPreset(0, 1920)).toBeNull();
    expect(cinematicCropPreset(1080, 0)).toBeNull();
    expect(cinematicCropPreset(Number.NaN, 1920)).toBeNull();
  });
});
