import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  ParseUUIDPipe,
  BadRequestException,
} from '@nestjs/common';
import type {
  Character,
  CharacterLockAnchors,
  Location,
  Prop,
  WorldView,
  StyleBible,
  GenerateBibleResponse,
  GeneratePropsResponse,
} from '@shared/api.interface';
import { BibleService } from './bible.service';
import {
  CreateCharacterDto,
  CreateLocationDto,
  UpdateCharacterDto,
  UpdateLocationDto,
  CreatePropDto,
  UpdatePropDto,
  GenerateBibleDto,
} from './dto';

@Controller('api/projects/:projectId/bible')
export class BibleController {
  constructor(private readonly bibleService: BibleService) {}

  // ========== Characters ==========
  @Get('characters')
  async listCharacters(
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ): Promise<Character[]> {
    return this.bibleService.listCharacters(projectId);
  }

  @Get('characters/:id')
  async getCharacter(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Character> {
    return this.bibleService.getCharacter(projectId, id);
  }

  @Post('characters')
  async createCharacter(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() body: CreateCharacterDto,
  ): Promise<Character> {
    return this.bibleService.createCharacter(projectId, body);
  }

  @Patch('characters/:id')
  async updateCharacter(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateCharacterDto,
  ): Promise<Character> {
    return this.bibleService.updateCharacter(projectId, id, body);
  }

  @Delete('characters/:id')
  async deleteCharacter(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.bibleService.deleteCharacter(projectId, id);
  }

  // ========== 身份锁锚点（migration 0024 一致性工程 B1） ==========
  // 分镜首帧提示词已注入的 identityKit 文本锁维持现状（不受本端点影响）；
  // 本组端点服务于锚点账本与集间一致性校验。

  /** 全部角色锚点聚合：lock_anchors 优先，为空回落 identityKit 文本锁 */
  @Get('lock-anchors')
  async getLockAnchors(
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ): Promise<CharacterLockAnchors[]> {
    return this.bibleService.getLockAnchors(projectId);
  }

  /** 写单个人物的身份锁短语（整体替换），anchor_updated_at 记录重出时间 */
  @Patch('characters/:id/lock-anchors')
  async setLockAnchors(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { anchors?: string[] },
  ): Promise<Character> {
    if (!body || !Array.isArray(body.anchors)) {
      throw new BadRequestException('anchors 必须是字符串数组');
    }
    return this.bibleService.setLockAnchors(projectId, id, body.anchors);
  }

  @Post('characters/:id/generate-image')
  async generateCharacterImage(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ jobId: string }> {
    return this.bibleService.generateCharacterImage(projectId, id);
  }

  @Post('characters/:id/complete-description')
  async completeCharacterDescription(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Character> {
    return this.bibleService.completeCharacterDescription(projectId, id);
  }

  // ========== Locations ==========
  @Get('locations')
  async listLocations(
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ): Promise<Location[]> {
    return this.bibleService.listLocations(projectId);
  }

  @Get('locations/:id')
  async getLocation(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Location> {
    return this.bibleService.getLocation(projectId, id);
  }

  @Post('locations')
  async createLocation(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() body: CreateLocationDto,
  ): Promise<Location> {
    return this.bibleService.createLocation(projectId, body);
  }

  @Patch('locations/:id')
  async updateLocation(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateLocationDto,
  ): Promise<Location> {
    return this.bibleService.updateLocation(projectId, id, body);
  }

  @Delete('locations/:id')
  async deleteLocation(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.bibleService.deleteLocation(projectId, id);
  }

  @Post('locations/:id/generate-image')
  async generateLocationImage(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ jobId: string }> {
    return this.bibleService.generateLocationImage(projectId, id);
  }

  // ========== Character identity kit（主图 + 四视图） ==========
  @Post('characters/:id/generate-identity-kit')
  async generateIdentityKit(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ jobIds: string[] }> {
    return this.bibleService.generateIdentityKit(projectId, id);
  }

  // ========== Props（道具资产） ==========
  @Get('props')
  async listProps(@Param('projectId', ParseUUIDPipe) projectId: string): Promise<Prop[]> {
    return this.bibleService.listProps(projectId);
  }

  /** 道具页「AI 生成道具」：只抽道具，不动世界观/人物/场景 */
  @Post('props/generate')
  async generateProps(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() body: GenerateBibleDto,
  ): Promise<GeneratePropsResponse> {
    return this.bibleService.generateProps(projectId, body);
  }

  @Get('props/:id')
  async getProp(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Prop> {
    return this.bibleService.getProp(projectId, id);
  }

  @Post('props')
  async createProp(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() body: CreatePropDto,
  ): Promise<Prop> {
    return this.bibleService.createProp(projectId, body);
  }

  @Patch('props/:id')
  async updateProp(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdatePropDto,
  ): Promise<Prop> {
    return this.bibleService.updateProp(projectId, id, body);
  }

  @Delete('props/:id')
  async deleteProp(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.bibleService.deleteProp(projectId, id);
  }

  @Post('props/:id/generate-image')
  async generatePropImage(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ jobId: string }> {
    return this.bibleService.generatePropImage(projectId, id);
  }

  // ========== AI 一键生成完整制作圣经 ==========
  @Post('generate')
  async generateBible(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() body: GenerateBibleDto,
  ): Promise<GenerateBibleResponse> {
    return this.bibleService.generateBible(projectId, body);
  }

  // ========== Worldview ==========
  @Get('worldview')
  async getWorldview(
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ): Promise<WorldView | null> {
    return this.bibleService.getWorldview(projectId);
  }

  @Put('worldview')
  async updateWorldview(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() body: WorldView,
  ): Promise<WorldView> {
    return this.bibleService.updateWorldview(projectId, body);
  }

  // ========== Style Bible ==========
  @Get('style')
  async getStyle(
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ): Promise<StyleBible | null> {
    return this.bibleService.getStyle(projectId);
  }

  @Put('style')
  async updateStyle(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() body: StyleBible,
  ): Promise<StyleBible> {
    return this.bibleService.updateStyle(projectId, body);
  }
}
