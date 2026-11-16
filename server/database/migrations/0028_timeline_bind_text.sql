-- 时间线剪辑升级：绑定关系 + 字幕样式
--
-- 为什么放在 timeline_clips 上而不是单独建关联表：
--   绑定是「这些片段同生共死」的一对多归属关系（一个片段只能在一个组里），
--   用组 id 挂在本行上，拖动时按 bind_group 一次捞全组，查询最简单。
--   单独建 join 表反而要多一次往返，而且很难保证「一个片段只属于一组」。
--
-- 为什么 bind_group 用 TEXT 而不是 UUID：
--   前端生成的组 id 只要在本项目内唯一即可，不强求 RFC 4122；用 TEXT 避免
--   「前端造了个非标准 id → 落库报 22P02」这类无谓的兼容问题。

ALTER TABLE timeline_clips ADD COLUMN IF NOT EXISTS bind_group TEXT;

-- 字幕样式：{ fontFamily, fontSize, color, bold, italic, strokeColor,
--            strokeWidth, bgColor, bgOpacity, align, x, y, maxWidth }
-- 只存用户改过的键，读取时用 DEFAULT_TEXT_STYLE 补齐（见 shared/api.interface.ts）。
ALTER TABLE timeline_clips ADD COLUMN IF NOT EXISTS text_style JSONB;

-- 拖动联动要按 (project_id, bind_group) 一次性取全组
CREATE INDEX IF NOT EXISTS idx_timeline_clips_bind_group
  ON timeline_clips (project_id, bind_group)
  WHERE bind_group IS NOT NULL;
