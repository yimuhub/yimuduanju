-- 0007_provider_keys.sql · 多 Key 管理 + 项目级供应商覆盖（幂等，可重复执行）
CREATE TABLE IF NOT EXISTS provider_api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id UUID NOT NULL REFERENCES model_providers(id) ON DELETE CASCADE,
  label TEXT NOT NULL DEFAULT 'Key',
  api_key TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_provider_api_keys_provider ON provider_api_keys (provider_id);

ALTER TABLE projects ADD COLUMN IF NOT EXISTS provider_override JSONB;
