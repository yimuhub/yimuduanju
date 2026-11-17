/**
 * 媒体音轨探测（导入视频时用）
 * -------------------------------------------------------------
 * 视频拖入时间线后，需要知道它是否自带声音：
 *   · 有声音 → 自动生成一条音频轨（原声）；后续可「音轨分离 / 人声分离」
 *   · 无声音 → 不生成空音频轨，避免时间线出现一排没内容的假轨道
 *
 * 实现用临时 <video> 解码：Chromium 的 webkitAudioDecodedByteCount 在
 * 跨域素材上也可读（captureStream 会被 CORS 拦住，不能作为主判据）。
 * 探测失败一律按「无音轨」处理，宁可少一条空轨，也不凭空造声音。
 */
const IMAGE_EXT = /\.(png|jpe?g|webp|gif|bmp|avif|tiff?)(?:[?#]|$)/i;

export const looksLikeImage = (url?: string | null): boolean =>
  Boolean(url && (IMAGE_EXT.test(url) || /[?&]as=image(?:&|$)/i.test(url)));

export async function probeVideoHasAudio(url?: string | null): Promise<boolean> {
  if (!url || looksLikeImage(url)) return false;
  if (typeof document === 'undefined') return false;
  const video = document.createElement('video');
  video.src = url;
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.style.position = 'fixed';
  video.style.left = '-9999px';
  video.style.width = '2px';
  video.style.height = '2px';
  document.body.appendChild(video);

  const cleanup = () => {
    try {
      video.pause();
    } catch {
      /* 已停止 */
    }
    video.remove();
  };

  try {
    await new Promise<void>((resolve) => {
      const done = () => resolve();
      video.addEventListener('loadeddata', done, { once: true });
      video.addEventListener('error', done, { once: true });
      window.setTimeout(done, 2500);
      video.load();
    });
    // 静音播放几百毫秒，让解码器把音轨数据吐出来；无声视频这个计数一直是 0
    await video.play().catch(() => undefined);
    await new Promise((r) => window.setTimeout(r, 420));
    const bytes = Number((video as HTMLVideoElement & { webkitAudioDecodedByteCount?: number }).webkitAudioDecodedByteCount ?? 0);
    return bytes > 0;
  } catch {
    return false;
  } finally {
    cleanup();
  }
}
