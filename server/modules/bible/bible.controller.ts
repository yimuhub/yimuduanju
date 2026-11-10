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
} from '@nestjs/common';
import type {
  Character,
  Location,
  WorldView,
  StyleBible,
  GenerateBibleResponse,
} from '@shared/api.interface';
import { BibleService } from './bible.service';
import {
  CreateCharacterDto,
  CreateLocationDto,
  UpdateCharacterDto,
  UpdateLocationDto,
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
