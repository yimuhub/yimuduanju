/**
 * 时间线媒体缓存淘汰（LRU-by-last-access）回归测试
 * ------------------------------------------------------------------
 * 缓存目录是可再生中间产物，不清会按项目无限累积。淘汰必须满足：
 *   1. 超过 TTL 没被访问的才删，热数据不能被误杀；
 *   2. 总量超上限时从最旧的开始删，删到上限以内就停；
 *   3. 最近 protectMs 内碰过的一律不动（正在读 / 刚生成还没被前端消费）；
 *   4. 纯函数判定要能穷举，IO 层（sweepTimelineCaches）单独验真删；
 *   5. 删失败（文件已被别人删掉）不能中断其余文件。
 */
import { mkdir, mkdtemp, rm, stat, utimes, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  envPositiveInt,
  planEviction,
  sweepTimelineCaches,
  type CacheFileEntry,
  type EvictionOptions,
} from '../../server/modules/timeline/timeline-cache';

const MB = 1024 * 1024;
const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 16, 10, 0, 0);

const entry = (name: string, size: number, ageDays: number): CacheFileEntry => ({
  path: `/cache/${name}`,
  size,
  mtimeMs: NOW - ageDays * DAY,
});

const opts = (patch: Partial<EvictionOptions> = {}): EvictionOptions => ({
  now: NOW,
  ttlMs: 14 * DAY,
  maxBytes: 100 * MB,
  protectMs: 10 * 60 * 1000,
  ...patch,
});

describe('planEviction · 按最后访问时间淘汰', () => {
  it('超过 TTL 没被访问的文件被删除', () => {
    const plan = planEviction([entry('old.mp4', 10 * MB, 20), entry('new.mp4', 10 * MB, 1)], opts());
    expect(plan.remove.map((e) => e.path)).toEqual(['/cache/old.mp4']);
    expect(plan.keptBytes).toBe(10 * MB);
    expect(plan.freedBytes).toBe(10 * MB);
  });

  it('TTL 内的热数据一个都不删', () => {
    const plan = planEviction([entry('a.mp4', 5 * MB, 3), entry('b.mp4', 5 * MB, 13)], opts());
    expect(plan.remove).toHaveLength(0);
    expect(plan.keptBytes).toBe(10 * MB);
  });

  it('总量超上限时从最旧的开始删，降到上限以内立即停手', () => {
    // 3 个 10MB 都没过期，上限 25MB → 删掉最旧的 1 个后剩 20MB 已达标
    const plan = planEviction(
      [entry('oldest.mp4', 10 * MB, 9), entry('mid.mp4', 10 * MB, 5), entry('new.mp4', 10 * MB, 1)],
      opts({ maxBytes: 25 * MB }),
    );
    expect(plan.remove.map((e) => e.path)).toEqual(['/cache/oldest.mp4']);
    expect(plan.keptBytes).toBe(20 * MB);
  });

  it('总量超上限需要连删多个时，严格按访问时间由旧到新', () => {
    const plan = planEviction(
      [
        entry('b.mp4', 10 * MB, 6),
        entry('a.mp4', 10 * MB, 8),
        entry('c.mp4', 10 * MB, 2),
        entry('d.mp4', 10 * MB, 1),
      ],
      opts({ maxBytes: 12 * MB }),
    );
    // 两个最旧的先走，剩 c+d=20MB 仍超 → 再删 c，剩 d=10MB 达标
    expect(plan.remove.map((e) => e.path)).toEqual(['/cache/a.mp4', '/cache/b.mp4', '/cache/c.mp4']);
    expect(plan.keptBytes).toBe(10 * MB);
  });

  it('最近 protectMs 内碰过的文件即使过期也不删', () => {
    const fresh: CacheFileEntry = { path: '/cache/hot.mp4', size: 10 * MB, mtimeMs: NOW - 60_000 };
    const plan = planEviction([fresh, entry('cold.mp4', 10 * MB, 30)], opts({ maxBytes: 5 * MB }));
    expect(plan.remove.map((e) => e.path)).toEqual(['/cache/cold.mp4']);
    // 受保护文件仍占容量，删无可删时 keptBytes 可以超过上限
    expect(plan.keptBytes).toBe(10 * MB);
  });

  it('只剩受保护文件时不做任何删除，如实返回仍超限的占用', () => {
    const plan = planEviction(
      [
        { path: '/cache/hot1.mp4', size: 50 * MB, mtimeMs: NOW - 1000 },
        { path: '/cache/hot2.mp4', size: 50 * MB, mtimeMs: NOW - 2000 },
      ],
      opts({ maxBytes: 10 * MB }),
    );
    expect(plan.remove).toHaveLength(0);
    expect(plan.keptBytes).toBe(100 * MB);
  });

  it('ttlMs = 0 表示不按时间淘汰，但容量上限仍然生效', () => {
    const plan = planEviction(
      [entry('old.mp4', 10 * MB, 400), entry('new.mp4', 10 * MB, 1)],
      opts({ ttlMs: 0, maxBytes: 10 * MB }),
    );
    expect(plan.remove.map((e) => e.path)).toEqual(['/cache/old.mp4']);
  });

  it('maxBytes = 0 表示不限量，只按时间淘汰', () => {
    const plan = planEviction(
      [entry('old.mp4', 900 * MB, 30), entry('new.mp4', 900 * MB, 1)],
      opts({ maxBytes: 0 }),
    );
    expect(plan.remove.map((e) => e.path)).toEqual(['/cache/old.mp4']);
  });

  it('空清单返回空计划，不炸', () => {
    const plan = planEviction([], opts());
    expect(plan).toEqual({ remove: [], keptBytes: 0, freedBytes: 0 });
  });
});

