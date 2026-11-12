-- ============================================================
-- 一木·YIMU AI 视频创作平台本地数据库初始化脚本
-- 依据云端 server/database/schema.ts 原样翻译生成（未改代码）
-- 用法: psql -U postgres -d yimu -f scripts/db-init.sql
-- ============================================================

-- 1. 扩展
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. 平台自定义复合类型
DO $$ BEGIN
  CREATE TYPE user_profile AS (user_id text);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE file_attachment AS (bucket_id text, file_path text);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- projects
-- ============================================================
CREATE TABLE IF NOT EXISTS projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title varchar(255) NOT NULL,
  description text,
  status varchar(50) NOT NULL DEFAULT 'draft',
  mode varchar(30) NOT NULL DEFAULT 'quick',
  duration_seconds integer DEFAULT 90,
  aspect_ratio varchar(20) DEFAULT '9:16',
  art_style varchar(50) DEFAULT 'realistic',
  genre varchar(50),
  budget_mode varchar(30) DEFAULT 'balanced',
  total_cost numeric DEFAULT '0',
  thumbnail_url text,
  script_text text,
  world_view jsonb,
  style_bible jsonb,
  metadata jsonb,
  _created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by user_profile DEFAULT NULL,
  _updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_by user_profile DEFAULT NULL
);

-- ============================================================
-- characters
-- ============================================================
CREATE TABLE IF NOT EXISTS characters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name varchar(100) NOT NULL,
  role_type varchar(30) DEFAULT 'supporting',
  age integer,
  gender varchar(20),
  height varchar(20),
  body_type varchar(50),
  face_features text,
  hairstyle text,
  costume text,
  accessories text,
  personality text,
  voice_type varchar(50),
  voice_id varchar(100),
  canonical_description text,
  forbidden_changes text,
  reference_image_urls text[] DEFAULT '{}',
  locked boolean DEFAULT false,
  sort_order integer DEFAULT 0,
  _created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by user_profile DEFAULT NULL,
  _updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_by user_profile DEFAULT NULL
);

-- ============================================================
-- locations
-- ============================================================
CREATE TABLE IF NOT EXISTS locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name varchar(100) NOT NULL,
  location_type varchar(30) DEFAULT 'interior',
  time_of_day varchar(20) DEFAULT 'day',
  weather varchar(30),
  architecture text,
  furniture text,
  lighting text,
  color_palette text,
  description text,
  reference_image_urls text[] DEFAULT '{}',
  locked boolean DEFAULT false,
  sort_order integer DEFAULT 0,
  _created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by user_profile DEFAULT NULL,
  _updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_by user_profile DEFAULT NULL
);

-- ============================================================
-- scenes
-- ============================================================
CREATE TABLE IF NOT EXISTS scenes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  scene_number integer NOT NULL DEFAULT 1,
  title varchar(255),
  location_id uuid REFERENCES locations(id) ON DELETE SET NULL,
  time_of_day varchar(20),
  summary text,
  emotion varchar(50),
  character_ids uuid[] DEFAULT '{}',
  dialogues jsonb,
  actions jsonb,
  props text[] DEFAULT '{}',
  sort_order integer DEFAULT 0,
  _created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by user_profile DEFAULT NULL,
  _updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_by user_profile DEFAULT NULL
);

-- ============================================================
-- shots
-- ============================================================
CREATE TABLE IF NOT EXISTS shots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  scene_id uuid NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
  shot_number integer NOT NULL DEFAULT 1,
  duration numeric DEFAULT '4.0',
  shot_size varchar(30) DEFAULT 'medium',
  camera_angle varchar(30) DEFAULT 'eye_level',
  lens varchar(20) DEFAULT '50mm',
  movement varchar(50) DEFAULT 'static',
  subject text,
  action text,
  emotion varchar(50),
  dialogue text,
  visual_prompt text,
  negative_prompt text,
  scene_env jsonb,
  start_frame_url text,
  end_frame_url text,
  reference_image_urls text[] DEFAULT '{}',
  video_url text,
  voice_url text,
  sfx_urls text[] DEFAULT '{}',
  subtitle_text text,
  character_ids uuid[] DEFAULT '{}',
  locked boolean DEFAULT false,
  status varchar(30) DEFAULT 'draft',
  sort_order integer DEFAULT 0,
  _created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by user_profile DEFAULT NULL,
  _updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_by user_profile DEFAULT NULL
);

