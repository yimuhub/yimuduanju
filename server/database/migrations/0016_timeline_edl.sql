-- 0016 线性剪辑 Phase 3：EDL 精剪模型（时间线文档 + 片段）
-- 与生产 shots 表解耦：shots 是「生产台账」，timeline_clips 是「剪辑决策表」。
-- timeline_documents 有行 = 项目已保存过 EDL（哪怕 0 条片段）；
-- 无行时 GET /timeline 从 shots 现派生默认 EDL（只读，不落库）。
-- source_shot_id 仅作溯源：镜头被删时置 NULL，片段凭 source_url 仍可导出。

CREATE TABLE IF NOT EXISTS timeline_documents (
  project_id UUID PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  fps INTEGER NOT NULL DEFAULT 24,
  width INTEGER NOT NULL DEFAULT 1080,
  height INTEGER NOT NULL DEFAULT 1920,
  _created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by USER_PROFILE DEFAULT NULL,
  _updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_by USER_PROFILE DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS timeline_clips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  track VARCHAR(20) NOT NULL DEFAULT 'video',          -- video | audio | subtitle | overlay
  source_shot_id UUID REFERENCES shots(id) ON DELETE SET NULL,
  source_url TEXT,
  in_point NUMERIC NOT NULL DEFAULT 0,                 -- 源媒体入点（秒）
  out_point NUMERIC NOT NULL DEFAULT 0,                -- 源媒体出点（秒）
  timeline_start NUMERIC NOT NULL DEFAULT 0,           -- 时间线起始秒（显式）
  speed NUMERIC NOT NULL DEFAULT 1,                    -- 0.25–4；有效时长 = (out-in)/speed
  volume NUMERIC NOT NULL DEFAULT 1,                   -- 0–1
  transition JSONB,                                    -- { type: none|crossfade|fade, duration }
  text TEXT,                                           -- 字幕轨文本
  locked BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  _created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by USER_PROFILE DEFAULT NULL,
  _updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_by USER_PROFILE DEFAULT NULL
);

CREATE INDEX IF NOT EXISTS idx_timeline_clips_project_track
  ON timeline_clips (project_id, track, sort_order);