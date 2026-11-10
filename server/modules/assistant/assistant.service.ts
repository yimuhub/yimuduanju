import { Injectable, Logger, BadRequestException, NotFoundException, Inject } from '@nestjs/common';
import type { Response } from 'express';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { asc, desc, eq } from 'drizzle-orm';
import {
  chatMessages,
  chatSessions,
  projects,
} from '@server/database/schema';
import { ModelGatewayService } from '../generation/model-gateway.service';
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

  /** 兼容旧版无会话的全局问答 */
  async chat(message: string): Promise<{ reply: string }> {
    try {
      const reply = await this.modelGateway.generateText({
        prompt: message,
        systemPrompt: SYSTEM_PROMPT,
      });
      return { reply };
    } catch (e) {
      const msg = (e as Error)?.message ?? '未知错误';
      this.logger.warn(`全局助手调用失败: ${msg}`);
      throw new BadRequestException(`AI 助手暂不可用：${msg}`);
    }
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
    const systemPrompt = [SYSTEM_PROMPT, await this.projectContext(detail.session.projectId)]
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