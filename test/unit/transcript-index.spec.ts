import type { TimelineClip, TimelineDocument } from '@shared/api.interface';
import {
  buildTranscriptIndex,
  describeRoughCut,
  formatTranscriptForAgent,
  selectRoughCutRanges,
} from '@shared/transcript-index';

const clip = (over: Partial<TimelineClip>): TimelineClip => ({
  id: 'id',
  clientKey: 'ck',
  projectId: 'p',
  track: 'subtitle',
  sourceShotId: null,
  sourceUrl: null,
  inPoint: 0,
  outPoint: 5,
  timelineStart: 0,
  lane: 0,
  speed: 1,
  volume: 1,
  locked: false,
  sortOrder: 0,
  text: '',
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

describe('transcript-index: 毫秒索引与选段', () => {
  it('字幕优先，输出成片绝对毫秒时间码', () => {
    const d = doc([
      clip({ id: 's1', clientKey: 's1', text: '第一句开场。第二句转折。', timelineStart: 0, outPoint: 5 }),
      clip({ id: 's2', clientKey: 's2', text: '第三句结论', timelineStart: 5, inPoint: 5, outPoint: 8 }),
    ]);
    const index = buildTranscriptIndex(d, []);
    expect(index.cues.length).toBeGreaterThanOrEqual(3);
    expect(index.cues[0].startMs).toBe(0);
    expect(index.cues[index.cues.length - 1].endMs).toBe(8000);
    expect(index.cues.every((c) => c.durationMs > 0)).toBe(true);
    expect(index.durationSec).toBe(8);
  });

  it('没有字幕时用镜头对白补齐，且已有字幕的镜头不重复', () => {
    const d = doc([
      clip({ id: 'v1', clientKey: 'v1', track: 'video', sourceShotId: 'shot-1', timelineStart: 0, outPoint: 4 }),
      clip({ id: 's1', clientKey: 's1', sourceShotId: 'shot-1', text: '已有字幕', timelineStart: 0, outPoint: 4 }),
      clip({ id: 'v2', clientKey: 'v2', track: 'video', sourceShotId: 'shot-2', timelineStart: 4, outPoint: 8 }),
    ]);
    const index = buildTranscriptIndex(d, [
      { id: 'shot-1', dialogue: '镜头一对白' },
      { id: 'shot-2', dialogue: '镜头二对白。第二句。' },
    ]);
    expect(index.cues.some((c) => c.source === 'subtitle' && c.text.includes('已有字幕'))).toBe(true);
    expect(index.cues.some((c) => c.shotId === 'shot-1' && c.source === 'shot')).toBe(false);
    expect(index.cues.some((c) => c.shotId === 'shot-2' && c.source === 'shot')).toBe(true);
  });

  it('formatTranscriptForAgent 带毫秒区间与质量标记', () => {
    const d = doc([clip({ id: 's1', clientKey: 's1', text: '一句话。', outPoint: 3 })]);
    const text = formatTranscriptForAgent(buildTranscriptIndex(d, []), 5000, 100);
    expect(text).toContain('[00:00.000–00:03.000]');
    expect(text).toContain('一句话');
  });

  it('selectRoughCutRanges 在全片内选段且不超目标太多，describe 可读', () => {
    const d = doc([
      clip({ id: 's1', clientKey: 's1', text: '开场钩子。这里很关键。', timelineStart: 0, outPoint: 6 }),
      clip({ id: 's2', clientKey: 's2', text: '中间过渡。', timelineStart: 6, outPoint: 12 }),
      clip({ id: 's3', clientKey: 's3', text: '情绪高点！结论落点。', timelineStart: 12, outPoint: 20 }),
    ]);
    const index = buildTranscriptIndex(d, []);
    const ranges = selectRoughCutRanges(index, { targetSec: 6 });
    expect(ranges.length).toBeGreaterThan(0);
    const total = ranges.reduce((sum, r) => sum + (r.end - r.start), 0);
    expect(total).toBeLessThanOrEqual(9);
    expect(describeRoughCut(ranges)).toContain('段');
  });
});
