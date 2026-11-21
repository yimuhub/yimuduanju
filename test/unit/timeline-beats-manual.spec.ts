/**
 * R3 手动节拍覆盖层单测
 * ------------------------------------------------------------------
 * 覆盖 timeline-beats 的手动编辑纯逻辑：
 *   · mergeManualBeats：analyzed ⊕ {added, removed} → 生效节拍
 *     （removed 剔 analyzed、added 去近重复、升序毫秒取整）；
 *   · addBeatToEdits / removeBeatFromEdits / moveBeatInEdits：
 *     覆盖层的加/删/拖语义（拖 added 与拖 analyzed 的记录方式不同，
 *     但撤销还原的都是同一份覆盖层快照）。
 * 覆盖按「源媒体秒」存储，片段挪动 / 修剪后依然成立。
 */
import {
  addBeatToEdits,
  BEAT_MATCH_EPS,
  mergeManualBeats,
  moveBeatInEdits,
  removeBeatFromEdits,
  type ManualBeatEdits,
} from '../../client/src/lib/timeline-beats';

const analyzed = [0, 0.5, 1, 1.5, 2];

describe('mergeManualBeats', () => {
  it('无覆盖时原样返回（毫秒取整 + 升序）', () => {
    expect(mergeManualBeats([2, 0.5, 1.0004], null)).toEqual([0.5, 1, 2]);
    expect(mergeManualBeats([], { added: [], removed: [] })).toEqual([]);
  });

  it('removed 剔除 analyzed，added 并入生效集', () => {
    const edits: ManualBeatEdits = { added: [0.75], removed: [1] };
    expect(mergeManualBeats(analyzed, edits)).toEqual([0, 0.5, 0.75, 1.5, 2]);
  });

  it('added 落在已有生效节拍附近时视为重复丢弃', () => {
    const edits: ManualBeatEdits = { added: [0.505, 0.75], removed: [] };
    // 0.505 与 analyzed 0.5 差 5ms < EPS → 丢弃；0.75 保留
    expect(mergeManualBeats(analyzed, edits)).toEqual([0, 0.5, 0.75, 1, 1.5, 2]);
  });

  it('removed 只匹配 analyzed：added 的删除在 removeBeatFromEdits 里做', () => {
    const edits: ManualBeatEdits = { added: [0.75], removed: [0.75] };
    // removed 记录对 added 无效，added 仍生效
    expect(mergeManualBeats(analyzed, edits)).toEqual([0, 0.5, 0.75, 1, 1.5, 2]);
  });

  it('EPS 边界：差值达到 EPS 之上视为两个节拍', () => {
    expect(BEAT_MATCH_EPS).toBe(0.015);
    const edits: ManualBeatEdits = { added: [0.5 + BEAT_MATCH_EPS + 0.001], removed: [] };
    expect(mergeManualBeats([0.5], edits)).toEqual([0.5, 0.516]);
  });
});

describe('addBeatToEdits', () => {
  it('空地上加节拍 → 记入 added', () => {
    const op = addBeatToEdits(null, 0.75, analyzed);
    expect(op.changed).toBe(true);
    expect(op.edits.added).toEqual([0.75]);
    expect(op.edits.removed).toEqual([]);
  });

  it('已有生效节拍附近加 → 不产生覆盖（changed=false）', () => {
    expect(addBeatToEdits(null, 0.5, analyzed).changed).toBe(false);
    const withRemoved: ManualBeatEdits = { added: [], removed: [0.5] };
    // 0.5 已被删掉，再adder不是重复
    const op = addBeatToEdits(withRemoved, 0.5, analyzed);
    expect(op.changed).toBe(true);
    expect(op.edits.added).toEqual([0.5]);
  });
});

describe('removeBeatFromEdits', () => {
  it('删 analyzed 节拍 → 记入 removed', () => {
    const op = removeBeatFromEdits(null, 1, analyzed);
    expect(op.changed).toBe(true);
    expect(op.edits.removed).toEqual([1]);
  });

  it('删 added 节拍 → 直接从 added 移除', () => {
    const base: ManualBeatEdits = { added: [0.75, 0.9], removed: [] };
    const op = removeBeatFromEdits(base, 0.75, analyzed);
    expect(op.changed).toBe(true);
    expect(op.edits.added).toEqual([0.9]);
    expect(op.edits.removed).toEqual([]);
  });

  it('删不存在的节拍 → 不动', () => {
    expect(removeBeatFromEdits(null, 0.7, analyzed).changed).toBe(false);
  });
});

describe('moveBeatInEdits', () => {
  it('拖 analyzed 节拍：from 记 removed、to 记 added', () => {
    const op = moveBeatInEdits(null, 1, 1.25, analyzed);
    expect(op.changed).toBe(true);
    expect(op.edits.removed).toEqual([1]);
    expect(op.edits.added).toEqual([1.25]);
    expect(mergeManualBeats(analyzed, op.edits)).toEqual([0, 0.5, 1.25, 1.5, 2]);
  });

  it('拖 added 节拍：added 内部改位置，不碰 removed', () => {
    const base: ManualBeatEdits = { added: [0.75], removed: [2] };
    const op = moveBeatInEdits(base, 0.75, 0.8, analyzed);
    expect(op.edits.added).toEqual([0.8]);
    expect(op.edits.removed).toEqual([2]);
  });

  it('拖到已有生效节拍上 → 视为无效拖动（changed=false，不提交）', () => {
    const op = moveBeatInEdits(null, 1, 1.5, analyzed);
    // 1.5 与 analyzed 1.5 重合：落点被去重拒绝，整次拖动不产生变更
    expect(op.changed).toBe(false);
    expect(mergeManualBeats(analyzed, op.edits)).toEqual([0, 0.5, 1, 1.5, 2]);
  });

  it('拖不是节拍的点 → 退化为在 to 加一个', () => {
    const op = moveBeatInEdits(null, 0.33, 0.6, analyzed);
    expect(op.changed).toBe(true);
    expect(op.edits.added).toEqual([0.6]);
    expect(op.edits.removed).toEqual([]);
  });
});
