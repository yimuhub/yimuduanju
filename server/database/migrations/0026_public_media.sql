-- 0026 图库（public media library）
-- ---------------------------------------------------------------------------
-- 问题：视频通道（Agnes 官方）只接受**公网可访问的 http(s)** 首帧/参考图，
-- 而我们所有产物都落盘成 `/uploads/xxx.png` 这种相对路径。旧实现靠两条临时
-- 通道凑 URL：① 上游图片 CDN 回传地址（只覆盖本系统自己生成的图）；
-- ② trycloudflare 隧道（每次重启换域名，老 URL 全部失效，任务建单后上游
-- 下载不到就整单失败）。用户导入的本地图 / 手工上传图两条都覆盖不了。
--
-- 这里建一张持久映射表：本地路径 → 图库公网 URL。首次用到时上传一次并登记，
-- 之后所有项目、所有任务直接复用同一个 URL，隧道重启也不受影响。
--
-- 不进 assets 表的原因：图库是「素材的对外地址」，同一张图会被多项目、多镜头
-- 反复引用，且包含 characters.identity_kit 里那些并非独立资产的图；用
-- (local_path) 做主键天然幂等，也避免把 assets 的版本链搅浑。
CREATE TABLE IF NOT EXISTS public_media (
  -- 本地路径（形如 /uploads/<project>/<file>.png），全库唯一
  local_path   TEXT PRIMARY KEY,
  -- 图库回传的公网 URL
  public_url   TEXT NOT NULL,
  -- 上传到了哪个宿主：catbox（公共图床）/ self（自建，YIMU_MEDIA_UPLOAD_URL）
  host         VARCHAR(40) NOT NULL,
  bytes        BIGINT,
  -- 被引用的次数，用于判断是否值得长期保留
  hits         INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_public_media_last_used ON public_media(last_used_at DESC);
