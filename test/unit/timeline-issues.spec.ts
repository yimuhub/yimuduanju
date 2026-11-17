/**
 * 时间线体检单测：保证 Agent 与导出看到的是同一套阻断口径。
 */
import { scanTimelineIssues, formatIssuesForAgent } from '../../shared/timeline-issues';
import type { TimelineClip, TimelineDocument } from '../../shared/api.interface';

const clip = (patch: Partial<TimelineClip>): TimelineClip =>
  ({
    id: 'id',
    clientKey: 'k',
    projectId: 'p',
    track: 'video',
    sourceShotId: null,
    sourceUrl: '/uploads/a.mp4',
    inPoint: 0,
    outPoint: 4,
    timelineStart: 0,
    lane: 0,
    speed: 1,
    volume: 1,
    transition: null,
    text: null,
    bindGroup: null,
    locked: false,
    enabled: true,
    sortOrder: 0,
    createdAt: '',
    updatedAt: '',
    ...patch,
  }) as TimelineClip;

const doc = (clips: TimelineClip[]): TimelineDocument =>
  ({ projectId: 'p', fps: 24, width: 1080, height: 1920, version: 1, clips, tracks: [] }) as TimelineDocument;

describe('timeline issues', () => {
  it('干净时间线没有阻断问题', () => {
    const issues = scanTimelineIssues(doc([clip({ clientKey: 'a' })]));
    expect(issues.filter((i) => i.severity === 'blocking')).toHaveLength(0);
  });

  it('同轨同层重叠是 blocking', () => {
    const issues = scanTimelineIssues(
      doc([
        clip({ clientKey: 'a', timelineStart: 0, outPoint: 4 }),
        clip({ clientKey: 'b', timelineStart: 2, outPoint: 6 }),
      ]),
    );
    expect(issues.some((i) => i.code === 'track_overlap' && i.severity === 'blocking')).toBe(true);
  });

  it('画面缺源素材是 blocking', () => {
    const issues = scanTimelineIssues(doc([clip({ clientKey: 'a', sourceUrl: null })]));
    expect(issues.some((i) => i.code === 'missing_source')).toBe(true);
  });

  it('字幕越界是 warning，不阻断导出', () => {
    const issues = scanTimelineIssues(
      doc([
        clip({ clientKey: 'v', timelineStart: 0, outPoint: 4 }),
        clip({
          clientKey: 's',
          track: 'subtitle',
          sourceUrl: null,
          text: '你好',
          timelineStart: 5,
          outPoint: 7,
        }),
      ]),
    );
    const hit = issues.find((i) => i.code === 'subtitle_out_of_range');
    expect(hit?.severity).toBe('warning');
  });

    it('主画面轨空隙会提示黑场', () => {
    const issues = scanTimelineIssues(
      doc([
        clip({ clientKey: 'a', timelineStart: 0, outPoint: 4 }),
        clip({ clientKey: 'b', timelineStart: 6, outPoint: 10 }),
      ]),
    );
    expect(issues.some((i) => i.code === 'main_gap')).toBe(true);
  });

  it('重复 clientKey 是 blocking', () => {
    const issues = scanTimelineIssues(
      doc([
        clip({ clientKey: 'dup', timelineStart: 0, outPoint: 4 }),
        clip({ clientKey: 'dup', track: 'audio', sourceUrl: '/uploads/a.mp3', timelineStart: 0, outPoint: 4 }),
      ]),
    );
    expect(issues.some((i) => i.code === 'duplicate_client_key')).toBe(true);
  });

  it('Agent 文本包含分级与片段键', () => {
    const issues = scanTimelineIssues(doc([clip({ clientKey: 'a', sourceUrl: null })]));
    const text = formatIssuesForAgent(issues);
    expect(text).toContain('blocking 1');
    expect(text).toContain('a');
  });
});
