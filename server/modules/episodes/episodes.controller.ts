import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  BadRequestException,
} from '@nestjs/common';
import type { Request } from 'express';
import type { Episode, EpisodeProgress, HandoffState, Character, Scene, Shot } from '@shared/api.interface';
import { isEpisodeStatus } from '@shared/episode-logic';
import { EpisodesService } from './episodes.service';
import {
  AppendFactRequest,
  CreateEpisodeRequest,
  EpisodeApproveStage,
  ResolvePropRequest,
  UpdateEpisodeRequest,
  UpsertRelationRequest,
} from './dto';

/**
 * 集（长篇多集架构，方案②）：导航与确认的原子单位。
 * 路由约定与 storyboard/bible 一致：/api/projects/:projectId/...
 */
@Controller('api/projects/:projectId/episodes')
export class EpisodesController {
  constructor(private readonly episodesService: EpisodesService) {}

  @Get()
  async list(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query('season') season?: string,
  ): Promise<Episode[]> {
    const parsed = season !== undefined && season !== '' ? Number(season) : undefined;
    if (parsed !== undefined && (!Number.isInteger(parsed) || parsed < 1)) {
      throw new BadRequestException('season 必须是 ≥1 的整数');
    }
    return this.episodesService.listEpisodes(projectId, parsed);
  }

  /** 全项目管线进度按集聚合（A4：生成任务面板按集分组的数据源） */
  @Get('progress')
  async listProgress(@Param('projectId', ParseUUIDPipe) projectId: string): Promise<EpisodeProgress[]> {
    return this.episodesService.listEpisodeProgress(projectId);
  }

  @Get(':episodeId')
  async get(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('episodeId', ParseUUIDPipe) episodeId: string,
  ): Promise<Episode> {
    return this.episodesService.getEpisode(projectId, episodeId);
  }

  @Post()
  async create(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() body: CreateEpisodeRequest,
    @Req() req: Request,
  ): Promise<Episode> {
    const dto: { title?: string; season?: number } = {};
    if (body.title !== undefined) {
      if (typeof body.title !== 'string') throw new BadRequestException('title 必须是字符串');
      dto.title = body.title.slice(0, 200);
    }
    if (body.season !== undefined) {
      if (!Number.isInteger(body.season) || body.season < 1) {
        throw new BadRequestException('season 必须是 ≥1 的整数');
      }
      dto.season = body.season;
    }
    return this.episodesService.createEpisode(projectId, dto, req.userContext?.userId);
  }

  @Patch(':episodeId')
  async update(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('episodeId', ParseUUIDPipe) episodeId: string,
    @Body() body: UpdateEpisodeRequest,
    @Req() req: Request,
  ): Promise<Episode> {
    const dto: UpdateEpisodeRequest = {};
    if (body.title !== undefined) {
      if (typeof body.title !== 'string') throw new BadRequestException('title 必须是字符串');
      dto.title = body.title.slice(0, 200);
    }
    if (body.status !== undefined) {
      if (!isEpisodeStatus(body.status)) {
        throw new BadRequestException(
          'status 必须是 draft|script_ready|shots_ready|video_generating|completed',
        );
      }
      dto.status = body.status;
    }
    if (body.locked !== undefined) {
      if (typeof body.locked !== 'boolean') throw new BadRequestException('locked 必须是布尔值');
      dto.locked = body.locked;
    }
    if (body.active !== undefined) {
      if (typeof body.active !== 'boolean') throw new BadRequestException('active 必须是布尔值');
      dto.active = body.active;
    }
    return this.episodesService.updateEpisode(projectId, episodeId, dto, req.userContext?.userId);
  }

  @Delete(':episodeId')
  async remove(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('episodeId', ParseUUIDPipe) episodeId: string,
    @Query('force') force?: string,
  ): Promise<{ deleted: true }> {
    await this.episodesService.deleteEpisode(projectId, episodeId, force === 'true');
    return { deleted: true };
  }

