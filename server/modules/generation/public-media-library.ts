/**
 * 图库（public media library）：本地图片 → 公网可访问 URL 的持久通道
 * ============================================================================
 * 为什么必须有这一层
 * ------------------
 * 视频通道（Agnes 官方 /videos）的 first_frame / last_frame / images 只接受
 * **公网可访问的 http(s) URL**。而我们的全部产物都落盘成 `/uploads/xxx.png`。
 * 历史上靠两条临时通道凑地址，都不够用：
 *
 *   ① 上游图片 CDN 回传地址（generation_jobs.outputData.images[0].remoteUrl）
 *      —— 只覆盖「本系统自己生成的图」，用户导入的本地图、手工上传图、以及
 *      早期没记录 remoteUrl 的老任务一律无解。
 *   ② trycloudflare 隧道 + `_staged` 硬链接（staged-media.ts）
 *      —— 域名每次重启就换，任务建单后上游来下载时可能已经 404；而且只是
 *      临时副本，终态即删，无法长期复用。
 *
 * 这里补上第三条、也是用户要求的正路：**把本地图片提交进图库，用图库返回的
 * 公网 URL 去提交视频任务**。上传一次 → 落 `public_media` 表 → 之后所有项目、
 * 所有镜头、所有重试都复用同一个 URL，隧道重启、后端重启都不受影响。
 *
 * 宿主选择（按可靠性排序，可用 YIMU_MEDIA_HOST 指定）
 * ---------------------------------------------------
 *   self   —— 用户自有存储：配了 YIMU_MEDIA_UPLOAD_URL 时走 PUT 上传，
 *             URL 前缀用 YIMU_PUBLIC_MEDIA_BASE（自建域名/对象存储，最稳）。
 *   catbox —— 公共图床 https://catbox.moe（无需注册、长期保存）。
 *             实测本机可 POST 上传、GET 可读；只在 self 不可用时使用。
 *   tunnel —— 最后的兜底：publicMediaBase() + 原相对路径。
 *             临时、会随隧道重启失效，因此**不写入缓存**。
 *
 * 纪律
 * ----
 * - 只处理 `/uploads/` 本地路径；已是 http(s) 的原样返回（上游 CDN 最稳）。
 * - 上传失败绝不抛出：返回 undefined，由调用方继续走既有降级链，
 *   不能因为「图库不可用」把出片链路打断。
 * - 同一张图并发请求只上传一次（in-flight 去重），失败不缓存，下次还能重试。
 * - 缓存命中直接返回，不重复占图床空间。
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, extname, join, resolve, sep } from 'node:path';
import { eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { publicMedia } from '@server/database/schema';
import { uploadDir } from '../assets/upload-dir';
import { isLocalUploadPath, publicMediaBase } from './media-input';

/** 图库总开关：YIMU_MEDIA_LIBRARY=0 可整体关闭，回到「只用上游 CDN + 隧道」 */
export function isLibraryEnabled(): boolean {
  return (process.env.YIMU_MEDIA_LIBRARY ?? '1') !== '0';
}

function hostPreference(): 'self' | 'catbox' {
  const forced = (process.env.YIMU_MEDIA_HOST ?? '').trim().toLowerCase();
  if (forced === 'self' || forced === 'catbox') return forced;
  // 配了自建上传端点就优先自建；否则用公共图床
  return (process.env.YIMU_MEDIA_UPLOAD_URL ?? '').trim() ? 'self' : 'catbox';
}

const CATBOX_API = 'https://catbox.moe/user/api.php';
const UPLOAD_TIMEOUT_MS = 60_000;
/**
 * node 默认 UA 会被 catbox 前的 Cloudflare 判成机器人（412）。
 * 用常规浏览器 UA，实测可稳定拿到 https://files.catbox.moe/xxx.png。
 */
const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

/** 同一路径的并发上传去重（多镜头共用一张角色图时会同时打进来） */
const inflight = new Map<string, Promise<string | undefined>>();

function mimeForExt(ext: string): string {
  switch (ext.toLowerCase()) {
    case '.png':
      return 'image/png';
    case '.webp':
      return 'image/webp';
    case '.gif':
      return 'image/gif';
    case '.mp4':
      return 'video/mp4';
    case '.mp3':
      return 'audio/mpeg';
    default:
      return 'image/jpeg';
  }
}

