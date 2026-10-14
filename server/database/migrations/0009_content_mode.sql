-- 0009 双模式产线：项目内容模式（通用/短剧/广告）
-- 与创建模式（quick/script/professional）正交，只做创作引导与质检口径，不锁死流程。

ALTER TABLE projects ADD COLUMN IF NOT EXISTS content_mode VARCHAR(20) NOT NULL DEFAULT 'general';
