import { Module } from '@nestjs/common';
import { Pavo3Controller } from './pavo3.controller';
import { Pavo3Service } from './pavo3.service';
import { GenerationModule } from '../generation/generation.module';
import { BillingModule } from '../billing/billing.module';

@Module({
  imports: [GenerationModule, BillingModule],
  controllers: [Pavo3Controller],
  providers: [Pavo3Service],
  exports: [Pavo3Service],
})
export class Pavo3Module {}
