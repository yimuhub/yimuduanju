/**
 * generation 任务状态机回归测试。
 *
 * 覆盖本轮修复的三个 P0/P1 缺陷：
 * 1) pollJob 把 pending 改写成 running —— 两条认领路径（claimNextPendingJob /
 *    claimForQueue）都只认 pending，而 recoverOrphanedRunning 仅在启动时跑一次，
 *    因此前端轮询一次就能让任务永久卡死在 ≤95%；
 * 2) noteJobError 没有终态保护 —— 一条迟到的错误回调能把 succeeded/cancelled
 *    的任务翻回 pending，触发重跑并二次扣费；
 * 3) noteJobError 重试预算差一 —— `nextRetry >= maxRetries` 使 maxRetries=3
 *    实际只自动重试 2 次。
 *
 * 说明：这些用例不连数据库，用一个记录「写入补丁」的假 db 断言服务发出的 SQL 意图。
 * 断言刻意写得宽松（只检查关键字段），以免与结算/计费等无关写入耦合。
 */
import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { GenerationService } from '../../server/modules/generation/generation.service';

type Row = Record<string, unknown>;

/** 记录每次 update().set(patch) 的补丁，并按序返回预设的 returning() 结果 */
class FakeDb {
  selectRows: Row[] = [];
  updateReturns: Row[][] = [];
  /** 每次 update(...).returning() 捕获到的补丁，按调用顺序 */
  readonly patches: Row[] = [];
  private updateIdx = 0;

  select(): unknown {
    const self = this;
    const q: Record<string, unknown> = {};
    q.from = () => q;
    q.where = () => q;
    q.limit = () => q;
    q.orderBy = () => q;
    q.groupBy = () => q;
    // select 链是被 await 的，因此需要 thenable
    q.then = (
      onOk: (v: Row[]) => unknown,
      onErr?: (e: unknown) => unknown,
    ): PromiseLike<unknown> => Promise.resolve(self.selectRows).then(onOk, onErr);
    return q;
  }

  update(): unknown {
    const self = this;
    let patch: Row = {};
    const q: Record<string, unknown> = {};
    q.set = (p: Row) => {
      patch = p ?? {};
      return q;
    };
    q.where = () => q;
    q.returning = () => {
      const rows =
        self.updateReturns[
          Math.min(self.updateIdx, Math.max(0, self.updateReturns.length - 1))
        ] ?? [];
      self.updateIdx += 1;
      self.patches.push(patch);
      return Promise.resolve(rows);
    };
    return q;
  }

  /** 事务支持（budgetCap.runGuarded 路径）；测试内直接以默认连接执行 */
  transaction(fn: (tx: unknown) => Promise<unknown>): Promise<unknown> {
    return fn(this);
  }

  execute(): Promise<unknown[]> {
    return Promise.resolve([]);
  }
}

