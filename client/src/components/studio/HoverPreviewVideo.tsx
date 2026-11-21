/**
 * 素材卡 hover 静音循环预览（C2 · OpenMotion AssetCard hover 预览对齐）
 * -------------------------------------------------------------
 * · hover ≥300ms 才开播：避免划过素材库时把每张卡都拉流；
 * · 卡内 <video> 保持 preload="metadata"（只取首帧元数据，不下载全片），
 *   开播后静音循环（muted + loop + playsInline）；
 * · 模块级 currentPlayer 引用：同一时刻只允许一张卡在播，切卡时立即停掉上一张；
 * · 离开 / 滚动（卡片滚走后 pointerleave 可能不再触发）/ 卸载都清理；
 * · 播放失败静默回退缩略图（video 的 metadata 首帧仍在，不影响卡片展示）。
 * GIF 卡不走这里：<img> 本身就持续动画，无需 hover 播放。
 */
import { useEffect, useRef } from 'react';

/** 模块级当前播放引用：整库同时只允许一张卡在播 */
let currentPlayer: HTMLVideoElement | null = null;

const stopCurrent = () => {
  if (currentPlayer) {
    currentPlayer.pause();
    currentPlayer = null;
  }
};

export const HoverPreviewVideo = ({
  src,
  onError,
}: {
  src: string;
  onError?: () => void;
}) => {
  const ref = useRef<HTMLVideoElement | null>(null);
  const timerRef = useRef<number>(0);

  const stop = () => {
    window.clearTimeout(timerRef.current);
    // 自己在播才停；hover 移到别的卡时 currentPlayer 已换人，别误停新卡
    if (currentPlayer === ref.current) stopCurrent();
    else ref.current?.pause();
  };

  useEffect(() => {
    // 滚动清理：卡片被滚走时浏览器不会补发 pointerleave
    const onScroll = () => stop();
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.clearTimeout(timerRef.current);
      stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const start = () => {
    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      const v = ref.current;
      if (!v || v.error) return; // 加载失败：保持缩略图（首帧/占位）不重试
      if (currentPlayer && currentPlayer !== v) currentPlayer.pause();
      currentPlayer = v;
      void v.play().catch(() => {
        // 自动播放被拒 / 解码失败：静默回退缩略图
        if (currentPlayer === v) currentPlayer = null;
      });
    }, 300);
  };

  return (
    <video
      ref={ref}
      src={src}
      muted
      loop
      playsInline
      preload="metadata"
      onPointerEnter={start}
      onPointerLeave={stop}
      onError={onError}
    />
  );
};

export default HoverPreviewVideo;
