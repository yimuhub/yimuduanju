# OpenMotion 交互对齐 · 产品功能进度

> 目标：把 OpenMotion（nexu-io/openmotion）时间线编辑器、面板尺寸与快捷键规则完整迁移到「一幕·神剪」，
> 同时覆盖 HTML 动画工作室与视频剪辑工作台；所有按钮、快捷键、窗口尺寸逐项验收。
>
> 基准源码：`/tmp/openmotion-ref`（本地 clone）
> 关键参考：`studio/src/components/dock/dockSideSizing.ts`、`studio/src/components/TimelineToolbar.tsx`、
> `studio/src/player/components/studioShortcuts.ts`、`studio/src/player/components/timelineSnapping.ts`、
> `studio/src/player/components/Timeline.tsx`、`studio/src/player/components/TimelineColumnResize.tsx`、
> `studio/src/player/components/timelineZoom.ts`

## 0. 对齐原则（从源码提炼，作为验收口径）

| 编号 | 规则 | 落地要求 |
| --- | --- | --- |
| R1 | 预览优先 | 面板变宽/窗口变窄时先压缩两侧，中间预览不得低于可用最小尺寸 |
| R2 | 面板都可调 | 左、右、底（以及 HTML 动画的代码栏）均可拖拽、双击复位、方向键微调、持久化 |
| R3 | 时间线以 px/s 缩放 | 缩放以指针为锚点，内容不整体跳动；提供 −/滑杆/+、百分比、适配 |
| R4 | 单一手势层 | 播放头拖动、标尺定位、片段移动、边缘裁剪共用同一套坐标，互不抢事件 |
| R5 | 吸附分级 | 播放头 > 片段边缘 > 节拍 > 网格；吸附半径约 5px，释放半径约 7px |
| R6 | 单行工具条 | 高频动作直接露出，低频收进分组菜单，不换行、不重复入口 |
| R7 | 快捷键一致 | Space、←/→、Shift+←/→、S 分割、N 吸附、F 预览全屏、⌘Z/⇧⌘Z、⌘D、Delete、Home/End |
| R8 | 窄屏不塌 | 窗口缩小后不出现横向溢出、面板互相遮挡、预览被压成不可用细条 |

## 1. HTML 动画工作室（`/motion/:id`）

| 功能 | 状态 | 说明 |
| --- | --- | --- |
| 四面板（左/右/时间线/代码）拖拽 | ✅ 完成 | `useMotionLayout`；双击复位、方向键微调、localStorage 持久化 |
| 预览优先约束 | ✅ 完成 | 左/右/代码宽度上限均扣除舞台最小宽度，极端拖拽不再把舞台挤没 |
| 时间线 px/s 缩放 | ✅ 完成 | 12–400 px/s；动态刻度；横向滚动画布；固定标签列 |
| 指针锚点缩放 | ✅ 完成 | ⌘/Ctrl + 滚轮，缩放后指针下时刻保持原位 |
| 适配全片 | ✅ 完成 | 工具条「适配」按钮，按可视宽度重算 px/s |
| 播放头拖动 | ✅ 完成 | 标尺按下即拖动；拖到边缘自动横向滚动 |
| 片段拖拽排序 | ✅ 完成 | 拖动时显示青色落点线；松手写回场景顺序 |
| 右边缘裁剪时长 | ✅ 完成 | 0.05s 网格 + 播放头吸附 |
| 分割 / 复制 / 删除 | ✅ 完成 | 工具条 + 右键菜单 + 快捷键 |
| 撤销 / 重做 | ✅ 完成 | ⌘Z / ⇧⌘Z；历史栈上限 20 |
| 右键菜单 | ✅ 完成 | 复制场景、删除场景 |
| 保存 / 刷新持久化 | ✅ 完成 | 场景顺序、时长、面板尺寸均保留 |
| 预览全屏 | ✅ 完成 | 舞台容器全屏，Esc 退出 |
| 窄屏默认收起代码栏 | ✅ 完成 | ≤1024 初始不占预览宽度；手动仍可打开 |
| 低高度窗口折叠 | ✅ 完成 | ≤680px 时间线降到 132；≤460px 降到 96 并隐藏播放条，页面不再纵向溢出 |
| 模板 / 新建场景 / 删除工程 | ✅ 完成 | Playwright 实测 3→4、撤销→3、模板→4、复制→4、分割→4、删除→2、撤销恢复 |
| 检查器字段（名称/时长/画布/帧率/底色） | ✅ 完成 | 改名即时反映到顶栏；2.5s/720 宽/30fps 输入均回写 |
| 代码编辑 / 保存 / 刷新回填 | ✅ 完成 | 追加注释保存后，服务端文档与刷新后的接口均保留 |
| 渲染弹窗 / 进度 / 下载 | ✅ 完成 | 渲染按钮进入进度弹窗；旧版 1080×1920/10s 成片 218KB 已实测 |
| 窄屏/低高度不溢出 | ✅ 完成 | 六档视口 `scrollWidth===clientWidth`，464×322 仍保留预览+时间线 |

