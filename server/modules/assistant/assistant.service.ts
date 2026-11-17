import { Injectable, Logger, BadRequestException, NotFoundException, Inject } from '@nestjs/common';
import type { Response } from 'express';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { asc, desc, eq } from 'drizzle-orm';
import {
  chatMessages,
  chatSessions,
  projects,
  shots,
} from '@server/database/schema';
import { ModelGatewayService } from '../generation/model-gateway.service';
import { TimelineService } from '../timeline/timeline.service';
import { describeTimelineForAgent } from '@shared/timeline-ops';
import { formatIssuesForAgent, scanTimelineIssues } from '@shared/timeline-issues';
import {
  buildTranscriptIndex,
  formatTranscriptForAgent,
  selectRoughCutRanges,
} from '@shared/transcript-index';
import type {
  ChatMessage,
  ChatSession,
  ChatSessionDetail,
  ChatAttachmentMeta,
  StreamChatRequest,
} from '@shared/api.interface';

const SYSTEM_PROMPT =
  '你是「一幕·YIMU AI 短剧创作平台」的创作助手，擅长短剧剧本、分镜、角色、场景、风格与配音建议。' +
  '回答使用简体中文，简洁实用，必要时分条列出。不要编造平台不存在的功能；涉及生成操作时引导用户使用平台内的确认按钮。' +
  '当用户在「新建作品」对话里描述创意时：先用 1-2 句确认关键信息（题材/时长/画风/主角），再给出一个可直接开拍的简短方案；' +
  '信息已经足够时不要反复追问，明确告诉用户可以点下方「确认创建」开始生产。' +
  '当对话属于已有项目时：结合项目当前阶段回答，指出下一步该确认什么；不要声称已经执行了未发生的生成操作。';

const TITLE_SYSTEM_PROMPT =
  '你是短剧作品的命名助手。根据用户描述的作品需求，起一个简洁、有画面感、适合做片名的中文标题。' +
  '要求：4-14 个汉字，不要书名号、引号、标点、序号或任何解释，只输出标题本身。';

/**
 * 对话确认卡协议（migration 0025，对标 zenstory pendingEdits）：
 * 项目会话中的助手若建议修改分镜数据，回复末尾用 ```yimu-action 围栏输出 JSON，
 * 前端作战室渲染确认卡，用户点「应用」才调真实 API。草稿会话（无项目）不注入。
 */
/**
 * 时间线动作协议：对话直接剪辑的执行契约。
 * 模型只负责「提案」，真正落库由 /timeline/agent-ops 在事务里完成；
 * 因此必须强调：只用给定 clientKey、必须带 baseVersion、不得自称已执行。
 */
const TIMELINE_ACTION_PROTOCOL = [
  '# 时间线剪辑动作协议',
  '优先级：只要请求涉及「时间线 / 成片 / 剪辑 / 压缩 / 删空白 / 拼接 / 字幕时间」，',
  '必须只输出 ```yimu-timeline 代码块，禁止改用 yimu-action 或 update_shot（改镜头 duration 不等于剪时间线）。',
  '当用户要求剪辑已产出的时间线（移动/修剪/分割/删除/字幕/变速/音量/建轨）时，',
  '回复末尾追加 ```yimu-timeline 代码块，内容是一批可执行动作：',
  '{"baseVersion":<当前版本号>,"summary":"一句话说明改了什么","ops":[{"op":"trim","target":{"clientKey":"..."},"edge":"right","deltaSec":-0.5}]}',
  '完整示例（照这个格式输出，不要改写字段名）：',
  '{"baseVersion":3,"summary":"第2镜剪短0.5秒并把字幕改成新台词","ops":[{"op":"trim","target":{"clientKey":"derived-v-s2"},"edge":"right","deltaSec":-0.5},{"op":"subtitle","target":{"clientKey":"derived-s-s2"},"text":"新台词"}]}',
  '可用 op：move(target,toStart,toLane?)、trim(target,edge,deltaSec)、split(target,atSec)、delete(targets[])、',
  'subtitle(target?,text,atSec?,durationSec?,style?)、speed(target,value)、volume(target,value)、lock(target,locked)、',
  'enable(target,enabled)、track(action,lane?,track,patch?)。',
  '粗剪/从长素材剪出目标时长时，必须使用 roughcut 一次成型：',
  '{"op":"roughcut","ranges":[{"start":12.4,"end":18.2,"label":"开场钩子"},{"start":42.0,"end":48.5,"label":"核心观点"}],"targetDurationSec":60}',
  'roughcut 会把区间内画面/音频/字幕一起切片并按顺序无空隙重排；ranges 用成片时间线的秒（不是源文件秒）。',
  '硬规则：target 只能使用上面清单里的 clientKey（不得编造、不得用 id）；一次最多 40 条；',
  '删除/批量改动前先用一句话说明影响；不确定用户意图时先问，不要输出代码块；',
  '不要声称已经改好——前端会展示 diff，用户点「应用」后才真正落库。',
].join('\n');

