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
        await this.db.insert(agentRegistry).values(
          missing.map((a) => ({
            name: a.name,
            avatar: a.avatar,
            persona: a.persona,
            skillSlugs: a.skillSlugs,
            tools: a.tools,
            sort: a.sort,
            source: 'builtin' as const,
          })),
        );
        this.logger.log(`Agent 注册表补种 ${missing.length} 个内置智能体`);
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
          `# 项目上下文\n${context}`,
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

  /** 项目上下文摘要（标题/状态/规模/剧本节选），控制在 ~800 字内 */
  private async buildProjectContext(projectId: string, agentName?: string): Promise<string> {
    const [projRows, sceneCount, shotCount, charRows] = await Promise.all([
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
    ]);
    const p = projRows[0];
    const lines = [
      `项目：${p?.title ?? '未知'}（状态 ${p?.status ?? '未知'}）`,
      `规模：${Number(sceneCount[0]?.count ?? 0)} 场 / ${Number(shotCount[0]?.count ?? 0)} 镜`,
      `角色：${charRows.map((c) => c.name).join('、') || '暂无'}`,
      `当前智能体：${agentName ?? '通用'}`,
    ];
    const script = (p?.scriptText ?? '').trim().slice(0, 500);
    if (script) lines.push(`剧本节选：${script}`);
    return lines.join('\n');
  }

  async clearMessages(projectId: string): Promise<void> {
    await this.db
      .delete(agentMessages)
      .where(eq(agentMessages.projectId, projectId));
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
