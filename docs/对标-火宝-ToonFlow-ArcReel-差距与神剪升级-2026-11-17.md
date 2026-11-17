# 一幕 vs 火宝 / ToonFlow / ArcReel：源码级差距、可交付路径与神剪升级方案

日期：2026-11-17  
分支：`feature/shenjian-delivery-v3.20`  
基线：`v3.20.0`（分镜详情全屏浮层修复）  
调研方式：源码包 + GitHub Trees API + raw 关键文件；不是只看 README。

---

## 0. 先回答那个最关键的问题：对话驱动剪辑，是架构做不到吗？

**不是架构做不到。一幕已经有这条链路，而且底层比多数开源项目更完整：**

- 对话侧：`server/modules/assistant/assistant.service.ts` 注入时间线上下文、全文转写索引、`yimu-timeline` 动作协议；
- 提案侧：`client/src/lib/timeline-agent-ops.ts` 解析代码块，`TimelineOpsCard` 出确认卡；
- 落库侧：`POST /api/projects/:id/timeline/agent-ops` 在事务里整批应用，任何一条失败整批拒绝；
- 动作内核：`shared/timeline-ops.ts` 是纯函数，支持 move / trim / split / delete / subtitle / speed / volume / lock / enable / roughcut / track；
- 审计侧：`agent_edit_ops` 已记录 baseVersion、resultVersion、ops、diffs、幂等键；
- 转写侧：`shared/transcript-index.ts` 已把字幕片段与镜头对白映射到成片毫秒，并有抽取式选段 `selectRoughCutRanges`。

**真正让它“看起来办不到”的，是五个可靠性缺口，不是能力缺口：**

1. **文字覆盖率不足**：时间线里没有字幕、镜头没有对白的片段，索引里就是空的。测试项目 33 分钟只有 2 句可读文本，Agent 再聪明也只能剪 2 句。这是 ASR（语音转写）缺位，不是剪辑架构缺位。
2. **模型只“看见”一次上下文，没有读写工具循环**：现在是“把上下文塞进 prompt → 模型一次性吐 JSON”。模型不能先 `read_timeline`、再 `scan_issues`、再改写、再复核。长片一旦超出上下文或模型漏看中后段，就会退化成截开头。
3. **没有修订账本**：只有当前版本，旧版本被覆盖。baseVersion 一过期就整批 409，用户只能重来；也不能“回到上一条剪法”。
4. **冲突粒度太粗**：别人只改了 A 片段，Agent 提案只动 B 片段，也会被整批拒绝。
5. **没有体检模型**：缺源、同轨重叠、字幕越界、主轨空隙这些“必然出问题”的状态，没有统一分级给 Agent 和导出层。

本轮已开始补 3/4/5（见第 6 节），1/2 是下一阶段重点。

**结论：可以升级架构，而且不需要推翻重来。** 正确路线是“给已有动作内核加上读写工具、修订账本、体检、ASR 与多角色编排”，不是另起一套剪辑器。

---

## 1. 三个参考项目到底强在哪

### 1.1 火宝 Huobao Drama（`chatfire-AI/huobao-drama`）

- 技术栈：Hono + Drizzle + Mastra Agents + SQLite；Electron 桌面版；前端 Nuxt 3。
- 4 个 Agent：`script_rewriter` / `extractor` / `storyboard_breaker` / `prompt_generator`。
- `backend/workspace/skills/*/SKILL.md` 是**可在线编辑的技能文件**，不是写死在代码里的提示词。
- 分镜拆解规范（`storyboard-breaker/SKILL.md`）：
  - 一个分镜段落 = 一个视频生成任务；
  - 段 8–15 秒，段内 2–4 个子镜头，子镜头可切景别/角度/对象，但**不跨场景**；
  - 台词时长硬规则：`段落时长 ≥ 字数 ÷ 4.5 + 2s`；
  - 段级绑定 `scene_id / character_ids / prop_ids`，道具作为白底单品参考图参与生成。
