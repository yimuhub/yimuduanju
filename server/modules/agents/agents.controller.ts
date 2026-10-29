import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  ParseUUIDPipe,
} from '@nestjs/common';
import type {
  AgentMessage,
  SendAgentMessageRequest,
} from '@shared/api.interface';
import { AgentsService } from './agents.service';

@Controller('api')
export class AgentsController {
  constructor(private readonly agentsService: AgentsService) {}

  /** Agent 注册表（全局）：前端 Agent 列表 / 画布 @Agent 数据源 */
  @Get('agents/registry')
  async listRegistry() {
    return this.agentsService.listRegistry();
  }

  @Get('projects/:projectId/agents/messages')
  async listMessages(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query('limit') limit?: string,
  ): Promise<AgentMessage[]> {
    return this.agentsService.listMessages(projectId, limit ? parseInt(limit, 10) : undefined);
  }

  @Post('projects/:projectId/agents/messages')
  async sendMessage(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() body: SendAgentMessageRequest,
  ): Promise<AgentMessage> {
    return this.agentsService.sendMessage(projectId, body);
  }

  @Delete('projects/:projectId/agents/messages')
  async clearMessages(
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ): Promise<void> {
    return this.agentsService.clearMessages(projectId);
  }
}
