import { diagnoseShot, diagnoseProject, ARTIFACT_STATE_LABELS } from '@shared/artifact-state';

/**
 * 产物四态与一致性体检单测（对标 ArcReel 的 current/stale/missing/blocked）。
 *
 * 这层的意义是「让问题可见」：哪条分镜已经过期、哪个镜被上游卡住、
 * 哪一段会跳轴。判定口径一旦改松，界面上就又会变成一片绿。
 */

const readyChar = { id: 'c1', name: '林晚', kind: 'character' as const, ready: true };
const notReadyChar = { id: 'c2', name: '沈砚', kind: 'character' as const, ready: false };
const readyLoc = { id: 'l1', name: '旧书店', kind: 'location' as const, ready: true };
const notReadyLoc = { id: 'l2', name: '公寓', kind: 'location' as const, ready: false };

const baseShot = {
  id: 's1',
  sceneId: 'sc1',
  sceneNumber: 1,
  segmentId: 'seg1',
  segmentNumber: 1,
  shotNumber: 1,
  duration: 6,
  shotSize: 'medium',
  dialogue: '你从哪儿弄来的？',
  characterIds: ['c1'],
  referenceImageUrls: [],
  startFrameUrl: '/frames/s1.png',
  videoUrl: '/videos/s1.mp4',
  voiceUrl: '/voice/s1.wav',
  screenDirection: 'left_to_right' as const,
  updatedAt: '2026-11-11T10:00:00.000Z',
  frameProducedAt: '2026-11-11T10:05:00.000Z',
};

describe('artifact-state · 单镜四态', () => {
  test('资产未就绪即阻塞（上游没解决，谈新旧没意义）', () => {
    const d = diagnoseShot(
      { ...baseShot, characterIds: ['c2'] },
      { assets: [readyChar, notReadyChar], scene: { id: 'sc1', sceneNumber: 1, locationId: 'l1' } },
    );
    expect(d.state).toBe('blocked');
    expect(d.issues.some((i) => i.code === 'asset_not_ready')).toBe(true);
  });

  test('场景没参考图也阻塞', () => {
    const d = diagnoseShot(baseShot, {
      assets: [readyChar, notReadyLoc],
      scene: { id: 'sc1', sceneNumber: 1, locationId: 'l2' },
    });
    expect(d.state).toBe('blocked');
  });

  test('没有首帧 = 缺失', () => {
    const d = diagnoseShot(
      { ...baseShot, startFrameUrl: null },
      { assets: [readyChar, readyLoc], scene: { id: 'sc1', sceneNumber: 1, locationId: 'l1' } },
    );
    expect(d.state).toBe('missing');
    expect(d.issues.some((i) => i.message === '还没有首帧')).toBe(true);
  });

  test('requireVideo 时缺视频算缺失，不要求时不算', () => {
    const shot = { ...baseShot, videoUrl: null };
    const ctx = { assets: [readyChar], scene: { id: 'sc1', sceneNumber: 1, locationId: 'l1' } };
    expect(diagnoseShot(shot, ctx).state).toBe('current');
    expect(diagnoseShot(shot, { ...ctx, requireVideo: true }).state).toBe('missing');
  });

  test('首帧产出后分镜又被改过 = 过期', () => {
    const d = diagnoseShot(
      { ...baseShot, updatedAt: '2026-11-11T11:00:00.000Z', frameProducedAt: '2026-11-11T10:05:00.000Z' },
      { assets: [readyChar] },
    );
    expect(d.state).toBe('stale');
    expect(d.issues.some((i) => i.code === 'artifact_stale')).toBe(true);
  });

  test('齐全且未过期 = 当前可用', () => {
    const d = diagnoseShot(baseShot, {
      assets: [readyChar, readyLoc],
      scene: { id: 'sc1', sceneNumber: 1, locationId: 'l1' },
    });
    expect(d.state).toBe('current');
  });

  test('场里有人但本镜没绑 = 告警但不改状态', () => {
    const d = diagnoseShot(
      { ...baseShot, characterIds: [] },
      {
        assets: [readyChar],
        scene: { id: 'sc1', sceneNumber: 1, locationId: 'l1', characterIds: ['c1'] },
      },
    );
    expect(d.state).toBe('current');
    expect(d.issues.some((i) => i.code === 'cast_unbound')).toBe(true);
  });

  test('状态中文标签齐全（UI 直接渲染）', () => {
    expect(Object.keys(ARTIFACT_STATE_LABELS)).toHaveLength(4);
  });
});

describe('artifact-state · 项目体检', () => {
  const assets = [readyChar, readyLoc];

  test('场次没绑场景要报出来', () => {
    const r = diagnoseProject({
      assets,
      scenes: [{ id: 'sc1', sceneNumber: 1, locationId: null }],
      segments: [],
      shots: [{ ...baseShot }],
    });
    expect(r.issues.some((i) => i.code === 'scene_without_location')).toBe(true);
  });

  test('未归段的镜头要有 info 提示（段内镜像链对它无效）', () => {
    const r = diagnoseProject({
      assets,
      scenes: [{ id: 'sc1', sceneNumber: 1, locationId: 'l1' }],
      segments: [],
      shots: [{ ...baseShot, segmentId: null }],
    });
    expect(r.issues.some((i) => i.code === 'shot_without_segment')).toBe(true);
  });

  test('段内跳轴被点名', () => {
    const r = diagnoseProject({
      assets,
      scenes: [{ id: 'sc1', sceneNumber: 1, locationId: 'l1' }],
      segments: [
        { id: 'seg1', sceneId: 'sc1', segmentNumber: 1, durationSeconds: 12, axisDirection: 'left_to_right' },
      ],
      shots: [
        { ...baseShot, id: 'a', shotNumber: 1, screenDirection: 'left_to_right' },
        { ...baseShot, id: 'b', shotNumber: 2, screenDirection: 'right_to_left' },
      ],
    });
    expect(r.issues.some((i) => i.code === 'axis_break')).toBe(true);
  });

  test('段超 15 秒给到 info', () => {
    const r = diagnoseProject({
      assets,
      scenes: [{ id: 'sc1', sceneNumber: 1, locationId: 'l1' }],
      segments: [{ id: 'seg1', sceneId: 'sc1', segmentNumber: 1, durationSeconds: 22 }],
      shots: [baseShot],
    });
    expect(r.issues.some((i) => i.code === 'segment_too_long')).toBe(true);
  });

  test('有 error 时体检不通过，并给出可读结论', () => {
    const r = diagnoseProject({
      assets: [notReadyChar],
      scenes: [{ id: 'sc1', sceneNumber: 1, locationId: null }],
      segments: [],
      shots: [{ ...baseShot, characterIds: ['c2'] }],
    });
    expect(r.passed).toBe(false);
    expect(r.counts.blocked).toBe(1);
    expect(r.summary).toContain('阻塞 1');
  });
});