## 2. 视频剪辑工作台（同构版）

| 功能 | 状态 | 说明 |
| --- | --- | --- |
| 左素材库 / 右检查器 / 底时间线拖拽 | ✅ 完成 | `useParityLayout`；双击复位、方向键微调、持久化 |
| 预览优先压缩两侧 | ✅ 完成 | `normalize` 先收检查器、再收素材库，保中间舞台 |
| 面板尺寸上限随窗口重算 | ✅ 完成 | 窗口 resize 实时夹紧，不污染桌面保存值 |
| 时间线缩放（−/滑杆/+） | ✅ 完成 | 14–120 px/s，工具条显示百分比/px·s⁻¹ |
| 指针锚点 ⌘/Ctrl+滚轮缩放 | ✅ 本轮新增 | 缩放后指针下时刻固定，不再整体跳动 |
| 适配全片 | ✅ 完成 | `fit()` 按可视宽度与内容总长重算 |
| 播放头拖动 | ✅ 本轮新增 | 标尺与播放头均可拖动；边缘自动滚动 |
| 片段移动 / 跨轨 / 边缘裁剪 | ✅ 完成 | 统一手势层；拖动自动滚动 |
| 自动建轨 / 轨道排序 | ✅ 完成 | 拖入空白新建 V/A/T 轨；上下拖动改 order |
| 轨道静音 / 隐藏 / 锁定 | ✅ 完成 | 轨道头三个开关，预览与导出同步 |
| 轨道高度 | ✅ 完成 | 轨道头 −/+ 调整；底部滑杆统一调 laneH |
| 吸附开关 | ✅ 完成 | N / P 切换；吸附半径 8/zoom，吸附播放头与片段边缘 |
| 单行时间线工具条 | ✅ 完成 | 分组菜单：删除/修剪、插入、智能包装 |
| 分割 / 复制 / 粘贴 / 撤销 / 重做 / 删除 | ✅ 完成 | 工具条与快捷键双入口 |
| ⌘D 原地复制到播放头 | ✅ 本轮新增 | 与 OpenMotion 对齐 |
| Shift+←/→ 十帧步进 | ✅ 本轮新增 | 逐帧粗调 |
| 预览区独立全屏 | ✅ 本轮新增 | 仅播放器全屏，F 键同入口；Esc 退出 |
| 时间线列宽（轨道头宽度） | ✅ 本轮新增 | 拖拽 196→256，双击复位 196，localStorage 持久化 |
| 时间线轨道高度拖拽手柄 | ✅ 完成 | 轨道头 −/+ 与底部行高滑杆；边缘拖拽手柄可作为下一轮增强 |
| 关键帧编辑面板 | ⏳ 未做 | 数据模型已有动画字段，缺时间线内联关键帧编辑 |
| 片段 hover 预览 | ⏳ 未做 | OpenMotion 有缩略图预览；当前仅标题提示 |
| 轨道头批量选择 / 多选拖拽 | ⏳ 待评估 | 与现有 EDL 多选模型兼容性待验证 |

