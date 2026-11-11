import {
  checkAxisContinuity,
  deriveBeats,
  estimateDialogueSeconds,
  groupShotsIntoPieces,
  matchPropVariant,
  normalizeBeats,
  planPieces,
  repetitiveShotSizes,
  reverseAngleScreenDirection,
  SEGMENT_MAX_SECONDS,
  SEGMENT_MAX_SHOTS,
  axisConsistent,
} from '@shared/shot-craft';
import { buildSegmentedVideoPrompt, describeContinuity } from '@shared/video-prompt';
import { renderAssetCatalog, buildBoardsPrompt } from '../../server/modules/story-skills/skills';

/**
 * 片段 / 空间 / 视频提示词单测。
 *
 * 这三块是「镜头接不住」的直接成因，口径改了这里必须红：
 * - 片段是「同一空间内一段连续动作」的边界，超 15 秒或超 4 镜必须切；
 * - 反打必须「左者右看、右者左看」，同段轴线不得翻转；
 * - 视频提示词必须按 3 秒分段，且每段都有可见动作。
 */

const style = { id: 'default', name: '默认', visual: '电影感' } as never;

describe('shot-craft · 片段归组', () => {
  const shots = (durations: number[]) =>
    durations.map((d, i) => ({ shotNumber: i + 1, duration: d }));

  test('按 ≤15 秒归段（4.5×4：13.5 秒留在首段，第四镜另起一段）', () => {
    const pieces = groupShotsIntoPieces(shots([4.5, 4.5, 4.5, 4.5]));
    expect(pieces).toHaveLength(2);
    expect(pieces[0].shots).toHaveLength(3);
    expect(pieces[0].durationSeconds).toBe(13.5);
    expect(pieces[1].shots).toHaveLength(1);
  });

  test('每段最多 4 镜（5 个 2 秒镜切成 4+1）', () => {
    const pieces = groupShotsIntoPieces(shots([2, 2, 2, 2, 2]));
    expect(pieces).toHaveLength(2);
    expect(pieces[0].shots).toHaveLength(SEGMENT_MAX_SHOTS);
  });

  test('单镜超 15 秒仍独占一段（不出现空段）', () => {
    const pieces = groupShotsIntoPieces(shots([20, 3]));
    expect(pieces[0].shots).toHaveLength(1);
    expect(pieces[0].durationSeconds).toBe(20);
    expect(pieces[1].shots).toHaveLength(1);
  });

  test('时长合计不越过上限（每段 ≤15 秒）', () => {
    const pieces = groupShotsIntoPieces(shots([6, 6, 6, 6, 6, 6]));
    for (const p of pieces) {
      if (p.shots.length > 1) expect(p.durationSeconds).toBeLessThanOrEqual(SEGMENT_MAX_SECONDS);
    }
  });

  test('planPieces 尊重 LLM 给出的片段号', () => {
    const pieces = planPieces([
      { shotNumber: 1, duration: 4, segment: 1 },
      { shotNumber: 2, duration: 4, segment: 1 },
      { shotNumber: 3, duration: 4, segment: 2 },
    ]);
    expect(pieces).toHaveLength(2);
    expect(pieces[0].shots).toHaveLength(2);
    expect(pieces[1].shots).toHaveLength(1);
  });

  test('planPieces 无段号时退化为自动归段', () => {
    const pieces = planPieces(shots([5, 5, 5, 5]));
    expect(pieces.length).toBeGreaterThan(1);
  });

  test('planPieces 段内超 4 镜会被切开', () => {
    const pieces = planPieces([
      { shotNumber: 1, duration: 2, segment: 1 },
      { shotNumber: 2, duration: 2, segment: 1 },
      { shotNumber: 3, duration: 2, segment: 1 },
      { shotNumber: 4, duration: 2, segment: 1 },
      { shotNumber: 5, duration: 2, segment: 1 },
    ]);
    expect(pieces).toHaveLength(2);
  });
});

describe('shot-craft · 空间与轴线', () => {
  test('反打：左侧人物向右看，右侧人物向左看', () => {
    expect(reverseAngleScreenDirection('left_mid', 'right_mid')).toBe('left_to_right');
    expect(reverseAngleScreenDirection('right_mid', 'left_mid')).toBe('right_to_left');
  });

  test('轴线相容性：left_to_right 段里出现 right_to_left 即矛盾', () => {
    expect(axisConsistent('left_to_right', 'left_to_right')).toBe(true);
    expect(axisConsistent('left_to_right', 'right_to_left')).toBe(false);
    expect(axisConsistent(null, 'right_to_left')).toBe(true);
    expect(axisConsistent('frontal', 'toward_camera')).toBe(true);
  });

  test('同段内画面方向翻转被判为疑似跳轴', () => {
    const violations = checkAxisContinuity([
      { shotNumber: 1, axisDirection: 'left_to_right', screenDirection: 'left_to_right' },
      { shotNumber: 2, axisDirection: 'left_to_right', screenDirection: 'right_to_left' },
    ]);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations.some((v) => v.shotNumber === 2)).toBe(true);
  });

  test('static 镜不参与翻转判定', () => {
    const violations = checkAxisContinuity([
      { shotNumber: 1, screenDirection: 'left_to_right' },
      { shotNumber: 2, screenDirection: 'static' },
      { shotNumber: 3, screenDirection: 'left_to_right' },
    ]);
    expect(violations).toHaveLength(0);
  });

  test('连续三个同景别要被点名', () => {
    expect(
      repetitiveShotSizes([
        { shotNumber: 1, shotSize: 'medium' },
        { shotNumber: 2, shotSize: 'medium' },
        { shotNumber: 3, shotSize: 'medium' },
        { shotNumber: 4, shotSize: 'close_up' },
      ]),
    ).toEqual([3]);
  });

  test('台词时长按 4 字/秒 + 停顿 + 余量估算', () => {
    // 去前缀与标点后 16 字：16/4 = 4 秒 + 一处停顿 + 1 秒余量
    const s = estimateDialogueSeconds('林晚：我今天必须把这块表还给他，你别拦我');
    expect(s).toBeGreaterThanOrEqual(5);
    expect(s).toBeLessThanOrEqual(7);
    expect(estimateDialogueSeconds('')).toBe(0);
    expect(estimateDialogueSeconds('嗯')).toBeGreaterThan(0);
  });
});

