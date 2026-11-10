import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  ParseUUIDPipe,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';

import { ProjectsService } from './projects.service';
import { AssetsService } from '../assets/assets.service';
import {
  ApproveProjectDto,
  CreateProjectDto,
  ProjectListQueryDto,
  QuickCreateDto,
  UpdateProjectDto,
} from './dto';
import type {
  Asset,
  Project,
  ProjectListResponse,
  ProjectStatus,
  QuickCreateResponse,
  ProjectProgressResponse,
  Shot,
} from '@shared/api.interface';

@Controller('api/projects')
export class ProjectsController {
  constructor(
    private readonly projectsService: ProjectsService,
    private readonly assetsService: AssetsService,
  ) {}

  @Get()
  async list(@Query() query: ProjectListQueryDto): Promise<ProjectListResponse> {
    // P1 DTO 校验：分页/状态/关键词在边界处校验（非法直接 400），service 层保留钳制兜底
    return this.projectsService.list({
      page: query.page,
      pageSize: query.pageSize,
      status: query.status as ProjectStatus | undefined,
      keyword: query.keyword,
    });
  }

  @Post('quick-create')
  async quickCreate(
    @Req() req: Request,
    @Body() dto: QuickCreateDto,
  ): Promise<QuickCreateResponse> {
    const { userId } = req.userContext;
    // 与 DB 列默认值对齐的兜底（旧行为：缺省即 NULL 风险；现缺省即默认值）
    // 注意：此处逐字段组装，QuickCreateDto 加新字段必须同步到这里（已漏过两次）
    return this.projectsService.quickCreate(
      {
        prompt: dto.prompt,
        title: dto.title,
        durationSeconds: dto.durationSeconds ?? 90,
        aspectRatio: dto.aspectRatio ?? '9:16',
        artStyle: dto.artStyle ?? 'realistic',
        genre: dto.genre,
        budgetMode: dto.budgetMode ?? 'balanced',
        mode: dto.mode ?? 'quick',
        contentMode: dto.contentMode ?? 'general',
        genreId: dto.genreId,
        professional: dto.professional,
        expandScript: dto.expandScript,
      },
      userId,
    );
  }

  @Post()
  async create(
    @Req() req: Request,
    @Body() dto: CreateProjectDto,
  ): Promise<Project> {
    const { userId } = req.userContext;
    return this.projectsService.create(
      { ...dto, mode: dto.mode ?? 'quick' },
      userId,
    );
  }

  /**
   * 阶段确认门（三道门）：script=确认剧本后物化分镜；storyboard=确认分镜后
   * 批量首帧并进入全自动段（图→视频→配音→剪辑→质检）；final=质检确认成片。
   * 必须注册在 `:id` 通配语义之外：方法级路由（POST）与 GET :id 不冲突。
   */
  @Post(':id/approve')
  async approve(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApproveProjectDto,
  ): Promise<Project> {
    const { userId } = req.userContext;
    return this.projectsService.approve(id, dto.stage, userId);
  }

  @Patch(':id')
  async update(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: UpdateProjectDto,
  ): Promise<Project> {
    const { userId } = req.userContext;
    return this.projectsService.update(id, dto, userId);
  }

  @Delete(':id')
  async delete(
    @Req() req: Request,
    @Param('id') id: string,
  ): Promise<{ success: boolean }> {
    const { userId } = req.userContext;
    await this.projectsService.delete(id, userId);
    return { success: true };
  }

  @Get(':id/progress')
  async getProgress(@Param('id') id: string): Promise<ProjectProgressResponse> {
    return this.projectsService.getProgress(id);
  }

  /**
   * 项目资产列表（前端 listProjectAssets 调用；此前路由缺失导致资产/概览两页空列表）。
   * 注意：必须注册在 `:id` 通配路由之前？本文件无 :id GET，直接挂载即可。
   */
  @Get(':id/assets')
  async listAssets(@Param('id', ParseUUIDPipe) id: string): Promise<Asset[]> {
    return this.assetsService.listByProject(id);
  }

  /**
   * W4 网关收敛：项目详情（原网关直连 PG 补全，现收敛回后端）。
   * 复用 findById：与网关 toProjectFull 同口径（另含 providerOverride，后端规范字段）。
   * 注：Express 下 ':id' 仅匹配单段路径，与 ':id/progress' / ':id/assets' 不冲突。
   */
  @Get(':id')
  async getById(@Param('id', ParseUUIDPipe) id: string): Promise<Project> {
    return this.projectsService.findById(id);
  }

  /**
   * W4 网关收敛：按场景查镜头（原网关直连 PG 补全，现收敛回后端）。
   */
  @Get(':id/storyboard/scenes/:sceneId/shots')
  async listSceneShots(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('sceneId', ParseUUIDPipe) sceneId: string,
  ): Promise<Shot[]> {
    return this.projectsService.listSceneShots(id, sceneId);
  }
}
