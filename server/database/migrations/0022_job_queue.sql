-- 0022 全站确定性排队（queue_seq）
-- 背景：队列模式 `ORDER BY _created_at ASC LIMIT 1`，但同一事务批量插入的多行
--       _created_at 完全相同（PostgreSQL 事务级时间戳），且没有次级排序键；
--       Redis 降级模式却改成 `ORDER BY priority DESC, _created_at`；
--       列表接口又是 `ORDER BY _created_at DESC`。三处顺序互不一致，
--       多项目并行时「谁先跑」既不确定、也看不见、更没法人工调整。
-- 方案：新增由序列自增的 queue_seq 作为唯一排序键，可读写、可交换、可重排。
-- 全部语句幂等，存量任务按「提交时间 + id」确定性回填。

CREATE SEQUENCE IF NOT EXISTS generation_jobs_queue_seq_seq AS BIGINT;

ALTER TABLE generation_jobs ADD COLUMN IF NOT EXISTS queue_seq BIGINT;

-- 存量回填：id::text 只是同时间戳内的稳定 tiebreaker，保证迁移可重复执行结果一致
WITH ordered AS (
  SELECT id,
         row_number() OVER (ORDER BY _created_at ASC, id::text ASC) AS rn
  FROM generation_jobs
  WHERE queue_seq IS NULL
)
UPDATE generation_jobs AS g
SET queue_seq = o.rn
FROM ordered AS o
WHERE g.id = o.id AND g.queue_seq IS NULL;

-- 序列对齐：有数据时 nextval 从 MAX+1 开始；空表时第一次 nextval 返回 1
SELECT setval(
  'generation_jobs_queue_seq_seq',
  GREATEST(COALESCE((SELECT MAX(queue_seq) FROM generation_jobs), 0), 1),
  EXISTS (SELECT 1 FROM generation_jobs)
);

ALTER TABLE generation_jobs ALTER COLUMN queue_seq SET DEFAULT nextval('generation_jobs_queue_seq_seq');
ALTER TABLE generation_jobs ALTER COLUMN queue_seq SET NOT NULL;

COMMENT ON COLUMN generation_jobs.queue_seq IS
  '全站排队唯一排序键：序列自增 = 提交顺序；认领 ORDER BY queue_seq ASC；人工调序改写此列；paused/cancelled 任务不参与认领';

-- 认领与队列总览共用：只索引未完成态，避免历史终态任务把索引撑大
CREATE INDEX IF NOT EXISTS idx_generation_jobs_claim_seq
  ON generation_jobs (status, queue_seq)
  WHERE status IN ('pending', 'queued', 'running', 'retrying', 'paused');

CREATE INDEX IF NOT EXISTS idx_generation_jobs_project_queue
  ON generation_jobs (project_id, queue_seq)
  WHERE status IN ('pending', 'queued', 'running', 'retrying', 'paused');