- 角色参考图规范（`character-prompt/SKILL.md`）：
  - 固定构图「左侧正脸特写 + 右侧正面/90°侧面/背面三视图」；
  - 核心原则写死为「一致性 > 美观」；
  - 禁止动态姿势、夸张表情、手持道具、同框、裁切身体、文字水印。
- 视频提示词规范（`video-prompt/SKILL.md`）：
  - 第一行信息头「出场人物：@角色；场景：@场景；道具：@道具」；
  - 按 3 秒分段，段数 = 时长 ÷ 3 向上取整；
  - `@名字` 在生成时替换为参考图标记，**每段至少一个 @ 引用锚定画面**；
  - 台词逐字来自分镜描述，情绪必须转成可见动作。
- 可交付性来源：技能与提示词是产品资产，用户能改；Agent 职责单一；桌面安装包 + 商业版网页；SQLite 零安装；FFmpeg 内置。

### 1.2 ToonFlow（`HBAI-Ltd/Toonflow-app`）

- 不是“一个 Agent 干完”，而是**阶段化、可确认、可回读的工程流程**。
- `packages/skills/v118workflow/SKILL.md` 把流程拆成 14 个阶段：项目初始化 → 来源事件 → 故事骨架 → 改编策略 → 逐集剧本 → 基础资产 → 资产图片 → 导演规划 → 衍生资产 → 分镜表 → 分镜面板 → 分镜图片 → 视频与交付。
- 每个阶段都有：
  - 指定落点（剧本画布 / 资产画布 / 每集制作画布）；
  - 明确的“写入后回读”；
  - 用户确认关口（草稿 / 待确认 / 已确认 / 生成中 / 失败 / 待复核 / 已跳过）；
  - 上游改动后的下游影响标记，不自动全剧重做。
- `packages/teams/storyboardTeam`：director 统筹、writer 编写、reviewer 审阅；`team.json` 声明成员、委派关系、资源访问范围。它证明“多 Agent 团队”可以是**产品内的一等公民**，不是开发者口头约定。
- `knowledge/continuity.md` 的连续性口径很硬：衣着、携带物、受伤状态、情绪要可追溯；空间相对位置、出入方向、视线、主光方向要可理解；动作起终点衔接；持物手与道具数量不能无说明改变；声音要与画面实际发生的事一致。
- 可交付性来源：无限画布 + 逐镜图片/视频模型 + 3D 导演台 + Win/Mac 桌面安装包 + 阶段确认。它卖的不是“生成”，是**可控的生产流程**。

### 1.3 ArcReel（`ArcReel/ArcReel`）

- Python 后端 + 内嵌 Agent Runtime；主 Agent + 六阶段子 Agent；11 个生成供应商；AGPL-3.0。
- 最值得直接学的是它的**剪辑工具语义**（`server/agent_toolset/edit_timelines.py`）：
  - `create_timeline` / `list_timelines` / `read_timeline` / `edit_timeline` / `rename_timeline` / `list_revisions` / `restore_revision` / `list_bgm`；
  - 每条时间线有**修订历史**：revision、parent、author、summary、changed_clip_ids、restored_from；
  - `edit_timeline` 是**按剪辑片段 ID 定位的一批操作，整批原子提交为一个新修订**；
  - `base_revision` 过期时：如果本批涉及的片段在那之后没被改过，照常应用到最新修订；否则返回 `revision_conflict`，带 `latest_revision` 与 `conflicting_clip_ids`；
  - 每条操作非法时整批不生效，返回 `operation_invalid`，带 operation_index、clip_id、field、allowed；
  - `trim` 绑定视频版本 `basis_version`，换版本后截取作废；
  - 每个片段有 `status`：ready / video_missing / unit_deleted；
  - 时间线有 `issues`：blocking / warning / info，带 applies_to、clip_ids；
  - 旁白有 `narration_missing / narration_overrun / narration_source_collision`；
  - BGM 有重叠检测、截断淡出、响度统一；
  - `export_jianying_draft` 直接导出剪映草稿，字幕/旁白重叠时自动多开轨。
