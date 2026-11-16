-- 0031: 片段启用/停用（剪映 V 键）
-- 停用片段仍保留在时间线上，可随时恢复；预览与导出跳过停用片段。
ALTER TABLE timeline_clips ADD COLUMN IF NOT EXISTS enabled BOOLEAN NOT NULL DEFAULT true;
