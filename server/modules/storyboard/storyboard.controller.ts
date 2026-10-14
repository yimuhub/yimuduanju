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
  Shot,
  ParseScriptResponse,
  ScriptJobResponse,
} from '@shared/api.interface';
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
  RerunShotDto,
  RewriteScriptDto,
  RigSceneDto,
  ScriptToBoardsDto,
  ShotVariantsDto,
  UpdateSceneDto,
  UpdateShotDto,
} from './dto';

@Controller('api/projects/:projectId/storyboard')
export class StoryboardController {
  constructor(private readonly storyboardService: StoryboardService) {}

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
