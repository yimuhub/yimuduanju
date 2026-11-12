/**
 * 画面策略回归测试（用户三条硬要求 + 对标项目共识）
 * ------------------------------------------------------------------
 * 1. 所有图片必须按项目画幅生成，不能全落 1:1 方图：
 *    参数层 imageSizeForAspect + 提示词层 aspectCompositionLine 双写；
 * 2. 所有图片提示词必须注明「无字体 / 无字幕 / 无文字 / 无水印」，
 *    且字幕只走后期叠加；道具 exact_readable 是唯一显式例外；
 * 3. 场景描述必须是结构化、可拍摄的精准事实，并同时进入首帧与视频提示词。
 *
 * 对标：taylorzhou16/video-gen（比例文案 + --aspect-ratio）、ArcReel（9:16竖屏构图）、
 * ddcat-ai（全局负面词文字/水印/logo）、drama-skills（no text, no logo）、
 * MN0709（[负面提示词]/[语言锁]/【整体场景与氛围】）、bolecodex（结构化分镜字段）。
 */
import {
  agnesAspectRatio,
  DEFAULT_ASPECT_RATIO,
  imageSizeForAspect,
  isVerticalAspect,
  normalizeAspect,
  videoSizeForAspect,
} from '@shared/aspect';
import {
  aspectCompositionLine,
  aspectGuardLine,
  composeImageNegativePrompt,
  IMAGE_NEGATIVE_BASE,
  imageTextPolicy,
  normalizeSceneEnv,
  ONSCREEN_TEXT_RULES,
  renderImageConstraintBlock,
  renderSceneEnv,
  SCENE_ENV_CONTRACT,
  SCENE_ENV_FIELDS,
} from '@shared/prompt-formula';
import { buildShotPrompt, composeShotReferences } from '@shared/shot-context';
import { buildSegmentedVideoPrompt } from '@shared/video-prompt';
import { countLanguageViolations, normalizeBoardsLanguage } from '@shared/boards-language';
import { buildBoardsPrompt } from '@server/modules/story-skills/skills';
import type { StoryStylePreset } from '@shared/api.interface';

const style: StoryStylePreset = {
  id: 'realistic',
  artStyle: 'realistic',
  label: '写实',
  description: '写实电影质感',
  // 故意放一个不可能出现在分镜提示词里的英文画风标签
  visual: 'ENGLISH_STYLE_TAG_SHOULD_NOT_LEAK',
  negative: 'ENGLISH_NEGATIVE_TAG',
  tone: 'ENGLISH_TONE_TAG',
  camera: 'ENGLISH_CAMERA_TAG',
};

const sceneEnv = {
  timeOfDay: '雨夜 21:30',
  weather: '小雨',
  locationType: '内景',
  place: '旧书店，木书架沿左右墙排列，中央一张旧木桌，门在画面右后侧',
  lightSource: '门口暖黄台灯',
  lightDirection: '暖光从画面左侧斜射',
  lightQuality: '柔和侧逆光',
  colorPalette: '暖琥珀与冷蓝对比',
  atmosphere: '雨雾与浮尘在光束里可见',
  spatialRelation: '林晚位于中景偏左，木桌在前景右下',
  composition: '三分法，左侧书架作前景遮挡',
  ambientSound: '雨打玻璃、木地板轻响、远处闷雷',
};

describe('画幅 · 参数层（杜绝 1:1 方图）', () => {
  test('项目画幅映射到非方形像素尺寸', () => {
    expect(imageSizeForAspect('16:9')).toBe('1280x720');
    expect(imageSizeForAspect('9:16')).toBe('720x1280');
    expect(imageSizeForAspect('21:9')).toBe('1344x576');
    expect(videoSizeForAspect('16:9')).toBe('1280x720');
    expect(videoSizeForAspect('9:16')).toBe('720x1280');
  });

  test('缺省画幅与 DB / UI 默认一致，且不再是 1024x1024', () => {
    expect(DEFAULT_ASPECT_RATIO).toBe('9:16');
    expect(imageSizeForAspect()).toBe('720x1280');
    expect(imageSizeForAspect(null)).not.toBe('1024x1024');
    expect(imageSizeForAspect('1:1')).toBe('1024x1024'); // 只有用户真选 1:1 才是方图
  });

  test('中文冒号 / 未知名收敛到标准值，竖屏判定正确', () => {
    expect(normalizeAspect('16：9')).toBe('16:9');
    expect(normalizeAspect('宽屏')).toBe(DEFAULT_ASPECT_RATIO);
    expect(isVerticalAspect('9:16')).toBe(true);
    expect(isVerticalAspect('16:9')).toBe(false);
  });

  test('供应商尺寸白名单按宽高比取近，不再直接塞 1024x1024', () => {
    expect(imageSizeForAspect('16:9', ['1024x1024', '1280x720', '720x1280'])).toBe('1280x720');
    expect(imageSizeForAspect('9:16', ['1024x1024', '1280x720', '720x1280'])).toBe('720x1280');
    expect(imageSizeForAspect('21:9', ['1024x1024', '1280x720'])).toBe('1280x720');
  });

  test('Agnes 视频比例跟随项目画幅，不再写死 9:16', () => {
    expect(agnesAspectRatio('16:9')).toBe('16:9');
    expect(agnesAspectRatio('21:9')).toBe('16:9');
    expect(agnesAspectRatio('9:16')).toBe('9:16');
    expect(agnesAspectRatio('3:4')).toBe('9:16');
    expect(agnesAspectRatio('1:1')).toBe('1:1');
  });
});

