import { Injectable, Inject, Logger, BadRequestException, OnModuleInit } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { agentMessages, agentRegistry, projects, scenes, shots, characters } from '@server/database/schema';
import { eq, desc, and, count, asc } from 'drizzle-orm';
import type {
  AgentMessage,
  SendAgentMessageRequest,
  AgentRelatedObject,
} from '@shared/api.interface';
import { ModelGatewayService } from '../generation/model-gateway.service';
import { BUILTIN_AGENTS } from './agents.registry';
import { SkillsService } from '../skills/skills.service';

/**
 * 对话确认卡协议（migration 0025，对标 zenstory pendingEdits）：
 * Agent 建议修改项目数据时，在回复末尾用 ```yimu-action 围栏输出结构化 JSON，
 * 由前端解析渲染成确认卡，用户点「应用」才调用真实 API——对话改意，面板落地。
 */
const AGENT_ACTION_PROTOCOL = [
  '# 变更建议输出协议（重要）',
  '当你建议修改项目数据（如改某镜的提示词/对白/景别/运镜、改写剧本）时：',
  '回复正文先用简短文字说明为什么这样改，然后在回复**末尾**追加一个 ```yimu-action 代码块，',
  '内容为 JSON，格式（二选一）：',
  '① 改分镜：{"actions":[{"action":"update_shot","targetId":"<上面给出的镜头 id>","summary":"一句话说明","patch":{"visualPrompt":"新提示词"}}]}',
  '② 改剧本：{"actions":[{"action":"update_script","summary":"一句话说明","script":"完整的新剧本文本"}]}',
  '规则：targetId 必须取自「可用镜头」清单里的真实 id，禁止编造；patch 只允许这些字段：',
  'subject/action/emotion/dialogue/visualPrompt/negativePrompt/subtitleText/shotSize/cameraAngle/lens/movement/duration；',
  '用户没有要求修改时不要输出该代码块；一次建议可以包含多个 update_shot（放在 actions 数组里）。',
].join('\n');

@Injectable()
export class AgentsService implements OnModuleInit {
  private readonly logger = new Logger(AgentsService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    private readonly modelGateway: ModelGatewayService,
    private readonly skillsService: SkillsService,
  ) {}

  /** 注册表补种：内置 Agent 只补缺不覆盖（用户改过的不重置） */
  async onModuleInit() {
    try {
      const existing = await this.db.select({ name: agentRegistry.name }).from(agentRegistry);
      const have = new Set(existing.map((r) => r.name));
      const missing = BUILTIN_AGENTS.filter((a) => !have.has(a.name));
      if (missing.length > 0) {
        // onConflictDoNothing：并发启动竞态下撞 name 唯一约束不再整批回滚
        const inserted = await this.db
          .insert(agentRegistry)
          .values(
            missing.map((a) => ({
              name: a.name,
              avatar: a.avatar,
              persona: a.persona,
              skillSlugs: a.skillSlugs,
              tools: a.tools,
              sort: a.sort,
              source: 'builtin' as const,
            })),
          )
          .onConflictDoNothing({ target: agentRegistry.name })
          .returning({ id: agentRegistry.id });
        if (inserted.length > 0) {
          this.logger.log(`Agent 注册表补种 ${inserted.length} 个内置智能体`);
        }
      }
    } catch (e) {
      this.logger.warn(`Agent 补种跳过：${(e as Error).message}`);
    }
  }

  /** Agent 注册表（前端 Agent 列表 / 画布 @Agent 的唯一数据源） */
  async listRegistry() {
    return this.db
      .select()
      .from(agentRegistry)
      .where(eq(agentRegistry.enabled, true))
      .orderBy(asc(agentRegistry.sort));
  }

  async listMessages(projectId: string, limit?: number): Promise<AgentMessage[]> {
    const rows = await this.db
      .select()
      .from(agentMessages)
      .where(eq(agentMessages.projectId, projectId))
      .orderBy(desc(agentMessages.createdAt))
      .limit(limit ?? 100);

    // 倒序返回（最新在最后）
    const sorted = [...rows].reverse();
    return sorted.map((r) => this.mapMessage(r));
  }

