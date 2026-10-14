import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { StorySkillsService } from './story-skills.service';

@Controller('api/story-skills')
export class StorySkillsController {
  constructor(private readonly storySkills: StorySkillsService) {}

  /** 技能清单 + 风格预设（前端下拉框数据源，公开；支持按画风/内容模式过滤） */
  @Get()
  async list(
    @Query('artStyle') artStyle?: string,
    @Query('contentMode') contentMode?: string,
  ) {
    return this.storySkills.listSkills({ artStyle, contentMode });
  }

  /** 样式图批量生成：每画风一张定妆照 → client/public/styles（需图片 Key） */
  @Post('styles/generate')
  async generateStyles(
    @Body() body: { styleIds?: string[]; providerName?: string },
  ): Promise<{ results: { styleId: string; ok: boolean; file?: string; error?: string }[] }> {
    return this.storySkills.generateStyleImages(body.styleIds, body.providerName);
  }
}
