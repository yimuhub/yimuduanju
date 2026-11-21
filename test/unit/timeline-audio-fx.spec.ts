/**
 * 音频效果链（FX rack）纯函数单测
 * -------------------------------------------------------------
 * 覆盖：节点归一化（类型白名单 / 参数夹紧 / 上限截断 / 空链 null）、
 *       ffmpeg 滤镜构建（各类型参数换算 / bypass 跳过 / 链序保持 / 空链不追加）、
 *       FX 参数自动化（paramAt 插值 / 自动化归一化 / enable 窗口切分 /
 *       多参数叠加 / 无自动化不追加 / aecho·acompressor 退静态）、
 *       具名一键决策（电话声两条、空间感一条混响）。
 * 这些是「预览听得到的链 = 导出渲染的链」的正确性底线。
 */
import {
  AUDIO_FX_AUTOMATION_MAX_POINTS,
  AUDIO_FX_JOBS,
  AUDIO_FX_MAX_NODES,
  buildAudioFxFilterArgs,
  clampAudioFxParams,
  formatAudioFxParamValue,
  makeAudioFxNode,
  normalizeAudioFxNodes,
  normalizeFxAutomation,
  paramAt,
  type AudioFxAutomationPoint,
  type TimelineClipAudioFxNode,
} from '../../shared/timeline-audio-fx';

const node = (
  type: string,
  params: Record<string, number>,
  extra?: { id?: string; bypass?: boolean; automation?: Record<string, AudioFxAutomationPoint[]> },
): TimelineClipAudioFxNode => ({
  id: extra?.id ?? `fx-${type}`,
  type: type as 'eq',
  ...(extra?.bypass === true ? { bypass: true } : {}),
  ...(extra?.automation ? { automation: extra.automation } : {}),
  params,
});

describe('normalizeAudioFxNodes', () => {
  it('过滤非法类型、夹紧参数、空链返回 null', () => {
    const out = normalizeAudioFxNodes([
      node('eq', { lowGain: -999, midQ: 99, junk: 1 }),
      node('bitcrush', { threshold: -9 }), // 不在白名单，整节点剔除
      null,
    ]);
    expect(out).not.toBeNull();
    expect(out?.length).toBe(1);
    expect(out?.[0].type).toBe('eq');
    expect(out?.[0].params.lowGain).toBe(-24);
    expect(out?.[0].params.midQ).toBe(10);
    expect(out?.[0].params.junk).toBeUndefined();
    // 未给的键补默认值
    expect(out?.[0].params.midFreq).toBeDefined();
  });

  it('bypass 标记保留、id 兜底、空数组与非法输入返回 null', () => {
    const out = normalizeAudioFxNodes([node('delay', { time: 320 }, { bypass: true, id: '' })]);
    expect(out?.[0].bypass).toBe(true);
    expect(out?.[0].id).not.toBe('');
    expect(normalizeAudioFxNodes([])).toBeNull();
    expect(normalizeAudioFxNodes(null)).toBeNull();
    expect(normalizeAudioFxNodes('bad' as unknown as never)).toBeNull();
  });

  it('截断到上限 AUDIO_FX_MAX_NODES', () => {
    const many = Array.from({ length: AUDIO_FX_MAX_NODES + 5 }, (_, i) =>
      node('compressor', { threshold: -12 }, { id: `c${i}` }),
    );
    const out = normalizeAudioFxNodes(many);
    expect(out?.length).toBe(AUDIO_FX_MAX_NODES);
  });
});

describe('clampAudioFxParams', () => {
  it('每个类型只保留注册表键并夹紧；非法数值回退默认', () => {
    const p = clampAudioFxParams('compressor', { threshold: -999, ratio: 999, attack: Number.NaN });
    expect(p.threshold).toBe(-60);
    expect(p.ratio).toBe(20);
    expect(p.attack).toBe(12); // 默认值
    expect(p.release).toBeDefined();
    expect(p.makeup).toBeDefined();
    expect(Object.keys(p).sort()).toEqual(['attack', 'makeup', 'ratio', 'release', 'threshold']);
  });
});

