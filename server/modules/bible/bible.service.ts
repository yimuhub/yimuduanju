import { Injectable, Inject, Logger, NotFoundException } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { characters, locations, projects, generationJobs } from '@server/database/schema';
import { eq, desc, and, count } from 'drizzle-orm';
import type {
  Character,
  Location,
  CreateCharacterRequest,
  UpdateCharacterRequest,
  CreateLocationRequest,
  UpdateLocationRequest,
  WorldView,
  StyleBible,
} from '@shared/api.interface';
import { BudgetCapService } from '../generation/budget-cap.service';

@Injectable()
export class BibleService {
  private readonly logger = new Logger(BibleService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    private readonly budgetCap: BudgetCapService,
  ) {}

  // ========== Characters ==========
  async listCharacters(projectId: string): Promise<Character[]> {
    const rows = await this.db
      .select()
      .from(characters)
      .where(eq(characters.projectId, projectId))
      .orderBy(desc(characters.sortOrder), desc(characters.createdAt));
    return rows.map((r) => this.mapCharacter(r));
  }

  async getCharacter(projectId: string, id: string): Promise<Character> {
    const rows = await this.db
      .select()
      .from(characters)
      .where(eq(characters.id, id));
    if (rows.length === 0 || rows[0].projectId !== projectId) {
      throw new NotFoundException('人物不存在');
    }
    return this.mapCharacter(rows[0]);
  }

  async createCharacter(
    projectId: string,
    dto: CreateCharacterRequest,
  ): Promise<Character> {
    const rows = await this.db
      .insert(characters)
      .values({
        projectId,
        name: dto.name,
        roleType: dto.roleType ?? 'supporting',
        age: dto.age,
        gender: dto.gender,
        canonicalDescription: dto.canonicalDescription,
        referenceImageUrls: dto.referenceImageUrls ?? [],
      })
      .returning();
    return this.mapCharacter(rows[0]);
  }

  async updateCharacter(
    projectId: string,
    id: string,
    dto: UpdateCharacterRequest,
  ): Promise<Character> {
    const patch: Record<string, unknown> = {};
    if (dto.name !== undefined) patch.name = dto.name;
    if (dto.roleType !== undefined) patch.roleType = dto.roleType;
    if (dto.age !== undefined) patch.age = dto.age;
    if (dto.gender !== undefined) patch.gender = dto.gender;
    if (dto.height !== undefined) patch.height = dto.height;
    if (dto.bodyType !== undefined) patch.bodyType = dto.bodyType;
    if (dto.faceFeatures !== undefined) patch.faceFeatures = dto.faceFeatures;
    if (dto.hairstyle !== undefined) patch.hairstyle = dto.hairstyle;
    if (dto.costume !== undefined) patch.costume = dto.costume;
    if (dto.accessories !== undefined) patch.accessories = dto.accessories;
    if (dto.personality !== undefined) patch.personality = dto.personality;
    if (dto.voiceType !== undefined) patch.voiceType = dto.voiceType;
    if (dto.voiceId !== undefined) patch.voiceId = dto.voiceId;
    if (dto.canonicalDescription !== undefined)
      patch.canonicalDescription = dto.canonicalDescription;
    if (dto.forbiddenChanges !== undefined)
      patch.forbiddenChanges = dto.forbiddenChanges;
    if (dto.referenceImageUrls !== undefined)
      patch.referenceImageUrls = dto.referenceImageUrls;
    if (dto.locked !== undefined) patch.locked = dto.locked;

    if (Object.keys(patch).length === 0) {
      return this.getCharacter(projectId, id);
    }
    patch.updatedAt = new Date();

    // P0 安全修复：写操作必须同时匹配 id + projectId，防止跨项目越权（IDOR）
    const rows = await this.db
      .update(characters)
      .set(patch)
      .where(and(eq(characters.id, id), eq(characters.projectId, projectId)))
      .returning();
    if (rows.length === 0) throw new NotFoundException('人物不存在');
    return this.mapCharacter(rows[0]);
  }

  async deleteCharacter(projectId: string, id: string): Promise<void> {
    const rows = await this.db
      .delete(characters)
      .where(and(eq(characters.id, id), eq(characters.projectId, projectId)))
      .returning({ id: characters.id });
    if (rows.length === 0) throw new NotFoundException('人物不存在');
  }

