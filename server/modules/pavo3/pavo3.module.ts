import { Module } from '@nestjs/common';
import { Pavo3Controller } from './pavo3.controller';
import { Pavo3Service } from './pavo3.service';
import { GenerationModule } from '../generation/generation.module';
import { BillingModule } from '../billing/billing.module';
import { ExportModule } from '../export/export.module';

@Module({
  // 成片合成复用 ExportService 的 ffmpeg 管线（下载 / 混流 / 拼接 / 资产登记）
  imports: [GenerationModule, BillingModule, ExportModule],
  controllers: [Pavo3Controller],
  providers: [Pavo3Service],
  exports: [Pavo3Service],
})
export class Pavo3Module {}
