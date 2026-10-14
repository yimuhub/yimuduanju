-- 0001_billing.sql · 计费与官方通道基表（幂等，可重复执行）
CREATE TABLE IF NOT EXISTS schema_migrations (
  name TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 官方直供通道（单例行 id='default'；Key 仅服务端持有，永不返回前端）
CREATE TABLE IF NOT EXISTS official_channel (
  id TEXT PRIMARY KEY DEFAULT 'default',
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  display_name TEXT NOT NULL DEFAULT '官方直供通道',
  base_url TEXT,
  api_key TEXT,
  price_version TEXT NOT NULL DEFAULT 'v1',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO official_channel (id) VALUES ('default') ON CONFLICT (id) DO NOTHING;

-- 模型价格表（unit_price_cny 为官方结算价；market_price_cny 为市场参考价，用于“省了多少”展示）
CREATE TABLE IF NOT EXISTS model_pricing (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_key TEXT NOT NULL UNIQUE,
  job_type TEXT NOT NULL,
  tier TEXT NOT NULL DEFAULT 'balanced',
  display_name TEXT NOT NULL,
  unit TEXT NOT NULL DEFAULT 'call',
  unit_price_cny NUMERIC NOT NULL DEFAULT '0',
  market_price_cny NUMERIC,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 基线价格（估算值，管理后台可调；job_type 对应 generationJobs.jobType）
INSERT INTO model_pricing (model_key, job_type, tier, display_name, unit_price_cny, market_price_cny) VALUES
  ('official:text:flash',    'text',         'budget',   '官方·文本极速',   '0.03', '0.05'),
  ('official:text:pro',      'text',         'flagship', '官方·文本旗舰',   '0.12', '0.20'),
  ('official:image:standard','image',        'balanced', '官方·图片标准',   '0.25', '0.40'),
  ('official:image:pro',     'image',        'flagship', '官方·图片旗舰',   '0.60', '1.00'),
  ('official:video:standard','video',        'balanced', '官方·视频标准',   '1.50', '2.50'),
  ('official:video:pro',     'video',        'flagship', '官方·视频旗舰',   '4.00', '6.00'),
  ('official:tts:standard',  'tts',          'balanced', '官方·配音标准',   '0.08', '0.15'),
  ('official:parse_script',  'parse_script', 'balanced', '官方·剧本解析',   '0.02', '0.05'),
  ('official:storyboard',    'storyboard',   'balanced', '官方·分镜',       '0.02', '0.05'),
  ('official:qc',            'qc',           'balanced', '官方·质检',       '0.02', '0.05'),
  ('official:edit',          'edit',         'balanced', '官方·剪辑',       '0.05', '0.10')
ON CONFLICT (model_key) DO NOTHING;