function makeRow(overrides: Row = {}): Row {
  return {
    id: 'job-1',
    projectId: 'proj-1',
    jobType: 'text',
    targetType: null,
    targetId: null,
    status: 'pending',
    progress: 0,
    priority: 50,
    providerName: null,
    modelName: null,
    errorMessage: null,
    inputData: null,
    outputData: null,
    retryCount: 0,
    maxRetries: 3,
    cost: '0',
    startedAt: null,
    completedAt: null,
    externalTaskId: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

/**
 * 绕过 Nest DI 直接构造服务实例：只注入本组用例真正会触碰的依赖。
 * 用 Object.assign 而非 new，避免与构造函数签名/装饰器元数据耦合。
 */
function makeService(db: FakeDb): GenerationService {
  return Object.assign(Object.create(GenerationService.prototype), {
    db,
    logger: new Logger('GenerationServiceSpec'),
    // 本组用例不触发结算，桩实现即可
    billing: { getUnitPrice: async () => 0.5 },
    modelGateway: {},
    budgetCap: { assertAllowed: async () => undefined },
    routing: {},
    stageBindings: {},
  }) as GenerationService;
}

describe('pollJob — 不得把 pending 偷成 running（P0）', () => {
  it('pending 任务只推进进度，不写 status、不写 startedAt', async () => {
    const row = makeRow({ id: 'job-pending', status: 'pending', progress: 0 });
    const db = new FakeDb();
    db.selectRows = [row];
    db.updateReturns = [[{ ...row, progress: 10 }]];

    const svc = makeService(db);
    const out = await svc.pollJob('job-pending');

    expect(db.patches).toHaveLength(1);
    // 关键断言：补丁里绝不能出现 status。
    // 一旦出现 running，claimNextPendingJob / claimForQueue 就再也认领不到它。
    expect(db.patches[0]).not.toHaveProperty('status');
    expect(db.patches[0]).not.toHaveProperty('startedAt');
    expect(db.patches[0].progress).toBe(10);
    expect(out.progress).toBe(10);
  });

  it('running 任务同样不改 status，但首次推进要补 startedAt', async () => {
    const row = makeRow({
      id: 'job-running',
      status: 'running',
      progress: 20,
      startedAt: null,
    });
    const db = new FakeDb();
    db.selectRows = [row];
    db.updateReturns = [[{ ...row, progress: 30 }]];

    const svc = makeService(db);
    await svc.pollJob('job-running');

    expect(db.patches).toHaveLength(1);
    expect(db.patches[0]).not.toHaveProperty('status');
    expect(db.patches[0]).toHaveProperty('startedAt');
    expect(db.patches[0].progress).toBe(30);
  });

  it('进度封顶 95，演示分支永远不会把任务标成 succeeded', async () => {
    const row = makeRow({ id: 'job-95', status: 'running', progress: 95 });
    const db = new FakeDb();
    db.selectRows = [row];
    db.updateReturns = [[{ ...row, progress: 95 }]];

    const svc = makeService(db);
    const out = await svc.pollJob('job-95');

    expect(db.patches[0].progress).toBe(95);
    expect(db.patches[0]).not.toHaveProperty('status');
    expect(out.status).not.toBe('succeeded');
  });

  it('终态任务直接返回，不产生任何写入', async () => {
    for (const status of ['succeeded', 'failed', 'cancelled']) {
      const db = new FakeDb();
      db.selectRows = [makeRow({ id: `job-${status}`, status })];
      const svc = makeService(db);

      const out = await svc.pollJob(`job-${status}`);

      expect(out.status).toBe(status);
      expect(db.patches).toHaveLength(0);
    }
  });
});

describe('noteJobError — 终态保护与重试预算', () => {
  it('终态任务收到迟到错误时直接忽略，不产生任何写入（P0）', async () => {
    for (const status of ['succeeded', 'failed', 'cancelled']) {
      const db = new FakeDb();
      db.selectRows = [makeRow({ id: `job-${status}`, status, progress: 100 })];
      const svc = makeService(db);

      const out = await svc.noteJobError(`job-${status}`, '迟到的上游错误');

      // 旧实现会把任务翻回 pending → 重跑 → 二次扣费
      expect(out.status).toBe(status);
      expect(db.patches).toHaveLength(0);
    }
  });

  it('重试预算未用尽：回到 pending，不终结', async () => {
    const row = makeRow({
      id: 'job-retry',
      status: 'running',
      retryCount: 2,
      maxRetries: 3,
    });
    const db = new FakeDb();
    db.selectRows = [row];
    db.updateReturns = [[{ ...row, status: 'pending', retryCount: 3 }]];

    const svc = makeService(db);
    await svc.noteJobError('job-retry', '瞬时错误');

    const statuses = db.patches.map((p) => p.status);
    expect(statuses).toContain('pending');
    expect(statuses).not.toContain('failed');
  });

  it('重试预算用尽（maxRetries=3 → 第 4 次失败才终结）：置 failed', async () => {
    const row = makeRow({
      id: 'job-exhausted',
      status: 'running',
      retryCount: 3,
      maxRetries: 3,
    });
    const db = new FakeDb();
    db.selectRows = [row];
    db.updateReturns = [[{ ...row, status: 'failed' }]];

    const svc = makeService(db);
    await svc.noteJobError('job-exhausted', '持续失败');

    const statuses = db.patches.map((p) => p.status);
    expect(statuses).toContain('failed');
    // 修复前 nextRetry(4) >= maxRetries(3) 在 retryCount=2 时就终结，
    // 即 maxRetries=3 实际只自动重试 2 次。这里锁住「第 3 次仍可重试」的语义：
    expect(statuses).not.toContain('pending');
  });

  it('retryCount 用 SQL 原子自增而非读-改-写', async () => {
    const row = makeRow({ id: 'job-atomic', status: 'running', retryCount: 0 });
    const db = new FakeDb();
    db.selectRows = [row];
    db.updateReturns = [[{ ...row, status: 'pending', retryCount: 1 }]];

    const svc = makeService(db);
    await svc.noteJobError('job-atomic', '瞬时错误');

    const patch = db.patches[0];
    // 并发错误回报时，写入常量 1 会互相覆盖；必须是 SQL 片段
    expect(patch.retryCount).not.toBe(1);
    expect(typeof patch.retryCount).toBe('object');
  });
});
