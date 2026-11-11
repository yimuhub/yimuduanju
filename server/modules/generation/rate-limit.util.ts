/**
 * 上游限流 / 瞬时故障判定（从 job-worker.service.ts 机械抽出，行为零变化）
 * ─────────────────────────────────────────────
 * 只含纯常量与纯函数。说明：这仍是基于错误文案的匹配 —— 网关抛的是
 * BadRequestException(message)，没有携带结构化 code。彻底修复需要让
 * ModelGatewayService 抛带 code 的类型化错误，那是一次跨模块重构；
 * 此处先把判定集中到一处并收紧正则：
 * 旧的 /\b503\b/ 会命中被回显的用户 prompt 文本（例如剧本里出现「503」），
 * 把一次真实的业务失败误判成限流，从而无限重试且不消耗重试次数。
 */

/** 上游限流冷却时长（按 provider 维度，见 providerHoldUntil） */
export const RATE_LIMIT_COOLDOWN_MS = 20_000;
/** 连续限流的指数退避上限（20s→40s→…→300s 封顶），成功生成后清零 */
export const RATE_LIMIT_COOLDOWN_MAX_MS = 300_000;
/** 未被路由到具体 provider 的任务在冷却表里的占位键 */
export const DEFAULT_PROVIDER_KEY = '__default__';

const RATE_LIMIT_PATTERNS: RegExp[] = [
  /pool saturated/i,
  /rate[_\s-]?limit/i,
  /too many requests/i,
  /\b429\b/,
  /\(\s*503\s*[,)]/, // 网关错误文案形如「视频生成失败 (503, https://…)」
  /HTTP\s*503\b/i,
  /status(?:\s*code)?[:=]?\s*503\b/i,
];

export function isRateLimitMessage(message: string): boolean {
  return RATE_LIMIT_PATTERNS.some((re) => re.test(message));
}

/**
 * Provider / API Key 未配置：确定性配置缺失，重试不会改变结果，
 * 保持 pending 等人工配置，且不消耗重试次数。
 */
const MISSING_PROVIDER_PATTERNS: RegExp[] = [
  /API Key/i,
  /未配置/,
  /不存在或已禁用/,
];

export function isMissingProviderMessage(message: string): boolean {
  return MISSING_PROVIDER_PATTERNS.some((re) => re.test(message));
}
