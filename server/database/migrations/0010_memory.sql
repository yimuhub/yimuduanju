-- 0010 本地向量记忆：项目记忆分块（系列事实/剧本/资产描述）
-- embedding 为 MiniLM 384 维（与 ToonFlow 同模型），无 Key 可用；
-- 模型加载失败时检索降级为关键词（shorts 式优雅降级），不阻塞。

CREATE TABLE IF NOT EXISTS memory_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind VARCHAR(30) NOT NULL DEFAULT 'fact',
  text TEXT NOT NULL,
  embedding DOUBLE PRECISION[],
  _created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS memory_chunks_project_idx ON memory_chunks(project_id);
