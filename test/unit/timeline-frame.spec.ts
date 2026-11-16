/**
 * 时间线帧级工具单测
 * -------------------------------------------------------------
 * 覆盖：帧量化 / 时间码解析 / 吸附（左右边缘、阈值、落帧）/ 波形重采样 / 轨道静音独奏。
 * 这些是「显示帧、编辑也落帧」和「磁吸对齐」的正确性底线，改之前先过这里。
 */
import {
  collectSnapTargets,
  formatTimecode,
  isTrackAudible,
  isTrackLocked,
  parseTimecode,
  quantizeToFrame,
  resamplePeaks,
  slicePeaks,
  snapClipStart,
  snapPoint,
} from '../../client/src/lib/timeline-frame';

const FPS = 24;

describe('帧量化', () => {
  it('四舍五入到最近帧', () => {
    expect(quantizeToFrame(1, 24)).toBe(1);
    expect(quantizeToFrame(1.0 + 1 / 48, 24)).toBeCloseTo(1 + 1 / 24, 6);
    expect(quantizeToFrame(1 / 100, 24)).toBe(0);
  });

  it('结果始终是帧的整数倍，不产生浮点噪音', () => {
    for (let i = 0; i < 100; i += 1) {
      const t = quantizeToFrame(i * 0.0371, 24);
      expect(Math.abs(t * 24 - Math.round(t * 24))).toBeLessThan(1e-9);
    }
  });
});

describe('时间码', () => {
  it('格式化到 00:MM:SS:FF', () => {
    expect(formatTimecode(0, 24)).toBe('00:00:00:00');
    expect(formatTimecode(12.5, 24)).toBe('00:00:12:12');
    expect(formatTimecode(61.25, 24)).toBe('00:01:01:06');
  });

  it('解析 秒 / 分:秒 / 分:秒:帧 / 时:分:秒:帧', () => {
    expect(parseTimecode('12.5', FPS)).toBeCloseTo(12.5, 6);
    expect(parseTimecode('1:02', FPS)).toBeCloseTo(62, 6);
    expect(parseTimecode('00:12:08', FPS)).toBeCloseTo(12 + 8 / 24, 6);
    expect(parseTimecode('00:01:02:12', FPS)).toBeCloseTo(62 + 12 / 24, 6);
  });

  it('非法输入返回 null', () => {
    expect(parseTimecode('', FPS)).toBeNull();
    expect(parseTimecode('abc', FPS)).toBeNull();
    expect(parseTimecode('1:2:3:4:5', FPS)).toBeNull();
  });

  it('格式化后再解析可回到原帧', () => {
    const sec = 62 + 12 / 24;
    expect(parseTimecode(formatTimecode(sec, FPS), FPS)).toBeCloseTo(sec, 5);
  });
});

describe('吸附', () => {
  const targets = collectSnapTargets({
    clips: [
      { id: 'a', start: 2, end: 4 },
      { id: 'b', start: 6, end: 8 },
    ],
    playhead: 5,
    markers: [10],
  });

  it('候选点包含起点、播放头、片段首尾、标记', () => {
    const ts = targets.map((t) => t.t);
    expect(ts).toEqual(expect.arrayContaining([0, 5, 2, 4, 6, 8, 10]));
  });

  it('左边缘在阈值内吸附到片段起点', () => {
    const r = snapClipStart(2.1, 1, targets, 8 / 17, FPS);
    expect(r.start).toBeCloseTo(2, 5);
    expect(r.snapAt).toBeCloseTo(2, 5);
  });

  it('右边缘吸附到下一片段起点', () => {
    // 只用片段 b（6–8）与远端播放头，避免与「播放头 5」产生同距离歧义
    const t2 = collectSnapTargets({
      clips: [{ id: 'b', start: 6, end: 8 }],
      playhead: 100,
    });
    // 片段长度 1，起点 4.95 → 右边缘 5.95，距 6 只有 0.05
    const r = snapClipStart(4.95, 1, t2, 8 / 17, FPS);
    expect(r.start + 1).toBeCloseTo(6, 5);
    expect(r.snapAt).toBeCloseTo(6, 5);
  });

  it('超出阈值不吸附，但仍落帧', () => {
    // 左 2.8 距最近目标 2 / 4 均超过阈值；右 3.3 距 4 也超过
    const r = snapClipStart(2.8, 0.5, targets, 8 / 17, FPS);
    expect(r.snapAt).toBeNull();
    expect(Math.abs(r.start * FPS - Math.round(r.start * FPS))).toBeLessThan(1e-9);
  });

  it('不会吸附到负时间', () => {
    const r = snapClipStart(-0.5, 1, targets, 8 / 17, FPS);
    expect(r.start).toBeGreaterThanOrEqual(0);
  });

  it('修剪边缘点吸附并落帧', () => {
    const r = snapPoint(4.04, targets, 8 / 17, FPS);
    expect(r.t).toBeCloseTo(4, 5);
    expect(r.kind).toBe('clip-end');
  });
});

describe('波形重采样', () => {
  it('缩小取窗口峰值', () => {
    const peaks = [0, 1, 0, 0.5, 0, 0.2, 0, 0.9];
    const out = resamplePeaks(peaks, 4);
    expect(out).toHaveLength(4);
    expect(out[0]).toBeCloseTo(1, 6);
    expect(out[1]).toBeCloseTo(0.5, 6);
    expect(out[3]).toBeCloseTo(0.9, 6);
  });

  it('放大保持长度与端点', () => {
    const out = resamplePeaks([0, 1], 5);
    expect(out).toHaveLength(5);
    expect(out[0]).toBeCloseTo(0, 6);
    expect(out[4]).toBeCloseTo(1, 6);
  });

  it('空输入返回空', () => {
    expect(resamplePeaks([], 10)).toEqual([]);
    expect(resamplePeaks([0.5], 3)).toEqual([0.5, 0.5, 0.5]);
  });

  it('按片段入出点切片后点数正确', () => {
    const peaks = new Array(100).fill(0).map((_, i) => i / 100);
    const out = slicePeaks(peaks, 10, 2, 4, 32);
    expect(out).toHaveLength(32);
    // 区间 [2,4] 对应原数组 [20,40]，峰值应落在 0.2–0.4 之间
    expect(Math.max(...out)).toBeGreaterThan(0.15);
    expect(Math.max(...out)).toBeLessThan(0.45);
  });
});

describe('轨道静音 / 独奏 / 锁定', () => {
  it('无轨道属性时默认发声', () => {
    expect(isTrackAudible('audio', 0, [])).toBe(true);
  });

  it('静音轨不发声', () => {
    expect(isTrackAudible('audio', 1, [{ track: 'audio', lane: 1, muted: true }])).toBe(false);
  });

  it('独奏优先：只播 solo 轨', () => {
    const metas = [
      { track: 'audio', lane: 0, muted: true },
      { track: 'audio', lane: 1, solo: true },
    ];
    expect(isTrackAudible('audio', 0, metas)).toBe(false);
    expect(isTrackAudible('audio', 1, metas)).toBe(true);
  });

  it('锁定轨识别', () => {
    expect(isTrackLocked('video', 0, [{ track: 'video', lane: 0, locked: true }])).toBe(true);
    expect(isTrackLocked('video', 1, [{ track: 'video', lane: 0, locked: true }])).toBe(false);
  });
});
