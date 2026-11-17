/**
 * 时间线媒体可视层：帧缩略图 + 音频波形
 * -------------------------------------------------------------
 * · 缩略图 / 波形都按「媒体地址」缓存，跨片段、跨渲染复用；
 * · 请求并发限制 3，避免一次打开时间线把后端抽帧打满；
 * · data:/blob: 地址无法给后端解码，直接降级为纯色块；
 * · 渲染失败只影响该片段，不阻断整条时间线。
 */
import { useEffect, useState, type ReactNode } from 'react';
import type { TimelineThumbnails, TimelineWaveform } from '@shared/api.interface';
import { getThumbnails, getWaveform } from '@client/src/api/timeline';
import { clamp, slicePeaks } from '@client/src/lib/timeline-frame';

const MAX_CONCURRENT = 3;
let active = 0;
const queue: Array<() => void> = [];

function schedule<T>(task: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const run = () => {
      active += 1;
      task()
        .then(resolve, reject)
        .finally(() => {
          active -= 1;
          const next = queue.shift();
          if (next) next();
        });
    };
    if (active < MAX_CONCURRENT) run();
    else queue.push(run);
  });
}

/** 后端能解码的地址：本地 /uploads、公网 http(s)；data:/blob: 跳过 */
export const canAnalyze = (url?: string | null): boolean =>
  Boolean(url && (url.startsWith('/uploads/') || /^https?:/i.test(url)));

const thumbCache = new Map<string, TimelineThumbnails | null>();
const thumbInflight = new Map<string, Promise<TimelineThumbnails | null>>();
const waveCache = new Map<string, TimelineWaveform | null>();
const waveInflight = new Map<string, Promise<TimelineWaveform | null>>();

export function useThumbnails(
  projectId: string | undefined,
  url: string | null | undefined,
): TimelineThumbnails | null {
  const key = projectId && url && canAnalyze(url) ? `${projectId}|${url}` : '';
  const [data, setData] = useState<TimelineThumbnails | null>(
    key ? (thumbCache.get(key) ?? null) : null,
  );

  useEffect(() => {
    if (!key || !projectId || !url) {
      setData(null);
      return undefined;
    }
    if (thumbCache.has(key)) {
      setData(thumbCache.get(key) ?? null);
      return undefined;
    }
    let alive = true;
    let task = thumbInflight.get(key);
    if (!task) {
      task = schedule(() => getThumbnails(projectId, url))
        .then((r) => {
          thumbCache.set(key, r);
          return r;
        })
        .catch(() => {
          // 失败不写缓存：虚拟化滚动会重新挂载片段，让它有机会再试一次。
          // （曾经写成 set(key, null)，一次 304 就让缩略图永久消失。）
          return null;
        })
        .finally(() => {
          thumbInflight.delete(key);
        });
      thumbInflight.set(key, task);
    }
    void task.then((r) => {
      if (alive) setData(r);
    });
    return () => {
      alive = false;
    };
  }, [key, projectId, url]);

  return data;
}

export function useWaveform(
  projectId: string | undefined,
  url: string | null | undefined,
): TimelineWaveform | null {
  const key = projectId && url && canAnalyze(url) ? `${projectId}|${url}` : '';
  const [data, setData] = useState<TimelineWaveform | null>(
    key ? (waveCache.get(key) ?? null) : null,
  );

  useEffect(() => {
    if (!key || !projectId || !url) {
      setData(null);
      return undefined;
    }
    if (waveCache.has(key)) {
      setData(waveCache.get(key) ?? null);
      return undefined;
    }
    let alive = true;
    let task = waveInflight.get(key);
    if (!task) {
      task = schedule(() => getWaveform(projectId, url))
        .then((r) => {
          waveCache.set(key, r);
          return r;
        })
        .catch(() => {
          return null;
        })
        .finally(() => {
          waveInflight.delete(key);
        });
      waveInflight.set(key, task);
    }
    void task.then((r) => {
      if (alive) setData(r);
    });
    return () => {
      alive = false;
    };
  }, [key, projectId, url]);

  return data;
}

