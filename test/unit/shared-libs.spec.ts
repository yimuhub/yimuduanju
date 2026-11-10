import {
  estimateSpeechSeconds,
  keywordSimilarity,
  REUSE_MATCH_THRESHOLD,
} from '@shared/text-metrics';
import {
  buildFivePart,
  CINEMATIC_NEGATIVE,
  styleBibleToStyle,
  withVideoTextPolicy,
  NO_ONSCREEN_TEXT,
} from '@shared/prompt-formula';
import { CAMERA_RIGS, movementLabel, rigById } from '@shared/camera-rigs';
import {
  CONTENT_MODES,
  WHITEMODEL_SOURCES,
  CTA_KEYWORDS,
} from '@shared/content-modes';

/** F8 关键链路单测：文本度量、prompt 公式、机位库、模式库（改了阈值/文案此处必红）。 */
describe('text-metrics', () => {
  test('中文 4 字/秒，英文 2.5 词/秒', () => {
    expect(estimateSpeechSeconds('你好世界')).toBeCloseTo(1);
    expect(estimateSpeechSeconds('hello world foo bar')).toBeCloseTo(4 / 2.5);
  });

  test('相似度阈值 0.40（与 shorts MATCH_THRESHOLD 同源）', () => {
    expect(REUSE_MATCH_THRESHOLD).toBe(0.4);
    expect(
      keywordSimilarity('黑衣人走在雨夜街道', '雨夜街道黑衣人'),
    ).toBeGreaterThanOrEqual(0.4);
    expect(keywordSimilarity('黑衣人', '产品广告面膜')).toBeLessThan(0.4);
    expect(keywordSimilarity('', 'x')).toBe(0);
  });
});

describe('prompt-formula', () => {
  test('五段式按顺序拼接，空段跳过', () => {
    expect(buildFivePart({ cinematography: 'a', action: 'b' })).toBe('a。b');
    expect(buildFivePart({})).toBe('');
  });

  test('通用负词覆盖关键品类（非空话）', () => {
    for (const k of ['形变', '水印', '字幕']) {
      expect(CINEMATIC_NEGATIVE).toContain(k);
    }
  });

  test('风格圣经无料返回空（不编造）', () => {
    expect(styleBibleToStyle(null)).toBe('');
    expect(styleBibleToStyle({})).toBe('');
    expect(
      styleBibleToStyle({ visualStyle: '电影感', lighting: '侧逆光' }),
    ).toContain('侧逆光');
  });

  test('视频默认不生成画面字幕，显式开启才放行', () => {
    expect(withVideoTextPolicy('雨夜街道')).toContain(NO_ONSCREEN_TEXT);
    expect(withVideoTextPolicy('雨夜街道', true)).toBe('雨夜街道');
    // 幂等：重复应用不叠加；已有“不要字幕”的自定义负词不重复追加
    const once = withVideoTextPolicy('雨夜街道');
    expect(withVideoTextPolicy(once)).toBe(once);
    expect(withVideoTextPolicy('避免：不要字幕')).toBe('避免：不要字幕');
  });
});

describe('camera-rigs', () => {
  test('十种机位齐备且 movement 唯一', () => {
    expect(CAMERA_RIGS).toHaveLength(10);
    const moves = CAMERA_RIGS.map((r) => r.movement);
    expect(new Set(moves).size).toBe(10);
  });

  test('label 解析覆盖新老取值', () => {
    expect(rigById('dolly')?.label).toBe('轨道推拉');
    expect(movementLabel('push_in')).toBe('推进');
    expect(movementLabel('dolly')).toBe('轨道推拉');
  });
});

describe('content-modes', () => {
  test('三模式默认值', () => {
    expect(CONTENT_MODES.map((m) => m.id).sort()).toEqual([
      'ads',
      'drama',
      'general',
    ]);
    expect(WHITEMODEL_SOURCES).toHaveLength(4);
    expect(CTA_KEYWORDS.length).toBeGreaterThan(5);
  });
});

describe('new builders', () => {
  test('人物卡/分镜表契约字符串存在', async () => {
    const mod = await import('@server/modules/story-skills/skills');
    expect(mod.CHARACTER_JSON_CONTRACT).toContain('canonicalDescription');
    expect(mod.BOARDS_JSON_CONTRACT).toContain('shotSize');
    const style = { id: 'x', artStyle: 'realistic', label: 'x', description: 'd', visual: 'v', negative: 'n', tone: 't', camera: 'c' };
    expect(mod.buildCharacterPrompt('测试', style)).toContain('人物卡');
    expect(mod.buildBoardsPrompt('测试', style)).toContain('分镜');
  });
});

describe('model-classify', () => {
  test(' doubao 系精确区分（seedream 图 vs seedance 视频）', async () => {
    const mod = await import('@shared/model-classify');
    expect(mod.classifyModelId('doubao-seedream-5-0-pro')).toBe('image');
    expect(mod.classifyModelId('doubao-seedance-2-5')).toBe('video');
    expect(mod.classifyModelId('doubao-seed-1-6')).toBe('text');
    expect(mod.classifyModelId('doubao-tts')).toBe('tts');
    expect(mod.classifyModelId('gpt-4o-mini')).toBe('text');
    expect(mod.classifyModelId('gpt-image-1')).toBe('image');
    expect(mod.classifyModelId('veo-3.1')).toBe('video');
    expect(mod.classifyModelId('bge-m3')).toBe('unknown');
    expect(mod.classifyModelId('')).toBe('unknown');
  });
});
