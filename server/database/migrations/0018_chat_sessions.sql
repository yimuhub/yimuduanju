-- 0018 对话持久化：新建作品的草稿对话 + 项目内创作对话
-- 目标：所有对话全程可追溯（刷新/切页不丢），草稿会话在项目创建后关联 project_id。

CREATE TABLE IF NOT EXISTS chat_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 未建项目前为空；创建成功后回填，项目删除时级联清理
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  -- 会话标题：项目名 / 草稿名，用于列表展示
  title VARCHAR(255),
  kind VARCHAR(20) NOT NULL DEFAULT 'draft',
  _created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS chat_sessions_project_idx ON chat_sessions(project_id);
CREATE INDEX IF NOT EXISTS chat_sessions_created_idx ON chat_sessions(_created_at DESC);

CREATE TABLE IF NOT EXISTS chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  role VARCHAR(20) NOT NULL,
  content TEXT NOT NULL,
  -- 附件元数据：[{ name, size, chars }]；正文已并入 content 供模型消费
  attachments JSONB DEFAULT '[]'::jsonb,
  -- 扩展：是否流式中断 / 模型名 / 用量等
  metadata JSONB,
  _created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS chat_messages_session_idx ON chat_messages(session_id, _created_at);