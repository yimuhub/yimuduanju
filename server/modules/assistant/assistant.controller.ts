import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import type {
  AssistantChatResponse,
  ChatSession,
  ChatSessionDetail,
  StreamChatRequest,
} from '@shared/api.interface';
import { AssistantService } from './assistant.service';
import {
  AssistantChatDto,
  CreateChatSessionDto,
  LinkChatSessionDto,
  StreamMessageDto,
  SuggestTitleDto,
  UpdateChatTitleDto,
} from './dto';

@Controller('api/assistant')
export class AssistantController {
  constructor(private readonly assistantService: AssistantService) {}

  /** 兼容旧客户端：无会话的一次性问答 */
  @Post('chat')
  async chat(@Body() body: AssistantChatDto): Promise<AssistantChatResponse> {
    return this.assistantService.chat(body.message);
  }

  @Post('sessions')
  async createSession(@Body() body: CreateChatSessionDto): Promise<ChatSession> {
    return this.assistantService.createSession(body);
  }

  @Get('sessions')
  async listSessions(@Query('projectId') projectId?: string): Promise<ChatSession[]> {
    return this.assistantService.listSessions(projectId);
  }

  @Get('sessions/:id')
  async getSession(@Param('id') id: string): Promise<ChatSessionDetail> {
    return this.assistantService.getSessionDetail(id);
  }

  /** 按对话内容生成作品名（可同步回写会话标题） */
  @Post('suggest-title')
  async suggestTitle(@Body() body: SuggestTitleDto): Promise<{ title: string }> {
    return { title: await this.assistantService.suggestTitle(body.text, body.sessionId) };
  }

  /** 手动改写作品名，落库到草稿会话 */
  @Post('sessions/:id/title')
  async updateTitle(
    @Param('id') id: string,
    @Body() body: UpdateChatTitleDto,
  ): Promise<ChatSession> {
    return this.assistantService.updateTitle(id, body.title);
  }

  /** 新建作品成功后把草稿会话挂到项目，历史随项目可追溯 */
  @Post('sessions/:id/link')
  async linkSession(
    @Param('id') id: string,
    @Body() body: LinkChatSessionDto,
  ): Promise<ChatSession> {
    return this.assistantService.linkProject(id, body.projectId, body.title);
  }

  /**
   * 流式对话（SSE）。用 POST + fetch 流读取，前端逐字渲染。
   * 帧：data:{delta} / event:user / event:done / event:error
   */
  @Post('sessions/:id/messages/stream')
  @HttpCode(200)
  async streamMessage(
    @Param('id') id: string,
    @Body() body: StreamMessageDto,
    @Res() res: Response,
  ): Promise<void> {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const controller = new AbortController();
    res.on('close', () => controller.abort());

    try {
      await this.assistantService.streamMessage(
        id,
        body as StreamChatRequest,
        res,
        controller.signal,
      );
    } catch (e) {
      const message = (e as Error)?.message ?? '未知错误';
      if (!res.headersSent) throw e;
      if (!res.writableEnded) {
        res.write(`event: error\ndata: ${JSON.stringify({ message })}\n\n`);
        res.end();
      }
    }
  }
}