-- ============================================================
-- assets
-- ============================================================
CREATE TABLE IF NOT EXISTS assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid REFERENCES projects(id) ON DELETE CASCADE,
  asset_type varchar(30) NOT NULL,
  name varchar(255) NOT NULL,
  file_url text,
  file_path text,
  thumbnail_url text,
  mime_type varchar(100),
  file_size bigint,
  duration_seconds numeric,
  width integer,
  height integer,
  source_type varchar(30) DEFAULT 'generated',
  source_id varchar(255),
  generation_prompt text,
  generation_model varchar(255),
  generation_seed varchar(50),
  generation_params jsonb,
  version integer DEFAULT 1,
  parent_asset_id uuid REFERENCES assets(id) ON DELETE SET NULL,
  status varchar(30) DEFAULT 'ready',
  locked boolean DEFAULT false,
  metadata jsonb,
  _created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by user_profile DEFAULT NULL,
  _updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_by user_profile DEFAULT NULL
);

-- ============================================================
-- generation_jobs
-- ============================================================
CREATE TABLE IF NOT EXISTS generation_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid REFERENCES projects(id) ON DELETE CASCADE,
  job_type varchar(50) NOT NULL,
  target_type varchar(30),
  target_id uuid,
  status varchar(30) NOT NULL DEFAULT 'pending',
  progress integer DEFAULT 0,
  priority integer DEFAULT 50,
  provider_name varchar(100),
  model_name varchar(255),
  input_data jsonb,
  output_data jsonb,
  error_message text,
  retry_count integer DEFAULT 0,
  max_retries integer DEFAULT 3,
  cost numeric DEFAULT '0',
  started_at timestamptz(3),
  completed_at timestamptz(3),
  external_task_id varchar(255),
  _created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by user_profile DEFAULT NULL,
  _updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_by user_profile DEFAULT NULL
);

-- ============================================================
-- qc_reports
-- ============================================================
CREATE TABLE IF NOT EXISTS qc_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  overall_score integer DEFAULT 0,
  character_consistency integer DEFAULT 0,
  scene_consistency integer DEFAULT 0,
  motion_quality integer DEFAULT 0,
  audio_sync integer DEFAULT 0,
  subtitle_accuracy integer DEFAULT 0,
  story_coherence integer DEFAULT 0,
  technical_quality integer DEFAULT 0,
  issues jsonb,
  recommendations jsonb,
  pass boolean DEFAULT false,
  threshold_pass integer DEFAULT 90,
  threshold_review integer DEFAULT 80,
  _created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by user_profile DEFAULT NULL,
  _updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_by user_profile DEFAULT NULL
);

-- ============================================================
-- agent_messages
-- ============================================================
CREATE TABLE IF NOT EXISTS agent_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid REFERENCES projects(id) ON DELETE CASCADE,
  role varchar(20) NOT NULL,
  content text NOT NULL,
  agent_name varchar(50),
  related_objects jsonb,
  _created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by user_profile DEFAULT NULL
);

-- ============================================================
-- templates
-- ============================================================
CREATE TABLE IF NOT EXISTS templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(100) NOT NULL,
  template_type varchar(30) NOT NULL,
  category varchar(50),
  description text,
  thumbnail_url text,
  duration_seconds integer DEFAULT 60,
  aspect_ratio varchar(20) DEFAULT '9:16',
  art_style varchar(50),
  genre varchar(50),
  config jsonb,
  is_builtin boolean DEFAULT true,
  sort_order integer DEFAULT 0,
  _created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- model_providers
-- ============================================================
CREATE TABLE IF NOT EXISTS model_providers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(100) NOT NULL,
  provider_type varchar(30) NOT NULL,
  is_default boolean DEFAULT false,
  base_url text,
  api_key text,
  text_model varchar(255),
  image_model varchar(255),
  video_model varchar(255),
  tts_model varchar(255),
  tts_voice varchar(100),
  format_type varchar(30) DEFAULT 'openai',
  capabilities jsonb,
  routing_priority integer DEFAULT 10,
  enabled boolean DEFAULT true,
  _created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by user_profile DEFAULT NULL,
  _updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_by user_profile DEFAULT NULL
);