  /**
   * W4 一致性：标准描述一键补全（无 LLM，确定性组装）。
   * 已有描述则直接返回；缺失时按姓名/年龄/性别/体型/五官/发型/服装/配饰/性格拼装，
   * 作为跨镜一致性的文本锚点（forbiddenChanges 同步给一条默认约束）。
   */
  async completeCharacterDescription(projectId: string, id: string): Promise<Character> {
    const char = await this.getCharacter(projectId, id);
    if (char.canonicalDescription?.trim()) return char;
    const parts = [
      char.name,
      char.age !== undefined ? `${char.age}岁` : '',
      char.gender || '',
      char.bodyType ? `${char.bodyType}体型` : '',
      char.faceFeatures || '',
      char.hairstyle ? `${char.hairstyle}发型` : '',
      char.costume ? `着${char.costume}` : '',
      char.accessories ? `配饰${char.accessories}` : '',
      char.personality ? `性格${char.personality}` : '',
    ].filter(Boolean);
    const canonicalDescription = parts.length > 0 ? parts.join('，') : `${char.name}`;
    const forbiddenChanges = char.forbiddenChanges?.trim()
      || '保持面部特征、发型与服装在所有镜头中一致，不得擅自更换';
    return this.updateCharacter(projectId, id, { canonicalDescription, forbiddenChanges });
  }

  async generateCharacterImage(
    projectId: string,
    id: string,
  ): Promise<{ jobId: string }> {
    // P1 超预算拦截：所有任务创建入口统一守卫
    await this.budgetCap.assertAllowed();
    const char = await this.getCharacter(projectId, id);
    const rows = await this.db
      .insert(generationJobs)
      .values({
        projectId,
        jobType: 'image',
        targetType: 'character',
        targetId: char.id,
        status: 'pending',
        inputData: {
          prompt: char.canonicalDescription ?? char.name,
          references: char.referenceImageUrls,
        },
      })
      .returning({ id: generationJobs.id });
    return { jobId: rows[0].id };
  }

  // ========== Locations ==========
  async listLocations(projectId: string): Promise<Location[]> {
    const rows = await this.db
      .select()
      .from(locations)
      .where(eq(locations.projectId, projectId))
      .orderBy(desc(locations.sortOrder), desc(locations.createdAt));
    return rows.map((r) => this.mapLocation(r));
  }

  async getLocation(projectId: string, id: string): Promise<Location> {
    const rows = await this.db
      .select()
      .from(locations)
      .where(eq(locations.id, id));
    if (rows.length === 0 || rows[0].projectId !== projectId) {
      throw new NotFoundException('场景不存在');
    }
    return this.mapLocation(rows[0]);
  }

  async createLocation(
    projectId: string,
    dto: CreateLocationRequest,
  ): Promise<Location> {
    const rows = await this.db
      .insert(locations)
      .values({
        projectId,
        name: dto.name,
        locationType: dto.locationType ?? 'interior',
        timeOfDay: dto.timeOfDay ?? 'day',
        description: dto.description,
        referenceImageUrls: dto.referenceImageUrls ?? [],
      })
      .returning();
    return this.mapLocation(rows[0]);
  }

  async updateLocation(
    projectId: string,
    id: string,
    dto: UpdateLocationRequest,
  ): Promise<Location> {
    const patch: Record<string, unknown> = {};
    if (dto.name !== undefined) patch.name = dto.name;
    if (dto.locationType !== undefined) patch.locationType = dto.locationType;
    if (dto.timeOfDay !== undefined) patch.timeOfDay = dto.timeOfDay;
    if (dto.weather !== undefined) patch.weather = dto.weather;
    if (dto.architecture !== undefined) patch.architecture = dto.architecture;
    if (dto.furniture !== undefined) patch.furniture = dto.furniture;
    if (dto.lighting !== undefined) patch.lighting = dto.lighting;
    if (dto.colorPalette !== undefined) patch.colorPalette = dto.colorPalette;
    if (dto.description !== undefined) patch.description = dto.description;
    if (dto.referenceImageUrls !== undefined)
      patch.referenceImageUrls = dto.referenceImageUrls;
    if (dto.locked !== undefined) patch.locked = dto.locked;

    if (Object.keys(patch).length === 0) {
      return this.getLocation(projectId, id);
    }
    patch.updatedAt = new Date();

    // P0 安全修复：写操作必须同时匹配 id + projectId，防止跨项目越权（IDOR）
    const rows = await this.db
      .update(locations)
      .set(patch)
      .where(and(eq(locations.id, id), eq(locations.projectId, projectId)))
      .returning();
    if (rows.length === 0) throw new NotFoundException('场景不存在');
    return this.mapLocation(rows[0]);
  }

