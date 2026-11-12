/**
 * 五段式视频 prompt 公式 + 全通道「画面策略」单一真源
 * ------------------------------------------------------------------
 * [Cinematography] + [Subject] + [Action] + [Context] + [Style & Ambiance]，
 * 单段落、无 markdown。AdForge 要求 60-150 英词；中文 prompt 不适用词数，
 * 只保留结构与“风格圣经逐字复用”纪律（prompts.py:74-75）。
 *
 * 本文件同时收敛三件跨通道的事（分镜 LLM / 首帧图片 / 视频 / 生图参数）：
 *   1. 画面内绝不出现字体、文字、字幕、水印（用户硬要求 + 对标 ddcat-ai 全局负面词、
 *      drama-skills 的 `no text, no logo`、MN0709 的 [负面提示词]/[语言锁]）；
 *   2. 画幅比例必须同时写进提示词文本与 API 参数（对标 taylorzhou16/video-gen：
 *      Image Prompt 必含「竖屏构图，9:16画面比例…」+ Aspect ratio 字段，
 *      video_prompt 必含「保持{比例}构图，不破坏画面比例」，--aspect-ratio 从
 *      storyboard.json 读取；ArcReel 的 Image Prompt 开头即「9:16竖屏构图」）；
 *   3. 逐镜场景环境用结构化事实描述（对标 bolecodex 的 lighting/focus/color_tone/
 *      framing 必填、MN0709 的【整体场景与氛围】清单、火宝的 atmosphere 字段）。
 * 任何通道不得再自己写一套默认值或另起一句禁字口径。
 */

import type { SceneEnvironment } from './api.interface';
import {
  DEFAULT_ASPECT_RATIO,
  isHorizontalAspect,
  isVerticalAspect,
  normalizeAspect,
} from './aspect';

export interface FivePartInput {
  cinematography?: string;
  subject?: string;
  action?: string;
  context?: string;
  style?: string;
}

export function buildFivePart(input: FivePartInput): string {
  return [
    input.cinematography,
    input.subject,
    input.action,
    input.context,
    input.style,
  ]
    .map((s) => (s ?? '').trim().replace(/\s+/g, ' '))
    .filter((s) => s.length > 0)
    .join('。');
}

/**
 * 通用负面约束（移植 YouPipe short_drama.py:28，seedance-skill 铁律 4：
 * 负面约束必须具体到错误品类，不写“低质量”这种空话）。
 * 网关视频接口无 negative 字段，拼进 prompt 正文声明。
 */
export const CINEMATIC_NEGATIVE =
  '避免：人物形变、多余手指、面部扭曲、画面闪烁、果冻形变、模糊低清、水印、凭空出现的文字字幕、白模塑料质感、无意义的教学拆解与箭头标签';

/**
 * 视频画面文字策略：默认关闭画面内字幕。
 * 字幕/对白统一由时间线后期烧录，模型把字烧进画面会与后期字幕叠加、遮脸、
 * 且无法再改文案；因此提交视频任务时默认追加这条约束，用户显式开启才放行。
 */
/**
 * 画面文字硬约束（图片与视频共用一句，避免两套口径互相打架）。
 * 「字体 / 字符 / 笔画」也要写死：只说「无字幕」时模型仍会画出招牌字、
 * 包装小字、屏幕 UI，最终字幕叠加时遮脸且无法改文案。
 */
export const IMAGE_TEXT_BAN =
  '画面内不得出现任何文字、字体、字幕、对白文字、旁白文字、标题、招牌字、贴纸文字、水印、logo 或 UI 文字；不要生成任何可读或不可读的字符、字母、数字或笔画；台词与字幕一律由后期叠加，本画面只输出干净图像。';

export const NO_ONSCREEN_TEXT = IMAGE_TEXT_BAN;

const TEXT_BAN_RE = /(不要|不得|避免|禁止)[^，。；\n]{0,8}(字幕|文字)|无字幕|no subtitles?/i;

