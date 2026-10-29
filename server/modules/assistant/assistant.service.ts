import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ModelGatewayService } from '../generation/model-gateway.service';

const SYSTEM_PROMPT =
  '你是「一幕·YIMU AI 短剧创作平台」的创作助手，擅长短剧剧本、分镜、角色、风格与配音建议。' +
  '回答使用简体中文，简洁实用，必要时分条列出，可追问用户要关键信息（题材/时长/画风）。' +
  '不要编造平台不存在的功能；涉及生成操作时引导用户去对应页面。';

/**
 * 全局助手（无项目上下文）：直调文本网关实时回答。
 * 无 Key/无模型时如实报错，前端提示去配置。
 */
@Injectable()
export class AssistantService {
  private readonly logger = new Logger(AssistantService.name);

  constructor(private readonly modelGateway: ModelGatewayService) {}

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
}
