import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { SkillsService } from './skills.service';

/**
 * Skill 注册表接口：列表 / 启停 / 正文编辑 / 新建 / 删除 / 流水线注入预览。
 * 单机形态不做鉴权（与业务接口一致）；SaaS 形态由租户 Guard 统一收口。
 */
@Controller('api/skills')
export class SkillsController {
  constructor(private readonly skillsService: SkillsService) {}

  @Get()
  async list(@Query('line') line?: string) {
    return this.skillsService.list({ line });
  }

  @Patch(':slug/enabled')
  async setEnabled(@Param('slug') slug: string, @Body() body: { enabled: boolean }) {
    return this.skillsService.setEnabled(slug, Boolean(body.enabled));
  }

  @Patch(':slug/body')
  async updateBody(@Param('slug') slug: string, @Body() body: { body: string; description?: string }) {
    return this.skillsService.updateBody(slug, body.body, body.description);
  }

  @Post()
  async create(
    @Body()
    body: { slug: string; name: string; line: string; slot: string; description?: string; body?: string },
  ) {
    return this.skillsService.create(body);
  }

  @Delete(':slug')
  async remove(@Param('slug') slug: string) {
    return this.skillsService.remove(slug);
  }

  /** 流水线注入预览（调试用）：看某产品线+槽位组合当前会注入什么 */
  @Get('injection')
  async injection(@Query('line') line: string, @Query('slots') slots: string) {
    return { text: await this.skillsService.getInjection(line, (slots ?? '').split(',').filter(Boolean)) };
  }
}
