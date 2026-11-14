/**
 * 分镜时间分段纯函数库单测（migration 0025）
 * 覆盖：归一化（脏数据/空段/钳制/段数封顶）、提示词拼接、beats 映射、单段兼容模式。
 */
import {
  blankTimeSegment,
  composeTimeSegmentBlock,
  normalizeTimeSegments,
  segmentsTotalSeconds,
  timeSegmentsOf,
  timeSegmentsToBeats,
  withTimeSegmentBlock,
} from '@shared/shot-time-segments';

describe('normalizeTimeSegments', () => {
  it('非数组/空输入返回空数组（单段兼容模式）', () => {
    expect(normalizeTimeSegments(undefined)).toEqual([]);
    expect(normalizeTimeSegments(null)).toEqual([]);
    expect(normalizeTimeSegments('oops')).toEqual([]);
    expect(normalizeTimeSegments({})).toEqual([]);
  });

  it('丢弃无描述且无角色的空段，保留有效字段', () => {
    const out = normalizeTimeSegments([
      { id: 'a', shotType: 'close_up', duration: 3, description: '抬头', characters: ['林晚'], sceneRef: '便利店' },
      { id: 'b', duration: 2, description: '', characters: [] },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      id: 'a',
      shotType: 'close_up',
      duration: 3,
      description: '抬头',
      characters: ['林晚'],
      sceneRef: '便利店',
    });
  });

  it('时长钳制到 [0.5, 20]，非法值回落 3s；角色去空截断', () => {
    const out = normalizeTimeSegments([
      { duration: 0.1, description: 'a', characters: ['x', '', 42 as unknown as string] },
      { duration: 'abc', description: 'b' },
      { duration: 99, description: 'c' },
    ]);
    expect(out.map((s) => s.duration)).toEqual([0.5, 3, 20]);
    expect(out[0].characters).toEqual(['x']);
  });

  it('段数封顶 12（防 jsonb 膨胀与提示词失控）', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ duration: 1, description: `段${i}` }));
    expect(normalizeTimeSegments(many)).toHaveLength(12);
  });
});

describe('timeSegmentsOf / segmentsTotalSeconds', () => {
  it('从 metadata 安全取出分段（null/无键 → 空数组）', () => {
    expect(timeSegmentsOf(null)).toEqual([]);
    expect(timeSegmentsOf({ other: 1 })).toEqual([]);
    expect(timeSegmentsOf({ timeSegments: [{ duration: 4, description: 'x' }] })).toHaveLength(1);
  });

  it('总时长求和', () => {
    expect(segmentsTotalSeconds([{ duration: 3 } as never, { duration: 4 } as never])).toBeCloseTo(7);
  });
});

describe('composeTimeSegmentBlock / withTimeSegmentBlock', () => {
  it('无分段返回空串（旧数据零副作用）', () => {
    expect(composeTimeSegmentBlock([])).toBe('');
    expect(withTimeSegmentBlock('原描述', [])).toBe('原描述');
    expect(withTimeSegmentBlock(null, undefined as unknown as never[])).toBe('');
  });

  it('按段拼接含区间/景别/运镜/描述/角色/场景', () => {
    const block = composeTimeSegmentBlock([
      { id: '1', shotType: 'close_up', duration: 3, description: '她握紧怀表', characters: ['林晚'], movement: 'push_in', sceneRef: '便利店' },
      { id: '2', duration: 2.5, description: '门外脚步声逼近', characters: [] },
    ]);
    expect(block).toContain('【时间分段】');
    expect(block).toContain('0-3 秒');
    expect(block).toContain('特写');
    expect(block).toContain('运镜push_in');
    expect(block).toContain('（出场：林晚）');
    expect(block).toContain('〔场景 便利店〕');
    expect(block).toContain('3-5.5 秒');
  });

  it('withTimeSegmentBlock 保留原描述在前、分段块在后', () => {
    const out = withTimeSegmentBlock('整镜描述', [{ duration: 3, description: '第一段' }]);
    expect(out.startsWith('整镜描述')).toBe(true);
    expect(out).toContain('【时间分段】');
  });
});

describe('timeSegmentsToBeats', () => {
  it('空分段返回 null（调用方回落 shot.beats）', () => {
    expect(timeSegmentsToBeats([])).toBeNull();
    expect(timeSegmentsToBeats(undefined as unknown as never[])).toBeNull();
  });

  it('映射为连续节拍：区间衔接、描述带景别/运镜/在场角色前缀', () => {
    const beats = timeSegmentsToBeats([
      { id: '1', shotType: 'medium_shot', duration: 3, description: '推门', characters: ['林晚'], movement: 'static' },
      { id: '2', duration: 5, description: '环视店内', characters: [] },
    ]);
    expect(beats).not.toBeNull();
    expect(beats).toEqual([
      { from: 0, to: 3, description: '中景，推门（在场：林晚）' },
      { from: 3, to: 8, description: '环视店内' },
    ]);
  });
});

describe('blankTimeSegment', () => {
  it('新建段默认 3s 中景，id 含索引可作拖拽键', () => {
    const seg = blankTimeSegment(2);
    expect(seg.duration).toBe(3);
    expect(seg.shotType).toBe('medium_shot');
    expect(seg.characters).toEqual([]);
    expect(seg.id).toContain('2');
  });
});