describe('video-prompt · 3 秒分段', () => {
  test('有节拍时按 3 秒切段并保留台词', () => {
    const r = buildSegmentedVideoPrompt({
      duration: 9,
      beats: [
        { from: 0, to: 3, description: '推门，门缝透出暖光' },
        { from: 3, to: 6, description: '跨进店内', dialogue: '有人吗' },
        { from: 6, to: 9, description: '回头看向门外' },
      ],
      description: '推门进店',
      shotSize: 'wide',
      movement: 'dolly',
      screenDirection: 'left_to_right',
    });
    expect(r.degraded).toBe(false);
    expect(r.prompt).toContain('0-3 秒');
    expect(r.prompt).toContain('3-6 秒');
    expect(r.prompt).toContain('6-9 秒');
    expect(r.prompt).toContain('台词「有人吗」');
    expect(r.prompt).toContain('画面方向 画面内从左向右');
  });

  test('无节拍时降级为单段，并如实标记 degraded', () => {
    const r = buildSegmentedVideoPrompt({ duration: 5, description: '她抬起头' });
    expect(r.degraded).toBe(true);
    expect(r.beats).toHaveLength(1);
    expect(r.prompt).toContain('0-5 秒');
  });

  test('长时间镜（12 秒）被切成 4 段', () => {
    const r = buildSegmentedVideoPrompt({
      duration: 12,
      beats: [{ from: 0, to: 12, description: '缓慢穿过走廊' }],
    });
    expect(r.beats).toHaveLength(4);
  });

  test('续接句写进提示词', () => {
    const r = buildSegmentedVideoPrompt({
      duration: 6,
      description: '她把怀表放进抽屉',
      previousEndState: '上一镜结束时：手停在抽屉把手上',
    });
    expect(r.prompt).toContain('【承接上一镜】');
    expect(r.prompt).toContain('手停在抽屉把手上');
  });

  test('禁止项压尾（模型对末尾更敏感）', () => {
    const r = buildSegmentedVideoPrompt({ duration: 5, description: 'x' });
    const lines = r.prompt.split('\n');
    expect(lines[lines.length - 1]).toContain('【禁止】');
  });

  test('normalizeBeats 不把台词拆成两半念', () => {
    const beats = normalizeBeats(
      [
        { from: 0, to: 4, description: 'A', dialogue: '第一句' },
        { from: 4, to: 8, description: 'B' },
      ],
      8,
    );
    // 每段都来自某个源节拍，不会凭空产生半句台词
    expect(beats.every((b) => b.description === 'A' || b.description === 'B')).toBe(true);
    expect(beats.filter((b) => b.dialogue === '第一句').length).toBeGreaterThanOrEqual(1);
  });

  test('deriveBeats 覆盖整镜时长', () => {
    const beats = deriveBeats({ duration: 7, visualPrompt: '她推门进来', dialogue: '有人吗' });
    expect(beats[0].from).toBe(0);
    expect(beats[beats.length - 1].to).toBe(7);
    expect(beats[0].dialogue).toBe('有人吗');
  });

  test('describeContinuity 传空时返回空串', () => {
    expect(describeContinuity({})).toBe('');
  });
});

describe('道具状态变体', () => {
  const variants = [
    { id: 'v1', name: '合着的怀表', description: '黄铜表盖闭合' },
    { id: 'v2', name: '打开的怀表', description: '表盖弹开，露出表盘' },
  ];

  test('命中变体名', () => {
    expect(matchPropVariant(variants, '她把打开的怀表举到灯下')?.id).toBe('v2');
  });

  test('没提到状态时不猜', () => {
    expect(matchPropVariant(variants, '她把道具放进抽屉')).toBeNull();
    expect(matchPropVariant([], '任何文字')).toBeNull();
  });
});

describe('分镜表提示词', () => {
  test('资产清单渲染成「只能用这些」', () => {
    const block = renderAssetCatalog({
      characters: [{ name: '林晚', roleType: 'lead' }, { name: '沈砚' }],
      locations: [{ name: '旧书店', timeOfDay: '夜' }],
      props: [{ code: 'PROP001', name: '怀表' }],
    });
    expect(block).toContain('林晚（主角）');
    expect(block).toContain('PROP001 怀表');
    expect(block).toContain('不得新造');
  });

  test('空清单不虚构', () => {
    expect(renderAssetCatalog(null)).toBe('');
    expect(renderAssetCatalog({})).toBe('');
  });

  test('提示词包含三级结构与空间规则', () => {
    const prompt = buildBoardsPrompt('林晚推门进店', style, '', 90, {
      characters: [{ name: '林晚' }],
    });
    expect(prompt).toContain('场 → 片段 → 镜');
    expect(prompt).toContain('九宫格');
    expect(prompt).toContain('左者右看');
    expect(prompt).toContain('beats');
    expect(prompt).toContain('林晚');
  });
});
