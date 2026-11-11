/**
 * 单镜时长策略（服务端物化 / 分镜技能共用）
 * ------------------------------------------------------------------
 * 铁律：镜头时长由内容决定，禁止把整片所有镜头写成同一个值。
 * - 口播镜头：按对白字数 ÷ 语速分档估时 + 停顿 + 首尾余量
 * - 全景/远景、运镜镜头：额外给 1s 交代空间与运动
 * - 硬下限 8s、常规上限 10s，长对白/完整起承转合允许到 12-15s
 * 下限不落到 4-6s：短切片会把一句台词/一个动作拦腰截断，成片必然跳。
 */

export const SHOT_MIN_SECONDS = 8;
export const SHOT_TARGET_MAX_SECONDS = 10;
export const SHOT_HARD_MAX_SECONDS = 15;

/** 首尾呼吸余量（Toonflow：首尾各留约 1s，取 0.6+0.6 收口短剧节奏） */
export const SPEECH_RESERVE_SECONDS = 1.2;
/** 每个明显停顿的额外时长 */
export const PAUSE_SECONDS = 0.35;

const PAUSE_PATTERN = /[，。！？…；、,\.!?;]/g;
const CJK_PATTERN = /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/g;

/**
 * 语速分档（移植 Toonflow 行业数字）：
 * 急促约 4 字/秒、正常约 3 字/秒、悲伤约 2 字/秒。
 * 用 4 字/秒估所有台词会系统性偏短，一镜念不完只能靠加速语速补救，
 * 结果就是短剧最常见的"嘴跟不上字幕"。
 */
export function inferSpeechPace(text: string, emotion?: string | null): number {
  const hay = `${emotion ?? ''}${text ?? ''}`;
  if (/急|怒|吼|喊|催|慌|斥|厉声|喝/.test(hay)) return 4;
  if (/悲|哭|哽咽|虚弱|沙哑|颤|叹|低语|临终|无力/.test(hay)) return 2;
  return 3;
}

/**
 * 台词朗读时长：字数 ÷ 语速 + 标点停顿。
 * 会剔掉「林晚：」这类角色前缀——它不该计入朗读字数，
 * 但旧实现整串都算，长角色名会把时长估高半秒。
 */
