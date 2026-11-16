-- 0027 时间线生产级改造：乐观锁版本号 + 轨道元信息
-- version 用于并发编辑保护：PUT 携带 expectedVersion，与库内不一致返回 409，
-- 前端提示「时间线已在别处更新」而不是静默覆盖。
ALTER TABLE timeline_documents
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 0;

-- 轨道元信息（用户可重命名 / 静音 / 独奏 / 锁定 / 调高）：
-- [{ track:'video', lane:0, name:'主画面', muted:false, solo:false, locked:false, height:26 }]
-- 导出按 muted/solo 过滤音频与视频轨；为空表示全部使用默认值。
ALTER TABLE timeline_documents
  ADD COLUMN IF NOT EXISTS tracks JSONB;