-- ============================================================
-- 内置模板种子数据（与云端一致的初始模板）
-- ============================================================
INSERT INTO templates (name, template_type, category, description, duration_seconds, aspect_ratio, art_style, genre, config, is_builtin, sort_order)
SELECT * FROM (VALUES
  ('都市情感', 'full', '言情', '都市男女的宿命相遇', 90, '9:16', 'realistic', '都市', '{"shotCount":10,"shotDuration":9,"shotSizes":["close_up","medium","wide"],"cameraMovements":["static","push_in","tilt"],"voicePreset":"zh_female_gentle","subtitleEnabled":true}'::jsonb, true, 1),
  ('古风仙侠', 'full', '古风', '仙侠世界的恩怨情仇', 120, '9:16', 'guofeng_3d', '仙侠', '{"shotCount":12,"shotDuration":10,"shotSizes":["wide","medium","close_up"],"cameraMovements":["crane","dolly","static"],"voicePreset":"zh_male_deep","subtitleEnabled":true}'::jsonb, true, 2),
  ('悬疑推理', 'style', '悬疑', '高能反转悬疑短剧', 90, '9:16', 'realistic', '悬疑', '{"shotCount":10,"shotDuration":9,"shotSizes":["close_up","extreme_close_up"],"cameraMovements":["static","zoom_in","handheld"],"voicePreset":"zh_male_steady","subtitleEnabled":true}'::jsonb, true, 3),
  ('热血动漫', 'style', '动漫', '二次元热血少年漫', 120, '9:16', 'anime_2d', '动漫', '{"shotCount":15,"shotDuration":8,"shotSizes":["action","medium","wide"],"cameraMovements":["dynamic","pan","tracking"],"voicePreset":"zh_male_youth","subtitleEnabled":true}'::jsonb, true, 4),
  ('三分钟成片', 'duration', '通用', '三分钟完整短剧', 180, '9:16', 'realistic', '通用', '{"shotCount":20,"shotDuration":9,"shotSizes":["wide","medium","close_up"],"cameraMovements":["static","dolly","tilt"],"voicePreset":"zh_female_warm","subtitleEnabled":true}'::jsonb, true, 5),
  ('九宫格漫剧', 'full', '漫剧', 'AI漫剧九宫格分镜', 60, '1:1', 'manhwa', '漫剧', '{"shotCount":9,"shotDuration":7,"shotSizes":["panel","medium"],"cameraMovements":["static"],"voicePreset":"zh_female_clear","subtitleEnabled":true}'::jsonb, true, 6)
) AS v(name, template_type, category, description, duration_seconds, aspect_ratio, art_style, genre, config, is_builtin, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM templates LIMIT 1);

-- ============================================================
-- 内置默认 Provider 种子（演示用，无真实密钥，可在设置中修改）
-- ============================================================
INSERT INTO model_providers (name, provider_type, is_default, text_model, image_model, video_model, tts_model, tts_voice, format_type, capabilities, routing_priority, enabled)
SELECT * FROM (VALUES
  ('火山方舟', 'volcano', true, 'doubao-seed-1-6', 'doubao-seedream-4-5', 'doubao-seedance-2-0-260128', 'doubao-tts', 'zh_female_wanwanxiaohe_oral_fast', 'volcano', '{"text":true,"image":true,"video":true,"tts":true}'::jsonb, 10, true),
  ('一木·YIMU 官方API 聚合平台', 'openai', false, 'gpt-4o-mini', 'gpt-image-1', '', 'tts-1', 'alloy', 'openai', '{"text":true,"image":true,"video":false,"tts":true}'::jsonb, 20, true)
) AS v(name, provider_type, is_default, text_model, image_model, video_model, tts_model, tts_voice, format_type, capabilities, routing_priority, enabled)
WHERE NOT EXISTS (SELECT 1 FROM model_providers LIMIT 1);

-- ============================================================
-- 0019 道具资产 + 人物视觉资产包（与 server/database/migrations/0019 一致）
-- ============================================================
ALTER TABLE characters ADD COLUMN IF NOT EXISTS identity_kit JSONB;

CREATE TABLE IF NOT EXISTS props (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  code VARCHAR(20) NOT NULL DEFAULT '',
  name VARCHAR(100) NOT NULL,
  category VARCHAR(30) NOT NULL DEFAULT 'recurring',
  identity_anchors TEXT,
  appearance TEXT,
  scale_reference TEXT,
  function_desc TEXT,
  story_role TEXT,
  owner_character_id UUID,
  continuity_lock TEXT,
  forbidden_changes TEXT,
  text_policy VARCHAR(30) NOT NULL DEFAULT 'no_readable_text',
  readable_text TEXT,
  state_variants JSONB NOT NULL DEFAULT '[]'::jsonb,
  reference_image_urls TEXT[] NOT NULL DEFAULT '{}',
  locked BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  _created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by USER_PROFILE DEFAULT NULL,
  _updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_by USER_PROFILE DEFAULT NULL
);
CREATE INDEX IF NOT EXISTS props_project_idx ON props(project_id, sort_order);
CREATE UNIQUE INDEX IF NOT EXISTS props_project_code_uq ON props(project_id, code) WHERE code <> '';