  async deleteLocation(projectId: string, id: string): Promise<void> {
    const rows = await this.db
      .delete(locations)
      .where(and(eq(locations.id, id), eq(locations.projectId, projectId)))
      .returning({ id: locations.id });
    if (rows.length === 0) throw new NotFoundException('场景不存在');
  }

  async generateLocationImage(
    projectId: string,
    id: string,
  ): Promise<{ jobId: string }> {
    await this.budgetCap.assertAllowed();
    const loc = await this.getLocation(projectId, id);
    const rows = await this.db
      .insert(generationJobs)
      .values({
        projectId,
        jobType: 'image',
        targetType: 'location',
        targetId: loc.id,
        status: 'pending',
        inputData: {
          prompt: loc.description ?? loc.name,
          references: loc.referenceImageUrls,
        },
      })
      .returning({ id: generationJobs.id });
    return { jobId: rows[0].id };
  }

  // ========== Worldview & Style ==========
  async getWorldview(projectId: string): Promise<WorldView | null> {
    const rows = await this.db
      .select({ worldView: projects.worldView })
      .from(projects)
      .where(eq(projects.id, projectId));
    if (rows.length === 0) throw new NotFoundException('项目不存在');
    return (rows[0].worldView as WorldView | null) ?? null;
  }

  async updateWorldview(projectId: string, body: WorldView): Promise<WorldView> {
    const rows = await this.db
      .update(projects)
      .set({ worldView: body, updatedAt: new Date() })
      .where(eq(projects.id, projectId))
      .returning({ worldView: projects.worldView });
    if (rows.length === 0) throw new NotFoundException('项目不存在');
    return rows[0].worldView as WorldView;
  }

  async getStyle(projectId: string): Promise<StyleBible | null> {
    const rows = await this.db
      .select({ styleBible: projects.styleBible })
      .from(projects)
      .where(eq(projects.id, projectId));
    if (rows.length === 0) throw new NotFoundException('项目不存在');
    return (rows[0].styleBible as StyleBible | null) ?? null;
  }

  async updateStyle(projectId: string, body: StyleBible): Promise<StyleBible> {
    const rows = await this.db
      .update(projects)
      .set({ styleBible: body, updatedAt: new Date() })
      .where(eq(projects.id, projectId))
      .returning({ styleBible: projects.styleBible });
    if (rows.length === 0) throw new NotFoundException('项目不存在');
    return rows[0].styleBible as StyleBible;
  }

  // ========== Mappers ==========
  private mapCharacter(row: typeof characters.$inferSelect): Character {
    return {
      id: row.id,
      projectId: row.projectId,
      name: row.name,
      roleType: row.roleType,
      age: row.age ?? undefined,
      gender: row.gender ?? undefined,
      height: row.height ?? undefined,
      bodyType: row.bodyType ?? undefined,
      faceFeatures: row.faceFeatures ?? undefined,
      hairstyle: row.hairstyle ?? undefined,
      costume: row.costume ?? undefined,
      accessories: row.accessories ?? undefined,
      personality: row.personality ?? undefined,
      voiceType: row.voiceType ?? undefined,
      voiceId: row.voiceId ?? undefined,
      canonicalDescription: row.canonicalDescription ?? undefined,
      forbiddenChanges: row.forbiddenChanges ?? undefined,
      referenceImageUrls: row.referenceImageUrls ?? [],
      locked: row.locked,
      sortOrder: row.sortOrder,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private mapLocation(row: typeof locations.$inferSelect): Location {
    return {
      id: row.id,
      projectId: row.projectId,
      name: row.name,
      locationType: row.locationType,
      timeOfDay: row.timeOfDay,
      weather: row.weather ?? undefined,
      architecture: row.architecture ?? undefined,
      furniture: row.furniture ?? undefined,
      lighting: row.lighting ?? undefined,
      colorPalette: row.colorPalette ?? undefined,
      description: row.description ?? undefined,
      referenceImageUrls: row.referenceImageUrls ?? [],
      locked: row.locked,
      sortOrder: row.sortOrder,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