describe('buildAudioFxFilterArgs', () => {
  it('空链/undefined 返回空数组（无 FX = 命令字节级不变）', () => {
    expect(buildAudioFxFilterArgs(null)).toEqual([]);
    expect(buildAudioFxFilterArgs(undefined)).toEqual([]);
    expect(buildAudioFxFilterArgs([])).toEqual([]);
  });

  it('bypass 节点跳过，其余保持链序', () => {
    const out = buildAudioFxFilterArgs([
      node('compressor', { threshold: -20, ratio: 3, attack: 12, release: 180, makeup: 3 }),
      node('highpass', { freq: 300, q: 0.7 }, { bypass: true }),
      node('delay', { time: 320, feedback: 0.35, mix: 0.3 }),
    ]);
    expect(out.length).toBe(2);
    expect(out[0]).toContain('acompressor=threshold=-20dB:ratio=3:attack=12:release=180:makeup=3');
    expect(out[1]).toContain('aecho=0.7:0.9:320|640:');
  });

  it('eq 三段：bass/equalizer/treble，0dB 频段不产出滤镜，q 原样映射 w', () => {
    const out = buildAudioFxFilterArgs([
      node('eq', { lowGain: -6, lowFreq: 200, midGain: 3, midFreq: 3000, midQ: 1.4, highGain: 0, highFreq: 5000 }),
    ]);
    expect(out).toEqual(['bass=g=-6:f=200', 'equalizer=g=3:f=3000:t=q:w=1.4']);
    const all = buildAudioFxFilterArgs([
      node('eq', { lowGain: 1.5, lowFreq: 120, midGain: -2.5, midFreq: 1000, midQ: 0.7, highGain: 4, highFreq: 8000 }),
    ]);
    expect(all).toEqual([
      'bass=g=1.5:f=120',
      'equalizer=g=-2.5:f=1000:t=q:w=0.7',
      'treble=g=4:f=8000',
    ]);
  });

  it('高通/低通：poles=2', () => {
    expect(buildAudioFxFilterArgs([node('highpass', { freq: 300, q: 0.7 })])).toEqual(['highpass=f=300:poles=2']);
    expect(buildAudioFxFilterArgs([node('lowpass', { freq: 3400, q: 0.7 })])).toEqual(['lowpass=f=3400:poles=2']);
  });

  it('延迟：干声=1-mix，两抽头 1×/2×时间，衰减随 mix/feedback 递增', () => {
    const soft = buildAudioFxFilterArgs([node('delay', { time: 200, feedback: 0, mix: 0.2 })])[0];
    const strong = buildAudioFxFilterArgs([node('delay', { time: 200, feedback: 0.9, mix: 0.9 })])[0];
    expect(soft).toContain(':200|400:');
    expect(soft.startsWith('aecho=0.8:')).toBe(true); // 干声 = 1 - 0.2
    const d1soft = Number(soft.split(':')[3]?.split('|')[0]);
    const d1strong = Number(strong.split(':')[3]?.split('|')[0]);
    expect(d1strong).toBeGreaterThan(d1soft);
  });

  it('混响：aecho 双抽头近似，衰减随 mix 与 decay 换算', () => {
    const short = buildAudioFxFilterArgs([node('reverb', { mix: 0.3, decay: 300 })])[0];
    const long = buildAudioFxFilterArgs([node('reverb', { mix: 0.8, decay: 6000 })])[0];
    expect(short.startsWith('aecho=0.8:0.9:20|40:')).toBe(true);
    const d1short = Number(short.split(':')[3]?.split('|')[0]);
    const d1long = Number(long.split(':')[3]?.split('|')[0]);
    expect(d1long).toBeGreaterThan(d1short);
    expect(d1long).toBeLessThanOrEqual(0.8);
  });

  it('整链顺序 = 节点顺序（In → Out），导出后插在音量包络之前', () => {
    const out = buildAudioFxFilterArgs([
      node('highpass', { freq: 300, q: 0.7 }),
      node('eq', { lowGain: -6, lowFreq: 200, midGain: 0, midFreq: 1000, midQ: 1, highGain: 3, highFreq: 5000 }),
      node('compressor', { threshold: -24, ratio: 4, attack: 10, release: 150, makeup: 2 }),
      node('reverb', { mix: 0.3, decay: 1800 }),
    ]);
    expect(out.map((f) => f.split('=')[0])).toEqual(['highpass', 'bass', 'treble', 'acompressor', 'aecho']);
  });
});

