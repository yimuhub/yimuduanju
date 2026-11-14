import { Module } from '@nestjs/common';
import { EpisodesController } from './episodes.controller';
import { EpisodesService } from './episodes.service';
import { StoryboardModule } from '../storyboard/storyboard.module';
import { BibleModule } from '../bible/bible.module';

/**
 * 集（长篇多集架构，migration 0024）：
 * - 依赖 Storyboard/Bible 只读其按集查询与角色聚合（单向依赖，无环）；
 * - 旧项目（projects.has_episodes=false）完全不触碰本模块的数据，行为不变。
 */
@Module({
  imports: [StoryboardModule, BibleModule],
  controllers: [EpisodesController],
  providers: [EpisodesService],
  exports: [EpisodesService],
})
export class EpisodesModule {}
