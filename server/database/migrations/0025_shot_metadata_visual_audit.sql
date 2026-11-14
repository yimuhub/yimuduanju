-- 0025 分镜时间分段 + 看图一致性审计（docs/精修与长篇升级调研.md 方案一/三）
-- 目标：
--   1) shots.metadata JSONB：分镜级可扩展元数据。首用键 timeSegments =
--      [{ id, shotType, duration, description, characters[], movement?, sceneRef? }]，
--      生成时按分段拼接 visualPrompt / 视频节拍。旧数据无该列 → 归一化后为空数组，
--      全部消费方走「单段兼容模式」，行为与 3.9.x 完全一致（硬向后兼容）。
--   2) qc_reports.audit_type：区分标准规则质检（standard）与角色一致性看图审计
--      （visual）。旧报告行默认 standard，读取路径按类型过滤，互不干扰。
-- 全部语句幂等。

ALTER TABLE shots ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;
COMMENT ON COLUMN shots.metadata IS '镜头扩展元数据；timeSegments=时间段落 [{shotType,duration,description,characters,sceneRef}]，生成时按分段拼接提示词（无分段=单段兼容模式）';

ALTER TABLE qc_reports ADD COLUMN IF NOT EXISTS audit_type VARCHAR(30) NOT NULL DEFAULT 'standard';
COMMENT ON COLUMN qc_reports.audit_type IS '报告类型：standard=规则质检；visual=角色一致性看图审计（ArcReel inspect_images 思路）';
CREATE INDEX IF NOT EXISTS idx_qc_reports_project_audit
  ON qc_reports (project_id, audit_type, _created_at DESC);
