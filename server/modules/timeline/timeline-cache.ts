/**
 * 时间线媒体缓存淘汰（LRU-by-last-access）
 * -------------------------------------------------------------
 * 为什么需要：`uploads/<projectId>/timeline-src` 会为每个片段留一份源媒体本地副本，
 * `timeline-cache` 会为每组参数留 sprite / peaks。它们都不是用户资产，属于可再生的
 * 中间产物 —— 但如果从不清，一个项目跑十几版就会占掉几个 GB，用户还不知道空间去哪了。
 *
 * 淘汰语义（按「最后访问时间」= 文件 mtime）：
 *   1. 命中缓存时由调用方 touch()，所以 mtime 真的等于最后一次被用到的时间；
 *     不用 atime —— macOS / Linux 的 relatime 会把它拖成「一天最多更新一次」，不可信。
 *   2. 超过 TTL 没被访问 → 删。
 *   3. 总量仍超过上限 → 从最旧的开始继续删，直到降回上限以内。
 *   4. 最近 protectMs 内碰过的文件一律不删：它们要么正在被读取，要么刚生成完
 *      还没写进前端状态，删了会让用户看到「缩略图突然消失」。
 *
 * 判定逻辑抽成纯函数（planEviction），IO 在 sweepTimelineCaches，
 * 这样淘汰规则能被单测穷举，不必真的去造文件。
 */
import { readdir, stat, unlink } from 'fs/promises';
import { join } from 'path';

/** 只扫这两个子目录，项目原始上传与导出产物（clips / final_*）不在此列 */
export const CACHE_SUBDIRS = ['timeline-src', 'timeline-cache'] as const;

export interface CacheFileEntry {
  path: string;
  size: number;
  /** 最后访问时间（由调用方 touch 维护） */
  mtimeMs: number;
}

export interface EvictionOptions {
  now: number;
  /** 超过这个时长没访问就删；<= 0 表示不按时间淘汰 */
  ttlMs: number;
  /** 缓存总量上限；<= 0 表示不限量 */
  maxBytes: number;
  /** 这么久之内碰过的文件不删 */
  protectMs: number;
}

export interface EvictionPlan {
  remove: CacheFileEntry[];
  /** 淘汰后预计保留的字节数（含受保护文件） */
  keptBytes: number;
  freedBytes: number;
}

/**
 * 纯函数：给定文件清单与策略，算出该删哪些。
 * 受保护文件永远不进 remove；内容淘汰从最旧开始，删够为止。
 */
export function planEviction(entries: CacheFileEntry[], opts: EvictionOptions): EvictionPlan {
  const { now, ttlMs, maxBytes, protectMs } = opts;
  const protectedEntries: CacheFileEntry[] = [];
  const candidates: CacheFileEntry[] = [];
  for (const entry of entries) {
    const age = now - entry.mtimeMs;
    if (protectMs > 0 && age < protectMs) protectedEntries.push(entry);
    else candidates.push(entry);
  }
  // 最旧的排前面：过期淘汰与容量淘汰都按这个顺序出手
  candidates.sort((a, b) => a.mtimeMs - b.mtimeMs || a.path.localeCompare(b.path));

  const remove: CacheFileEntry[] = [];
  const survivors: CacheFileEntry[] = [];
  const expireBefore = now - ttlMs;
  for (const entry of candidates) {
    if (ttlMs > 0 && entry.mtimeMs < expireBefore) remove.push(entry);
    else survivors.push(entry);
  }

  let keptBytes =
    protectedEntries.reduce((sum, e) => sum + e.size, 0) +
    survivors.reduce((sum, e) => sum + e.size, 0);

  if (maxBytes > 0) {
    for (const entry of survivors) {
      if (keptBytes <= maxBytes) break;
      remove.push(entry);
      keptBytes -= entry.size;
    }
  }

  const freedBytes = remove.reduce((sum, e) => sum + e.size, 0);
  return { remove, keptBytes: Math.max(0, keptBytes), freedBytes };
}

export interface SweepResult {
  scanned: number;
  removed: number;
  freedBytes: number;
  keptBytes: number;
}

const EMPTY: SweepResult = { scanned: 0, removed: 0, freedBytes: 0, keptBytes: 0 };

/**
 * 扫 uploads 下所有项目的两个缓存子目录，按 planEviction 的结果删文件。
 * 任何一步失败（目录不存在、删到一半被别人删了）都只跳过，不影响其余文件。
 */
export async function sweepTimelineCaches(
  rootDir: string,
  opts: EvictionOptions,
): Promise<SweepResult> {
  let projectDirs: string[];
  try {
    projectDirs = await readdir(rootDir);
  } catch {
    return EMPTY;
  }

  const entries: CacheFileEntry[] = [];
  for (const projectDir of projectDirs) {
    for (const sub of CACHE_SUBDIRS) {
      const dir = join(rootDir, projectDir, sub);
      let names: string[];
      try {
        // eslint-disable-next-line no-await-in-loop
        names = await readdir(dir);
      } catch {
        continue;
      }
      for (const name of names) {
        const path = join(dir, name);
        // eslint-disable-next-line no-await-in-loop
        const info = await stat(path).catch(() => null);
        if (info?.isFile()) entries.push({ path, size: info.size, mtimeMs: info.mtimeMs });
      }
    }
  }
  if (entries.length === 0) return EMPTY;

  const plan = planEviction(entries, opts);
  let removed = 0;
  let freedBytes = 0;
  for (const entry of plan.remove) {
    // eslint-disable-next-line no-await-in-loop
    const ok = await unlink(entry.path).then(
      () => true,
      () => false,
    );
    if (ok) {
      removed += 1;
      freedBytes += entry.size;
    }
  }
  return { scanned: entries.length, removed, freedBytes, keptBytes: plan.keptBytes };
}

/** 读环境变量里的正整数；非法或缺省时用 fallback */
export function envPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}
