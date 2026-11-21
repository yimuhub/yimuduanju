-- G11：时间线片段新增「淡入/淡出」（秒，可空）。
-- 客户端在片段上写 fade_in / fade_out（0 或 NULL = 无淡变），
-- 预览音频 GainNode 与导出 afade 用同一份数据；画面轨同时驱动画面透明度
-- 与导出 fade 滤镜。旧数据 NULL 即无淡变，向后兼容。
ALTER TABLE timeline_clips ADD COLUMN IF NOT EXISTS fade_in NUMERIC;
ALTER TABLE timeline_clips ADD COLUMN IF NOT EXISTS fade_out NUMERIC;
