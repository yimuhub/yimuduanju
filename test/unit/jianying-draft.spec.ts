import type { TimelineClip, TimelineDocument } from '@shared/api.interface';
import { buildJianyingDraftContent, buildJianyingMeta } from '@shared/jianying-draft';

const clip = (over: Partial<TimelineClip>): TimelineClip => ({
  id: 'id',
  clientKey: 'ck',
  projectId: 'p',
  track: 'video',
  sourceShotId: null,
  sourceUrl: '/uploads/a.mp4',
  inPoint: 0,
  outPoint: 8,
  timelineStart: 0,
  lane: 0,
  speed: 1,
  volume: 1,
  locked: false,
  sortOrder: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...over,
});

const doc = (clips: TimelineClip[]): TimelineDocument => ({
  projectId: 'p',
  fps: 24,
  width: 1080,
  height: 1920,
  clips,
  version: 1,
  tracks: [],
});

describe('jianying-draft: 剪映草稿结构', () => {
  const draft = buildJianyingDraftContent(
    doc([
      clip({ clientKey: 'v1', sourceUrl: '/uploads/a.mp4', timelineStart: 0, outPoint: 8 }),
      clip({
        clientKey: 'a1',
        track: 'audio',
        sourceUrl: '/uploads/a.mp4',
        timelineStart: 0,
        lane: 0,
        outPoint: 8,
      }),
      clip({
        clientKey: 's1',
        track: 'subtitle',
        sourceUrl: null,
        text: '第一句字幕',
        timelineStart: 0,
        outPoint: 3,
        textStyle: { fontSize: 5.2, color: '#FFFFFF', bold: true, align: 'center', x: 0.5, y: 0.86 },
      }),
    ]),
    {
      draftId: 'DRAFT',
      name: '测试草稿',
      resources: {
        '/uploads/a.mp4': '##_draftpath_placeholder_DRAFT_##/Resources/a.mp4',
      },
      mediaSize: { '/uploads/a.mp4': { width: 1080, height: 1920, duration: 8, type: 'video' } },
    },
  ) as Record<string, any>;

  it('顶层版本与画布正确', () => {
    expect(draft.version).toBe(360000);
    expect(draft.new_version).toBe('110.0.0');
    expect(draft.canvas_config).toEqual({ width: 1080, height: 1920, ratio: '9:16' });
    expect(draft.tracks.map((t: any) => t.type)).toEqual(['video', 'audio', 'text']);
  });

  it('所有 material_id / extra_material_refs 都能在 materials 中找到', () => {
    const mats = draft.materials as Record<string, any[]>;
    const ids = new Set<string>();
    for (const arr of Object.values(mats)) for (const m of arr) if (m?.id) ids.add(m.id);
    for (const track of draft.tracks as any[]) {
      for (const seg of track.segments) {
        expect(ids.has(seg.material_id)).toBe(true);
        for (const ref of seg.extra_material_refs ?? []) expect(ids.has(ref)).toBe(true);
        expect(seg.target_timerange.duration).toBeGreaterThan(0);
      }
    }
  });

  it('字幕内容是可被剪映解析的 JSON 字符串', () => {
    const texts = draft.materials.texts as any[];
    expect(texts).toHaveLength(1);
    const parsed = JSON.parse(texts[0].content);
    expect(parsed.text).toBe('第一句字幕');
    expect(parsed.styles[0].range).toEqual([0, 5]);
    expect(texts[0].font_path).toBe('D:');
  });

  it('meta 与 duration 对齐', () => {
    const meta = buildJianyingMeta('DRAFT', '测试草稿', 8);
    expect(meta.draft_id).toBe('DRAFT');
    expect(meta.tm_duration).toBe(8_000_000);
  });
});
