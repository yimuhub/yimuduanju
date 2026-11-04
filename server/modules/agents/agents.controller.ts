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
import type { AgentMessage } from '@shared/api.interface';
import { AgentsService } from './agents.service';
import { AgentMessagesQueryDto, SendAgentMessageDto } from './dto';

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
    @Query() query: AgentMessagesQueryDto,
  ): Promise<AgentMessage[]> {
    // limit 经 DTO 校验/转换（旧实现 parseInt 无 NaN 兜底，非法值直达 SQL）
    return this.agentsService.listMessages(projectId, query.limit);
  }

  @Post('projects/:projectId/agents/messages')
  async sendMessage(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() body: SendAgentMessageDto,
  ): Promise<AgentMessage> {
    return this.agentsService.sendMessage(projectId, body);
  }

  @Delete('projects/:projectId/agents/messages')
  async clearMessages(
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ): Promise<{ cleared: number }> {
    // 契约对齐：前端 clearMessages 期望 { cleared: number }，旧实现返回 void（body 为空）
    return this.agentsService.clearMessages(projectId);
  }
}
