ALTER TABLE timeline_clips
  ADD COLUMN IF NOT EXISTS pitch NUMERIC NOT NULL DEFAULT 1;

COMMENT ON COLUMN timeline_clips.pitch IS
  '音高倍率；1=原音，1.12≈升2个半音，0.89≈降2个半音。导出用 asetrate + atempo 保持时长';