/** 按项目/单次开关决定是否把“画面无文字”约束拼进视频 prompt（幂等） */
export function withVideoTextPolicy(prompt: string, allowOnScreenText = false): string {
  const base = prompt.trim();
  if (!base || allowOnScreenText) return base;
  if (base.includes(NO_ONSCREEN_TEXT) || TEXT_BAN_RE.test(base)) return base;
  return `${base}\n${NO_ONSCREEN_TEXT}`;
}

export interface StyleBibleLike {
  visualStyle?: string;
  cameraLanguage?: string;
  colorPalette?: string;
  lighting?: string;
  texture?: string;
  motionLanguage?: string;
}

/** 风格圣经 → Style 段：有料才拼，无圣经时返回空（不编造） */
export function styleBibleToStyle(bible?: StyleBibleLike | null): string {
  if (!bible) return '';
  return [
    bible.visualStyle,
    bible.cameraLanguage,
    bible.colorPalette,
    bible.lighting,
    bible.texture,
    bible.motionLanguage,
  ]
    .map((s) => (s ?? '').trim())
    .filter((s) => s.length > 0)
    .join('，');
}

/* ==================================================================
 * 一、逐镜场景环境（结构化事实，不是形容词）
 * ================================================================== */

export const SCENE_ENV_FIELDS = [
  'timeOfDay', 'weather', 'locationType', 'place', 'lightSource',
  'lightDirection', 'lightQuality', 'colorPalette', 'atmosphere',
  'spatialRelation', 'composition', 'ambientSound',
] as const;

type SceneEnvField = (typeof SCENE_ENV_FIELDS)[number];

const SCENE_ENV_LABELS: Record<SceneEnvField, string> = {
  timeOfDay: '时间',
  weather: '天气',
  locationType: '内/外景',
  place: '空间与结构',
  lightSource: '主光源',
  lightDirection: '光位',
  lightQuality: '光质',
  colorPalette: '色调',
  atmosphere: '空气介质',
  spatialRelation: '人物与空间',
  composition: '构图',
  ambientSound: '环境音',
};

/** LLM 输出 / DB jsonb / 旧数据都可能是脏值，统一收敛成可安全拼进提示词的对象。 */
export function normalizeSceneEnv(raw: unknown): SceneEnvironment {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const src = raw as Record<string, unknown>;
  const out: SceneEnvironment = {};
  for (const key of SCENE_ENV_FIELDS) {
    const v = src[key];
    if (typeof v !== 'string') continue;
    const cleaned = v.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
    if (cleaned) out[key] = cleaned;
  }
  return out;
}

/** 把场景环境渲染成一段摄影机能核对的事实，缺依据的项不编造。 */
export function renderSceneEnv(env?: SceneEnvironment | null): string {
  const e = normalizeSceneEnv(env);
  const parts: string[] = [];
  for (const key of SCENE_ENV_FIELDS) {
    const v = e[key];
    if (v) parts.push(`${SCENE_ENV_LABELS[key]}：${v}`);
  }
  if (parts.length === 0) return '';
  return `【场景环境 · 事实】${parts.join('；')}。环境音只作为视频声场依据，不进画面。`;
}

