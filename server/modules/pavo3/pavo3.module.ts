import { Module } from '@nestjs/common';
import { Pavo3Controller } from './pavo3.controller';
import { Pavo3Service } from './pavo3.service';

@Module({
  controllers: [Pavo3Controller],
  providers: [Pavo3Service],
  exports: [Pavo3Service],
})
export class Pavo3Module {}