describe('sweepTimelineCaches · 真实目录', () => {
  let root = '';

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'yimu-tl-cache-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('只清 timeline-src / timeline-cache，原始上传与成片不动', async () => {
    const pid = 'proj-1';
    await mkdir(join(root, pid, 'timeline-src'), { recursive: true });
    await mkdir(join(root, pid, 'timeline-cache'), { recursive: true });
    await mkdir(join(root, pid, 'clips'), { recursive: true });
    await writeFile(join(root, pid, 'timeline-src', 'old-src.mp4'), Buffer.alloc(2048));
    await writeFile(join(root, pid, 'timeline-cache', 'thumb-old.jpg'), Buffer.alloc(1024));
    await writeFile(join(root, pid, 'clips', 'keep.mp4'), Buffer.alloc(4096));
    await writeFile(join(root, pid, 'final.mp4'), Buffer.alloc(4096));

    const old = new Date(NOW - 40 * DAY);
    for (const rel of ['timeline-src/old-src.mp4', 'timeline-cache/thumb-old.jpg']) {
      await utimes(join(root, pid, rel), old, old);
    }

    const result = await sweepTimelineCaches(root, opts());
    expect(result.scanned).toBe(2);
    expect(result.removed).toBe(2);
    expect(result.freedBytes).toBe(3072);

    // 非缓存目录原地保留
    await expect(stat(join(root, pid, 'clips', 'keep.mp4'))).resolves.toBeTruthy();
    await expect(stat(join(root, pid, 'final.mp4'))).resolves.toBeTruthy();
    // 缓存文件已消失
    await expect(stat(join(root, pid, 'timeline-src', 'old-src.mp4'))).rejects.toThrow();
  });

  it('刚写出来的缓存不会被同一次扫描删掉（保护窗口生效）', async () => {
    const pid = 'proj-2';
    await mkdir(join(root, pid, 'timeline-cache'), { recursive: true });
    await writeFile(join(root, pid, 'timeline-cache', 'thumb-fresh.jpg'), Buffer.alloc(1024));

    const result = await sweepTimelineCaches(root, opts({ ttlMs: 1000, maxBytes: 1 }));
    expect(result.removed).toBe(0);
    await expect(stat(join(root, pid, 'timeline-cache', 'thumb-fresh.jpg'))).resolves.toBeTruthy();
  });

  it('目录不存在时安静返回 0，不抛错', async () => {
    const result = await sweepTimelineCaches(join(root, 'not-exist'), opts());
    expect(result).toEqual({ scanned: 0, removed: 0, freedBytes: 0, keptBytes: 0 });
  });
});

describe('envPositiveInt', () => {
  const KEY = 'YIMU_TEST_CACHE_ENV';
  afterEach(() => {
    delete process.env[KEY];
  });

  it('缺省用 fallback', () => {
    expect(envPositiveInt(KEY, 14)).toBe(14);
  });

  it('合法值覆盖 fallback，0 也被尊重（表示关闭）', () => {
    process.env[KEY] = '0';
    expect(envPositiveInt(KEY, 14)).toBe(0);
    process.env[KEY] = '30';
    expect(envPositiveInt(KEY, 14)).toBe(30);
  });

  it('非法值回退 fallback，不会把 NaN 传进淘汰策略', () => {
    process.env[KEY] = 'abc';
    expect(envPositiveInt(KEY, 14)).toBe(14);
    process.env[KEY] = '-5';
    expect(envPositiveInt(KEY, 14)).toBe(14);
  });
});