/**
 * 深度剪辑协议：用户只给一句目标时长（例如「剪一个 1 分钟宣传片」）时，
 * 模型必须通读全文转写索引，按语义选段，而不是截开头/中间。
 */
const DEEP_EDIT_PROTOCOL = [
  '# 深度剪辑（一句话粗剪）工作流',
  '当用户说「剪一个 N 秒/N 分钟的宣传片/预告/精华版/高光」或类似目标时长时，按下面顺序工作：',
  '1. 先通读下面「全文转写索引」的全部句子；索引时间码是成片毫秒，不得跳过中后段。',
  '2. 先在回复里用 2–4 句说明你读到的内容结构（开场/冲突/转折/结论），再给选段理由；',
  '3. 按语义重要性选 3–12 个区间，合并成一次 roughcut；总时长控制在目标 ±10%；',
  '4. 选段要覆盖开场钩子、核心信息、情绪高点、结尾落点；禁止只取开头或中间一段；',
  '5. 不要把相邻区间剪碎；同一句话不要重复剪进两次；区间端点尽量落在句子边界；',
  '6. 如果全文总时长不足目标，明确说明「素材不足」，roughcut 保留全片，不要硬凑；',
  '7. 输出一个 ```yimu-timeline 代码块，baseVersion 用当前版本，summary 写「目标 60s → 实际 58.5s，选段依据…」。',
  '8. 索引为空时不要瞎编时间码：提示用户先补字幕/对白或接入 ASR。',
].join('\n');

const PROJECT_ACTION_PROTOCOL = [
  '# 变更建议输出协议',
  '当对话明确建议修改某个分镜（提示词/对白/景别/运镜等）时，回复末尾追加 ```yimu-action 代码块：',
  '{"actions":[{"action":"update_shot","targetId":"<镜头 id>","summary":"一句话说明","patch":{"visualPrompt":"新提示词"}}]}',
  'patch 只允许 subject/action/emotion/dialogue/visualPrompt/negativePrompt/subtitleText/shotSize/cameraAngle/lens/movement/duration；',
  '无具体镜头 id 或用户没有要求修改时不要输出该代码块。',
].join('\n');

/** 上下文预算：最近 16 条消息、单条 2000 字、合计约 12000 字 */
const CONTEXT_MESSAGES = 16;
const CONTEXT_MSG_CHARS = 2000;
const CONTEXT_TOTAL_CHARS = 12000;

