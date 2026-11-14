/**
 * 长篇多集纯逻辑回归（migration 0024，不依赖数据库）：
 * 覆盖任务要求的三个点 —— 创建（集号自动递增）/ 排序与上限（季内 500 集封顶 +
 * (season,number) 排序口径）/ 删除保护（locked 拒删、挂 shots/scenes 须 force），
 * 以及 B2 交接账本的 appendFact / resolveProp 规范化。
 */
import {
  EPISODE_MAX_PER_SEASON,
  appendFact,
  assertEpisodeQuota,
  canAdvanceEpisode,
  deriveEpisodeStatus,
  episodeDeleteGuard,
  episodeGateGuard,
  normalizeHandoffState,
  nextEpisodeNumber,
  resolveProp,
  upsertRelation,
} from '@shared/episode-logic';
import { emptyHandoffState } from '@shared/api.interface';
import type { HandoffState } from '@shared/api.interface';

const blankState = (): HandoffState => emptyHandoffState();

describe('创建集：季内集号自动递增 + 上限 500', () => {
  it('集号 = 当前最大集号 + 1（空季从 1 起）', () => {
    expect(nextEpisodeNumber(0)).toBe(1);
    expect(nextEpisodeNumber(1)).toBe(2);
    expect(nextEpisodeNumber(12)).toBe(13);
    expect(nextEpisodeNumber(Number('007'))).toBe(8);
  });

  it('第 500 集还能建，第 501 集拒绝（上限是「已有 ≥500 则拒绝」）', () => {
    expect(() => assertEpisodeQuota(EPISODE_MAX_PER_SEASON - 1)).not.toThrow();
    expect(() => assertEpisodeQuota(EPISODE_MAX_PER_SEASON)).toThrow(/上限/);
    expect(() => assertEpisodeQuota(9999)).toThrow(/500/);
  });

  it('集状态只允许单向推进，回退一律拒绝', () => {
    expect(canAdvanceEpisode('draft', 'script_ready')).toBe(true);
    expect(canAdvanceEpisode('draft', 'completed')).toBe(true);
    expect(canAdvanceEpisode('completed', 'draft')).toBe(false);
    expect(canAdvanceEpisode('shots_ready', 'script_ready')).toBe(false);
    expect(canAdvanceEpisode('video_generating', 'video_generating')).toBe(false);
  });

  it('集内 shots 聚合派生集状态（A4 按集聚合口径）', () => {
    expect(deriveEpisodeStatus({ totalShots: 0 })).toBe('draft');
    expect(deriveEpisodeStatus({ hasScript: true, totalShots: 0 })).toBe('script_ready');
    expect(
      deriveEpisodeStatus({ totalShots: 3, withFirstFrame: 3, withVideo: 0 }),
    ).toBe('shots_ready');
    expect(
      deriveEpisodeStatus({ totalShots: 3, withFirstFrame: 3, withVideo: 1, activeVideoJobs: 2 }),
    ).toBe('video_generating');
    expect(
      deriveEpisodeStatus({ totalShots: 3, withFirstFrame: 3, withVideo: 3 }),
    ).toBe('completed');
  });
});

describe('删除保护', () => {
  it('locked 集不可删（先解锁再删）', () => {
    const reason = episodeDeleteGuard({ locked: true }, { shots: 0, scenes: 0 }, true);
    expect(reason).toMatch(/锁定/);
  });

  it('挂着 shots/scenes 且未带 force → 拒绝并提示数量；force=true 放行', () => {
    const reason = episodeDeleteGuard({ locked: false }, { shots: 12, scenes: 3 });
    expect(reason).toMatch(/3 个场景 \/ 12 个镜头/);
    expect(episodeDeleteGuard({ locked: false }, { shots: 12, scenes: 3 }, true)).toBeNull();
  });

  it('空集（无 shots/scenes）不带 force 也可删', () => {
    expect(episodeDeleteGuard({ locked: false }, { shots: 0, scenes: 0 })).toBeNull();
  });
});

