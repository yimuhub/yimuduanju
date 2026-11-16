import { collectLiveFailedJobs } from '@shared/qc-job-issues';
import { decideQcGate } from '@shared/qc-gate';

/**
 * 回归：唐朝甜宠番外二 确认成片 / 导出 MP4 报 400（2026-11-16）
 * 两条独立链路，根因都在「历史遗留」：
 * 1) 质检把已被重试成功取代的失败任务当当前错误 → pass 永远 false；
 * 2) 成片门只认 pass===true，80-89 分的复核带永远无法由人拍板；
 * 3) 媒体代理 30s 总超时 < Agnes CDN 实际下载耗时（该条由 export.service 复用 curl 管线覆盖，
 *    这里锁住前两条的判决语义）。
 */

const shotA = '683029e0-db3d-46ce-81a3-1a9024bd26c3';
const shotB = '433e05dc-753f-4b1d-8ca2-dcad99ea91c1';

describe('质检失败任务口径：已被重试成功取代的历史失败不再计入', () => {
  it('11-14 的失败视频任务在 11-15 重试成功后，不算当前问题', () => {
    const jobs = [
      {
        jobType: 'video',
        targetType: 'shot',
        targetId: shotA,
        status: 'failed',
        createdAt: '2026-11-14T11:22:20.000Z',
      },
      {
        jobType: 'video',
        targetType: 'shot',
        targetId: shotA,
        status: 'succeeded',
        createdAt: '2026-11-15T13:02:38.000Z',
        completedAt: '2026-11-15T13:05:00.000Z',
      },
    ];
    expect(collectLiveFailedJobs(jobs)).toHaveLength(0);
  });

  it('重试成功之后又失败的新尝试仍然算当前问题', () => {
    const jobs = [
      {
        jobType: 'video',
        targetType: 'shot',
        targetId: shotB,
        status: 'failed',
        createdAt: '2026-11-14T11:22:20.000Z',
      },
      {
        jobType: 'video',
        targetType: 'shot',
        targetId: shotB,
        status: 'succeeded',
        createdAt: '2026-11-15T13:02:38.000Z',
        completedAt: '2026-11-15T13:05:00.000Z',
      },
      {
        jobType: 'video',
        targetType: 'shot',
        targetId: shotB,
        status: 'failed',
        createdAt: '2026-11-16T02:00:00.000Z',
      },
    ];
    const live = collectLiveFailedJobs(jobs);
    expect(live).toHaveLength(1);
    expect(live[0].createdAt).toBe('2026-11-16T02:00:00.000Z');
  });

  it('从未成功过的失败任务照旧计入（不能借这条修复放过真错误）', () => {
    const jobs = [
      {
        jobType: 'image',
        targetType: 'shot',
        targetId: shotA,
        status: 'failed',
        createdAt: '2026-11-16T02:00:00.000Z',
      },
      {
        jobType: 'video',
        targetType: 'shot',
        targetId: shotB,
        status: 'succeeded',
        createdAt: '2026-11-16T03:00:00.000Z',
      },
    ];
    expect(collectLiveFailedJobs(jobs)).toHaveLength(1);
  });

  it('无 target 的任务不参与取代判定（避免一批失败被空目标成功盖掉）', () => {
    const jobs = [
      { jobType: 'edit', targetType: null, targetId: null, status: 'failed', createdAt: '2026-11-16T01:00:00.000Z' },
      { jobType: 'edit', targetType: null, targetId: null, status: 'succeeded', createdAt: '2026-11-16T02:00:00.000Z' },
    ];
    expect(collectLiveFailedJobs(jobs)).toHaveLength(1);
  });
});

describe('成片门质检裁定：PASS / REVIEW / FAIL 三档', () => {
  const base = { thresholdPass: 90, thresholdReview: 80 };

  it('90 分以上直接放行，不写 override', () => {
    expect(decideQcGate({ ...base, score: 92, pass: true })).toEqual({
      allow: true,
      override: false,
    });
  });

  it('88 分（复核带）放行但要求人工覆盖留痕 —— 本次死锁的直接修复', () => {
    const d = decideQcGate({ ...base, score: 88, issueCount: 10, pass: false });
    expect(d.allow).toBe(true);
    expect(d.override).toBe(true);
  });

  it('边界 80 分属复核带，79 分硬拦并给可读原因', () => {
    expect(decideQcGate({ ...base, score: 80, pass: false }).override).toBe(true);
    const blocked = decideQcGate({ ...base, score: 79, issueCount: 12, pass: false });
    expect(blocked.allow).toBe(false);
    expect(blocked.reason).toContain('79 分');
    expect(blocked.reason).toContain('复核线 80 分');
  });

  it('报告 pass=true 时即便分数未达 PASS 线也放行（人工已复核过的报告）', () => {
    expect(decideQcGate({ ...base, score: 85, pass: true })).toEqual({
      allow: true,
      override: false,
    });
  });

  it('阈值自洽：复核线高于 PASS 线时按 PASS 线收敛，不会倒挂整段放行', () => {
    const d = decideQcGate({ score: 93, thresholdPass: 90, thresholdReview: 95, pass: false });
    expect(d.allow).toBe(true);
    expect(d.override).toBe(false);
  });

  it('异常分数（NaN / 负数）按 0 处理，不会误放行', () => {
    expect(decideQcGate({ ...base, score: Number.NaN, pass: false }).allow).toBe(false);
    expect(decideQcGate({ ...base, score: -20, pass: false }).allow).toBe(false);
  });
});
