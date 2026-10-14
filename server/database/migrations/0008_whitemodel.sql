-- 0008 白模产线：镜头绑定白模参考视频
-- 白模只提供三件事：空间关系、运镜路径、时间节奏（材质/光影以首帧图为准）。
-- whitemodel_meta 结构：{ durationSeconds, rigId, movement, source, assetId, createdAt }

ALTER TABLE shots ADD COLUMN IF NOT EXISTS whitemodel_url TEXT;
ALTER TABLE shots ADD COLUMN IF NOT EXISTS whitemodel_meta JSONB;