describe('按集门顺序（复用 project 级 approve 语义）', () => {
  it('乱序确认拒绝：未过剧本门不能确认分镜，未过分镜门不能确认成片', () => {
    expect(episodeGateGuard('storyboard', {})).toMatch(/剧本确认/);
    expect(episodeGateGuard('preview', { script: 't' })).toMatch(/分镜确认/);
    expect(episodeGateGuard('final', { script: 't' })).toMatch(/分镜确认/);
  });

  it('按序通过则放行', () => {
    expect(episodeGateGuard('script', {})).toBeNull();
    expect(episodeGateGuard('storyboard', { script: 't' })).toBeNull();
    expect(
      episodeGateGuard('preview', { script: 't', storyboard: 't' }),
    ).toBeNull();
    expect(
      episodeGateGuard('final', { script: 't', storyboard: 't', preview: 't' }),
    ).toBeNull();
  });
});

describe('交接账本（B2）：规范化 + appendFact / resolveProp', () => {
  it('normalizeHandoffState：{}、缺字段、非对象一律收敛成三数组齐全', () => {
    expect(normalizeHandoffState(undefined)).toEqual(blankState());
    expect(normalizeHandoffState('garbage')).toEqual(blankState());
    expect(normalizeHandoffState({ facts: 'x' })).toEqual(blankState());
    const normalized = normalizeHandoffState({
      facts: [{ text: '男主左臂中弹', createdAt: '2026-01-01T00:00:00Z' }],
      props: [{ name: '银簪', holder: '女主' }],
      relations: [{ a: '男主', b: '女主', status: '决裂' }],
      legacy: 'ignore-me',
    });
    expect(normalized.facts).toEqual([{ text: '男主左臂中弹', createdAt: '2026-01-01T00:00:00Z' }]);
    expect(normalized.props).toEqual([{ name: '银簪', holder: '女主', updatedAt: undefined }]);
    expect(normalized.relations).toEqual([{ a: '男主', b: '女主', status: '决裂' }]);
    // 空文本事实/空名道具被过滤
    expect(normalizeHandoffState({ facts: [{ text: '' }], props: [{ name: '  ' }] })).toEqual(blankState());
  });

  it('appendFact：追加不可逆事实，同文本去重，空文本不落账', () => {
    const s0 = blankState();
    const now = '2026-01-01T00:00:00Z';
    const r1 = appendFact(s0, '男主左臂中弹', now);
    expect(r1.changed).toBe(true);
    expect(r1.facts).toEqual([{ text: '男主左臂中弹', createdAt: now }]);
    // 同文本去重
    const r2 = appendFact({ ...s0, facts: r1.facts }, ' 男主左臂中弹 ', now);
    expect(r2.changed).toBe(false);
    expect(r2.facts).toHaveLength(1);
    // 空文本不落账
    expect(appendFact(s0, '   ', now).changed).toBe(false);
  });

  it('resolveProp：同名道具转手覆盖 holder，新道具追加（保留插入序）', () => {
    const now = '2026-01-02T00:00:00Z';
    const s0 = blankState();
    const r1 = resolveProp(s0, '银簪', '女主', now);
    expect(r1.props).toEqual([{ name: '银簪', holder: '女主', updatedAt: now }]);
    const r2 = resolveProp({ ...s0, props: r1.props }, '银簪', '男主', now);
    expect(r2.changed).toBe(true);
    expect(r2.props).toEqual([{ name: '银簪', holder: '男主', updatedAt: now }]);
    // 归属未变不重复记
    const r3 = resolveProp({ ...s0, props: r2.props }, '银簪', '男主', now);
    expect(r3.changed).toBe(false);
    // 新道具追加在后
    const r4 = resolveProp({ ...s0, props: r1.props }, '密信', '男主', now);
    expect(r4.props.map((p) => p.name)).toEqual(['银簪', '密信']);
  });

  it('upsertRelation：(a,b) 无序对唯一，同对覆盖 status', () => {
    const now = blankState();
    const r1 = upsertRelation(now, '男主', '女主', '结盟');
    expect(r1.relations).toEqual([{ a: '男主', b: '女主', status: '结盟' }]);
    // 反向书写同一对 → 覆盖而不是新增
    const r2 = upsertRelation({ ...now, relations: r1.relations }, '女主', '男主', '决裂');
    expect(r2.relations).toEqual([{ a: '女主', b: '男主', status: '决裂' }]);
    expect(r2.relations).toHaveLength(1);
  });
});

