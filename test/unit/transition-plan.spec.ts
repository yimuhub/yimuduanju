/**
 * 转场（叠化）规划回归测试
 * ------------------------------------------------------------------
 * 「叠化」在导出侧必须满足四条硬约束，否则成片会错位或渲染失败：
 *   1. 成片总时长 = 各段 span 之和 —— 叠化只能吃掉自己的尾巴，绝不能缩短时间轴，
 *      否则所有按 timelineStart 混音的音频整体前移，口型对不上；
 *   2. 叠化出场的段要多渲染 d 秒尾巴（handle），否则 xfade 的 offset+duration
 *      超出第一段长度，ffmpeg 直接不干；
 *   3. 叠化时长不能超过任一侧 span 的一半（整段都在混 = 两段都看不见），
 *      且短于 0.1s 退化为硬切；
 *   4. 硬切接缝必须走 concat 滤镜，与 xfade 串在同一条 filter 链里，
 *      混切时时间戳不能漂。
 *
 * 这里只用纯函数断言，不跑 ffmpeg——滤镜字符串单独验格式。
 */
import {
  buildTransitionFilter,
  clampXfadeDuration,
  planTransitions,
  XFADE_MAX,
  XFADE_MIN,
} from '../../server/modules/timeline/transition-plan';

const cut = { type: 'none' as const, duration: 0 };
const xfade = (duration: number) => ({ type: 'crossfade' as const, duration });

describe('clampXfadeDuration', () => {
  it('正常时长原样保留', () => {
    expect(clampXfadeDuration(0.5, 4, 4)).toBe(0.5);
  });

  it('超过任一侧一半 → 夹到一半（4s 片段最多混 2s）', () => {
    expect(clampXfadeDuration(3, 4, 1)).toBe(0.5);
  });

  it('上限 3 秒', () => {
    expect(clampXfadeDuration(10, 40, 40)).toBe(XFADE_MAX);
  });

  it('短于下限 → 0，退化成硬切', () => {
    expect(clampXfadeDuration(0.02, 4, 4)).toBe(0);
    expect(clampXfadeDuration(0, 4, 4)).toBe(0);
  });

  it('非数值输入按 0 处理（脏数据不能把成片渲染搞崩）', () => {
    expect(clampXfadeDuration(Number.NaN, 4, 4)).toBe(0);
  });

  it('下限边界：正好 0.1s 仍然保留', () => {
    expect(clampXfadeDuration(XFADE_MIN, 4, 4)).toBe(XFADE_MIN);
  });
});

describe('planTransitions · 总时长', () => {
  it('全硬切：总时长 = 各段之和，没有尾巴', () => {
    const plan = planTransitions([{ span: 3, transition: cut }, { span: 2 }, { span: 4 }]);
    expect(plan.total).toBe(9);
    expect(plan.renderSpan).toEqual([3, 2, 4]);
    expect(plan.hasCrossfade).toBe(false);
    expect(plan.joins.every((j) => j.kind === 'cut')).toBe(true);
  });

  it('有叠化也不缩短总时长（音频不错位的前提）', () => {
    const plan = planTransitions([
      { span: 3, transition: xfade(0.6) },
      { span: 2, transition: xfade(0.4) },
      { span: 4 },
    ]);
    expect(plan.total).toBe(9);
    expect(plan.hasCrossfade).toBe(true);
  });

  it('叠化出场的段渲染时长 = span + d（+编码余量）', () => {
    const plan = planTransitions([{ span: 3, transition: xfade(0.6) }, { span: 2 }]);
    expect(plan.renderSpan[0]).toBeGreaterThanOrEqual(3.6);
    expect(plan.renderSpan[0]).toBeLessThan(3.7);
    // 末段没有出场转场，不该有尾巴
    expect(plan.renderSpan[1]).toBe(2);
  });

  it('单段片段：没有接缝，也没有叠化', () => {
    const plan = planTransitions([{ span: 5 }]);
    expect(plan.total).toBe(5);
    expect(plan.joins).toEqual([]);
    expect(plan.hasCrossfade).toBe(false);
  });

  it('空输入不炸', () => {
    const plan = planTransitions([]);
    expect(plan.total).toBe(0);
    expect(plan.renderSpan).toEqual([]);
  });
});

