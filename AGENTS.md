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

### 视频通道（Agnes 专用 ≠ 通用）
通道判定只有一处真源：`shared/video-channel.ts` 的 `resolveVideoChannel()`。
网关、密钥池、worker、设置页四处共用，**禁止再各自写 `includes('agnes')`**。

优先级：显式 `modelParams.videoChannel` > `formatType` > `agnesSchema=relay`
> `agnes-ai.com` 端点 > `agnes-*` 模型 > 火山 > 通用。

- `agnes`：`POST /videos`，`mode=text/keyframe/reference`，只收公网 http(s) 素材，
  需要 Agnes 密钥 + `agnes-video-*` 模型；缺失时网关在建单前指名报错。
  参考图位置 `refs[1]`（字段名 `referenceVideoUrl`，实际是图片）**不受
  `capabilities.videoReference` 门控**，作为 `images` 与首帧合并发送。
- `generic`：`POST /video/generations`，OpenAI 兼容，只发标准字段（`image_url`）。
- `volcengine_ark`：`POST /contents/generations/tasks`。历史脏值 `format_type=volcano`
  由 `normalizeFormatType()` 归一化，不归一化会掉进通用分支拿空 baseUrl。
- 联邦密钥池（`leaseForVideo`）**只服务 agnes 通道**：视频环节绑了通用/火山时
  不得被换成 Agnes 的 Key 与端点。

手动重试（`retryJob`）必须清空 `transientSince / transientReleases /
lostTaskRetries / pausedReason`，并回收该 job 残留的 `key_leases`。否则重试会继承
上一次的等待时长，第一次撞 503 就按「已等待 3000+ 分钟」直接判死 —— 表现为
「点一下重试秒失败」。

### 多密钥并发（一把 Key = 一条车道）
视频并发上限**不写死**：`GenerationService.typeCap('video')` 由
`ProviderKeyPoolService.videoLaneCapacity()` 在启动时与每 60s 刷新，
等于「视频通道供应商下 enabled Key 的 concurrency 之和」（下限为环境变量基线，
上限 32）。4 把 Key 就是 4 单并行；只有 1 把时不会被拉高（否则任务抢不到车道空转）。

- 进程级 BullMQ 并发 = 各类型 cap 之和；`scripts/*.sh` **不得再写死
  `JOB_WORKER_CONCURRENCY`**，否则新上限会被旧并发卡住。
- 项目绑 Key 有两种语义（`projects.metadata.keyBindingMode`）：
  `shared` 钉住优先、忙时可借用其他车道；`exclusive` 该 Key 只服务该项目，
  别的项目租不到，本项目等这把。同一把 Key 被第二个项目设 exclusive 直接拒绝。
- 新增任何「瞬时等待」状态字段时，记得同步 `retryJob` 的清理列表与排队页文案。

### 导出命名
成片文件名**必须等于项目名**：`shared/file-name.ts::projectExportFileName()` 是唯一
真源（保留中文与全角标点、剔除路径分隔符与非法字符、按码点限长）。整片落
`<项目名>.mp4`，逐镜落 `<项目名>-镜NN.mp4`，同名即覆盖并复用资产记录（不得再
累积多条「成片-xxx」）。`GET /export/final.mp4` 用 RFC 5987 `filename*` 返回中文名。
禁止再出现 `final_<uuid>.mp4` / `shot_<num>_<uuid>.mp4` 这类不可读文件名。

### 图库（public media library）
视频通道（Agnes 官方）的首帧/尾帧/参考图**只接受公网 http(s) URL**，而全部产物落的是
`/uploads/xxx.png`。任何「把本地路径直接交给厂商」的写法都会让该素材被静默丢弃
（首帧丢失 → 退化成纯文生视频；参考图丢失 → 跨镜换脸）。

统一收敛顺序，不得调换：
1. 上游图片 CDN 回传地址（`generation_jobs.outputData.images[0].remoteUrl`，零成本最稳）
2. **图库** `public-media-library.ts`：本地图上传一次（catbox / 自建 `YIMU_MEDIA_UPLOAD_URL`），
   映射持久化在 `public_media` 表，隧道重启也不失效
3. 隧道临时副本 `staged-media.ts`：仅作兜底，终态即删

新增任何「提交给外部模型」的媒体入口，都必须走 `ensureLibraryUrl`，禁止裸传 `/uploads` 路径。
历史数据可用 `node scripts/backfill-public-media.js` 幂等回填。

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

## 版本与提交（每次更新都必须执行）

1. **升版本号**：`node scripts/bump-version.mjs <x.y.z>`，一次同步
   `package.json` / `package-lock.json` / `desktop/src-tauri/tauri.conf.json`。
   小改 `patch`、新功能 `minor`、破坏性变更 `major`，禁止同一版本号承载多次更新。
2. **本地验证**：`npm run type:check && npm test`；动前端再加 `npm run build:client`。
3. **提交**：`git commit -m "<type>(<scope>): <摘要> vX.Y.Z"`，正文列清改了什么、边界是什么。
4. **推送 + 打标签**：
   ```bash
   git push origin HEAD
   git tag vX.Y.Z && git push origin vX.Y.Z
   ```
   GitHub 上的提交与 tag 即“版本记忆”，不推送视为未完成。
5. **禁止 amend 已推送提交**；修正一律追加新提交并再次升版本号。
