import {
  buildZoompanExpressions,
  normalizeVideoKeyframes,
  removeVideoKeyframe,
  sampleVideoTransform,
  upsertVideoKeyframe,
} from '../../shared/timeline-keyframes';

describe('timeline video keyframes', () => {
  it('无关键帧时返回默认运镜', () => {
    expect(sampleVideoTransform(null, 1)).toEqual({ scale: 1, x: 0, y: 0, rotate: 0 });
  });

  it('按时间线性插值缩放与平移', () => {
    const frames = [
      { time: 0, scale: 1, x: 0 },
      { time: 2, scale: 2, x: 0.5 },
    ];
    expect(sampleVideoTransform(frames, 1)).toMatchObject({ scale: 1.5, x: 0.25 });
    expect(sampleVideoTransform(frames, 2)).toMatchObject({ scale: 2, x: 0.5 });
  });

  it('首尾之外保持端点值', () => {
    const frames = [
      { time: 1, scale: 1.2 },
      { time: 3, scale: 1.6 },
    ];
    expect(sampleVideoTransform(frames, 0).scale).toBe(1.2);
    expect(sampleVideoTransform(frames, 9).scale).toBe(1.6);
  });

  it('同一时间只保留最后一个关键帧', () => {
    const out = normalizeVideoKeyframes([
      { time: 1, scale: 1 },
      { time: 1, scale: 2 },
      { time: 0, scale: 0.9 },
    ]);
    expect(out).toHaveLength(2);
    expect(out[1].scale).toBe(2);
  });

  it('插入与删除关键帧', () => {
    let frames = upsertVideoKeyframe([], 1, { scale: 1.2 });
    frames = upsertVideoKeyframe(frames, 2, { x: -0.3 });
    expect(frames).toHaveLength(2);
    frames = removeVideoKeyframe(frames, 1);
    expect(frames).toHaveLength(1);
  });

  it('ffmpeg 表达式按输出帧分段', () => {
    const expr = buildZoompanExpressions(
      [
        { time: 0, scale: 1 },
        { time: 2, scale: 1.4 },
      ],
      24,
      4,
    );
    expect(expr.hasKeyframes).toBe(true);
    expect(expr.z).toContain('if(lte(on,48)');
    expect(expr.z).toContain('1+(0.0083)*(on-0)');
    expect(expr.x).toContain('iw-iw/zoom');
  });
});
