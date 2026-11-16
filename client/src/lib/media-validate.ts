/**
 * 素材可打开性探测（导入前校验）
 * -------------------------------------------------------------
 * 需求：资产必须「真正生成完、能打开」才允许导入；损坏/半成品直接不可点。
 * 这里用浏览器真实解码探测，而不是只看 status：
 *   · 图片：new Image + decode()，naturalWidth > 0
 *   · 视频：loadedmetadata / loadeddata，videoWidth > 0 且 duration > 0
 *   · 音频：loadedmetadata，duration > 0
 * 结果按 URL 缓存，避免同一素材重复解码。
 */
import { isImageUrl } from './media-kind';

type Kind = 'video' | 'image' | 'audio';
const cache = new Map<string, Promise<boolean>>();

const wait = <T,>(fn: (done: (v: T) => void) => () => void, timeout: number, fallback: T): Promise<T> =>
  new Promise<T>((resolve) => {
    let done = false;
    const finish = (v: T) => {
      if (done) return;
      done = true;
      cleanup();
      resolve(v);
    };
    const cleanup = fn(finish);
    window.setTimeout(() => finish(fallback), timeout);
  });

export const probeMediaOpenable = (url: string, kind: Kind, timeout = 6000): Promise<boolean> => {
  if (!url) return Promise.resolve(false);
  const key = `${kind}|${url}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const task = (async () => {
    try {
      if (kind === 'image' || isImageUrl(url)) {
        const img = new Image();
        img.decoding = 'async';
        img.src = url;
        return await wait<boolean>(
          (done) => {
            img.onload = () => done(img.naturalWidth > 0 && img.naturalHeight > 0);
            img.onerror = () => done(false);
            return () => {
              img.onload = null;
              img.onerror = null;
            };
          },
          timeout,
          false,
        );
      }
      if (kind === 'video') {
        const video = document.createElement('video');
        video.preload = 'metadata';
        video.muted = true;
        video.playsInline = true;
        video.src = url;
        return await wait<boolean>(
          (done) => {
            video.onloadedmetadata = () =>
              done(video.videoWidth > 0 && video.videoHeight > 0);
            video.onloadeddata = () =>
              done(video.videoWidth > 0 && video.videoHeight > 0);
            video.onerror = () => done(false);
            return () => {
              video.onloadedmetadata = null;
              video.onloadeddata = null;
              video.onerror = null;
              video.removeAttribute('src');
              video.load();
            };
          },
          timeout,
          false,
        );
      }
      const audio = document.createElement('audio');
      audio.preload = 'metadata';
      audio.src = url;
      return await wait<boolean>(
        (done) => {
          audio.onloadedmetadata = () => done(Number.isFinite(audio.duration) && audio.duration > 0);
          audio.onerror = () => done(false);
          return () => {
            audio.onloadedmetadata = null;
            audio.onerror = null;
            audio.removeAttribute('src');
            audio.load();
          };
        },
        timeout,
        false,
      );
    } catch {
      return false;
    }
  })();

  cache.set(key, task);
  return task;
};

/** 清除某条 URL 的缓存（替换文件后重新校验用） */
export const clearMediaProbe = (url: string): void => {
  for (const key of cache.keys()) {
    if (key.endsWith(`|${url}`)) cache.delete(key);
  }
};

const reachCache = new Map<string, Promise<boolean>>();

/**
 * 轻量可达性检查：列表阶段并发几十条也不拖垮浏览器。
 * 只验证「服务器有没有这份文件」，不解析内容；点开预览时再做完整解码。
 * 这样 2000+ 条平台资产不会一进弹窗就全部卡在「校验中」。
 */
export const probeMediaReachable = (url: string, timeout = 4000): Promise<boolean> => {
  if (!url) return Promise.resolve(false);
  const hit = reachCache.get(url);
  if (hit) return hit;
  const task = (async () => {
    const ac = new AbortController();
    const timer = window.setTimeout(() => ac.abort(), timeout);
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: { Range: 'bytes=0-0' },
        signal: ac.signal,
        cache: 'no-store',
      });
      // 立刻放掉 body：只关心文件是否存在，不把整段视频拉下来
      void res.body?.cancel().catch(() => undefined);
      return res.ok || res.status === 206;
    } catch {
      return false;
    } finally {
      window.clearTimeout(timer);
    }
  })();
  reachCache.set(url, task);
  return task;
};
