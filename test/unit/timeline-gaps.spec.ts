/**
 * 时间线空隙闭合单测
 * -------------------------------------------------------------
 * 钉住「右键空白轨区 → 闭合此空隙 / 闭合全部空隙」的纯函数语义：
 * 空隙求解带 epsilon 容差（浮点漂移不造发丝空隙）、闭合只平移空隙之后的
 * 片段、收拢保留首个片段起点（前导留黑不吞）。改 lib 之前先过这里。
 */
import {
  resolveCloseAllShifts,
  resolveCloseGapShifts,
  resolveGapAt,
  resolveGapIntervals,
  trackHasGaps,
  type GapClip,
} from '../../client/src/lib/timeline-gaps';

const clip = (id: string, start: number, duration: number, locked = false): GapClip => ({
  id,
  start,
  duration,
  locked,
});

describe('resolveGapAt（指针时刻的空隙）', () => {
  it('点在两段之间的空隙：返回左右边缘与右侧全部片段', () => {
    const clips = [clip('a', 0, 4), clip('b', 6, 2), clip('c', 10, 2)];
    const gap = resolveGapAt(clips, 5);
    expect(gap).not.toBeNull();
    expect(gap?.gapStart).toBe(4);
    expect(gap?.gapEnd).toBe(6);
    expect(gap?.followingIds).toEqual(['b', 'c']);
  });

  it('点在片段上：不是空隙', () => {
    const clips = [clip('a', 0, 4), clip('b', 6, 2)];
    expect(resolveGapAt(clips, 2)).toBeNull();
    // 半开区间：start + duration 那一刻已出片段
    expect(resolveGapAt(clips, 4)).not.toBeNull();
  });

  it('右侧没有片段：没有可闭合的东西', () => {
    const clips = [clip('a', 0, 4)];
    expect(resolveGapAt(clips, 5)).toBeNull();
  });

  it('点在首个片段之前：前导空隙也能闭合（gapStart = 0）', () => {
    const clips = [clip('a', 2, 3)];
    const gap = resolveGapAt(clips, 1);
    expect(gap?.gapStart).toBe(0);
    expect(gap?.gapEnd).toBe(2);
    expect(gap?.followingIds).toEqual(['a']);
  });

  it('浮点漂移造出的发丝缝隙不算空隙', () => {
    // OpenMotion 同款例子：2.7 + 8.4 的浮点和 = 11.100000000000001，
    // 与下一片段起点 11.1 只差 1e-15，epsilon 相邻 = 首尾相接
    const clips = [clip('a', 2.7, 8.4), clip('b', 11.1, 2.7)];
    expect(resolveGapAt(clips, 11.1)).toBeNull();
    // 两条片段之间没有缝隙；前导 [0, 2.7] 是真实留黑，仍会被列出
    expect(resolveGapIntervals(clips)).toEqual([{ start: 0, end: 2.7 }]);
    expect(trackHasGaps(clips)).toBe(false);
  });

  it('空轨没有空隙', () => {
    expect(resolveGapAt([], 3)).toBeNull();
  });
});

describe('resolveCloseGapShifts（闭合一条空隙）', () => {
  it('只平移空隙之后的片段，宽度 = 空隙时长', () => {
    const clips = [clip('a', 0, 4), clip('b', 6, 2), clip('c', 10, 2)];
    const gap = resolveGapAt(clips, 5)!;
    const shifts = resolveCloseGapShifts(clips, gap);
    expect(shifts).toEqual([
      { id: 'b', newStart: 4 },
      { id: 'c', newStart: 8 },
    ]);
  });

  it('闭合前导空隙：所有片段整体左移', () => {
    const clips = [clip('a', 2, 3), clip('b', 6, 1)];
    const gap = resolveGapAt(clips, 1)!;
    const shifts = resolveCloseGapShifts(clips, gap);
    expect(shifts).toEqual([
      { id: 'a', newStart: 0 },
      { id: 'b', newStart: 4 },
    ]);
  });

  it('毫秒精度：新起点经 round3', () => {
    const clips = [clip('a', 0, 2.3333), clip('b', 2.3336, 1)];
    const gap = resolveGapAt(clips, 2.33345)!;
    const shifts = resolveCloseGapShifts(clips, gap);
    expect(shifts[0]).toEqual({ id: 'b', newStart: 2.3333 });
  });
});

describe('resolveCloseAllShifts / trackHasGaps（收拢整行）', () => {
  it('保留首个片段起点，其后首尾相接', () => {
    const clips = [clip('a', 2, 3), clip('b', 7, 2), clip('c', 9, 1)];
    const shifts = resolveCloseAllShifts(clips);
    expect(shifts).toEqual([
      { id: 'b', newStart: 5 },
      { id: 'c', newStart: 7 },
    ]);
    expect(trackHasGaps(clips)).toBe(true);
  });

  it('已经首尾相接的行没有可收拢的空隙', () => {
    const clips = [clip('a', 1, 3), clip('b', 4, 2)];
    expect(resolveCloseAllShifts(clips)).toEqual([]);
    expect(trackHasGaps(clips)).toBe(false);
  });

  it('重叠片段按起点顺序串行排布（与 OpenMotion 同策略）', () => {
    const clips = [clip('a', 0, 4), clip('b', 2, 2)];
    const shifts = resolveCloseAllShifts(clips);
    expect(shifts).toEqual([{ id: 'b', newStart: 4 }]);
  });

  it('空轨返回空计划', () => {
    expect(resolveCloseAllShifts([])).toEqual([]);
  });
});

describe('resolveGapIntervals（描述当前空隙）', () => {
  it('左到右列出全部空隙（含前导）', () => {
    const clips = [clip('a', 2, 3), clip('b', 7, 2)];
    expect(resolveGapIntervals(clips)).toEqual([
      { start: 0, end: 2 },
      { start: 5, end: 7 },
    ]);
  });

  it('重叠不产生负区间', () => {
    const clips = [clip('a', 0, 4), clip('b', 2, 2), clip('c', 9, 1)];
    expect(resolveGapIntervals(clips)).toEqual([{ start: 4, end: 9 }]);
  });
});
