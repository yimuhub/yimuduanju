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
/**
 * 视频队列满（video_queue_full）的固定探测间隔。
 *
 * 为什么不能用上面的指数退避：Agnes 官方文档明确 503 video_queue_full 发生在
 * **建单之前**，被拒的请求不创建任务、不消耗额度，重试是免费的；上游一旦放出
 * 空位，谁敲得勤谁先抢到。指数退避到 300s 意味着饱和期每 5 分钟才探一次，
 * 会直接错过错峰窗口 —— 这正是「一整天一个视频都没出来」的放大器。
 * 队列满单独走短固定档，其余限流仍按指数退避保护上游。
 */
export const VIDEO_QUEUE_FULL_RETRY_MS = 10_000;

/**
 * 视频队列满时**单把 Key** 的探测冷却，以及用于打散的抖动上限。
 *
 * 为什么必须带抖动：4 把 Key 若在同一秒各撞一次 503，就会同时进入等长冷却，
 * 形成「4 连发 → 静默 20s → 4 连发」的齐射模式。Agnes 的空位是在两次齐射
 * 之间随机放出的，这种模式几乎必然错过。基础 4s + 0~2s 随机抖动让
 * 4 条车道的探测时刻错开，形成近似连续的低频探测流（约 40~60 次/分钟）。
 * 官方明确 503 发生在建单前、不创建任务、不消耗额度，因此高频探测不产生费用。
 */
export const VIDEO_QUEUE_FULL_KEY_COOLDOWN_MS = 3_000;
export const VIDEO_QUEUE_FULL_KEY_JITTER_MS = 5_000;

/** Agnes 免费视频队列饱和：与账号/Key 无关的全局容量拒绝 */
export function isVideoQueueFullMessage(message: string): boolean {
  return /video_queue_full|video queue is full/i.test(message);
}
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
