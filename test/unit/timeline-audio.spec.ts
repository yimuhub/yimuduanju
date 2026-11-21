/**
 * 音量包络 / 人声避让 纯函数单测
 * -------------------------------------------------------------
 * 覆盖：包络归一化（帧量化/去重/夹紧）、volumeAt 线性插值、
 *       避让包络生成（0.25 压低、0.15s 淡入、0.3s 淡出、端点截断）、
 *       导出表达式构建（与预览同一插值语义）。
 * 这些是「预览听得到的曲线 = 导出渲染的曲线」的正确性底线。
 */
import {
  buildVolumeAutomationExpr,
  normalizeVolumePoints,
  volumeAt,
} from '../../shared/timeline-audio-expr';
import {
  buildDuckEnvelope,
  clipGainAt,
  collectVoiceRegions,
  DUCK_LEVEL,
  isVoiceClip,
  type VoiceRegion,
} from '../../client/src/lib/timeline-audio';

const FPS = 24;

describe('normalizeVolumePoints', () => {
  it('帧量化、升序、v 夹紧 0–2', () => {
    const out = normalizeVolumePoints(
      [
        { t: 2.5, v: 5 },
        { t: 0.01, v: -1 },
        { t: 1, v: 1.5 },
      ],
      10,
      FPS,
    );
    expect(out.map((p) => p.t)).toEqual([0, 1, 2.5]);
    expect(out[0].v).toBe(0);
    expect(out[1].v).toBe(1.5);
    expect(out[2].v).toBe(2);
    // 全部落在帧上
    for (const p of out) expect(Math.abs(p.t * FPS - Math.round(p.t * FPS))).toBeLessThan(1e-9);
  });

  it('超出片段时长的点夹紧到端点，同一帧只留一个点（取更低值）', () => {
    const out = normalizeVolumePoints(
      [
        { t: 4.9, v: 1 },
        { t: 9.99, v: 0.5 },
        { t: 10.4, v: 1.2 },
        { t: 20, v: 1 },
      ],
      10,
      FPS,
    );
    expect(out).toHaveLength(2);
    expect(out[1].t).toBeLessThanOrEqual(10);
    expect(out[1].v).toBe(0.5);
  });

  it('过滤非法值，空输入返回空数组', () => {
    expect(normalizeVolumePoints(null, 10, FPS)).toEqual([]);
    expect(
      normalizeVolumePoints(
        [{ t: Number.NaN, v: 1 }, { t: 1, v: Number.NaN }] as never,
        10,
        FPS,
      ),
    ).toEqual([]);
  });
});

describe('volumeAt', () => {
  it('两点之间线性插值', () => {
    const pts = [
      { t: 0, v: 1 },
      { t: 4, v: 0.5 },
    ];
    expect(volumeAt(pts, 1)).toBeCloseTo(0.875, 9);
    expect(volumeAt(pts, 4)).toBeCloseTo(0.5, 9);
  });

  it('首点之前保持首点值，末点之后保持末点值', () => {
    const pts = [
      { t: 2, v: 0.3 },
      { t: 5, v: 1.2 },
    ];
    expect(volumeAt(pts, 0)).toBe(0.3);
    expect(volumeAt(pts, 99)).toBe(1.2);
  });

  it('无包络时音量为 1（不改原声）', () => {
    expect(volumeAt(null, 3)).toBe(1);
    expect(volumeAt([], 3)).toBe(1);
  });
});

describe('isVoiceClip / collectVoiceRegions', () => {
  const base = {
    id: 'a1',
    timelineStart: 0,
    inPoint: 0,
    outPoint: 4,
    speed: 1,
    enabled: true,
  };

  it('对白轨（lane 0）与「♪ 人声」标记算人声，配乐轨不算', () => {
    expect(isVoiceClip({ ...base, track: 'audio', lane: 0, text: '' })).toBe(true);
    expect(isVoiceClip({ ...base, track: 'audio', lane: 0, text: '♪ 人声 · 对白' })).toBe(true);
    expect(isVoiceClip({ ...base, track: 'audio', lane: 1, text: 'BGM 轻快' })).toBe(false);
    // 配乐轨但文本带人声关键词：尊重用户的命名语义
    expect(isVoiceClip({ ...base, track: 'audio', lane: 1, text: '旁白朗读' })).toBe(true);
    expect(isVoiceClip({ ...base, track: 'video', lane: 0, text: '' })).toBe(false);
  });

  it('收集人声区间并合并相邻区间，跳过停用片段', () => {
    const clips = [
      { ...base, track: 'audio' as const, lane: 0, text: '对白 A' }, // 0–4s
      { ...base, track: 'audio' as const, lane: 0, text: '对白 B', timelineStart: 4.2 }, // 4.2–8.2s（间隙 0.2 < 0.45 → 合并）
      { ...base, track: 'audio' as const, lane: 1, text: 'BGM', timelineStart: 0, outPoint: 20 },
      { ...base, track: 'audio' as const, lane: 0, text: '停用配音', timelineStart: 10, enabled: false },
    ];
    const regions = collectVoiceRegions(clips);
    expect(regions).toEqual([{ start: 0, end: 8.2 }]);
  });
});

