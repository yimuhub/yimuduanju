import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
} from '@nestjs/common';

import { TemplatesService } from './templates.service';
import type {
  Template,
  TemplateType,
} from '@shared/api.interface';

interface TemplateListResponse {
  items: Template[];
  total: number;
  page: number;
  pageSize: number;
}

@Controller('api/templates')
export class TemplatesController {
  constructor(private readonly templatesService: TemplatesService) {}

  @Get()
  async list(
    @Query('templateType') templateType?: TemplateType,
    @Query('keyword') keyword?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ): Promise<TemplateListResponse> {
    // P1 修复：keyword/page/pageSize 之前被服务端丢弃，搜索翻页 silently 失效
    return this.templatesService.list({
      templateType,
      keyword,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  // P1 修复：by-type 必须注册在 :id 之前，否则 /by-type/x 被 :id 吞掉（之前该接口必 404 错数据）
  @Get('by-type/:type')
  async findByType(
    @Param('type') type: TemplateType,
  ): Promise<TemplateListResponse> {
    return this.templatesService.findByType(type);
  }

  @Get(':id')
  async findById(@Param('id') id: string): Promise<Template> {
    return this.templatesService.findById(id);
  }

  @Post()
  async create(@Body() dto: Partial<Template>): Promise<Template> {
    return this.templatesService.create(dto);
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: Partial<Template>,
  ): Promise<Template> {
    return this.templatesService.update(id, dto);
  }

  @Delete(':id')
  async delete(@Param('id') id: string): Promise<{ success: boolean }> {
    await this.templatesService.delete(id);
    return { success: true };
  }

  /** W5 模板市场：使用打点 */
  @Post(':id/use')
  async trackUse(@Param('id') id: string): Promise<Template> {
    return this.templatesService.trackUse(id);
  }

  /** W5 模板市场：项目存为模板 */
  @Post('from-project')
  async saveAsTemplate(
    @Body() body: { projectId: string; name?: string },
  ): Promise<Template> {
    return this.templatesService.saveAsTemplate(body.projectId, body.name);
  }
}
