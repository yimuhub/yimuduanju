import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import type { SendAgentMessageRequest } from '@shared/api.interface';

/** POST /api/projects/:projectId/agents/messages 请求体（与 shared SendAgentMessageRequest 同形） */
export class SendAgentMessageDto implements SendAgentMessageRequest {
  @IsString()
  @MinLength(1)
  @MaxLength(8000)
  content!: string;

  /** 注册表人设名（agentRegistry.name），未匹配则用通用兜底人设 */
  @IsOptional()
  @IsString()
  @MaxLength(80)
  agentName?: string;
}

/** GET 消息列表的 limit 查询参数 */
export class AgentMessagesQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}
