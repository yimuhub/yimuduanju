import { Inject, Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import {
  episodes,
  projects,
  shots,
  scenes,
} from '@server/database/schema';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import type {
  Episode,
  EpisodePipeline,
  EpisodeProgress,
  EpisodeStatus,
  HandoffState,
  Project,
} from '@shared/api.interface';
import {
  appendFact as appendFactPure,
  assertEpisodeQuota,
  canAdvanceEpisode,
  episodeDeleteGuard,
  episodeGateGuard,
  normalizeHandoffState,
  nextEpisodeNumber,
  resolveProp as resolvePropPure,
  upsertRelation as upsertRelationPure,
} from '@shared/episode-logic';
import { computePipelineReadiness } from '@shared/pipeline-readiness';
// 注意：这两个必须是值导入（非 import type）——Nest 的 DI 元数据（design:paramtypes）
// 由构造函数参数类型生成，import type 会被 SWC 擦除成 Object，启动时无法解析依赖。
import { StoryboardService } from '../storyboard/storyboard.service';
import { BibleService } from '../bible/bible.service';
import type { EpisodeApproveStage } from './dto';

const EPISODE_STATUSES_BY_GATE: Record<EpisodeApproveStage, EpisodeStatus> = {
  script: 'script_ready',
  storyboard: 'shots_ready',
  preview: 'video_generating',
  final: 'completed',
};

@Injectable()
export class EpisodesService {
  private readonly logger = new Logger(EpisodesService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    private readonly storyboardService: StoryboardService,
    private readonly bibleService: BibleService,
  ) {}

  // ========== 查询 ==========

  /** 按项目列集：排序 (season, number)，列表只带集级字段，不拉分镜（学 huobao 路由级分页） */
  async listEpisodes(projectId: string, season?: number): Promise<Episode[]> {
    const conditions = [eq(episodes.projectId, projectId)];
    if (season !== undefined) conditions.push(eq(episodes.season, season));
    const rows = await this.db
      .select()
      .from(episodes)
      .where(and(...conditions))
      .orderBy(asc(episodes.season), asc(episodes.number));
    return rows.map((r) => this.mapEpisode(r));
  }

  async getEpisode(projectId: string, id: string): Promise<Episode> {
    const rows = await this.db
      .select()
      .from(episodes)
      .where(and(eq(episodes.id, id), eq(episodes.projectId, projectId)))
      .limit(1);
    if (rows.length === 0) throw new NotFoundException('集不存在');
    return this.mapEpisode(rows[0]);
  }

  /** 交接账本读取（规范化：无论存量是 '{}' 还是旧结构，三数组永远齐全） */
  async getHandoffState(projectId: string, id: string): Promise<HandoffState> {
    const episode = await this.getEpisode(projectId, id);
    return episode.handoffState;
  }

  // ========== 创建 / 更新 / 删除 ==========

  /**
   * 创建集：number 季内自动递增（上限 500）；首个集会把项目切到开集模式
   * （projects.has_episodes=true）并置为当前活跃集（metadata.activeEpisodeId）。
   * 旧项目只要不建集，行为完全不变（向后兼容硬要求）。
   */
  async createEpisode(
    projectId: string,
    dto: { title?: string; season?: number },
    userId?: string,
  ): Promise<Episode> {
    const projRows = await this.db
      .select({ id: projects.id, metadata: projects.metadata })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    if (projRows.length === 0) throw new NotFoundException('项目不存在');

    const season = dto.season !== undefined ? Math.trunc(dto.season) : 1;
    if (!Number.isFinite(season) || season < 1) {
      throw new BadRequestException('season 必须是 ≥1 的整数');
    }
    const maxRows = await this.db
      .select({ max: sql<number>`coalesce(max(${episodes.number}), 0)` })
      .from(episodes)
      .where(and(eq(episodes.projectId, projectId), eq(episodes.season, season)));
    const countRows = await this.db
      .select({ c: sql<number>`count(*)` })
      .from(episodes)
      .where(and(eq(episodes.projectId, projectId), eq(episodes.season, season)));
    // 上限在边界处硬拒绝（超限不静默截断）
    assertEpisodeQuota(Number(countRows[0]?.c ?? 0));

    const inserted = await this.db
      .insert(episodes)
      .values({
        projectId,
        season,
        number: nextEpisodeNumber(Number(maxRows[0]?.max ?? 0)),
        title: dto.title?.trim() || null,
        status: 'draft',
        handoffState: { facts: [], props: [], relations: [] },
        pipeline: {},
      })
      .returning();
    const created = inserted[0];

    // 开集模式 + 活跃集切换：新集即当前活跃集（shots 创建时自动归入）
    const meta = (projRows[0].metadata ?? {}) as Record<string, unknown>;
    await this.db
      .update(projects)
      .set({
        hasEpisodes: true,
        metadata: { ...meta, activeEpisodeId: created.id } as unknown as Project['metadata'],
        updatedAt: new Date(),
      })
      .where(eq(projects.id, projectId));
    this.logger.log(
      `项目 ${projectId} 新建 S${season}E${created.number}（${created.id}），已切为开集模式并置为活跃集`,
    );
    return this.mapEpisode(created);
  }

  async updateEpisode(
    projectId: string,
    id: string,
    dto: { title?: string; status?: EpisodeStatus; locked?: boolean; active?: boolean },
    userId?: string,
  ): Promise<Episode> {
    const current = await this.getEpisode(projectId, id);
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (dto.title !== undefined) patch.title = dto.title.trim() || null;
    if (dto.locked !== undefined) patch.locked = dto.locked;
    if (dto.status !== undefined) {
      if (!canAdvanceEpisode(current.status, dto.status)) {
        throw new BadRequestException(
          `集状态只能沿 draft → script_ready → shots_ready → video_generating → completed 单向推进（当前 ${current.status}）`,
        );
      }
      patch.status = dto.status;
    }
    const updated = await this.db
      .update(episodes)
      .set(patch)
      .where(and(eq(episodes.id, id), eq(episodes.projectId, projectId)))
      .returning();
    if (updated.length === 0) throw new NotFoundException('集不存在');

    if (dto.active === true) await this.setActiveEpisode(projectId, id);
    // userId 仅用于审计链路对齐（projects.update 同口径），此处无独立审计列，保留参数
    void userId;
    return this.mapEpisode(updated[0]);
  }

  /** 切换当前活跃集（project.metadata.activeEpisodeId）： shots 创建自动归入的目标 */
  async setActiveEpisode(projectId: string, id: string): Promise<void> {
    const episode = await this.getEpisode(projectId, id);
    const projRows = await this.db
      .select({ metadata: projects.metadata })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    const meta = (projRows[0]?.metadata ?? {}) as Record<string, unknown>;
    await this.db
      .update(projects)
      .set({
        hasEpisodes: true,
        metadata: { ...meta, activeEpisodeId: episode.id } as unknown as Project['metadata'],
        updatedAt: new Date(),
      })
      .where(eq(projects.id, projectId));
  }

  /**
   * 删除集（删除保护 + 确认删该集 shots/scenes）：
   * - locked 拒删；挂着 shots/scenes 时必须显式 force=true（应用层级联）；
   * - force 删除先清 shots/scenes 再删集；不 force 删除公共资产（episode_id 置 NULL 的行不受影响）。
   */
  async deleteEpisode(projectId: string, id: string, force?: boolean): Promise<void> {
    const current = await this.getEpisode(projectId, id);
    const [shotCount, sceneCount] = await Promise.all([
      this.db
        .select({ c: sql<number>`count(*)` })
        .from(shots)
        .where(and(eq(shots.projectId, projectId), eq(shots.episodeId, id))),
      this.db
        .select({ c: sql<number>`count(*)` })
        .from(scenes)
        .where(and(eq(scenes.projectId, projectId), eq(scenes.episodeId, id))),
    ]);
    const reason = episodeDeleteGuard(
      { locked: current.locked, status: current.status },
      { shots: Number(shotCount[0]?.c ?? 0), scenes: Number(sceneCount[0]?.c ?? 0) },
      force,
    );
    if (reason) throw new BadRequestException(reason);

    await this.db.transaction(async (tx) => {
      await tx
        .delete(shots)
        .where(and(eq(shots.projectId, projectId), eq(shots.episodeId, id)));
      await tx
        .delete(scenes)
        .where(and(eq(scenes.projectId, projectId), eq(scenes.episodeId, id)));
      await tx
        .delete(episodes)
        .where(and(eq(episodes.id, id), eq(episodes.projectId, projectId)));
    });
    // 活跃集被删：回落到剩余最新一集（无集则清掉 activeEpisodeId，has_episodes 保持 true
    // —— 项目仍处于开集形态，只是暂无集）
    const meta = await this.projectMeta(projectId);
    if (meta.activeEpisodeId === id) {
      const remaining = await this.listEpisodes(projectId);
      const next = remaining.length > 0 ? remaining[remaining.length - 1].id : undefined;
      await this.patchProjectMeta(projectId, (m) => {
        if (next) m.activeEpisodeId = next;
        else delete m.activeEpisodeId;
      });
    }
    this.logger.log(`集 ${id} 已删除（force=${force === true}）`);
  }

  // ========== 跨集交接账本（B2） ==========

  /** 追加不可逆事实：同文本去重；落库前规范化整个账本 */
  async appendFact(projectId: string, id: string, text: string): Promise<HandoffState> {
    const current = await this.getHandoffState(projectId, id);
    const { facts, changed } = appendFactPure(current, text, new Date().toISOString());
    if (!changed) return current;
    return this.writeHandoff(projectId, id, { ...current, facts });
  }

  /** 道具归属落账：同名道具覆盖 holder（转手），新道具追加 */
  async resolveProp(projectId: string, id: string, name: string, holder: string): Promise<HandoffState> {
    const current = await this.getHandoffState(projectId, id);
    const { props, changed } = resolvePropPure(current, name, holder, new Date().toISOString());
    if (!changed) return current;
    return this.writeHandoff(projectId, id, { ...current, props });
  }

  /** 关系变化落账：(a,b) 无序对唯一，同对覆盖 status */
  async upsertRelation(projectId: string, id: string, a: string, b: string, status: string): Promise<HandoffState> {
    const current = await this.getHandoffState(projectId, id);
    const { relations, changed } = upsertRelationPure(current, a, b, status);
    if (!changed) return current;
    return this.writeHandoff(projectId, id, { ...current, relations });
  }

  private async writeHandoff(projectId: string, id: string, state: HandoffState): Promise<HandoffState> {
    const updated = await this.db
      .update(episodes)
      .set({ handoffState: state, updatedAt: new Date() })
      .where(and(eq(episodes.id, id), eq(episodes.projectId, projectId)))
      .returning({ handoffState: episodes.handoffState });
    if (updated.length === 0) throw new NotFoundException('集不存在');
    return normalizeHandoffState(updated[0].handoffState);
  }

  // ========== 按集流水线（A4 最小实现：进度按集聚合，不重写 project 级状态机） ==========

  /**
   * 按集 approve（复用 project 级门语义的按集版本）：门通过时间存 episodes.pipeline.approvals，
   * 通过时集状态同步推进（script→script_ready → storyboard→shots_ready → preview→video_generating
   * → final→completed）。project 级门的代码路径零改动——旧项目行为完全不变。
   */
  async approveEpisodeStage(
    projectId: string,
    id: string,
    stage: EpisodeApproveStage,
    userId?: string,
  ): Promise<Episode> {
    const current = await this.getEpisode(projectId, id);
    const pipeline: EpisodePipeline = current.pipeline ?? {};
    const approvals = { ...(pipeline.approvals ?? {}) };
    const guard = episodeGateGuard(stage, approvals);
    if (guard) throw new BadRequestException(guard);

    // preview/final 沿用 project 级门的硬校验（按集子集）：缺主图/缺成片不放行
    if (stage === 'preview' || stage === 'final') {
      const shotRows = await this.db
        .select({
          id: shots.id,
          startFrameUrl: shots.startFrameUrl,
          videoUrl: shots.videoUrl,
          voiceUrl: shots.voiceUrl,
          dialogue: shots.dialogue,
          status: shots.status,
        })
        .from(shots)
        .where(and(eq(shots.projectId, projectId), eq(shots.episodeId, id)));
      if (shotRows.length === 0) {
        throw new BadRequestException('本集还没有分镜镜头，无法确认该门');
      }
      const readiness = computePipelineReadiness(shotRows);
      if (stage === 'preview' && readiness.missingFrames.length > 0) {
        throw new BadRequestException(
          `本集还有 ${readiness.missingFrames.length}/${readiness.total} 个镜头没有首帧主图，不能进入视频生成`,
        );
      }
      if (stage === 'final' && !readiness.videoComplete) {
        throw new BadRequestException(
          `本集还有 ${readiness.missingVideos.length}/${readiness.total} 个镜头没有成片，不能确认集成片`,
        );
      }
    }

    const now = new Date().toISOString();
    approvals[stage] = now;
    const nextStatus = EPISODE_STATUSES_BY_GATE[stage];
    const status: EpisodeStatus = canAdvanceEpisode(current.status, nextStatus)
      ? nextStatus
      : current.status;
    const updated = await this.db
      .update(episodes)
      .set({
        pipeline: { ...pipeline, approvals },
        status,
        updatedAt: new Date(),
      })
      .where(and(eq(episodes.id, id), eq(episodes.projectId, projectId)))
      .returning();
    if (updated.length === 0) throw new NotFoundException('集不存在');
    void userId;
    this.logger.log(`集 ${id} 通过 ${stage} 门（状态 ${current.status} → ${status}）`);
    return this.mapEpisode(updated[0]);
  }

  /** 单集进度聚合（供前端集工作台页头） */
  async getEpisodeProgress(projectId: string, id: string): Promise<EpisodeProgress> {
    const episode = await this.getEpisode(projectId, id);
    const agg = await this.aggregateShots(projectId, id);
    return {
      episodeId: episode.id,
      season: episode.season,
      number: episode.number,
      status: episode.status,
      approvals: episode.pipeline?.approvals ?? {},
      totalShots: agg.totalShots,
      withFirstFrame: agg.withFirstFrame,
      withVideo: agg.withVideo,
      videoComplete: agg.videoComplete,
    };
  }

  /** 全项目按集聚合的管线进度（A4：drivePipeline 兼容的最小实现） */
  async listEpisodeProgress(projectId: string): Promise<EpisodeProgress[]> {
    const list = await this.listEpisodes(projectId);
    const allShots = await this.db
      .select({
        id: shots.id,
        episodeId: shots.episodeId,
        startFrameUrl: shots.startFrameUrl,
        videoUrl: shots.videoUrl,
        voiceUrl: shots.voiceUrl,
        dialogue: shots.dialogue,
        status: shots.status,
      })
      .from(shots)
      .where(eq(shots.projectId, projectId));
    return list.map((episode) => {
      const scoped = allShots.filter((s) => s.episodeId === episode.id);
      const readiness = computePipelineReadiness(scoped);
      return {
        episodeId: episode.id,
        season: episode.season,
        number: episode.number,
        status: episode.status,
        approvals: episode.pipeline?.approvals ?? {},
        totalShots: readiness.total,
        withFirstFrame: readiness.total - readiness.missingFrames.length,
        withVideo: readiness.withVideo,
        videoComplete: readiness.videoComplete,
      };
    });
  }

  // ========== 按集查询端点（A3，供前端按集加载） ==========

  async listEpisodeShots(projectId: string, episodeId: string) {
    await this.getEpisode(projectId, episodeId);
    return this.storyboardService.listShotsByEpisode(projectId, episodeId);
  }

  async listEpisodeScenes(projectId: string, episodeId: string) {
    await this.getEpisode(projectId, episodeId);
    return this.storyboardService.listScenesByEpisode(projectId, episodeId);
  }

  /** 集内角色 = 本集专属 + 全剧公共（episode_id IS NULL） */
  async listEpisodeCharacters(projectId: string, episodeId: string) {
    await this.getEpisode(projectId, episodeId);
    return this.bibleService.listCharactersByEpisode(projectId, episodeId);
  }

  // ========== 当前活跃集（供 storyboard.service 创建 shots 自动归集） ==========

  /**
   * 解析当前活跃集 ID：project.metadata.activeEpisodeId（校验归属）→
   * 最新一集（season,number 最大）→ 无集返回 null（shots 落公共资产）。
   */
  async resolveActiveEpisodeId(projectId: string): Promise<string | null> {
    const meta = await this.projectMeta(projectId);
    const active = typeof meta.activeEpisodeId === 'string' ? meta.activeEpisodeId : null;
    if (active) {
      const rows = await this.db
        .select({ id: episodes.id })
        .from(episodes)
        .where(and(eq(episodes.id, active), eq(episodes.projectId, projectId)))
        .limit(1);
      if (rows.length > 0) return active;
    }
    const latest = await this.db
      .select({ id: episodes.id })
      .from(episodes)
      .where(eq(episodes.projectId, projectId))
      .orderBy(desc(episodes.season), desc(episodes.number))
      .limit(1);
    return latest[0]?.id ?? null;
  }

  // ========== 内部 ==========

  private async projectMeta(projectId: string): Promise<Record<string, unknown>> {
    const rows = await this.db
      .select({ metadata: projects.metadata })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    return (rows[0]?.metadata ?? {}) as Record<string, unknown>;
  }

  private async patchProjectMeta(
    projectId: string,
    mutate: (meta: Record<string, unknown>) => void,
  ): Promise<void> {
    const meta = await this.projectMeta(projectId);
    mutate(meta);
    await this.db
      .update(projects)
      .set({ metadata: meta as unknown as Project['metadata'], updatedAt: new Date() })
      .where(eq(projects.id, projectId));
  }

  private async aggregateShots(
    projectId: string,
    episodeId: string,
  ): Promise<{ totalShots: number; withFirstFrame: number; withVideo: number; videoComplete: boolean }> {
    const rows = await this.db
      .select({
        id: shots.id,
        startFrameUrl: shots.startFrameUrl,
        videoUrl: shots.videoUrl,
        voiceUrl: shots.voiceUrl,
        dialogue: shots.dialogue,
        status: shots.status,
      })
      .from(shots)
      .where(and(eq(shots.projectId, projectId), eq(shots.episodeId, episodeId)));
    const readiness = computePipelineReadiness(rows);
    return {
      totalShots: readiness.total,
      withFirstFrame: readiness.total - readiness.missingFrames.length,
      withVideo: readiness.withVideo,
      videoComplete: readiness.videoComplete,
    };
  }

  private mapEpisode(row: typeof episodes.$inferSelect): Episode {
    return {
      id: row.id,
      projectId: row.projectId,
      season: row.season,
      number: row.number,
      title: row.title ?? undefined,
      status: (row.status ?? 'draft') as EpisodeStatus,
      handoffState: normalizeHandoffState(row.handoffState),
      pipeline: (row.pipeline as EpisodePipeline | null) ?? {},
      locked: row.locked ?? false,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
