# 一幕·YIMU AI 短剧创作平台

## 产品定位
从"故事/剧本输入到成片导出"的 AI 短剧工业化生产平台。核心体验：上传剧本/输入一句话 → Agent 自动完成完整生产链。

## 设计规范（即梦AI 风格）

### 色彩系统
- **主品牌色**：`--primary: hsl(2 85% 60%)` 即红色 #FF403A
- **文字主色**：`--foreground: hsl(220 14% 14%)` 即深灰 #1F2329
- **背景**：白色 / 浅灰渐变点缀
- **渐变点缀**：红/橙/紫柔和渐变，用于 Hero 背景与 CTA
- **成功/警告/错误**：沿用系统 token

### 布局与间距
- 内容最大宽度 1280px，居中
- 左侧固定导航栏宽 240px
- 卡片圆角 12px（--radius-lg）
- 卡片内边距统一 24px
- 区块间距 24px
- 整体留白充足，不拥挤

### 排版
- 标题：font-semibold，20-28px
- 正文：14px，颜色 var(--foreground)
- 辅助文字：12-13px，颜色 var(--muted-foreground)

### 导航
- 左侧固定 Sidebar，品牌 Logo + 导航项（图标+文字）
- 选中项用主色高亮
- 导航项：工作台、我的项目、一键创作、模板中心、资产库、AI助手、设置

## 技术架构

### 后端模块
- `projects` - 项目管理
- `scripts` - 剧本解析
- `bible` - 制作圣经（人物/场景/风格）
- `storyboard` - 分镜故事板
- `assets` - 资产管理
- `generation` - 生成任务队列 + Model Gateway
- `providers` - Provider 配置管理
- `qc` - 质检报告
- `export` - 导出

### Model Gateway
统一接口：generateText / generateImage / generateVideo / generateTTS
Provider Adapter：火山方舟 / OpenAI兼容中转站 / 自定义

### 状态机
DRAFT → PARSING → PLANNING → BIBLE_READY → STORYBOARD_READY → ASSETS_GENERATING → VIDEO_GENERATING → AUDIO_GENERATING → EDITING → QC → READY → EXPORTED

## 前端路由
- `/` - Dashboard 首页
- `/projects` - 项目列表
- `/create` - 一键创作向导
- `/templates` - 模板中心
- `/assets` - 资产库
- `/ai-assistant` - AI助手
- `/settings` - 设置（Provider/预算/默认值）
- `/project/:id/*` - 项目工作台（多 Tab）
  - overview / script / bible / characters / scenes / storyboard / director / timeline / assets / agents / tasks / qc / export
