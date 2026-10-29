-- 0013 产品 3.0 harness 化：skill 注册表 + Agent 注册表
-- 平台 = skill 的执行框架：流水线各环节按产品线取启用的 skill 注入；
-- Agent 不再前端写死，注册表化（人设/技能绑定/工具），用户可增改。

CREATE TABLE IF NOT EXISTS skills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  line TEXT NOT NULL DEFAULT 'common',            -- shortdrama | comic | ads | common
  slot TEXT NOT NULL DEFAULT 'common',            -- 流水线槽位：topic|outline|script|character|scene|storyboard|video_prompt|voice|bgm|edit|qc|style|common
  description TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',                  -- SKILL.md 正文（注入对应环节系统提示词）
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  version INTEGER NOT NULL DEFAULT 1,
  source TEXT NOT NULL DEFAULT 'builtin',         -- builtin | user | imported
  _created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  avatar TEXT NOT NULL DEFAULT '🤖',
  persona TEXT NOT NULL DEFAULT '',               -- 系统提示词（人设 + 职责边界）
  skill_slugs JSONB NOT NULL DEFAULT '[]',        -- 绑定的 skill slug 列表
  tools JSONB NOT NULL DEFAULT '[]',              -- 可用工具声明（供前端展示与后续 harness 执行）
  sort INTEGER NOT NULL DEFAULT 100,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  source TEXT NOT NULL DEFAULT 'builtin',         -- builtin | user
  _created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_skills_line_slot ON skills(line, slot);