  // ========== 按集查询（A3，供前端按集加载） ==========

  @Get(':episodeId/shots')
  async listShots(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('episodeId', ParseUUIDPipe) episodeId: string,
  ): Promise<Shot[]> {
    return this.episodesService.listEpisodeShots(projectId, episodeId);
  }

  @Get(':episodeId/scenes')
  async listScenes(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('episodeId', ParseUUIDPipe) episodeId: string,
  ): Promise<Scene[]> {
    return this.episodesService.listEpisodeScenes(projectId, episodeId);
  }

  /** 集内角色 = 本集专属 + 全剧公共资产（episode_id IS NULL） */
  @Get(':episodeId/characters')
  async listCharacters(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('episodeId', ParseUUIDPipe) episodeId: string,
  ): Promise<Character[]> {
    return this.episodesService.listEpisodeCharacters(projectId, episodeId);
  }

  // ========== 跨集交接账本（B2） ==========

  @Get(':episodeId/handoff')
  async getHandoff(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('episodeId', ParseUUIDPipe) episodeId: string,
  ): Promise<HandoffState> {
    return this.episodesService.getHandoffState(projectId, episodeId);
  }

  @Post(':episodeId/handoff/facts')
  async appendFact(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('episodeId', ParseUUIDPipe) episodeId: string,
    @Body() body: AppendFactRequest,
  ): Promise<HandoffState> {
    this.assertNonEmpty(body?.text, 'text');
    return this.episodesService.appendFact(projectId, episodeId, String(body.text));
  }

  @Post(':episodeId/handoff/props')
  async resolveProp(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('episodeId', ParseUUIDPipe) episodeId: string,
    @Body() body: ResolvePropRequest,
  ): Promise<HandoffState> {
    this.assertNonEmpty(body?.name, 'name');
    this.assertNonEmpty(body?.holder, 'holder');
    return this.episodesService.resolveProp(projectId, episodeId, String(body.name), String(body.holder));
  }

  @Post(':episodeId/handoff/relations')
  async upsertRelation(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('episodeId', ParseUUIDPipe) episodeId: string,
    @Body() body: UpsertRelationRequest,
  ): Promise<HandoffState> {
    this.assertNonEmpty(body?.a, 'a');
    this.assertNonEmpty(body?.b, 'b');
    this.assertNonEmpty(body?.status, 'status');
    return this.episodesService.upsertRelation(
      projectId,
      episodeId,
      String(body.a),
      String(body.b),
      String(body.status),
    );
  }

  // ========== 按集流水线（A4：复用 project 级门语义的按集版本） ==========

  @Get(':episodeId/progress')
  async getProgress(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('episodeId', ParseUUIDPipe) episodeId: string,
  ): Promise<EpisodeProgress> {
    return this.episodesService.getEpisodeProgress(projectId, episodeId);
  }

  @Post(':episodeId/approve/:stage')
  async approveStage(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('episodeId', ParseUUIDPipe) episodeId: string,
    @Param('stage') stage: string,
    @Req() req: Request,
  ): Promise<Episode> {
    const allowed: EpisodeApproveStage[] = ['script', 'storyboard', 'preview', 'final'];
    if (!allowed.includes(stage as EpisodeApproveStage)) {
      throw new BadRequestException('stage 必须是 script|storyboard|preview|final');
    }
    return this.episodesService.approveEpisodeStage(
      projectId,
      episodeId,
      stage as EpisodeApproveStage,
      req.userContext?.userId,
    );
  }

  @Post(':episodeId/activate')
  async activate(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('episodeId', ParseUUIDPipe) episodeId: string,
  ): Promise<{ active: true }> {
    await this.episodesService.setActiveEpisode(projectId, episodeId);
    return { active: true };
  }

  private assertNonEmpty(value: unknown, field: string): void {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new BadRequestException(`${field} 不能为空`);
    }
    if (value.length > 2000) {
      throw new BadRequestException(`${field} 超长（>2000 字符）`);
    }
  }
}
