ALTER TABLE timeline_clips
  ADD COLUMN IF NOT EXISTS transcript JSONB;
