import {
  buildZoompanExpressions,
  expandEasedKeyframes,
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

describe('关键帧缓动（ease）', () => {
  it('ease-in：前半程慢（in=t²）', () => {
    const frames = [
      { time: 0, scale: 1, easing: 'ease-in' as const },
      { time: 2, scale: 2 },
    ];
    // t=1s → p=0.25 → 1 + 1×0.25
    expect(sampleVideoTransform(frames, 1).scale).toBeCloseTo(1.25, 6);
    expect(sampleVideoTransform(frames, 0.5).scale).toBeCloseTo(1 + 0.25 * 0.25, 6);
  });

  it('ease-out：前半程快（out=1-(1-t)²）', () => {
    const frames = [
      { time: 0, scale: 1, easing: 'ease-out' as const },
      { time: 2, scale: 2 },
    ];
    expect(sampleVideoTransform(frames, 1).scale).toBeCloseTo(1.75, 6);
  });

  it('ease-inout：中点对称（inout=t²(3-2t)）', () => {
    const frames = [
      { time: 0, scale: 1, easing: 'ease-inout' as const },
      { time: 2, scale: 2 },
    ];
    expect(sampleVideoTransform(frames, 1).scale).toBeCloseTo(1.5, 6);
    expect(sampleVideoTransform(frames, 0.5).scale).toBeCloseTo(1 + 0.15625, 6);
    expect(sampleVideoTransform(frames, 1.5).scale).toBeCloseTo(1 + (1 - 0.15625), 6);
  });

  it('缓动属于「此关键帧→下一关键帧」段：后一帧的 easing 不影响前一段', () => {
    const frames = [
      { time: 0, scale: 1 },
      { time: 2, scale: 2, easing: 'ease-in' as const },
    ];
    // 0→2 段仍线性（末帧 easing 只作用于它自己之后的段，本例没有下一段）
    expect(sampleVideoTransform(frames, 1).scale).toBeCloseTo(1.5, 6);
  });

  it('normalize 接受 ease-inout，未知值回落 linear', () => {
    const out = normalizeVideoKeyframes([
      { time: 0, scale: 1, easing: 'ease-inout' },
      { time: 1, scale: 2, easing: 'bogus' as never },
    ]);
    expect(out[0].easing).toBe('ease-inout');
    expect(out[1].easing).toBe('linear');
  });
});

describe('expandEasedKeyframes（导出线性子步拆分）', () => {
  it('linear 段不拆不膨胀', () => {
    const frames = [
      { time: 0, scale: 1 },
      { time: 2, scale: 2 },
    ];
    expect(expandEasedKeyframes(frames, 24)).toHaveLength(2);
  });

  it('eased 段拆出 12 子步（11 个内部点），端点与关键帧时刻保持', () => {
    const frames = [
      { time: 0, scale: 1, easing: 'ease-inout' as const },
      { time: 2, scale: 2 },
    ];
    const out = expandEasedKeyframes(frames, 24);
    expect(out).toHaveLength(13); // 首尾 + 11 个内部点 = 12 段
    expect(out[0]).toMatchObject({ time: 0, scale: 1 });
    expect(out[out.length - 1]).toMatchObject({ time: 2, scale: 2 });
    // 内部点全部是 linear、落在帧上且严格递增（不吞掉关键帧端点）
    for (let i = 1; i < out.length - 1; i += 1) {
      expect(out[i].easing).toBe('linear');
      expect(out[i].time).toBeGreaterThan(out[i - 1].time);
      expect(out[i].time * 24).toBeCloseTo(Math.round(out[i].time * 24), 6);
    }
    // 内部点采样值与预览插值一致（同一 sampleVideoTransform）
    expect(out[6].scale).toBeCloseTo(1.5, 6); // 中点 t=1s
  });

  it('跨度过短时子步塌缩：不足一帧的段不产生内部点', () => {
    const frames = [
      { time: 0, scale: 1, easing: 'ease-in' as const },
      { time: 0.02, scale: 2 }, // 0.48 帧：所有子步取整后都在第 0 帧
    ];
    expect(expandEasedKeyframes(frames, 24)).toHaveLength(2);
  });

  it('多个 eased 段各自拆分，linear 段不受影响', () => {
    const frames = [
      { time: 0, scale: 1, easing: 'ease-out' as const },
      { time: 1, scale: 1.5 },
      { time: 2, scale: 2 },
    ];
    const out = expandEasedKeyframes(frames, 24);
    // 第一段 11 个内部点，第二段 linear 不拆：首帧 + 11 点 + 中间帧 + 末帧 = 14
    expect(out).toHaveLength(14);
    expect(out.filter((f) => f.time >= 1 && f.time <= 2)).toHaveLength(2);
  });

  it('导出表达式把 eased 段拆成 12 个 if 分段（zoompan 线性近似）', () => {
    const eased = buildZoompanExpressions(
      [
        { time: 0, scale: 1, easing: 'ease-inout' },
        { time: 2, scale: 2 },
      ],
      24,
      4,
    );
    const linear = buildZoompanExpressions(
      [
        { time: 0, scale: 1 },
        { time: 2, scale: 2 },
      ],
      24,
      4,
    );
    expect(eased.z.split('if(lte(on').length - 1).toBe(12);
    expect(linear.z.split('if(lte(on').length - 1).toBe(1);
    // 端点不变：末段仍落在 1.9993（末帧前的最后一个子步）→ 最后一帧到 2
    expect(eased.z).toContain(',2)');
  });
});