- 可交付性来源：**Agent 的每个工具都有极详细的契约描述**，模型知道什么时候该读、什么时候该写、写失败是什么原因；加上修订、冲突、体检、剪映草稿导出，形成闭环。

---

## 2. 一幕自己的家底（不能低估）

一幕不是“从零追”。这些是已经落地、且三家里没有全部具备的：

| 能力 | 一幕现状 | 对比 |
|---|---|---|
| 一致性实体 | `characters.lock_anchors`、`reference_image_urls`、场景参考图、`props.reference_image_urls` | 火宝有角色/场景/道具，但没有身份锁短语数组与跨集交接账本 |
| 一致性门卡 | `asset-prep.service.ts` 单镜放行：缺人物/场景参考图直接拦截 | 火宝主要在提示词层约束，没有硬门卡 |
| 看图审计 | `qc_reports.audit_type=visual`，角色一致性看图审计 | ToonFlow 有 reviewer，但以文字方案审阅为主 |
| 身份包 | `generateIdentityKit` 一次生成主图 + 四视图，逐槽回写 | 火宝是单张三视图合成图，复用粒度更粗 |
| 长篇多集 | `episodes`、`handoff_state`、按集 pipeline | ToonFlow 有分集画布；一幕有结构化交接账本 |
| 时间线动作内核 | 纯函数 `timeline-ops.ts`，11 类 op，dry-run diff，整批原子 | ArcReel 也有，但一幕前后端共用同一套纯函数 |
| 对话直剪 | 已有 `yimu-timeline` 协议 + 确认卡 + 审计 + 幂等 | 三家没有“对话直接改 EDL”的完整中文产品化 |
| 视频通道 | `resolveVideoChannel()` 单一真源，Agnes / 通用 / 火山三分支 | 火宝/ArcReel 供应商更多，但一幕的通道判定更收敛 |
| 多密钥并发 | 一把 Key 一条车道，项目 shared/exclusive 绑定 | 多数开源项目是单 Key 串行 |
| 图库 | `public-media-library.ts` 解决外部模型只收公网 URL | 火宝用 PUBLIC_BASE_URL，部署门槛更高 |
| 导出命名 | 项目名即文件名，中文 RFC 5987 | 火宝/ArcReel 仍多用 uuid 文件名 |

**一幕真正的优势不是“模型更强”，是“生产链更完整、更贴近中文短剧工业化”。** 差的是把这条链做成**可审计、可回滚、可确认、可交付**的产品。

---

## 3. 为什么它们能成为可交付产品，一幕还不能

不是功能数量差，是**交付语义**差。逐条对照：

### 3.1 阶段确认与回读

- ToonFlow：每阶段写入画布 → 回读 → 展示 → 等确认；聊天摘要不能代替画布成果。
- 一幕：有 pipeline approvals 与确认卡，但很多自动链路仍然“任务启动 = 阶段完成”，缺少统一回读与阶段记录。
- 差距：**“做完了”没有可核验的证据链**。商业客户不关心你跑了多少任务，关心“这一版剧本/分镜/成片到底是哪一版、谁确认的”。

### 3.2 上游改动 → 下游失效

- ToonFlow：剧本改 → 标本集导演/分镜/视频待复核；资产版本改 → 标引用该资产的分镜/视频；保留原成果，不自动全剧重做。
- 一幕：有 pipeline 与 qc，但没有统一的“失效传播”账本。
- 差距：**改一个字，不知道哪些镜头/视频过期了**。这是返工与成本失控的根源。

### 3.3 时间线修订与冲突

- ArcReel：每次编辑是一个 revision；按 clip ID 批量原子提交；base_revision 冲突按 clip 判定；可回滚。
- 一幕：有 version 乐观锁与 agent_edit_ops 审计，但没有修订快照、不能回滚、冲突整批拒绝。
- 差距：**Agent 改片不可逆、不可并排比较、不能安全并发**。

