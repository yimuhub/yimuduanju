/**
 * 图库（public media library）回归测试。
 * 事故背景：视频通道只吃公网 http(s) 首帧/参考图，而全部产物落的是
 * `/uploads/xxx.png`。老实现只有「上游 CDN」和「隧道临时副本」两条路，
 * 用户导入的本地图、早期没记 remoteUrl 的老任务全都送不出去。
 * 这里锁住：什么该直通、什么该上传、失败怎么降级、缓存怎么复用。
 */
import './helpers/hermetic-tunnel';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import {
  ensureLibraryUrl,
  isLibraryEnabled,
  tunnelFallbackUrl,
} from '@server/modules/generation/public-media-library';

const TMP_ROOT = '/tmp/ymlib-test';

interface DbState {
  cached?: string;
  inserted: Record<string, unknown>[];
}

/**
 * 最小 drizzle 链式 mock：只实现模块真正用到的三条链
 * select().from().where().limit() / insert().values().onConflictDoUpdate()
 * update().set().where().catch()
 */
function makeDb(state: DbState) {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(state.cached ? [{ publicUrl: state.cached }] : []),
        }),
      }),
    }),
    insert: () => ({
      values: (v: Record<string, unknown>) => ({
        onConflictDoUpdate: () => {
          state.inserted.push(v);
          return Promise.resolve();
        },
      }),
    }),
    update: () => ({
      set: () => ({
        where: () => ({
          catch: () => undefined,
        }),
      }),
    }),
  } as never;
}

describe('图库：本地图片 → 公网 URL', () => {
  const OLD_UPLOAD = process.env.UPLOAD_DIR;
  const OLD_LIB = process.env.YIMU_MEDIA_LIBRARY;
  const OLD_HOST = process.env.YIMU_MEDIA_HOST;
  let fetchMock: jest.Mock;

  beforeEach(async () => {
    process.env.UPLOAD_DIR = TMP_ROOT;
    delete process.env.YIMU_MEDIA_LIBRARY;
    delete process.env.YIMU_MEDIA_HOST;
    await mkdir(join(TMP_ROOT, 'proj'), { recursive: true });
    await writeFile(join(TMP_ROOT, 'proj', 'frame.png'), Buffer.from('fake-png-bytes'));
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(async () => {
    if (OLD_UPLOAD === undefined) delete process.env.UPLOAD_DIR;
    else process.env.UPLOAD_DIR = OLD_UPLOAD;
    if (OLD_LIB === undefined) delete process.env.YIMU_MEDIA_LIBRARY;
    else process.env.YIMU_MEDIA_LIBRARY = OLD_LIB;
    if (OLD_HOST === undefined) delete process.env.YIMU_MEDIA_HOST;
    else process.env.YIMU_MEDIA_HOST = OLD_HOST;
    await rm(TMP_ROOT, { recursive: true, force: true }).catch(() => undefined);
  });

  it('已是公网 URL / data URL 一律原样返回，不碰图床', async () => {
    const db = makeDb({ inserted: [] });
    await expect(ensureLibraryUrl(db, 'https://cdn.example.com/a.png')).resolves.toBe(
      'https://cdn.example.com/a.png',
    );
    await expect(ensureLibraryUrl(db, 'data:image/png;base64,AAAA')).resolves.toBe(
      'data:image/png;base64,AAAA',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('命中 public_media 缓存时直接复用，不再上传（隧道重启也不影响）', async () => {
    const db = makeDb({ cached: 'https://files.catbox.moe/abc.png', inserted: [] });
    await expect(ensureLibraryUrl(db, '/uploads/proj/frame.png')).resolves.toBe(
      'https://files.catbox.moe/abc.png',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('未命中时上传图库并登记映射', async () => {
    const state: DbState = { inserted: [] };
    fetchMock.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('https://files.catbox.moe/new.png\n'),
    });
    const url = await ensureLibraryUrl(makeDb(state), '/uploads/proj/frame.png');
    expect(url).toBe('https://files.catbox.moe/new.png');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(state.inserted[0]).toMatchObject({
      localPath: '/uploads/proj/frame.png',
      publicUrl: 'https://files.catbox.moe/new.png',
      host: 'catbox',
    });
  });

  it('图床返回非 URL（被 Cloudflare 拦、限流页）时降级为 undefined，不写脏数据', async () => {
    const state: DbState = { inserted: [] };
    fetchMock.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('<html>412 Precondition Failed</html>'),
    });
    await expect(
      ensureLibraryUrl(makeDb(state), '/uploads/proj/frame.png'),
    ).resolves.toBeUndefined();
    expect(state.inserted).toHaveLength(0);
  });

  it('图床 HTTP 失败 / 网络异常都不抛出，只返回 undefined', async () => {
    const db = makeDb({ inserted: [] });
    fetchMock.mockResolvedValue({ ok: false, status: 503, text: () => Promise.resolve('') });
    await expect(ensureLibraryUrl(db, '/uploads/proj/frame.png')).resolves.toBeUndefined();

    fetchMock.mockRejectedValue(new Error('ECONNRESET'));
    await expect(ensureLibraryUrl(db, '/uploads/proj/frame.png')).resolves.toBeUndefined();
  });

  it('本地文件不存在时不上传（不给图床塞空文件）', async () => {
    const db = makeDb({ inserted: [] });
    await expect(
      ensureLibraryUrl(db, '/uploads/proj/not-exist.png'),
    ).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('YIMU_MEDIA_LIBRARY=0 时整体关闭，返回 undefined 交给既有降级链', async () => {
    process.env.YIMU_MEDIA_LIBRARY = '0';
    expect(isLibraryEnabled()).toBe(false);
    const db = makeDb({ inserted: [] });
    await expect(ensureLibraryUrl(db, '/uploads/proj/frame.png')).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('隧道兜底 URL 只对本地路径生效，且不带尾斜杠重复', () => {
    const base = process.env.YIMU_PUBLIC_MEDIA_BASE;
    process.env.YIMU_PUBLIC_MEDIA_BASE = 'https://tunnel.example.com/';
    try {
      expect(tunnelFallbackUrl('/uploads/proj/frame.png')).toBe(
        'https://tunnel.example.com/uploads/proj/frame.png',
      );
      expect(tunnelFallbackUrl('/api/not-local')).toBeUndefined();
    } finally {
      if (base === undefined) delete process.env.YIMU_PUBLIC_MEDIA_BASE;
      else process.env.YIMU_PUBLIC_MEDIA_BASE = base;
    }
  });
});
