-- 0021 逐镜场景环境（scene_env）+ 画幅/无文字提示词共用事实
-- 依据：bolecodex 分镜规范（lighting / focus / color_tone / framing 逐项必填）、
--       taylorzhou16/video-gen（场景时间·地点·环境 + 光影方向色温 + 画幅五要素）、
--       MN0709【整体场景与氛围】（时间天气、主光源来源方向光质、环境色彩、
--       空气介质、画幅、情绪）与火宝的 atmosphere 字段。
-- 目的：把「场景到底是什么样」从 visualPrompt 的自由文本里拆成结构化事实，
--       让分镜 LLM、首帧图片提示词、视频提示词共用同一份描述，不再各写各的。
-- 全部语句幂等；历史镜头 scene_env 为 NULL，由运行时用 locations 环境字段兜底。

ALTER TABLE shots ADD COLUMN IF NOT EXISTS scene_env JSONB;

COMMENT ON COLUMN shots.scene_env IS
  '逐镜场景环境：timeOfDay/weather/locationType/place/lightSource/lightDirection/lightQuality/colorPalette/atmosphere/spatialRelation/composition/ambientSound，全部为简体中文物理事实';
