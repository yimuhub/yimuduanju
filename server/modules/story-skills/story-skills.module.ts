import { Module } from '@nestjs/common';
import { StorySkillsController } from './story-skills.controller';
import { GenerationModule } from '../generation/generation.module';

// 说明：StorySkillsService 注册在 GenerationModule（供消费器同模块调用，
// 避免 GenerationModule ↔ StorySkillsModule 循环依赖）；本模块只挂控制器。
@Module({
  imports: [GenerationModule],
  controllers: [StorySkillsController],
})
export class StorySkillsModule {}
