import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  ParseUUIDPipe,
} from '@nestjs/common';
import type {
  Scene,
  Segment,
  Shot,
  ParseScriptResponse,
  ScriptJobResponse,
  BlockedVideoSummary,
  SplitShotResult,
} from '@shared/api.interface';
import type { ProjectDiagnosis } from '@shared/artifact-state';
import type { RigRunResult } from '../story-skills/story-skills.service';
import { StoryboardService } from './storyboard.service';
import {
  AdaptNovelDto,
  BatchGenerateDto,
  CreateAdDto,
  CreateSceneDto,
  CreateShotDto,
  DesignCharactersDto,
  ParseScriptDto,
  ReorderShotsDto,
  RerunShotDto,
  RewriteScriptDto,
  RigSceneDto,
  ScriptToBoardsDto,
  ShotVariantsDto,
  SplitShotDto,
  UpdateSceneDto,
  UpdateShotDto,
} from './dto';

@Controller('api/projects/:projectId/storyboard')
export class StoryboardController {
  constructor(private readonly storyboardService: StoryboardService) {}

  // ========== 一致性体检 ==========

  /** 产物四态 + 跳轴/景别/段超长/未绑资产体检（requireVideo=true 时把缺视频也算进去） */
  @Get('consistency')
  async consistency(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query('requireVideo') requireVideo?: string,
  ): Promise<ProjectDiagnosis> {
    return this.storyboardService.diagnose(projectId, {
      requireVideo: requireVideo === 'true' || requireVideo === '1',
    });
  }

  /** 片段列表（场 → 片段 → 镜 的中间层） */
  @Get('segments')
  async listSegments(
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ): Promise<Segment[]> {
    return this.storyboardService.listSegments(projectId);
  }

  /** 存量项目补三级结构：按「≤15 秒 / 2-4 镜」把现有镜头归段并回填节拍（不改镜头内容） */
  @Post('segments/rebuild')
  async rebuildSegments(
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ): Promise<{ segments: number; shots: number }> {
    return this.storyboardService.rebuildSegments(projectId);
  }

  // ========== Scenes ==========
  @Get('scenes')
  async listScenes(
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ): Promise<Scene[]> {
    return this.storyboardService.listScenes(projectId);
  }

