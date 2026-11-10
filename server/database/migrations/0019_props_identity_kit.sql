-- 0019 道具资产 + 人物视觉资产包
-- 目标：把「道具」升级为与人物/场景同级的可寻址一致性实体；
--       人物从「一张拼图四视图」升级为「1 张主图 + 4 个独立视角 + 文本锁」。
-- 依据 shared/api.interface.ts 的 Prop / CharacterIdentityKit，全部幂等。

-- 1) 人物视觉资产包（jsonb，免破坏既有 reference_image_urls）
ALTER TABLE characters ADD COLUMN IF NOT EXISTS identity_kit JSONB;

-- 2) 道具资产表：身份与状态分离，状态变体不拆成假道具
CREATE TABLE IF NOT EXISTS props (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  code VARCHAR(20) NOT NULL DEFAULT '',
  name VARCHAR(100) NOT NULL,
  category VARCHAR(30) NOT NULL DEFAULT 'recurring',
  identity_anchors TEXT,
  appearance TEXT,
  scale_reference TEXT,
  function_desc TEXT,
  story_role TEXT,
  owner_character_id UUID,
  continuity_lock TEXT,
  forbidden_changes TEXT,
  text_policy VARCHAR(30) NOT NULL DEFAULT 'no_readable_text',
  readable_text TEXT,
  state_variants JSONB NOT NULL DEFAULT '[]'::jsonb,
  reference_image_urls TEXT[] NOT NULL DEFAULT '{}',
  locked BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  _created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by USER_PROFILE DEFAULT NULL,
  _updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_by USER_PROFILE DEFAULT NULL
);
CREATE INDEX IF NOT EXISTS props_project_idx ON props(project_id, sort_order);
CREATE UNIQUE INDEX IF NOT EXISTS props_project_code_uq ON props(project_id, code) WHERE code <> '';

-- 3) 场景的 props 由裸字符串升级为可关联道具编号（保留旧字符串兼容）
--    这里只加索引，不改动 scenes.props 的语义：字符串可以是道具名称或 @PROP001。
CREATE INDEX IF NOT EXISTS scenes_project_idx ON scenes(project_id, sort_order);
