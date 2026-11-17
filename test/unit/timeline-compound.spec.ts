import type { TimelineClip } from '@shared/api.interface';
import {
  compoundChildAt,
  expandCompoundClip,
  virtualCompoundClip,
} from '@shared/timeline-compound';

const parent = (over: Partial<TimelineClip> = {}): TimelineClip => ({
  id: 'cmp',
  clientKey: 'cmp',
  projectId: 'p',
  track: 'video',
  sourceUrl: '/a.mp4',
  inPoint: 0,
  outPoint: 4,
  timelineStart: 10,
  lane: 0,
  speed: 1,
  volume: 1,
  locked: false,
  sortOrder: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  compound: {
    children: [
      {
        key: 'a',
        sourceUrl: '/a.mp4',
        inPoint: 1,
        outPoint: 3,
        offset: 0,
        speed: 1,
      },
      {
        key: 'b',
        sourceUrl: '/b.mp4',
        inPoint: 0,
        outPoint: 2,
        offset: 2,
        speed: 1,
      },
    ],
  },
  ...over,
});

describe('timeline compound', () => {
  it('按播放头命中子片段', () => {
    const hit = compoundChildAt(parent(), 12.5);
    expect(hit?.child.key).toBe('b');
  });

  it('虚拟片段映射源媒体入出点与时间线起点', () => {
    const v = virtualCompoundClip(parent(), 11);
    expect(v?.sourceUrl).toBe('/a.mp4');
    expect(v?.inPoint).toBe(1);
    expect(v?.timelineStart).toBe(10);
  });

  it('导出展开保留子片段顺序与偏移', () => {
    const out = expandCompoundClip(parent());
    expect(out).toHaveLength(2);
    expect(out[0].timelineStart).toBe(10);
    expect(out[1].timelineStart).toBe(12);
  });

  it('复合片段整体裁剪后只展开可见部分', () => {
    const out = expandCompoundClip(parent({ inPoint: 1, outPoint: 3 }));
    expect(out).toHaveLength(2);
    expect(out[0].inPoint).toBe(2);
    expect(out[0].outPoint).toBe(3);
  });
});