/** 模型输出可能带解释/引号，收敛成一行干净片名；不像片名则返回空串交给兜底 */
function sanitizeTitle(raw: string): string {
  const line = raw
    .split(/\n+/)
    .map((l) => l.trim())
    .find(Boolean) ?? '';
  const cleaned = line
    .replace(/^(标题|作品名|剧名|名称)[：:\s]*/g, '')
    .replace(/^[《「“"'【\s]+/g, '')
    .replace(/[》」”"'】\s]+$/g, '')
    .replace(/[。！!？?，,；;：:]+$/g, '')
    .trim();
  return cleaned.length >= 2 && cleaned.length <= 24 ? cleaned : '';
}

/**
 * 模型不可用时的兜底取名：去掉「做一部 / 90 秒」这类口语前缀，
 * 取第一个意群，避免把整句需求原样塞进标题。
 */
function fallbackTitle(text: string): string {
  const cleaned = text
    .replace(/【[^】]*】/g, ' ')
    .replace(/^(帮我|请|我想|我要|想要|来一个|做一个|做一部|拍一个|拍一部|生成|创作|制作)[\s，,：:]*/g, '')
    .replace(/\d+\s*(秒|s|分钟|min)\s*(一集|每集)?/gi, ' ')
    .replace(/[，,。.；;！!？?、\n\r]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const first = cleaned.split(' ').find(Boolean) ?? '';
  const title = first.slice(0, 16).trim();
  return title || '未命名作品';
}

/** 从自然语言里提取目标时长（秒）；识别不了返回 null，不瞎猜。 */
function parseTargetSec(text: string): number | null {
  const cn: Record<string, number> = {
    一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
    十五: 15, 二十: 20, 三十: 30, 四十: 40, 五十: 50, 六十: 60, 九十: 90,
  };
  const num = (raw: string): number => {
    if (/^\d+(?:\.\d+)?$/.test(raw)) return Number(raw);
    return cn[raw] ?? NaN;
  };
  const variant = text.replace(/分钟|分/g, '分钟').replace(/秒钟|秒/g, '秒');
  if (/半分钟/.test(text)) return 30;
  const half = /(\d+(?:\.\d+)?|[一二两三四五六七八九十]+)\s*分半/.exec(text);
  if (half) {
    const v = num(half[1]);
    if (Number.isFinite(v)) return Math.round(v * 60 + 30);
  }
  let m = /(\d+(?:\.\d+)?|[一二两三四五六七八九十]+)\s*(分钟)/.exec(variant);
  if (m) {
    const v = num(m[1]);
    if (Number.isFinite(v)) return Math.round(v * 60);
  }
  m = /(\d+(?:\.\d+)?|[一二两三四五六七八九十]+)\s*(秒|s)/i.exec(variant);
  if (m) {
    const v = num(m[1]);
    if (Number.isFinite(v)) return Math.round(v);
  }
  return null;
}

interface ContextRow {
  role: string;
  content: string;
  metadata: unknown;
}

/**
 * 创作助手：会话落库 + 流式回复。
 * - 草稿会话（projectId 为空）：新建作品时的对话，创建项目后回填 projectId
 * - 项目会话：进入项目即恢复历史，所有消息可追溯
 */
@Injectable()
export class AssistantService {
  private readonly logger = new Logger(AssistantService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    private readonly modelGateway: ModelGatewayService,
    private readonly timelineService: TimelineService,
  ) {}

  private mapSession(row: typeof chatSessions.$inferSelect): ChatSession {
    return {
      id: row.id,
      projectId: row.projectId ?? null,
      title: row.title ?? null,
      kind: row.kind === 'project' ? 'project' : 'draft',
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private mapMessage(row: typeof chatMessages.$inferSelect): ChatMessage {
    return {
      id: row.id,
      sessionId: row.sessionId,
      role: row.role === 'user' ? 'user' : row.role === 'system' ? 'system' : 'agent',
      content: row.content,
      attachments: Array.isArray(row.attachments)
        ? (row.attachments as ChatAttachmentMeta[])
        : [],
      createdAt: row.createdAt.toISOString(),
      metadata: (row.metadata as ChatMessage['metadata']) ?? null,
    };
  }

  /** 兼容旧版无会话的全局问答；作战室会话绑定项目时传 projectId 注入上下文与确认卡协议 */
  async chat(message: string, projectId?: string): Promise<{ reply: string }> {
    try {
      // 项目会话：注入确认卡协议（migration 0025）与项目上下文；
      // Agent 要拿到真实镜头 id 才能给出合法的 update_shot targetId
      const shotsContext = projectId ? await this.shotContext(projectId) : '';
      const reply = await this.modelGateway.generateText({
        prompt: message,
        systemPrompt: [
          SYSTEM_PROMPT,
          await this.timelineContext(projectId),
          projectId ? PROJECT_ACTION_PROTOCOL : '',
          await this.projectContext(projectId),
          shotsContext,
        ]
          .filter(Boolean)
          .join('\n'),
      });
      return { reply };
    } catch (e) {
      const msg = (e as Error)?.message ?? '未知错误';
      this.logger.warn(`全局助手调用失败: ${msg}`);
      throw new BadRequestException(`AI 助手暂不可用：${msg}`);
    }
  }

  /** 可用镜头清单（确认卡协议的 targetId 取值来源；控制在 ~1200 字内） */
  private async shotContext(projectId: string): Promise<string> {
    const rows = await this.db
      .select({
        id: shots.id,
        shotNumber: shots.shotNumber,
        subject: shots.subject,
        visualPrompt: shots.visualPrompt,
      })
      .from(shots)
      .where(eq(shots.projectId, projectId))
      .orderBy(asc(shots.shotNumber))
      .limit(30);
    if (rows.length === 0) return '';
    const lines = rows.map(
      (s) => `- 镜 ${s.shotNumber}｜id=${s.id}｜${(s.subject ?? s.visualPrompt ?? '').slice(0, 24)}`,
    );
    return `可用镜头（update_shot 的 targetId 必须取自这里）：\n${lines.join('\n')}`;
  }

  /**
   * 创建会话。传 projectId 时复用该项目最近一条会话，
   * 避免每次进入项目都新开一条、历史被拆散。
   */
  async createSession(input: { projectId?: string; title?: string }): Promise<ChatSession> {
    if (input.projectId) {
      const existing = await this.db
        .select()
        .from(chatSessions)
        .where(eq(chatSessions.projectId, input.projectId))
        .orderBy(desc(chatSessions.createdAt))
        .limit(1);
      if (existing[0]) return this.mapSession(existing[0]);
      const rows = await this.db
        .insert(chatSessions)
        .values({
          projectId: input.projectId,
          title: input.title?.slice(0, 255) ?? null,
          kind: 'project',
        })
        .returning();
      return this.mapSession(rows[0]);
    }
    const rows = await this.db
      .insert(chatSessions)
      .values({ title: input.title?.slice(0, 255) ?? null, kind: 'draft' })
      .returning();
    return this.mapSession(rows[0]);
  }

  /** 手动改写的标题落库，草稿关掉再打开仍保留 */
  async updateTitle(id: string, title: string): Promise<ChatSession> {
    const rows = await this.db
      .update(chatSessions)
      .set({ title: title.trim().slice(0, 255), updatedAt: new Date() })
      .where(eq(chatSessions.id, id))
      .returning();
    if (!rows[0]) throw new NotFoundException('会话不存在');
    return this.mapSession(rows[0]);
  }

  /**
   * 按对话内容生成作品名。会话存在时同步写回标题，
   * 左侧列表和项目名保持一致；模型失败则走规则兜底，不阻断创建。
   */
  async suggestTitle(text: string, sessionId?: string): Promise<string> {
    const source = text.trim().slice(0, 4000);
    if (!source) throw new BadRequestException('内容不能为空');
    let title = '';
    try {
      const raw = await this.modelGateway.generateText({
        prompt: source,
        systemPrompt: TITLE_SYSTEM_PROMPT,
        temperature: 0.8,
        maxTokens: 40,
      });
      title = sanitizeTitle(raw);
    } catch (e) {
      this.logger.warn(`AI 取名失败，使用规则兜底: ${(e as Error)?.message ?? '未知错误'}`);
    }
    if (!title) title = fallbackTitle(source);
    if (sessionId) {
      try {
        await this.db
          .update(chatSessions)
          .set({ title, updatedAt: new Date() })
          .where(eq(chatSessions.id, sessionId));
      } catch (e) {
        this.logger.warn(`会话标题回写失败: ${(e as Error)?.message ?? '未知错误'}`);
      }
    }
    return title;
  }

  async listSessions(projectId?: string): Promise<ChatSession[]> {
    const rows = projectId
      ? await this.db
          .select()
          .from(chatSessions)
          .where(eq(chatSessions.projectId, projectId))
          .orderBy(desc(chatSessions.createdAt))
      : await this.db.select().from(chatSessions).orderBy(desc(chatSessions.createdAt)).limit(50);
    return rows.map((r) => this.mapSession(r));
  }

  async getSessionDetail(id: string): Promise<ChatSessionDetail> {
    const rows = await this.db
      .select()
      .from(chatSessions)
      .where(eq(chatSessions.id, id))
      .limit(1);
    if (!rows[0]) throw new NotFoundException('对话不存在');
    const msgs = await this.db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.sessionId, id))
      .orderBy(asc(chatMessages.createdAt));
    return { session: this.mapSession(rows[0]), messages: msgs.map((m) => this.mapMessage(m)) };
  }

  /** 项目创建成功：把草稿会话挂到项目上，标题同步为作品名 */
  async linkProject(id: string, projectId: string, title?: string): Promise<ChatSession> {
    const rows = await this.db
      .update(chatSessions)
      .set({
        projectId,
        title: title?.slice(0, 255) ?? null,
        kind: 'project',
        updatedAt: new Date(),
      })
      .where(eq(chatSessions.id, id))
      .returning();
    if (!rows[0]) throw new NotFoundException('对话不存在');
    return this.mapSession(rows[0]);
  }

  /**
   * 时间线上下文 + 剪辑动作协议。EDL 走 TimelineService.getDocument，
   * 未保存过工程的项目也能拿到「从镜头派生」的真实片段与 clientKey。
   */
  private async timelineContext(projectId?: string | null): Promise<string> {
    if (!projectId) return '';
    try {
      const doc = await this.timelineService.getDocument(projectId);
      // 全文转写索引：字幕片段优先，缺字幕时用镜头对白补；时间码是「成片时间线毫秒」。
      // 30 分钟素材也能一次读完：超过 24000 字符时才做均匀抽样，并在索引尾部明确标注。
      const shotRows = await this.db
        .select({
          id: shots.id,
          dialogue: shots.dialogue,
          subtitleText: shots.subtitleText,
        })
        .from(shots)
        .where(eq(shots.projectId, projectId));
      const index = buildTranscriptIndex(doc, shotRows);
      const transcript = formatTranscriptForAgent(index, 22000, 900);
      return [
        describeTimelineForAgent(doc, 60),
        formatIssuesForAgent(scanTimelineIssues(doc)),
        DEEP_EDIT_PROTOCOL,
        transcript,
        TIMELINE_ACTION_PROTOCOL,
      ].join('\n\n');
    } catch {
      return [DEEP_EDIT_PROTOCOL, TIMELINE_ACTION_PROTOCOL].join('\n\n');
    }
  }

  /**
   * 一句话粗剪的确定性兜底。
   *
   * 模型偶尔只给解释、不给 yimu-timeline 代码块，或直接调用失败；这时不能
   * 让用户“说了也白说”。这里用同一份转写索引做抽取式选段，产出与模型
   * 完全同构的提案，前端照常出确认卡、照常可应用/撤销。
   */
  private async deepEditFallback(
    projectId: string,
    userText: string,
    reply: string,
  ): Promise<string> {
    if (/```yimu-timeline/.test(reply)) return reply;
    if (!/宣传片|预告|精华|高光|混剪|集锦|剪成|剪一个|压缩|缩短|精简/.test(userText)) return reply;
    const targetSec = parseTargetSec(userText);
    if (!targetSec) return reply;
    try {
      const doc = await this.timelineService.getDocument(projectId);
      const shotRows = await this.db
        .select({ id: shots.id, dialogue: shots.dialogue, subtitleText: shots.subtitleText })
        .from(shots)
        .where(eq(shots.projectId, projectId));
      const index = buildTranscriptIndex(doc, shotRows);
      if (index.cues.length === 0) return reply;
      const ranges = selectRoughCutRanges(index, { targetSec, keepHook: true });
      if (ranges.length === 0) return reply;
      const actual = ranges.reduce((n, r) => n + (r.end - r.start), 0);
      const proposal = {
        baseVersion: doc.version ?? 0,
        summary: `目标 ${targetSec}s → 实际 ${actual.toFixed(1)}s；按全文 ${index.cues.length} 句的语义权重选段（确定性兜底）`,
        ops: [
          {
            op: 'roughcut',
            ranges: ranges.map((r) => ({
              start: Math.round(r.start * 1000) / 1000,
              end: Math.round(r.end * 1000) / 1000,
              label: r.label,
            })),
            targetDurationSec: targetSec,
          },
        ],
      };
      return (
        reply.trimEnd() +
        '\n\n（模型未给出可执行动作，已按全文转写自动生成一版粗剪提案，可直接应用或让 Agent 调整）\n' +
        '```yimu-timeline\n' +
        JSON.stringify(proposal) +
        '\n```'
      );
    } catch {
      return reply;
    }
  }

  private async projectContext(projectId?: string | null): Promise<string> {
    if (!projectId) return '';
    const rows = await this.db
      .select({
        title: projects.title,
        status: projects.status,
        metadata: projects.metadata,
        durationSeconds: projects.durationSeconds,
        artStyle: projects.artStyle,
        genre: projects.genre,
      })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    const p = rows[0];
    if (!p) return '';
    const pipeline = (p.metadata as { pipeline?: { approvals?: Record<string, string> } } | null)
      ?.pipeline;
    const approvals = pipeline?.approvals ?? {};
    const gateText =
      approvals.final
        ? '成片门已通过'
        : approvals.storyboard
          ? '已过剧本/分镜门，正在生成资产与成片'
          : approvals.script
            ? '剧本门已通过，等待分镜确认'
            : '剧本阶段，等待剧本生成/确认';
    return (
      `当前项目《${p.title}》：状态 ${p.status}，时长 ${p.durationSeconds ?? 60} 秒，` +
      `画风 ${p.artStyle ?? 'realistic'}${p.genre ? `，题材 ${p.genre}` : ''}；${gateText}。`
    );
  }

  /** 组装带历史的提示词：最近 N 条对话 + 项目阶段 + 附件正文 */
  private buildPrompt(
    messages: ContextRow[],
    latestUserText: string,
    attachments: StreamChatRequest['attachments'],
  ): string {
    const recent = messages.slice(-CONTEXT_MESSAGES);
    let budget = CONTEXT_TOTAL_CHARS;
    const lines: string[] = [];
    for (let i = recent.length - 1; i >= 0; i -= 1) {
      const m = recent[i];
      const who = m.role === 'user' ? '用户' : '助手';
      // 历史附件正文随消息保存，重新提问时仍可被模型读到
      const meta = (m.metadata ?? {}) as {
        attachments?: { name?: string; text?: string }[];
      };
      const attachText = (meta.attachments ?? [])
        .filter((a) => typeof a.text === 'string' && a.text.trim())
        .map((a) => `【附件：${a.name ?? '附件'}】${(a.text ?? '').slice(0, 2000)}`)
        .join('\n');
      const body = `${m.content.slice(0, CONTEXT_MSG_CHARS)}${attachText ? `\n${attachText}` : ''}`;
      if (body.length + who.length > budget) break;
      budget -= body.length + who.length;
      lines.unshift(`${who}：${body}`);
    }
    const attachBlock = (attachments ?? [])
      .filter((a) => typeof a.text === 'string' && a.text.trim())
      .map((a) => `【附件：${a.name}】\n${(a.text ?? '').slice(0, 20000)}`)
      .join('\n\n');
    return [
      lines.length > 0 ? `对话历史：\n${lines.join('\n')}` : '',
      `用户最新消息：${latestUserText}`,
      attachBlock ? `用户上传的附件内容：\n${attachBlock}` : '',
    ]
      .filter(Boolean)
      .join('\n\n');
  }

  /**
   * 流式回复（SSE）：先落用户消息，再逐段写 data: {delta}，结束后落助手消息。
   * 客户端断开时保留已生成的部分内容，metadata.aborted = true。
   */
  async streamMessage(
    sessionId: string,
    body: StreamChatRequest,
    res: Response,
    abortSignal?: AbortSignal,
  ): Promise<void> {
    const detail = await this.getSessionDetail(sessionId);
    // 上限 10 分钟，防止客户端异常断开后上游请求永久挂住
    const timeout = AbortSignal.timeout(600_000);
    const signal = abortSignal
      ? (AbortSignal as unknown as { any?: (s: AbortSignal[]) => AbortSignal }).any?.([
          abortSignal,
          timeout,
        ]) ?? timeout
      : timeout;

    const rawText = (body.message ?? '').trim();
    const attachments = (body.attachments ?? []).slice(0, 5);
    if (!rawText && attachments.length === 0) throw new BadRequestException('消息不能为空');
    // 只传附件时用附件名补全正文，避免出现空消息气泡
    const userText =
      rawText || `（已上传附件：${attachments.map((a) => String(a.name ?? '附件')).join('、')}）`;
    const attachMeta: ChatAttachmentMeta[] = attachments.map((a) => ({
      name: String(a.name ?? '附件').slice(0, 120),
      size: typeof a.size === 'number' ? a.size : undefined,
      chars: typeof a.text === 'string' ? a.text.length : 0,
    }));
    // 附件正文只进模型上下文与 metadata，不进消息正文，避免历史列表被长文淹没
    const userRows = await this.db
      .insert(chatMessages)
      .values({
        sessionId,
        role: 'user',
        content: userText,
        attachments: attachMeta,
        metadata: { attachments: attachments.map((a) => ({ name: a.name, text: a.text })) },
      })
      .returning();
    const userMsg = this.mapMessage(userRows[0]);

    // 草稿会话首条消息顺带兜底命名，列表里可辨认；精确片名由前端 AI 取名接口回填
    if (!detail.session.title) {
      await this.db
        .update(chatSessions)
        .set({ title: fallbackTitle(userText), updatedAt: new Date() })
        .where(eq(chatSessions.id, sessionId));
    }

    const write = (frame: string) => {
      if (!res.writableEnded) res.write(frame);
    };
    write(`event: user\ndata: ${JSON.stringify({ message: userMsg })}\n\n`);

    // 上下文用原始行：附件正文存在 metadata 里，不进消息正文
    const contextRows = await this.db
      .select({
        role: chatMessages.role,
        content: chatMessages.content,
        metadata: chatMessages.metadata,
      })
      .from(chatMessages)
      .where(eq(chatMessages.sessionId, sessionId))
      .orderBy(asc(chatMessages.createdAt));

    const prompt = this.buildPrompt(contextRows.slice(0, -1), userText, attachments);
    const systemPrompt = [
      SYSTEM_PROMPT,
      // 确认卡协议只在项目会话生效（草稿会话没有可改对象，注入只会诱导编造 id）
      detail.session.projectId ? PROJECT_ACTION_PROTOCOL : '',
      await this.projectContext(detail.session.projectId),
      await this.timelineContext(detail.session.projectId),
    ]
      .filter(Boolean)
      .join('\n');

    let text = '';
    let model = '';
    try {
      const result = await this.modelGateway.streamText(
        { prompt, systemPrompt, temperature: 0.7 },
        (delta) => {
          text += delta;
          write(`data: ${JSON.stringify({ delta })}\n\n`);
        },
        { signal },
      );
      text = result.text || text;
      model = result.model;
    } catch (e) {
      const message = (e as Error)?.message ?? '未知错误';
      this.logger.warn(`对话流式回复失败: ${message}`);
      if (!text) {
        const fallback =
          '抱歉，AI 回复失败：' +
          message +
          '\n可以重发一次；如果持续失败，请到「设置」检查文本模型与 Key。';
        text = fallback;
        write(`data: ${JSON.stringify({ delta: fallback })}\n\n`);
      }
    }

    // 模型只给解释、没给可执行动作时，用确定性选段补一版粗剪提案；
    // 追加内容以 delta 推给前端，保证流式气泡与落库正文一致。
    if (detail.session.projectId && text) {
      const enhanced = await this.deepEditFallback(detail.session.projectId, userText, text);
      if (enhanced !== text) {
        const suffix = enhanced.slice(text.length);
        text = enhanced;
        write(`data: ${JSON.stringify({ delta: suffix })}\n\n`);
      }
    }

    const agentRows = await this.db
      .insert(chatMessages)
      .values({
        sessionId,
        role: 'agent',
        content: text,
        metadata: { model: model || undefined },
      })
      .returning();
    await this.db
      .update(chatSessions)
      .set({ updatedAt: new Date() })
      .where(eq(chatSessions.id, sessionId));

    write(
      `event: done\ndata: ${JSON.stringify({ message: this.mapMessage(agentRows[0]) })}\n\n`,
    );
    if (!res.writableEnded) res.end();
  }
}