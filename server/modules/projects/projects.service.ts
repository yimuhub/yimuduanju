import { Injectable, Inject, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { eq, and, ilike, count, desc, sql } from 'drizzle-orm';

import { projects, generationJobs } from '@server/database/schema';
import { BudgetCapService } from '../generation/budget-cap.service';
import { MemoryService } from '../memory/memory.service';
import type {
  Project,
  ProjectListItem,
  ProjectListResponse,
  CreateProjectRequest,
  UpdateProjectRequest,
  ProjectListParams,
  QuickCreateRequest,
  QuickCreateResponse,
  ProjectProgressResponse,
  GenerationProgress,
  ProjectStatus,
  Shot,
} from '@shared/api.interface';

const STATUS_ORDER: ProjectStatus[] = [
  'draft',
  'parsing',
  'planning',
  'bible_ready',
  'storyboard_ready',
  'assets_generating',
  'video_generating',
  'audio_generating',
  'editing',
  'qc',
  'ready',
  'exported',
  'failed',
];

const STEP_LABELS: Record<string, string> = {
  draft: '草稿',
  parsing: '剧本解析',
  planning: '制作规划',
  bible_ready: '制作圣经',
  storyboard_ready: '分镜故事板',
  assets_generating: '资产生成',
  video_generating: '视频生成',
  audio_generating: '音频生成',
  editing: '剪辑合成',
  qc: '质检',
  ready: '成片就绪',
  exported: '已导出',
  failed: '失败',
};

/**
 * P0 安全修复：项目状态机转移白名单
 * - 同值：允许（幂等）
 * - 前进一步：允许（正常推进）
 * - 任意非终态 → failed：允许（失败上报）
 * - failed → 终态前任意步骤：允许（失败重试）
 * - ready → exported：允许（导出）
 * - 其余（如 draft 直跳 ready/exported、exported 回退）：拒绝
 */
function isAllowedTransition(from: ProjectStatus, to: ProjectStatus): boolean {
  if (from === to) return true;
  if (to === 'failed') return from !== 'exported';
  if (from === 'failed') return to !== 'exported';
  if (from === 'ready' && to === 'exported') return true;
  if (from === 'exported') return false;
  return STATUS_ORDER.indexOf(to) === STATUS_ORDER.indexOf(from) + 1;
}

function mapProject(
  row: typeof projects.$inferSelect & { provider_override?: unknown },
): Project {
  return {
    id: row.id,
    title: row.title,
    description: row.description ?? undefined,
    status: row.status as Project['status'],
    mode: row.mode as Project['mode'],
    contentMode: (row.contentMode as Project['contentMode']) ?? 'general',
    durationSeconds: row.durationSeconds ?? 0,
    aspectRatio: row.aspectRatio as Project['aspectRatio'],
    artStyle: row.artStyle as Project['artStyle'],
    genre: row.genre ?? undefined,
    budgetMode: row.budgetMode as Project['budgetMode'],
    totalCost: Number(row.totalCost ?? 0),
    thumbnailUrl: row.thumbnailUrl ?? undefined,
    scriptText: row.scriptText ?? undefined,
    worldView: (row.worldView as Project['worldView']) ?? undefined,
    styleBible: (row.styleBible as Project['styleBible']) ?? undefined,
    metadata: (row.metadata as Project['metadata']) ?? undefined,
    // provider_override 列由 migration 0007 添加，生成 schema 尚未包含；运行时列真实存在
    providerOverride:
      (row.provider_override as Project['providerOverride']) ?? undefined,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function mapProjectListItem(row: typeof projects.$inferSelect): ProjectListItem {
  return {
    id: row.id,
    title: row.title,
    description: row.description ?? undefined,
    status: row.status as ProjectListItem['status'],
    mode: row.mode as ProjectListItem['mode'],
    durationSeconds: row.durationSeconds ?? 0,
    artStyle: row.artStyle as ProjectListItem['artStyle'],
    thumbnailUrl: row.thumbnailUrl ?? undefined,
    totalCost: Number(row.totalCost ?? 0),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * W4 网关收敛：数据库行 → Shot。
 * 与原 scripts/gateway.js 的 toShot 逐字段同口径（收敛后唯一实现）。
 */
function toShotRaw(row: Record<string, any>): Shot {
  return {
    id: row.id,
    projectId: row.project_id,
    sceneId: row.scene_id,
    shotNumber: row.shot_number,
    duration: Number(row.duration || 0),
    shotSize: row.shot_size,
    cameraAngle: row.camera_angle,
    lens: row.lens,
    movement: row.movement,
    subject: row.subject ?? undefined,
    action: row.action ?? undefined,
    emotion: row.emotion ?? undefined,
    dialogue: row.dialogue ?? undefined,
    visualPrompt: row.visual_prompt ?? undefined,
    negativePrompt: row.negative_prompt ?? undefined,
    startFrameUrl: row.start_frame_url ?? undefined,
    endFrameUrl: row.end_frame_url ?? undefined,
    referenceImageUrls: row.reference_image_urls ?? [],
    videoUrl: row.video_url ?? undefined,
    voiceUrl: row.voice_url ?? undefined,
    sfxUrls: row.sfx_urls ?? [],
    subtitleText: row.subtitle_text ?? undefined,
    characterIds: row.character_ids ?? [],
    locked: row.locked,
    status: row.status,
    sortOrder: row.sort_order,
    createdAt: new Date(row._created_at).toISOString(),
    updatedAt: new Date(row._updated_at).toISOString(),
  };
}

@Injectable()
export class ProjectsService {
  private readonly logger = new Logger(ProjectsService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    private readonly budgetCap: BudgetCapService,
    private readonly memory: MemoryService,
  ) {}

  async list(params: ProjectListParams): Promise<ProjectListResponse> {
    // P1 修复：分页参数钳制，防 NaN/负数/超大翻页
    const page = Math.max(1, Math.floor(Number(params.page)) || 1);
    const pageSize = Math.min(
      50,
      Math.max(1, Math.floor(Number(params.pageSize)) || 10),
    );
    const offset = (page - 1) * pageSize;

    const conditions = [];
    if (params.status) {
      conditions.push(eq(projects.status, params.status));
    }
    if (params.keyword) {
      // P2 修复：转义 LIKE 通配符，避免 %/_ 被当通配符超匹配
      const escaped = params.keyword.replace(/[\\%_]/g, (c) => `\\${c}`);
      conditions.push(ilike(projects.title, `%${escaped}%`));
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [rows, countResult] = await Promise.all([
      this.db
        .select()
        .from(projects)
        .where(where)
        .orderBy(desc(projects.createdAt))
        .limit(pageSize)
        .offset(offset),
      this.db
        .select({ count: count() })
        .from(projects)
        .where(where),
    ]);

    const total = Number(countResult[0]?.count ?? 0);
    const items: ProjectListItem[] = rows.map(mapProjectListItem);

    return { items, total, page, pageSize };
  }

  async findById(id: string): Promise<Project> {
    const rows = await this.db
      .select()
      .from(projects)
      .where(eq(projects.id, id))
      .limit(1);

    if (rows.length === 0) {
      throw new NotFoundException('项目不存在');
    }

    return mapProject(rows[0]);
  }

  /**
   * W4 网关收敛：按场景查镜头
   * GET /api/projects/:id/storyboard/scenes/:sceneId/shots
   * （原 scripts/gateway.js 直连 PG 补全；SQL 与网关实现逐字一致，
   * 返回字段与网关 toShot 同口径）
   */
  async listSceneShots(projectId: string, sceneId: string): Promise<Shot[]> {
    const rows = (await this.db.execute(sql`
      SELECT id, project_id, scene_id, shot_number, duration, shot_size, camera_angle, lens,
             movement, subject, action, emotion, dialogue, visual_prompt, negative_prompt,
             start_frame_url, end_frame_url, reference_image_urls, video_url, voice_url,
             sfx_urls, subtitle_text, character_ids, locked, status, sort_order, _created_at, _updated_at
      FROM shots
      WHERE project_id = ${projectId} AND scene_id = ${sceneId}
      ORDER BY shot_number ASC, _created_at ASC
    `)) as unknown as Record<string, any>[];
    return rows.map(toShotRaw);
  }

  async create(dto: CreateProjectRequest, userId: string): Promise<Project> {
    const inserted = await this.db
      .insert(projects)
      .values({
        title: dto.title,
        description: dto.description,
        mode: dto.mode,
        contentMode: dto.contentMode,
        durationSeconds: dto.durationSeconds ?? 90,
        aspectRatio: dto.aspectRatio ?? '9:16',
        artStyle: dto.artStyle ?? 'realistic',
        genre: dto.genre,
        budgetMode: dto.budgetMode ?? 'balanced',
        scriptText: dto.scriptText,
        status: 'draft',
      })
      .returning();

    this.logger.log(`用户 ${userId} 创建项目 ${inserted[0].id}`);
    return mapProject(inserted[0]);
  }

  async update(id: string, dto: UpdateProjectRequest, userId: string): Promise<Project> {
    // P0 安全修复：状态机转移白名单。前端当前只写 scriptText 等业务字段，
    // status 跳转必须合法：同值/前进一步/任意→failed/failed 重试回滚/ready→exported
    if (dto.status !== undefined) {
      if (!STATUS_ORDER.includes(dto.status)) {
        throw new BadRequestException(`非法项目状态: ${dto.status}`);
      }
      const current = await this.findById(id);
      if (!isAllowedTransition(current.status, dto.status)) {
        throw new BadRequestException(
          `不允许的状态跳转: ${current.status} → ${dto.status}`,
        );
      }
    }

    const patch: Partial<typeof projects.$inferInsert> = {};

    if (dto.title !== undefined) patch.title = dto.title;
    if (dto.description !== undefined) patch.description = dto.description;
    if (dto.status !== undefined) patch.status = dto.status;
    if (dto.contentMode !== undefined) patch.contentMode = dto.contentMode;
    if (dto.durationSeconds !== undefined) patch.durationSeconds = dto.durationSeconds;
    if (dto.aspectRatio !== undefined) patch.aspectRatio = dto.aspectRatio;
    if (dto.artStyle !== undefined) patch.artStyle = dto.artStyle;
    if (dto.genre !== undefined) patch.genre = dto.genre;
    if (dto.budgetMode !== undefined) patch.budgetMode = dto.budgetMode;
    if (dto.scriptText !== undefined) patch.scriptText = dto.scriptText;
    if (dto.worldView !== undefined) patch.worldView = dto.worldView as typeof projects.$inferInsert['worldView'];
    if (dto.styleBible !== undefined) patch.styleBible = dto.styleBible as typeof projects.$inferInsert['styleBible'];
    if (dto.thumbnailUrl !== undefined) patch.thumbnailUrl = dto.thumbnailUrl;
    if (dto.metadata !== undefined) patch.metadata = dto.metadata as typeof projects.$inferInsert['metadata'];

    if (Object.keys(patch).length === 0 && dto.providerOverride === undefined) {
      return this.findById(id);
    }

    patch.updatedAt = new Date();

    const updated = await this.db
      .update(projects)
      .set(patch)
      .where(eq(projects.id, id))
      .returning();

    if (updated.length === 0) {
      throw new NotFoundException('项目不存在');
    }

    // provider_override 列走原生 SQL（生成 schema 尚未包含该列）
    if (dto.providerOverride !== undefined) {
      if (dto.providerOverride === null) {
        await this.db.execute(
          sql`UPDATE projects SET provider_override = NULL WHERE id = ${id}`,
        );
      } else {
        const value = {
          providerName: dto.providerOverride.providerName?.trim() || undefined,
        };
        await this.db.execute(
          sql`UPDATE projects SET provider_override = ${JSON.stringify(value)}::jsonb WHERE id = ${id}`,
        );
      }
    }

    this.logger.log(`用户 ${userId} 更新项目 ${id}`);
    // F2 系列记忆自动索引：metadata.series.facts 变化时重建 fact 向量（失败不阻塞主流程）
    const seriesFacts = (
      dto.metadata as { series?: { facts?: unknown } } | undefined
    )?.series?.facts;
    if (Array.isArray(seriesFacts)) {
      const texts = seriesFacts
        .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
        .slice(0, 50);
      this.memory.index(id, 'fact', texts).catch((e: Error) => {
        this.logger.warn(`系列记忆索引失败（不阻塞）：${e.message}`);
      });
    }
    return this.findById(id);
  }

  async delete(id: string, userId: string): Promise<void> {
    const deleted = await this.db
      .delete(projects)
      .where(eq(projects.id, id))
      .returning({ id: projects.id });

    if (deleted.length === 0) {
      throw new NotFoundException('项目不存在');
    }

    this.logger.log(`用户 ${userId} 删除项目 ${id}`);
  }

  async quickCreate(dto: QuickCreateRequest, userId: string): Promise<QuickCreateResponse> {
    // P1 超预算拦截：创建即落任务，先守卫
    await this.budgetCap.assertAllowed();
    // P1 专业模式透传：mode 与导演参数落库（metadata），剧本物化与后续生成消费；
    // 之前专业模式固定存 quick 且参数被丢弃
    // W4 剧本技能：一句话扩写开关默认开（expandScript !== false），走 LLM 先成剧本再物化；
    // 关闭则走离线启发式（无 Key 可用）
    const expandScript = dto.expandScript !== false;
    const professional = dto.professional ? { professional: dto.professional } : undefined;
    // P1 修复：创建项目 + 创建 job 改为同一事务，避免第二步失败留下孤儿项目
    const { project, jobId } = await this.db.transaction(async (tx) => {
      // 创建项目并初始化状态机状态为 parsing
      const inserted = await tx
        .insert(projects)
        .values({
          title: dto.prompt.slice(0, 50) || '极速创作项目',
          description: dto.prompt,
          mode: dto.mode ?? 'quick',
          contentMode: dto.contentMode ?? 'general',
          durationSeconds: dto.durationSeconds,
          aspectRatio: dto.aspectRatio,
          artStyle: dto.artStyle,
          genre: dto.genre,
          budgetMode: dto.budgetMode,
          scriptText: dto.prompt,
          status: 'parsing',
          ...(professional ? { metadata: professional } : {}),
        })
        .returning();

      const project = inserted[0];

      // 创建首个 generation job：扩写开 = script 技能任务（LLM 成剧本后链式物化）；
      // 扩写关 = parse_script 启发式直接拆分
      const firstJob = expandScript
        ? {
            jobType: 'script' as const,
            inputData: {
              kind: 'one_sentence_expand',
              source: dto.prompt,
              styleId: dto.artStyle,
              genreId: dto.genreId,
              rewriteEnabled: dto.professional?.rewriteEnabled,
            },
          }
        : {
            jobType: 'parse_script' as const,
            inputData: { prompt: dto.prompt },
          };
      const jobInserted = await tx
        .insert(generationJobs)
        .values({
          projectId: project.id,
          jobType: firstJob.jobType,
          targetType: 'project',
          targetId: project.id,
          status: 'pending',
          priority: 80,
          inputData: firstJob.inputData as typeof generationJobs.$inferInsert['inputData'],
        })
        .returning({ id: generationJobs.id });

      return { project, jobId: jobInserted[0].id };
    });

    this.logger.log(`用户 ${userId} 极速创建项目 ${project.id}, job=${jobId}`);

    return {
      projectId: project.id,
      jobId,
      status: project.status as ProjectStatus,
    };
  }

  async getProgress(id: string): Promise<ProjectProgressResponse> {
    // 确认项目存在
    const projectRows = await this.db
      .select({ id: projects.id, status: projects.status })
      .from(projects)
      .where(eq(projects.id, id))
      .limit(1);

    if (projectRows.length === 0) {
      throw new NotFoundException('项目不存在');
    }

    const projectStatus = projectRows[0].status as ProjectStatus;

    // 统计各阶段任务进度
    const jobRows = await this.db
      .select({
        jobType: generationJobs.jobType,
        status: generationJobs.status,
        progress: generationJobs.progress,
      })
      .from(generationJobs)
      .where(eq(generationJobs.projectId, id));

    // 构建状态机步骤
    const steps: GenerationProgress[] = STATUS_ORDER
      .filter((s) => s !== 'failed' && s !== 'exported')
      .map((step) => {
        const stepIndex = STATUS_ORDER.indexOf(step);
        const currentIndex = STATUS_ORDER.indexOf(projectStatus);
        let status: GenerationProgress['status'] = 'pending';
        let progress = 0;

        if (stepIndex < currentIndex) {
          status = 'completed';
          progress = 100;
        } else if (stepIndex === currentIndex) {
          status = 'running';
          // 根据相关 job 的进度估算当前步骤进度
          const relatedJobs = jobRows.filter((j) => {
            const jt = j.jobType;
            if (step === 'parsing') return jt === 'parse_script' || jt === 'script' || jt === 'boards';
            // storyboard 阶段实际任务是物化链（parse_script/script/boards），不存在 jobType=storyboard
            if (step === 'storyboard_ready') return jt === 'parse_script' || jt === 'script' || jt === 'boards';
            if (step === 'assets_generating') return jt === 'image';
            if (step === 'video_generating') return jt === 'video';
            if (step === 'audio_generating') return jt === 'tts';
            if (step === 'qc') return jt === 'qc';
            if (step === 'editing') return jt === 'edit';
            return false;
          });
          if (relatedJobs.length > 0) {
            const avgProgress = relatedJobs.reduce(
              (sum: number, j) => sum + (j.progress ?? 0),
              0,
            ) / relatedJobs.length;
            progress = Math.round(avgProgress);
            const anyRunning = relatedJobs.some(
              (j) => j.status === 'running' || j.status === 'pending' || j.status === 'queued',
            );
            if (!anyRunning && progress >= 100) {
              status = 'completed';
            }
          } else {
            progress = 5; // 刚进入该阶段的初始进度
          }
        }

        // 失败状态
        if (projectStatus === 'failed') {
          status = stepIndex < currentIndex ? 'completed' :
                   stepIndex === currentIndex ? 'failed' : 'pending';
        }

        return {
          step,
          stepLabel: STEP_LABELS[step] ?? step,
          status,
          progress,
        };
      });

    // 计算整体进度
    const totalSteps = steps.length;
    const completedWeight = steps.reduce((sum: number, s) => {
      if (s.status === 'completed') return sum + 1;
      if (s.status === 'running') return sum + s.progress / 100;
      return sum;
    }, 0);
    const overallProgress = Math.round((completedWeight / totalSteps) * 100);

    // 当前步骤
    const currentStep = steps.find((s) => s.status === 'running')?.step;

    return {
      projectId: id,
      overallStatus: projectStatus,
      overallProgress,
      steps,
      currentStep,
    };
  }
}
