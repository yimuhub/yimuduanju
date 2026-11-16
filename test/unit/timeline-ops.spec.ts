import type { TimelineClip, TimelineDocument } from '@shared/api.interface';
import {
  applyTimelineOps,
  clipCode,
  clipKey,
  describeTimelineForAgent,
  resolveClip,
  timelineDuration,
} from '@shared/timeline-ops';

const baseClip = (over: Partial<TimelineClip> = {}): TimelineClip => ({
  id: 'id-1',
  clientKey: 'ck-1',
  projectId: 'p-1',
  track: 'video',
  sourceShotId: null,
  sourceUrl: '/uploads/a.mp4',
  inPoint: 0,
  outPoint: 2,
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

const docOf = (clips: TimelineClip[], over: Partial<TimelineDocument> = {}): TimelineDocument => ({
  projectId: 'p-1',
  fps: 24,
  width: 1080,
  height: 1920,
  clips,
  version: 3,
  tracks: [],
  ...over,
});

describe('timeline-ops: 引用解析', () => {
  it('clientKey / code 都能定位到同一条片段', () => {
    const doc = docOf([baseClip(), baseClip({ id: 'id-2', clientKey: 'ck-2', timelineStart: 2 })]);
    expect(clipKey(resolveClip(doc, { clientKey: 'ck-2' })!)).toBe('ck-2');
    expect(resolveClip(doc, { code: 'V1#1' })?.clientKey).toBe('ck-1');
    expect(resolveClip(doc, { code: 'V1#2' })?.clientKey).toBe('ck-2');
    expect(resolveClip(doc, { clientKey: '不存在' })).toBeNull();
  });

  it('clipCode 按同轨时间排序编号', () => {
    const doc = docOf([
      baseClip({ clientKey: 'b', timelineStart: 5 }),
      baseClip({ clientKey: 'a', timelineStart: 1 }),
    ]);
    expect(clipCode(doc, resolveClip(doc, { clientKey: 'a' })!)).toBe('V1#1');
    expect(clipCode(doc, resolveClip(doc, { clientKey: 'b' })!)).toBe('V1#2');
  });
});

describe('timeline-ops: 修剪/移动', () => {
  it('右边缘修剪 -0.5s 缩短片段并算出总时长变化', () => {
    const doc = docOf([baseClip({ outPoint: 2 })]);
    const res = applyTimelineOps(doc, [
      { op: 'trim', target: { clientKey: 'ck-1' }, edge: 'right', deltaSec: -0.5 },
    ]);
    expect(res.errors).toHaveLength(0);
    expect(res.doc.clips[0].outPoint).toBe(1.5);
    expect(res.diffs[0].after).toContain('1.500s');
    expect(res.durationDelta).toBe(-0.5);
  });

  it('移动到被占用的 lane 且未指定目标轨：自动落到空 lane', () => {
    const doc = docOf([
      baseClip({ clientKey: 'a', id: 'a', timelineStart: 0 }),
      baseClip({ clientKey: 'b', id: 'b', timelineStart: 0, lane: 0 }),
    ]);
    const res = applyTimelineOps(doc, [
      { op: 'move', target: { clientKey: 'a' }, toStart: 0 },
    ]);
    expect(res.errors).toHaveLength(0);
    const moved = res.doc.clips.find((c) => c.clientKey === 'a')!;
    expect(moved.lane).toBe(1);
    expect(res.diffs[0].note).toContain('自动落到');
  });

  it('显式指定已占用轨：整批拒绝，不产生半截状态', () => {
    const doc = docOf([
      baseClip({ clientKey: 'a', id: 'a' }),
      baseClip({ clientKey: 'b', id: 'b', lane: 1 }),
    ]);
    const res = applyTimelineOps(doc, [
      { op: 'move', target: { clientKey: 'a' }, toStart: 0, toLane: 1 },
    ]);
    expect(res.errors).toHaveLength(1);
    expect(res.doc).toBe(doc);
    expect(res.diffs).toHaveLength(0);
  });

  it('锁定片段拒绝移动', () => {
    const doc = docOf([baseClip({ locked: true })]);
    const res = applyTimelineOps(doc, [
      { op: 'move', target: { clientKey: 'ck-1' }, toStart: 5 },
    ]);
    expect(res.errors[0].message).toContain('锁定');
  });
});

describe('timeline-ops: 删除/字幕/轨道', () => {
  it('批量删除里有一条锁定：整批不生效', () => {
    const doc = docOf([
      baseClip({ clientKey: 'a', id: 'a' }),
      baseClip({ clientKey: 'b', id: 'b', locked: true }),
    ]);
    const res = applyTimelineOps(doc, [
      { op: 'delete', targets: [{ clientKey: 'a' }, { clientKey: 'b' }] },
    ]);
    expect(res.errors[0].message).toContain('锁定');
    expect(res.doc.clips).toHaveLength(2);
  });

  it('新增字幕 + 修改已有字幕', () => {
    const doc = docOf([]);
    const first = applyTimelineOps(doc, [
      { op: 'subtitle', text: '第一句', atSec: 1, durationSec: 2 },
    ]);
    expect(first.errors).toHaveLength(0);
    expect(first.doc.clips[0].track).toBe('subtitle');
    expect(first.doc.clips[0].timelineStart).toBe(1);
    const key = clipKey(first.doc.clips[0]);
    const second = applyTimelineOps(first.doc, [
      { op: 'subtitle', target: { clientKey: key }, text: '改过的句子' },
    ]);
    expect(second.doc.clips[0].text).toBe('改过的句子');
  });

  it('轨道创建追加到同类型末尾并带备选语义', () => {
    const doc = docOf([baseClip()], { tracks: [{ track: 'video', lane: 0, role: 'main' }] });
    const res = applyTimelineOps(doc, [
      { op: 'track', action: 'create', track: 'video' },
    ]);
    expect(res.errors).toHaveLength(0);
    expect(res.doc.tracks?.some((t) => t.track === 'video' && t.lane === 1)).toBe(true);
    expect(res.doc.tracks?.find((t) => t.lane === 1)?.role).toBe('alt');
  });
});

describe('timeline-ops: 安全边界', () => {
  it('未知动作整批拒绝', () => {
    const doc = docOf([baseClip()]);
    const res = applyTimelineOps(doc, [
      { op: 'rm-rf' } as never,
    ]);
    expect(res.errors[0].message).toContain('不支持的动作');
  });

  it('超过 40 个动作拒绝', () => {
    const doc = docOf([baseClip()]);
    const res = applyTimelineOps(doc, Array.from({ length: 41 }, () => ({
      op: 'lock' as const,
      target: { clientKey: 'ck-1' },
      locked: true,
    })));
    expect(res.errors[0].message).toContain('过多');
  });

  it('纯函数不修改入参', () => {
    const doc = docOf([baseClip()]);
    applyTimelineOps(doc, [
      { op: 'trim', target: { clientKey: 'ck-1' }, edge: 'right', deltaSec: -0.5 },
    ]);
    expect(doc.clips[0].outPoint).toBe(2);
  });

  it('Agent 上下文包含版本、总时长与 clientKey', () => {
    const doc = docOf([baseClip()]);
    const text = describeTimelineForAgent(doc);
    expect(text).toContain('版本 v3');
    expect(text).toContain('总长 2s');
    expect(text).toContain('key=ck-1');
  });

  it('timelineDuration 取所有轨道最大出点', () => {
    const doc = docOf([baseClip({ timelineStart: 10, inPoint: 0, outPoint: 2 })]);
    expect(timelineDuration(doc)).toBe(12);
  });
});
