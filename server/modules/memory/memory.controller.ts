import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { MemoryService } from './memory.service';

@Controller('api/projects/:projectId/memory')
export class MemoryController {
  constructor(private readonly memory: MemoryService) {}

  /** 记忆索引：文本入库（系列事实/剧本/资产描述），有本地模型则附向量 */
  @Post('index')
  async index(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() body: { kind?: string; texts?: string[] },
  ): Promise<{ indexed: number; withVector: boolean }> {
    const texts = Array.isArray(body.texts)
      ? body.texts.filter((t): t is string => typeof t === 'string' && t.trim().length > 0).slice(0, 100)
      : [];
    return this.memory.index(projectId, body.kind ?? 'fact', texts);
  }

  /** 记忆检索：向量（本地 MiniLM）+ 关键词混合；模型不可用时纯关键词 */
  @Get('search')
  async search(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query('q') q?: string,
    @Query('topK') topK?: string,
  ): Promise<{ mode: 'hybrid' | 'keyword'; results: { text: string; score: number }[] }> {
    const k = Math.max(1, Math.min(20, Math.floor(Number(topK)) || 5));
    return this.memory.search(projectId, q ?? '', k);
  }
}
