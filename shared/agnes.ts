/**
 * Agnes 专用通道（测试版）常量。
 * ------------------------------------------------------------------
 * 与通用分支（openai / volcengine_ark / mock）隔离：Agnes 走自己的
 * 视频双接口（POST /videos + GET /agnesapi），只接免费模型。
 * 价格以官方定价页为准；2.5-flash 为限时免费，到期官方调价。
 */

/** 免费模型白名单（收费的一律不加） */
export const FREE_AGNES_MODELS: string[] = [
  'agnes-3.0-flash',
  'agnes-2.5-flash',
  'agnes-image-2.0-flash',
  'agnes-image-2.1-flash',
  'agnes-image-2.5-flash',
  'agnes-video-v2.0',
  'agnes-video-2.5-flash',
];

export const isFreeAgnesModel = (model?: string): boolean =>
  typeof model === 'string' && FREE_AGNES_MODELS.includes(model.trim());

/** 默认模型（文本/图片；视频按任务时长由调用方选 v2.0 或 2.5-flash） */
export const AGNES_DEFAULT_TEXT_MODEL = 'agnes-3.0-flash';
export const AGNES_DEFAULT_IMAGE_MODEL = 'agnes-image-2.5-flash';
export const AGNES_DEFAULT_VIDEO_MODEL = 'agnes-video-v2.0';
