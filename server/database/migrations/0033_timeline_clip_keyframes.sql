-- 运镜关键帧：缩放 / 平移 / 旋转
--
-- 只存一段画面片段的关键帧数组（时间相对片段起点），
-- 预览与导出读同一份数据；没有关键帧时为 NULL，行为与旧工程一致。

ALTER TABLE timeline_clips
  ADD COLUMN IF NOT EXISTS keyframes JSONB;

COMMENT ON COLUMN timeline_clips.keyframes IS
  '运镜关键帧：[{time, scale?, x?, y?, rotate?, easing?}]，time 为片段内秒数';
