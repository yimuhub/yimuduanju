# HTML 动画工作室（OpenMotion / HyperFrames 式）

入口：`/motion`；神剪同构版顶栏「HTML 动画」、项目列表顶部「HTML 动画」。

## 它解决什么

把一段 HTML/CSS/JS 当作一个可编辑镜头：左侧场景卡片、中间实时代码与画布、
右侧检查器、底部双轨时间线。保存后由无头 Chrome 按 fps 逐帧 seek 截图，
FFmpeg 编码为 MP4。不是录屏，也不依赖第三方渲染服务。

## 编辑器契约

- 一个场景 = 一段完整 HTML（可含 `<style>`、CSS keyframes、WAAPI）。
- 场景卡片可拖动排序，可改时长；时间线点击可定位到任意场景。
- 预览 iframe 按工程画布尺寸布局后再整体缩放，保证预览与成片排版一致。
- 支持作者自定义 `window.__hfSeek(t)`；未定义时运行时暂停全部动画并设置 `currentTime = t*1000`。
- 每场景独立渲染为中间 MP4，再以 concat 合并；场景边界无重叠。

## 后端

- `GET/POST /api/motion/projects`
- `GET/PATCH/DELETE /api/motion/projects/:id`
- `POST /api/motion/projects/:id/render` → 返回 jobId，异步渲染
- `GET /api/motion/render/:jobId` → `queued/capturing/encoding/done/failed` + progress
- 表 `html_motion_projects`，迁移 `0003_html_motion.sql`
- 输出：`data/uploads/html-motion/<projectId>/<jobId>.mp4`，URL `/uploads/html-motion/...`

## 渲染环境

- 需要 `ffmpeg` 可执行；需要 Chrome/Chromium。
- Chrome 查找顺序：`MOTION_CHROME_PATH` → macOS Google Chrome → Chromium → Linux google-chrome/chromium。
- 默认 1080×1920 / 24fps；10 秒片约 30 秒渲染（本机实测）。

## 边界（明确未做）

- 没有引入 HyperFrames 依赖，也没有复制其 Studio 源码；这是按同构交互自研的最小可用实现。
- 目前是场景级时间线，不是任意图层关键帧时间线；每个场景内部用 CSS/JS 自己控制动画。
- 没有转场模板、音频轨、字幕轨、模板市场。
- 渲染为无音频视频；需要音频仍回到 EDL 时间线合成。
