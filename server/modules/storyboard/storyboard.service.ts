import { Injectable, Inject, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { scenes, segments, shots, characters, generationJobs, locations, projects, assets } from '@server/database/schema';
import { eq, desc, asc, and, count, inArray, lt, sql } from 'drizzle-orm';
import type {
  CharacterIdentityKit,
  Scene,
  Segment,
  Shot,
  WhitemodelMeta,
  Dialogue,
  SceneAction,
  ParseScriptResponse,
  ScriptJobResponse,
  StorySkillId,
  BlockedVideoShot,
  BlockedVideoSummary,
  SplitShotResult,
} from '@shared/api.interface';
import { diagnoseProject, type ProjectDiagnosis } from '@shared/artifact-state';
import { deriveBeats, planPieces } from '@shared/shot-craft';
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
  withVideoTextPolicy,
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
import { contentDrivenShotSeconds } from '@shared/shot-duration';
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
    // mock 演练产物标注：分镜页是用户「看到了什么」的地方，
    // 占位首帧/成片必须在这里就能看出来，不能等到资产库才发现是假的。
    const mockUrls = await this.collectMockUrls(projectId);
    return rows.map((r) => {
      const shot = this.mapShot(r);
      if (
        this.isMockProductUrl(r.startFrameUrl, mockUrls) ||
        this.isMockProductUrl(r.videoUrl, mockUrls)
      ) {
        shot.mock = true;
      }
      return shot;
    });
  }

  /**
   * 是否 mock 演练产物。除了 assets.metadata 标注，还兜住改造前已存在的占位视频：
   * 网关把占位 mp4 统一写在 /uploads/mock/ 下，前缀即可识别，无需数据迁移。
   */
  private isMockProductUrl(url: string | null | undefined, mockUrls: Set<string>): boolean {
    if (!url) return false;
    return url.startsWith('/uploads/mock/') || mockUrls.has(url);
  }

  /** 项目内 mock 演练产物的 URL 集合（assets.metadata.mock=true），一次查询覆盖全量镜头 */
  private async collectMockUrls(projectId: string): Promise<Set<string>> {
    try {
      const rows = await this.db
        .select({ fileUrl: assets.fileUrl })
        .from(assets)
        .where(
          and(
            eq(assets.projectId, projectId),
            sql`${assets.metadata} ->> 'mock' = 'true'`,
          ),
        );
      return new Set(
        rows.map((r) => r.fileUrl).filter((u): u is string => typeof u === 'string' && u.length > 0),
      );
    } catch {
      // 标注失败不能阻断分镜页读取
      return new Set();
    }
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
        duration: dto.duration?.toString() ?? '8.0',
        inPoint: dto.inPoint !== undefined ? dto.inPoint.toString() : undefined,
        outPoint: dto.outPoint !== undefined ? dto.outPoint.toString() : undefined,
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
    // 线性剪辑入/出点：null = 清除（恢复缺省语义）；同传时校验 out > in
    if (dto.inPoint !== undefined) patch.inPoint = dto.inPoint === null ? null : dto.inPoint.toString();
    if (dto.outPoint !== undefined) patch.outPoint = dto.outPoint === null ? null : dto.outPoint.toString();
    if (dto.inPoint != null && dto.outPoint != null && dto.outPoint <= dto.inPoint) {
      throw new BadRequestException('outPoint 必须大于 inPoint');
    }
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

  // ========== 线性剪辑 Phase 2：镜头清单编辑 ==========

  /**
   * 线性剪辑扁平序 = sortOrder → 镜号 → 创建时间倒序。
   * 必须与前端 sortRaw（useTimelineEditor）同口径：时间线展示顺序以 sortOrder 为准，
   * 同序时按 GET /shots 的返回顺序（shotNumber 升序、createdAt 倒序）稳定排列，
   * 旧数据镜号场内递增，按场序排会把用户既有的剪辑顺序打散。
   */
  private async flatShotRows(
    projectId: string,
  ): Promise<{ shot: typeof shots.$inferSelect; sceneNumber: number }[]> {
    return this.db
      .select({ shot: shots, sceneNumber: scenes.sceneNumber })
      .from(shots)
      .innerJoin(scenes, eq(shots.sceneId, scenes.id))
      .where(eq(shots.projectId, projectId))
      .orderBy(asc(shots.sortOrder), asc(shots.shotNumber), desc(shots.createdAt));
  }

  /**
   * P2 批量重排：按数组顺序全局扁平重编 shotNumber/sortOrder（1..N）。
   * 未列入数组的镜头保持原相对顺序，追加在指定镜头之后。
   * IDOR：所有 shotId 必须归属本项目；整体单事务，失败全回滚。
   * 注意：重排后镜号为全局扁平编号（线性剪辑视图口径），旧「场内递增」编号被归一。
   */
  async reorderShots(projectId: string, shotIds: string[]): Promise<Shot[]> {
    if (!Array.isArray(shotIds) || shotIds.length === 0) {
      throw new BadRequestException('shotIds 不能为空');
    }
    const unique = [...new Set(shotIds)];
    if (unique.length !== shotIds.length) {
      throw new BadRequestException('shotIds 存在重复');
    }
    // 连接池 max=1：所有 pool 读取必须在进事务前完成，事务回调内只用 tx 做 IO
    const flat = await this.flatShotRows(projectId);
    const byId = new Map(flat.map((r) => [r.shot.id, r.shot]));
    for (const sid of unique) {
      if (!byId.has(sid)) {
        throw new NotFoundException(`分镜 ${sid} 不存在（或不属于本项目）`);
      }
    }
    const specifiedSet = new Set(unique);
    const ordered = [
      ...unique.map((sid) => byId.get(sid) as typeof shots.$inferSelect),
      ...flat.filter((r) => !specifiedSet.has(r.shot.id)).map((r) => r.shot),
    ];
    const now = new Date();
    const updated: (typeof shots.$inferSelect)[] = [];
    await this.db.transaction(async (tx) => {
      for (let i = 0; i < ordered.length; i += 1) {
        const s = ordered[i];
        if (s.shotNumber === i + 1 && s.sortOrder === i + 1) {
          updated.push(s);
          continue;
        }
        // eslint-disable-next-line no-await-in-loop
        const res = await tx
          .update(shots)
          .set({ shotNumber: i + 1, sortOrder: i + 1, updatedAt: now })
          .where(and(eq(shots.id, s.id), eq(shots.projectId, projectId)))
          .returning();
        if (res.length === 0) throw new NotFoundException('分镜不存在');
        updated.push(res[0]);
      }
    });
    return updated.map((r) => this.mapShot(r));
  }

  /**
   * P2 镜头分割：在 atSecond（相对镜头起始，∈ (0, duration)）处拆成两条。
   * 视频文件不物理切：original 保留 inPoint、duration=atSecond；
   * created.inPoint=(原inPoint??0)+atSecond、duration=剩余，共享 videoUrl/voiceUrl/startFrameUrl。
   * 新镜插在 original 之后，后续镜头按扁平序重新编号；整体单事务 + IDOR 守卫。
   * 对白/字幕留在 original（避免两段重复烧录同一条字幕），created 可再编辑。
   */
  async splitShot(
    projectId: string,
    id: string,
    dto: { atSecond: number },
  ): Promise<SplitShotResult> {
    // IDOR：写操作 id + projectId 双匹配
    const originalRows = await this.db
      .select()
      .from(shots)
      .where(and(eq(shots.id, id), eq(shots.projectId, projectId)));
    if (originalRows.length === 0) throw new NotFoundException('分镜不存在');
    const original = originalRows[0];
    const duration = Number(original.duration);
    if (!Number.isFinite(duration) || duration <= 0) {
      throw new BadRequestException('镜头时长无效，无法分割');
    }
    const atSecond = Number(dto.atSecond);
    if (!Number.isFinite(atSecond) || atSecond <= 0 || atSecond >= duration) {
      throw new BadRequestException(`分割点必须在 (0, ${duration}) 秒内`);
    }
    const round3 = (n: number) => Math.round(n * 1000) / 1000;
    const origIn = original.inPoint != null ? Number(original.inPoint) : 0;
    const origOut = original.outPoint != null ? Number(original.outPoint) : null;
    const flat = await this.flatShotRows(projectId);
    const idx = flat.findIndex((r) => r.shot.id === id);
    if (idx < 0) throw new NotFoundException('分镜不存在');

    const now = new Date();
    let originalRow: typeof shots.$inferSelect | undefined;
    let createdRow: typeof shots.$inferSelect | undefined;
    await this.db.transaction(async (tx) => {
      // 新镜插在 original 之后（扁平位置 idx+1 → 编号 idx+2）
      const inserted = await tx
        .insert(shots)
        .values({
          projectId,
          sceneId: original.sceneId,
          shotNumber: idx + 2,
          sortOrder: idx + 2,
          duration: String(round3(duration - atSecond)),
          inPoint: String(round3(origIn + atSecond)),
          // 原镜有显式出点则继承（created 覆盖源媒体剩余段）；否则缺省 = in + duration
          outPoint: origOut != null ? String(origOut) : null,
          shotSize: original.shotSize,
          cameraAngle: original.cameraAngle,
          lens: original.lens,
          movement: original.movement,
          subject: original.subject,
          action: original.action,
          emotion: original.emotion,
          visualPrompt: original.visualPrompt,
          negativePrompt: original.negativePrompt,
          startFrameUrl: original.startFrameUrl,
          endFrameUrl: original.endFrameUrl,
          whitemodelUrl: original.whitemodelUrl,
          whitemodelMeta: original.whitemodelMeta,
          referenceImageUrls: original.referenceImageUrls ?? [],
          videoUrl: original.videoUrl,
          voiceUrl: original.voiceUrl,
          sfxUrls: original.sfxUrls ?? [],
          characterIds: original.characterIds ?? [],
          locked: false,
          status: original.status,
        })
        .returning();
      createdRow = inserted[0];
      const updatedOriginal = await tx
        .update(shots)
        .set({
          duration: String(round3(atSecond)),
          // 原镜有显式出点时收缩到分割点，避免与 created 取段重叠
          ...(origOut != null ? { outPoint: String(round3(origIn + atSecond)) } : {}),
          shotNumber: idx + 1,
          sortOrder: idx + 1,
          updatedAt: now,
        })
        .where(and(eq(shots.id, id), eq(shots.projectId, projectId)))
        .returning();
      if (updatedOriginal.length === 0) throw new NotFoundException('分镜不存在');
      originalRow = updatedOriginal[0];
      // 其余镜头按新扁平序重新编号（created 占 idx+2，原 idx 之后的镜头整体 +1）
      for (let i = 0; i < flat.length; i += 1) {
        if (i === idx) continue;
        const num = i < idx ? i + 1 : i + 2;
        const s = flat[i].shot;
        if (s.shotNumber === num && s.sortOrder === num) continue;
        // eslint-disable-next-line no-await-in-loop
        await tx
          .update(shots)
          .set({ shotNumber: num, sortOrder: num, updatedAt: now })
          .where(and(eq(shots.id, s.id), eq(shots.projectId, projectId)));
      }
    });
    if (!originalRow || !createdRow) throw new NotFoundException('分镜不存在');
    return { original: this.mapShot(originalRow), created: this.mapShot(createdRow) };
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
   * 首帧依赖受阻汇总：列出本项目所有因首帧未就绪而被暂停的视频任务（按镜头聚合）。
   * 分镜页据此给出「视频已暂停 → 重试首帧」的明确恢复入口，
   * 避免用户只看到镜头「失败」却不知道该修哪一步。
   */
  async listBlockedVideos(projectId: string): Promise<BlockedVideoSummary> {
    const rows = await this.db
      .select({
        shotId: generationJobs.targetId,
        reason: sql<string>`${generationJobs.inputData} ->> 'blockedReason'`,
      })
      .from(generationJobs)
      .where(
        and(
          eq(generationJobs.projectId, projectId),
          eq(generationJobs.jobType, 'video'),
          eq(generationJobs.status, 'pending'),
          sql`${generationJobs.inputData} ->> 'blockedReason' IS NOT NULL`,
        ),
      );

    const byShot = new Map<string, { reasons: string[]; count: number }>();
    for (const r of rows) {
      if (!r.shotId) continue;
      const cur = byShot.get(r.shotId) ?? { reasons: [], count: 0 };
      cur.count += 1;
      if (r.reason) cur.reasons.push(r.reason);
      byShot.set(r.shotId, cur);
    }
    if (byShot.size === 0) return { items: [], totalJobs: 0, needAction: 0 };

    const shotIds = [...byShot.keys()];
    const [shotRows, activeImageRows] = await Promise.all([
      this.db
        .select({ id: shots.id, shotNumber: shots.shotNumber })
        .from(shots)
        .where(and(eq(shots.projectId, projectId), inArray(shots.id, shotIds))),
      this.db
        .select({ targetId: generationJobs.targetId })
        .from(generationJobs)
        .where(
          and(
            eq(generationJobs.projectId, projectId),
            eq(generationJobs.jobType, 'image'),
            inArray(generationJobs.status, ['pending', 'queued', 'running', 'retrying']),
            inArray(generationJobs.targetId, shotIds),
          ),
        ),
    ]);
    const shotNumberById = new Map(shotRows.map((s) => [s.id, s.shotNumber]));
    const activeImageSet = new Set(
      activeImageRows.map((r) => r.targetId).filter((v): v is string => Boolean(v)),
    );

    const items: BlockedVideoShot[] = [];
    for (const [shotId, info] of byShot) {
      // 失败优先于缺失，缺失优先于等待：一个镜头取最需要用户处理的原因
      const reason: BlockedVideoShot['reason'] = info.reasons.includes('first_frame_failed')
        ? 'first_frame_failed'
        : info.reasons.includes('first_frame_missing')
          ? 'first_frame_missing'
          : 'waiting_first_frame';
      items.push({
        shotId,
        shotNumber: shotNumberById.get(shotId) ?? 0,
        reason,
        jobCount: info.count,
        hasActiveImageJob: activeImageSet.has(shotId),
      });
    }
    items.sort((a, b) => a.shotNumber - b.shotNumber);

    return {
      items,
      totalJobs: rows.length,
      // 首帧仍在生成（含刚被重试）的属于正常排队，不需要用户再介入
      needAction: items.filter(
        (i) => i.reason !== 'waiting_first_frame' && !i.hasActiveImageJob,
      ).length,
    };
  }

  /**
   * 一键恢复受阻视频：为「首帧失败/缺失」的镜头重新发起首帧任务。
   * 已有在途首帧任务的镜头跳过，避免重复建单重复扣费；
   * 首帧成功后消费器会自动解除对应视频的阻断（reconcileFirstFrameDependencies）。
   */
  async recoverBlockedVideos(
    projectId: string,
  ): Promise<{ retried: number; skipped: number; failed: number }> {
    const summary = await this.listBlockedVideos(projectId);
    let retried = 0;
    let skipped = 0;
    let failed = 0;
    for (const item of summary.items) {
      // 等待中的首帧无需重复发起；已有在途首帧任务也不重复建单
      if (item.reason === 'waiting_first_frame' || item.hasActiveImageJob) {
        skipped += 1;
        continue;
      }
      try {
        // eslint-disable-next-line no-await-in-loop
        await this.generateShotImage(projectId, item.shotId);
        retried += 1;
      } catch (e) {
        failed += 1;
        this.logger.warn(
          `恢复首帧失败（镜 ${item.shotNumber}）：${(e as Error).message}`,
        );
      }
    }
    this.logger.log(
      `首帧恢复 ${projectId}：重试 ${retried}，跳过 ${skipped}，失败 ${failed}`,
    );
    return { retried, skipped, failed };
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
    // P1 修复：duration 可空/非法时回落 8s（默认镜头时长，避免 4s 太短讲不完剧情）
    const parsedDuration = Number(shot.duration);
    const videoDuration =
      Number.isFinite(parsedDuration) && parsedDuration > 0 ? parsedDuration : 8;
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
      .select({
        styleBible: projects.styleBible,
        contentMode: projects.contentMode,
        metadata: projects.metadata,
      })
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
    // 画面字幕策略：默认不把字幕/文字烧进画面（后期统一配），
    // 旧项目 metadata 无该字段时按 false 处理；专业模式在 metadata.professional 下。
    const meta = (projRows[0]?.metadata ?? {}) as {
      videoSubtitles?: boolean;
      professional?: { videoSubtitles?: boolean };
    };
    const allowOnScreenText =
      meta.videoSubtitles === true || meta.professional?.videoSubtitles === true;
    const fullPrompt = withVideoTextPolicy(
      `【运镜事实】${facts}。${rigLine}${whitemodelLine}\n${basePrompt}\n${negativeLine}`.trim(),
      allowOnScreenText,
    );
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
    opts?: { basePriority?: number; dependsOnJobIdByShotId?: Record<string, string> },
  ): Promise<{
    jobIds: string[];
    groups: { empty: string[]; subject: string[] };
    reused: string[];
    jobIdByShotId: Record<string, string>;
  }> {
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
    // F7 批量幂等：同镜同类型已有在途任务（pending/queued/running/retrying）则复用，
    // 重复点击不再建重复任务；返回 reused 供前端提示。
    const activeRows = await this.db
      .select({ targetId: generationJobs.targetId, id: generationJobs.id })
      .from(generationJobs)
      .where(
        and(
          eq(generationJobs.projectId, projectId),
          eq(generationJobs.jobType, jobType),
          inArray(generationJobs.status, ['pending', 'queued', 'running', 'retrying']),
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
        const dependsOnJobId = jobType === 'video'
          ? opts?.dependsOnJobIdByShotId?.[shot.id]
          : undefined;
        prepared.push({
          shot,
          inputData: videoInput
            ? {
                prompt: videoInput.prompt,
                duration: videoInput.duration,
                references: videoInput.references,
                ...(videoInput.chainedFrom ? { chainedFrom: videoInput.chainedFrom } : {}),
                // 一键成片的视频与本次首帧任务硬绑定；priority 只决定顺序，不能保证依赖。
                ...(dependsOnJobId
                  ? { dependsOnJobId, blockedReason: 'waiting_first_frame' }
                  : {}),
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
    const jobIdByShotId: Record<string, string> = {};
    await this.db.transaction(async (tx) => {
      for (const group of [
        { shots: empty, priority: base, key: 'empty' as const },
        { shots: subject, priority: base - 5, key: 'subject' as const },
      ]) {
        for (const shot of group.shots) {
          const existing = activeByTarget.get(shot.id);
          if (existing) {
            jobIds.push(existing);
            jobIdByShotId[shot.id] = existing;
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
          jobIdByShotId[shot.id] = rows[0].id;
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

    return { jobIds, groups, reused, jobIdByShotId };
  }

  /**
   * V6 一键成片编排：图批与视频批一次建完，视频通过 dependsOnJobId 等待本镜首帧。
   * priority 仅用于就绪任务的排序，不再承担正确性；SSE 看进度，合成用导出页 wasm 按钮。
   */
  async oneClick(
    projectId: string,
    body: { shotIds?: string[] },
  ): Promise<{
    image: { jobIds: string[]; reused: string[] };
    video: { jobIds: string[]; reused: string[] };
  }> {
    const image = await this.batchGenerate(projectId, { type: 'image', shotIds: body.shotIds }, { basePriority: 75 });
    const video = await this.batchGenerate(
      projectId,
      { type: 'video', shotIds: body.shotIds },
      { basePriority: 65, dependsOnJobIdByShotId: image.jobIdByShotId },
    );
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
            duration: Number(shot.duration) > 0 ? Number(shot.duration) : 8,
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
   * 旧数据时长修复：把内容驱动时长写回已有分镜（不改图/视频任务，不触发花钱）。
   * 只对缺时长或低于 8s 的镜头做抬升；已合规的镜头保持原值。
   */
  async normalizeShotDurations(projectId: string): Promise<{ updated: number; total: number }> {
    const all = await this.db
      .select({
        id: shots.id,
        dialogue: shots.dialogue,
        shotSize: shots.shotSize,
        movement: shots.movement,
        duration: shots.duration,
      })
      .from(shots)
      .where(eq(shots.projectId, projectId));
    let updated = 0;
    for (const s of all) {
      const current = Number(s.duration);
      const next = contentDrivenShotSeconds({
        dialogue: s.dialogue ?? undefined,
        shotSize: s.shotSize ?? undefined,
        movement: s.movement ?? undefined,
        suggested: Number.isFinite(current) ? current : undefined,
      });
      if (next <= 0) continue;
      if (Math.abs(next - current) < 0.05) continue;
      // 只抬升：已经合规的长镜头（如手动改过 20s）不被压回 15s 内
      if (next < current) continue;
      await this.db
        .update(shots)
        .set({ duration: next.toFixed(1), updatedAt: new Date() })
        .where(eq(shots.id, s.id));
      updated += 1;
    }
    return { updated, total: all.length };
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
  /**
   * 手动触发剧本 → 分镜物化。
   * 注意：这里**不直接**建 parse_script，而是先建 asset_prep。
   * 人物/场景定妆图是一切跨镜一致性的前提，任何进入物化的入口都必须经过资产门，
   * 否则「解析剧本」按钮就成了绕过资产阶段的后门（旧实现正是如此）。
   * asset_prep 会在资产就绪后自动链式接上 parse_script。
   */
  async parseScript(
    projectId: string,
    dto: { scriptText: string },
  ): Promise<ParseScriptResponse> {
    await this.budgetCap.assertAllowed();
    const rows = await this.db
      .insert(generationJobs)
      .values({
        projectId,
        jobType: 'asset_prep',
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

  /**
   * 项目级一致性体检：产物四态（current/stale/missing/blocked）+ 结构性告警。
   * 目的是把「这版分镜到底能不能拍」这件事变成一个可查询的结果，
   * 而不是等成片出来才发现跳轴、缺场景、人物没定妆。
   */
  async diagnose(projectId: string, opts?: { requireVideo?: boolean }): Promise<ProjectDiagnosis> {
    const [sceneRows, segRows, shotRows, charRows, locRows, frameJobRows] = await Promise.all([
      this.db.select().from(scenes).where(eq(scenes.projectId, projectId)),
      this.db.select().from(segments).where(eq(segments.projectId, projectId)),
      this.db.select().from(shots).where(eq(shots.projectId, projectId)),
      this.db
        .select({
          id: characters.id,
          name: characters.name,
          identityKit: characters.identityKit,
          referenceImageUrls: characters.referenceImageUrls,
        })
        .from(characters)
        .where(eq(characters.projectId, projectId)),
      this.db
        .select({
          id: locations.id,
          name: locations.name,
          referenceImageUrls: locations.referenceImageUrls,
        })
        .from(locations)
        .where(eq(locations.projectId, projectId)),
      // 首帧产出信息：取最近一次成功出图任务用的提示词，用来判「这张帧还代表这版分镜吗」
      this.db
        .select({
          targetId: generationJobs.targetId,
          prompt: sql<string>`(array_agg(${generationJobs.inputData}->>'prompt' ORDER BY ${generationJobs.updatedAt} DESC))[1]`,
        })
        .from(generationJobs)
        .where(
          and(
            eq(generationJobs.projectId, projectId),
            eq(generationJobs.jobType, 'image'),
            eq(generationJobs.targetType, 'shot'),
            eq(generationJobs.status, 'succeeded'),
          ),
        )
        .groupBy(generationJobs.targetId),
    ]);

    const framePromptAt = new Map(
      frameJobRows
        .filter((r) => r.targetId)
        .map((r) => [r.targetId as string, r.prompt ?? null]),
    );
    const sceneNumberById = new Map(sceneRows.map((s) => [s.id, s.sceneNumber]));
    const segmentNumberById = new Map(segRows.map((s) => [s.id, s.segmentNumber]));

    return diagnoseProject({
      requireVideo: opts?.requireVideo,
      assets: [
        ...charRows.map((c) => {
          const kit = (c.identityKit as CharacterIdentityKit | null) ?? null;
          return {
            id: c.id,
            name: c.name,
            kind: 'character' as const,
            ready: Boolean(kit?.portraitUrl || (c.referenceImageUrls ?? [])[0] || kit?.sheetUrl),
          };
        }),
        ...locRows.map((l) => ({
          id: l.id,
          name: l.name,
          kind: 'location' as const,
          ready: Boolean((l.referenceImageUrls ?? [])[0]),
        })),
      ],
      scenes: sceneRows.map((s) => ({
        id: s.id,
        sceneNumber: s.sceneNumber,
        locationId: s.locationId,
        characterIds: s.characterIds ?? [],
      })),
      segments: segRows.map((s) => ({
        id: s.id,
        sceneId: s.sceneId,
        segmentNumber: s.segmentNumber,
        durationSeconds: Number(s.durationSeconds ?? 0),
        characterIds: s.characterIds ?? [],
        axisDirection: (s.axisDirection as Segment['axisDirection']) ?? null,
        spaceAnchor: s.spaceAnchor,
      })),
      shots: shotRows.map((s) => ({
        id: s.id,
        sceneId: s.sceneId,
        sceneNumber: sceneNumberById.get(s.sceneId),
        segmentId: s.segmentId,
        segmentNumber: s.segmentId ? segmentNumberById.get(s.segmentId) : undefined,
        shotNumber: s.shotNumber,
        duration: Number(s.duration),
        shotSize: s.shotSize,
        dialogue: s.dialogue,
        visualPrompt: s.visualPrompt,
        characterIds: s.characterIds ?? [],
        referenceImageUrls: s.referenceImageUrls ?? [],
        startFrameUrl: s.startFrameUrl,
        videoUrl: s.videoUrl,
        voiceUrl: s.voiceUrl,
        screenDirection: (s.screenDirection as Shot['screenDirection']) ?? null,
        framePrompt: framePromptAt.get(s.id) ?? null,
      })),
    });
  }

  /**
   * 按规则重建片段（存量项目补三级结构）。
   *
   * P1 之前物化的项目只有「场 → 镜」，没有 segments，于是段内镜像链、
   * 轴线校验、视频续接全部失效。这里按「≤15 秒 / 2-4 镜」把现有镜头归段，
   * 并顺带回填缺失的 3 秒节拍 —— 不改动镜头内容，只补编组。
   */
  async rebuildSegments(projectId: string): Promise<{ segments: number; shots: number }> {
    const [sceneRows, shotRows] = await Promise.all([
      this.db
        .select()
        .from(scenes)
        .where(eq(scenes.projectId, projectId))
        .orderBy(asc(scenes.sceneNumber)),
      this.db
        .select()
        .from(shots)
        .where(eq(shots.projectId, projectId))
        .orderBy(asc(shots.sceneId), asc(shots.shotNumber)),
    ]);
    if (shotRows.length === 0) return { segments: 0, shots: 0 };

    await this.db.delete(segments).where(eq(segments.projectId, projectId));

    let segmentTotal = 0;
    for (const scene of sceneRows) {
      const list = shotRows.filter((s) => s.sceneId === scene.id);
      if (list.length === 0) continue;
      const pieces = planPieces(
        list.map((s) => ({
          shotNumber: s.shotNumber,
          duration: Number(s.duration ?? 0),
          segment: null,
          id: s.id,
          dialogue: s.dialogue,
          shotSize: s.shotSize,
        })),
      );
      for (const piece of pieces) {
        const headShot = list.find((s) => s.id === piece.shots[0].id);
        const castIds = [
          ...new Set(piece.shots.flatMap((p) => list.find((s) => s.id === p.id)?.characterIds ?? [])),
        ];
        segmentTotal += 1;
        const [seg] = await this.db
          .insert(segments)
          .values({
            projectId,
            sceneId: scene.id,
            segmentNumber: piece.segmentNumber,
            title:
              (headShot?.visualPrompt ?? '').trim().slice(0, 12) || `第 ${piece.segmentNumber} 组`,
            summary: headShot?.visualPrompt?.slice(0, 300),
            intent: piece.segmentNumber === 1 ? 'establish' : 'develop',
            characterIds: castIds.length > 0 ? castIds : (scene.characterIds ?? []),
            locationId: scene.locationId ?? null,
            props: piece.segmentNumber === 1 ? (scene.props ?? []) : [],
            durationSeconds: piece.durationSeconds.toFixed(1),
            sortOrder: piece.segmentNumber,
          })
          .returning({ id: segments.id });

        for (const p of piece.shots) {
          const row = list.find((s) => s.id === p.id);
          if (!row) continue;
          await this.db
            .update(shots)
            .set({
              segmentId: seg.id,
              // 只补空，不覆盖用户/模型已经写好的节拍
              beats:
                (row.beats as unknown[] | null)?.length
                  ? (row.beats as unknown[])
                  : deriveBeats({
                      duration: Number(row.duration ?? 0),
                      dialogue: row.dialogue,
                      visualPrompt: row.visualPrompt,
                      shotSize: row.shotSize,
                    }),
              updatedAt: new Date(),
            })
            .where(eq(shots.id, row.id));
        }
      }
    }
    this.logger.log(`已重建片段 ${projectId}：${segmentTotal} 段 / ${shotRows.length} 镜`);
    return { segments: segmentTotal, shots: shotRows.length };
  }

  /** 项目的片段列表（按场次、段号排序）：分镜 UI 按三级展示时用 */
  async listSegments(projectId: string): Promise<Segment[]> {
    const rows = await this.db
      .select()
      .from(segments)
      .where(eq(segments.projectId, projectId))
      .orderBy(asc(segments.sceneId), asc(segments.segmentNumber));
    return rows.map((row) => ({
      id: row.id,
      projectId: row.projectId,
      sceneId: row.sceneId,
      segmentNumber: row.segmentNumber,
      title: row.title ?? undefined,
      summary: row.summary ?? undefined,
      intent: row.intent ?? undefined,
      spaceAnchor: (row.spaceAnchor as Segment['spaceAnchor']) ?? undefined,
      axisDirection: (row.axisDirection as Segment['axisDirection']) ?? undefined,
      characterIds: row.characterIds ?? [],
      locationId: row.locationId ?? undefined,
      props: row.props ?? [],
      durationSeconds: Number(row.durationSeconds ?? 0),
      sortOrder: row.sortOrder ?? 0,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }));
  }

  private mapShot(row: typeof shots.$inferSelect): Shot {
    return {
      id: row.id,
      projectId: row.projectId,
      sceneId: row.sceneId,
      segmentId: row.segmentId ?? undefined,
      shotNumber: row.shotNumber,
      screenDirection: (row.screenDirection as Shot['screenDirection']) ?? undefined,
      beats: (row.beats as Shot['beats']) ?? undefined,
      duration: Number(row.duration),
      inPoint: row.inPoint != null ? Number(row.inPoint) : undefined,
      outPoint: row.outPoint != null ? Number(row.outPoint) : undefined,
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