describe('AUDIO_FX_JOBS 具名一键决策', () => {
  it('六个决策都能构建出合法滤镜；电话声两条、空间感一条混响', () => {
    const byId = new Map(AUDIO_FX_JOBS.map((j) => [j.id, j]));
    expect(AUDIO_FX_JOBS.length).toBe(6);
    expect(byId.get('telephone')?.nodes.map((n) => n.type)).toEqual(['highpass', 'lowpass']);
    expect(byId.get('space')?.nodes[0].type).toBe('reverb');
    for (const job of AUDIO_FX_JOBS) {
      const filters = buildAudioFxFilterArgs(job.nodes);
      expect(filters.length).toBeGreaterThan(0);
      for (const f of filters) expect(f).not.toContain('NaN');
    }
    // 去闷闷响：lowshelf -6dB @200Hz
    expect(buildAudioFxFilterArgs(byId.get('tame-boominess')?.nodes)).toContain('bass=g=-6:f=200');
    // 加清晰度：peaking +3dB @3kHz
    expect(buildAudioFxFilterArgs(byId.get('add-clarity')?.nodes)).toContain('equalizer=g=3:f=3000:t=q:w=1');
  });

  it('makeAudioFxNode 生成带默认参数的节点，params 覆盖生效', () => {
    const n = makeAudioFxNode('reverb', { mix: 0.5 });
    expect(n.type).toBe('reverb');
    expect(n.params.mix).toBe(0.5);
    expect(n.params.decay).toBe(1800);
    expect(n.id.startsWith('fx-reverb-')).toBe(true);
  });
});

describe('paramAt（FX 参数自动化插值）', () => {
  const pts = [{ t: 1, v: 0 }, { t: 3, v: 10 }];
  const auto = { midGain: pts };

  it('两点之间线性插值；端点命中取端点值', () => {
    expect(paramAt(auto, 'midGain', 2, -1)).toBe(5);
    expect(paramAt(auto, 'midGain', 1, -1)).toBe(0);
    expect(paramAt(auto, 'midGain', 3, -1)).toBe(10);
  });

  it('首点之前 / 末点之后保持端点值（端点外保持语义）', () => {
    expect(paramAt(auto, 'midGain', 0, -1)).toBe(0);
    expect(paramAt(auto, 'midGain', 99, -1)).toBe(10);
  });

  it('单点 = 恒值（Inspector 以当前值播种 t=0 单点的语义）', () => {
    expect(paramAt({ freq: [{ t: 0.5, v: 800 }] }, 'freq', 2, 20)).toBe(800);
    expect(paramAt({ freq: [{ t: 0.5, v: 800 }] }, 'freq', 0, 20)).toBe(800);
  });

  it('无该参数的自动化 / 空断点 / 非法 t 时回退 fallback（= 静态参数值）', () => {
    expect(paramAt(auto, 'highFreq', 2, 5000)).toBe(5000);
    expect(paramAt({ midGain: [] }, 'midGain', 2, -1)).toBe(-1);
    expect(paramAt({}, 'midGain', 2, -1)).toBe(-1);
    expect(paramAt(null, 'midGain', 2, -1)).toBe(-1);
    expect(paramAt(auto, 'midGain', Number.NaN, -1)).toBe(-1);
  });
});

