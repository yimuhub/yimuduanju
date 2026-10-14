import { Module } from '@nestjs/common';
import { AssetsController } from './assets.controller';
import { AssetsService } from './assets.service';
import { UploadsController } from './uploads.controller';

@Module({
  controllers: [AssetsController, UploadsController],
  providers: [AssetsService],
  exports: [AssetsService],
})
export class AssetsModule {}
