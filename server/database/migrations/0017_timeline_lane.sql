-- 0017 多轨时间线：同类型轨道内的分层下标（0 起）
-- 音频约定 0=对白 / 1=配乐 / 2=音效；不同 lane 可同时重叠，导出时按时间混流。
ALTER TABLE timeline_clips
  ADD COLUMN IF NOT EXISTS lane INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_timeline_clips_project_lane
  ON timeline_clips (project_id, track, lane, sort_order);
