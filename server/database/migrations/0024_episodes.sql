-- 0024 长篇多集架构 + 一致性工程基础设施（docs/精修与长篇升级调研.md 方案②③）
-- 目标：
--   1) episodes 表：集是导航与确认的原子单位（季/集号/标题/状态/跨集交接账本/锁定）。
--   2) projects.has_episodes：开集模式开关。旧项目一律 false，行为完全不变（硬向后兼容）。
--   3) shots/scenes/characters.episode_id：NULL = 不属于任何集的公共资产（向后兼容）；
--      属于某集的行随集删除置 NULL（资产降级为公共资产，不做物理级联删除——
--      「删除集连带删该集 shots/scenes」由 episodes.service 在应用层显式完成并先行确认）。
--   4) characters.lock_anchors / anchor_updated_at：身份锁短语数组（一致性工程 B1）。
-- 全部语句幂等。

-- ============ 1) episodes 表 ============
CREATE TABLE IF NOT EXISTS episodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL,
  season INTEGER NOT NULL DEFAULT 1,
  number INTEGER NOT NULL,
  title TEXT,
  -- 集内产线状态：draft → script_ready → shots_ready → video_generating → completed
  status TEXT NOT NULL DEFAULT 'draft',
  -- 跨集交接账本（方案③）：规范化 { facts: [{text, createdAt}], props: [{name, holder}], relations: [{a,b,status}] }
  handoff_state JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- 按集流水线（A4 最小实现）：复用 project 级门语义的按集版本，存门通过时间与进度聚合
  pipeline JSONB NOT NULL DEFAULT '{}'::jsonb,
  locked BOOLEAN NOT NULL DEFAULT false,
  _created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE episodes IS '长篇多集：集是导航与确认的原子单位；旧项目（has_episodes=false）完全不使用本表';
COMMENT ON COLUMN episodes.handoff_state IS '跨集交接账本：不可逆事实/道具归属/关系变化（规范化结构见 0024 迁移注释）';
COMMENT ON COLUMN episodes.pipeline IS '按集门通过时间（script/storyboard/preview/final）与进度聚合，语义同 projects.metadata.pipeline';

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'episodes_project_id_fkey'
  ) THEN
    ALTER TABLE episodes ADD CONSTRAINT episodes_project_id_fkey
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
  END IF;
END $$;

-- 同一季内集号唯一：number 自动递增依赖此约束兜底并发
CREATE UNIQUE INDEX IF NOT EXISTS episodes_project_season_number_uq
  ON episodes (project_id, season, number);
CREATE INDEX IF NOT EXISTS idx_episodes_project ON episodes (project_id, season, number);

-- ============ 2) projects.has_episodes 开集模式开关 ============
ALTER TABLE projects ADD COLUMN IF NOT EXISTS has_episodes BOOLEAN NOT NULL DEFAULT false;
COMMENT ON COLUMN projects.has_episodes IS '开集模式：true=长篇多集（集由 episodes 表管理）；false=单集形态（行为与 3.8.x 完全一致）';

-- ============ 3) shots / scenes / characters 挂集（NULL=公共资产） ============
ALTER TABLE shots ADD COLUMN IF NOT EXISTS episode_id UUID;
ALTER TABLE scenes ADD COLUMN IF NOT EXISTS episode_id UUID;
ALTER TABLE characters ADD COLUMN IF NOT EXISTS episode_id UUID;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'shots_episode_id_fkey'
  ) THEN
    ALTER TABLE shots ADD CONSTRAINT shots_episode_id_fkey
      FOREIGN KEY (episode_id) REFERENCES episodes(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'scenes_episode_id_fkey'
  ) THEN
    ALTER TABLE scenes ADD CONSTRAINT scenes_episode_id_fkey
      FOREIGN KEY (episode_id) REFERENCES episodes(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'characters_episode_id_fkey'
  ) THEN
    ALTER TABLE characters ADD CONSTRAINT characters_episode_id_fkey
      FOREIGN KEY (episode_id) REFERENCES episodes(id) ON DELETE SET NULL;
  END IF;
END $$;

-- 按集查询是分镜页的高频路径：部分索引只覆盖真正挂了集的行（旧项目零开销）
CREATE INDEX IF NOT EXISTS idx_shots_episode ON shots (episode_id) WHERE episode_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_scenes_episode ON scenes (episode_id) WHERE episode_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_characters_episode ON characters (episode_id) WHERE episode_id IS NOT NULL;

-- ============ 4) 人物身份锁锚点（一致性工程 B1） ============
ALTER TABLE characters ADD COLUMN IF NOT EXISTS lock_anchors JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE characters ADD COLUMN IF NOT EXISTS anchor_updated_at TIMESTAMPTZ(3);
COMMENT ON COLUMN characters.lock_anchors IS '身份锁短语数组（逐字复用的静态锚点）；为空数组时消费方回落 identityKit 文本锁（现状不变）';
COMMENT ON COLUMN characters.anchor_updated_at IS '锚点最近一次重出时间；下游据此把引用镜头标记「过期需重生成」';
