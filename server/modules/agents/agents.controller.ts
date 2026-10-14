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

@Controller('api/projects/:projectId/agents')
export class AgentsController {
  constructor(private readonly agentsService: AgentsService) {}

  @Get('messages')
  async listMessages(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query('limit') limit?: string,
  ): Promise<AgentMessage[]> {
    return this.agentsService.listMessages(projectId, limit ? parseInt(limit, 10) : undefined);
  }

  @Post('messages')
  async sendMessage(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() body: SendAgentMessageRequest,
  ): Promise<AgentMessage> {
    return this.agentsService.sendMessage(projectId, body);
  }

  @Delete('messages')
  async clearMessages(
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ): Promise<void> {
    return this.agentsService.clearMessages(projectId);
  }
}