describe('normalizeFxAutomation（自动化断点归一化）', () => {
  it('过滤非法断点、v 夹紧参数范围、t 帧量化 + 夹紧、升序、同帧保留先写入者', () => {
    const out = normalizeFxAutomation('highpass', {
      freq: [
        { t: 0.5, v: 99999 },
        { t: 1.5, v: 100 },
        { t: -1, v: 50 },
        { t: Number.NaN, v: 7 } as unknown as AudioFxAutomationPoint,
        { t: 0.5, v: 60 },
      ],
    });
    expect(out).toEqual({
      freq: [
        { t: 0, v: 50 }, // 负时间夹到 0
        { t: 0.5, v: 20000 }, // 超范围夹到 max；同帧后写入的 60 不覆盖先写入者
        { t: 1.5, v: 100 },
      ],
    });
  });

  it('键走注册表白名单：非法键剔除；全部剔除返回 undefined', () => {
    expect(normalizeFxAutomation('highpass', { q: [{ t: 0, v: 1 }], junk: [{ t: 0, v: 1 }] })).toEqual({ q: [{ t: 0, v: 1 }] });
    expect(normalizeFxAutomation('highpass', { junk: [{ t: 0, v: 1 }] })).toBeUndefined();
    expect(normalizeFxAutomation('highpass', null)).toBeUndefined();
    expect(normalizeFxAutomation('highpass', { freq: [] })).toBeUndefined();
  });

  it('span 给定时 t 夹到片段内；断点截断到 AUDIO_FX_AUTOMATION_MAX_POINTS', () => {
    expect(normalizeFxAutomation('eq', { midGain: [{ t: 100, v: 3 }] }, 2, 24)).toEqual({ midGain: [{ t: 2, v: 3 }] });
    // 每点占独立帧（i/24），避免帧量化同帧去重干扰上限断言
    const many: AudioFxAutomationPoint[] = Array.from({ length: AUDIO_FX_AUTOMATION_MAX_POINTS + 100 }, (_, i) => ({ t: i / 24, v: 1 }));
    const capped = normalizeFxAutomation('highpass', { freq: many });
    expect(capped?.freq.length).toBe(AUDIO_FX_AUTOMATION_MAX_POINTS);
  });

  it('normalizeAudioFxNodes 透传合法自动化、剔除全非法的、无自动化不带 automation 键', () => {
    const withAuto = normalizeAudioFxNodes([
      node('highpass', { freq: 300, q: 0.7 }, { automation: { freq: [{ t: 0, v: 300 }, { t: 1, v: 3000 }], junk: [{ t: 0, v: 1 }] } }),
    ]);
    expect(withAuto?.[0].automation).toEqual({ freq: [{ t: 0, v: 300 }, { t: 1, v: 3000 }] });
    const plain = normalizeAudioFxNodes([node('highpass', { freq: 300, q: 0.7 })]);
    expect('automation' in (plain?.[0] ?? {})).toBe(false);
    const bad = normalizeAudioFxNodes([node('highpass', { freq: 300, q: 0.7 }, { automation: { junk: [{ t: 0, v: 1 }] } })]);
    expect('automation' in (bad?.[0] ?? {})).toBe(false);
  });

  it('normalizeAudioFxNodes 带 span/fps：自动化断点帧量化并夹到片段时长', () => {
    const out = normalizeAudioFxNodes(
      [node('highpass', { freq: 300, q: 0.7 }, { automation: { freq: [{ t: 0.53, v: 100 }, { t: 9, v: 200 }] } })],
      { span: 1, fps: 24 },
    );
    // 0.53s × 24fps = 12.72 → 13 帧 = 13/24s；9s 超出片段时长夹到 1
    expect(out?.[0].automation?.freq).toEqual([{ t: 13 / 24, v: 100 }, { t: 1, v: 200 }]);
  });
});