  async sendMessage(
    projectId: string,
    dto: SendAgentMessageRequest,
  ): Promise<AgentMessage> {
    // 1. 保存用户消息
    const userRows = await this.db
      .insert(agentMessages)
      .values({
        projectId,
        role: 'user',
        content: dto.content,
        agentName: dto.agentName,
      })
      .returning();

    // 2. 真实 LLM 回复（注入项目上下文；无 Key 时如实报错，用户消息已保留）
    try {
      const context = await this.buildProjectContext(projectId, dto.agentName);
      // 注册表注入：按 agentName 取人设（persona）+ 绑定技能包正文；未匹配到注册表则用通用兜底
      const reg = dto.agentName
        ? await this.db.select().from(agentRegistry).where(eq(agentRegistry.name, dto.agentName)).limit(1)
        : [];
      const agent = reg[0];
      const skillText = agent
        ? await this.skillsService.getBodiesBySlugs((agent.skillSlugs as string[]) ?? [])
        : '';
      const reply = await this.modelGateway.generateText({
        prompt: dto.content,
        systemPrompt:
          (agent?.persona
            ? `${agent.persona}\n\n`
            : '你是「一幕·YIMU AI 短剧创作平台」项目智能体，用简体中文回答，简洁实用。') +
          '回答要结合项目实际数据，不得编造不存在的分镜/角色/资产。\n' +
          (skillText ? `# 生效技能包\n${skillText}\n` : '') +
          AGENT_ACTION_PROTOCOL +
          `\n# 项目上下文\n${context}`,
      });
      const assistantRows = await this.db
        .insert(agentMessages)
        .values({
          projectId,
          role: 'assistant',
          content: reply,
          agentName: dto.agentName ?? '一幕·YIMU AI 短剧创作平台助手',
          relatedObjects: [],
        })
        .returning();
      return this.mapMessage(assistantRows[0]);
    } catch (e) {
      const msg = (e as Error)?.message ?? '未知错误';
      this.logger.warn(`项目助手调用失败: ${msg}`);
      throw new BadRequestException(`AI 助手暂不可用：${msg}`);
    }
  }

  /** 项目上下文摘要（标题/状态/规模/剧本节选 + 可用镜头清单），控制在 ~1500 字内 */
  private async buildProjectContext(projectId: string, agentName?: string): Promise<string> {
    const [projRows, sceneCount, shotCount, charRows, shotRows] = await Promise.all([
      this.db
        .select({
          title: projects.title,
          status: projects.status,
          scriptText: projects.scriptText,
        })
        .from(projects)
        .where(eq(projects.id, projectId))
        .limit(1),
      this.db
        .select({ count: count() })
        .from(scenes)
        .where(eq(scenes.projectId, projectId)),
      this.db
        .select({ count: count() })
        .from(shots)
        .where(eq(shots.projectId, projectId)),
      this.db
        .select({ name: characters.name })
        .from(characters)
        .where(eq(characters.projectId, projectId))
        .limit(10),
      // 确认卡协议（migration 0025）：给 Agent 真实镜头 id，update_shot 才有合法 targetId
      this.db
        .select({
          id: shots.id,
          shotNumber: shots.shotNumber,
          subject: shots.subject,
          visualPrompt: shots.visualPrompt,
          dialogue: shots.dialogue,
        })
        .from(shots)
        .where(eq(shots.projectId, projectId))
        .orderBy(asc(shots.shotNumber))
        .limit(30),
    ]);
    const p = projRows[0];
    const lines = [
      `项目：${p?.title ?? '未知'}（状态 ${p?.status ?? '未知'}）`,
      `规模：${Number(sceneCount[0]?.count ?? 0)} 场 / ${Number(shotCount[0]?.count ?? 0)} 镜`,
      `角色：${charRows.map((c) => c.name).join('、') || '暂无'}`,
      `当前智能体：${agentName ?? '通用'}`,
    ];
    if (shotRows.length > 0) {
      const shotLines = shotRows.map(
        (s) =>
          `- 镜 ${s.shotNumber}｜id=${s.id}｜${(s.subject ?? s.visualPrompt ?? '').slice(0, 24)}` +
          (s.dialogue ? `｜台词「${s.dialogue.slice(0, 16)}」` : ''),
      );
      lines.push(`可用镜头（update_shot 的 targetId 必须取自这里）：\n${shotLines.join('\n')}`);
    }
    const script = (p?.scriptText ?? '').trim().slice(0, 400);
    if (script) lines.push(`剧本节选：${script}`);
    return lines.join('\n');
  }

  /** 清空项目消息，返回删除条数（前端提示「已清空 N 条」） */
  async clearMessages(projectId: string): Promise<{ cleared: number }> {
    const rows = await this.db
      .delete(agentMessages)
      .where(eq(agentMessages.projectId, projectId))
      .returning({ id: agentMessages.id });
    return { cleared: rows.length };
  }

  private mapMessage(row: typeof agentMessages.$inferSelect): AgentMessage {
    return {
      id: row.id,
      projectId: row.projectId ?? undefined,
      role: row.role as 'user' | 'assistant' | 'system',
      content: row.content,
      agentName: row.agentName ?? undefined,
      relatedObjects: (row.relatedObjects as AgentRelatedObject[]) ?? undefined,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
