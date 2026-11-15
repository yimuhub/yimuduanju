/**
 * 视频首帧/尾帧的「公网 URL 解析」公共层。
 * ============================================================================
 * 根因（DB 实证，项目 b953370d 全部视频任务失败）：
 *   Agnes /videos 只吃公网 http(s) URL。图片产物虽已把上游 CDN 原始地址存进
 *   generation_jobs.outputData.images[0].remoteUrl，但视频侧只有首帧做了
 *   latestUpstreamFrame 兜底；尾帧/参考位仍是本地 /uploads 路径，被 staged-media
 *   拼到隧道基址上 —— 隧道一断（trycloudflare 每次重启换域名），上游按
 *   「media URL could not be downloaded」整单失败。
 *
 * 这里提供两个纯工具（不依赖 Nest 生命周期，db 由调用方传入）：
 *  1) resolveUpstreamFrameUrl：本地 /uploads 路径 → 图片任务回传的公网 CDN 地址。
 *     三级查找：shots.metadata.upstreamFrame 快路径 → 图片任务按产物 URL 精确匹配
 *     →（仅首帧）该镜头最近一次成功图片任务的 remoteUrl。
 *  2) isPublicUrlReachable：提交前对拼出来的公网 URL 做真实可达性探测，
 *     把「隧道已死/对象存储未配置」拦在本机，而不是让 Agnes 建单后才发现
 *     下载不了（那种失败最浪费：额度扣了、队列占了、用户只看到秒失败）。
 */
import { and, desc, eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { generationJobs } from '@server/database/schema';

export function isHttpUrl(u?: string | null): boolean {
  return typeof u === 'string' && /^https?:\/\//i.test(u);
}

/**
 * 快路径载体：processImage 成功回写时把 {local, remote} 写进 shots.metadata，
 * 视频侧当帧仍在本地且 local 与当前 startFrameUrl 一致时直接取 remote，
 * 免去按镜头扫任务表。
 */
export interface UpstreamFrameMeta {
  local?: string;
  remote?: string;
}

/**
 * 本地 /uploads 图片 → 上游回传的公网 CDN 地址（找不到返回 undefined）。
 * @param localPath 形如 /uploads/xxx.png 的本地路径
 * @param shotId    可选：该帧是某镜头首帧时的镜头 ID（启用第三级「最近成功」兜底）
 */
export async function resolveUpstreamFrameUrl(
  db: PostgresJsDatabase,
  localPath: string,
  shotId?: string,
  meta?: UpstreamFrameMeta | null,
): Promise<string | undefined> {
  if (!localPath || isHttpUrl(localPath)) return undefined;
  // ① 快路径：processImage 回写的 {local, remote} 配对，local 一致才算数
  if (meta?.remote && meta.local === localPath && isHttpUrl(meta.remote)) {
    return meta.remote;
  }
  try {
    // ② 精确匹配：找「产物 URL 就是这条本地路径」的成功图片任务（最新优先）。
    //    覆盖尾帧/角色图等非首帧位 —— 它们分属别的镜头/人物任务。
    const rows = await db
      .select({
        remoteUrl: sql<string | null>`${generationJobs.outputData}->'images'->0->>'remoteUrl'`,
      })
      .from(generationJobs)
      .where(
        and(
          eq(generationJobs.jobType, 'image'),
          eq(generationJobs.status, 'succeeded'),
          sql`${generationJobs.outputData}->'images'->0->>'url' = ${localPath}`,
        ),
      )
      .orderBy(desc(generationJobs.createdAt))
      .limit(1);
    const exact = rows[0]?.remoteUrl;
    if (typeof exact === 'string' && isHttpUrl(exact)) return exact;
    // ③ 镜头兜底：该镜头最近一次成功首帧任务的 remoteUrl（老任务 remoteUrl 缺失时为空）
    if (!shotId) return undefined;
    const shotRows = await db
      .select({ outputData: generationJobs.outputData })
      .from(generationJobs)
      .where(
        and(
          eq(generationJobs.jobType, 'image'),
          eq(generationJobs.targetId, shotId),
          eq(generationJobs.status, 'succeeded'),
        ),
      )
      .orderBy(desc(generationJobs.createdAt))
      .limit(1);
    const out = (shotRows[0]?.outputData ?? {}) as { images?: { remoteUrl?: string }[] };
    const url = out.images?.[0]?.remoteUrl;
    return isHttpUrl(url) ? url : undefined;
  } catch {
    return undefined;
  }
}

/**
 * 公网 URL 可达性探测：GET + Range 头（只取 1 字节，不整张下载）。
 * 只有 2xx/3xx 算可达 —— 404/403/超时/DNS 失败都算不可达，
 * 因为上游下载时的失败模式与我们一致（同一公网地址）。
 * 任何异常按不可达处理，由调用方走「上游 CDN 地址 → 显式跳过」的降级链。
 */
export async function isPublicUrlReachable(url: string, timeoutMs = 8_000): Promise<boolean> {
  if (!isHttpUrl(url)) return false;
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Range: 'bytes=0-0' },
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'follow',
    });
    return res.status >= 200 && res.status < 400;
  } catch {
    return false;
  }
}
