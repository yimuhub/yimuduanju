import { Controller, Get, Query } from '@nestjs/common';
import { StorageService } from './storage.service';

@Controller('api/storage')
export class StorageController {
  constructor(private readonly storageService: StorageService) {}

  @Get('presign')
  async presign(
    @Query('fileName') fileName: string,
    @Query('contentType') contentType: string,
  ) {
    return this.storageService.presign(fileName || 'upload.bin', contentType || 'application/octet-stream');
  }
}
