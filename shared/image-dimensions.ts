/**
 * 产物真实尺寸校验（V8）
 * ---------------------------------------------------------------------------
 * 上一轮已经把「按项目画幅出图」写进提示词 + 生图 API 的 size / aspect_ratio，
 * 但那只约束请求，不验证结果：供应商仍可能忽略参数返回 1024x1024 方图，
 * 于是「参考图全是方形图」的问题在产物侧没有任何反馈。
 *
 * 这里只解析图片文件头（前 64KB 足够），不解码像素、不引入图像库，
 * 覆盖 PNG / JPEG / WebP / GIF 四种主流格式，供生成完成后做真实比例核对。
 */

export interface ImageSize {
  width: number;
  height: number;
}

const be16 = (b: Buffer, o: number): number => (b[o] << 8) | b[o + 1];
const be32 = (b: Buffer, o: number): number =>
  ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
const le16 = (b: Buffer, o: number): number => b[o] | (b[o + 1] << 8);

/** PNG：8 字节签名 + IHDR，宽高在偏移 16/20 的大端 32 位整数 */
function parsePng(b: Buffer): ImageSize | null {
  if (b.length < 24) return null;
  if (b.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') return null;
  if (b.subarray(12, 16).toString('ascii') !== 'IHDR') return null;
  const width = be32(b, 16);
  const height = be32(b, 20);
  return width > 0 && height > 0 ? { width, height } : null;
}

const JPEG_SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

/** JPEG：遍历 marker 段找 SOF，段内 +3/+5 是高/宽 */
function parseJpeg(b: Buffer): ImageSize | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < b.length) {
    if (b[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = b[offset + 1];
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      offset += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) break; // EOI / SOS
    const len = be16(b, offset + 2);
    if (len < 2 || offset + 2 + len > b.length) break;
    if (JPEG_SOF.has(marker)) {
      const height = be16(b, offset + 5);
      const width = be16(b, offset + 7);
      return width > 0 && height > 0 ? { width, height } : null;
    }
    offset += 2 + len;
  }
  return null;
}

/** WebP：RIFF/WEBP，按 VP8X / VP8L / VP8 三种 chunk 分别取尺寸 */
function parseWebp(b: Buffer): ImageSize | null {
  if (b.length < 30) return null;
  if (b.subarray(0, 4).toString('ascii') !== 'RIFF') return null;
  if (b.subarray(8, 12).toString('ascii') !== 'WEBP') return null;
  const chunk = b.subarray(12, 16).toString('ascii');
  if (chunk === 'VP8X') {
    const w = 1 + b[24] + (b[25] << 8) + (b[26] << 16);
    const h = 1 + b[27] + (b[28] << 8) + (b[29] << 16);
    return w > 0 && h > 0 ? { width: w, height: h } : null;
  }
  if (chunk === 'VP8L') {
    if (b.length < 25 || b[20] !== 0x2f) return null;
    const bits = (b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24)) >>> 0;
    const w = (bits & 0x3fff) + 1;
    const h = ((bits >>> 14) & 0x3fff) + 1;
    return { width: w, height: h };
  }
  if (chunk === 'VP8 ') {
    // 关键帧头：3 字节帧标签 + 起始码 9d 01 2a，随后各 2 字节小端宽高（低 14 位）
    const start = b.indexOf(Buffer.from([0x9d, 0x01, 0x2a]), 20);
    if (start < 0 || start + 8 > b.length) return null;
    const w = le16(b, start + 3) & 0x3fff;
    const h = le16(b, start + 5) & 0x3fff;
    return w > 0 && h > 0 ? { width: w, height: h } : null;
  }
  return null;
}

function parseGif(b: Buffer): ImageSize | null {
  if (b.length < 10 || b.subarray(0, 3).toString('ascii') !== 'GIF') return null;
  const width = le16(b, 6);
  const height = le16(b, 8);
  return width > 0 && height > 0 ? { width, height } : null;
}

/** 从文件头解析真实像素尺寸；无法识别返回 null（不阻断出片，只记录） */
export function parseImageSize(header: Buffer | Uint8Array): ImageSize | null {
  if (!header) return null;
  const b = Buffer.isBuffer(header) ? header : Buffer.from(header);
  // 各格式解析器自己校验所需最小长度，这里不再设统一的 16 字节下限：
  // GIF 的逻辑屏幕描述符只有 10 字节（6 字节签名 + 宽高各 2 字节），
  // 统一下限会把合法的最短 GIF 头误判为「无法识别」。
  return parsePng(b) ?? parseJpeg(b) ?? parseWebp(b) ?? parseGif(b) ?? null;
}

export interface AspectCheck {
  expected: string;
  actual: string;
  /** 相对偏差百分比，方便日志与 QC 直接读 */
  deviationPct: number;
  ok: boolean;
  /** 供应商忽略了画幅参数、直接返回 1:1 方图 —— 用户反馈的那个具体问题 */
  squareMismatch?: boolean;
  reason?: string;
}

/** 允许 6% 误差：不同供应商会把 9:16 实现成 720x1280 / 768x1344 等近似尺寸 */
export const ASPECT_TOLERANCE = 0.06;

export function compareImageAspect(
  expected: string,
  width: number,
  height: number,
): AspectCheck {
  const [ew, eh] = String(expected ?? '').split(':').map(Number);
  const actual = `${width}x${height}`;
  if (!Number.isFinite(ew) || !Number.isFinite(eh) || ew <= 0 || eh <= 0 || height <= 0) {
    return { expected: String(expected ?? ''), actual, deviationPct: 0, ok: true };
  }
  const wanted = ew / eh;
  const got = width / height;
  const deviation = Math.abs(got - wanted) / wanted;
  const ok = deviation <= ASPECT_TOLERANCE;
  const squareMismatch = !ok && Math.abs(got - 1) < 0.01 && Math.abs(wanted - 1) > 0.01;
  return {
    expected: String(expected),
    actual,
    deviationPct: Number((deviation * 100).toFixed(1)),
    ok,
    ...(squareMismatch ? { squareMismatch: true } : {}),
    ...(!ok
      ? {
          reason: squareMismatch
            ? `供应商返回了 1:1 方图（${actual}），项目设定为 ${expected}；请检查该通道是否支持 size / aspect_ratio 参数`
            : `产物画幅 ${actual} 与项目设定 ${expected} 偏差 ${(deviation * 100).toFixed(1)}%`,
        }
      : {}),
  };
}
