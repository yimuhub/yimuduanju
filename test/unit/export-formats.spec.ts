/**
 * G20 导出格式纯函数回归测试
 * ------------------------------------------------------------------
 * 核心约束：quality 不传时 mp4 crf 恒为 20（历史导出命令字节级不变），
 * 传入质量档才映射；GIF 帧率 / 分辨率上限与循环次数钳制。
 */
import {
  clampGifLoopCount,
  exportFormatMimeType,
  gifFilterChain,
  gifFrameRate,
  gifScaleFilter,
  resolveH264Crf,
  resolveWebmCrf,
} from '../../shared/export-formats';

describe('resolveH264Crf（旧调用兼容是硬约束）', () => {
  it('quality 不传 = 旧行为 crf 20', () => {
    expect(resolveH264Crf(undefined)).toBe(20);
  });

  it('质量档映射 draft/standard/high → 32/23/18', () => {
    expect(resolveH264Crf('draft')).toBe(32);
    expect(resolveH264Crf('standard')).toBe(23);
    expect(resolveH264Crf('high')).toBe(18);
  });
});

describe('resolveWebmCrf', () => {
  it('不传走标准档 30（任务约定基线）', () => {
    expect(resolveWebmCrf(undefined)).toBe(30);
    expect(resolveWebmCrf('draft')).toBe(35);
    expect(resolveWebmCrf('standard')).toBe(30);
    expect(resolveWebmCrf('high')).toBe(25);
  });
});

describe('GIF 帧率与分辨率上限', () => {
  it('帧率钳到 30，且不向上抬（24fps 源保持 24 免插帧）', () => {
    expect(gifFrameRate(60)).toBe(30);
    expect(gifFrameRate(30)).toBe(30);
    expect(gifFrameRate(24)).toBe(24);
    expect(gifFrameRate(12)).toBe(12);
    expect(gifFrameRate(0)).toBe(24); // 非法值回退默认 24
  });

  it('未超 720p 盒不缩放（避免小图放大变糊），上限按方向自适应', () => {
    expect(gifScaleFilter(720, 1280)).toBeNull(); // 竖屏 720p
    expect(gifScaleFilter(1280, 720)).toBeNull(); // 横屏 720p
    expect(gifScaleFilter(640, 360)).toBeNull();
  });

  it('超限时等比缩进 720p 盒内（横屏 1280x720 / 竖屏 720x1280）', () => {
    expect(gifScaleFilter(1080, 1920)).toBe('scale=720:1280:force_original_aspect_ratio=decrease');
    expect(gifScaleFilter(1920, 1080)).toBe('scale=1280:720:force_original_aspect_ratio=decrease');
    expect(gifScaleFilter(1080, 1080)).toBe('scale=1280:720:force_original_aspect_ratio=decrease');
  });

  it('两段式滤镜链的 fps/scale 完全一致（调色板与帧不错位）', () => {
    const pass1 = `${gifFilterChain(1080, 1920, 25)},palettegen`;
    const pass2 = `${gifFilterChain(1080, 1920, 25)}[x];[x][1:v]paletteuse`;
    expect(gifFilterChain(1080, 1920, 25)).toBe('fps=25,scale=720:1280:force_original_aspect_ratio=decrease:flags=lanczos');
    expect(pass1.startsWith('fps=25,scale=720:1280')).toBe(true);
    expect(pass2.startsWith(gifFilterChain(1080, 1920, 25))).toBe(true);
    // 不超限时只含 fps（无 scale）
    expect(gifFilterChain(720, 1280, 24)).toBe('fps=24');
  });
});

describe('clampGifLoopCount', () => {
  it('0 = 无限循环（缺省值）', () => {
    expect(clampGifLoopCount(undefined)).toBe(0);
    expect(clampGifLoopCount(0)).toBe(0);
  });

  it('合法次数原样保留，非法值钳回范围', () => {
    expect(clampGifLoopCount(3)).toBe(3);
    expect(clampGifLoopCount(-5)).toBe(0);
    expect(clampGifLoopCount(100000)).toBe(65535);
    expect(clampGifLoopCount(1.7)).toBe(2); // 四舍五入取整
    expect(clampGifLoopCount(Number.NaN)).toBe(0);
  });
});

describe('exportFormatMimeType', () => {
  it('按格式给出登记用 mimeType', () => {
    expect(exportFormatMimeType('mp4')).toBe('video/mp4');
    expect(exportFormatMimeType('webm')).toBe('video/webm');
    expect(exportFormatMimeType('gif')).toBe('image/gif');
  });
});