## 3. 快捷键矩阵

| 键 | HTML 动画 | 视频工作台 | 状态 |
| --- | --- | --- | --- |
| Space | 播放 / 暂停 | 播放 / 暂停 | ✅ |
| ← / → | 逐帧 | 逐帧 | ✅ |
| Shift+← / → | 十帧 | 十帧 | ✅ |
| Home / End | 片头 / 片尾 | 片头 / 片尾 | ✅ |
| S | 分割 | 安全框（分隔用 E/⌘B） | ✅ 已注明差异 |
| N | 吸附 | 吸附 | ✅ |
| F | 预览全屏 | 预览全屏 | ✅ |
| ⌘D | 复制场景 | 复制片段到播放头 | ✅ |
| ⌘C / ⌘V | 复制 / 粘贴 | 复制 / 粘贴 | ✅ |
| ⌘Z / ⇧⌘Z | 撤销 / 重做 | 撤销 / 重做 | ✅ |
| Delete | 删除场景 | 波纹删除 | ✅ |
| ⌘+滚轮 | 指针锚点缩放 | 指针锚点缩放 | ✅ |

## 4. 窗口尺寸验收

| 视口 | HTML 动画 | 视频工作台 | 结论 |
| --- | --- | --- | --- |
| 1568×1058 | 380×676 | 718×404 | ✅ 无溢出 |
| 1440×900 | 260×462 | 590×332 | ✅ 无溢出 |
| 1200×800 | 235×418 | 350×197 | ✅ 无溢出 |
| 1024×768 | 217×386 | 420×236 | ✅ 双侧栏收起，紧凑抽屉可用 |
| 760×700 | 179×318 | 299×168 | ✅ 无溢出 |
| 464×322 | 54×96 | 171×96 | ✅ 无溢出；时间线 122 高可操作 |

验收项：`scrollWidth === clientWidth`、无元素越界遮挡、时间线/预览/工具条可操作、控制台 0 error。

## 5. 本轮变更与待办

- 已完成：HTML 动画面板联动夹紧、窄屏默认收代码栏、低高度折叠、代码保存；视频面板预览优先夹紧、播放头拖动、指针锚点缩放、模态 Esc、⌘D、十帧步进、预览独立全屏、轨道头列宽拖拽、紧凑抽屉入口、1024 预览溢出修复。
- 实测：HTML 23 项交互全通过；视频 29 项交互全通过；六档视口 0 横向溢出；独立项目 typecheck/185 单测/build 全通过。
- 已同步：本项目 v3.43.0（commit 9d21d83，tag 已推送）；经典版、镜头池与 7 页签检查器未改。
- 待完成：视频关键帧时间线内联编辑、片段 hover 缩略预览（下一轮增强，不冒充已实现）。

---

## 6. 2026-11-21 第三轮：原项目同步（视频同构版 Dockview）

- `client/src/components/studio/ParityDockShell.tsx` / `ParityDockPanels.tsx` / `ParityEditorContext.tsx`：从独立项目同步 Dockview 壳；面板节点改为项目内 `ShenJianShotPool`，业务数据仍走 `StudioShell` + `EdlContext`。
- `ShenJianWorkbenchParity.tsx`：改为 Dockview 布局，保留经典版、镜头池、检查器、导入/封面/导出、快捷键与全部既有入口。
- 设计令牌与品牌红：新增 `motion-tokens.css`，同步 `shenjian-parity.css` / `shenjian-proto.css`；青色强调改一幕红，字号统一 10/11px。
- 依赖：新增 `dockview-react@8.3.1`；原项目未引入 fontsource（构建时字体路径无法解析），使用系统字体回落。
- 验证：`npm run type:check` 通过；34 套 / 445 项单测通过；`npm run build:client` 通过。
- 未同步：HTML 动画工作室仍是固定四栏（独立项目已 Dockview 化）；需单独迁移 `MotionDockShell`，避免影响本项目的 7 页签工作台。

---

