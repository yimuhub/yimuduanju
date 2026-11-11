import { Body, Controller, Get, Post } from '@nestjs/common';
import {
  Pavo3Service,
  type P3GenerateRequest,
  type P3GenerateResult,
} from './pavo3.service';
import { ExportService } from '../export/export.service';
import type { CanvasComposeInput, CanvasComposeResult } from '@shared/api.interface';

@Controller('api/pavo3')
export class Pavo3Controller {
  constructor(
    private readonly pavo3Service: Pavo3Service,
    private readonly exportService: ExportService,
  ) {}

  /** 生成前检测：是否已配置可用 Provider */
  @Get('status')
  async status() {
    return this.pavo3Service.status();
  }

  /** 通用生成代理：text / image / video / audio（三通道 API 真实调用） */
  @Post('generate')
  async generate(@Body() body: P3GenerateRequest): Promise<P3GenerateResult> {
    return this.pavo3Service.generate(body);
  }

  /**
   * 自由画布成片合成：按用户在画布上排定的顺序拼接视频节点。
   * 与 /projects/:id/export/assemble 的区别是画布可能不挂在项目上（自由画布），
   * 且片段顺序由用户拖拽决定，不能按 shots 表排序。纯本地 ffmpeg，不计费。
   */
  @Post('compose')
  async compose(@Body() body: CanvasComposeInput): Promise<CanvasComposeResult> {
    return this.exportService.composeCanvas(body);
  }
}
