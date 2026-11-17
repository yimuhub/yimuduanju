-- 时间线修订账本（Agent 剪辑 / 冲突检测 / 回滚）
--
-- 背景：
--   timeline_documents 只保留“当前版本”，version 递增后旧内容就消失。
--   Agent 改片时一旦版本过期，只能整批拒绝；用户也没法回到“上一条剪法”。
--
-- 设计：
--   1. revision 与 version 同号，保存成功即写一条快照；唯一约束防止重放写两次。
--   2. snapshot 存整份 EDL（clips + tracks + 画幅参数），体积可控（几十 KB），
--      换取回滚与冲突检测的确定性；只保留最近 50 条，避免无限增长。
--   3. changed_client_keys 记录本次相对上一条修订改动过的片段业务键，
--      Agent 的 baseVersion 过期时，用它判断“改动是否与本次提案相交”，
--      不相交就允许基于最新版本继续应用，不再一刀切 409。
--   4. author：user / agent / restore，summary 为可读改动摘要，供 UI 与审计。

CREATE TABLE IF NOT EXISTS timeline_revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL,
  parent_revision INTEGER,
  author VARCHAR(20) NOT NULL DEFAULT 'user',
  summary TEXT,
  snapshot JSONB NOT NULL,
  changed_client_keys JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by UUID
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_timeline_revisions_project_rev
  ON timeline_revisions (project_id, revision);

CREATE INDEX IF NOT EXISTS idx_timeline_revisions_project_created
  ON timeline_revisions (project_id, created_at DESC);
