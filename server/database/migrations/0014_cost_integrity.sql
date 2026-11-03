-- 0014 结算一致性：支撑「项目费用 = 成功任务金额合计」这一不变量的索引与数据归一。
-- 背景：旧结算实现是「先读状态再无条件 UPDATE + total_cost 自增」，
-- 同一任务被 worker 与 pollJob 并发结算时会重复累加；崩溃也可能只写任务不记账。
-- 应用层已改为 CAS + 单事务（见 generation.service.ts settleJobSuccess），
-- 这里补上对账所需的索引，并把历史 NULL 归一到 0。

-- 按项目汇总成功任务金额（对账 / 费用重算）走部分索引，避免全表扫描
CREATE INDEX IF NOT EXISTS idx_generation_jobs_project_succeeded
  ON generation_jobs (project_id)
  WHERE status = 'succeeded';

-- 任务认领：status='pending' 且按 priority DESC, _created_at 排序
CREATE INDEX IF NOT EXISTS idx_generation_jobs_pending_claim
  ON generation_jobs (priority DESC, _created_at)
  WHERE status = 'pending';

-- 历史行 total_cost 可能为 NULL（默认值不回溯），NULL + x 会静默变 NULL
UPDATE projects SET total_cost = '0' WHERE total_cost IS NULL;
