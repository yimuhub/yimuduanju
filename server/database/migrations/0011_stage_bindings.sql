-- 0011 分环节模型绑定（移植 ToonFlow agentDeploy 思想）：
-- 每个生产环节独立指定供应商+模型+温度，未绑定的环节回落供应商默认。
-- stages: script（剧本技能）/ image（图片生成）/ video（视频生成）/ tts（配音合成）

CREATE TABLE IF NOT EXISTS stage_model_bindings (
  stage VARCHAR(20) PRIMARY KEY,
  provider_id UUID REFERENCES model_providers(id) ON DELETE SET NULL,
  model VARCHAR(200),
  temperature NUMERIC(3,2),
  max_tokens INTEGER,
  _created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- B2 供应商附加提示词（移植 ToonFlow modelMap 思想）：每次调用自动追加，自愿填写
ALTER TABLE model_providers ADD COLUMN IF NOT EXISTS prompt_prefix TEXT;
