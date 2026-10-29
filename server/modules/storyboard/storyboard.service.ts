import { Injectable, Inject, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { scenes, shots, characters, generationJobs, projects, assets } from '@server/database/schema';
import { eq, desc, and, count, inArray, lt } from 'drizzle-orm';
import type {
  Scene,
  Shot,
  WhitemodelMeta,
  Dialogue,
  SceneAction,
  ParseScriptResponse,
  ScriptJobResponse,
  StorySkillId,
} from '@shared/api.interface';
import {
  CAMERA_ANGLE_LABELS,
  SHOT_SIZE_LABELS,
  CAMERA_RIGS,
  LEGACY_MOVEMENT_LABELS,
  movementLabel,
  rigById,
} from '@shared/camera-rigs';
import { estimateSpeechSeconds, keywordSimilarity, REUSE_MATCH_THRESHOLD } from '@shared/text-metrics';
import {
  buildFivePart,
  CINEMATIC_NEGATIVE,
  styleBibleToStyle,
  type StyleBibleLike,
} from '@shared/prompt-formula';
import {
  ruleDeadTime,
  ruleDialogueOverflow,
  ruleLocalWhitemodel,
  ruleLongLines,
  ruleNoFirstFrame,
  ruleSubtitleDrift,
  ruleUnknownMovement,
  ruleWhitemodelMismatch,
  type RuleHit,
} from '@shared/qc-rules';
import { BudgetCapService } from '../generation/budget-cap.service';
import { StorySkillsService, type RigRunResult } from '../story-skills/story-skills.service';
import { buildSheetPrompt } from '../story-skills/skills';
import { getStylePreset } from '../story-skills/styles';

@Injectable()
export class StoryboardService {
  private readonly logger = new Logger(StoryboardService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    private readonly budgetCap: BudgetCapService,
    private readonly storySkills: StorySkillsService,
  ) {}

  // ========== Scenes ==========
  async listScenes(projectId: string): Promise<Scene[]> {
    const rows = await this.db
      .select()
      .from(scenes)
      .where(eq(scenes.projectId, projectId))
      .orderBy(scenes.sceneNumber, desc(scenes.createdAt));
    return rows.map((r) => this.mapScene(r));
  }

  async getScene(projectId: string, id: string): Promise<Scene> {
    const rows = await this.db.select().from(scenes).where(eq(scenes.id, id));
    if (rows.length === 0 || rows[0].projectId !== projectId) {
      throw new NotFoundException('场景不存在');
    }
    return this.mapScene(rows[0]);
  }

  async createScene(
    projectId: string,
    dto: Partial<Scene>,
  ): Promise<Scene> {
    const countResult = await this.db
      .select({ count: count() })
      .from(scenes)
      .where(eq(scenes.projectId, projectId));
    const nextNumber = Number(countResult[0].count) + 1;

    const rows = await this.db
      .insert(scenes)
      .values({
        projectId,
        sceneNumber: dto.sceneNumber ?? nextNumber,
        title: dto.title,
        locationId: dto.locationId,
        timeOfDay: dto.timeOfDay,
        summary: dto.summary,
        emotion: dto.emotion,
        characterIds: dto.characterIds ?? [],
        dialogues: (dto.dialogues ?? []) as Dialogue[],
        actions: (dto.actions ?? []) as SceneAction[],
        props: dto.props ?? [],
        sortOrder: dto.sortOrder ?? nextNumber,
      })
      .returning();
    return this.mapScene(rows[0]);
  }

  async updateScene(
    projectId: string,
    id: string,
    dto: Partial<Scene>,
  ): Promise<Scene> {
    const patch: Record<string, unknown> = {};
    if (dto.sceneNumber !== undefined) patch.sceneNumber = dto.sceneNumber;
    if (dto.title !== undefined) patch.title = dto.title;
    if (dto.locationId !== undefined) patch.locationId = dto.locationId;
    if (dto.timeOfDay !== undefined) patch.timeOfDay = dto.timeOfDay;
    if (dto.summary !== undefined) patch.summary = dto.summary;
    if (dto.emotion !== undefined) patch.emotion = dto.emotion;
    if (dto.characterIds !== undefined) patch.characterIds = dto.characterIds;
    if (dto.dialogues !== undefined) patch.dialogues = dto.dialogues;
    if (dto.actions !== undefined) patch.actions = dto.actions;
    if (dto.props !== undefined) patch.props = dto.props;
    if (dto.sortOrder !== undefined) patch.sortOrder = dto.sortOrder;

    if (Object.keys(patch).length === 0) {
      return this.getScene(projectId, id);
    }
    patch.updatedAt = new Date();

    // P0 安全修复：写操作必须同时匹配 id + projectId，防止跨项目越权（IDOR）
    const rows = await this.db
      .update(scenes)
      .set(patch)
      .where(and(eq(scenes.id, id), eq(scenes.projectId, projectId)))
      .returning();
    if (rows.length === 0) throw new NotFoundException('场景不存在');
    return this.mapScene(rows[0]);
  }

  async deleteScene(projectId: string, id: string): Promise<void> {
    const rows = await this.db
      .delete(scenes)
      .where(and(eq(scenes.id, id), eq(scenes.projectId, projectId)))
      .returning({ id: scenes.id });
    if (rows.length === 0) throw new NotFoundException('场景不存在');
  }

  // ========== Shots ==========
  async listShots(projectId: string, sceneId?: string): Promise<Shot[]> {
    const conditions = [eq(shots.projectId, projectId)];
    if (sceneId) conditions.push(eq(shots.sceneId, sceneId));
    const rows = await this.db
      .select()
      .from(shots)
      .where(and(...conditions))
      .orderBy(shots.shotNumber, desc(shots.createdAt));
    return rows.map((r) => this.mapShot(r));
  }

  async getShot(projectId: string, id: string): Promise<Shot> {
    const rows = await this.db.select().from(shots).where(eq(shots.id, id));
    if (rows.length === 0 || rows[0].projectId !== projectId) {
      throw new NotFoundException('分镜不存在');
    }
    return this.mapShot(rows[0]);
  }

  async createShot(
    projectId: string,
    dto: Partial<Shot> & { sceneId: string },
  ): Promise<Shot> {
    if (!dto.sceneId) throw new BadRequestException('sceneId 不能为空');
    // P0 安全修复：确认 scene 归属本项目，防止传入他项目的 sceneId 建镜
    await this.getScene(projectId, dto.sceneId);

    const countResult = await this.db
      .select({ count: count() })
      .from(shots)
      .where(and(eq(shots.projectId, projectId), eq(shots.sceneId, dto.sceneId)));
    const nextNumber = Number(countResult[0].count) + 1;

    const rows = await this.db
      .insert(shots)
      .values({
        projectId,
        sceneId: dto.sceneId,
        shotNumber: dto.shotNumber ?? nextNumber,
        duration: dto.duration?.toString() ?? '4.0',
        shotSize: dto.shotSize ?? 'medium',
        cameraAngle: dto.cameraAngle ?? 'eye_level',
        lens: dto.lens ?? '50mm',
        movement: dto.movement ?? 'static',
        subject: dto.subject,
        action: dto.action,
        emotion: dto.emotion,
        dialogue: dto.dialogue,
        visualPrompt: dto.visualPrompt,
        negativePrompt: dto.negativePrompt,
        startFrameUrl: dto.startFrameUrl,
        endFrameUrl: dto.endFrameUrl,
        referenceImageUrls: dto.referenceImageUrls ?? [],
        videoUrl: dto.videoUrl,
        voiceUrl: dto.voiceUrl,
        sfxUrls: dto.sfxUrls ?? [],
        subtitleText: dto.subtitleText,
        characterIds: dto.characterIds ?? [],
        status: dto.status ?? 'draft',
        sortOrder: dto.sortOrder ?? nextNumber,
      })
      .returning();
    return this.mapShot(rows[0]);
  }

  async updateShot(
    projectId: string,
    id: string,
    dto: Partial<Shot>,
  ): Promise<Shot> {
    const patch: Record<string, unknown> = {};
    if (dto.shotNumber !== undefined) patch.shotNumber = dto.shotNumber;
    if (dto.duration !== undefined) patch.duration = dto.duration.toString();
    if (dto.shotSize !== undefined) patch.shotSize = dto.shotSize;
    if (dto.cameraAngle !== undefined) patch.cameraAngle = dto.cameraAngle;
    if (dto.lens !== undefined) patch.lens = dto.lens;
    if (dto.movement !== undefined) patch.movement = dto.movement;
    if (dto.subject !== undefined) patch.subject = dto.subject;
    if (dto.action !== undefined) patch.action = dto.action;
    if (dto.emotion !== undefined) patch.emotion = dto.emotion;
    if (dto.dialogue !== undefined) patch.dialogue = dto.dialogue;
    if (dto.visualPrompt !== undefined) patch.visualPrompt = dto.visualPrompt;
    if (dto.negativePrompt !== undefined) patch.negativePrompt = dto.negativePrompt;
    if (dto.startFrameUrl !== undefined) patch.startFrameUrl = dto.startFrameUrl;
    if (dto.endFrameUrl !== undefined) patch.endFrameUrl = dto.endFrameUrl;
    // 白模产线：空串视为清除绑定，与 null 同义
    if (dto.whitemodelUrl !== undefined)
      patch.whitemodelUrl = dto.whitemodelUrl || null;
    if (dto.whitemodelMeta !== undefined) patch.whitemodelMeta = dto.whitemodelMeta;
    if (dto.referenceImageUrls !== undefined)
      patch.referenceImageUrls = dto.referenceImageUrls;
    if (dto.videoUrl !== undefined) patch.videoUrl = dto.videoUrl;
    if (dto.voiceUrl !== undefined) patch.voiceUrl = dto.voiceUrl;
    if (dto.sfxUrls !== undefined) patch.sfxUrls = dto.sfxUrls;
    if (dto.subtitleText !== undefined) patch.subtitleText = dto.subtitleText;
    if (dto.characterIds !== undefined) patch.characterIds = dto.characterIds;
    if (dto.locked !== undefined) patch.locked = dto.locked;
    if (dto.status !== undefined) patch.status = dto.status;
    if (dto.sortOrder !== undefined) patch.sortOrder = dto.sortOrder;

    if (Object.keys(patch).length === 0) {
      return this.getShot(projectId, id);
    }
    patch.updatedAt = new Date();

    // P0 安全修复：写操作必须同时匹配 id + projectId，防止跨项目越权（IDOR）
    const rows = await this.db
      .update(shots)
      .set(patch)
      .where(and(eq(shots.id, id), eq(shots.projectId, projectId)))
      .returning();
    if (rows.length === 0) throw new NotFoundException('分镜不存在');
    return this.mapShot(rows[0]);
  }

  async deleteShot(projectId: string, id: string): Promise<void> {
    const rows = await this.db
      .delete(shots)
      .where(and(eq(shots.id, id), eq(shots.projectId, projectId)))
      .returning({ id: shots.id });
    if (rows.length === 0) throw new NotFoundException('分镜不存在');
  }

  async generateShotImage(
    projectId: string,
    id: string,
  ): Promise<{ jobId: string }> {
    // P1 超预算拦截：所有任务创建入口统一守卫
    await this.budgetCap.assertAllowed();
    const shot = await this.getShot(projectId, id);
    // W4 一致性：自动带入本镜角色的参考图（最多 3 张），保证跨镜角色一致
    const charRefs = await this.characterReferenceUrls(projectId, shot.characterIds ?? []);
    const rows = await this.db
      .insert(generationJobs)
      .values({
        projectId,
        jobType: 'image',
        targetType: 'shot',
        targetId: shot.id,
        status: 'pending',
        inputData: {
          prompt: shot.visualPrompt ?? shot.subject ?? '',
          negativePrompt: shot.negativePrompt ?? '',
          references: [...(shot.referenceImageUrls ?? []), ...charRefs],
        },
      })
      .returning({ id: generationJobs.id });
    await this.markShotQueued(projectId, shot.id);
    return { jobId: rows[0].id };
  }

  /**
   * V6 视频任务输入组装（单镜与批量共用同一份，保证批量视频同样带
   * 首帧/白模/尾帧链/时长/运镜事实；preflight 警告只在单镜返回，批量走 QC）。
   */
  private async buildVideoJobInput(
    projectId: string,
    shot: Shot,
  ): Promise<{
    prompt: string;
    duration: number;
    references: string[];
    chainedFrom?: { shotId: string; kind: 'endFrame' | 'video' };
  }> {
    // P1 修复：duration 可空/非法时回落 4s，避免 NaN 进入视频 prompt
    const parsedDuration = Number(shot.duration);
    const videoDuration =
      Number.isFinite(parsedDuration) && parsedDuration > 0 ? parsedDuration : 4;
    // P0-1 尾帧链（移植 YouHai/SDSmirnov/forge 三家验证的做法）：
    // 本镜无首帧图时，自动继承同场景上一镜的尾帧（优先）或成片（其次）作首帧参考，
    // 只填空不覆盖——已有首帧的镜头行为与旧版逐字节一致；来源记入 inputData备查。
    let firstFrameUrl = shot.startFrameUrl;
    let chainedFrom: { shotId: string; kind: 'endFrame' | 'video' } | undefined;
    if (!firstFrameUrl) {
      const prevRows = await this.db
        .select({ id: shots.id, endFrameUrl: shots.endFrameUrl, videoUrl: shots.videoUrl })
        .from(shots)
        .where(
          and(
            eq(shots.projectId, projectId),
            eq(shots.sceneId, shot.sceneId),
            lt(shots.shotNumber, shot.shotNumber),
          ),
        )
        .orderBy(desc(shots.shotNumber))
        .limit(1);
      const prev = prevRows[0];
      if (prev?.endFrameUrl) {
        firstFrameUrl = prev.endFrameUrl;
        chainedFrom = { shotId: prev.id, kind: 'endFrame' };
      } else if (prev?.videoUrl) {
        firstFrameUrl = prev.videoUrl;
        chainedFrom = { shotId: prev.id, kind: 'video' };
      }
    }
    // W4 一致性：首帧自动带入角色参考图
    const charRefs = await this.characterReferenceUrls(projectId, shot.characterIds ?? []);
    // 白模产线 · prompt 与白模同源（seedance-skill 铁律 6 的等价实现）：
    // prompt 里的运镜数字必须从镜头的结构化字段组装（实测事实），而不是手写形容词；
    // 有白模绑定时声明继承关系：空间/运镜/节奏继承白模，材质光影继承首帧图。
    const rig = rigById(shot.movement);
    const facts = [
      `时长${videoDuration}s`,
      SHOT_SIZE_LABELS[shot.shotSize] ?? shot.shotSize ?? '中景',
      movementLabel(shot.movement),
      shot.lens ?? '50mm',
      CAMERA_ANGLE_LABELS[shot.cameraAngle] ?? shot.cameraAngle ?? '平视',
    ].join('｜');
    const rigLine = rig ? `运镜：${rig.promptFragment}。` : '';
    const whitemodelLine = shot.whitemodelUrl
      ? '本镜已绑定白模参考：空间关系、运镜路径、时间节奏以白模为准，不继承白模的材质与颜色；材质、光线、造型以首帧图为准。'
      : '';
    // P1-1 五段式 prompt（移植 AdForge：Cinematography/Subject/Action/Context/Style，
    // 风格圣经逐字复用；网关无 negative 字段，负面约束拼进正文）。
    const projRows = await this.db
      .select({ styleBible: projects.styleBible, contentMode: projects.contentMode })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    const sceneRows = await this.db
      .select({ title: scenes.title, summary: scenes.summary })
      .from(scenes)
      .where(and(eq(scenes.projectId, projectId), eq(scenes.id, shot.sceneId)))
      .limit(1);
    const fivePart = buildFivePart({
      cinematography: `${rig?.promptFragment ?? movementLabel(shot.movement)}，${SHOT_SIZE_LABELS[shot.shotSize] ?? shot.shotSize ?? ''}，${shot.lens ?? ''}，${CAMERA_ANGLE_LABELS[shot.cameraAngle] ?? shot.cameraAngle ?? ''}`,
      subject: shot.subject,
      action: shot.visualPrompt ?? shot.action,
      context: [sceneRows[0]?.title, sceneRows[0]?.summary].filter(Boolean).join('：') || undefined,
      style: styleBibleToStyle(projRows[0]?.styleBible as StyleBibleLike | null),
    });
    const negativeLine = shot.negativePrompt?.trim()
      ? `避免：${shot.negativePrompt.trim()}`
      : CINEMATIC_NEGATIVE;
    const basePrompt = fivePart || shot.visualPrompt || shot.action || '';
    const fullPrompt = `【运镜事实】${facts}。${rigLine}${whitemodelLine}\n${basePrompt}\n${negativeLine}`.trim();
    return {
      prompt: fullPrompt,
      duration: videoDuration,
      // 首帧图保持第 0 位（worker 取 refs[0] 作 imageUrl）；
      // 白模排第 1 位：当前云端视频接口只消费首帧，白模随任务存档、
      // R2V 接口就绪后直接可用，不抢首帧位置。
      references: [...[firstFrameUrl, shot.whitemodelUrl, shot.endFrameUrl].filter(Boolean) as string[], ...charRefs],
      chainedFrom,
    };
  }

  async generateShotVideo(
    projectId: string,
    id: string,
    opts?: { strict?: boolean },
  ): Promise<{ jobId: string; warnings: string[] }> {
    await this.budgetCap.assertAllowed();
    const shot = await this.getShot(projectId, id);
    const built = await this.buildVideoJobInput(projectId, shot);
    // F3 硬门：与 QC 同一份规则；error 在 strict 模式下阻断（?strict=1），默认只警告。
    const { warnings, errors } = await this.preflightShot(projectId, shot, {
      videoDuration: built.duration,
      firstFrameUrl: built.references[0],
      chainedFrom: built.chainedFrom
        ? `${built.chainedFrom.kind}:${built.chainedFrom.shotId.slice(0, 8)}`
        : undefined,
    });
    if (opts?.strict && errors.length > 0) {
      throw new BadRequestException(`硬门阻断（strict）：${errors.join('；')}`);
    }
    const rows = await this.db
      .insert(generationJobs)
      .values({
        projectId,
        jobType: 'video',
        targetType: 'shot',
        targetId: shot.id,
        status: 'pending',
        inputData: {
          prompt: built.prompt,
          duration: built.duration,
          references: built.references,
          ...(built.chainedFrom ? { chainedFrom: built.chainedFrom } : {}),
          ...(warnings.length > 0 ? { preflight: warnings } : {}),
        },
      })
      .returning({ id: generationJobs.id });
    if (warnings.length > 0) {
      this.logger.warn(`视频任务 pre-flight 预警 ${rows[0].id}：${warnings.join('；')}`);
    }
    await this.markShotQueued(projectId, shot.id);
    return { jobId: rows[0].id, warnings };
  }

  /**
   * F3 生成前自检（与 QC 同一份 shared/qc-rules；复用候选为建议级 warning）：
   * warning 只警告不拦截；error 在 strict 模式下阻断（默认关闭）。
   */
  private async preflightShot(
    projectId: string,
    shot: Shot,
    ctx: { videoDuration: number; firstFrameUrl?: string; chainedFrom?: string },
  ): Promise<{ warnings: string[]; errors: string[] }> {
    const projRows = await this.db
      .select({ contentMode: projects.contentMode })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    const threshold = (projRows[0]?.contentMode ?? 'general') === 'ads' ? 5 : 8;
    const hits = [
      ruleNoFirstFrame(shot, Boolean(ctx.firstFrameUrl)),
      ruleLocalWhitemodel(shot),
      ruleDialogueOverflow(shot),
      ruleDeadTime({ ...shot, duration: ctx.videoDuration }, threshold),
      ruleUnknownMovement(shot),
      ...ruleWhitemodelMismatch(shot),
      ruleSubtitleDrift(shot),
      ruleLongLines(shot),
    ].filter((h): h is RuleHit => h !== null);
    const warnings = hits.filter((h) => h.level === 'warning').map((h) => h.message);
    const errors = hits.filter((h) => h.level === 'error').map((h) => h.message);
    // P1-4 素材复用候选（移植 ai-shorts-generator match-then-generate）：
    // 无首帧时才提示（有首帧则以首帧为准，不制造噪音）；只建议不自动复用，
    // 用户到导演台手动绑定为首帧。embedding 版等文本 Key 到位后升级，阈值不变。
    if (!ctx.firstFrameUrl) {
      const query = `${shot.visualPrompt ?? ''} ${shot.action ?? ''} ${shot.subject ?? ''}`.trim();
      if (query) {
        const cands = await this.findReuseCandidates(projectId, query);
        for (const c of cands) {
          warnings.push(
            `可复用素材「${c.name}」（相似度 ${c.score.toFixed(2)}）：在导演台手动绑为首帧可省一次生成`,
          );
        }
      }
    }
    return { warnings, errors };
  }

  /**
   * P1-4：在本项目图/视频资产中按关键词相似度找复用候选（top 3，阈值 0.40）。
   * 匹配文本 = 资产名 + 生成 prompt（shorts 只比 image_prompt，我们多看名字）。
   */
  private async findReuseCandidates(
    projectId: string,
    query: string,
  ): Promise<{ name: string; fileUrl: string; score: number }[]> {
    const rows = await this.db
      .select({
        name: assets.name,
        fileUrl: assets.fileUrl,
        generationPrompt: assets.generationPrompt,
      })
      .from(assets)
      .where(eq(assets.projectId, projectId))
      .orderBy(desc(assets.createdAt))
      .limit(50);
    return rows
      .filter((r) => r.fileUrl)
      .map((r) => ({
        name: r.name,
        fileUrl: r.fileUrl as string,
        score: keywordSimilarity(query, `${r.name} ${r.generationPrompt ?? ''}`),
      }))
      .filter((c) => c.score >= REUSE_MATCH_THRESHOLD)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);
  }

  /**
   * W4 一致性引擎：取指定角色的参考图 URL（去重，上限 3 张）。
   * 镜头生成图/视频时自动注入，跨镜角色一致性不再依赖人工勾选。
   */
  private async characterReferenceUrls(projectId: string, characterIds: string[]): Promise<string[]> {
    const ids = [...new Set(characterIds)].filter(Boolean).slice(0, 5);
    if (ids.length === 0) return [];
    const rows = await this.db
      .select({ id: characters.id, referenceImageUrls: characters.referenceImageUrls })
      .from(characters)
      .where(and(eq(characters.projectId, projectId), inArray(characters.id, ids)));
    // V3 有序多图引用（学 ToonFlow rowid 保序）：按镜头 characterIds 顺序取，
    // 每角色最多 3 张中的首张优先，保证跨镜引用顺序稳定
    const byId = new Map(rows.map((r) => [r.id, r] as const));
    const urls: string[] = [];
    for (const cid of ids) {
      const r = byId.get(cid);
      for (const u of ((r?.referenceImageUrls ?? []) as string[])) {
        if (u && !urls.includes(u) && urls.length < 3) urls.push(u);
      }
    }
    return urls;
  }

  async generateShotVoice(
    projectId: string,
    id: string,
  ): Promise<{ jobId: string }> {
    await this.budgetCap.assertAllowed();
    const shot = await this.getShot(projectId, id);
    const rows = await this.db
      .insert(generationJobs)
      .values({
        projectId,
        jobType: 'tts',
        targetType: 'shot',
        targetId: shot.id,
        status: 'pending',
        inputData: {
          prompt: shot.dialogue ?? shot.subtitleText ?? '',
        },
      })
      .returning({ id: generationJobs.id });
    await this.markShotQueued(projectId, shot.id);
    return { jobId: rows[0].id };
  }

  async rerunShot(
    projectId: string,
    id: string,
    dto: { type: 'image' | 'video' | 'voice' },
  ): Promise<{ jobId: string }> {
    await this.budgetCap.assertAllowed();
    const shot = await this.getShot(projectId, id);
    const jobType = dto.type === 'image' ? 'image' : dto.type === 'video' ? 'video' : 'tts';
    // 修复：视频重跑旧版只带 prompt+角色参考图，丢掉首帧/白模/尾帧链/时长/运镜事实，
    // 时长静默回落 5s。现与 generateShotVideo 同口径走 buildVideoJobInput。
    if (jobType === 'video') {
      const built = await this.buildVideoJobInput(projectId, shot);
      const rows = await this.db
        .insert(generationJobs)
        .values({
          projectId,
          jobType,
          targetType: 'shot',
          targetId: shot.id,
          status: 'pending',
          inputData: {
            prompt: built.prompt,
            duration: built.duration,
            references: built.references,
            ...(built.chainedFrom ? { chainedFrom: built.chainedFrom } : {}),
          },
        })
        .returning({ id: generationJobs.id });
      await this.markShotQueued(projectId, shot.id);
      return { jobId: rows[0].id };
    }
    // W4 一致性：重跑同样带入角色参考图
    const charRefs =
      jobType === 'tts'
        ? []
        : await this.characterReferenceUrls(projectId, shot.characterIds ?? []);
    const rows = await this.db
      .insert(generationJobs)
      .values({
        projectId,
        jobType,
        targetType: 'shot',
        targetId: shot.id,
        status: 'pending',
        inputData: {
          prompt: shot.visualPrompt ?? (jobType === 'image' ? shot.subject ?? '' : shot.dialogue ?? ''),
          negativePrompt: jobType === 'image' ? shot.negativePrompt ?? '' : undefined,
          references: [...(jobType === 'image' ? shot.referenceImageUrls ?? [] : []), ...charRefs],
        },
      })
      .returning({ id: generationJobs.id });
    await this.markShotQueued(projectId, shot.id);
    return { jobId: rows[0].id };
  }

  async batchGenerate(
    projectId: string,
    body: { type: 'image' | 'video' | 'voice'; shotIds?: string[] },
    opts?: { basePriority?: number },
  ): Promise<{ jobIds: string[]; groups: { empty: string[]; subject: string[] }; reused: string[] }> {
    await this.budgetCap.assertAllowed();
    let shotList: Shot[];
    if (body.shotIds && body.shotIds.length > 0) {
      shotList = await Promise.all(
        body.shotIds.map((sid: string) => this.getShot(projectId, sid)),
      );
    } else {
      shotList = await this.listShots(projectId);
    }

    const jobType = body.type === 'image' ? 'image' : body.type === 'video' ? 'video' : 'tts';
    // F7 批量幂等：同镜同类型已有在途任务（pending/running/retrying）则复用，
    // 重复点击不再建重复任务；返回 reused 供前端提示。
    const activeRows = await this.db
      .select({ targetId: generationJobs.targetId, id: generationJobs.id })
      .from(generationJobs)
      .where(
        and(
          eq(generationJobs.projectId, projectId),
          eq(generationJobs.jobType, jobType),
          inArray(generationJobs.status, ['pending', 'running', 'retrying']),
        ),
      );
    const activeByTarget = new Map(
      activeRows
        .filter((r) => r.targetId)
        .map((r) => [r.targetId as string, r.id]),
    );
    // P1-5 分组调度（移植 YouPipe short_drama.py:379-433 分组思想）：
    // 空镜（无角色无对白）先行并行（priority 65），主体镜随后按镜序（priority 60，
    // 同组内按创建时间=镜序认领，尾帧链恰好逐镜生效）。认领顺序见 claimNextPendingJob。
    const isSubject = (s: Shot) => (s.characterIds?.length ?? 0) > 0 || Boolean(s.dialogue);
    const ordered = [...shotList].sort((a, b) => a.shotNumber - b.shotNumber);
    const empty = ordered.filter((s) => !isSubject(s));
    const subject = ordered.filter((s) => isSubject(s));
    // V6 一键编排允许抬优先级：图批高于视频批，认领顺序天然先图后片
    const base = opts?.basePriority ?? 65;
    const jobIds: string[] = [];
    const groups = { empty: [] as string[], subject: [] as string[] };
    const reused: string[] = [];

    // S3 批次全有或全无（移植 ArcReel batch 准入思想）：同一事务内建任务，
    // 中途失败整体回滚，不留下半批任务。
    // 死锁教训：连接池 max=1，事务回调内只能用 tx 做 IO，所有 pool 查询
    // （含 buildVideoJobInput）必须在进事务前算完，否则 begin 后等连接 kills everything。
    // 修复：旧版图批/配音批只存 prompt——图批丢掉 negativePrompt 与角色参考图
    // （跨镜一致性静默失效），配音批丢角色音色位。现与单镜 generateShotImage /
    // generateShotVoice 同口径组装。
    const prepared: { shot: Shot; inputData: Record<string, unknown> }[] = [];
    for (const group of [
      { shots: empty, priority: base, key: 'empty' as const },
      { shots: subject, priority: base - 5, key: 'subject' as const },
    ]) {
      for (const shot of group.shots) {
        if (activeByTarget.get(shot.id)) continue;
        // V6 批量视频与单镜同口径：首帧/白模/尾帧链/时长/运镜事实全带上
        // eslint-disable-next-line no-await-in-loop
        const charRefs =
          jobType === 'tts'
            ? []
            : await this.characterReferenceUrls(projectId, shot.characterIds ?? []);
        // eslint-disable-next-line no-await-in-loop
        const videoInput = jobType === 'video' ? await this.buildVideoJobInput(projectId, shot) : null;
        prepared.push({
          shot,
          inputData: videoInput
            ? {
                prompt: videoInput.prompt,
                duration: videoInput.duration,
                references: videoInput.references,
                ...(videoInput.chainedFrom ? { chainedFrom: videoInput.chainedFrom } : {}),
              }
            : jobType === 'image'
              ? {
                  prompt: shot.visualPrompt ?? shot.subject ?? '',
                  negativePrompt: shot.negativePrompt ?? '',
                  references: [...(shot.referenceImageUrls ?? []), ...charRefs],
                }
              : {
                  prompt: shot.visualPrompt ?? shot.dialogue ?? '',
                  references: charRefs,
                },
        });
      }
    }
    await this.db.transaction(async (tx) => {
      for (const group of [
        { shots: empty, priority: base, key: 'empty' as const },
        { shots: subject, priority: base - 5, key: 'subject' as const },
      ]) {
        for (const shot of group.shots) {
          const existing = activeByTarget.get(shot.id);
          if (existing) {
            jobIds.push(existing);
            reused.push(shot.id);
            groups[group.key].push(shot.id);
            continue;
          }
          const prep = prepared.find((p) => p.shot.id === shot.id);
          // eslint-disable-next-line no-await-in-loop
          const rows = await tx
            .insert(generationJobs)
            .values({
              projectId,
              jobType,
              targetType: 'shot',
              targetId: shot.id,
              status: 'pending',
              priority: group.priority,
              inputData: prep?.inputData ?? { prompt: '' },
            })
            .returning({ id: generationJobs.id });
          jobIds.push(rows[0].id);
          groups[group.key].push(shot.id);
          // 同一事务内同步镜头状态（回滚时一起撤，不留脏 badge）
          // eslint-disable-next-line no-await-in-loop
          await tx
            .update(shots)
            .set({ status: 'queued', updatedAt: new Date() })
            .where(and(eq(shots.id, shot.id), eq(shots.projectId, projectId)));
        }
      }
    });

    return { jobIds, groups, reused };
  }

  /**
   * V6 一键成片编排：图批（75/70）→ 视频批（65/60）一次建完，
   * 认领顺序天然先图后片；SSE 看进度，合成用导出页 wasm 按钮。
   */
  async oneClick(
    projectId: string,
    body: { shotIds?: string[] },
  ): Promise<{
    image: { jobIds: string[]; reused: string[] };
    video: { jobIds: string[]; reused: string[] };
  }> {
    const image = await this.batchGenerate(projectId, { type: 'image', shotIds: body.shotIds }, { basePriority: 75 });
    const video = await this.batchGenerate(projectId, { type: 'video', shotIds: body.shotIds }, { basePriority: 65 });
    this.logger.log(
      `一键成片 ${projectId}：图 ${image.jobIds.length}（复用 ${image.reused.length}）+ 视频 ${video.jobIds.length}（复用 ${video.reused.length}）`,
    );
    return {
      image: { jobIds: image.jobIds, reused: image.reused },
      video: { jobIds: video.jobIds, reused: video.reused },
    };
  }

  /**
   * V1 人物四视图定妆照：单图拼图一次生成（特写+正+侧+背），
   * 回写时插到人物参考图首位（writeback 侧识别 sheet 标记）。
   */
  async generateCharacterSheet(
    projectId: string,
    characterId: string,
    dto: { styleId?: string },
  ): Promise<{ jobId: string }> {
    await this.budgetCap.assertAllowed();
    const rows = await this.db
      .select()
      .from(characters)
      .where(and(eq(characters.id, characterId), eq(characters.projectId, projectId)))
      .limit(1);
    if (rows.length === 0) throw new NotFoundException('角色不存在');
    const c = rows[0];
    const style = getStylePreset(dto.styleId ?? undefined);
    const prompt = buildSheetPrompt(
      {
        name: c.name,
        canonicalDescription: c.canonicalDescription ?? undefined,
        costume: c.costume ?? undefined,
      },
      style,
    );
    const jobRows = await this.db
      .insert(generationJobs)
      .values({
        projectId,
        jobType: 'image',
        targetType: 'character',
        targetId: c.id,
        status: 'pending',
        priority: 65,
        inputData: { prompt, sheet: true, styleId: style.id },
      })
      .returning({ id: generationJobs.id });
    this.logger.log(`四视图定妆照任务已创建 ${jobRows[0].id}（角色 ${c.name}）`);
    return { jobId: jobRows[0].id };
  }

  /**
   * P2-2 批量变体（移植 creatify 5钩同体思想的确定版）：
   * 同一镜按运镜预设轮换生成最多 5 个视频变体（Hook 换文案需 LLM，不在此做，
   * 只做运镜/景别确定性变体，保证可复现）。变体任务打 variantGroup 标签，
   * 供后续按 Hook率/Hold率/CPA 三层指标评估（投放数据回流后）。
   */
  async createVariants(
    projectId: string,
    id: string,
    dto: { count?: number },
  ): Promise<{ groupId: string; jobIds: string[] }> {
    await this.budgetCap.assertAllowed();
    const shot = await this.getShot(projectId, id);
    const count = Math.max(1, Math.min(5, Math.floor(Number(dto.count)) || 3));
    // 变体维度：运镜轮换（跳过当前运镜），保证每个变体可复现、可解释
    const rigMoves = CAMERA_RIGS.map((r) => r.movement).filter((m) => m !== shot.movement);
    const groupId = `var-${Date.now().toString(36)}`;
    const jobIds: string[] = [];
    for (let i = 0; i < count; i += 1) {
      const movement = rigMoves[i % rigMoves.length];
      // eslint-disable-next-line no-await-in-loop
      const rows = await this.db
        .insert(generationJobs)
        .values({
          projectId,
          jobType: 'video',
          targetType: 'shot',
          targetId: shot.id,
          status: 'pending',
          priority: 55,
          inputData: {
            prompt: shot.visualPrompt ?? shot.action ?? '',
            movement,
            duration: Number(shot.duration) > 0 ? Number(shot.duration) : 4,
            references: [...[shot.startFrameUrl, shot.whitemodelUrl, shot.endFrameUrl].filter(Boolean) as string[]],
            variantGroup: groupId,
            variantIndex: i + 1,
            variantMovement: movement,
          },
        })
        .returning({ id: generationJobs.id });
      jobIds.push(rows[0].id);
    }
    this.logger.log(`变体组 ${groupId}：镜头 ${shot.shotNumber} × ${count} 运镜变体`);
    return { groupId, jobIds };
  }

  /**
   * V5 每镜状态机：建任务 → queued（best-effort，不阻塞建任务主流程）。
   * 后续流转：认领→generating（worker）、回写→ready、终结失败→failed。
   */
  private async markShotQueued(projectId: string, shotId: string): Promise<void> {
    await this.db
      .update(shots)
      .set({ status: 'queued', updatedAt: new Date() })
      .where(and(eq(shots.id, shotId), eq(shots.projectId, projectId)))
      .catch((e: Error) => this.logger.warn(`镜头排队标记失败 ${shotId}：${e.message}`));
  }

  // ========== 剧本技能任务 ==========
  /**
   * 小说转剧本 / 剧本深度改造：一句话或长文本 → LLM 技能 → 存回项目 → 链式物化。
   * 任务本身不直接产分镜，由消费器执行 skill 后自动创建 parse_script。
   */
  private async createScriptJob(
    projectId: string,
    skillId: StorySkillId,
    source: string,
    opts?: { styleId?: string; genreId?: string; rewriteEnabled?: boolean; directives?: string },
  ): Promise<ScriptJobResponse> {
    await this.budgetCap.assertAllowed();
    // 确认项目存在
    const projRows = await this.db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    if (projRows.length === 0) throw new NotFoundException('项目不存在');
    const rows = await this.db
      .insert(generationJobs)
      .values({
        projectId,
        jobType: 'script',
        targetType: 'project',
        targetId: projectId,
        status: 'pending',
        priority: 85,
        inputData: {
          kind: skillId,
          source,
          styleId: opts?.styleId,
          genreId: opts?.genreId,
          rewriteEnabled: opts?.rewriteEnabled,
          directives: opts?.directives,
        },
      })
      .returning({ id: generationJobs.id, status: generationJobs.status });
    return { jobId: rows[0].id, status: rows[0].status, skillId };
  }

  async adaptNovel(
    projectId: string,
    dto: { novelText: string; styleId?: string; genreId?: string; rewriteEnabled?: boolean },
  ): Promise<ScriptJobResponse> {
    if (!dto.novelText?.trim()) throw new BadRequestException('小说原文不能为空');
    return this.createScriptJob(projectId, 'novel_to_script', dto.novelText, {
      styleId: dto.styleId,
      genreId: dto.genreId,
      rewriteEnabled: dto.rewriteEnabled,
    });
  }

  async rewriteScript(
    projectId: string,
    dto: { scriptText?: string; directives?: string; styleId?: string },
  ): Promise<ScriptJobResponse> {
    let source = dto.scriptText?.trim() ?? '';
    if (!source) {
      const projRows = await this.db
        .select({ scriptText: projects.scriptText })
        .from(projects)
        .where(eq(projects.id, projectId))
        .limit(1);
      source = projRows[0]?.scriptText ?? '';
    }
    if (!source.trim()) throw new BadRequestException('当前项目还没有剧本可改，请先生成或粘贴剧本');
    return this.createScriptJob(projectId, 'script_rewrite', source, {
      styleId: dto.styleId,
      rewriteEnabled: true,
      directives: dto.directives,
    });
  }

  /**
   * 广告创意任务：产品信息 → ad_creative 技能 → 存回项目 → 链式物化。
   * 与剧本技能同一条链（script job → parse_script），物化器已兼容“第X镜”标题。
   */
  async createAd(
    projectId: string,
    dto: { productBrief: string; styleId?: string; genreId?: string },
  ): Promise<ScriptJobResponse> {
    if (!dto.productBrief?.trim()) throw new BadRequestException('产品信息不能为空');
    return this.createScriptJob(projectId, 'ad_creative', dto.productBrief, {
      styleId: dto.styleId,
      genreId: dto.genreId,
      rewriteEnabled: true,
    });
  }

  /**
   * 人物卡任务（ToonFlow art_character 思想）：设定 → 人物卡 JSON → 直接写入人物表。
   * 与运镜接口一样直接返回（不进任务队列，人物行即产物）。
   */
  async designCharacters(
    projectId: string,
    dto: { brief: string; styleId?: string; genreId?: string },
  ): Promise<{ characters: { id: string; name: string }[] }> {
    await this.budgetCap.assertAllowed();
    if (!dto.brief?.trim()) throw new BadRequestException('人物设定不能为空');
    const projRows = await this.db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    if (projRows.length === 0) throw new NotFoundException('项目不存在');
    const { characters: cards } = await this.storySkills.runCharacters({
      brief: dto.brief,
      styleId: dto.styleId,
      genreId: dto.genreId,
    });
    const created: { id: string; name: string }[] = [];
    let order = 0;
    for (const c of cards) {
      order += 1;
      // eslint-disable-next-line no-await-in-loop
      const rows = await this.db
        .insert(characters)
        .values({
          projectId,
          name: c.name,
          roleType: c.roleType,
          age: c.age,
          gender: c.gender,
          faceFeatures: c.faceFeatures,
          hairstyle: c.hairstyle,
          costume: c.costume,
          personality: c.personality,
          voiceType: c.voiceType,
          canonicalDescription: c.canonicalDescription,
          forbiddenChanges: c.forbiddenChanges,
          sortOrder: order,
        })
        .returning({ id: characters.id, name: characters.name });
      created.push(rows[0]);
    }
    this.logger.log(`人物卡建成 ${projectId}：${created.length} 个人物`);
    return { characters: created };
  }

  /**
   * 分镜表任务：剧本 → boards 技能任务 → worker 直接物化为场镜。
   */
  async createBoards(
    projectId: string,
    dto: { scriptText: string; styleId?: string; genreId?: string; replaceExisting?: boolean },
  ): Promise<ScriptJobResponse> {
    await this.budgetCap.assertAllowed();
    if (!dto.scriptText?.trim()) throw new BadRequestException('剧本内容不能为空');
    const projRows = await this.db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    if (projRows.length === 0) throw new NotFoundException('项目不存在');
    const rows = await this.db
      .insert(generationJobs)
      .values({
        projectId,
        jobType: 'boards',
        targetType: 'project',
        targetId: projectId,
        status: 'pending',
        priority: 85,
        inputData: {
          scriptText: dto.scriptText,
          styleId: dto.styleId,
          genreId: dto.genreId,
          replaceExisting: dto.replaceExisting === true,
        },
      })
      .returning({ id: generationJobs.id, status: generationJobs.status });
    return { jobId: rows[0].id, status: rows[0].status, skillId: 'script_to_boards' };
  }

  /**
   * 运镜序列任务（GPT-6 场景代码来源之一）：描述 → 运镜 JSON，直接返回不进任务队列。
   * 前端导演台拿到 beats 后一键摆机位再录制；也可粘贴任意 LLM（含 GPT-6）产出的同构 JSON。
   */
  async runRigScene(
    projectId: string,
    dto: { description: string; totalSeconds?: number },
  ): Promise<RigRunResult> {
    await this.budgetCap.assertAllowed();
    const projRows = await this.db
      .select({ id: projects.id, contentMode: projects.contentMode })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    if (projRows.length === 0) throw new NotFoundException('项目不存在');
    return this.storySkills.runRig({
      description: dto.description,
      totalSeconds: dto.totalSeconds,
      contentMode: projRows[0].contentMode ?? 'general',
    });
  }

  // ========== Parse Script ==========
  // P1 DTO 对齐：签名收敛为实际消费的字段（旧 ParseScriptRequest.projectId 从未被读取，来源以 URL 参数为准）
  async parseScript(
    projectId: string,
    dto: { scriptText: string },
  ): Promise<ParseScriptResponse> {
    await this.budgetCap.assertAllowed();
    const rows = await this.db
      .insert(generationJobs)
      .values({
        projectId,
        jobType: 'parse_script',
        targetType: 'project',
        targetId: projectId,
        status: 'pending',
        inputData: {
          prompt: dto.scriptText,
        },
      })
      .returning({ id: generationJobs.id, status: generationJobs.status });

    return {
      jobId: rows[0].id,
      status: rows[0].status,
      charactersCount: 0,
      scenesCount: 0,
    };
  }

  // ========== Mappers ==========
  private mapScene(row: typeof scenes.$inferSelect): Scene {
    return {
      id: row.id,
      projectId: row.projectId,
      sceneNumber: row.sceneNumber,
      title: row.title ?? undefined,
      locationId: row.locationId ?? undefined,
      timeOfDay: row.timeOfDay ?? undefined,
      summary: row.summary ?? undefined,
      emotion: row.emotion ?? undefined,
      characterIds: row.characterIds ?? [],
      dialogues: (row.dialogues as Dialogue[]) ?? [],
      actions: (row.actions as SceneAction[]) ?? [],
      props: row.props ?? [],
      sortOrder: row.sortOrder,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private mapShot(row: typeof shots.$inferSelect): Shot {
    return {
      id: row.id,
      projectId: row.projectId,
      sceneId: row.sceneId,
      shotNumber: row.shotNumber,
      duration: Number(row.duration),
      shotSize: row.shotSize,
      cameraAngle: row.cameraAngle,
      lens: row.lens,
      movement: row.movement,
      subject: row.subject ?? undefined,
      action: row.action ?? undefined,
      emotion: row.emotion ?? undefined,
      dialogue: row.dialogue ?? undefined,
      visualPrompt: row.visualPrompt ?? undefined,
      negativePrompt: row.negativePrompt ?? undefined,
      startFrameUrl: row.startFrameUrl ?? undefined,
      endFrameUrl: row.endFrameUrl ?? undefined,
      whitemodelUrl: row.whitemodelUrl ?? undefined,
      whitemodelMeta: (row.whitemodelMeta as WhitemodelMeta | null) ?? undefined,
      referenceImageUrls: row.referenceImageUrls ?? [],
      videoUrl: row.videoUrl ?? undefined,
      voiceUrl: row.voiceUrl ?? undefined,
      sfxUrls: row.sfxUrls ?? [],
      subtitleText: row.subtitleText ?? undefined,
      characterIds: row.characterIds ?? [],
      locked: row.locked,
      status: row.status,
      sortOrder: row.sortOrder,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
