/**
 * 视频首帧送达形态的回归测试。
 * 事故：Agnes 的 /videos 只接受公网 URL，本地 `/uploads/xxx.png` 被判成非公网素材
 * 直接丢弃 → 每一单都退化成 mode=text（纯文生视频），首帧等于从没送到过模型。
 * 这里锁住「什么形态能送达 / 送不出去时必须给出原因」。
 */
import { toProviderVideoFrame } from '@server/modules/generation/media-input';

describe('视频首帧送达形态', () => {
  const OLD = process.env.YIMU_PUBLIC_MEDIA_BASE;

  afterEach(() => {
    if (OLD === undefined) delete process.env.YIMU_PUBLIC_MEDIA_BASE;
    else process.env.YIMU_PUBLIC_MEDIA_BASE = OLD;
  });

  it('公网 URL 原样送达（上游 CDN 回传的图走这一档）', async () => {
    const r = await toProviderVideoFrame('https://cdn.example.com/a.png');
    expect(r).toEqual({ url: 'https://cdn.example.com/a.png', kind: 'public' });
  });

  it('只认公网 URL 的供应商（Agnes）：本地首帧必须显式报「送不出去」', async () => {
    delete process.env.YIMU_PUBLIC_MEDIA_BASE;
    const r = await toProviderVideoFrame('/uploads/x/y.png', { allowDataUrl: false });
    expect(r.kind).toBe('none');
    expect(r.url).toBeUndefined();
    expect(r.reason).toContain('公网');
  });

  it('配了公网媒体基址时，本地首帧拼成公网地址', async () => {
    process.env.YIMU_PUBLIC_MEDIA_BASE = 'https://media.example.com/';
    const r = await toProviderVideoFrame('/uploads/x/y.png', { allowDataUrl: false });
    expect(r).toEqual({ url: 'https://media.example.com/uploads/x/y.png', kind: 'public' });
  });

  it('没有首帧时给明确原因，不静默', async () => {
    const r = await toProviderVideoFrame(undefined);
    expect(r.kind).toBe('none');
    expect(r.reason).toBeTruthy();
  });

  it('未知形态（blob: / 裸文件名）不发给供应商', async () => {
    expect((await toProviderVideoFrame('blob:http://x/1')).kind).toBe('none');
    expect((await toProviderVideoFrame('frame.png')).kind).toBe('none');
  });
});
