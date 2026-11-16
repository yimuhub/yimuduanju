-- Agent 剪辑审计（可追溯 / 可回放 / 幂等）
--
-- 设计取舍：
--   1. 只存「动作 + diff + 版本区间」，不存整份 before/after 快照，
--      避免 EDL 大项目把审计表撑爆；撤销走客户端快照栈（同一次应用入一条）。
--   2. idempotency_key 唯一：模型重试 / 网络重发同一批动作时，服务端返回
--      已应用结果，不会把同一刀剪两遍。
--   3. session_id / message_id 只做弱关联（消息可能被删），保留可读性。

CREATE TABLE IF NOT EXISTS agent_edit_ops (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  session_id UUID,
  message_id UUID,
  base_version INTEGER NOT NULL,
  result_version INTEGER NOT NULL,
  summary TEXT,
  ops JSONB NOT NULL DEFAULT '[]'::jsonb,
  diffs JSONB NOT NULL DEFAULT '[]'::jsonb,
  status VARCHAR(20) NOT NULL DEFAULT 'applied',
  idempotency_key TEXT,
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by UUID
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_edit_ops_idem
  ON agent_edit_ops (project_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_agent_edit_ops_project_created
  ON agent_edit_ops (project_id, created_at DESC);
