-- G12/G15：时间线片段新增「音量包络」与「人声避让」标记。
-- 客户端在配乐片段上写 duck_under_voice=true（可附 volume_automation 包络点），
-- 导出混音时以人声链为 sidechain 喂 sidechaincompress，音乐自动闪避人声；
-- 包络亦直接驱动导出音频链的 volume 表达式。旧数据 NULL/FALSE 即无包络、不避让。
ALTER TABLE timeline_clips ADD COLUMN IF NOT EXISTS volume_automation JSONB;
ALTER TABLE timeline_clips ADD COLUMN IF NOT EXISTS duck_under_voice BOOLEAN NOT NULL DEFAULT FALSE;
