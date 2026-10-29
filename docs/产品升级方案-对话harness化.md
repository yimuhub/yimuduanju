# 一幕 YIMU · 产品升级方案（调研驱动）

> 调研时间：2026-10-29。输入源：①GitHub 30+ 个 AI 短剧/视频开源项目深度调研；②即梦/可灵/海螺/PixVerse/Runway/Pavo/Lovart/Manus 等平台 UX 调研；③本仓库自由画布与 Agent 体系的硬编码审计。
> 结论先行：**行业正在把"平台做薄、skill 做厚"。YIMU 的机会 = 已有的厚平台底盘（画布/工作台/队列/质检/剪映导出）× 开放的 skill harness 化改造 × 极简的对话入口。**

---

## 一、调研核心发现

### 1.1 两种主流形态正在合流（我们要做合流点）
- **输入框优先**（PixVerse/即梦/可灵）：首屏一个输入框 + 灵感 feed，3 分钟出第一条产出。
- **Agent 对话 + 画布**（Pavo/Lovart/Manus）：对话驱动任务，执行计划可见、逐项点亮，产物落在画布可继续操作。
- **Pavo（即 YIMU 对标的产品）验证过的形态**：一句话 → Harness 自动拆解（剧本→人物场景→分镜→视频→成片）→ 全程流式输出 → 无限画布承接所有产物（节点分叉试错）→ 3D 导演台 → Flash 预演/高质量定稿两级生成。

### 1.2 skill 生态（2026 年爆发的关键物种）
以 Claude Agent Skills 规范（`SKILL.md` + 脚本 + 参考文档）为载体：
- 火宝短剧（16.7k★）：7 个 SKILL.md，存 workspace 可在线编辑，升级只补缺不覆盖；
- DramaClaw（6.5k★）：11 个 workflow skill + 60 个 recipe（短剧/电商广告/IP 角色广告），画布支持 skill 节点，经 MCP 暴露给外部 Agent；
- shuohao-skills / zenstory：**质量闸门由确定性脚本而非模型把关**（10-18 道闸门/工序），"确认后生产、费用透明"是生产级协议；
- ArcReel（5.7k★）：58 个 skill + 逐任务费用追踪；
- awesome-short-drama-skills 精选目录已存在——**兼容该规范 = 直接接入 70+ 现成技能**。

### 1.3 本仓库硬编码审计（用户指出的"太多写死"坐实）
| 位置 | 问题 | 动态化方案 |
|---|---|---|
| `client/src/pages/FreeCanvas3/pavo3Constants.ts` `MODELS` | 模型列表全是虚构写死的 ID（注释自己写着"数据后续由后台配置"） | 改为从 `providers.listProviders()` + `fetchProviderModels()` 动态装配，常量仅作无配置时的兜底 |
| `ProjectAgentsTab.tsx` `assistantList` | 8 个 Agent 前端写死，后端只透传名字，无真实 Agent 定义 | 建 Agent 注册表（后端表），Agent = 人设+系统提示词+可用工具+skill 绑定，前端拉取 |
| `pavo3Constants.ts` `STYLE_LIBRARY` 等 | 风格库/预设写死 | 迁入 skill 库（style-bible skill 数据化），支持用户自建 |
| `pavo3Store.ts` | 画布与 agents API 零连接，@Agent 引用是摆设 | 画布 @Agent 走真实注册表 + agents.sendMessage |

---

## 二、升级方案总览（三层改造）

```
┌─────────────────────────────────────────────────────────┐
│ 体验层：极简首页 → 计划确认门 → 对话×画布双栏 → 工作台精修    │
├─────────────────────────────────────────────────────────┤
│ Harness 层：流水线各环节 = 可插拔 skill 节点                │
│   skill 注册表(后端表) + SKILL.md 规范兼容 + 界面内可编辑     │
│   + 确定性校验脚本闸门 + 确认后生产协议 + 费用透明            │
├─────────────────────────────────────────────────────────┤
│ 动态化层：模型/Agent/风格/模板 全部从配置与 skill 动态装配    │
└─────────────────────────────────────────────────────────┘
```

### 2.1 体验层：首页极简 + 流程贯通

**P0-1 首页极简化（一句话 + 一个输入框）**
- 现状的作战室三段式降级为"会话视图"：首次进入（无会话历史）时展示**居中大输入框 + 5 个场景芯片**（男频逆袭短剧 / 女频甜宠 / AI 漫剧 / 品牌 15s 广告 / 灵感剧场），不出现左侧会话栏与右侧面板。
- 灵感剧场：输入框下方铺官方模板卡（题材/画风/时长预置，点击带入 prompt 骨架），数据来自模板中心接口（已有），解决冷启动空白。
- 一旦提交第一条消息，界面平滑展开为三段式（会话列表滑入、产出面板滑入）。

**P0-2 计划确认门（Manus Plan Mode × Pavo Harness）**
- 用户提交创意后，Agent 先输出**拆解计划卡**（题材判定 → 剧本 → 人物/场景资产 → 分镜 → 成片，每步标注预计产出物与消耗），用户可改参数（时长/画风/集数/预算档）后点"开拍"才真正消耗算力。
- 现有 `quick-create` 已是全自动流水线——在它前面加一层"计划展示 + 参数确认"，后端加 `preview` 参数（只出计划不执行）。

**P0-3 两级生成节奏（Flash 预演 → 定稿）**
- 分镜关键帧先用快模型低价出草稿（复用现有 provider 路由的 balanced 档），用户在对话流/画布上点选满意的，再对选中镜头跑高质量定稿。已有 `routing.service` 与预算档位，补"预演→定稿"的编排与 UI 状态（草稿/已定稿）。

