/**
 * 导出格式 / 质量档纯函数（G20，OpenMotion 对齐）—— 前后端共用
 * ---------------------------------------------------------------------------
 * OpenMotion 的导出面板有 Format（mp4 / webm / gif）+ Quality（草稿 / 标准 / 高）
 * + GIF 循环次数。本项目导出管线默认仍是 mp4（libx264 crf 20），
 * 所有新参数缺省时旧行为不变：
 *   · quality 不传 → crf 恒为 20（与历史命令字节级一致，绝不静默改画质）；
 *   · format 不传 → mp4；
 *   · loopCount 不传 → 0（GIF 无限循环）。
 */

export type ExportFormat = 'mp4' | 'webm' | 'gif';
export type ExportQuality = 'draft' | 'standard' | 'high';

/** mp4（libx264）crf 映射：草稿压速度 / 标准均衡 / 高保画质 */
export const MP4_CRF_BY_QUALITY: Record<ExportQuality, number> = {
  draft: 32,
  standard: 23,
  high: 18,
};
/** webm（libvpx-vp9）crf 映射：标准档即任务约定的 crf 30 */
export const WEBM_CRF_BY_QUALITY: Record<ExportQuality, number> = {
  draft: 35,
  standard: 30,
  high: 25,
};
/** 历史默认 crf：quality 不传时必须原样保留（旧行为） */
export const LEGACY_H264_CRF = 20;

/**
 * mp4 片段渲染 / 烧录用的 crf 值。
 * quality 不传返回历史默认 20 —— 保证旧导出命令逐字节不变。
 */
export function resolveH264Crf(quality?: ExportQuality): number {
  return quality ? MP4_CRF_BY_QUALITY[quality] : LEGACY_H264_CRF;
}

/** webm 的 VP9 crf；quality 不传走标准档 30 */
export function resolveWebmCrf(quality?: ExportQuality): number {
  return quality ? WEBM_CRF_BY_QUALITY[quality] : WEBM_CRF_BY_QUALITY.standard;
}

/** GIF 帧率上限：GIF 逐帧存储，30fps 以上体积爆炸且人眼无感 */
export const GIF_MAX_FPS = 30;
/** GIF 分辨率上限：720p 盒内等比缩小（竖屏即宽 ≤720，横屏即高 ≤720） */
export const GIF_MAX_WIDTH = 1280;
export const GIF_MAX_HEIGHT = 720;

/** GIF 实际帧率：源 fps 钳到 30（不向上抬，24fps 源保持 24 免插帧） */
export function gifFrameRate(fps: number): number {
  const n = Math.round(Number.isFinite(fps) && fps > 0 ? fps : 24);
  return Math.max(1, Math.min(GIF_MAX_FPS, n));
}

/**
 * GIF 缩放滤镜。720p 上限按画幅方向自适应：
 *   横屏缩进 1280×720 盒、竖屏缩进 720×1280 盒（正方形按横屏处理）。
 * 未超限返回 null（不加 scale：小图放大只会糊）。
 */
export function gifScaleFilter(width: number, height: number): string | null {
  const landscape = width >= height;
  const boxW = landscape ? GIF_MAX_WIDTH : GIF_MAX_HEIGHT;
  const boxH = landscape ? GIF_MAX_HEIGHT : GIF_MAX_WIDTH;
  if (width <= boxW && height <= boxH) return null;
  return `scale=${boxW}:${boxH}:force_original_aspect_ratio=decrease`;
}

/**
 * GIF 循环次数：0 = 无限（GIF muxer 约定），其余为播放次数。
 * 非法值一律钳回合法范围。
 */
export function clampGifLoopCount(loopCount?: number): number {
  const n = Math.round(Number(loopCount));
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(65535, n));
}

/**
 * 两段式 GIF 滤镜串（调色板 palettegen → paletteuse）：
 * 两段的 fps / scale 必须完全一致，否则逐帧错位。
 * pass 1 末尾接 palettegen；pass 2 由调用方拼 `[x][1:v]paletteuse`。
 */
export function gifFilterChain(width: number, height: number, fps: number): string {
  const parts = [`fps=${gifFrameRate(fps)}`];
  const scale = gifScaleFilter(width, height);
  if (scale) parts.push(`${scale}:flags=lanczos`);
  return parts.join(',');
}

/** 导出容器的 mimeType（素材登记用） */
export function exportFormatMimeType(format: ExportFormat): string {
  if (format === 'webm') return 'video/webm';
  if (format === 'gif') return 'image/gif';
  return 'video/mp4';
}
