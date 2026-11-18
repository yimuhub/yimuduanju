ALTER TABLE timeline_clips
  ADD COLUMN IF NOT EXISTS source_duration NUMERIC;

UPDATE timeline_clips
  SET source_duration = GREATEST(out_point, in_point)
  WHERE source_duration IS NULL;

COMMENT ON COLUMN timeline_clips.source_duration IS
  '源媒体完整时长（秒）；用于限制右边缘最多拖到源视频结尾，不随裁剪改变';