## 7. 2026-11-21 Round5+6 同步：独立版两轮 OpenMotion 对齐成果全量移植 v3.45.0

数据来源：独立版 `yimu-shenjian` v0.9.0（Round5 = commit c14ba75，Round6 = 71f9f18），基线对比 commit `13419e0`（v0.8.4，即独立版 Round5 前状态）与本项目 v3.44.0。逐文件三方 diff（orig / base / head）后按 A/B/C 三分类移植。

### 7.1 A/B/C 分类统计（对照范围：shared/ + client/src/components/workbench↔studio/ + client/src/{api,lib,styles} + server/ + test/unit/）

| 分类 | 定义 | 数量 | 处理 |
| --- | --- | --- | --- |
| A | 原项目与独立版 Round5 前基线完全一致 | 18 | 直接整拷独立版 HEAD（shared 2、client lib/api/styles 8、server 4、其余为样式/测试） |
| B | 双向分叉（原项目有本地改动） | 17 | 手术式合并（仅 4 个文件真正双向：timeline.service、assets.service/controller、schema、WorkbenchParity；其余为导入路径改名 `WorkbenchContext→StudioShell`、`useWorkbenchData→useStudioData`） |
| C | 原项目独有 | 保留不动 | 经典版 ShenJianWorkbench 的镜头池/比例三档/项目内返回、ParityDockShell/ParityDockPanels 的 sideCollapsed+onReady 布局、StudioShell 应用骨架、7 页签检查器、镜头历史/回退 API、assistant/projects/export（本项目自有导出体系）、app.tsx/index.tsx/HtmlMotionStudio/graphite.css |
| 新增 | 独立版新文件落地到本项目 | 31 | 新组件 9 + lib 5 + shared 6 + 样式 1 + server 2 + 迁移 5 + 测试 13（含 helpers 校正） |

### 7.2 移植功能清单（按模块）

**shared/ 纯函数真源**：`timeline-audio-expr`（音量包络表达式/帧量化）、`timeline-audio-fx`（FX 节点白名单/夹紧/参数自动化）、`timeline-audio`（避让规划 planVoiceDucking + sidechaincompress 图构建）、`lut3d`（.cube 解析/lut3d 滤镜参数）、`beat-detect`（22050Hz 包络窗节拍检测）、`export-formats`（mp4/webm/gif + crf 映射）；`timeline-keyframes`（ease 缓动）、`timeline-visual`（crop 裁切 + LUT 归一化）、`api.interface`（AssetMetadata/包络/淡变/避让/audioFx/节拍分析/导出格式字段；保留本项目 sourceShotId 注释口径）。

**服务端**：迁移 0040-0044（volume_automation+duck_under_voice / fade_in+fade_out / audio_fx / revisions.pinned / source_asset_id）；schema 对应 6 列；SaveTimelineClipDto/ExportTimelineDto/AnalyzeBeatsDto/RevisionPinDto 全链；mapClip/saveDocument/diffChangedClientKeys/toSaveClip 透传新字段；导出管线按独立版顺序叠加：FX→包络 volume expression→afade→（画面）crop→lut3d→fade→webm(VP9+opus)/gif(调色板两段式)→人声避让 sidechaincompress 混音；**无新字段时命令字节级不变**（quality 不传恒为 crf 20）；`assets :id/metadata` ffprobe 元数据 API（LRU 缓存）；uploads 放行 .cube（LUT_3D_SIZE 头校验）；`timeline/analyze-beats` 节拍分析 API（缓存 + in-flight 去重 + 失败降级）；`revisions/:n/pin` 固定接口。