/** `/uploads/x.png` → 上传目录内的绝对路径（含穿越校验，越界返回 null） */
function localAbsolute(localPath: string): string | null {
  const root = resolve(uploadDir());
  const rel = localPath.replace(/^\/uploads\//, '').replace(/^\/+/, '');
  const abs = resolve(root, rel);
  if (abs !== root && !abs.startsWith(root + sep)) return null;
  return abs;
}

/* -------------------------------------------------------------------------- */
/* 宿主实现                                                                    */
/* -------------------------------------------------------------------------- */

interface UploadResult {
  publicUrl: string;
  host: 'catbox' | 'self';
}

/** 公共图床 catbox.moe：multipart 上传，成功时响应体就是图片直链 */
async function uploadCatbox(
  abs: string,
  buf: Buffer,
): Promise<UploadResult | null> {
  try {
    const ext = extname(abs).toLowerCase() || '.png';
    const form = new FormData();
    form.append('reqtype', 'fileupload');
    form.append(
      'fileToUpload',
      new Blob([new Uint8Array(buf)], { type: mimeForExt(ext) }),
      basename(abs),
    );
    const res = await fetch(CATBOX_API, {
      method: 'POST',
      headers: { 'User-Agent': BROWSER_UA },
      body: form,
      signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.warn(`[media-library] catbox 上传失败 HTTP ${res.status}`);
      return null;
    }
    const text = (await res.text()).trim();
    if (!/^https?:\/\/\S+$/i.test(text)) {
      console.warn(`[media-library] catbox 返回非 URL：${text.slice(0, 120)}`);
      return null;
    }
    return { publicUrl: text, host: 'catbox' };
  } catch (e) {
    console.warn(`[media-library] catbox 上传异常：${(e as Error).message}`);
    return null;
  }
}

/**
 * 自建存储（用户自己的 nginx dav / 对象存储网关门）：
 *   PUT {UPLOAD_URL}/_library/<sha1><ext>   body=二进制
 *   公网 URL {PUBLIC_MEDIA_BASE}/uploads/_library/<sha1><ext>
 * 文件名用内容 sha1 —— 幂等，重复上传同一张图不会产生新对象。
 */
async function uploadSelf(abs: string, buf: Buffer): Promise<UploadResult | null> {
  const endpoint = (process.env.YIMU_MEDIA_UPLOAD_URL ?? '').trim().replace(/\/+$/, '');
  const base = publicMediaBase();
  if (!endpoint || !base) return null;
  try {
    const ext = extname(abs).toLowerCase() || '.png';
    const digest = createHash('sha1').update(buf).digest('hex');
    const key = `_library/${digest}${ext}`;
    const token = (process.env.YIMU_MEDIA_UPLOAD_TOKEN ?? '').trim();
    const res = await fetch(`${endpoint}/${key}`, {
      method: 'PUT',
      headers: {
        'Content-Type': mimeForExt(ext),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: new Uint8Array(buf),
      signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.warn(`[media-library] 自建存储上传失败 HTTP ${res.status}`);
      return null;
    }
    return { publicUrl: `${base}/uploads/${key}`, host: 'self' };
  } catch (e) {
    console.warn(`[media-library] 自建存储上传异常：${(e as Error).message}`);
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* 对外接口                                                                    */
/* -------------------------------------------------------------------------- */

/** 缓存记录多久没被用过就复核一次（图床删图/限流时自愈） */
const RECHECK_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * 轻量可达性探测：GET + Range 只取 1 字节。
 * 公共图床会删违规图、也可能清长期未访问资源；命中缓存不等于地址还有效，
 * 但每次提交都探测又太贵，所以只在记录超过 RECHECK_AFTER_MS 未使用时复核一次。
 */
async function probePublicUrl(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Range: 'bytes=0-0', 'User-Agent': BROWSER_UA },
      signal: AbortSignal.timeout(4_000),
      redirect: 'follow',
    });
    return res.status >= 200 && res.status < 400;
  } catch {
    return false;
  }
}

/**
 * 本地路径 → 图库公网 URL。
 * - 已是 http(s) / data: / 非 /uploads → 原样返回（不做任何改动）
 * - 命中 public_media → 直接复用
 * - 未命中 → 上传到图库宿主，成功后落表；失败返回 undefined（调用方降级）
 */
export async function ensureLibraryUrl(
  db: PostgresJsDatabase,
  localPath?: string | null,
): Promise<string | undefined> {
  const raw = typeof localPath === 'string' ? localPath.trim() : '';
  if (!raw) return undefined;
  if (!isLocalUploadPath(raw)) return raw; // http(s) / data: / 裸串一律不动
  if (!isLibraryEnabled()) return undefined;

  const key = raw;
  const running = inflight.get(key);
  if (running) return running;

  const task = (async (): Promise<string | undefined> => {
    // ① 缓存：一次上传，长期复用
    try {
      const rows = await db
        .select({ publicUrl: publicMedia.publicUrl, lastUsedAt: publicMedia.lastUsedAt })
        .from(publicMedia)
        .where(eq(publicMedia.localPath, key))
        .limit(1);
      const cached = rows[0]?.publicUrl;
      if (cached) {
        const lastUsed = rows[0]?.lastUsedAt ? new Date(rows[0].lastUsedAt).getTime() : 0;
        // 只有「确实长期未使用」才复核；没有时间戳的旧数据按新鲜处理，不做额外探测
        const stale = lastUsed > 0 && Date.now() - lastUsed > RECHECK_AFTER_MS;
        if (!stale || (await probePublicUrl(cached))) {
          void db
            .update(publicMedia)
            .set({ lastUsedAt: new Date(), hits: sql`${publicMedia.hits} + 1` })
            .where(eq(publicMedia.localPath, key))
            .catch(() => undefined);
          return cached;
        }
        console.warn(`[media-library] 缓存地址已失效，重新上传：${cached.slice(0, 80)}`);
      }
    } catch (e) {
      // 表还没迁移时不能让整条链路挂掉：直接尝试上传，不写缓存
      console.warn(`[media-library] 查询缓存失败：${(e as Error).message}`);
    }

    const abs = localAbsolute(key);
    if (!abs) return undefined;
    let buf: Buffer;
    try {
      buf = await readFile(abs);
    } catch {
      return undefined; // 本地文件不存在：无法上传
    }
    if (buf.length === 0) return undefined;

    // ② 上传：按偏好依次尝试 self → catbox
    const pref = hostPreference();
    let result: UploadResult | null = null;
    if (pref === 'self') {
      result = await uploadSelf(abs, buf);
      if (!result) result = await uploadCatbox(abs, buf);
    } else {
      result = await uploadCatbox(abs, buf);
    }
    if (!result) return undefined;

    // ③ 落表（失败不影响本次使用，下次重新上传即可）
    try {
      const info = await stat(abs).catch(() => null);
      await db
        .insert(publicMedia)
        .values({
          localPath: key,
          publicUrl: result.publicUrl,
          host: result.host,
          bytes: info?.size ?? buf.length,
        })
        .onConflictDoUpdate({
          target: publicMedia.localPath,
          set: {
            publicUrl: result.publicUrl,
            host: result.host,
            bytes: info?.size ?? buf.length,
            lastUsedAt: new Date(),
          },
        });
    } catch (e) {
      console.warn(`[media-library] 写入映射失败：${(e as Error).message}`);
    }
    return result.publicUrl;
  })();

  inflight.set(key, task);
  try {
    return await task;
  } finally {
    inflight.delete(key);
  }
}

/**
 * 批量版本：保持顺序，单个失败返回 undefined 由调用方决定怎么降级。
 */
export async function ensureLibraryUrls(
  db: PostgresJsDatabase,
  paths: (string | undefined | null)[],
): Promise<(string | undefined)[]> {
  const out: (string | undefined)[] = [];
  for (const p of paths) {
    // eslint-disable-next-line no-await-in-loop
    out.push(await ensureLibraryUrl(db, p));
  }
  return out;
}

/**
 * 隧道兜底 URL（不写缓存）：图库完全不可用时，至少还能让上游在隧道存活期内取图。
 * 没有公网基址时返回 undefined。
 */
export function tunnelFallbackUrl(localPath: string): string | undefined {
  if (!isLocalUploadPath(localPath)) return undefined;
  const base = publicMediaBase();
  if (!base) return undefined;
  return `${base}${localPath}`;
}

/**
 * 已登记条数/宿主分布（运维排查用）。
 */
export async function libraryStats(
  db: PostgresJsDatabase,
): Promise<{ total: number; byHost: Record<string, number> }> {
  try {
    const rows = await db
      .select({ host: publicMedia.host, n: sql<number>`count(*)::int` })
      .from(publicMedia)
      .groupBy(publicMedia.host);
    const byHost: Record<string, number> = {};
    let total = 0;
    for (const r of rows) {
      byHost[r.host] = Number(r.n);
      total += Number(r.n);
    }
    return { total, byHost };
  } catch {
    return { total: 0, byHost: {} };
  }
}