  @Get('scenes/:id')
  async getScene(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Scene> {
    return this.storyboardService.getScene(projectId, id);
  }

  @Post('scenes')
  async createScene(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() body: CreateSceneDto,
  ): Promise<Scene> {
    return this.storyboardService.createScene(projectId, body);
  }

  @Patch('scenes/:id')
  async updateScene(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateSceneDto,
  ): Promise<Scene> {
    return this.storyboardService.updateScene(projectId, id, body);
  }

  @Delete('scenes/:id')
  async deleteScene(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.storyboardService.deleteScene(projectId, id);
  }

  // ========== Shots ==========
  @Get('shots')
  async listShots(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query('sceneId') sceneId?: string,
  ): Promise<Shot[]> {
    return this.storyboardService.listShots(projectId, sceneId);
  }

  @Get('shots/:id')
  async getShot(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Shot> {
    return this.storyboardService.getShot(projectId, id);
  }

  @Post('shots')
  async createShot(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() body: CreateShotDto,
  ): Promise<Shot> {
    return this.storyboardService.createShot(projectId, body);
  }

  /** P2 线性剪辑：按数组顺序批量重排镜头（事务内重编 sortOrder/shotNumber） */
  @Post('shots/reorder')
  async reorderShots(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() body: ReorderShotsDto,
  ): Promise<Shot[]> {
    return this.storyboardService.reorderShots(projectId, body.shotIds);
  }

  @Patch('shots/:id')
  async updateShot(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateShotDto,
  ): Promise<Shot> {
    return this.storyboardService.updateShot(projectId, id, body);
  }

  @Delete('shots/:id')
  async deleteShot(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.storyboardService.deleteShot(projectId, id);
  }

  /** P2 线性剪辑：在镜头内 atSecond 秒处分割成两条（共享源媒体，按入出点取段） */
  @Post('shots/:id/split')
  async splitShot(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: SplitShotDto,
  ): Promise<SplitShotResult> {
    return this.storyboardService.splitShot(projectId, id, body);
  }

  @Post('shots/:id/generate-image')
  async generateShotImage(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ jobId: string }> {
    return this.storyboardService.generateShotImage(projectId, id);
  }

  @Post('shots/:id/generate-video')
  async generateShotVideo(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('strict') strict?: string,
  ): Promise<{ jobId: string; warnings: string[] }> {
    return this.storyboardService.generateShotVideo(projectId, id, { strict: strict === '1' });
  }

  @Post('shots/:id/variants')
  async createVariants(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ShotVariantsDto,
  ): Promise<{ groupId: string; jobIds: string[] }> {
    return this.storyboardService.createVariants(projectId, id, body);
  }

  @Post('shots/:id/generate-voice')
  async generateShotVoice(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ jobId: string }> {
    return this.storyboardService.generateShotVoice(projectId, id);
  }

  @Post('shots/:id/rerun')
  async rerunShot(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: RerunShotDto,
  ): Promise<{ jobId: string }> {
    return this.storyboardService.rerunShot(projectId, id, body);
  }

  @Post('batch-generate')
  async batchGenerate(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() body: BatchGenerateDto,
  ): Promise<{ jobIds: string[]; groups: { empty: string[]; subject: string[] }; reused: string[] }> {
    return this.storyboardService.batchGenerate(projectId, body);
  }

  /** 因首帧未就绪被暂停的视频（按镜头聚合），供分镜页展示恢复入口 */
  @Get('blocked-videos')
  async listBlockedVideos(
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ): Promise<BlockedVideoSummary> {
    return this.storyboardService.listBlockedVideos(projectId);
  }

  /** 一键为「首帧失败/缺失」的镜头重新发起首帧，成功后消费器自动解除视频阻断 */
  @Post('blocked-videos/recover')
  async recoverBlockedVideos(
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ): Promise<{ retried: number; skipped: number; failed: number }> {
    return this.storyboardService.recoverBlockedVideos(projectId);
  }

  @Post('one-click')
  async oneClick(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() body: { shotIds?: string[] },
  ): Promise<{
    image: { jobIds: string[]; reused: string[] };
    video: { jobIds: string[]; reused: string[] };
  }> {
    return this.storyboardService.oneClick(projectId, body);
  }

  // ========== Parse Script ==========
  @Post('parse-script')
  async parseScript(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() body: ParseScriptDto,
  ): Promise<ParseScriptResponse> {
    return this.storyboardService.parseScript(projectId, body);
  }

  // ========== 剧本技能：一句话/小说 → LLM 剧本 → 自动链式物化 ==========
  @Post('adapt-novel')
  async adaptNovel(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() body: AdaptNovelDto,
  ): Promise<ScriptJobResponse> {
    return this.storyboardService.adaptNovel(projectId, body);
  }

  @Post('rewrite')
  async rewriteScript(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() body: RewriteScriptDto,
  ): Promise<ScriptJobResponse> {
    return this.storyboardService.rewriteScript(projectId, body);
  }

  // ========== 双模式：广告创意任务 + 运镜序列任务 ==========
  @Post('create-ad')
  async createAd(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() body: CreateAdDto,
  ): Promise<ScriptJobResponse> {
    return this.storyboardService.createAd(projectId, body);
  }

  @Post('rig-scene')
  async rigScene(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() body: RigSceneDto,
  ): Promise<RigRunResult> {
    return this.storyboardService.runRigScene(projectId, body);
  }

  @Post('design-characters')
  async designCharacters(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() body: DesignCharactersDto,
  ): Promise<{ characters: { id: string; name: string }[] }> {
    return this.storyboardService.designCharacters(projectId, body);
  }

  @Post('script-to-boards')
  async scriptToBoards(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() body: ScriptToBoardsDto,
  ): Promise<ScriptJobResponse> {
    return this.storyboardService.createBoards(projectId, body);
  }

  @Post('characters/:id/sheet')
  async characterSheet(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { styleId?: string },
  ): Promise<{ jobId: string }> {
    return this.storyboardService.generateCharacterSheet(projectId, id, body);
  }
}
