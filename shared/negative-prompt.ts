/**
 * 风险自适应负面词（移植 Toonflow 导演规则的「别全片堆禁止词」）
 * ------------------------------------------------------------------
 * Toonflow 原文：不要全片堆几十个「禁止」词，只对真正有风险的那一段写一两条
 * 针对性的。他们列的高风险清单：
 *   - 三个以上的人同时大幅动作（容易多出人 / 换脸）
 *   - 双手操作小物件的同时还要复杂运镜（手指畸形、道具穿模）
 *   - 镜子、玻璃、水面（容易多复制出一个人或一只手）
 *   - 包装小字需要特写还要快速移动
 *
 * 我们的旧做法正好相反：每条 prompt 都挂同一串长负面词。负面词一多，
 * 模型会把注意力从"要画什么"挪到"别画什么"，结果是画面变糊、动作变形。
 * 这里改成：固定的技术底线（字幕/文字/字体/水印/logo，来自 prompt-formula 的
 * 单一真源）+ 按本镜风险最多追加 2 条，总数封顶 8。
 *
 * 注意通道差异：Agnes 图片队列不接受 negative_prompt（传了直接 400），
 * 由网关按 formatType 过滤；本模块只负责"该说什么"，不管"能不能说"。
 */

/**
 * 技术底线：任何一镜都不要的东西（不含风格词，避免和画风打架）。
 * 与图片/视频正文里的「画面文字硬约束」共用同一份清单，避免一处写「无文字」、
 * 另一处的负面词里连「字体」都没有。
 */
import { IMAGE_NEGATIVE_BASE } from './prompt-formula';

const BASE_NEGATIVES: readonly string[] = IMAGE_NEGATIVE_BASE;

/** 总数上限：超过这个数，负面词开始反向伤害画面质量 */
export const NEGATIVE_PROMPT_MAX_TERMS = 8;

const MOVING_RIGS = new Set([
  'dolly', 'orbit', 'crane', 'aerial', 'follow', 'retreat', 'pan', 'zoom',
]);

const MIRROR_HINTS = ['镜', '玻璃', '窗', '水面', '倒影', '反光', '湖面', '河面', '屏幕'];
const HAND_PROP_HINTS = [
  '手持', '握着', '拿着', '捏着', '扶着', '端着', '握着', '递', '递过',
  '戒指', '手机', '钥匙', '杯子', '杯', '笔', '烟', '筷子', '碗', '照片', '信',
];
const CLOSE_SIZES = new Set(['closeup', 'extreme_closeup', 'medium_closeup']);

export interface NegativePromptInput {
  /** 本镜画面描述（不用整段 prompt，只用于风险特征识别） */
  prompt?: string | null;
  /** 本镜出场人数 */
  characterCount?: number;
  shotSize?: string | null;
  movement?: string | null;
}

/**
 * 按本镜实际风险拼负面词。
 * 返回逗号分隔字符串；无风险时只回技术底线。
 */
export function composeNegativePrompt(input: NegativePromptInput): string {
  const text = String(input.prompt ?? '');
  const terms: string[] = [...BASE_NEGATIVES];
  const risks: string[] = [];

  // 风险 1：三个以上的人同框 —— 最容易多出人、群像换脸
  if ((input.characterCount ?? 0) >= 3) {
    risks.push('多余人物', '人物面部重复');
  }

  // 风险 2：镜面 / 玻璃 / 水面 —— 模型爱在倒影里多复制一个人或一只手
  if (MIRROR_HINTS.some((k) => text.includes(k))) {
    risks.push('镜像重影', '多余肢体');
  }

  // 风险 3：手部操作小物件 + 近景 —— 手指畸形与道具穿模高发区
  const handProp = HAND_PROP_HINTS.some((k) => text.includes(k));
  if (handProp && CLOSE_SIZES.has(String(input.shotSize ?? ''))) {
    risks.push('手指畸形', '道具穿模');
  }

  // 风险 4：复杂运镜 —— 快速环绕/跟拍会把结构拉歪
  if (MOVING_RIGS.has(String(input.movement ?? ''))) {
    risks.push('画面撕裂', '人物形变');
  }

  // 只取最靠前的两条：Toonflow 的"一两条针对性"，多了反而摊薄注意力
  for (const r of risks.slice(0, 2)) {
    if (!terms.includes(r)) terms.push(r);
  }
  return terms.slice(0, NEGATIVE_PROMPT_MAX_TERMS).join('，');
}

/**
 * 站位描述：Toonflow 要求每段都把站位从头写一遍，禁止「同上」「延续上一段」。
 * 视频模型看不到上一段，省略等于让它自己猜，接上必然跳。
 * 这里按确定性规则给一句可复核的站位，避免让模型自由发挥。
 */
export function composeBlocking(input: {
  speaker?: string | null;
  listener?: string | null;
  /** 该镜在场景内的序号（从 0 起），用于左右交替，做出正反打 */
  index: number;
  shotSize?: string | null;
}): string {
  const speaker = (input.speaker ?? '').trim();
  const listener = (input.listener ?? '').trim();
  const rank = String(input.shotSize ?? '');
  const wide = rank === 'wide' || rank === 'long' || rank === 'extreme_long';

  if (wide) {
    return speaker
      ? `${speaker}位于画面中景偏${input.index % 2 === 0 ? '左' : '右'}，环境占画面主导，人物为全身/大半身`
      : '环境与人物位置关系交代清楚，人物为全身/大半身';
  }
  if (speaker && listener && listener !== speaker) {
    // 正反打：说话人居左，听者虚化在右（下一镜自动反过来）
    return input.index % 2 === 0
      ? `${speaker}居画面左侧面向右，${listener}虚化在画面右侧背景`
      : `${speaker}居画面右侧面向左，${listener}虚化在画面左侧背景`;
  }
  if (speaker) {
    return `${speaker}居画面中央，身体朝向与视线方向明确，背景留出景深`;
  }
  return '主体居画面中央，前中后景层次清楚';
}