/**
 * 视频片段帧带：等宽格子铺满片段，每格取片段区间内的一个时间点。
 *
 * 格子宽度按「行高 × 单格宽高比」算出来 —— 这样 9:16 竖屏素材在 62px 行高里
 * 就是 62px 宽的方图，16:9 就是 110px 宽，且上下不留黑边。
 * 早先写死 52px 的后果是：行高只有 26px 时缩略图被裁成一条细线，看着像没做。
 * 格子数按宽度自适应并封顶 80，避免长片段渲染上千个节点。
 */
export const Filmstrip = ({
  thumb,
  span,
  inPoint,
  outPoint,
  pxPerSec,
  rowHeight = 44,
}: {
  thumb: TimelineThumbnails | null;
  span: number;
  inPoint: number;
  outPoint: number;
  pxPerSec: number;
  rowHeight?: number;
}): ReactNode => {
  if (!thumb || thumb.tileWidth <= 0 || thumb.tileHeight <= 0) return null;
  const width = Math.max(6, span * pxPerSec);
  const aspect = thumb.tileWidth / thumb.tileHeight;
  const tileW = clamp(Math.round(rowHeight * aspect), 14, 240);
  const count = clamp(Math.ceil(width / tileW), 1, 80);
  const duration = Math.max(0.001, outPoint - inPoint);
  const cells: ReactNode[] = [];
  for (let i = 0; i < count; i += 1) {
    const t = inPoint + ((i + 0.5) / count) * duration;
    const frame = clamp(Math.floor(t / thumb.interval), 0, Math.max(0, thumb.count - 1));
    const col = frame % thumb.columns;
    const row = Math.floor(frame / thumb.columns);
    cells.push(
      <i
        key={i}
        style={{
          width: `${tileW}px`,
          height: '100%',
          flex: '0 0 auto',
          backgroundImage: `url("${thumb.spriteUrl}")`,
          backgroundSize: `${thumb.columns * tileW}px ${thumb.rows * rowHeight}px`,
          backgroundPosition: `-${col * tileW}px -${row * rowHeight}px`,
          backgroundRepeat: 'no-repeat',
        }}
      />,
    );
  }
  return (
    <div className="tl-film" aria-hidden>
      {cells}
    </div>
  );
};


/**
 * 画面轨静态图 / GIF 片段：直接渲染原图。
 * GIF 交给浏览器原生播放（保留动画），普通图片铺满片段宽度；
 * 这是时间线显示渲染图片的唯一入口，禁止再把它当视频去抽帧。
 */
export const StillFrame = ({
  url,
  span,
  pxPerSec,
}: {
  url: string;
  span: number;
  pxPerSec: number;
}): ReactNode => {
  const width = Math.max(8, span * pxPerSec);
  return (
    <div className="tl-still" aria-hidden style={{ width: `${width}px` }}>
      <img src={url} alt="" loading="lazy" draggable={false} />
    </div>
  );
};
/**
 * 音频波形：上下对称的填充折线，viewBox 横向拉伸到片段宽度。
 * peaks 由 slicePeaks 按片段区间切好，点数按 2px 一柱计算。
 */
export const Waveform = ({
  wave,
  span,
  inPoint,
  outPoint,
  pxPerSec,
}: {
  wave: TimelineWaveform | null;
  span: number;
  inPoint: number;
  outPoint: number;
  pxPerSec: number;
}): ReactNode => {
  if (!wave || wave.peaks.length === 0) return null;
  const width = Math.max(8, span * pxPerSec);
  const count = clamp(Math.ceil(width / 2), 12, 900);
  const peaks = slicePeaks(wave.peaks, wave.duration, inPoint, outPoint, count);
  if (peaks.length === 0) return null;
  const h = 22;
  const mid = h / 2;
  let up = '';
  let down = '';
  for (let i = 0; i < peaks.length; i += 1) {
    const amp = Math.min(1, Math.max(0, peaks[i]));
    const y = mid - amp * (mid - 1);
    up += `${i === 0 ? 'M' : 'L'}${i} ${y.toFixed(2)}`;
  }
  for (let i = peaks.length - 1; i >= 0; i -= 1) {
    const amp = Math.min(1, Math.max(0, peaks[i]));
    const y = mid + amp * (mid - 1);
    down += `L${i} ${y.toFixed(2)}`;
  }
  return (
    <svg
      className="tl-wave"
      viewBox={`0 0 ${peaks.length} ${h}`}
      preserveAspectRatio="none"
      aria-hidden
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
    >
      <path d={`${up}${down}Z`} fill="currentColor" />
    </svg>
  );
};
