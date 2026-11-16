/**
 * 媒体类型判定（前端唯一口径）
 * -------------------------------------------------------------
 * 时间线片段只存 sourceUrl，没有 mimeType；预览与时间线需要区分
 * 视频 / 图片 / GIF。按扩展名判断，data:/blob: 再看 MIME 前缀。
 * 这里只做展示层判定，不替代后端真实解码；能否打开由 media-validate 探测。
 */
const IMAGE_EXT = /\.(png|jpe?g|webp|gif|bmp|avif|svg|heic|tiff?)(?:[?#].*)?$/i;
const GIF_EXT = /\.gif(?:[?#].*)?$/i;
const AUDIO_EXT = /\.(mp3|wav|aac|m4a|flac|ogg|opus|wma)(?:[?#].*)?$/i;

export const isImageUrl = (url?: string | null): boolean => {
  if (!url) return false;
  if (/^data:image\//i.test(url)) return true;
  if (/^blob:/i.test(url)) return false;
  if (/[?&]as=image(?:&|$)/i.test(url)) return true;
  return IMAGE_EXT.test(url);
};

export const isGifUrl = (url?: string | null): boolean => {
  if (!url) return false;
  if (/^data:image\/gif/i.test(url)) return true;
  return GIF_EXT.test(url);
};

export const isAudioUrl = (url?: string | null): boolean => {
  if (!url) return false;
  if (/^data:audio\//i.test(url)) return true;
  return AUDIO_EXT.test(url);
};

/** 时间线画面轨里实际是静态图（含 GIF）的片段 */
export const isStillImageUrl = (url?: string | null): boolean =>
  Boolean(url && (isImageUrl(url) || isGifUrl(url)));
