/**
 * 媒体输入规范化：把本地 /uploads 图片变成模型供应商真正拉得到的形态。
 * ------------------------------------------------------------------
 * 背景（对标 huobao-drama 的 normalizeReferenceImages）：
 * 我们所有产物（人物主图/四视图、场景图、道具图、首帧）都落盘成
 * `/uploads/xxx.png` 这种**相对路径**，直接塞进生图 `image` 字段或视频
 * `first_frame` 字段时，供应商拿到的是一个不存在的地址，于是：
 *   - 参考图被静默忽略 → 人物一致性只剩文字在撑，跨镜必换脸；
 *   - 首帧被判成"非公网 URL" → 视频退化成纯文生视频，画面和分镜图对不上。
 * 解法与火宝一致：本地文件读出来转 **压缩后的 data URL**（base64 内联），
 * 供应商不需要访问我们的机器也能拿到像素。
 *
 * 纪律：
 * - 只认 http(s) / data: / /uploads 三种形态；其它形态返回 undefined，
 *   宁可当"没有参考图"，也不把一个坏地址发给供应商（避免整单 400）。
 * - 大图（>900KB）用 ffmpeg 压成 JPEG：首帧/参考图在模型侧本来就会缩放，
 *   保留原始体积只会拖慢上传甚至超限。
 * - 命中缓存（LRU 48 条），同一张人物主图反复用于几十个镜头时只读一次盘。
 */
import { execFile } from 'child_process';
import { existsSync } from 'fs';
import { readFile } from 'fs/promises';
import { extname, join } from 'path';
import { uploadDir } from '../assets/upload-dir';

/** 超过该体积才压缩：小图直传反而更清晰 */
const COMPRESS_THRESHOLD_BYTES = 900 * 1024;
/** 长边上限：视频/图片模型侧都会再缩，1280 足够锁住身份特征 */
const MAX_EDGE = 1280;
const CACHE_LIMIT = 48;

const cache = new Map<string, string>();

function remember(key: string, value: string): string {
  if (cache.size >= CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, value);
  return value;
}

function ffmpegBin(): string {
  if (process.env.FFMPEG_PATH && process.env.FFMPEG_PATH.trim()) {
    return process.env.FFMPEG_PATH.trim();
  }
  const candidates =
    process.platform === 'darwin'
      ? ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg']
      : ['/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg'];
  for (const c of candidates) if (existsSync(c)) return c;
  return 'ffmpeg';
}

/** ffmpeg 压成 JPEG 走 stdout；失败返回 null，由调用方回退原图直传 */
function compressToJpeg(absPath: string): Promise<Buffer | null> {
  return new Promise((resolve) => {
    execFile(
      ffmpegBin(),
      [
        '-v', 'error',
        '-i', absPath,
        '-vf', `scale='min(${MAX_EDGE},iw)':-2`,
        '-q:v', '4',
        '-frames:v', '1',
        '-f', 'image2pipe',
        '-vcodec', 'mjpeg',
        'pipe:1',
      ],
      { encoding: 'buffer', maxBuffer: 24 * 1024 * 1024, timeout: 20000 },
      (err, stdout) => {
        if (err || !stdout || stdout.length === 0) resolve(null);
        else resolve(stdout as unknown as Buffer);
      },
    );
  });
}

function mimeForExt(ext: string): string {
  switch (ext.toLowerCase()) {
    case '.png':
      return 'image/png';
    case '.webp':
      return 'image/webp';
    case '.gif':
      return 'image/gif';
    default:
      return 'image/jpeg';
  }
}

/** 是否本地托管路径（我们自己的产物） */
export function isLocalUploadPath(u?: string | null): boolean {
  return typeof u === 'string' && /^\/uploads\//.test(u);
}

/**
 * 把任意图片来源规整成供应商可用形态。
 * - http(s) 原样返回
 * - data: 原样返回
 * - /uploads/... 读盘转 data URL（必要时压缩）
 * - 其它（空串、相对裸路径、blob:）一律返回 undefined
 */
export async function toProviderImageInput(
  raw?: string | null,
): Promise<string | undefined> {
  if (typeof raw !== 'string') return undefined;
  const u = raw.trim();
  if (!u) return undefined;
  if (/^https?:\/\//i.test(u)) return u;
  if (/^data:/i.test(u)) return u;
  if (!isLocalUploadPath(u)) return undefined;

  const cached = cache.get(u);
  if (cached) return cached;

  const abs = join(uploadDir(), u.replace(/^\/uploads\//, ''));
  let buf: Buffer;
  try {
    buf = await readFile(abs);
  } catch {
    return undefined;
  }

  if (buf.length > COMPRESS_THRESHOLD_BYTES) {
    const jpeg = await compressToJpeg(abs);
    if (jpeg && jpeg.length > 0) {
      return remember(u, `data:image/jpeg;base64,${jpeg.toString('base64')}`);
    }
    // 压缩失败（ffmpeg 不可用）：原图直传，不阻断出片
  }
  return remember(u, `data:${mimeForExt(extname(abs))};base64,${buf.toString('base64')}`);
}

/** 批量规整：保持顺序、去掉空槽（参考图顺序对模型权重有影响，不能重排） */
export async function toProviderImageInputs(
  raws: (string | null | undefined)[],
): Promise<string[]> {
  const out: string[] = [];
  for (const raw of raws) {
    const normalized = await toProviderImageInput(raw);
    if (normalized && !out.includes(normalized)) out.push(normalized);
  }
  return out;
}

/**
 * 部分中转（Agnes 官方 /v1/images/generations）的 `image` 字段只吃**纯 base64**：
 * 传 /uploads 相对路径、http(s) URL，甚至带 `data:image/png;base64,` 前缀的
 * data URL，都会被判成 `image is not a valid image base64` 直接 400。
 *
 * 这里把任意来源统一收敛成纯 base64 字符串。远程 http(s) 先下载再编码，
 * 且限制 8MB，避免把外部大图整张塞进请求体。
 */
export async function toProviderImageBase64(
  raw?: string | null,
): Promise<string | undefined> {
  const normalized = await toProviderImageInput(raw);
  if (!normalized) return undefined;
  if (/^data:[^,]*;base64,/i.test(normalized)) {
    return normalized.replace(/^data:[^,]*;base64,/i, '');
  }
  if (/^https?:\/\//i.test(normalized)) {
    try {
      const resp = await fetch(normalized, { signal: AbortSignal.timeout(15000) });
      if (!resp.ok) return undefined;
      const buf = Buffer.from(await resp.arrayBuffer());
      if (buf.length === 0 || buf.length > 8 * 1024 * 1024) return undefined;
      return buf.toString('base64');
    } catch {
      return undefined;
    }
  }
  return undefined;
}
