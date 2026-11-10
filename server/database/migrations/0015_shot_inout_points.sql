-- 0015 线性剪辑 Phase 2：镜头源媒体入/出点（秒）
-- in_point：从源媒体取段的起始秒，NULL 语义为 0；
-- out_point：从源媒体取段的结束秒，NULL 语义为 in_point + duration。
-- 分割镜头不物理切视频文件：两条子镜头共享同一源文件，按入/出点各取一段。

ALTER TABLE shots ADD COLUMN IF NOT EXISTS in_point NUMERIC;
ALTER TABLE shots ADD COLUMN IF NOT EXISTS out_point NUMERIC;