**P0-4 失败体感："从不真正失败"**
- 生成节点失败自动静默重试一次（换同档模型），重试过程在卡片上以状态条呈现；彻底失败时给出"一键换模型重试"。现有 job retry 机制已有，补自动降级路由。

**P1-5 对话 × 画布双栏（ChatCanvas）**
- 作战室右侧产出面板升级为"迷你画布"：产物卡片可拖入自由画布继续精修（深度链接到 `/project/:id/canvas-free3?node=:assetId`）；画布内产物可"发回对话"发起二次任务。复用现有画布与资产体系，打通双向。

### 2.2 Harness 层：平台 = skill 的执行框架（核心差异化）

**P0-6 Skill 注册表与运行时（后端）**
- 新表 `skills`：`id / name / line(shortdrama|comic|ads|common) / description(触发条件) / body(SKILL.md 正文) / scripts(JSON) / enabled / version / source(builtin|user|imported)`。
- 兼容 Claude Agent Skills 规范：提供**导入**（上传 zip/目录解析 SKILL.md）与**导出**；界面内在线编辑（火宝验证过的"升级只补缺不覆盖"）。
- 流水线各环节（选题/大纲/剧本/人物/场景/分镜/视频提示词/配音/BGM/剪辑/质检）声明为 skill 槽位；执行时按产品线取启用的 skill，把 skill 正文注入对应环节的系统提示词。**让"平台换 skill = 换脑子"。**

**P0-7 内置 skill 首发包（三产品线 22 个，来自调研清单）**
- 短剧 9：hit-topic-scout、novel-adapt、episode-outline、episode-script、character-asset、scene-prop-bible、storyboard、video-prompt-dialect、script-review-qc
- 漫剧 7：style-bible、character-sheet、comic-storyboard、voice-cast、bgm-mood、continuity-ledger、comic-edit
- 广告 6：ad-brief、ecommerce-ad、ip-character-ad、shot-motion-template、ad-style-kit、ad-localize
- 全部可从 awesome-short-drama-skills 生态导入校准，**只借鉴思路与结构，文本自主撰写**（多数开源 skill 为 AGPL/未声明协议，逐个核对许可证后再引入内容）。

**P1-8 确定性脚本闸门（QC 升级）**
- QC 从硬编码规则升级为"闸门可配置、随 skill 携带"：每个 skill 可声明校验脚本（时长硬闸门：段≤15s、镜 2-5s；台词账本与 TTS 输入一致；连续性锁短语核对）。现有 `qc.service` 规则引擎保留为通用闸门容器。

**P1-9 确认后生产 + 费用透明协议**
- 批量生成前先展示任务清单（数量/模型/预估费用），确认后执行；`generation_jobs` 费用已在记录，前端补"预估→实结"对账卡。中断任务审计（orphaned job 清理）。

**P2-10 MCP 出口**
- 把 YIMU 后端能力（建项目/查任务/取资产）经 MCP 暴露，让 Claude Code/Codex 用户把 YIMU 当生产后端——接住 skill 生态的开发者人群。

### 2.3 动态化层：消灭写死

**P0-11 画布模型列表动态装配**
- `pavo3Store` 启动时拉 `providers.listProviders()`，把每个供应商的 textModel/imageModel/videoModel/ttsModel 映射为画布 `MODELS`；ModelDialog 的模型下拉实时反映用户真实配置；无任何供应商时展示引导卡（去设置页添加）而非假模型。
- `selectedModels` 持久化到后端（stage-bindings 已有表结构可复用）。

**P0-12 Agent 注册表动态化**
- 新表 `agents`：`name / avatar / persona(系统提示词) / skill_ids / tools / scope`；内置 8 个 Agent 做种子数据；ProjectAgentsTab 与画布 @Agent 全部改为拉取注册表；Agent 发消息时把绑定的 skill 注入提示词。

**P1-13 风格库/模板/预设数据化**
- `STYLE_LIBRARY` 迁入 skill（style-bible）数据 + 用户自定义；比例/时长等物理枚举保留常量。

---

## 三、路线图

| 阶段 | 内容 | 验收标准 |
|---|---|---|
| **P0（1-2 周）** | 首页极简化+灵感剧场；计划确认门；模型列表/Agent 动态装配；skill 注册表+导入导出+内置 22 skill 种子 | 新用户 3 步内发起第一次生成；画布下拉=真实模型；增删 Agent 不改代码 |
| **P1（3-6 周）** | 两级生成+自动降级重试；脚本闸门 QC；确认后生产协议；ChatCanvas 双向；风格库数据化 | 预演→定稿跑通；失败自动降级体感；批量生成有预估/实结对账 |
| **P2（2-3 月）** | MCP 出口；skill 市场（导入第三方/创作者分成，为商业化铺路）；移动端（按《多端架构与客户端打包规划.md》） | 外部 Agent 可驱动 YIMU 建项目查任务 |

## 四、风险与对策
- **许可证**：开源 skill 内容协议混杂（AGPL/无声明）——内置包全部自主撰写，生态导入逐个核许可证；结构/规范不受版权保护。
- **skill 执行安全**：skill 附带脚本仅在后端沙箱目录执行、禁网络、白名单命令。
- **复杂度**：harness 化不动现有流水线代码，skill 槽位为旁路注入（无 skill 时行为不变），保证随时可回退。
