/**
 * 时间线媒体可视层：帧缩略图 + 音频波形
 * -------------------------------------------------------------
 * · 缩略图 / 波形都按「媒体地址」缓存，跨片段、跨渲染复用；
 * · 请求并发限制 3，避免一次打开时间线把后端抽帧打满；
 * · data:/blob: 地址无法给后端解码，直接降级为纯色块；
 * · 渲染失败只影响该片段，不阻断整条时间线。
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
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
          backgroundSize: `${thumb.columns * tileW}px ${thumb.rows * thumb.tileHeight}px`,
          backgroundPosition: `-${col * tileW}px -${row * thumb.tileHeight}px`,
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
 * 剪映式音频波形：中线为 0，每 2px 一根上下对称的竖柱。
 * 用 canvas 而不是一条长折线，密度、峰谷和低电平细节更接近剪映；
 * peaks 仍按片段 in/out 与当前缩放重新取样，缩放后不会拉伸变形。
 */
export const Waveform = ({
  wave,
  span,
  inPoint,
  outPoint,
  pxPerSec,
  gain = 1,
}: {
  wave: TimelineWaveform | null;
  span: number;
  inPoint: number;
  outPoint: number;
  pxPerSec: number;
  /** 片段当前音量：波形高度随音量缩放，颜色随增益变亮/变暗（剪映行为） */
  gain?: number;
}): ReactNode => {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !wave || wave.peaks.length === 0) return;
    const width = Math.max(8, Math.ceil(span * pxPerSec));
    const count = clamp(Math.ceil(width / 2), 12, 900);
    const peaks = slicePeaks(wave.peaks, wave.duration, inPoint, outPoint, count);
    if (peaks.length === 0) return;
    const cssH = 44;
    const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
    canvas.width = Math.max(8, Math.round(width * dpr));
    canvas.height = Math.round(cssH * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, cssH);
    // 颜色随增益变化：0dB 基准蓝，提升偏亮青，压低偏暗蓝
    const g = Math.max(0, Math.min(2, gain));
    const mix = (a: number, b: number, t: number) => Math.round(a + (b - a) * t);
    let r = 47; let gg = 155; let b = 255;
    if (g > 1) {
      const t = Math.min(1, g - 1);
      r = mix(47, 140, t); gg = mix(155, 224, t); b = 255;
    } else if (g < 1) {
      const t = Math.min(1, 1 - g);
      r = mix(47, 18, t); gg = mix(155, 74, t); b = mix(255, 138, t);
    }
    ctx.fillStyle = `rgb(${r},${gg},${b})`;
    const mid = cssH / 2;
    const barW = width / peaks.length;
    const ampScale = Math.min(1.35, Math.max(0.08, g));
    for (let i = 0; i < peaks.length; i += 1) {
      const amp = Math.max(0.06, Math.min(1, peaks[i]));
      const barH = Math.max(0.8, Math.min(mid - 1, amp * ampScale * (mid - 1)));
      ctx.fillRect(i * barW, mid - barH, Math.max(1, barW - 0.35), barH * 2);
    }
  }, [wave, span, inPoint, outPoint, pxPerSec, gain]);
  if (!wave || wave.peaks.length === 0) return null;
  return (
    <canvas
      ref={ref}
      className="tl-wave"
      aria-hidden
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
    />
  );
};
