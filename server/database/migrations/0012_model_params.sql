-- 0012 供应商能力自描述（移植 ToonFlow durationResolutionMap + UGC 参数表思想）：
-- 每个供应商声明模型支持的时长/尺寸/画幅，生成表单按能力动态渲染，不再写死。

ALTER TABLE model_providers ADD COLUMN IF NOT EXISTS model_params JSONB;
