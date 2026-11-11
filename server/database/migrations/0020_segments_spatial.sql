-- 0020 片段（segment）三级结构 + 空间基准/轴线 + 3 秒节拍
-- 依据：Toonflow「场 → 片段（≤15s，2-4 镜）→ 镜」与「空间基准九宫格 / 反打规则」；
--       ArcReel「同段镜像链」（上一分镜图只参考构图与色调）。
-- 目的：把「同一空间内连续动作」变成一个可寻址的单元，镜与镜之间的
--       轴线、景别节奏、参考图链才有落点；全部语句幂等。

-- 1) 片段表：一场戏按空间/时间/叙事功能切段，资产引用挂在片段上
CREATE TABLE IF NOT EXISTS segments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  scene_id UUID NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
  segment_number INTEGER NOT NULL DEFAULT 1,
  title VARCHAR(200),
  summary TEXT,
  -- 叙事功能：establish / develop / turn / payoff / transition
  intent VARCHAR(30),
  -- 空间基准（九宫格）：left|mid|right × front|mid|back，如 mid_mid
  space_anchor VARCHAR(30),
  -- 本段轴线方向：left_to_right / right_to_left / frontal / depth
  axis_direction VARCHAR(30),
  character_ids UUID[] NOT NULL DEFAULT '{}',
  location_id UUID REFERENCES locations(id) ON DELETE SET NULL,
  props TEXT[] NOT NULL DEFAULT '{}',
  duration_seconds NUMERIC(5, 1) NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  _created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by USER_PROFILE DEFAULT NULL,
  _updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_by USER_PROFILE DEFAULT NULL
);

CREATE INDEX IF NOT EXISTS segments_project_idx ON segments(project_id, sort_order);
CREATE UNIQUE INDEX IF NOT EXISTS segments_scene_number_uq ON segments(scene_id, segment_number);

-- 2) 镜头挂片段 + 轴线方向 + 3 秒节拍
--    segment_id 允许为空：历史数据与确定性拆分不建片段时仍然可用
ALTER TABLE shots ADD COLUMN IF NOT EXISTS segment_id UUID
  REFERENCES segments(id) ON DELETE SET NULL;
ALTER TABLE shots ADD COLUMN IF NOT EXISTS screen_direction VARCHAR(30);
-- beats: [{ "from": 0, "to": 3, "description": "…", "dialogue": "…" }]
ALTER TABLE shots ADD COLUMN IF NOT EXISTS beats JSONB;

CREATE INDEX IF NOT EXISTS shots_segment_idx ON shots(segment_id, shot_number);
