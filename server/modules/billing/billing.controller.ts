import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import type {
  CostEstimateResponse,
  OfficialChannelInfo,
  PriceItem,
} from '@shared/api.interface';
import { BillingService } from './billing.service';
import { CostEstimateDto, OfficialChannelUpdateDto, PricingUpdateDto } from './dto';
import { AdminGuard } from '../admin/admin.guard';

@Controller('api/billing')
export class BillingController {
  constructor(private readonly billingService: BillingService) {}

  /** 公开价格表（无任何 Key，可直接展示“三栏对比”） */
  @Get('pricing')
  async listPricing(): Promise<PriceItem[]> {
    return this.billingService.listPricing();
  }

  /** 调价（管理后台用；W1 安全修复：已由 AdminGuard 保护，x-admin-token 须等于 ENTERPRISE_ADMIN_TOKEN） */
  @UseGuards(AdminGuard)
  @Patch('pricing/:modelKey')
  async updatePricing(
    @Param('modelKey') modelKey: string,
    @Body() body: PricingUpdateDto,
  ): Promise<PriceItem> {
    return this.billingService.updatePricing(modelKey, body);
  }

  /** 官方通道公开信息（apiKey 永不返回） */
  @Get('official')
  async getOfficial(): Promise<OfficialChannelInfo> {
    return this.billingService.getOfficialChannel();
  }

  /** 官方通道配置（Key 只写；W1 安全修复：已由 AdminGuard 保护） */
  @UseGuards(AdminGuard)
  @Patch('official')
  async updateOfficial(
    @Body() body: OfficialChannelUpdateDto,
  ): Promise<OfficialChannelInfo> {
    return this.billingService.updateOfficialChannel(body);
  }

  /** 生成前费用预估 */
  @Post('estimate')
  async estimate(@Body() body: CostEstimateDto): Promise<CostEstimateResponse> {
    return this.billingService.estimate(body.tier, body.counts ?? {});
  }
}
