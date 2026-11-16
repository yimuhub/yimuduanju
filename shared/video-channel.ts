/**
 * 视频通道判定（唯一真源，纯函数）
 * ============================================================================
 * 背景：网关旧实现靠 `formatType === 'agnes' || agnesSchema === 'relay'` 隐含
 * 推断通道，于是出现两类事故：
 *
 * 1) 设置页把官方 Agnes 端点配成 `openai` 格式（历史上真发生过），网关按通用
 *    `/video/generations` 发请求，Agnes 只认 `/videos` + 方言字段，必然 400。
 * 2) 通用通道的供应商（火山 / 自建中转）被联邦密钥池「顺手」租到 Agnes 的 Key，
 *    用户明明选的是通用通道，实际走了 Agnes，报错信息与所选配置对不上。
 *
 * 用户的诉求很明确：**Agnes 是一个独立选项，不是通用选项**；只有配了 Agnes
 * 密钥（或接通该模型）时才应生效；同时要有一条独立的通用视频 API 通道。
 *
 * 因此把「这条视频请求到底走哪个方言」收敛成这个纯函数，网关、密钥池、设置页
 * 共用同一份判断，任何一处都不许再自己写 `includes('agnes')`。
 */

export type VideoChannel = 'agnes' | 'generic' | 'volcengine_ark';

/** 供应商上可显式声明通道；auto 表示交给下面的规则推断 */
export type VideoChannelPreference = VideoChannel | 'auto';

export interface VideoChannelInput {
  formatType?: string | null;
  baseUrl?: string | null;
  videoModel?: string | null;
  modelParams?: Record<string, unknown> | null;
}

/** 只有 Agnes 官方端点使用这个域名；中转/自建通常不是 */
const AGNES_HOST = /(^|\.)agnes-ai\.com/i;

/** `agnes-video-2.5-flash` / `agnes/agnes-video-2.5-flash` 这类模型名 */
const AGNES_MODEL = /^agnes[-/]/i;

function text(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/** modelParams.videoChannel 的合法值；脏数据一律视为 auto */
export function parseVideoChannelPreference(v: unknown): VideoChannelPreference {
  const s = text(v).toLowerCase().replace(/-/g, '_');
  if (s === 'agnes') return 'agnes';
  if (s === 'generic' || s === 'openai' || s === 'openai_compatible') return 'generic';
  if (s === 'volcengine_ark' || s === 'volcano' || s === 'ark') return 'volcengine_ark';
  return 'auto';
}

/**
 * formatType 归一化。
 * DB 里真实存在 `volcano`（旧版本写入口径），枚举里却是 `volcengine_ark`。
 * 不归一化就会掉进通用分支、拿空 baseUrl 去发请求 —— 这是「火山配了但视频
 * 一次都没成功」的隐藏原因。
 */
export function normalizeFormatType(v: unknown): string {
  const s = text(v).toLowerCase();
  if (s === 'volcano' || s === 'volcengine' || s === 'volcengine_ark') return 'volcengine_ark';
  if (s === 'agnes') return 'agnes';
  if (s === 'mock') return 'mock';
  return s || 'openai';
}

/** 端点是否是 Agnes（判断「能不能吃 Agnes 方言」，与 formatType 无关） */
export function isAgnesEndpoint(input: Pick<VideoChannelInput, 'baseUrl'>): boolean {
  return AGNES_HOST.test(text(input.baseUrl));
}

/**
 * 解析视频通道。优先级（从强到弱）：
 *   1. 供应商显式声明 modelParams.videoChannel（非 auto）
 *   2. formatType = agnes（官方专用格式）
 *   3. modelParams.agnesSchema = 'relay'（本地中继，说的也是 Agnes 方言）
 *   4. baseUrl 命中 agnes-ai.com（兼容「把官方端点配成 openai」的历史数据）
 *   5. videoModel 是 agnes-* （同上，凭模型名兜底）
 *   6. formatType = volcengine_ark（含 volcano 归一化）
 *   7. 其余 → generic（OpenAI 兼容 /video/generations）
 *
 * 注意顺序：volcengine_ark 放在 Agnes 兜底之后，因为方舟的 baseUrl/model
 * 不会命中 Agnes 特征；显式声明永远最优先，便于用户强行纠偏。
 */
export function resolveVideoChannel(input: VideoChannelInput): VideoChannel {
  const preference = parseVideoChannelPreference(input.modelParams?.videoChannel);
  if (preference !== 'auto') return preference;

  const formatType = normalizeFormatType(input.formatType);
  if (formatType === 'agnes') return 'agnes';

  const agnesSchema = text(input.modelParams?.agnesSchema).toLowerCase();
  if (agnesSchema === 'relay') return 'agnes';

  if (isAgnesEndpoint(input)) return 'agnes';
  if (AGNES_MODEL.test(text(input.videoModel))) return 'agnes';

  if (formatType === 'volcengine_ark') return 'volcengine_ark';
  return 'generic';
}

/** 通道是否要求首帧/参考图必须是公网 http(s) */
export function channelRequiresPublicMedia(channel: VideoChannel): boolean {
  // Agnes 官方与中继都只认公网 URL；通用通道里火山也收 url，
  // 但部分 OpenAI 兼容中转能吃 data URL，交给供应商 modelParams 决定，
  // 这里只对「必须公网」的 Agnes 给出确定答案。
  return channel === 'agnes';
}

export function videoChannelLabel(channel: VideoChannel): string {
  switch (channel) {
    case 'agnes':
      return 'Agnes 专用通道';
    case 'volcengine_ark':
      return '火山方舟通道';
    default:
      return '通用视频 API 通道';
  }
}

/** 设置页用的说明文案，保持与实现一致，避免界面承诺超过代码能力 */
export function videoChannelHint(channel: VideoChannelPreference): string {
  switch (channel) {
    case 'agnes':
      return '专用通道：POST /videos，mode=text/keyframe/reference。需要 Agnes 密钥与 agnes-video-* 模型；参考图必须是公网 URL（系统会自动先入图库）。';
    case 'generic':
      return '通用通道：POST /video/generations，OpenAI 兼容。首帧用 image_url 传递，不支持 Agnes 方言字段。';
    case 'volcengine_ark':
      return '火山方舟：POST /contents/generations/tasks，首帧字段为 image_url，需配置方舟 baseUrl 与模型。';
    default:
      return '自动识别：按供应商格式与端点判断（Agnes 端点/模型走专用通道，其余走通用通道）。';
  }
}