export function estimateDialogueSeconds(
  dialogue: string,
  emotion?: string | null,
): number {
  const text = dialogue ?? '';
  if (!text.trim()) return 0;
  const prefix = /^[^：:\n]{1,12}[：:]\s*/.exec(text);
  const prefixCjk = prefix ? (prefix[0].match(CJK_PATTERN) ?? []).length : 0;
  const body = prefix ? text.slice(prefix[0].length) : text;
  const cjk = Math.max(0, (text.match(CJK_PATTERN) ?? []).length - prefixCjk);
  const latinWords = (body.match(/[A-Za-z0-9]+(?:'[A-Za-z]+)?/g) ?? []).length;
  const pauses = Math.min((body.match(PAUSE_PATTERN) ?? []).length, 6);
  const pace = inferSpeechPace(body, emotion);
  return cjk / pace + latinWords / 2.5 + pauses * PAUSE_SECONDS;
}

const WIDE_SIZES = new Set(['wide', 'long', 'extreme_long', 'establishing']);
const MOVING_RIGS = new Set([
  'dolly', 'orbit', 'crane', 'aerial', 'follow', 'retreat', 'pan', 'zoom',
]);

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

/**
 * 内容驱动单镜时长。
 * `suggested` 为模型给的原始值：只作为参考，低于下限一律抬到内容算出的值，
 * 高于内容值则采纳（模型判断该镜需要更长表演时尊重它）。
 */
export function contentDrivenShotSeconds(input: {
  dialogue?: string | null;
  shotSize?: string | null;
  movement?: string | null;
  suggested?: number | null;
  hardMax?: number;
  /** 情绪/语气提示（如「哽咽」「厉声」），用于决定语速分档 */
  emotion?: string | null;
  /**
   * 下限覆盖：默认 8s（口播类长镜，避免把一句话拦腰截断）。
   * 剧情分镜按真实节奏可传 4s——视频模型本身支持 4s 起，
   * 「一句短台词也占 8 秒」是短剧节奏拖沓的直接原因。
   */
  minSeconds?: number;
}): number {
  const min = clampInt(input.minSeconds ?? SHOT_MIN_SECONDS, 1, SHOT_HARD_MAX_SECONDS);
  const hardMax = clampInt(input.hardMax ?? SHOT_HARD_MAX_SECONDS, min, 30);
  // 语速分档 + 标点停顿 + 首尾余量（不再一律 4 字/秒）
  const speech = estimateDialogueSeconds(input.dialogue ?? '', input.emotion);
  let seconds = speech > 0.5 ? Math.ceil(speech + SPEECH_RESERVE_SECONDS) : min;
  if (WIDE_SIZES.has(input.shotSize ?? '')) seconds += 1;
  if (MOVING_RIGS.has(input.movement ?? '')) seconds += 1;

  const suggested = Number(input.suggested);
  if (Number.isFinite(suggested) && suggested > seconds) {
    seconds = Math.ceil(suggested);
  }
  return clampInt(seconds, min, hardMax);
}

/**
 * 按模型能力贴合时长：声明了离散能力表（如 5/10）时取最接近档位，
 * 未声明时原样返回（由各通道自己的上下限兜底）。
 */
export function snapToAllowedDurations(want: number, allowed?: readonly number[]): number {
  if (!allowed || allowed.length === 0) return want;
  return allowed.reduce(
    (best, d) => (Math.abs(d - want) < Math.abs(best - want) ? d : best),
    allowed[0],
  );
}

/**
 * 单镜最小可读时长：台词必须念得完（语速分档 + 停顿 + 首尾余量），
 * 不含景别/运镜的额外加成——那部分是"可以砍的余量"。
 */
export function minimumReadableSeconds(
  dialogue?: string | null,
  emotion?: string | null,
  floor = 4,
): number {
  const speech = estimateDialogueSeconds(dialogue ?? '', emotion);
  if (speech <= 0.5) return floor;
  return Math.max(floor, Math.ceil(speech + SPEECH_RESERVE_SECONDS));
}

/**
 * 总时长预算收口（移植 Toonflow「严格时长按 A3 做预算」）。
 * ------------------------------------------------------------------
 * 问题：单镜时长按内容算，镜数一多总量必然超项目设定的总时长
 * （60s 的项目物化出 83s，导出的时间线和用户预期对不上）。
 * 原则：**只能砍余量，不能砍台词**。
 *   - 每镜有"最小可读时长"（台词念得完）；
 *   - 超出目标的部分，按各镜余量（want - min）比例回收；
 *   - 余量全部回收完仍超，就如实报告 overflow，让用户决定删台词还是加时长，
 *     绝不静默截断对白。
 *
 * @param tolerance 允许超出的比例（默认 10%：短剧少 3-5 秒无感，硬卡反而砍表演）
 */
export function fitTotalBudget(
  wants: number[],
  mins: number[],
  target: number,
  tolerance = 1.1,
): { seconds: number[]; total: number; overflow: number } {
  const n = wants.length;
  if (n === 0 || !Number.isFinite(target) || target <= 0) {
    const total = wants.reduce((a, b) => a + b, 0);
    return { seconds: [...wants], total, overflow: 0 };
  }
  const total = wants.reduce((a, b) => a + b, 0);
  if (total <= target * tolerance) {
    return { seconds: [...wants], total, overflow: 0 };
  }

  const slack = wants.map((w, i) => Math.max(0, w - (mins[i] ?? 0)));
  const totalSlack = slack.reduce((a, b) => a + b, 0);
  if (totalSlack <= 0) {
    return { seconds: [...wants], total, overflow: total - target };
  }

  const need = total - target;
  const ratio = Math.min(1, need / totalSlack);
  const seconds = wants.map((w, i) => {
    const cut = Math.round(slack[i] * ratio);
    return Math.max(mins[i] ?? 0, w - cut);
  });
  const newTotal = seconds.reduce((a, b) => a + b, 0);
  return { seconds, total: newTotal, overflow: Math.max(0, newTotal - target) };
}
