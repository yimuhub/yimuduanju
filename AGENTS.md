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

## 对话/面板分工（精修与长篇升级调研 D 答案提炼）

对话（Agent/聊天面板）与编辑面板（工作台各 Tab、聚焦编辑器）服务同一条产线，
分工边界如下——两边写同一数据源（同一 API / 同一数据库），不存在第二份状态。

### 对话改意（语义与编排）
- **适合对话**：语义级修改（改人设并同步所有镜）、跨镜/跨文件批量改写、
  生成编排（拆分镜、批量出提示词、重试失败）、诊断问答（为什么失败/过期）。
- **产物级/全文级变更必须可审**：Agent 产出保持草稿态，经确认卡
  （GateCard / 确认门）呈 diff 后才落库、才触发昂贵的生成；「对话说完改什么，
  面板确认怎么落」。Agent 不直接改 `locked` 的镜头，不越过确认门批量生成。

### 面板落地（字段精修与昂贵操作）
- **面板独占**：字段级精修（分镜聚焦编辑器 blur 即单字段 PATCH 保存）、
  视觉选择（参考图绑定、历史产物点选回填主图）、单镜重跑/forceNew 重跑、
  锁定开关、以及一切会真实花钱的生成触发按钮。
- **即时生效**：面板手工编辑粒度小、可逆、用户亲手，直接写库并 toast 反馈，
  不走草稿-确认流。

### 共同红线
1. **同一数据源**：对话与面板共用同一套 API；前端禁止另存副本，落库后 refresh 收敛。
2. **先读后写**：Agent 修改前先读上下文（分镜/剧本现状），不瞎改。
3. **可追溯**：Agent 产出的结构化修改附 reason/证据引用，便于审查回溯。
