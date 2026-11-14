-- 0023 密钥池（多 Key 并行 + 车道 + 按 Key 冷却 + 任务绑定 Key + 项目钉 Key）
-- 背景：旧实现 provider_api_keys 只能「同时一把生效」
--       （addKey 仅第一把 isActive，activateKey 会把其它全部置 false；
--        getProvider 只取最新一把 active）。用户给同一供应商加 N 把 Key，
--       实际仍只有 1 把在工作 → 供应商侧永远单账号排队，视频 503 池饱和后
--       整条通道冷却 300s，永远排不完。
-- 方案：把每把 Key 当成一条独立「车道」（lane）：
--       - enabled 控制启用；concurrency 为该 Key 的并发额度（视频默认 1）；
--       - in_flight 在途计数 + key_leases 租约（带 TTL，进程崩溃可回收）；
--       - status(active|cooldown|invalid) + cooldown_until 做「按 Key 冷却」，
--         限流只冻这一把，其它车道继续跑；
--       - generation_jobs.bound_key_id 把任务钉在创建它的那把 Key 上
--         （视频是异步建单 + 轮询，轮询必须用同一把 Key，否则必挂）；
--       - projects.pinned_key_id 让项目独占某把 Key，多项目互不打扰。
-- 全部语句幂等。

ALTER TABLE provider_api_keys ADD COLUMN IF NOT EXISTS enabled BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE provider_api_keys ADD COLUMN IF NOT EXISTS concurrency INTEGER NOT NULL DEFAULT 1;
ALTER TABLE provider_api_keys ADD COLUMN IF NOT EXISTS in_flight INTEGER NOT NULL DEFAULT 0;
ALTER TABLE provider_api_keys ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE provider_api_keys ADD COLUMN IF NOT EXISTS cooldown_until TIMESTAMPTZ;
ALTER TABLE provider_api_keys ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ;
ALTER TABLE provider_api_keys ADD COLUMN IF NOT EXISTS last_error TEXT;
ALTER TABLE provider_api_keys ADD COLUMN IF NOT EXISTS priority INTEGER NOT NULL DEFAULT 0;

-- 存量兼容：旧库里 is_active 只标了一把，其余人为「未激活」。
-- 引入 enabled 后，全部存量 Key 一律启用（用户加多把 Key 的诉求就是都用上），
-- 由 in_flight/concurrency 控制实际并发，而不是靠 is_active 二选一。
UPDATE provider_api_keys SET enabled = true WHERE enabled = false;
UPDATE provider_api_keys SET status = 'active' WHERE status IS NULL OR status = '';

COMMENT ON COLUMN provider_api_keys.enabled IS '是否参与调度（false=停用，不参与领 Key）';
COMMENT ON COLUMN provider_api_keys.concurrency IS '该 Key 的并发额度：视频默认 1；自动探测会在此值上下浮动';
COMMENT ON COLUMN provider_api_keys.in_flight IS '当前在途任务数；领 Key 时原子 +1，结束/冷却时 -1';
COMMENT ON COLUMN provider_api_keys.status IS 'active=可用；cooldown=限流冷却中；invalid=鉴权失效';
COMMENT ON COLUMN provider_api_keys.cooldown_until IS '按 Key 冷却截止时间；到期自动回到可领状态';

-- 领 Key 的主查询索引：只覆盖可用车道，避免被历史失效 Key 撑大
CREATE INDEX IF NOT EXISTS idx_provider_api_keys_lease
  ON provider_api_keys (provider_id, status, cooldown_until, in_flight)
  WHERE enabled = true;

-- 任务绑定 Key：视频异步轮询/重试必须复用同一把 Key
ALTER TABLE generation_jobs ADD COLUMN IF NOT EXISTS bound_key_id UUID;
CREATE INDEX IF NOT EXISTS idx_generation_jobs_bound_key
  ON generation_jobs (bound_key_id)
  WHERE bound_key_id IS NOT NULL;

COMMENT ON COLUMN generation_jobs.bound_key_id IS
  '任务实际使用的 Key；视频建单后轮询、失败重试都必须复用它（换 Key 会导致上游任务查不到）';

-- 项目钉 Key：项目内任务只从该 Key 领取，多项目互不抢额度
ALTER TABLE projects ADD COLUMN IF NOT EXISTS pinned_key_id UUID;
COMMENT ON COLUMN projects.pinned_key_id IS
  '项目独占的 Key；非空时该项目任务只从该 Key 领，为空则从共享密钥池领';

-- Key 租约：带 TTL 的在途占位，进程崩溃/重启后可回收，避免 in_flight 永久泄漏
CREATE TABLE IF NOT EXISTS key_leases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key_id UUID NOT NULL,
  job_id UUID,
  provider_id UUID,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_key_leases_key ON key_leases (key_id);
CREATE INDEX IF NOT EXISTS idx_key_leases_expires ON key_leases (expires_at);
