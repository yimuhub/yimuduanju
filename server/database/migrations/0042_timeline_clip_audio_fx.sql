-- 音频效果链（FX rack）：时间线片段新增 audio_fx JSONB。
-- 客户端在片段上写 audio_fx = { nodes: [{ id, type, bypass?, params }] }，
-- 节点按信号路径排序（EQ/压缩/延迟/混响/高通/低通）；
-- 预览用 WebAudio 建链，导出翻译成 ffmpeg 滤镜插在音量包络之前。
-- 旧数据 NULL 即无效果链，命令字节级不变，向后兼容。
ALTER TABLE timeline_clips ADD COLUMN IF NOT EXISTS audio_fx JSONB;
