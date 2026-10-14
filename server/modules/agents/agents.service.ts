import { Injectable, Inject, Logger, BadRequestException } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { agentMessages, projects, scenes, shots, characters } from '@server/database/schema';
import { eq, desc, and, count } from 'drizzle-orm';
import type {
  AgentMessage,
  SendAgentMessageRequest,
  AgentRelatedObject,
} from '@shared/api.interface';
import { ModelGatewayService } from '../generation/model-gateway.service';

@Injectable()
export class AgentsService {
  private readonly logger = new Logger(AgentsService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    private readonly modelGateway: ModelGatewayService,
  ) {}

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
      const reply = await this.modelGateway.generateText({
        prompt: dto.content,
        systemPrompt:
          '你是「一木·YIMU AI 视频创作平台」项目智能体，用简体中文回答，简洁实用。' +
          '当前项目上下文如下，回答要结合项目实际数据，不得编造不存在的分镜/角色/资产：\n' +
          context,
      });
      const assistantRows = await this.db
        .insert(agentMessages)
        .values({
          projectId,
          role: 'assistant',
          content: reply,
          agentName: dto.agentName ?? '一木·YIMU AI 视频创作平台助手',
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