**客户端**：时间线（剃刀/修剪到播放头/空隙闭合/冻结帧/拾取移动/时间-帧显示切换/节拍吸附/手动节拍点+独立撤销/关键帧 lane 行展开+ease/FX 自动化 lane/音量包络 lane）；走带（rAF 帧量化播放时钟迁入 StudioShell——JKL 1/2/4 档加速、I/O 工作区循环、倒放帧步进）；音频（电平表、G 增益对话框、片段淡入淡出、FX rack 面板、音量包络、人声避让、关键帧内联右键+auto-record）；面板（版本历史+pin、图层树、素材详情、选区 AI 条）；预览（画布缩放/平移+HUD+minimap，stageZoom 纯函数 + shenjian-zoom.css）；LUT .cube 端到端（WebGL 查表预览 + Inspector UI）；Crop 裁切（Inspector + 导出）；素材卡 hover 预览；导出对话框（格式/画质/GIF 循环）。

**键盘层**：两个工作台内联键盘层按原文件现状合并新键（B 剃刀、A 选择、Q/W 波纹、Shift+L 循环、G 增益、I/O 区域、⌘⇧B splitManyAt 批量分割、⌘Z 节拍栈优先、JKL 档位加速）；`lib/jianying-shortcuts.ts` 注册表整拷（A 类自带新键文档）。

**测试**：新增 12 个 spec（beat-detect/export-formats/lut3d/stage-zoom/timeline-audio(-duck-mix)(-fx)/timeline-beats(-manual)/timeline-gaps/timeline-visual-crop/asset-metadata）+ timeline-keyframes.spec 增补；jest `moduleNameMapper` 补 `@client` 别名。

### 7.3 架构落位差异（按原项目结构落地）

- 独立版 Round5 把壳上下文拆成 `WorkbenchContext`/`useWorkbenchData`/`OpenMotionChrome`；本项目对应物为 `StudioShell`/`useStudioData`/parity-topbar，**未引入**独立版壳文件。新组件的 `useStudio` 改从 `StudioShell` 导入；走带引擎（含 JKL/循环/I-O）按 WorkbenchContext 的实现嫁接进 StudioShell，并保留单镜预览（previewMode='shot'）的镜头范围边界。
- `ShenJianMediaPool`（独立版素材池）未引入：本项目对应结构是 `ShenJianShotPool`（镜头池，C 类），两个工作台继续用镜头池。
- 节拍吸附依赖片段↔素材映射：本项目时间线片段此前只存 sourceUrl，本次补 `source_asset_id`（迁移 0044）+ `TimelineClip.sourceAssetId` 可选字段；旧片段该列为 NULL，节拍吸附对其不生效（仅新创建片段可吸附）。

### 7.4 验证

- `npm run type:check`：server / client 双端 0 错误。
- `npm test`：46 套件 / 633 项全部通过（含新增 12 套 shared/lib 纯函数测试）。
- 版本 3.44.0 → 3.45.0；经典版、镜头池、7 页签检查器、镜头历史/回退、assistant/projects/export 体系零改动。

### 7.5 遗留项

| 项 | 原因 | 建议 |
| --- | --- | --- |
| 独立版双工作台变体切换 / ProjectListPage / MotionDockShell / openmotion-shell·timeline.css 未引入 | 本项目壳结构（StudioShell 七页签 + Dockview parity 壳）与独立版不同源，强转会破坏经典版 | 已按本项目结构落地全部功能面；如需壳级 1:1 需单独立项 |
| 旧时间线片段无 source_asset_id，节拍吸附/素材级联动对存量片段不生效 | 本项目原以 sourceUrl 关联素材，历史上未落 asset id | 可加一次性回填脚本按 fileUrl 匹配 assets.url |
| `ParityEditorContext` 恢复了基线即有的 previewQuality 字段 | 原项目 v3.44 曾删除该字段；独立版组件族仍引用它 | 无行为影响；后续如清理需同步改组件族 |
| ShenJianTimeline 采用独立版几何参数（轨道头 132px / OpenMotion 行高体系），原项目旧参数（196px/64px）被取代 | 独立版 v0.8.2/v0.8.3 已按 OpenMotion 实机重做时间线，Round5/6 全部建立在该几何上 | 用户侧轨道头宽度仍可拖拽并持久化（新 localStorage key） |
| HTML 动画工作室仍为固定四栏（独立版已 MotionDockShell 化） | 同壳级差异，本轮范围外 | 维持第三轮结论 |
