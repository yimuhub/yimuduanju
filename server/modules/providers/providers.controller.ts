import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  ParseUUIDPipe,
} from '@nestjs/common';
import type {
  ModelProvider,
  ProviderApiKeyItem,
  ProviderTestResult,
  ProviderFetchModelsResult,
} from '@shared/api.interface';
import { ProvidersService } from './providers.service';
import {
  CreateApiKeyDto,
  CreateProviderDto,
  ProviderConnectionDto,
  UpdateProviderDto,
} from './dto';

@Controller('api/providers')
export class ProvidersController {
  constructor(private readonly providersService: ProvidersService) {}

  @Get()
  async list(): Promise<ModelProvider[]> {
    return this.providersService.list();
  }

  @Get(':id')
  async get(@Param('id', ParseUUIDPipe) id: string): Promise<ModelProvider> {
    return this.providersService.get(id);
  }

  @Post()
  async create(@Body() body: CreateProviderDto): Promise<ModelProvider> {
    return this.providersService.create(body);
  }

  @Patch(':id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateProviderDto,
  ): Promise<ModelProvider> {
    return this.providersService.update(id, body);
  }

  @Delete(':id')
  async delete(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.providersService.delete(id);
  }

  @Post('test-connection')
  async testConnection(
    @Body() body: ProviderConnectionDto,
  ): Promise<ProviderTestResult> {
    return this.providersService.testConnection(body);
  }

  @Post('fetch-models')
  async fetchModels(
    @Body() body: ProviderConnectionDto,
  ): Promise<ProviderFetchModelsResult> {
    return this.providersService.fetchModels(body);
  }

  @Post(':id/test')
  async test(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ProviderTestResult> {
    return this.providersService.test(id);
  }

  /** B3 按能力探活：文本/图片/配音各一次最小真实调用（视频太贵不探） */
  @Post(':id/probe')
  async probe(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { capability?: string },
  ): Promise<{ ok: boolean; message: string; latencyMs?: number; url?: string; reply?: string }> {
    const capability = body.capability === 'image' || body.capability === 'tts' ? body.capability : 'text';
    return this.providersService.probe(id, capability);
  }

  @Post(':id/set-default')
  async setDefault(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ModelProvider> {
    return this.providersService.setDefault(id);
  }

  // ========== 多 Key 管理（Key 本体只写不显） ==========
  @Get(':id/keys')
  async listKeys(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ProviderApiKeyItem[]> {
    return this.providersService.listKeys(id);
  }

  @Post(':id/keys')
  async addKey(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: CreateApiKeyDto,
  ): Promise<ProviderApiKeyItem> {
    return this.providersService.addKey(id, body);
  }

  @Post(':id/keys/:keyId/activate')
  async activateKey(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('keyId', ParseUUIDPipe) keyId: string,
  ): Promise<ProviderApiKeyItem[]> {
    return this.providersService.activateKey(id, keyId);
  }

  @Delete(':id/keys/:keyId')
  async removeKey(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('keyId', ParseUUIDPipe) keyId: string,
  ): Promise<void> {
    return this.providersService.removeKey(id, keyId);
  }
}