describe('planTransitions · 接缝', () => {
  it('offset 按「成片里的位置」累加，与首尾相接一致', () => {
    const plan = planTransitions([{ span: 3 }, { span: 2 }, { span: 4 }]);
    expect(plan.joins.map((j) => j.offset)).toEqual([3, 5]);
  });

  it('叠化的 offset 仍是接缝位置，不是提前 d', () => {
    const plan = planTransitions([{ span: 3, transition: xfade(0.5) }, { span: 2 }]);
    expect(plan.joins[0]).toEqual({ kind: 'xfade', offset: 3, duration: 0.5 });
  });

  it('混切：硬切 + 叠化 + 硬切 各自成段，位置不错位', () => {
    const plan = planTransitions([
      { span: 4, transition: cut },
      { span: 3, transition: xfade(0.5) },
      { span: 2, transition: cut },
      { span: 5 },
    ]);
    expect(plan.joins.map((j) => j.kind)).toEqual(['cut', 'xfade', 'cut']);
    expect(plan.joins.map((j) => j.offset)).toEqual([4, 7, 9]);
    expect(plan.total).toBe(14);
  });

  it('转场时长被夹紧后仍按夹紧值规划', () => {
    const plan = planTransitions([{ span: 1, transition: xfade(2) }, { span: 1 }]);
    expect(plan.joins[0]).toEqual({ kind: 'xfade', offset: 1, duration: 0.5 });
  });
});

describe('buildTransitionFilter', () => {
  it('每个输入都先统一时间基（否则 xfade 报 timebase 不匹配）', () => {
    const plan = planTransitions([{ span: 1 }, { span: 1 }]);
    const f = buildTransitionFilter(plan, 24);
    expect(f).toContain('[0:v]settb=1/24,setpts=PTS-STARTPTS[in0]');
    expect(f).toContain('[1:v]settb=1/24,setpts=PTS-STARTPTS[in1]');
  });

  it('全硬切用 concat 滤镜，且每接一次都重新 settb（concat 输出时间基是 1/1000000）', () => {
    const plan = planTransitions([{ span: 1 }, { span: 1 }, { span: 1 }]);
    const f = buildTransitionFilter(plan, 24);
    expect(f).toBe(
      '[0:v]settb=1/24,setpts=PTS-STARTPTS[in0];' +
        '[1:v]settb=1/24,setpts=PTS-STARTPTS[in1];' +
        '[2:v]settb=1/24,setpts=PTS-STARTPTS[in2];' +
        '[in0][in1]concat=n=2:v=1:a=0[r0];' +
        '[r0]settb=1/24[j0];' +
        '[j0][in2]concat=n=2:v=1:a=0[r1];' +
        '[r1]settb=1/24[vout]',
    );
    expect(f).not.toContain('xfade');
  });

  it('叠化用 xfade，并带上 duration/offset', () => {
    const plan = planTransitions([{ span: 3, transition: xfade(0.5) }, { span: 2 }]);
    expect(buildTransitionFilter(plan, 24)).toBe(
      '[0:v]settb=1/24,setpts=PTS-STARTPTS[in0];' +
        '[1:v]settb=1/24,setpts=PTS-STARTPTS[in1];' +
        '[in0][in1]xfade=transition=fade:duration=0.5:offset=3[r0];' +
        '[r0]settb=1/24[vout]',
    );
  });

  it('三段混合：中间叠化、末尾硬切，链式连到 [vout]', () => {
    const plan = planTransitions([
      { span: 2, transition: cut },
      { span: 3, transition: xfade(0.4) },
      { span: 2 },
    ]);
    const f = buildTransitionFilter(plan, 24);
    expect(f).toContain('[in0][in1]concat=n=2:v=1:a=0[r0];[r0]settb=1/24[j0]');
    expect(f).toContain('[j0][in2]xfade=transition=fade:duration=0.4:offset=5[r1]');
    expect(f.endsWith('[r1]settb=1/24[vout]')).toBe(true);
  });

  it('fps 非整数/脏值走兜底，不生成非法时间基', () => {
    const plan = planTransitions([{ span: 1 }, { span: 1 }]);
    expect(buildTransitionFilter(plan, Number.NaN)).toContain('settb=1/24');
    expect(buildTransitionFilter(plan, 29.97)).toContain('settb=1/30');
  });
});
