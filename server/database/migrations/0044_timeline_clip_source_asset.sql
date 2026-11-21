-- 节拍吸附 / 素材级联动（G14/G18）：时间线片段补记来源素材 id。
-- 客户端从素材库创建片段时写 source_asset_id，节拍检测结果按素材 id 映射到片段；
-- 旧数据 NULL 不参与素材级吸附，按 sourceUrl 关联的旧逻辑不受影响。
ALTER TABLE timeline_clips ADD COLUMN IF NOT EXISTS source_asset_id UUID;