/** 给分镜 LLM 的场景描述规则（与渲染字段一一对应，避免写出渲染不出来的东西）。 */
export const SCENE_ENV_CONTRACT = `【场景描述 · 精确性铁律】每一镜都必须给出 sceneEnv 对象，全部写简体中文，且每一项都是摄影机能记录的物理事实：
- timeOfDay 写具体可拍摄的时间/时段（如「雨夜 21:30」「夏日午后 15:00」），weather 写具体天气；locationType 写「内景」或「外景」。
- place 写清具体地点与空间结构（门、窗、墙、家具各在画面哪一侧），不许写「一个房间」「某处」这种无法布景的词。
- lightSource 写可信主光源的来源；lightDirection 写光从画面哪个方向照进来；lightQuality 写顺光/侧光/逆光与光质；colorPalette 写色温与色调。同一场相邻镜的主光源方向、色温、天气不得无原因跳变。
- atmosphere 写空气里看得见的介质（雨丝、雾、浮尘、水面反光、树影），禁止「氛围感」「电影感」这类抽象词。
- spatialRelation 写人物与道具的前中后景、左右位次；composition 写具体构图法（三分法/引导线/对称/前景遮挡）。
- ambientSound 写 2-4 个具体声源（雨打玻璃、木地板轻响、远处雷声），只作视频声场依据，不是画面内容。
- 剧本没给依据的字段留空字符串，绝不编造；剧本写了的时间、天气、地点、光位必须逐字对齐。
- visualPrompt 只写本镜可见的位置、动作、表情与光影变化，不重复 sceneEnv 已写死的环境事实，禁止「象征着 / 传递出 / 氛围拉满」这类文案腔。`;

/** 给分镜 LLM 的画面文字规则（图片与视频共用，字幕永远走后期）。 */
export const ONSCREEN_TEXT_RULES = `【画面文字 · 铁律】所有分镜图与视频画面里不能出现任何字体、文字、字幕、招牌字、贴纸字、水印、logo、UI 文字或可读字符。台词只写在 dialogue / beats[].dialogue，由后期字幕层叠加，绝不能写成「画面浮现一行字」「招牌上写着…」「屏幕显示…」这类画面描述。剧本确实要求某个道具表面带指定文字时，只登记为该道具的设定，不写进 visualPrompt；除此之外任何镜头都不得要求画面出字。`;

/* ==================================================================
 * 二、画幅：提示词文本层（参数层由 shared/aspect.ts 负责）
 * ================================================================== */

/** 图片提示词里的构图声明；对标 taylorzhou16 的固定比例文案 + ArcReel 的开头写法。 */
export function aspectCompositionLine(aspect?: string | null): string {
  const ar = normalizeAspect(aspect);
  let shape: string;
  if (isVerticalAspect(ar)) {
    shape = `竖屏构图，${ar} 画面比例，人物/主体位于画面中央，上下留白用于交代空间高度关系`;
  } else if (isHorizontalAspect(ar)) {
    shape = ar === '21:9'
      ? `宽银幕横屏构图，${ar} 画面比例，主体沿横向视线关系布置，左右大面积环境`
      : `横屏构图，${ar} 画面比例，主体沿横向视线关系布置，左右留白用于交代环境`;
  } else {
    shape = `正方形构图，${ar} 画面比例，主体居中`;
  }
  return `${shape}。必须按 ${ar} 完整出图，不得裁成正方形或改成其它比例，不得加黑边/白边补幅，也不要把主体按 1:1 居中摆放；构图、景别与运镜都要按这个画幅重新组织。`;
}

/** 视频提示词里的比例保护句（对标「保持{比例}构图，不破坏画面比例」）。 */
export function aspectGuardLine(aspect?: string | null): string {
  const ar = normalizeAspect(aspect);
  const vertical = isVerticalAspect(ar);
  return `保持 ${ar} ${vertical ? '竖屏' : '横屏'}构图，与首帧图同一比例，不破坏画面比例；` +
    (vertical
      ? '运镜避免横向大幅摇移导致画面变横，主体纵向位置稳定'
      : '运镜避免竖向大幅升降导致画面变竖，主体横向位置稳定');
}

/* ==================================================================
 * 三、文字政策与负面词（含道具 exact_readable 的显式例外）
 * ================================================================== */

/** 图片负面词的技术底线：字体/字幕/水印是用户硬要求，任何一镜都要带。 */
export const IMAGE_NEGATIVE_BASE = [
  '字幕', '文字', '字体', '水印', 'logo',
] as const;