### 3.4 体检与阻断

- ArcReel：blocking / warning / info 三级，导出前检查；旁白/BGM 有专门冲突码。
- 一幕：导出层有校验，但没有统一体检模型给 Agent 读。
- 差距：**Agent 不知道当前时间线能不能出片**，只能盲改。

### 3.5 文字覆盖（ASR）

- 火宝/ToonFlow/ArcReel 都把“台词/旁白”作为一等数据；ArcReel 有 TTS 实测时长与旁白冲突检测。
- 一幕：字幕/对白可读，但没有词级 ASR；没有字幕的素材对 Agent 是黑箱。
- 差距：**“通读 30 分钟再剪 1 分钟”在无字幕素材上不成立**。

### 3.6 桌面交付

- 火宝：Electron 安装包；ToonFlow：Win/Mac 安装包；ArcReel：Docker/WSL2/macOS。
- 一幕：Tauri 桌面产物仍停在 3.18.3，CI 排队未出包；三端未做深度回归。
- 差距：**网页能演示，桌面不能交付**。商业客户要的是安装包、崩溃率、导出成功率。

### 3.7 许可证边界

- 火宝：CC BY-NC-SA 4.0（**非商用**）；ArcReel：AGPL-3.0；ToonFlow 需逐个确认。
- 结论：**不能直接搬代码**。可学方法、可重写实现，不能把非商用/AGPL 代码混进商业闭源产品。

---

## 4. 一幕应该如何发挥优势

### 4.1 把“一致性工程”做成产品卖点，而不是隐藏实现

- 对外可见的「一致性契约」面板：每个镜头显示引用了哪些角色/场景/道具、身份锁、服装状态、道具持有手、受伤状态、上一镜衔接。
- 生成前：缺参考图/缺契约直接拦截；生成后：看图审计出报告，drift 超过阈值自动重跑。
- 这是火宝/ToonFlow 都做不到“硬门卡 + 看图审计 + 跨集账本”三件套的地方。

### 4.2 把“对话直剪”做成行业差异点

- 中文自然语言 → 全文时间码 → 语义选段 → 可审 diff → 一键应用 → 可回滚。
- 不是“AI 帮你点按钮”，是“AI 给你一版可审的剪辑方案”。
- 这是 ArcReel 有工具但没中文产品化、火宝/ToonFlow 基本没有的方向。

### 4.3 把“神剪”做成短剧产线的最后一公里

- 剪映级快捷键 + 多轨 + 字幕 + 封面 + 导出，让生成完的素材**当场能交付**。
- 不追求 100% 剪映功能平替；先做到短剧常用 80%：分割、波纹删、变速、字幕、画中画、封面、局部导出、关键帧、复合片段。

### 4.4 不追“无限画布”的复杂度，追“产线闭环”

- ToonFlow 的无限画布很重，学习成本高。
- 一幕的优势是“剧本 → 资产 → 分镜 → 视频 → 剪辑 → 导出”一条链，应该把这条链的**断点**全部补上，而不是再画一张画布。

---

## 5. 升级路线（按可交付优先级）

### P0 本轮必须闭环（已做/在做）

1. 分镜详情闪一下：全屏浮层修复（已完成，v3.20.0）。
2. 时间线修订账本：每次保存写快照，支持列表与回滚（migration 0032）。
3. 冲突按片段判定：baseVersion 过期但改动不相交时继续应用；相交才 409。
4. 时间线体检：blocking / warning / info，Agent 上下文与 `/timeline/issues` 共用。
5. 一句话粗剪兜底：模型没给动作时，确定性选段生成 `yimu-timeline` 提案。
6. 分镜/视频提示词技能升级：8–15s 段、2–4 子镜、不跨场景、台词 ÷4.5+2s、@引用信息头、3s 分段、连续性账本。
7. 角色参考图规范升级：左侧正脸 + 右侧三视图、一致性 > 美观。

