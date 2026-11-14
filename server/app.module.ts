import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { Module } from '@nestjs/common';
import { PlatformModule } from '@lark-apaas/fullstack-nestjs-core';

import { GlobalExceptionFilter } from './common/filters/exception.filter';
import { AuditInterceptor } from './common/interceptors/audit.interceptor';
import { ViewModule } from './modules/view/view.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { BibleModule } from './modules/bible/bible.module';
import { StoryboardModule } from './modules/storyboard/storyboard.module';
import { AssetsModule } from './modules/assets/assets.module';
import { GenerationModule } from './modules/generation/generation.module';
import { ProvidersModule } from './modules/providers/providers.module';
import { QcModule } from './modules/qc/qc.module';
import { TemplatesModule } from './modules/templates/templates.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { AgentsModule } from './modules/agents/agents.module';
import { Pavo3Module } from './modules/pavo3/pavo3.module';
import { ExportModule } from './modules/export/export.module';
import { BillingModule } from './modules/billing/billing.module';
import { AdminModule } from './modules/admin/admin.module';
import { AssistantModule } from './modules/assistant/assistant.module';
import { StorageModule } from './modules/storage/storage.module';
import { StorySkillsModule } from './modules/story-skills/story-skills.module';
import { MemoryModule } from './modules/memory/memory.module';
import { SkillsModule } from './modules/skills/skills.module';
import { TimelineModule } from './modules/timeline/timeline.module';
import { SystemLogsModule } from './modules/system-logs/system-logs.module';
import { EpisodesModule } from './modules/episodes/episodes.module';

@Module({
  imports: [
    // 平台 Module，提供平台能力
    PlatformModule.forRoot(),
    // ====== @route-section: business-modules START ======
    ProjectsModule,
    BibleModule,
    StoryboardModule,
    AssetsModule,
    GenerationModule,
    ProvidersModule,
    QcModule,
    TemplatesModule,
    DashboardModule,
    AgentsModule,
    Pavo3Module,
    ExportModule,
    BillingModule,
    AdminModule,
    AssistantModule,
    StorageModule,
    StorySkillsModule,
    MemoryModule,
    SkillsModule,
    // 线性剪辑 EDL：GET/PUT /timeline + POST /timeline/export
    TimelineModule,
    // 系统日志：文件日志 + 结构化事件 + 失败任务诊断（只读）
    SystemLogsModule,
    // 长篇多集（migration 0024）：集 CRUD/按集查询/跨集账本/按集门；旧项目（无集）不触碰
    EpisodesModule,
    // ====== @route-section: business-modules END ======

    // ⚠️ @route-order: last
    // ViewModule is the fallback route module, must be registered last.
    ViewModule,
  ],
  providers: [
    {
      provide: APP_FILTER,
      useClass: GlobalExceptionFilter,
    },
    // W6 企业版：审计拦截器（只记变更操作，审计表缺失时不阻塞业务）
    {
      provide: APP_INTERCEPTOR,
      useClass: AuditInterceptor,
    },
  ],
})
export class AppModule {}