describe('画幅 · 提示词层', () => {
  test('图片构图声明写清比例、禁止方图裁切与补边', () => {
    const line = aspectCompositionLine('16:9');
    expect(line).toContain('横屏构图');
    expect(line).toContain('16:9');
    expect(line).toContain('不得裁成正方形');
    expect(line).toContain('不得加黑边');
    const vertical = aspectCompositionLine('9:16');
    expect(vertical).toContain('竖屏构图');
    expect(vertical).toContain('9:16');
  });

  test('视频比例保护句含「保持…构图，不破坏画面比例」', () => {
    expect(aspectGuardLine('16:9')).toContain('不破坏画面比例');
    expect(aspectGuardLine('9:16')).toContain('与首帧图同一比例');
  });
});

describe('画面文字 · 全通道硬约束', () => {
  test('所有禁字品类都写进一句声明', () => {
    const line = imageTextPolicy();
    for (const k of ['字体', '文字', '字幕', '水印', 'logo', '招牌字', 'UI 文字', '字符']) {
      expect(line).toContain(k);
    }
    expect(line).toContain('后期叠加');
  });

  test('负面词永远包含字体/字幕/水印，且总数封顶 8', () => {
    const terms = composeImageNegativePrompt({ riskTerms: ['多余人物', '手指畸形', '画面撕裂', '道具穿模'] });
    for (const k of IMAGE_NEGATIVE_BASE) expect(terms).toContain(k);
    expect(terms.split('，').length).toBeLessThanOrEqual(8);
    expect(composeImageNegativePrompt({ riskTerms: [] })).toContain('字体');
  });

  test('exact_readable 道具是唯一显式例外，且例外只限道具表面', () => {
    const line = imageTextPolicy({ readablePropTexts: ['剑认其主'] });
    expect(line).toContain('唯一例外');
    expect(line).toContain('剑认其主');
    expect(line).toContain('不得出现任何文字');
    expect(line).toContain('不得放大成字幕');
  });

  test('用户显式开启画面字幕时仍不允许模型自己生成对白字幕', () => {
    const line = imageTextPolicy({ allowOnScreenText: true });
    expect(line).toContain('后期叠加');
    expect(line).toContain('不要自行生成对白字幕');
  });

  test('图片约束块同时带画幅、禁字、场景事实与中文风格', () => {
    const block = renderImageConstraintBlock({
      aspectRatio: '16:9',
      sceneEnv,
      styleBlock: '电影感，低饱和冷调',
    });
    expect(block).toContain('【画面约束 · 不可变】');
    expect(block).toContain('16:9');
    expect(block).toContain('字体');
    expect(block).toContain('【场景环境 · 事实】');
    expect(block).toContain('雨打玻璃');
    expect(block).toContain('电影感，低饱和冷调');
  });
});

describe('场景描述 · 结构化精准事实', () => {
  test('每个字段都渲染成可核对的中文事实，且不编造缺项', () => {
    const line = renderSceneEnv(sceneEnv);
    for (const label of ['时间', '天气', '内/外景', '空间与结构', '主光源', '光位', '光质', '色调', '空气介质', '人物与空间', '构图', '环境音']) {
      expect(line).toContain(label);
    }
    expect(line).toContain('雨夜 21:30');
    expect(line).toContain('只作为视频声场依据，不进画面');
    expect(renderSceneEnv({ timeOfDay: '黄昏' })).not.toContain('天气');
    expect(renderSceneEnv(null)).toBe('');
  });

  test('脏值被收敛：非字符串、超长、换行都不会污染提示词', () => {
    const env = normalizeSceneEnv({
      timeOfDay: 123,
      weather: '  小雨\n转阴  ',
      place: 'x'.repeat(500),
      bogus: '不该出现',
    });
    expect(env.timeOfDay).toBeUndefined();
    expect(env.weather).toBe('小雨 转阴');
    expect(env.place?.length).toBeLessThanOrEqual(200);
    expect(SCENE_ENV_FIELDS).not.toContain('bogus');
    expect(normalizeSceneEnv(null)).toEqual({});
    expect(normalizeSceneEnv('字符串')).toEqual({});
  });

  test('分镜 LLM 契约要求 sceneEnv、精准场景与禁字，且不注入英文画风标签', () => {
    const prompt = buildBoardsPrompt('林晚推门进店', style, '', 90, null, undefined, '16:9');
    expect(prompt).toContain('sceneEnv');
    expect(prompt).toContain('【场景描述 · 精确性铁律】');
    expect(prompt).toContain('【画面文字 · 铁律】');
    expect(prompt).toContain('16:9');
    expect(prompt).toContain('禁止按 1:1 方形构图思考');
    expect(prompt).toContain(SCENE_ENV_CONTRACT);
    expect(prompt).toContain(ONSCREEN_TEXT_RULES);
    expect(prompt).not.toContain(style.visual);
    expect(prompt).not.toContain(style.tone);
    expect(prompt).not.toContain(style.camera);
  });
});

