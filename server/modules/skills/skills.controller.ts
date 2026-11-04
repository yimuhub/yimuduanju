import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { SkillsService } from './skills.service';
import {
  CreateSkillDto,
  SetSkillEnabledDto,
  SkillInjectionQueryDto,
  SkillListQueryDto,
  UpdateSkillBodyDto,
} from './dto';

/**
 * Skill 注册表接口：列表 / 启停 / 正文编辑 / 新建 / 删除 / 流水线注入预览。
 * 单机形态不做鉴权（与业务接口一致）；SaaS 形态由租户 Guard 统一收口。
 * 注意：`injection` 为静态路径，必须声明在任何 `:slug` 动态路由之前（NestJS 按声明序匹配）。
 */
@Controller('api/skills')
export class SkillsController {
  constructor(private readonly skillsService: SkillsService) {}

  @Get()
  async list(@Query() query: SkillListQueryDto) {
    return this.skillsService.list({ line: query.line, enabled: query.enabled });
  }

  /** 流水线注入预览（调试用）：看某产品线+槽位组合当前会注入什么 */
  @Get('injection')
  async injection(@Query() query: SkillInjectionQueryDto) {
    const slots = (query.slots ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 20);
    return { text: await this.skillsService.getInjection(query.line, slots) };
  }

  @Patch(':slug/enabled')
  async setEnabled(@Param('slug') slug: string, @Body() body: SetSkillEnabledDto) {
    return this.skillsService.setEnabled(slug, body.enabled);
  }

  @Patch(':slug/body')
  async updateBody(@Param('slug') slug: string, @Body() body: UpdateSkillBodyDto) {
    return this.skillsService.updateBody(slug, body.body, body.description);
  }

  @Post()
  async create(@Body() dto: CreateSkillDto) {
    // 显式挑列入库：即使全局管道未开 whitelist，body 里的多余字段也不会进 SQL
    return this.skillsService.create({
      slug: dto.slug,
      name: dto.name,
      line: dto.line,
      slot: dto.slot,
      description: dto.description,
      body: dto.body,
    });
  }

  @Delete(':slug')
  async remove(@Param('slug') slug: string) {
    return this.skillsService.remove(slug);
  }
}