export interface TextPolicyInput {
  /** 用户显式开启了「画面字幕」（仅视频）；图片一律 false */
  allowOnScreenText?: boolean;
  /** 本镜 exact_readable 道具表面必须精确出现的文字（唯一合法例外） */
  readablePropTexts?: (string | null | undefined)[];
}

/**
 * 生成一句可直接拼进正面提示词的文字政策。
 * 全局禁字与道具「表面必须出字」必须显式仲裁：旧实现两者同时存在却没有优先级，
 * 结果要么误伤 exact_readable 道具，要么让禁字形同虚设。
 */
export function imageTextPolicy(input: TextPolicyInput = {}): string {
  const exceptions = (input.readablePropTexts ?? [])
    .map((t) => (typeof t === 'string' ? t.trim() : ''))
    .filter(Boolean)
    .slice(0, 3);
  if (input.allowOnScreenText) {
    return '字幕与对白文字统一由后期叠加，本画面不要自行生成对白字幕、标题、招牌字、水印或 UI 文字。';
  }
  if (exceptions.length > 0) {
    return `${IMAGE_TEXT_BAN}唯一例外：道具表面必须精确出现「${exceptions.join('」「')}」，该文字只允许出现在该道具表面，不得放大成字幕、招牌或标题。`;
  }
  return IMAGE_TEXT_BAN;
}

/** 合并底线负面词、用户手填负词与风险词；底线永远保留，总数封顶 8。 */
export function composeImageNegativePrompt(input: {
  negativePrompt?: string | null;
  riskTerms?: (string | null | undefined)[];
  max?: number;
} = {}): string {
  const max = Math.max(IMAGE_NEGATIVE_BASE.length, input.max ?? 8);
  const terms: string[] = [...IMAGE_NEGATIVE_BASE];
  const extras = [
    ...String(input.negativePrompt ?? '').split(/[,，、;；\n]/),
    ...(input.riskTerms ?? []),
  ];
  for (const raw of extras) {
    if (terms.length >= max) break;
    const t = (raw ?? '').toString().trim().slice(0, 40);
    if (t && !terms.includes(t)) terms.push(t);
  }
  return terms.slice(0, max).join('，');
}

export interface ImageConstraintInput extends TextPolicyInput {
  aspectRatio?: string | null;
  sceneEnv?: SceneEnvironment | null;
  /** 中文风格圣经（不注入英文画风标签，避免把画面描述带成英文） */
  styleBlock?: string | null;
}

/**
 * 图片提示词的【画面约束 · 不可变】段。
 * 所有图片通道（分镜首帧、场景/人物/道具设定图、变体图）都从这里取，
 * 不允许某个通道自己另写一句「无水印」就算完。
 */
export function renderImageConstraintBlock(input: ImageConstraintInput = {}): string {
  const lines = ['【画面约束 · 不可变】'];
  lines.push(aspectCompositionLine(input.aspectRatio ?? DEFAULT_ASPECT_RATIO));
  lines.push(imageTextPolicy(input));
  const scene = renderSceneEnv(input.sceneEnv);
  if (scene) lines.push(scene);
  const style = (input.styleBlock ?? '').trim();
  if (style) lines.push(`【视觉风格】${style}`);
  return lines.join('\n');
}

/**
 * 视频提示词压尾的【禁止】行内容（不含标签，由 video-prompt 拼标签）。
 * 画幅保护 + 无文字 + 一镜一运镜，一次说清。
 */
export function renderVideoConstraintLine(input: ImageConstraintInput = {}): string {
  const bits = [
    imageTextPolicy(input),
    aspectGuardLine(input.aspectRatio ?? DEFAULT_ASPECT_RATIO),
    '不要出现分屏或多机位切换',
    '镜头内只允许一个主要运镜',
    '动作在本镜结束时完成到一个明确的停顿点',
  ]
    // 每句自己带句号时先去掉，统一用「；」连接，避免出现「。；」这种脏标点
    .map((s) => s.trim().replace(/[。；]+$/, ''));
  return `${bits.join('；')}。`;
}
