import {
  Injectable,
  Inject,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { characters, locations, projects, scenes, generationJobs, props, episodes } from '@server/database/schema';
import { eq, desc, and, count, or, isNull } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type {
  Character,
  Location,
  Prop,
  PropStateVariant,
  CharacterIdentityKit,
  CharacterViewKey,
  CharacterLockAnchors,
  CreateCharacterRequest,
  UpdateCharacterRequest,
  CreateLocationRequest,
  UpdateLocationRequest,
  CreatePropRequest,
  UpdatePropRequest,
  GenerateBibleRequest,
  GenerateBibleResponse,
  GenerateBibleCounts,
  GeneratePropsResponse,
  WorldView,
  StyleBible,
} from '@shared/api.interface';
import {
  CHARACTER_VIEW_KEYS,
  CHARACTER_VIEW_LABELS,
  emptyIdentityKit,
} from '@shared/api.interface';
import { BudgetCapService } from '../generation/budget-cap.service';
import { ModelGatewayService } from '../generation/model-gateway.service';

/** AI 生成的中间草稿（未落库） */
interface DraftCharacter {
  name: string;
  roleType: string;
  age?: number;
  gender?: string;
  faceFeatures?: string;
  hairstyle?: string;
  costume?: string;
  accessories?: string;
  personality?: string;
  voiceType?: string;
  canonicalDescription?: string;
  forbiddenChanges?: string;
  /** 人物文本锁：逐字复用到每个镜头提示词（identity / wardrobe / voice / signatures） */
  identityDescriptor?: string;
  wardrobe?: string;
  voiceLock?: string;
  signatureDetails?: string;
}
interface DraftLocation {
  name: string;
  locationType: string;
  timeOfDay: string;
  weather?: string;
  architecture?: string;
  furniture?: string;
  lighting?: string;
  colorPalette?: string;
  description?: string;
}
/** AI 生成道具的中间草稿；状态变体只是描述，落库时补齐 id */
interface DraftProp {
  name: string;
  category: string;
  identityAnchors: string;
  appearance: string;
  scaleReference: string;
  functionDesc: string;
  storyRole: string;
  ownerName?: string;
  continuityLock: string;
  forbiddenChanges: string;
  textPolicy: string;
  readableText?: string;
  states: { name: string; description: string }[];
}
interface BibleDraft {
  worldView: WorldView;
  styleBible: StyleBible;
  characters: DraftCharacter[];
  locations: DraftLocation[];
  props: DraftProp[];
}

const WORLD_KEYS: (keyof WorldView)[] = ['era', 'geography', 'socialRules', 'artStyle', 'colorSystem'];
const STYLE_KEYS: (keyof StyleBible)[] = ['visualStyle', 'cameraLanguage', 'colorPalette', 'lighting', 'texture', 'motionLanguage', 'subtitleStyle'];
const CHAR_KEYS: (keyof DraftCharacter)[] = ['roleType', 'age', 'gender', 'faceFeatures', 'hairstyle', 'costume', 'accessories', 'personality', 'voiceType', 'canonicalDescription', 'forbiddenChanges'];
/** 人物文本锁不占独立列，统一落 identity_kit jsonb */
const CHAR_KIT_KEYS: (keyof DraftCharacter)[] = ['identityDescriptor', 'wardrobe', 'voiceLock', 'signatureDetails'];
const LOC_KEYS: (keyof DraftLocation)[] = ['locationType', 'timeOfDay', 'weather', 'architecture', 'furniture', 'lighting', 'colorPalette', 'description'];
const PROP_KEYS: (keyof DraftProp)[] = ['category', 'identityAnchors', 'appearance', 'scaleReference', 'functionDesc', 'storyRole', 'continuityLock', 'forbiddenChanges', 'textPolicy', 'readableText'];

const emptyWorld = (): WorldView => ({ era: '', geography: '', socialRules: '', artStyle: '', colorSystem: '' });
const emptyStyle = (): StyleBible => ({ visualStyle: '', cameraLanguage: '', colorPalette: '', lighting: '', texture: '', motionLanguage: '', subtitleStyle: '' });
const str = (v: unknown, max = 400): string =>
  typeof v === 'string' ? v.trim().slice(0, max) : typeof v === 'number' ? String(v).slice(0, max) : '';

@Injectable()
export class BibleService {
  private readonly logger = new Logger(BibleService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    private readonly budgetCap: BudgetCapService,
    private readonly modelGateway: ModelGatewayService,
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

  /** 按集角色（migration 0024）：本集专属（episode_id = eid）+ 全剧公共（episode_id IS NULL） */
  async listCharactersByEpisode(projectId: string, episodeId: string): Promise<Character[]> {
    const rows = await this.db
      .select()
      .from(characters)
      .where(
        and(
          eq(characters.projectId, projectId),
          or(eq(characters.episodeId, episodeId), isNull(characters.episodeId)),
        ),
      )
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
        identityKit: dto.identityKit ?? null,
        // migration 0024：开集模式可指定归属集；缺省 = 全剧共享资产
        episodeId: dto.episodeId ? await this.assertEpisodeOwned(projectId, dto.episodeId) : null,
        lockAnchors: Array.isArray(dto.lockAnchors)
          ? dto.lockAnchors.filter((a): a is string => typeof a === 'string' && a.trim().length > 0)
          : [],
        anchorUpdatedAt: Array.isArray(dto.lockAnchors) && dto.lockAnchors.length > 0 ? new Date() : null,
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
    if (dto.identityKit !== undefined) patch.identityKit = dto.identityKit;
    // migration 0024：归集（null=转为全剧共享）；lock_anchors 走专门的锚点接口（见下）
    if (dto.episodeId !== undefined) {
      patch.episodeId = dto.episodeId === null
        ? null
        : await this.assertEpisodeOwned(projectId, dto.episodeId);
    }
    if (dto.lockAnchors !== undefined) {
      patch.lockAnchors = Array.isArray(dto.lockAnchors)
        ? dto.lockAnchors.filter((a): a is string => typeof a === 'string' && a.trim().length > 0)
        : [];
      patch.anchorUpdatedAt = new Date();
    }
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
   * 身份锁锚点聚合（一致性工程 B1）：全部角色锚点一次取齐。
   * lock_anchors 为空的角色回落 identityKit 文本锁（identityDescriptor + signatureDetails），
   * 与现状一致 —— 分镜首帧提示词的注入链路不变，本方法先给账本/集间校验消费。
   */
  async getLockAnchors(projectId: string): Promise<CharacterLockAnchors[]> {
    const rows = await this.db
      .select({
        id: characters.id,
        name: characters.name,
        lockAnchors: characters.lockAnchors,
        anchorUpdatedAt: characters.anchorUpdatedAt,
        identityKit: characters.identityKit,
      })
      .from(characters)
      .where(eq(characters.projectId, projectId))
      .orderBy(desc(characters.sortOrder), desc(characters.createdAt));
    return rows.map((r) => {
      const explicit = Array.isArray(r.lockAnchors)
        ? (r.lockAnchors as unknown[]).filter((a): a is string => typeof a === 'string' && a.trim().length > 0)
        : [];
      if (explicit.length > 0) {
        return {
          characterId: r.id,
          name: r.name,
          anchors: explicit,
          ...(r.anchorUpdatedAt ? { anchorUpdatedAt: r.anchorUpdatedAt.toISOString() } : {}),
        };
      }
      // 回落：identityKit 文本锁（现状口径，不改变任何提示词注入行为）
      const kit = (r.identityKit as CharacterIdentityKit | null) ?? null;
      const fallback = [
        kit?.identityDescriptor ?? '',
        kit?.signatureDetails ?? '',
      ].filter((s) => s.trim().length > 0);
      return {
        characterId: r.id,
        name: r.name,
        anchors: fallback,
      };
    });
  }

  /** 写身份锁锚点（B1）：短语数组整体替换，anchor_updated_at 记录重出时间 */
  async setLockAnchors(projectId: string, id: string, anchors: string[]): Promise<Character> {
    const cleaned = Array.isArray(anchors)
      ? anchors.filter((a): a is string => typeof a === 'string' && a.trim().length > 0).slice(0, 20)
      : [];
    const rows = await this.db
      .update(characters)
      .set({ lockAnchors: cleaned, anchorUpdatedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(characters.id, id), eq(characters.projectId, projectId)))
      .returning();
    if (rows.length === 0) throw new NotFoundException('人物不存在');
    return this.mapCharacter(rows[0]);
  }

  /** 校验集归属并返回集 ID（migration 0024：人物归集用） */
  private async assertEpisodeOwned(projectId: string, episodeId: string): Promise<string> {
    const rows = await this.db
      .select({ id: episodes.id })
      .from(episodes)
      .where(and(eq(episodes.id, episodeId), eq(episodes.projectId, projectId)))
      .limit(1);
    if (rows.length === 0) throw new NotFoundException('指定的集不存在');
    return episodeId;
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

  // ========== Props（道具资产） ==========
  async listProps(projectId: string): Promise<Prop[]> {
    const rows = await this.db
      .select()
      .from(props)
      .where(eq(props.projectId, projectId))
      .orderBy(desc(props.sortOrder), desc(props.createdAt));
    return rows.map((r) => this.mapProp(r));
  }

  async getProp(projectId: string, id: string): Promise<Prop> {
    const rows = await this.db.select().from(props).where(eq(props.id, id));
    if (rows.length === 0 || rows[0].projectId !== projectId) {
      throw new NotFoundException('道具不存在');
    }
    return this.mapProp(rows[0]);
  }

  /** 稳定编号 PROP001…：分镜提示词用 @PROP001 引用，改名不会断链 */
  private async nextPropCode(projectId: string): Promise<string> {
    const rows = await this.db
      .select({ code: props.code })
      .from(props)
      .where(eq(props.projectId, projectId));
    let max = 0;
    for (const r of rows) {
      const n = Number((r.code ?? '').replace(/^PROP/i, ''));
      if (Number.isFinite(n) && n > max) max = n;
    }
    return `PROP${String(max + 1).padStart(3, '0')}`;
  }

  async createProp(projectId: string, dto: CreatePropRequest): Promise<Prop> {
    const variants = (dto.stateVariants ?? []).map((v) => ({
      ...v,
      id: v.id || randomUUID(),
    }));
    const rows = await this.db
      .insert(props)
      .values({
        projectId,
        name: dto.name,
        code: dto.code?.trim() || (await this.nextPropCode(projectId)),
        category: dto.category ?? 'recurring',
        identityAnchors: dto.identityAnchors,
        appearance: dto.appearance,
        scaleReference: dto.scaleReference,
        functionDesc: dto.functionDesc,
        storyRole: dto.storyRole,
        ownerCharacterId: dto.ownerCharacterId || null,
        continuityLock: dto.continuityLock,
        forbiddenChanges: dto.forbiddenChanges,
        textPolicy: dto.textPolicy ?? 'no_readable_text',
        readableText: dto.readableText,
        stateVariants: variants,
        referenceImageUrls: dto.referenceImageUrls ?? [],
      })
      .returning();
    return this.mapProp(rows[0]);
  }

  async updateProp(projectId: string, id: string, dto: UpdatePropRequest): Promise<Prop> {
    const patch: Record<string, unknown> = {};
    const direct: (keyof UpdatePropRequest)[] = [
      'name', 'category', 'code', 'identityAnchors', 'appearance', 'scaleReference',
      'functionDesc', 'storyRole', 'continuityLock', 'forbiddenChanges',
      'textPolicy', 'readableText', 'referenceImageUrls', 'locked',
    ];
    for (const k of direct) {
      if (dto[k] !== undefined) patch[k] = dto[k];
    }
    if (dto.ownerCharacterId !== undefined) {
      patch.ownerCharacterId = dto.ownerCharacterId || null;
    }
    if (dto.stateVariants !== undefined) {
      patch.stateVariants = dto.stateVariants.map((v) => ({
        ...v,
        id: v.id || randomUUID(),
      }));
    }
    if (Object.keys(patch).length === 0) return this.getProp(projectId, id);
    patch.updatedAt = new Date();
    // P0 安全：与人物/场景一致，必须同时匹配 id + projectId
    const rows = await this.db
      .update(props)
      .set(patch)
      .where(and(eq(props.id, id), eq(props.projectId, projectId)))
      .returning();
    if (rows.length === 0) throw new NotFoundException('道具不存在');
    return this.mapProp(rows[0]);
  }

  async deleteProp(projectId: string, id: string): Promise<void> {
    const rows = await this.db
      .delete(props)
      .where(and(eq(props.id, id), eq(props.projectId, projectId)))
      .returning({ id: props.id });
    if (rows.length === 0) throw new NotFoundException('道具不存在');
  }

  /** 道具参考图生成任务：完成后由 job-worker 回写 props.reference_image_urls */
  async generatePropImage(projectId: string, id: string): Promise<{ jobId: string }> {
    await this.budgetCap.assertAllowed();
    const item = await this.getProp(projectId, id);
    const prompt = this.buildPropPrompt(item);
    const rows = await this.db
      .insert(generationJobs)
      .values({
        projectId,
        jobType: 'image',
        targetType: 'prop',
        targetId: item.id,
        status: 'pending',
        inputData: {
          prompt,
          references: item.referenceImageUrls,
          propCode: item.code,
        },
      })
      .returning({ id: generationJobs.id });
    return { jobId: rows[0].id };
  }

  /** 道具设定图提示词：形制/材质/尺度/永久标记/连续性锁，且明确纯中性背景 */
  private buildPropPrompt(item: Prop): string {
    return [
      `道具设定图：${item.name}${item.code ? `（${item.code}）` : ''}。`,
      item.identityAnchors ? `形制与识别锚点：${item.identityAnchors}。` : '',
      item.appearance ? `外观材质：${item.appearance}。` : '',
      item.scaleReference ? `尺度参照：${item.scaleReference}。` : '',
      item.continuityLock ? `跨镜必须保持：${item.continuityLock}。` : '',
      item.textPolicy === 'exact_readable' && item.readableText
        ? `表面准确文字：${item.readableText}。`
        : item.textPolicy === 'no_readable_text'
          ? '表面不得出现任何可读文字或标识。'
          : item.textPolicy === 'graphic_only'
            ? '只保留标签图形轮廓，不出现可辨文字。'
            : '表面文字待定，先不生成可辨文字。',
      '单一物件、完整入框、纯中性灰影棚背景、均匀柔和布光、无人物、无场景、无强烈阴影、无水印，正交产品设定图。',
    ].filter(Boolean).join('\n');
  }

  /**
   * 人物「1 张主图 + 四视图」形象包：一次提交 5 个独立生成任务。
   * 每个任务带 kitView 标记，job-worker 完成后分别回写 identity_kit 的对应槽位，
   * 而不是把所有图混进 reference_image_urls 让模型只吃到第一张。
   */
  async generateIdentityKit(projectId: string, id: string): Promise<{ jobIds: string[] }> {
    await this.budgetCap.assertAllowed();
    const char = await this.getCharacter(projectId, id);
    const kit = char.identityKit ?? emptyIdentityKit();
    const missing: ('portrait' | CharacterViewKey)[] = [];
    if (!kit.portraitUrl) missing.push('portrait');
    for (const v of CHARACTER_VIEW_KEYS) if (!kit.views?.[v]) missing.push(v);
    const targets = missing.length ? missing : (['portrait', ...CHARACTER_VIEW_KEYS] as ('portrait' | CharacterViewKey)[]);

    const rows = await this.db
      .insert(generationJobs)
      .values(
        targets.map((view) => ({
          projectId,
          jobType: 'image',
          targetType: 'character',
          targetId: char.id,
          status: 'pending',
          inputData: {
            prompt: this.buildViewPrompt(char, view),
            references: char.referenceImageUrls,
            kitView: view,
          },
          priority: 60,
        })),
      )
      .returning({ id: generationJobs.id });
    return { jobIds: rows.map((r) => r.id) };
  }

  /** 逐视角提示词：同一段身份锁逐字复用，只改变视角与画幅，避免身份漂移 */
  private buildViewPrompt(char: Character, view: 'portrait' | CharacterViewKey): string {
    const kit = char.identityKit ?? emptyIdentityKit();
    const identity = [
      kit.identityDescriptor || char.canonicalDescription || char.name,
      kit.wardrobe ? `服装：${kit.wardrobe}` : char.costume ? `服装：${char.costume}` : '',
      kit.signatureDetails ? `不可变签名细节：${kit.signatureDetails}` : '',
      char.forbiddenChanges ? `禁改项：${char.forbiddenChanges}` : '',
    ].filter(Boolean).join('；');
    const viewText: Record<'portrait' | CharacterViewKey, string> = {
      portrait: '高清 3/4 正面面部特写，头肩入框，面部占画面 40% 以上，五官与皮肤纹理清晰，作为面部唯一真相',
      front: `${CHARACTER_VIEW_LABELS.front}，直立中性姿态，头顶到脚底完整可见`,
      threeQuarter: `${CHARACTER_VIEW_LABELS.threeQuarter}，身体约 45 度转向，保留面部可辨识度`,
      side: `${CHARACTER_VIEW_LABELS.side}，精确 90 度侧身，轮廓与发型厚度清晰`,
      back: `${CHARACTER_VIEW_LABELS.back}，直立中性姿态，展示发型背面、服装背面与鞋型`,
    };
    return [
      `角色设定图 · ${char.name} · ${view === 'portrait' ? '主图' : CHARACTER_VIEW_LABELS[view]}。`,
      `身份锁（逐字保持一致）：${identity}。`,
      viewText[view] + '。',
      '同一人、同一套服装、同一发型与配色，比例一致，中性微表情。',
      '纯中性灰影棚背景、均匀柔和布光、无场景、无道具、无强烈方向性阴影、无水印、无文字。',
      '50–85mm 等效透视，无夸张姿势与广角畸变。',
    ].join('\n');
  }

  // ========== AI 一键生成制作圣经 ==========
  /**
   * 剧本 → 完整制作圣经（世界观 5 项 + 风格 7 项 + 人物 + 场景 + 道具），并写入数据库。
   *
   * 设计要点：
   *  · 这是「剧本分析后人物/场景为何一直为空」的断点：parse_script 只物化 scenes + shots，
   *    明确跳过 bible_ready，从来没有创建过 characters / locations / worldView / styleBible。
   *  · 模型不可用（无 Key、mock、限流、返回非法 JSON）时不报错中断，而是用确定性启发式
   *    从剧本抽取角色、场次并套题材模板，保证本地也能得到一份「可编辑草稿」。
   *  · mode=fill 只补空白且跳过 locked 项，用户手动修订过的设定不会被一键生成覆盖。
   */
  async generateBible(
    projectId: string,
    dto: GenerateBibleRequest,
  ): Promise<GenerateBibleResponse> {
    await this.budgetCap.assertAllowed();
    const rows = await this.db
      .select({
        scriptText: projects.scriptText,
        description: projects.description,
        title: projects.title,
        genre: projects.genre,
        artStyle: projects.artStyle,
      })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    if (rows.length === 0) throw new NotFoundException('项目不存在');
    const project = rows[0];
    const script = await this.resolveScript(projectId, project, dto.scriptText);
    if (!script.trim()) {
      throw new BadRequestException(
        '尚未找到剧本内容：请先在「剧本」页写入剧本，或在生成时粘贴一段故事梗概',
      );
    }
    const meta = {
      title: project.title ?? '',
      genre: project.genre ?? '',
      artStyle: project.artStyle ?? '',
    };
    const filler = this.fallbackDraft(script, meta);
    let draft: BibleDraft = filler;
    let source: 'llm' | 'fallback' = 'fallback';
    let note = '未接文本模型，已按剧本规则生成草稿，请逐项复核';

    try {
      const raw = await this.modelGateway.generateText(
        { prompt: this.buildBiblePrompt(script, meta), temperature: 0.6 },
        dto.providerName,
      );
      const parsed = this.parseBibleJson(raw);
      if (parsed && (parsed.characters.length > 0 || parsed.locations.length > 0)) {
        draft = this.mergeDraft(parsed, filler);
        source = 'llm';
        note = undefined;
      } else {
        note = '模型未返回可用设定，已按剧本规则生成草稿，请逐项复核';
      }
    } catch (e) {
      const reason = (e as Error)?.message ?? '未知错误';
      this.logger.warn(`圣经生成模型调用失败，转启发式草稿：${reason}`);
      note = `模型调用失败（${reason.slice(0, 120)}），已按剧本规则生成草稿，请逐项复核`;
    }

    const persisted = await this.persistBible(projectId, draft, dto.mode ?? 'fill');
    this.logger.log(
      `圣经生成完成 project=${projectId} source=${source} ` +
        `chars=${persisted.counts.charactersCreated}+${persisted.counts.charactersUpdated} ` +
        `locs=${persisted.counts.locationsCreated}+${persisted.counts.locationsUpdated} ` +
        `props=${persisted.counts.propsCreated}+${persisted.counts.propsUpdated}`,
    );
    return { ...persisted, source, note };
  }

  /**
   * 道具页专用：只从剧本抽取跨镜复现的道具，不触碰世界观 / 人物 / 场景。
   * 模型不可用时走与一键生成圣经相同的确定性词表草稿，保证本地可用。
   */
  async generateProps(
    projectId: string,
    dto: GenerateBibleRequest,
  ): Promise<GeneratePropsResponse> {
    await this.budgetCap.assertAllowed();
    const rows = await this.db
      .select({
        scriptText: projects.scriptText,
        description: projects.description,
        title: projects.title,
        genre: projects.genre,
        artStyle: projects.artStyle,
      })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    if (rows.length === 0) throw new NotFoundException('项目不存在');
    const project = rows[0];
    const script = await this.resolveScript(projectId, project, dto.scriptText);
    if (!script.trim()) {
      throw new BadRequestException('尚未找到剧本内容：请先在「剧本」页写入剧本');
    }
    const meta = {
      title: project.title ?? '', genre: project.genre ?? '', artStyle: project.artStyle ?? '',
    };
    let draftProps = this.fallbackDraft(script, meta).props;
    let source: 'llm' | 'fallback' = 'fallback';
    let note: string | undefined = '未接文本模型，已按剧本规则提取道具草稿，请逐项复核';
    try {
      const raw = await this.modelGateway.generateText(
        { prompt: this.buildPropsPrompt(script, meta), temperature: 0.5 },
        dto.providerName,
      );
      const parsed = this.parsePropsJson(raw);
      if (parsed.length > 0) {
        draftProps = parsed;
        source = 'llm';
        note = undefined;
      }
    } catch (e) {
      note = `模型调用失败（${((e as Error)?.message ?? '未知').slice(0, 100)}），已按剧本规则提取道具草稿`;
    }
    const draft: BibleDraft = {
      worldView: emptyWorld(), styleBible: emptyStyle(),
      characters: [], locations: [], props: draftProps,
    };
    const res = await this.persistBible(projectId, draft, dto.mode ?? 'fill');
    return {
      props: res.props,
      created: res.counts.propsCreated,
      updated: res.counts.propsUpdated,
      source,
      note,
    };
  }

  private buildPropsPrompt(script: string, meta: { title: string; genre: string; artStyle: string }): string {
    return [
      '你是影视美术道具统筹。请阅读剧本，只抽出「跨镜多次出现 / 承担剧情功能 / 会发生状态变化」的道具。',
      `片名：${meta.title || '未命名'}；题材：${meta.genre || '未指定'}；画风：${meta.artStyle || '未指定'}。`,
      '纯背景陈设不要建道具。道具名称沿用剧本原文，所有字段用简体中文，只输出一个合法 JSON 对象 {"props":[...]}，不要解释、不要 Markdown 围栏。',
      '每项的 identityAnchors 写清形制、部件关系、材料工艺与永久唯一标记，禁止「神秘盒子」「高级质感」这类空话；scaleReference 必须给出与人体或熟悉物件的可比尺寸；states 是同一道具的状态变体（开合/破损/内容物/转手/消耗进度 + 变化原因与有效范围），不拆成两个假道具；textPolicy 从 exact_readable / graphic_only / no_readable_text / pending_creator_text 选一项。',
      '最多 10 项，结构：',
      JSON.stringify({
        props: [{
          name: '道具名', category: 'hero|recurring|stateful|set_dressing',
          identityAnchors: '形制·部件关系·材料工艺·永久标记',
          appearance: '形状·颜色·材质·磨损', scaleReference: '约手掌长，与成年人前臂相当',
          functionDesc: '原本功能与操作方式', storyRole: '剧情作用', ownerName: '当前持有人（可空）',
          continuityLock: '跨镜不可改变的最小名词短语', forbiddenChanges: '禁改细节',
          textPolicy: 'no_readable_text', readableText: '',
          states: [{ name: '闭合·内有号牌', description: '初始状态与有效范围' }, { name: '打开·空', description: '变化原因与后续沿用范围' }],
        }],
      }),
      '剧本正文：', '---', script.slice(0, 8000), '---',
    ].join('\n');
  }

  private parsePropsJson(raw: string): DraftProp[] {
    const cleaned = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start < 0 || end <= start) return [];
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
    } catch {
      return [];
    }
    const list = Array.isArray(obj.props) ? obj.props : [];
    const validCategories = ['hero', 'recurring', 'stateful', 'set_dressing'];
    const validPolicies = ['exact_readable', 'graphic_only', 'no_readable_text', 'pending_creator_text'];
    return list
      .slice(0, 12)
      .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object' && !!str((x as Record<string, unknown>).name))
      .map((r) => {
        const category = str(r.category, 30);
        const textPolicy = str(r.textPolicy, 30);
        const states = Array.isArray(r.states)
          ? (r.states as unknown[])
              .slice(0, 6)
              .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object')
              .map((s) => ({ name: str(s.name, 60), description: str(s.description, 400) }))
              .filter((s) => !!s.name)
          : [];
        return {
          name: str(r.name, 100),
          category: validCategories.includes(category) ? category : 'recurring',
          identityAnchors: str(r.identityAnchors, 600),
          appearance: str(r.appearance, 400),
          scaleReference: str(r.scaleReference, 300),
          functionDesc: str(r.functionDesc, 300),
          storyRole: str(r.storyRole, 300),
          ownerName: str(r.ownerName, 100),
          continuityLock: str(r.continuityLock, 300),
          forbiddenChanges: str(r.forbiddenChanges, 300),
          textPolicy: validPolicies.includes(textPolicy) ? textPolicy : 'no_readable_text',
          readableText: str(r.readableText, 200),
          states,
        };
      });
  }

  /** 剧本来源优先级：请求体 → 项目剧本 → 场次汇总 → 项目简介 */
  private async resolveScript(
    projectId: string,
    project: { scriptText: string | null; description: string | null },
    override?: string,
  ): Promise<string> {
    if (override?.trim()) return override.trim();
    if (project.scriptText?.trim()) return project.scriptText.trim();
    const sc = await this.db
      .select({ title: scenes.title, summary: scenes.summary })
      .from(scenes)
      .where(eq(scenes.projectId, projectId))
      .orderBy(scenes.sortOrder)
      .limit(80);
    if (sc.length > 0) {
      return sc
        .map((s, i) => `第${i + 1}场 ${s.title ?? ''}${s.summary ? `：${s.summary}` : ''}`)
        .join('\n');
    }
    return (project.description ?? '').trim();
  }

  private buildBiblePrompt(
    script: string,
    meta: { title: string; genre: string; artStyle: string },
  ): string {
    const body = script.slice(0, 8000);
    return [
      '你是一位影视制作总美术与剧本统筹。请阅读剧本，产出一份可直接用于 AI 分镜生成的「制作圣经」。',
      `片名：${meta.title || '未命名'}；题材：${meta.genre || '未指定'}；画风：${meta.artStyle || '未指定'}。`,
      '要求：人物姓名、场景名称、道具名称必须尽量沿用剧本原文；所有字段用简体中文；不要写解释、不要 Markdown 围栏，只输出一个合法 JSON 对象。',
      '人物 3–8 个，场景 2–8 个，道具 2–10 个；每个字段都要有具体内容，不要留空字符串。',
      '',
      '【人物规范】每位主角必须有 identityDescriptor（可逐字复用的静态身份锁：脸型/肤色/体态/发型/稳定配色）、wardrobe（基础服装）、voiceLock（口音·音色·语速·受压变化）、signatureDetails（至少两个不可变签名细节，如银戒/眉骨疤）。canonicalDescription 是整合后的完整外貌锚点，不得写情绪或摄影机动作。',
      '',
      '【道具规范】只为「跨镜多次出现、承担剧情功能、或发生状态变化」的物件建立道具；纯背景陈设不建。identityAnchors 写清基本形制、部件关系、主要材料与表面工艺、永久唯一标记，不要用「神秘盒子」「高级质感」这类空话；scaleReference 必须给出与人体或熟悉物件的可比尺寸；states 是同一道具的状态变体（开合/破损/湿污/内容物/转手/消耗进度 + 变化原因与有效范围），绝不拆成两个假道具；textPolicy 从 exact_readable / graphic_only / no_readable_text / pending_creator_text 里选一项。',
      '',
      'JSON 结构如下：',
      JSON.stringify({
        worldView: { era: '时代背景', geography: '地理环境', socialRules: '社会规则', artStyle: '美术风格', colorSystem: '色彩系统' },
        styleBible: { visualStyle: '视觉风格', cameraLanguage: '镜头语言', colorPalette: '色彩体系', lighting: '光影风格', texture: '质感纹理', motionLanguage: '运动语言', subtitleStyle: '字幕风格' },
        characters: [{
          name: '角色名', roleType: '主角|配角|群演', age: 28, gender: '女',
          faceFeatures: '五官与面部特征', hairstyle: '发型', costume: '服装', accessories: '配饰',
          personality: '性格', voiceType: '音色',
          canonicalDescription: '一段可直接作为跨镜一致性锚点的完整外貌描述',
          forbiddenChanges: '跨镜头必须保持不变的特征',
          identityDescriptor: '静态身份锁，逐字复用', wardrobe: '基础服装标识',
          voiceLock: '口音·音色·语速·受压变化', signatureDetails: '两处不可变签名细节',
        }],
        locations: [{
          name: '场景名', locationType: '内景|外景', timeOfDay: '日|夜|黄昏', weather: '天气',
          architecture: '建筑结构', furniture: '陈设道具', lighting: '光线', colorPalette: '色彩',
          description: '一段可直接作为概念图提示的完整场景描述',
        }],
        props: [{
          name: '道具名', category: 'hero|recurring|stateful|set_dressing',
          identityAnchors: '形制·部件关系·材料工艺·永久唯一标记',
          appearance: '形状·颜色·材质·磨损细节',
          scaleReference: '约手掌长，与成年人前臂相当',
          functionDesc: '原本功能与操作方式', storyRole: '在剧情中的作用',
          ownerName: '当前持有人姓名（可空）',
          continuityLock: '跨镜不可改变的最小名词短语',
          forbiddenChanges: '禁止擅自改变的细节',
          textPolicy: 'no_readable_text', readableText: '',
          states: [{ name: '闭合·内有号牌', description: '初始状态，放于柜台下层' }, { name: '打开·空', description: 'SC004 被取走后，全片后续沿用' }],
        }],
      }),
      '剧本正文：',
      '---',
      body,
      '---',
    ].join('\n');
  }

  /** 容忍 ```json 围栏、前后杂文本与轻微残片；结构不合法时返回 null 走兜底 */
  private parseBibleJson(raw: string): BibleDraft | null {
    const cleaned = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
    } catch {
      return null;
    }
    const wv = (obj.worldView ?? {}) as Record<string, unknown>;
    const st = (obj.styleBible ?? {}) as Record<string, unknown>;
    const worldView = emptyWorld();
    for (const k of WORLD_KEYS) worldView[k] = str(wv[k]);
    const styleBible = emptyStyle();
    for (const k of STYLE_KEYS) styleBible[k] = str(st[k]);

    const readList = (v: unknown, nameKey: string): Record<string, unknown>[] =>
      Array.isArray(v)
        ? v.slice(0, 12).filter((x): x is Record<string, unknown> =>
            !!x && typeof x === 'object' && str((x as Record<string, unknown>)[nameKey]).length > 0)
        : [];

    const characters: DraftCharacter[] = readList(obj.characters, 'name').map((r) => {
      const age = Number(r.age);
      return {
        name: str(r.name, 100),
        roleType: str(r.roleType, 30) || '配角',
        age: Number.isFinite(age) && age > 0 ? Math.min(120, Math.round(age)) : undefined,
        gender: str(r.gender, 20),
        faceFeatures: str(r.faceFeatures),
        hairstyle: str(r.hairstyle),
        costume: str(r.costume),
        accessories: str(r.accessories),
        personality: str(r.personality),
        voiceType: str(r.voiceType, 50),
        canonicalDescription: str(r.canonicalDescription, 600),
        forbiddenChanges: str(r.forbiddenChanges),
        identityDescriptor: str(r.identityDescriptor, 600),
        wardrobe: str(r.wardrobe, 400),
        voiceLock: str(r.voiceLock, 400),
        signatureDetails: str(r.signatureDetails, 400),
      };
    });
    const locations: DraftLocation[] = readList(obj.locations, 'name').map((r) => ({
      name: str(r.name, 100),
      locationType: str(r.locationType, 30) || '内景',
      timeOfDay: str(r.timeOfDay, 20) || '日',
      weather: str(r.weather, 30),
      architecture: str(r.architecture),
      furniture: str(r.furniture),
      lighting: str(r.lighting),
      colorPalette: str(r.colorPalette),
      description: str(r.description, 600),
    }));
    const validCategories = ['hero', 'recurring', 'stateful', 'set_dressing'];
    const validPolicies = ['exact_readable', 'graphic_only', 'no_readable_text', 'pending_creator_text'];
    const draftProps: DraftProp[] = readList(obj.props, 'name').slice(0, 12).map((r) => {
      const category = str(r.category, 30);
      const textPolicy = str(r.textPolicy, 30);
      const states = Array.isArray(r.states)
        ? (r.states as unknown[])
            .slice(0, 6)
            .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object')
            .map((s) => ({ name: str(s.name, 60), description: str(s.description, 400) }))
            .filter((s) => !!s.name)
        : [];
      return {
        name: str(r.name, 100),
        category: validCategories.includes(category) ? category : 'recurring',
        identityAnchors: str(r.identityAnchors, 600),
        appearance: str(r.appearance, 400),
        scaleReference: str(r.scaleReference, 300),
        functionDesc: str(r.functionDesc, 300),
        storyRole: str(r.storyRole, 300),
        ownerName: str(r.ownerName, 100),
        continuityLock: str(r.continuityLock, 300),
        forbiddenChanges: str(r.forbiddenChanges, 300),
        textPolicy: validPolicies.includes(textPolicy) ? textPolicy : 'no_readable_text',
        readableText: str(r.readableText, 200),
        states,
      };
    });
    return { worldView, styleBible, characters, locations, props: draftProps };
  }

  /** 题材模板：无模型时也要给出一套能直接用于后续生成的视觉基线 */
  private themeOf(text: string) {
    const t = text.toLowerCase();
    if (/赛博|科幻|未来|机器人|太空|霓虹|ai|全息/.test(t)) return {
      era: '近未来高科技都市，人工智能与巨型企业主导日常', geography: '垂直分层的巨型城市，高空新区与湿冷旧城区割裂',
      socialRules: '企业掌控秩序，数据身份决定阶层，地下情报交易活跃', artStyle: '赛博朋克写实，冷调科技感混少量东方元素',
      colorSystem: '青蓝为主，霓虹粉与警示橙点缀', visualStyle: '电影感写实 + 轻微胶片颗粒，夜戏为主',
      cameraLanguage: '手持跟拍与低机位广角交替，情绪镜头缓慢推近', colorPalette: '青蓝 / 品红 / 暖橙三点对比',
      lighting: '低调布光，霓虹轮廓光与湿地面反射', texture: '湿漉街面、金属拉丝、皮革与全息玻璃',
      motionLanguage: '快切推进，关键瞬间升格慢动作', subtitleStyle: '底部居中白字细黑描边，无衬线',
    };
    if (/古装|古代|宫廷|仙侠|武侠|江湖|唐朝|宋朝|民国|王朝/.test(t)) return {
      era: '古代王朝，礼制森严、门第分明', geography: '宫城与市井并立，庭院、长廊、山水远景构成主要空间',
      socialRules: '宗族与礼法高于个人意愿，身份决定言行尺度', artStyle: '东方古典写实，留白构图与低饱和设色',
      colorSystem: '黛青、朱砂、月白、沉金', visualStyle: '工笔质感与电影级柔光，讲究对称与留白',
      cameraLanguage: '稳定长镜与横向缓移，对称构图，情绪处用特写', colorPalette: '低饱和青灰 + 朱砂点缀',
      lighting: '自然光为主，窗棂侧光与烛火暖光', texture: '木构、绢帛、青砖、宣纸颗粒',
      motionLanguage: '舒缓推拉，动作段落短切但不碎', subtitleStyle: '底部居中宋体白字，淡墨底',
    };
    if (/悬疑|犯罪|凶案|侦探|警|追查|失踪|真相/.test(t)) return {
      era: '当代社会，信息不对称与旧案牵连当下', geography: '阴雨城市、旧公寓、地下室与审讯室等封闭空间',
      socialRules: '表面秩序下存在灰色地带，人人都有未说出口的动机', artStyle: '新黑色电影写实，高反差低调布光',
      colorSystem: '冷灰蓝为底，局部暖黄光源', visualStyle: '高对比写实，颗粒感与浅景深',
      cameraLanguage: '定点长镜 + 门框遮挡构图，关键信息给特写', colorPalette: '冷灰 / 深蓝 / 琥珀',
      lighting: '硬侧光、百叶窗投影、单一光源', texture: '潮湿墙面、磨旧皮革、纸张与毛玻璃',
      motionLanguage: '克制缓慢，揭露段落突然加速', subtitleStyle: '底部居中白字，细阴影',
    };
    if (/校园|青春|学生|恋爱|甜|毕业/.test(t)) return {
      era: '当代校园与城市生活', geography: '教室、走廊、操场、放学路上的街角',
      socialRules: '同龄人关系与家庭期待构成主要张力', artStyle: '清新自然写实，柔和日系色调',
      colorSystem: '米白、浅蓝、奶油黄', visualStyle: '自然光写实，轻微柔焦与逆光',
      cameraLanguage: '肩高平视与轻微手持，对话用正反打', colorPalette: '低对比高明度暖色',
      lighting: '午后侧逆光、窗边柔光', texture: '木质课桌、棉质校服、粉笔灰',
      motionLanguage: '稳定舒缓，情绪高点用慢镜', subtitleStyle: '底部居中圆体白字，淡描边',
    };
    return {
      era: '当代城市生活，时间线与现实接近', geography: '城市街区、室内居所与工作场所为主',
      socialRules: '现代都市规则，人物关系与现实利益驱动剧情', artStyle: '现代电影感写实',
      colorSystem: '中性灰蓝为底，情绪段落用暖色区分', visualStyle: '自然写实的电影质感，避免过度风格化',
      cameraLanguage: '中景与特写为主，对话正反打，情绪段落缓推', colorPalette: '低饱和中性色 + 单一强调色',
      lighting: '自然光与柔和补光结合，夜戏保留环境光源', texture: '真实材质，轻微胶片颗粒',
      motionLanguage: '以叙事清晰度优先，节奏随情绪起伏', subtitleStyle: '底部居中白字黑描边，字号适中',
    };
  }

  /** 确定性抽取：对白前缀识别角色、场次标题识别场景；不编造具体人名 */
  private fallbackDraft(
    script: string,
    meta: { title: string; genre: string; artStyle: string },
  ): BibleDraft {
    const theme = this.themeOf(`${script}\n${meta.genre}\n${meta.artStyle}`);
    const worldView: WorldView = {
      era: theme.era, geography: theme.geography, socialRules: theme.socialRules,
      artStyle: theme.artStyle, colorSystem: theme.colorSystem,
    };
    const styleBible: StyleBible = {
      visualStyle: theme.visualStyle, cameraLanguage: theme.cameraLanguage,
      colorPalette: theme.colorPalette, lighting: theme.lighting, texture: theme.texture,
      motionLanguage: theme.motionLanguage, subtitleStyle: theme.subtitleStyle,
    };

    const lines = script.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const charMap = new Map<string, { count: number; quotes: string[]; actions: string[] }>();
    const locNames: string[] = [];
    const stop = new Set([
      '旁白', '画外音', '字幕', '提示', '注释', '导演', '备注', '时间', '地点', '人物',
      '场景', '镜头', '动作', '对白', '内心', 'OS', 'V.O', 'INT', 'EXT', '场', '第',
    ]);

    for (const line of lines) {
      const loc = line.match(/^(?:第\s*[零一二三四五六七八九十百\d]+\s*场|场景\s*\d*|INT\.?|EXT\.?|地点)\s*[：:·\-—]?\s*(.+)$/i);
      if (loc) {
        const name = loc[1]
          .replace(/[（(].*?[)）]/g, '')
          .split(/[，,。;；]/)[0]
          .trim()
          .slice(0, 60);
        if (name && locNames.length < 12 && !locNames.includes(name)) locNames.push(name);
      }
      const dlg = line.match(/^([^\s：:（）()【】\[\]{}<>0-9]{1,12})\s*(?:[（(][^)）]*[)）])?\s*[：:]\s*(.+)$/);
      if (!dlg) continue;
      const name = dlg[1].trim();
      if (stop.has(name) || name.length > 10 || /^(第|内景|外景|日|夜|早晨|黄昏|地点|时间)/.test(name)) continue;
      const info = charMap.get(name) ?? { count: 0, quotes: [], actions: [] };
      info.count += 1;
      if (info.quotes.length < 3) info.quotes.push(dlg[2].trim().slice(0, 60));
      charMap.set(name, info);
    }

    // 兼容「人物：林晚、陈舟」这类显式名单
    const castLine = lines.find((l) => /^(?:人物|角色|出场人物|主要人物)\s*[：:]/.test(l));
    if (castLine) {
      const rest = castLine.replace(/^(?:人物|角色|出场人物|主要人物)\s*[：:]\s*/, '');
      for (const piece of rest.split(/[、,，;；\s]+/)) {
        const name = piece.replace(/[（(].*?[)）]/g, '').trim().slice(0, 12);
        if (name && !stop.has(name) && !charMap.has(name)) {
          charMap.set(name, { count: 1, quotes: [], actions: [] });
        }
      }
    }

    // 补动作描写线索：台词之外出现该名字的行
    for (const line of lines) {
      for (const [name, info] of charMap) {
        if (info.actions.length >= 2 || line.startsWith(`${name}：`)) continue;
        if (line.includes(name) && line.length > name.length + 4) {
          info.actions.push(line.replace(/\s+/g, ' ').slice(0, 80));
        }
      }
    }

    const characters: DraftCharacter[] = [...charMap.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 8)
      .map(([name, info], i) => {
        const quotes = info.quotes.filter(Boolean);
        const actions = info.actions.filter(Boolean);
        const clue = [
          quotes.length ? `台词线索「${quotes.slice(0, 2).join(' / ')}」` : '',
          actions.length ? `动作线索「${actions[0]}」` : '',
        ].filter(Boolean).join('；');
        return {
          name,
          roleType: i === 0 ? '主角' : i < 3 ? '配角' : '群演',
          canonicalDescription:
            `${name}，${i === 0 ? '本片主要角色' : '本片出场角色'}。${clue || '请补充外貌与服装设定'}。` +
            '请在本页补全五官、发型、服装等一致性锚点，避免后续镜头形象漂移。',
          forbiddenChanges: '保持面部特征、发型与服装在所有镜头中一致，不得擅自更换',
          identityDescriptor: `${name}：${i === 0 ? '主角' : '出场角色'}，请补全脸型、肤色、体态、发型与稳定配色的静态描述，跨镜逐字复用。`,
          wardrobe: '请补充基础服装标识（款式、颜色、材质、鞋型）',
          voiceLock: i === 0 ? '请补充口音、音色、语速与情绪受压时的变化' : '',
          signatureDetails: '请补充至少两处不可变签名细节（如银戒、眉骨疤）',
        };
      });

    const night = /夜|深夜|凌晨|晚上/.test(script);
    const locations: DraftLocation[] = (locNames.length > 0 ? locNames : ['主场景（请改名）'])
      .slice(0, 10)
      .map((name) => ({
        name,
        locationType: /外|街|广场|户外|路|桥|院|EXT/i.test(name) ? '外景' : '内景',
        timeOfDay: night ? '夜' : '日',
        lighting: theme.lighting,
        colorPalette: theme.colorPalette,
        architecture: `${theme.texture}；请按剧本补充空间结构与陈设`,
        description: `${name}。${theme.lighting}，${theme.colorPalette}。请补充可辨识的空间细节作为概念图一致性锚点。`,
      }));

    // 确定性道具抽取：只认会被拿取 / 传递 / 打开 / 读取 / 反复出现的物件，
    // 纯背景陈设不建资产（与 worldwonderer/drama-skills 的边界一致）。
    const lexicon: {
      key: RegExp; name: string; anchors: string; scale: string;
      states: { name: string; description: string }[];
    }[] = [
      { key: /钥匙|门禁卡|房卡/g, name: '钥匙', anchors: '单柄齿状金属钥匙，齿形与钥匙头刻痕为永久标记', scale: '约成人手掌三分之一长', states: [{ name: '持有', description: '初始由所有人携带' }, { name: '转手', description: '交出后持有人变化，形制不变' }] },
      { key: /手机|电话|通话/g, name: '手机', anchors: '直板触屏手机，边框磨损与保护壳颜色为永久标记', scale: '约成人手掌长', states: [{ name: '亮屏', description: '可读内容出现' }, { name: '熄屏', description: '仅外观可见' }] },
      { key: /纸条|字条|便签|信纸|信封/g, name: '纸条', anchors: '矩形纸片，折痕、纸质与边缘缺口为永久标记', scale: '约手掌大小', states: [{ name: '折叠', description: '未展开，内容不可见' }, { name: '展开', description: '内容出镜，文字按政策处理' }] },
      { key: /照片|相片|合影/g, name: '照片', anchors: '矩形相纸，边角磨损与背面笔迹为永久标记', scale: '约手掌大小', states: [{ name: '完好', description: '初始状态' }, { name: '破损', description: '撕裂或烧毁后全片沿用' }] },
      { key: /盒子|匣子|铁匣|木盒|首饰盒/g, name: '匣子', anchors: '带铰链盖的扁长盒体，边角凹陷与合页样式为永久标记', scale: '手掌至小臂长', states: [{ name: '闭合·有内容物', description: '初始闭合，内置物未露面' }, { name: '打开·空', description: '被取走后全片沿用' }] },
      { key: /合同|文件|档案|卷宗/g, name: '文件', anchors: '装订纸册，封面颜色、装订方式与印章位置为永久标记', scale: 'A4 纸张大小', states: [{ name: '合起', description: '仅封面可见' }, { name: '翻开', description: '内页按可读文字政策处理' }] },
      { key: /录音笔|录音|监听器/g, name: '录音笔', anchors: '细长条状录音设备，按键排列与外壳划痕为永久标记', scale: '约手指长', states: [{ name: '待机', description: '未启用' }, { name: '录制中', description: '指示灯可见，启用后状态需写明来源' }] },
      { key: /U盘|优盘|硬盘|存储卡/g, name: 'U盘', anchors: '小型直插式存储设备，外壳颜色与挂绳为永久标记', scale: '约拇指长', states: [{ name: '未插入', description: '随身携带' }, { name: '已读取', description: '内容已揭示，后续沿用' }] },
      { key: /监控|摄像头|录像/g, name: '监控画面', anchors: '固定机位画面，网格、时间戳样式与机位视角为永久标记', scale: '屏幕内画幅，与人物按同框比例呈现', states: [{ name: '实时', description: '当前时段画面' }, { name: '回放', description: '带时间戳的历史画面' }] },
      { key: /戒指|项链|手链|玉佩/g, name: '饰物', anchors: '贴身佩戴饰物，材质、镶嵌物与磨损位置为永久标记', scale: '指节至掌心大小', states: [{ name: '佩戴', description: '由所有人佩戴' }, { name: '摘下/转手', description: '归属变化需写清有效范围' }] },
      { key: /手表|怀表|时钟/g, name: '表', anchors: '圆形表盘配表带，表盘刻度与表壳划痕为永久标记', scale: '腕部尺寸', states: [{ name: '走时', description: '正常状态' }, { name: '停摆', description: '停摆后时间不再变化' }] },
      { key: /药|药瓶|药片|针剂/g, name: '药瓶', anchors: '小瓶装药剂，瓶身标签形状与封口方式为永久标记', scale: '约掌心高', states: [{ name: '未开封', description: '满瓶' }, { name: '已使用', description: '剩余量变化需逐场登记' }] },
      { key: /茶盏|杯子|酒杯|咖啡杯/g, name: '杯', anchors: '单柄杯具，釉色与杯口缺口为永久标记', scale: '单手可握', states: [{ name: '满', description: '内有液体' }, { name: '空/摔碎', description: '破损后全片沿用' }] },
      { key: /伞|雨伞/g, name: '伞', anchors: '长柄折伞，伞骨数量与握把材质为永久标记', scale: '约半人高', states: [{ name: '收拢', description: '未撑开' }, { name: '撑开', description: '雨天场景沿用' }] },
      { key: /刀|匕首|剪刀/g, name: '利器', anchors: '短刃器具，刃口形状与柄部缠绳为永久标记', scale: '约小臂长', states: [{ name: '收纳', description: '未出鞘' }, { name: '持握', description: '出镜后需写明持有人' }] },
      { key: /包裹|快递|箱子/g, name: '包裹', anchors: '封装箱体，封箱胶带走向与手写标记为永久标记', scale: '双手可抱', states: [{ name: '未拆', description: '内容物未知' }, { name: '已拆', description: '内容物露面后全片沿用' }] },
      { key: /日记|笔记本|账本/g, name: '本子', anchors: '装订本册，封面材质与书脊磨损为永久标记', scale: '约 A5 大小', states: [{ name: '合起', description: '仅封面可见' }, { name: '翻开', description: '内页按可读文字政策处理' }] },
    ];
    const draftProps: DraftProp[] = lexicon
      .map((p) => ({ p, n: (script.match(p.key) ?? []).length }))
      .filter((x) => x.n > 0)
      .sort((a, b) => b.n - a.n)
      .slice(0, 6)
      .map(({ p }) => ({
        name: p.name,
        category: p.name === '匣子' || p.name === '文件' ? 'stateful' : 'recurring',
        identityAnchors: p.anchors,
        appearance: '请按剧本补充形状、颜色、材质与磨损细节',
        scaleReference: p.scale,
        functionDesc: '请按剧本补充原本功能与操作方式',
        storyRole: `剧本中反复出现（${p.name}），需跨镜保持一致`,
        continuityLock: `${p.name}的形制、材质与永久标记`,
        forbiddenChanges: '不得擅自改变形制、颜色、材质与永久标记',
        textPolicy: 'no_readable_text',
        states: p.states,
      }));

    return { worldView, styleBible, characters, locations, props: draftProps };
  }

  /** 模型结果与确定性草稿合并，保证每个字段都有内容 */
  private mergeDraft(primary: BibleDraft, filler: BibleDraft): BibleDraft {
    const worldView = emptyWorld();
    for (const k of WORLD_KEYS) worldView[k] = primary.worldView[k]?.trim() || filler.worldView[k];
    const styleBible = emptyStyle();
    for (const k of STYLE_KEYS) styleBible[k] = primary.styleBible[k]?.trim() || filler.styleBible[k];
    const characters = (primary.characters.length ? primary.characters : filler.characters).map((c) => ({
      ...c,
      canonicalDescription:
        c.canonicalDescription?.trim() || `${c.name}，请补充外貌与服装等跨镜一致性描述。`,
      forbiddenChanges:
        c.forbiddenChanges?.trim() || '保持面部特征、发型与服装在所有镜头中一致，不得擅自更换',
      identityDescriptor:
        c.identityDescriptor?.trim() || c.canonicalDescription?.trim() || `${c.name}，请补全静态身份锁。`,
      wardrobe: c.wardrobe?.trim() || c.costume?.trim() || '',
      voiceLock: c.voiceLock?.trim() || c.voiceType?.trim() || '',
      signatureDetails: c.signatureDetails?.trim() || '',
    }));
    const locations = (primary.locations.length ? primary.locations : filler.locations).map((l) => ({
      ...l,
      description: l.description?.trim() || `${l.name}。请补充可辨识的空间细节。`,
    }));
    const mergedProps = (primary.props.length ? primary.props : filler.props).map((p) => ({
      ...p,
      identityAnchors: p.identityAnchors?.trim() || `${p.name}。请补全形制、材质与永久唯一标记。`,
      scaleReference: p.scaleReference?.trim() || '请补充与人体或熟悉物件的可比尺寸',
      continuityLock: p.continuityLock?.trim() || `${p.name}的形制、材质与永久标记`,
      states: p.states?.length ? p.states : [{ name: '初始', description: '初始状态，请按剧本补充' }],
    }));
    return { worldView, styleBible, characters, locations, props: mergedProps };
  }

  /** 落库：fill 只补空白、跳过 locked；overwrite 覆盖文本但保留参考图与锁定状态 */
  private async persistBible(
    projectId: string,
    draft: BibleDraft,
    mode: 'fill' | 'overwrite',
  ): Promise<Omit<GenerateBibleResponse, 'source' | 'note'>> {
    const counts: GenerateBibleCounts = {
      worldViewFields: 0, styleFields: 0,
      charactersCreated: 0, charactersUpdated: 0,
      locationsCreated: 0, locationsUpdated: 0,
      propsCreated: 0, propsUpdated: 0,
    };

    const curWv = (await this.getWorldview(projectId)) ?? emptyWorld();
    const curSt = (await this.getStyle(projectId)) ?? emptyStyle();
    const nextWv: WorldView = { ...curWv };
    const nextSt: StyleBible = { ...curSt };
    for (const k of WORLD_KEYS) {
      const incoming = draft.worldView[k]?.trim() ?? '';
      if (!incoming) continue;
      if (mode === 'fill' && (curWv[k] ?? '').trim()) continue;
      nextWv[k] = incoming;
      counts.worldViewFields += 1;
    }
    for (const k of STYLE_KEYS) {
      const incoming = draft.styleBible[k]?.trim() ?? '';
      if (!incoming) continue;
      if (mode === 'fill' && (curSt[k] ?? '').trim()) continue;
      nextSt[k] = incoming;
      counts.styleFields += 1;
    }
    await this.updateWorldview(projectId, nextWv);
    await this.updateStyle(projectId, nextSt);

    const existingChars = await this.listCharacters(projectId);
    const charByName = new Map(existingChars.map((c) => [c.name.trim(), c]));
    let charOrder = existingChars.length;
    for (const c of draft.characters) {
      const name = c.name.trim().slice(0, 100);
      if (!name) continue;
      const found = charByName.get(name);
      if (found) {
        if (found.locked) continue;
        const patch: UpdateCharacterRequest = {};
        const cur = found as unknown as Record<string, unknown>;
        for (const k of CHAR_KEYS) {
          const incoming = (c as unknown as Record<string, unknown>)[k];
          if (incoming === undefined || incoming === '') continue;
          if (mode === 'fill' && String(cur[k] ?? '').trim()) continue;
          (patch as Record<string, unknown>)[k] = incoming;
        }
        // 文本锁落在 identity_kit jsonb：不覆盖已有的主图 / 四视图
        const kit: CharacterIdentityKit = { ...(found.identityKit ?? emptyIdentityKit()) };
        kit.views = { ...(kit.views ?? {}) };
        let kitTouched = false;
        for (const k of CHAR_KIT_KEYS) {
          const incoming = str((c as unknown as Record<string, unknown>)[k], 600);
          if (!incoming) continue;
          const key = k as keyof CharacterIdentityKit;
          if (mode === 'fill' && String(kit[key] ?? '').trim()) continue;
          (kit as unknown as Record<string, unknown>)[key] = incoming;
          kitTouched = true;
        }
        if (kitTouched) {
          kit.updatedAt = new Date().toISOString();
          patch.identityKit = kit;
        }
        if (Object.keys(patch).length > 0) {
          await this.updateCharacter(projectId, found.id, patch);
          counts.charactersUpdated += 1;
        }
      } else {
        await this.db.insert(characters).values({
          projectId,
          name,
          roleType: c.roleType || '配角',
          age: c.age,
          gender: c.gender,
          faceFeatures: c.faceFeatures,
          hairstyle: c.hairstyle,
          costume: c.costume,
          accessories: c.accessories,
          personality: c.personality,
          voiceType: c.voiceType,
          canonicalDescription: c.canonicalDescription,
          forbiddenChanges: c.forbiddenChanges,
          referenceImageUrls: [],
          identityKit: {
            ...emptyIdentityKit(),
            identityDescriptor: c.identityDescriptor,
            wardrobe: c.wardrobe,
            voiceLock: c.voiceLock,
            signatureDetails: c.signatureDetails,
            updatedAt: new Date().toISOString(),
          },
          locked: false,
          sortOrder: charOrder++,
        });
        counts.charactersCreated += 1;
      }
    }

    const existingLocs = await this.listLocations(projectId);
    const locByName = new Map(existingLocs.map((l) => [l.name.trim(), l]));
    let locOrder = existingLocs.length;
    for (const l of draft.locations) {
      const name = l.name.trim().slice(0, 100);
      if (!name) continue;
      const found = locByName.get(name);
      if (found) {
        if (found.locked) continue;
        const patch: UpdateLocationRequest = {};
        const cur = found as unknown as Record<string, unknown>;
        for (const k of LOC_KEYS) {
          const incoming = (l as unknown as Record<string, unknown>)[k];
          if (incoming === undefined || incoming === '') continue;
          if (mode === 'fill' && String(cur[k] ?? '').trim()) continue;
          (patch as Record<string, unknown>)[k] = incoming;
        }
        if (Object.keys(patch).length > 0) {
          await this.updateLocation(projectId, found.id, patch);
          counts.locationsUpdated += 1;
        }
      } else {
        await this.db.insert(locations).values({
          projectId,
          name,
          locationType: l.locationType || '内景',
          timeOfDay: l.timeOfDay || '日',
          weather: l.weather,
          architecture: l.architecture,
          furniture: l.furniture,
          lighting: l.lighting,
          colorPalette: l.colorPalette,
          description: l.description,
          referenceImageUrls: [],
          locked: false,
          sortOrder: locOrder++,
        });
        counts.locationsCreated += 1;
      }
    }

    // 道具：身份只创建一次，fill 不覆盖用户已编辑的锚点与参考图；
    // 状态变体是同一道具的状态，不拆成多个道具。
    const existingProps = await this.listProps(projectId);
    const propByName = new Map(existingProps.map((p) => [p.name.trim(), p]));
    const allChars = await this.listCharacters(projectId);
    const charIdByName = new Map(allChars.map((c) => [c.name.trim(), c.id]));
    let propOrder = existingProps.length;
    let propSeq = existingProps.length;
    for (const p of draft.props) {
      const name = p.name.trim().slice(0, 100);
      if (!name) continue;
      const states: PropStateVariant[] = (p.states ?? []).map((s) => ({
        id: randomUUID(),
        name: s.name,
        description: s.description,
      }));
      const ownerId = p.ownerName ? charIdByName.get(p.ownerName.trim()) : undefined;
      const found = propByName.get(name);
      if (found) {
        if (found.locked) continue;
        const patch: UpdatePropRequest = {};
        const cur = found as unknown as Record<string, unknown>;
        for (const k of PROP_KEYS) {
          const incoming = (p as unknown as Record<string, unknown>)[k];
          if (incoming === undefined || incoming === '') continue;
          if (mode === 'fill' && String(cur[k] ?? '').trim()) continue;
          (patch as Record<string, unknown>)[k] = incoming;
        }
        if (states.length && (mode === 'overwrite' || !found.stateVariants?.length)) {
          patch.stateVariants = states;
        }
        if (ownerId && (mode === 'overwrite' || !found.ownerCharacterId)) {
          patch.ownerCharacterId = ownerId;
        }
        if (Object.keys(patch).length > 0) {
          await this.updateProp(projectId, found.id, patch);
          counts.propsUpdated += 1;
        }
      } else {
        propSeq += 1;
        await this.db.insert(props).values({
          projectId,
          name,
          code: `PROP${String(propSeq).padStart(3, '0')}`,
          category: p.category || 'recurring',
          identityAnchors: p.identityAnchors,
          appearance: p.appearance,
          scaleReference: p.scaleReference,
          functionDesc: p.functionDesc,
          storyRole: p.storyRole,
          ownerCharacterId: ownerId ?? null,
          continuityLock: p.continuityLock,
          forbiddenChanges: p.forbiddenChanges,
          textPolicy: p.textPolicy || 'no_readable_text',
          readableText: p.readableText,
          stateVariants: states,
          referenceImageUrls: [],
          locked: false,
          sortOrder: propOrder++,
        });
        counts.propsCreated += 1;
      }
    }

    return {
      worldView: nextWv,
      styleBible: nextSt,
      characters: allChars,
      locations: await this.listLocations(projectId),
      props: await this.listProps(projectId),
      counts,
    };
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
      identityKit: (row.identityKit as CharacterIdentityKit | null) ?? emptyIdentityKit(),
      episodeId: row.episodeId ?? undefined,
      lockAnchors: Array.isArray(row.lockAnchors) ? (row.lockAnchors as string[]) : [],
      anchorUpdatedAt: row.anchorUpdatedAt ? row.anchorUpdatedAt.toISOString() : undefined,
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

  private mapProp(row: typeof props.$inferSelect): Prop {
    const variants = (row.stateVariants as PropStateVariant[] | null) ?? [];
    return {
      id: row.id,
      projectId: row.projectId,
      code: row.code ?? '',
      name: row.name,
      category: (row.category as Prop['category']) ?? 'recurring',
      identityAnchors: row.identityAnchors ?? '',
      appearance: row.appearance ?? '',
      scaleReference: row.scaleReference ?? '',
      functionDesc: row.functionDesc ?? '',
      storyRole: row.storyRole ?? '',
      ownerCharacterId: row.ownerCharacterId ?? undefined,
      continuityLock: row.continuityLock ?? '',
      forbiddenChanges: row.forbiddenChanges ?? '',
      textPolicy: (row.textPolicy as Prop['textPolicy']) ?? 'no_readable_text',
      readableText: row.readableText ?? undefined,
      stateVariants: Array.isArray(variants) ? variants : [],
      referenceImageUrls: row.referenceImageUrls ?? [],
      locked: row.locked,
      sortOrder: row.sortOrder,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
