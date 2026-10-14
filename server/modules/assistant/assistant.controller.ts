import { Body, Controller, Post } from '@nestjs/common';
import type { AssistantChatResponse } from '@shared/api.interface';
import { AssistantService } from './assistant.service';
import { AssistantChatDto } from './dto';

@Controller('api/assistant')
export class AssistantController {
  constructor(private readonly assistantService: AssistantService) {}

  @Post('chat')
  async chat(@Body() body: AssistantChatDto): Promise<AssistantChatResponse> {
    return this.assistantService.chat(body.message);
  }
}