describe('buildAudioFxFilterArgs：FX 自动化 enable 窗口导出', () => {
  it('无自动化：传不传 span 输出完全一致（旧行为字节级不变）', () => {
    const nodes = [
      node('highpass', { freq: 300, q: 0.7 }),
      node('eq', { lowGain: -6, lowFreq: 200, midGain: 3, midFreq: 3000, midQ: 1.4, highGain: 0, highFreq: 5000 }),
    ];
    expect(buildAudioFxFilterArgs(nodes, 3.5)).toEqual(buildAudioFxFilterArgs(nodes));
  });

  it('高通自动化：按断点切窗口，每窗口静态滤镜 + enable=between(t,S,E)，相邻窗口末端收缩 1ms', () => {
    const out = buildAudioFxFilterArgs(
      [node('highpass', { freq: 300, q: 0.7 }, { automation: { freq: [{ t: 0, v: 300 }, { t: 1, v: 3000 }] } })],
      2,
    );
    expect(out).toEqual([
      "highpass=f=300:poles=2:enable='between(t,0.000,0.999)'",
      "highpass=f=3000:poles=2:enable='between(t,1.000,2.000)'",
    ]);
  });

  it('单点（Inspector 播种 t=0）：整段一个窗口保持种子值', () => {
    const out = buildAudioFxFilterArgs(
      [node('highpass', { freq: 300, q: 0.7 }, { automation: { freq: [{ t: 0.5, v: 800 }] } })],
      2,
    );
    expect(out).toEqual(["highpass=f=800:poles=2:enable='between(t,0.000,2.000)'"]);
  });

  it('相邻窗口所有键值相同则合并；超范围断点夹到片段内', () => {
    const merged = buildAudioFxFilterArgs(
      [node('lowpass', { freq: 12000, q: 0.707 }, { automation: { freq: [{ t: 0, v: 100 }, { t: 1, v: 100 }, { t: 2, v: 2000 }] } })],
      3,
    );
    expect(merged).toEqual([
      "lowpass=f=100:poles=2:enable='between(t,0.000,1.999)'",
      "lowpass=f=2000:poles=2:enable='between(t,2.000,3.000)'",
    ]);
    const clamped = buildAudioFxFilterArgs(
      [node('highpass', { freq: 300, q: 0.7 }, { automation: { freq: [{ t: 0, v: 300 }, { t: 5, v: 900 }] } })],
      2,
    );
    // t=5 的断点夹到 span=2，窗口合并为 [0,2]，起点值保持首点
    expect(clamped).toEqual(["highpass=f=300:poles=2:enable='between(t,0.000,2.000)'"]);
  });

  it('eq 只窗口化被自动化的段（基参数其他键保持静态滤镜）；段内回 0dB 的窗口不产出滤镜', () => {
    const out = buildAudioFxFilterArgs(
      [
        node(
          'eq',
          { lowGain: -6, lowFreq: 200, midGain: 3, midFreq: 1000, midQ: 1, highGain: 0, highFreq: 5000 },
          { automation: { midGain: [{ t: 0, v: 3 }, { t: 2, v: 0 }] } },
        ),
      ],
      4,
    );
    expect(out).toEqual([
      'bass=g=-6:f=200',
      "equalizer=g=3:f=1000:t=q:w=1:enable='between(t,0.000,1.999)'",
      // [2,4] 窗口 midGain=0：与静态语义一致，不产出 equalizer；highGain=0 无 treble
    ]);
  });

  it('同组多参数（lowGain+lowFreq）一起窗口化：窗口值 = 窗口起点插值；treble 静态保持', () => {
    const out = buildAudioFxFilterArgs(
      [
        node(
          'eq',
          { lowGain: -6, lowFreq: 200, midGain: 0, midFreq: 1000, midQ: 1, highGain: 4, highFreq: 8000 },
          { automation: { lowGain: [{ t: 0, v: -6 }, { t: 1, v: -3 }, { t: 2, v: 0 }], lowFreq: [{ t: 0, v: 200 }, { t: 2, v: 400 }] } },
        ),
      ],
      2,
    );
    expect(out).toEqual([
      "bass=g=-6:f=200:enable='between(t,0.000,0.999)'",
      // lowGain 在 [1,2] 取起点值 -3；lowFreq 无 1s 断点，起点线性插值 = 300
      "bass=g=-3:f=300:enable='between(t,1.000,2.000)'",
      'treble=g=4:f=8000',
    ]);
  });

  it('静态 0dB 的段被自动化后：起点值仍为 0 的窗口不产出滤镜（与静态语义一致）', () => {
    const out = buildAudioFxFilterArgs(
      [
        node(
          'eq',
          { lowGain: 0, lowFreq: 200, midGain: 0, midFreq: 1000, midQ: 1, highGain: 0, highFreq: 5000 },
          { automation: { midGain: [{ t: 0, v: 0 }, { t: 2, v: 6 }] } },
        ),
      ],
      4,
    );
    // [0,2) 窗口 midGain=0 → 无 equalizer（与静态 0dB 不产出一致）；[2,4] 生效
    expect(out).toEqual(["equalizer=g=6:f=1000:t=q:w=1:enable='between(t,2.000,4.000)'"]);
  });

  it('compressor / delay / reverb 自动化导出退回静态种子值（ffmpeg 6.0 无 enable 支持）', () => {
    const out = buildAudioFxFilterArgs(
      [
        node('compressor', { threshold: -20, ratio: 3, attack: 12, release: 180, makeup: 3 }, { automation: { ratio: [{ t: 0, v: 3 }, { t: 1, v: 8 }] } }),
        node('reverb', { mix: 0.3, decay: 1800 }, { automation: { mix: [{ t: 0, v: 0.1 }, { t: 1, v: 0.6 }] } }),
        node('delay', { time: 320, feedback: 0.35, mix: 0.3 }, { automation: { time: [{ t: 0, v: 320 }, { t: 1, v: 120 }] } }),
      ],
      2,
    );
    expect(out).toEqual([
      'acompressor=threshold=-20dB:ratio=3:attack=12:release=180:makeup=3',
      'aecho=0.8:0.9:20|40:0.1|0.04',
      'aecho=0.7:0.9:320|640:0.2|0.12',
    ]);
  });

  it('多节点叠加：自动化节点与静态节点链序保持，互不串扰', () => {
    const out = buildAudioFxFilterArgs(
      [
        node('delay', { time: 320, feedback: 0.35, mix: 0.3 }),
        node('highpass', { freq: 300, q: 0.7 }, { automation: { freq: [{ t: 0, v: 300 }, { t: 2, v: 3000 }] } }),
      ],
      3,
    );
    expect(out).toEqual([
      'aecho=0.7:0.9:320|640:0.2|0.12',
      "highpass=f=300:poles=2:enable='between(t,0.000,1.999)'",
      "highpass=f=3000:poles=2:enable='between(t,2.000,3.000)'",
    ]);
  });

  it('span 非法（0/负）时忽略自动化走静态', () => {
    const nodes = [node('highpass', { freq: 300, q: 0.7 }, { automation: { freq: [{ t: 0, v: 300 }] } })];
    expect(buildAudioFxFilterArgs(nodes, 0)).toEqual(['highpass=f=300:poles=2']);
    expect(buildAudioFxFilterArgs(nodes, -1)).toEqual(['highpass=f=300:poles=2']);
    expect(buildAudioFxFilterArgs(nodes)).toEqual(['highpass=f=300:poles=2']);
  });
});

describe('formatAudioFxParamValue（Inspector / 时间线 lane 共用显示）', () => {
  const def = (key: string, unit: '' | 'dB' | 'ms', centerZero?: boolean) => ({ key, label: key, min: 0, max: 1, step: 0.01, unit, centerZero });

  it('mix/feedback 按百分比，增益类带符号 dB，其余按单位', () => {
    expect(formatAudioFxParamValue(def('mix', ''), 0.34)).toBe('34%');
    expect(formatAudioFxParamValue(def('lowGain', 'dB', true), 3.5)).toBe('+3.5dB');
    expect(formatAudioFxParamValue(def('lowGain', 'dB', true), -2)).toBe('-2dB');
    expect(formatAudioFxParamValue(def('time', 'ms'), 320)).toBe('320ms');
    expect(formatAudioFxParamValue(def('midFreq', ''), 1000)).toBe('1000');
  });
});
