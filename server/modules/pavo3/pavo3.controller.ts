import { Body, Controller, Get, Post } from '@nestjs/common';
import {
  Pavo3Service,
  type P3GenerateRequest,
  type P3GenerateResult,
} from './pavo3.service';

@Controller('api/pavo3')
export class Pavo3Controller {
  constructor(private readonly pavo3Service: Pavo3Service) {}

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
}
