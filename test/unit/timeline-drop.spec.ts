import { laneFromY, pickFreeLane, type OccupiedSpan } from '../../client/src/lib/timeline-drop';
import { sameOrigin } from '../../client/src/components/studio/model';

/**
 * 拖放落点：把「剪映式拖拽自动开轨」的规则钉死在单测里。
 * 这几条一旦回归，表现就是「拖上去没反应 / 片段被叠在别人身上 / 每拖一次多一条空轨」。
 */
describe('pickFreeLane', () => {
  const span = (lane: number, start: number, end: number): OccupiedSpan => ({ lane, start, end });

  it('空轨：落在想要的 lane 上，且不算新建', () => {
    expect(pickFreeLane([], 0, 0, 8)).toEqual({ lane: 0, created: false });
  });

  it('目标 lane 在时间上不相交：原地放，不新开轨', () => {
    // 已有片段 0-8，现在往 8-16 放：首尾相接不算重叠
    expect(pickFreeLane([span(0, 0, 8)], 0, 8, 16)).toEqual({ lane: 0, created: false });
  });

  it('目标 lane 被占：优先复用下方已有空轨，而不是继续加高', () => {
    const occupied = [span(0, 0, 8), span(1, 20, 28)];
    expect(pickFreeLane(occupied, 0, 4, 12)).toEqual({ lane: 1, created: false });
  });

  it('所有已有 lane 都在该时刻有片段：新建最后一条的下一条', () => {
    const occupied = [span(0, 0, 8), span(1, 2, 10)];
    expect(pickFreeLane(occupied, 0, 4, 12)).toEqual({ lane: 2, created: true });
  });

  it('落在最后一行下方的空白区：直接新建，即使上面有空轨也不回收', () => {
    // 用户把素材拖到轨道区下方空白 = 明确想新开一条，不要偷偷塞回上面的空档
    const occupied = [span(0, 0, 8), span(2, 0, 8)];
    expect(pickFreeLane(occupied, 3, 0, 8)).toEqual({ lane: 3, created: true });
  });

  it('负数 / 非法的 preferred 归一到 0', () => {
    expect(pickFreeLane([], -3, 0, 4).lane).toBe(0);
    expect(pickFreeLane([], Number.NaN, 0, 4).lane).toBe(0);
  });

  it('只在同类型轨之间判断重叠（调用方已按 track 过滤，这里验证 lane 语义）', () => {
    const occupied = [span(0, 0, 5)];
    // 4.999→5 这种首尾差 1ms 的情况按重叠处理（避免视觉上叠在一起）
    expect(pickFreeLane(occupied, 0, 4.999, 12).lane).toBe(1);
  });
});

describe('laneFromY', () => {
  const rows = [
    { track: 'subtitle', lane: 0, height: 30 },
    { track: 'video', lane: 0, height: 62 },
    { track: 'video', lane: 1, height: 62 },
    { track: 'audio', lane: 0, height: 46 },
    { track: 'audio', lane: 1, height: 46 },
  ];

  it('命中画面行返回该行 lane', () => {
    expect(laneFromY(rows, 40, 'video')).toBe(0);
    expect(laneFromY(rows, 100, 'video')).toBe(1);
  });

  it('命中音频行返回该行 lane', () => {
    expect(laneFromY(rows, 180, 'audio')).toBe(0);
    expect(laneFromY(rows, 220, 'audio')).toBe(1);
  });

  it('拖音频到画面行：退回音频轨最上面一层，不新建', () => {
    expect(laneFromY(rows, 40, 'audio')).toBe(0);
  });

  it('拖画面到音频行：退回画面轨最上面一层', () => {
    expect(laneFromY(rows, 200, 'video')).toBe(0);
  });

  it('落在最后一行下方空白：返回该类型最大 lane + 1（= 新建一条轨）', () => {
    expect(laneFromY(rows, 9999, 'video')).toBe(2);
    expect(laneFromY(rows, 9999, 'audio')).toBe(2);
  });

  it('空行表：从 0 开始', () => {
    expect(laneFromY([], 0, 'video')).toBe(0);
  });
});

/**
 * 音画分离的判据：片段 id 每次落库都重生成，只能靠「同一份源媒体 + 同一段时间」认亲。
 * 这里钉住三条：完全一致才算同源、位置挪开就不再同源、源地址不同绝不同源。
 */
describe('sameOrigin（音画分离判重/合并）', () => {
  const base = {
    sourceUrl: '/uploads/p1/shot-1.mp4',
    timelineStart: 4,
    inPoint: 1,
    outPoint: 9,
  };

  it('源媒体与入出点、位置都一致 → 同源', () => {
    expect(sameOrigin({ ...base }, { ...base })).toBe(true);
  });

  it('音频被拖走了（时间线位置变了）→ 不再同源，不会误合并', () => {
    expect(sameOrigin({ ...base }, { ...base, timelineStart: 6 })).toBe(false);
  });

  it('出点被修剪过 → 不再同源', () => {
    expect(sameOrigin({ ...base }, { ...base, outPoint: 8 })).toBe(false);
  });

  it('源地址不同 → 不同源（哪怕位置一样）', () => {
    expect(sameOrigin({ ...base }, { ...base, sourceUrl: '/uploads/p1/shot-2.mp4' })).toBe(false);
  });

  it('没有源媒体（空片段）→ 永不同源', () => {
    expect(sameOrigin({ ...base, sourceUrl: null }, { ...base, sourceUrl: null })).toBe(false);
  });
});