describe('buildDuckEnvelope', () => {
  const regions: VoiceRegion[] = [{ start: 5, end: 7 }];

  it('人声区间内压到 0.25，起 0.15s 淡入、终 0.3s 淡出', () => {
    const pts = buildDuckEnvelope({ clipStart: 0, span: 10, voiceRegions: regions, fps: FPS });
    expect(pts).not.toBeNull();
    expect(volumeAt(pts, 4)).toBe(1);
    expect(volumeAt(pts, 4.8)).toBe(1); // 淡入起点之前保持 1
    expect(volumeAt(pts, 4.925)).toBeGreaterThan(DUCK_LEVEL); // 淡入中段
    expect(volumeAt(pts, 4.925)).toBeLessThan(1);
    expect(volumeAt(pts, 5)).toBe(DUCK_LEVEL);
    expect(volumeAt(pts, 6.5)).toBe(DUCK_LEVEL); // 平台区
    expect(volumeAt(pts, 7.15)).toBeGreaterThan(DUCK_LEVEL); // 淡出中段
    expect(volumeAt(pts, 7.15)).toBeLessThan(1);
    expect(volumeAt(pts, 7.4)).toBe(1); // 淡出结束
  });

  it('包络点全部帧量化且落在片段内', () => {
    const pts = buildDuckEnvelope({ clipStart: 0, span: 10, voiceRegions: regions, fps: FPS });
    for (const p of pts ?? []) {
      expect(Math.abs(p.t * FPS - Math.round(p.t * FPS))).toBeLessThan(1e-9);
      expect(p.t).toBeGreaterThanOrEqual(0);
      expect(p.t).toBeLessThanOrEqual(10);
    }
  });

  it('人声从片段 0 秒开始时，淡入沿斜率截断在端点', () => {
    const pts = buildDuckEnvelope({
      clipStart: 4,
      span: 10,
      voiceRegions: [{ start: 3.8, end: 6 }],
      fps: FPS,
    });
    expect(pts).not.toBeNull();
    // 人声在片段开始前就活跃：t=0 直接压到 0.25
    expect(volumeAt(pts, 0)).toBe(DUCK_LEVEL);
    expect(volumeAt(pts, 1)).toBe(DUCK_LEVEL);
    // 淡出在片段内完整呈现
    expect(volumeAt(pts, 6.3)).toBe(1);
  });

  it('人声略晚于片段开头时，淡入截断处取斜率中间值', () => {
    const pts = buildDuckEnvelope({
      clipStart: 0,
      span: 10,
      voiceRegions: [{ start: 0.05, end: 2 }],
      fps: FPS,
    });
    expect(pts).not.toBeNull();
    // 淡入本应从 -0.10s 开始：t=0 已走过 2/3，v ≈ 0.5
    expect(volumeAt(pts, 0)).toBeCloseTo(0.5, 6);
    expect(volumeAt(pts, 0.05)).toBe(DUCK_LEVEL);
  });

  it('人声晚于片段结束 / 完全无重叠时返回 null', () => {
    expect(
      buildDuckEnvelope({ clipStart: 0, span: 4, voiceRegions: [{ start: 10, end: 12 }], fps: FPS }),
    ).toBeNull();
    expect(buildDuckEnvelope({ clipStart: 0, span: 4, voiceRegions: [], fps: FPS })).toBeNull();
  });
});

describe('buildVolumeAutomationExpr（导出端）', () => {
  it('两点包络生成逐段线性 if(lt(t,…)) 表达式，并折叠 clip.volume', () => {
    const expr = buildVolumeAutomationExpr(
      [
        { t: 0, v: 1 },
        { t: 4, v: 0.5 },
      ],
      0.8,
    );
    expect(expr).toContain('if(lt(t,4)');
    expect(expr).toContain('0.8+(-0.1)*(t-0)'); // 斜率 = (0.5-1)*0.8 / 4 = -0.1 → 从 0.8 降到 0.4
    expect(expr).toContain('0.4'); // 末段保持值 = 0.5*0.8
  });

  it('单点包络退化为常数', () => {
    const expr = buildVolumeAutomationExpr([{ t: 1, v: 0.5 }], 1);
    expect(expr).toBe('(0.5)');
  });

  it('首点之前保持首点值（补 t=0 基准，不线性外推）', () => {
    const expr = buildVolumeAutomationExpr(
      [
        { t: 2, v: 0.5 },
        { t: 4, v: 1 },
      ],
      1,
    );
    // 合成 t=0 基准后：0–2s 保持 0.5，2–4s 以 0.25/s 上升到 1
    expect(expr).toContain('0.5+(0)*(t-0)');
    expect(expr).toContain('0.5+(0.25)*(t-2)');
    expect(expr).toContain('if(lt(t,4)');
  });

  it('空包络返回 null（回退常数 volume 滤镜）', () => {
    expect(buildVolumeAutomationExpr(null, 1)).toBeNull();
    expect(buildVolumeAutomationExpr([], 1)).toBeNull();
  });
});

describe('clipGainAt（预览取值）', () => {
  it('包络 × clip.volume，0–2 夹紧', () => {
    const clip = {
      volume: 1.5,
      volumeAutomation: {
        points: [
          { t: 0, v: 2 },
          { t: 2, v: 0.2 },
        ],
      },
    } as never as Parameters<typeof clipGainAt>[0];
    expect(clipGainAt(clip, 0)).toBe(2); // 1.5*2 → 夹紧到 2
    expect(clipGainAt(clip, 2)).toBeCloseTo(0.3, 9);
  });

  it('无包络时就是 clip.volume', () => {
    const clip = { volume: 0.6 } as never as Parameters<typeof clipGainAt>[0];
    expect(clipGainAt(clip, 1)).toBeCloseTo(0.6, 9);
  });
});
