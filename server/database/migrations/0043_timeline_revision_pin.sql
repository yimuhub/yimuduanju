-- 版本历史固定（C4，对齐 OpenMotion MotionHistoryPanel 的 Pinned）：
-- 修订新增 pinned 布尔，客户端 PUT /timeline/revisions/:revision/pin 接口切换星标，
-- 列表返回 pinned 供「只看已固定」过滤。旧数据默认 FALSE 即未固定，
-- ADD COLUMN IF NOT EXISTS 保证幂等可重跑。
ALTER TABLE timeline_revisions ADD COLUMN IF NOT EXISTS pinned BOOLEAN NOT NULL DEFAULT FALSE;
