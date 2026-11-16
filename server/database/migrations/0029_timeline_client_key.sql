-- 时间线片段稳定标识（Agent 剪辑 / 内联字幕 / 选中态的地基）
--
-- 为什么需要：saveDocument 每次整体替换（delete + insert），片段 id 由服务端
-- 重新生成；前端只要保存一次，基于 id 的选中、正在编辑的字幕、Agent 提案
-- 就会指向已不存在的数据。client_key 由客户端生成、随片段一起保存，
-- 服务端只做唯一约束，从而「业务身份」与「存储主键」解耦。
--
-- 为什么历史数据直接回填 id：老片段没有业务身份，用旧 id 当一次 key 即可；
-- 下次保存时客户端会带上它，不会再次变化。

ALTER TABLE timeline_clips ADD COLUMN IF NOT EXISTS client_key TEXT;

UPDATE timeline_clips SET client_key = id::text WHERE client_key IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_timeline_clips_client_key
  ON timeline_clips (project_id, client_key)
  WHERE client_key IS NOT NULL;