### P1 下一轮（商业交付必需）

8. ASR 适配层：`AsrProvider` 接口（OpenAI-compatible `/audio/transcriptions` + 本地 faster-whisper 可插拔），转写结果写 `shot_transcripts`，索引优先读词级时间码。
9. Agent 读写工具循环：把 `read_timeline / scan_issues / list_revisions / apply_ops` 暴露成模型可多轮调用的工具，而不是一次性 JSON。多角色编排：Director（拆目标）/ Editor（选段）/ Verifier（校验），Verifier 不通过不允许落库。
10. 阶段门槛与失效传播：每阶段写 `stage_records`（输入版本、产出 ID、检查结果、状态、确认人）；上游变更标下游 `stale`，不自动重做。
11. 桌面三端：macOS/Windows/Linux 安装包 + 冒烟清单（打开项目、播放、导出、崩溃恢复）。
12. 剪映草稿导出：按 ArcReel 的 `draft_content.json` 语义重写实现（不复制代码），先支持视频轨/字幕轨/BGM 轨/旁白轨。

### P2 剪辑深度

13. 关键帧（位置/缩放/旋转/不透明度）、曲线变速、真复合片段嵌套、J 真倒放、音画联动开关、主轨磁吸、预览轴、完整选区导出。
14. 字幕状态机：单击进入、双击编辑、blur/回车保存、Esc 取消、冲突提示、撤销栈。
15. 素材导入：本地/跨项目/资产包/剪映资产包；导入预览 → 确认入素材库 → 再拖时间线；有效性校验与缩略图。

---

## 6. 本轮已落地的代码与验收

### 6.1 新增/修改

- `server/database/migrations/0032_timeline_revisions.sql`：修订账本。
- `server/database/schema.ts`：`timelineRevisions` 映射。
- `server/modules/timeline/timeline.service.ts`：
  - `saveDocument` 同事务写快照；
  - `applyAgentOps` 冲突按片段判定，返回 `concurrentRevisions`；
  - `listRevisions / restoreRevision / issues`；
  - `diffChangedClientKeys` 计算普通保存的改动键。
- `server/modules/timeline/timeline.controller.ts`：`GET /issues`、`GET /revisions`、`POST /revisions/:revision/restore`。
- `shared/timeline-issues.ts`：体检纯函数 + Agent 文本。
- `server/modules/assistant/assistant.service.ts`：
  - 时间线上下文加入体检；
  - 一句话粗剪确定性兜底；
  - 目标时长解析。
- `test/unit/timeline-issues.spec.ts`：7 个断言。
- `server/modules/skills/skills.seed.ts`：分镜/视频提示词/角色参考图规范升级。

### 6.2 验收命令

```bash
npm run type:check
npm test
npm run build:client
```

### 6.3 诚实边界（本轮未完成）

- ASR 未接入：无字幕素材仍然只能靠镜头对白；“30 分钟通读”在无文本素材上不成立。
- Agent 仍是“一次性提案”，不是多轮工具调用；多 Agent 编排未落地。
- 剪映草稿导出未实现；只完成了修订/冲突/体检地基。
- 关键帧、曲线变速、复合片段、J 倒放、音画联动、主轨磁吸、预览轴、完整选区导出仍未完成。
- 桌面三端安装包未重打；CI 未验证。
- 剪映资产包兼容只做了 `.yimupack` 与部分剪映包解析，未做全量验收。

---

## 7. 参考来源

- 火宝：<https://github.com/chatfire-AI/huobao-drama>（CC BY-NC-SA 4.0）
- ToonFlow：<https://github.com/HBAI-Ltd/Toonflow-app>
- ArcReel：<https://github.com/ArcReel/ArcReel>（AGPL-3.0）
- 一幕仓库：<https://github.com/yimuhub/yimuduanju>

> 许可证提醒：以上仅用于方法与架构研究，未复制其代码。商业产品接入前需逐一确认许可证与二次分发义务。