describe('首帧图片 · 两段结构里必须带硬约束', () => {
  test('有参考图时：画幅/禁字/场景进入不可变段，图N 仍是真实位置', () => {
    const composed = composeShotReferences({
      characters: [{ id: 'c1', name: '林晚', primaryUrl: '/p.png', lock: '深蓝旗袍' }],
      scene: { id: 'l1', name: '旧书店', url: '/s.png' },
      constraint: { aspectRatio: '9:16', sceneEnv },
    });
    const prompt = buildShotPrompt('@林晚 抬头看向门口', composed);
    expect(prompt).toContain('【一致性上下文 · 不可变】');
    expect(prompt).toContain('【本镜画面 · 可变】');
    expect(prompt).toContain('【画面约束 · 不可变】');
    expect(prompt).toContain('9:16');
    expect(prompt).toContain('不得出现任何文字');
    expect(prompt).toContain('雨夜 21:30');
    expect(prompt).toContain('@图1');
    expect(prompt).not.toContain('[图N]');
  });

  test('一个资产都没绑上也不能裸发：仍带画幅与禁字', () => {
    const composed = composeShotReferences({ constraint: { aspectRatio: '16:9' } });
    const prompt = buildShotPrompt('雨夜街道空镜', composed);
    expect(prompt).toContain('16:9');
    expect(prompt).toContain('字体');
    expect(prompt).toContain('不得裁成正方形');
    expect(prompt).toContain('雨夜街道空镜');
  });

  test('不传策略时保持旧行为（历史调用方与无参考图场景兼容）', () => {
    expect(buildShotPrompt('纯文本', composeShotReferences({}))).toBe('纯文本');
    expect(composeShotReferences({}).constraintBlock).toBe('');
  });
});

describe('视频提示词 · 场景/画幅/禁字压尾', () => {
  const base = {
    duration: 6,
    beats: [{ from: 0, to: 3, description: '推门' }, { from: 3, to: 6, description: '回头' }],
    description: '推门进店',
  };

  test('【禁止】最后一行同时含禁字与画幅保护，场景环境另起一段', () => {
    const r = buildSegmentedVideoPrompt({
      ...base,
      constraint: { aspectRatio: '16:9', sceneEnv, styleBlock: '低饱和冷调' },
    });
    const lines = r.prompt.split('\n');
    expect(lines[lines.length - 1]).toContain('【禁止】');
    expect(lines[lines.length - 1]).toContain('不得出现任何文字');
    expect(lines[lines.length - 1]).toContain('不破坏画面比例');
    expect(r.prompt).toContain('【场景环境 · 事实】');
    expect(r.prompt).toContain('雨打玻璃');
    expect(r.prompt).toContain('【视觉风格】低饱和冷调');
    expect(r.prompt).toContain('画幅 16:9');
  });

  test('显式开启画面字幕时不追加禁字句，但画幅保护仍在', () => {
    const r = buildSegmentedVideoPrompt({
      ...base,
      negativeText: false,
      constraint: { aspectRatio: '9:16' },
    });
    const last = r.prompt.split('\n').pop() ?? '';
    expect(last).toContain('【禁止】');
    expect(last).not.toContain('不得出现任何文字');
    expect(last).toContain('不破坏画面比例');
  });

  test('没有策略时仍有底线禁字（旧行为不回退）', () => {
    const r = buildSegmentedVideoPrompt(base);
    expect(r.prompt.split('\n').pop()).toContain('【禁止】');
    expect(r.prompt).toContain('不得出现任何文字');
  });
});

describe('语言纪律 · 新增 sceneEnv 同样受约束', () => {
  test('sceneEnv 里的品牌/字体词被清洗，不落进图像提示词', () => {
    const [shot] = normalizeBoardsLanguage(
      [{ visualPrompt: '林晚站在 Verdana 招牌旁', sceneEnv: { place: '袍服上 Verdana 字样刺绣' } }],
      '林晚推门进店',
      'zh',
    );
    expect(shot.sceneEnv?.place).not.toContain('Verdana');
  });

  test('sceneEnv 的英文描述参与语言违规判定', () => {
    const v = countLanguageViolations(
      [{ sceneEnv: { place: 'A dimly lit old bookstore with wooden shelves everywhere' } }],
      'zh',
    );
    expect(v.checked).toBeGreaterThan(0);
    expect(v.violating).toBeGreaterThan(0);
  });
});
