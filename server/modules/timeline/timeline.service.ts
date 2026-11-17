import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { mkdir, rename, stat, unlink, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { and, asc, desc, eq, lte } from 'drizzle-orm';
import {
  agentEditOps,
  assets,
  projects,
  scenes,
  shots,
  timelineClips,
  timelineDocuments,
  timelineRevisions,
} from '@server/database/schema';
import { resolveTextStyle } from '@shared/api.interface';
import { buildTransitionFilter, planTransitions } from './transition-plan';
import { applyTimelineOps, clipKey, type TimelineOp } from '@shared/timeline-ops';
import { scanTimelineIssues } from '@shared/timeline-issues';
import { buildZoompanExpressions, normalizeVideoKeyframes } from '@shared/timeline-keyframes';
import { expandCompounds } from '@shared/timeline-compound';
import type {
  Asset,
  ExportTimelineResult,
  TimelineClip,
  TimelineDocument,
  TimelineTrackMeta,
} from '@shared/api.interface';
import { uploadDir } from '../assets/upload-dir';
import { ExportService } from '../export/export.service';
import type {
  AgentTimelineOpsDto,
  ExportTimelineDto,
  SaveTimelineDto,
  SaveTimelineClipDto,
} from './dto';

const num = (v: unknown, fallback = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const round3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * 对比前后两份 EDL，返回改动过的片段 clientKey。
 * 只比较业务身份与渲染相关字段，避免 updatedAt/sortOrder 之类噪声。
 */
function diffChangedClientKeys(prev: SaveTimelineClipDto[], next: SaveTimelineClipDto[]): string[] {
  const norm = (c: SaveTimelineClipDto) => {
    const key = c.clientKey ?? '';
    return [
      key,
      c.track,
      c.lane ?? 0,
      c.sourceShotId ?? '',
      c.sourceUrl ?? '',
      c.inPoint,
      c.outPoint,
      c.timelineStart,
      c.speed ?? 1,
      c.volume ?? 1,
      c.text ?? '',
      c.bindGroup ?? '',
      c.locked ? 1 : 0,
      c.enabled === false ? 0 : 1,
      c.transition?.type ?? '',
      c.transition?.duration ?? 0,
      JSON.stringify(c.textStyle ?? null),
    ].join('|');
  };
  const prevMap = new Map(prev.map((c) => [c.clientKey ?? '', norm(c)]));
  const nextMap = new Map(next.map((c) => [c.clientKey ?? '', norm(c)]));
  const changed = new Set<string>();
  for (const [key, value] of nextMap) {
    if (!prevMap.has(key) || prevMap.get(key) !== value) changed.add(key);
  }
  for (const key of prevMap.keys()) {
    if (!nextMap.has(key)) changed.add(key);
  }
  changed.delete('');
  return [...changed];
}

function opTargetKeys(ops: TimelineOp[]): Set<string> | null {
  const keys = new Set<string>();
  for (const op of ops) {
    switch (op.op) {
      case 'move':
      case 'trim':
      case 'split':
      case 'speed':
      case 'volume':
      case 'lock':
      case 'enable':
        if (op.target?.clientKey) keys.add(op.target.clientKey);
        else if (op.target?.id) keys.add(op.target.id);
        else if (op.target?.code) keys.add(op.target.code);
        else return null;
        break;
      case 'delete':
        if (!op.targets?.length) return null;
        for (const t of op.targets) {
          if (t.clientKey) keys.add(t.clientKey);
          else if (t.id) keys.add(t.id);
          else if (t.code) keys.add(t.code);
          else return null;
        }
        break;
      case 'subtitle':
        if (!op.target?.clientKey) return null;
        keys.add(op.target.clientKey);
        break;
      case 'roughcut':
      case 'track':
        return null;
      default:
        return null;
    }
  }
  return keys;
}

const iso = (d: unknown): string =>
  d instanceof Date ? d.toISOString() : typeof d === 'string' ? d : new Date().toISOString();

/**
 * 静帧素材（首帧/图片）也允许拖进画面轨：导出时用 `-loop 1` 铺成一段视频，
 * 与真视频片段走同一条 concat 链，不需要在 EDL 里区分类型。
 */
const MEDIA_IMAGE_EXT = /\.(png|jpe?g|webp|bmp|gif|tiff?)(\?|$)|[?&]as=image(?:&|$)/i;
/** 落盘临时文件的后缀：按源地址推断，ffmpeg 探测靠内容，但保留后缀更利于排错 */
const mediaExt = (url: string): string => {
  // 图片资产经 /api/assets/:id/content?as=image 代理时没有扩展名，靠标记补成 .png；
  // ffmpeg -loop 1 的输入若被当成 .mp4 会直接渲染失败。
  if (/[?&]as=image(?:&|$)|(?:\.gif)(?:\?|$)/i.test(url)) return '.png';
  const clean = url.split('?')[0].split('#')[0];
  const m = /\.(png|jpe?g|webp|bmp|gif|tiff?|mp4|mov|m4v|webm|mkv)$/i.exec(clean);
  return m ? `.${m[1].toLowerCase()}` : '.mp4';
};

/** 片段有效时长（时间线占位） */
const clipSpan = (c: Pick<TimelineClip, 'inPoint' | 'outPoint' | 'speed'>) =>
  Math.max(0, (c.outPoint - c.inPoint) / (c.speed > 0 ? c.speed : 1));

/**
 * 线性剪辑 EDL（Phase 3/4）
 * -------------------------------------------------------------
 * shots 是「生产台账」，timeline_clips 是「剪辑决策表」。未保存过 EDL 的项目
 * GET 时从 shots 现派生（只读不落库），保证编辑器打开就有内容；PUT 后以
 * timeline_clips 为准。导出按 EDL 渲染：trim → 统一编码 → concat → 混音 → 字幕。
 */
@Injectable()
export class TimelineService {
  private readonly logger = new Logger(TimelineService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    private readonly exportService: ExportService,
  ) {}

  private async requireProject(projectId: string) {
    const rows = await this.db
      .select({ id: projects.id, title: projects.title })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    if (rows.length === 0) throw new NotFoundException('项目不存在');
    return rows[0];
  }

  /** 从镜头台账派生默认 EDL（不落库）：视频轨为主，配音/字幕跟随视频镜头对齐 */
  private async deriveDefault(projectId: string): Promise<TimelineDocument> {
    const rows = await this.db
      .select({
        id: shots.id,
        sceneNumber: scenes.sceneNumber,
        shotNumber: shots.shotNumber,
        sortOrder: shots.sortOrder,
        duration: shots.duration,
        inPoint: shots.inPoint,
        outPoint: shots.outPoint,
        videoUrl: shots.videoUrl,
        voiceUrl: shots.voiceUrl,
        subtitleText: shots.subtitleText,
        dialogue: shots.dialogue,
        createdAt: shots.createdAt,
      })
      .from(shots)
      .innerJoin(scenes, eq(shots.sceneId, scenes.id))
      .where(eq(shots.projectId, projectId))
      .orderBy(asc(shots.sortOrder), asc(scenes.sceneNumber), asc(shots.shotNumber), asc(shots.createdAt));
    const now = new Date().toISOString();
    const clips: TimelineClip[] = [];
    let cursor = 0;
    let sort = 0;
    for (const s of rows) {
      const dur = Math.max(0.1, num(s.duration, 4));
      const inPoint = s.inPoint != null ? num(s.inPoint) : 0;
      const outPoint = s.outPoint != null ? num(s.outPoint) : round3(inPoint + dur);
      if (!s.videoUrl) continue;
      clips.push({
        id: `derived-v-${s.id}`,
        clientKey: `derived-v-${s.id}`,
        projectId,
        track: 'video',
        sourceShotId: s.id,
        sourceUrl: s.videoUrl,
        inPoint,
        outPoint,
        timelineStart: round3(cursor),
        lane: 0,
        speed: 1,
        volume: 1,
        transition: { type: 'none', duration: 0 },
        text: null,
        // 同一镜头的画面 / 对白 / 字幕天然是绑定的：默认联动，用户可手动解绑
        bindGroup: `shot:${s.id}`,
        locked: false,
        enabled: true,
        sortOrder: sort++,
        createdAt: now,
        updatedAt: now,
      });
      if (s.voiceUrl) {
        clips.push({
          id: `derived-a-${s.id}`,
          clientKey: `derived-a-${s.id}`,
          projectId,
          track: 'audio',
          sourceShotId: s.id,
          sourceUrl: s.voiceUrl,
          inPoint: 0,
          outPoint: round3(outPoint - inPoint),
          timelineStart: round3(cursor),
          lane: 0,
          speed: 1,
          volume: 1,
          transition: { type: 'none', duration: 0 },
          text: null,
          bindGroup: `shot:${s.id}`,
          locked: false,
          sortOrder: sort++,
          createdAt: now,
          updatedAt: now,
        });
      }
      const sub = (s.subtitleText || s.dialogue || '').trim();
      if (sub) {
        clips.push({
          id: `derived-s-${s.id}`,
          clientKey: `derived-s-${s.id}`,
          projectId,
          track: 'subtitle',
          sourceShotId: s.id,
          sourceUrl: null,
          inPoint: 0,
          outPoint: round3(outPoint - inPoint),
          timelineStart: round3(cursor),
          lane: 0,
          speed: 1,
          volume: 1,
          transition: { type: 'none', duration: 0 },
          text: sub,
          bindGroup: `shot:${s.id}`,
          locked: false,
          sortOrder: sort++,
          createdAt: now,
          updatedAt: now,
        });
      }
      cursor = round3(cursor + (outPoint - inPoint));
    }
    return { projectId, fps: 24, width: 1080, height: 1920, clips };
  }

  private mapClip(row: typeof timelineClips.$inferSelect): TimelineClip {
    return {
      id: row.id,
      clientKey: row.clientKey ?? row.id,
      projectId: row.projectId,
      track: row.track as TimelineClip['track'],
      sourceShotId: row.sourceShotId,
      sourceUrl: row.sourceUrl,
      inPoint: num(row.inPoint),
      outPoint: num(row.outPoint),
      timelineStart: num(row.timelineStart),
      lane: row.lane ?? 0,
      speed: num(row.speed, 1) || 1,
      volume: num(row.volume, 1),
      transition: (row.transition as TimelineClip['transition']) ?? null,
      text: row.text,
      keyframes: (row.keyframes as TimelineClip['keyframes']) ?? null,
      reverse: Boolean(row.reverse),
      compound: (row.compound as TimelineClip['compound']) ?? null,
      textStyle: (row.textStyle as TimelineClip['textStyle']) ?? null,
      bindGroup: row.bindGroup,
      locked: row.locked,
      enabled: row.enabled !== false,
      sortOrder: row.sortOrder,
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.updatedAt),
    };
  }

  async getDocument(projectId: string): Promise<TimelineDocument> {
    await this.requireProject(projectId);
    const docRows = await this.db
      .select()
      .from(timelineDocuments)
      .where(eq(timelineDocuments.projectId, projectId))
      .limit(1);
    if (docRows.length === 0) return this.deriveDefault(projectId);
    const clipRows = await this.db
      .select()
      .from(timelineClips)
      .where(eq(timelineClips.projectId, projectId))
      .orderBy(asc(timelineClips.sortOrder), asc(timelineClips.timelineStart));
    const doc = docRows[0];
    return {
      projectId,
      fps: doc.fps,
      width: doc.width,
      height: doc.height,
      clips: clipRows.map((r) => this.mapClip(r)),
      version: doc.version ?? 0,
      tracks: (doc.tracks as TimelineDocument['tracks']) ?? [],
      updatedAt: iso(doc.updatedAt),
    };
  }

  /**
   * 整体替换 EDL（单事务）。clip.id 一律由服务端生成：客户端回传的 id 只用于
   * 本地关联，落库后以响应中的新 id 为准，避免跨项目 id 覆写风险。
   */
  async saveDocument(
    projectId: string,
    dto: SaveTimelineDto,
    meta?: { author?: 'user' | 'agent' | 'restore'; summary?: string | null; changedClientKeys?: string[] },
  ): Promise<TimelineDocument> {
    await this.requireProject(projectId);
    const fps = dto.fps ?? 24;
    const width = dto.width ?? 1080;
    const height = dto.height ?? 1920;
    // 入出点合法性：out > in；超时长的片段在渲染时按源媒体截断
    for (const c of dto.clips) {
      if (c.outPoint <= c.inPoint) {
        throw new BadRequestException(`片段入出点无效：out(${c.outPoint}) 必须大于 in(${c.inPoint})`);
      }
    }
    const now = new Date();
    let savedVersion = 1;
    await this.db.transaction(async (tx) => {
      await tx.delete(timelineClips).where(eq(timelineClips.projectId, projectId));
      if (dto.clips.length > 0) {
        const values = dto.clips.map((c: SaveTimelineClipDto, i: number) => ({
          projectId,
          clientKey: c.clientKey ?? null,
          track: c.track,
          sourceShotId: c.sourceShotId ?? null,
          sourceUrl: c.sourceUrl ?? null,
          inPoint: String(c.inPoint),
          outPoint: String(c.outPoint),
          timelineStart: String(c.timelineStart),
          lane: c.lane ?? 0,
          speed: String(c.speed ?? 1),
          volume: String(c.volume ?? 1),
          transition: c.transition ?? null,
          text: c.text ?? null,
          keyframes: c.keyframes ? normalizeVideoKeyframes(c.keyframes) : null,
          reverse: Boolean(c.reverse),
          compound: c.compound?.children?.length ? c.compound : null,
          bindGroup: c.bindGroup ?? null,
          textStyle: c.textStyle ?? null,
          locked: c.locked ?? false,
          enabled: c.enabled ?? true,
          sortOrder: c.sortOrder ?? i,
          updatedAt: now,
        }));
        await tx.insert(timelineClips).values(values);
      }
      const existing = await tx
        .select({ projectId: timelineDocuments.projectId, version: timelineDocuments.version })
        .from(timelineDocuments)
        .where(eq(timelineDocuments.projectId, projectId))
        .limit(1);
      const tracks = dto.tracks ?? null;
      if (existing.length === 0) {
        // 首次保存：库内还没有文档，若客户端声称基于旧版本（>0）则视为冲突
        if (dto.expectedVersion != null && dto.expectedVersion > 0) {
          throw new ConflictException('时间线已在别处更新，请刷新后重试');
        }
        await tx
          .insert(timelineDocuments)
          .values({ projectId, fps, width, height, tracks, version: 1 });
        savedVersion = 1;
      } else {
        const current = existing[0].version ?? 0;
        if (dto.expectedVersion != null && dto.expectedVersion !== current) {
          throw new ConflictException(
            `时间线已在别处更新（当前版本 ${current}，你基于 ${dto.expectedVersion}），请刷新后再改`,
          );
        }
        savedVersion = current + 1;
        await tx
          .update(timelineDocuments)
          .set({ fps, width, height, tracks, version: savedVersion, updatedAt: now })
          .where(eq(timelineDocuments.projectId, projectId));
      }

      // 修订账本：与 version 同号，每个保存动作一份快照。
      // 失败不会留下半条修订，因为它和 EDL 在同一个事务里。
      const prev = existing.length === 0 ? 0 : (existing[0].version ?? 0);
      const snapshot = {
        fps,
        width,
        height,
        tracks,
        clips: dto.clips.map((c, i) => ({ ...c, sortOrder: c.sortOrder ?? i })),
      };
      let changed = meta?.changedClientKeys;
      if (!changed) {
        if (prev === 0) {
          changed = dto.clips.map((c) => c.clientKey ?? '').filter(Boolean);
        } else {
          const prevRow = await tx
            .select({ snapshot: timelineRevisions.snapshot })
            .from(timelineRevisions)
            .where(
              and(
                eq(timelineRevisions.projectId, projectId),
                eq(timelineRevisions.revision, prev),
              ),
            )
            .limit(1);
          const prevClips = (prevRow[0]?.snapshot as { clips?: SaveTimelineClipDto[] } | null)
            ?.clips ?? [];
          changed = diffChangedClientKeys(prevClips, dto.clips);
        }
      }
      await tx
        .insert(timelineRevisions)
        .values({
          projectId,
          revision: savedVersion,
          parentRevision: prev > 0 ? prev : null,
          author: meta?.author ?? 'user',
          summary: meta?.summary ?? null,
          snapshot,
          changedClientKeys: changed,
        })
        .onConflictDoNothing();
      // 只保留最近 50 条修订；旧快照没有回滚价值，避免表无限增长
      if (savedVersion > 50) {
        await tx
          .delete(timelineRevisions)
          .where(
            and(
              eq(timelineRevisions.projectId, projectId),
              lte(timelineRevisions.revision, savedVersion - 50),
            ),
          );
      }
    });
    return this.getDocument(projectId);
  }

  /**
   * 对话驱动的剪辑：校验版本 → 纯函数 dry-run → 单事务保存 → 写审计。
   *
   * 为什么不在客户端直接改完再 PUT：
   *   · 模型给的 clientKey 可能过期，必须由服务端基于当前 EDL 解析；
   *   · 一批动作要么全成、要么全不成；客户端分步写会留下半截状态；
   *   · 审计要记录「基于哪个版本、改了什么」，便于回溯与幂等重试。
   */
  async applyAgentOps(
    projectId: string,
    dto: AgentTimelineOpsDto,
  ): Promise<{
    doc: TimelineDocument;
    diffs: ReturnType<typeof applyTimelineOps>['diffs'];
    auditId: string;
    idempotent: boolean;
    concurrentRevisions: number[];
  }> {
    await this.requireProject(projectId);

    // 幂等：同一批动作重发（网络重试 / 模型重试）直接返回已应用结果
    if (dto.idempotencyKey) {
      const hit = await this.db
        .select()
        .from(agentEditOps)
        .where(
          and(
            eq(agentEditOps.projectId, projectId),
            eq(agentEditOps.idempotencyKey, dto.idempotencyKey),
          ),
        )
        .limit(1);
      if (hit[0]) {
        return {
          doc: await this.getDocument(projectId),
          diffs: (hit[0].diffs as ReturnType<typeof applyTimelineOps>['diffs']) ?? [],
          auditId: hit[0].id,
          idempotent: true,
          concurrentRevisions: [],
        };
      }
    }

    const doc = await this.getDocument(projectId);
    const current = doc.version ?? 0;
    let concurrentRevisions: number[] = [];

    if (dto.baseVersion !== current) {
      /**
       * 冲突判定从「整批拒绝」升级为「按片段判定」：
       * baseVersion 之后如果别人只改了本次提案没碰的片段，提案可以安全落到最新版本；
       * 只要相交（或提案涉及全片 roughcut / 轨道属性），仍然拒绝并要求重新生成。
       */
      const changed = await this.changedKeysBetween(projectId, dto.baseVersion, current);
      const targets = opTargetKeys(dto.ops as unknown as TimelineOp[]);
      const intersects =
        targets === null || [...targets].some((k) => changed.has(k)) || changed.has('*');
      if (intersects) {
        throw new ConflictException(
          `时间线版本已变化（当前 v${current}，提案基于 v${dto.baseVersion}），且本次提案涉及的片段已被改动：` +
            `${[...(targets ?? [])].filter((k) => changed.has(k)).join('、') || '全片/轨道'}。请让 Agent 重新生成后再应用`,
        );
      }
      concurrentRevisions = await this.revisionsBetween(projectId, dto.baseVersion, current);
      this.logger.log(
        `Agent 提案基于旧版本 v${dto.baseVersion}，但与 v${current} 的改动不相交，按最新版本应用`,
      );
    }

    // ops 来自模型输出：逐条校验，任何一条失败整批拒绝
    const result = applyTimelineOps(doc, dto.ops as unknown as TimelineOp[]);
    if (result.errors.length > 0) {
      throw new BadRequestException(
        result.errors.map((e) => `#${e.opIndex + 1} ${e.message}`).join('；'),
      );
    }

    const changedKeys = [...new Set(result.diffs.map((d) => d.target).filter(Boolean))];
    const saved = await this.saveDocument(
      projectId,
      {
        fps: doc.fps,
        width: doc.width,
        height: doc.height,
        clips: result.doc.clips.map((c) => ({
          ...c,
          clientKey: clipKey(c),
        })) as unknown as SaveTimelineClipDto[],
        tracks: (result.doc.tracks ?? []) as unknown as SaveTimelineDto['tracks'],
        expectedVersion: current,
      },
      { author: 'agent', summary: dto.summary ?? null, changedClientKeys: changedKeys },
    );

    const audit = await this.db
      .insert(agentEditOps)
      .values({
        projectId,
        sessionId: dto.sessionId ?? null,
        messageId: dto.messageId ?? null,
        baseVersion: dto.baseVersion,
        resultVersion: saved.version ?? current + 1,
        summary: dto.summary ?? null,
        ops: dto.ops,
        diffs: result.diffs,
        status: 'applied',
        idempotencyKey: dto.idempotencyKey ?? null,
      })
      .returning({ id: agentEditOps.id });

    return {
      doc: saved,
      diffs: result.diffs,
      auditId: audit[0]?.id ?? '',
      idempotent: false,
      concurrentRevisions,
    };
  }

  /** 某两个版本之间实际发生过的修订号（用于告知调用方“期间有哪些改动”） */
  private async revisionsBetween(projectId: string, from: number, to: number): Promise<number[]> {
    if (to <= from) return [];
    const rows = await this.db
      .select({ revision: timelineRevisions.revision })
      .from(timelineRevisions)
      .where(eq(timelineRevisions.projectId, projectId))
      .orderBy(asc(timelineRevisions.revision));
    return rows.map((r) => r.revision).filter((r) => r > from && r <= to);
  }

  /** baseVersion 之后改动过的片段键集合；`*` 表示全片级改动（roughcut / 轨道）。 */
  private async changedKeysBetween(
    projectId: string,
    from: number,
    to: number,
  ): Promise<Set<string>> {
    const rows = await this.db
      .select({
        revision: timelineRevisions.revision,
        keys: timelineRevisions.changedClientKeys,
      })
      .from(timelineRevisions)
      .where(eq(timelineRevisions.projectId, projectId))
      .orderBy(asc(timelineRevisions.revision));
    const set = new Set<string>();
    for (const r of rows) {
      if (r.revision <= from || r.revision > to) continue;
      for (const k of (r.keys as string[] | null) ?? []) set.add(k);
    }
    return set;
  }

  /** 修订历史（不含快照，避免大对象进列表） */
  async listRevisions(projectId: string, limit = 30) {
    await this.requireProject(projectId);
    return this.db
      .select({
        revision: timelineRevisions.revision,
        parentRevision: timelineRevisions.parentRevision,
        author: timelineRevisions.author,
        summary: timelineRevisions.summary,
        changedClientKeys: timelineRevisions.changedClientKeys,
        createdAt: timelineRevisions.createdAt,
      })
      .from(timelineRevisions)
      .where(eq(timelineRevisions.projectId, projectId))
      .orderBy(desc(timelineRevisions.revision))
      .limit(Math.min(100, Math.max(1, limit)));
  }

  /** 回滚到某条修订：以快照追加一个新修订，历史不改写。 */
  async restoreRevision(projectId: string, revision: number): Promise<{
    doc: TimelineDocument;
    restoredFrom: number;
    newRevision: number;
  }> {
    await this.requireProject(projectId);
    const rows = await this.db
      .select({ snapshot: timelineRevisions.snapshot, revision: timelineRevisions.revision })
      .from(timelineRevisions)
      .where(
        and(eq(timelineRevisions.projectId, projectId), eq(timelineRevisions.revision, revision)),
      )
      .limit(1);
    if (!rows[0]) throw new NotFoundException(`修订 v${revision} 不存在`);
    const snapshot = rows[0].snapshot as {
      fps?: number;
      width?: number;
      height?: number;
      tracks?: SaveTimelineDto['tracks'];
      clips?: SaveTimelineClipDto[];
    };
    const current = await this.getDocument(projectId);
    const saved = await this.saveDocument(
      projectId,
      {
        fps: snapshot.fps ?? current.fps,
        width: snapshot.width ?? current.width,
        height: snapshot.height ?? current.height,
        clips: snapshot.clips ?? [],
        tracks: snapshot.tracks ?? [],
        expectedVersion: current.version ?? 0,
      },
      { author: 'restore', summary: `回滚到 v${revision}` },
    );
    return {
      doc: saved,
      restoredFrom: revision,
      newRevision: saved.version ?? 0,
    };
  }

  /** 时间线体检：Agent 改片前先读，改片后再读。 */
  async issues(projectId: string) {
    await this.requireProject(projectId);
    const doc = await this.getDocument(projectId);
    return { version: doc.version ?? 0, issues: scanTimelineIssues(doc) };
  }

  /** Agent 读上下文：时间线 + 转写 + 体检 + 工具契约（只读，一次给全）。 */
  async agentContext(projectId: string, transcript: string) {
    await this.requireProject(projectId);
    const doc = await this.getDocument(projectId);
    return {
      version: doc.version ?? 0,
      fps: doc.fps,
      width: doc.width,
      height: doc.height,
      durationSec: (() => {
        const ends = doc.clips
          .filter((c) => c.enabled !== false)
          .map((c) => c.timelineStart + clipSpan(c));
        return ends.length ? Math.max(...ends) : 0;
      })(),
      issues: scanTimelineIssues(doc),
      transcript,
    };
  }

  /** 最近 N 次 Agent 剪辑（审计回放用；只读，不返回整份快照） */
  async listAgentOps(projectId: string, limit = 20) {
    await this.requireProject(projectId);
    return this.db
      .select({
        id: agentEditOps.id,
        summary: agentEditOps.summary,
        status: agentEditOps.status,
        baseVersion: agentEditOps.baseVersion,
        resultVersion: agentEditOps.resultVersion,
        createdAt: agentEditOps.createdAt,
        diffs: agentEditOps.diffs,
      })
      .from(agentEditOps)
      .where(eq(agentEditOps.projectId, projectId))
      .orderBy(desc(agentEditOps.createdAt))
      .limit(Math.min(50, Math.max(1, limit)));
  }

  /**
   * 轨道静音 / 独奏过滤：solo 优先（只保留 solo 轨），其次剔除 muted 轨。
   * tracks 为空（未设置过轨道属性）时原样返回，保证旧项目导出行为不变。
   */
  private audibleClips(
    clips: TimelineClip[],
    tracks?: TimelineTrackMeta[],
  ): TimelineClip[] {
    // 先剔除「停用片段」：停用只影响成片，不影响时间线上继续保留与恢复
    const enabled = clips.filter((c) => c.enabled !== false);
    if (!tracks || tracks.length === 0) return enabled;
    const meta = new Map(tracks.map((t) => [`${t.track}:${t.lane ?? 0}`, t]));
    const hasSolo = tracks.some((t) => t.solo);
    if (hasSolo) {
      return enabled.filter((c) => meta.get(`${c.track}:${c.lane ?? 0}`)?.solo === true);
    }
    return enabled.filter((c) => meta.get(`${c.track}:${c.lane ?? 0}`)?.muted !== true);
  }

  /** 字幕轨 → SRT（时间线坐标，供软字幕封装） */
  private buildSrt(clips: TimelineClip[]): string {
    const fmt = (sec: number) => {
      const ms = Math.round(Math.max(0, sec) * 1000);
      const p = (v: number, n: number) => String(v).padStart(n, '0');
      return `${p(Math.floor(ms / 3600000), 2)}:${p(Math.floor((ms % 3600000) / 60000), 2)}:${p(
        Math.floor((ms % 60000) / 1000),
        2,
      )},${p(ms % 1000, 3)}`;
    };
    const subs = clips
      .filter((c) => c.track === 'subtitle' && c.text && c.text.trim())
      .sort((a, b) => a.timelineStart - b.timelineStart);
    return subs
      .map((c, i) => {
        const end = c.timelineStart + clipSpan(c);
        return `${i + 1}\n${fmt(c.timelineStart)} --> ${fmt(end)}\n${c.text?.trim()}\n`;
      })
      .join('\n');
  }

  /**
   * 字幕轨 → ASS（样式内嵌）。
   * 烧录不再用 subtitles 滤镜的 force_style：那需要多层转义逗号，spawn 传参时
   * 极易解析失败；ASS 自带 Style，滤镜只需 `ass=file.ass`。
   *
   * 每个字幕片段可以有自己的字体 / 字号 / 颜色 / 描边 / 位置（TimelineTextStyle），
   * 所以按「样式指纹」生成多条 Style 复用，事件只引用名字。位置用 \an5 + \pos
   * 精确落在用户选的那一点上（Alignment 只有 9 个档，满足不了自由摆放）。
   */
  private buildAss(clips: TimelineClip[], width: number, height: number): string {
    const fmt = (sec: number) => {
      const cs = Math.round(Math.max(0, sec) * 100);
      const p = (v: number, n: number) => String(v).padStart(n, '0');
      return `${Math.floor(cs / 360000)}:${p(Math.floor((cs % 360000) / 6000), 2)}:${p(
        Math.floor((cs % 6000) / 100),
        2,
      )}.${p(cs % 100, 2)}`;
    };
    const subs = clips
      .filter((c) => c.track === 'subtitle' && c.text && c.text.trim())
      .sort((a, b) => a.timelineStart - b.timelineStart);

    const styles: string[] = [];
    const styleIndex = new Map<string, string>();

    const styleFor = (clip: TimelineClip): string => {
      const st = resolveTextStyle(clip.textStyle);
      const font = this.assFont(st.fontFamily);
      const fontSize = Math.max(
        12,
        Math.round((height * Math.min(40, Math.max(1, st.fontSize))) / 100),
      );
      const outline = Math.max(0, Math.min(12, Math.round(st.strokeWidth * fontSize)));
      const boxed = Boolean(st.bgColor && st.bgOpacity > 0);
      const key = [
        font,
        fontSize,
        st.color,
        st.bold ? 1 : 0,
        st.italic ? 1 : 0,
        st.strokeColor,
        outline,
        boxed ? st.bgColor : '',
        boxed ? st.bgOpacity : 0,
        st.align,
      ].join('|');
      const hit = styleIndex.get(key);
      if (hit) return hit;
      const name = `S${styleIndex.size}`;
      // BorderStyle 4 = 背景框（opaque box），1 = 描边+阴影
      const borderStyle = boxed ? 4 : 1;
      const backAlpha = boxed
        ? Math.round((1 - Math.min(1, Math.max(0, st.bgOpacity))) * 255)
        : 0;
      const backColour = boxed
        ? this.assColor(st.bgColor, backAlpha)
        : '&H00000000';
      const alignNum = st.align === 'left' ? 1 : st.align === 'right' ? 3 : 2;
      styles.push(
        `Style: ${name},${font},${fontSize},${this.assColor(st.color)},` +
          `${this.assColor(st.strokeColor)},${backColour},` +
          `${st.bold ? -1 : 0},${st.italic ? -1 : 0},${borderStyle},${outline},0,` +
          `${alignNum},24,24,${Math.max(12, Math.round(height * 0.04))},1`,
      );
      styleIndex.set(key, name);
      return name;
    };

    const events = subs.map((c) => {
      const st = resolveTextStyle(c.textStyle);
      const end = c.timelineStart + clipSpan(c);
      const text = (c.text ?? '')
        .trim()
        .replace(/\r?\n/g, '\\N')
        .replace(/[{}]/g, '');
      const px = Math.round(Math.min(1, Math.max(0, st.x)) * width);
      const py = Math.round(Math.min(1, Math.max(0, st.y)) * height);
      const tag = `{\\an5\\pos(${px},${py})}`;
      return `Dialogue: 0,${fmt(c.timelineStart)},${fmt(end)},${styleFor(c)},,0,0,0,,${tag}${text}`;
    });

    return [
      '[Script Info]',
      'ScriptType: v4.00+',
      `PlayResX: ${width}`,
      `PlayResY: ${height}`,
      'WrapStyle: 0',
      '',
      '[V4+ Styles]',
      'Format: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, BackColour, Bold, Italic, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
      ...styles,
      '',
      '[Events]',
      'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
      ...events,
      '',
    ].join('\n');
  }

  /** #RRGGBB → ASS 的 &HAABBGGRR（注意 ASS 是 BGR 顺序，alpha 0=不透明） */
  private assColor(hex: string | undefined, alpha = 0): string {
    const m = /^#?([0-9a-f]{6})$/i.exec((hex ?? '').trim());
    if (!m) return '&H00FFFFFF';
    const r = m[1].slice(0, 2);
    const g = m[1].slice(2, 4);
    const b = m[1].slice(4, 6);
    const a = Math.max(0, Math.min(255, Math.round(alpha)))
      .toString(16)
      .padStart(2, '0');
    return `&H${a}${b}${g}${r}`.toUpperCase();
  }

  /** 前端字体键 → 各平台实际字体族（libass 按名字找，找不到会静默回退） */
  private assFont(key: string): string {
    const mac = process.platform === 'darwin';
    const win = process.platform === 'win32';
    switch (key) {
      case 'pingfang':
        return mac ? 'PingFang SC' : win ? 'Microsoft YaHei' : 'Noto Sans CJK SC';
      case 'songti':
        return mac ? 'Songti SC' : win ? 'SimSun' : 'Noto Serif CJK SC';
      case 'kaiti':
        return mac ? 'Kaiti SC' : win ? 'KaiTi' : 'Noto Serif CJK SC';
      case 'mono':
        return mac ? 'Menlo' : win ? 'Consolas' : 'DejaVu Sans Mono';
      default:
        return mac ? 'Arial Unicode MS' : win ? 'Microsoft YaHei' : 'Noto Sans CJK SC';
    }
  }

  /** 烧录用字体目录：libass 在 macOS 上读不到系统保留字体，指定可读目录兜底 */
  private fontDir(): string | null {
    const candidates =
      process.platform === 'darwin'
        ? ['/System/Library/Fonts/Supplemental', '/Library/Fonts']
        : process.platform === 'win32'
          ? ['C:/Windows/Fonts']
          : ['/usr/share/fonts', '/usr/local/share/fonts'];
    return candidates.find((d) => existsSync(d)) ?? null;
  }

  /**
   * 挑一个带 libass 的 ffmpeg 做字幕烧录。
   * 主 ffmpeg（Homebrew 9.x）可能未编译 subtitles/ass 滤镜，直接用它烧录会静默
   * 退回软字幕；这里按候选顺序探测滤镜表并缓存结果（null = 都不支持）。
   */
  private burnBinPromise: Promise<string | null> | null = null;

  private resolveBurnFfmpeg(): Promise<string | null> {
    if (!this.burnBinPromise) {
      this.burnBinPromise = (async () => {
        const home = process.env.HOME ?? '';
        const candidates = [
          this.exportService.resolveFfmpegBin(),
          home ? `${home}/.local/bin/ffmpeg` : '',
          '/opt/homebrew/bin/ffmpeg',
          '/usr/local/bin/ffmpeg',
          'ffmpeg',
        ].filter(Boolean);
        for (const bin of [...new Set(candidates)]) {
          if (bin.includes('/') && !existsSync(bin)) continue;
          // eslint-disable-next-line no-await-in-loop
          if (await this.hasSubtitlesFilter(bin)) return bin;
        }
        this.logger.warn('未找到带 libass 的 ffmpeg，字幕将改为软封装');
        return null;
      })();
    }
    return this.burnBinPromise;
  }

  private hasSubtitlesFilter(bin: string): Promise<boolean> {
    return new Promise((resolve) => {
      const child = spawn(bin, ['-hide_banner', '-filters'], { stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      child.stdout.on('data', (d: Buffer) => {
        out += d.toString();
      });
      child.stderr.on('data', (d: Buffer) => {
        out += d.toString();
      });
      child.on('error', () => resolve(false));
      child.on('close', (code) => {
        resolve(code === 0 && /\b(subtitles|ass)\b\s+[VA-]/i.test(out));
      });
    });
  }

  /**
   * Phase 4：按 EDL 渲染成片。
   * 视频轨：按 timelineStart 排序 → 各自 trim/缩放/fps 统一 → concat；
   * 音频轨：trim + 音量 + adelay(timelineStart) 后 amix，时长以视频为准；
   * 字幕轨：默认软封装 mov_text；burnSubtitles=true 时烧录（失败回退软字幕）。
   * overlay 轨本期不渲染（EDL 保留决策）。
   */
  async exportTimeline(
    projectId: string,
    dto: ExportTimelineDto,
  ): Promise<ExportTimelineResult> {
    const project = await this.requireProject(projectId);
    const doc = await this.getDocument(projectId);
    const fps = doc.fps > 0 ? doc.fps : 24;
    const width = dto.width ?? doc.width ?? 1080;
    const height = dto.height ?? doc.height ?? 1920;
    // 尊重轨道静音 / 独奏：导出只渲染「听得到」的轨
    const audible = this.audibleClips(doc.clips, doc.tracks);
    // 画面轨语义（缺省 sequence = 历史行为，保证老项目导出不变）
    const metaOf = (c: TimelineClip) =>
      (doc.tracks ?? []).find((t) => t.track === c.track && (t.lane ?? 0) === (c.lane ?? 0));
    const allVideo = audible
      .filter((c) => c.track === 'video' && c.sourceUrl)
      .sort((a, b) => a.timelineStart - b.timelineStart);
    /** 主链：lane 0 或显式 role=main，且未被 track 关闭导出 */
    const isMainLane = (c: TimelineClip) => {
      const meta = metaOf(c);
      if (meta?.exportEnabled === false) return false;
      return meta?.role === 'main' || (c.lane ?? 0) === 0;
    };
    // overlay 模式：主链铺底，其余轨（非 alt、未关闭导出）按各自时间点叠加为画中画
    const overlayClips =
      dto.videoLaneMode === 'overlay'
        ? expandCompounds(
            allVideo.filter((c) => {
              if (isMainLane(c)) return false;
              const meta = metaOf(c);
              return meta?.exportEnabled !== false && meta?.role !== 'alt';
            }),
          )
        : [];
    const pickedVideoClips =
      dto.videoLaneMode === 'main' || dto.videoLaneMode === 'overlay'
        ? allVideo.filter(isMainLane)
        : allVideo;
    // 真复合片段在导出前展开成子片段：时间线只有一个整体，渲染仍是原素材
    const videoClips = expandCompounds(pickedVideoClips).sort(
      (a, b) => a.timelineStart - b.timelineStart,
    );
    if (videoClips.length === 0) {
      throw new BadRequestException('主画面轨没有可导出的视频片段：请先生成镜头视频或把片段拖回主轨');
    }
    const audioClips = audible
      .filter((c) => c.track === 'audio' && c.sourceUrl)
      .sort((a, b) => a.timelineStart - b.timelineStart);
    const srt = this.buildSrt(audible);
    // 选区导出时软字幕时间戳仍是全片时间轴，必须强制烧录后再裁，否则字幕整体错位
    const wantRange = dto.startSec != null || dto.endSec != null;
    const burn = (dto.burnSubtitles !== false || wantRange) && Boolean(srt.trim());

    const ffmpeg = this.exportService.resolveFfmpegBin();
    const burnBin = burn ? await this.resolveBurnFfmpeg() : null;
    const work = join(tmpdir(), `yimu-timeline-${randomUUID()}`);
    await mkdir(work, { recursive: true });
    const cacheDir = join(uploadDir(), projectId, 'clips');
    const cleanup: string[] = [];

    const run = async (args: string[], bin = ffmpeg) =>
      this.exportService.runFfmpeg(bin, args, work);
    try {
      // 1) 视频片段：统一分辨率/帧率/像素格式（concat 前的必要条件）
      //
      // 叠化必须在渲染前就定好每段要渲染多长：叠化出场的段要多渲染 d 秒尾巴
      // （源文件出点之后的 handle，不够时 tpad 克隆末帧），否则 xfade 没有素材可混。
      // 规则与「叠化不缩短成片总时长」的约束都在 transition-plan 里，单测覆盖。
      const plan = planTransitions(
        videoClips.map((c) => ({
          span: Math.max(0.05, c.outPoint - c.inPoint) / (c.speed > 0 ? c.speed : 1),
          transition: c.transition ?? null,
        })),
      );
      const segments: string[] = [];
      for (let i = 0; i < videoClips.length; i += 1) {
        const clip = videoClips[i];
        const url = clip.sourceUrl as string;
        // 静帧（拖进来的首帧/图片）按 span 循环成一段视频，和真视频走同一条 concat 链
        const still = MEDIA_IMAGE_EXT.test(url);
        const src = join(work, `v_src_${String(i).padStart(3, '0')}${mediaExt(url)}`);
        cleanup.push(src);
        // eslint-disable-next-line no-await-in-loop
        const ok = await this.exportService.materializeMediaToFile(url, src, cacheDir);
        if (!ok) throw new BadRequestException(`片段 ${i + 1} 源媒体下载失败`);
        const speed = clip.speed > 0 ? clip.speed : 1;
        const visibleSpan = Math.max(0.05, clip.outPoint - clip.inPoint) / speed;
        const outSpan = plan.renderSpan[i];
        /** 叠化尾巴（可能为 0）：渲染时长减去该段实际占用的时间线时长 */
        const tail = round3(outSpan - visibleSpan);
        const fadeD =
          clip.transition?.type === 'fade'
            ? Math.min(0.5, Math.max(0.1, clip.transition.duration || 0.4))
            : 0;
        const fadeFilters =
          fadeD > 0
            ? [
                `fade=t=in:st=0:d=${fadeD}`,
                `fade=t=out:st=${Math.max(0, outSpan - fadeD).toFixed(3)}:d=${fadeD}`,
              ]
            : [];
        const seg = join(work, `v_seg_${String(i).padStart(3, '0')}.mp4`);
        cleanup.push(seg);
        const kf = buildZoompanExpressions(clip.keyframes, fps, visibleSpan);
        const vf = [
          ...(clip.reverse ? ['reverse'] : []),
          `scale=${width}:${height}:force_original_aspect_ratio=decrease`,
          `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black`,
          'setsar=1',
          `fps=${fps}`,
          ...(Math.abs(speed - 1) > 1e-3 ? [`setpts=PTS/${speed}`] : []),
          // 运镜关键帧：zoompan 用输出帧 on 做线性插值，和浏览器预览读同一份数据
          ...(kf.hasKeyframes
            ? [
                `zoompan=z='${kf.z}':x='${kf.x}':y='${kf.y}':d=1:s=${width}x${height}:fps=${fps}`,
                `rotate=a='${kf.rotate}':c=black`,
              ]
            : []),
          ...fadeFilters,
          // 叠化尾巴：源素材够长时是真实画面（handle），不够长时克隆末帧补足，
          // 保证 xfade 的 offset+duration 一定落在这一段之内，否则 ffmpeg 直接报错
          ...(tail > 0 ? [`tpad=stop_mode=clone:stop_duration=${tail.toFixed(3)}`] : []),
        ].join(',');
        // eslint-disable-next-line no-await-in-loop
        const segOk = await run([
          '-y',
          // 静帧没有时间轴概念：用 -loop 1 铺满 span；对图片用 -ss 会直接报错
          ...(still
            ? ['-loop', '1', '-i', src]
            : ['-ss', String(Math.max(0, clip.inPoint)), '-i', src]),
          '-t', String(outSpan),
          '-vf', vf,
          '-an',
          '-c:v', 'libx264',
          '-pix_fmt', 'yuv420p',
          '-preset', 'veryfast',
          '-crf', '20',
          seg,
        ]);
        if (!segOk) throw new BadRequestException(`片段 ${i + 1} 渲染失败（源媒体可能损坏）`);
        segments.push(seg);
      }
      const totalDur = plan.total;
      const rangeStart = Math.max(0, Math.min(totalDur, dto.startSec ?? 0));
      const rangeEnd = Math.max(0, Math.min(totalDur, dto.endSec ?? totalDur));
      if (wantRange && rangeEnd - rangeStart <= 0.05) {
        throw new BadRequestException('选区导出失败：入点必须早于出点，且区间至少 0.05s');
      }
      const finalDuration = wantRange ? rangeEnd - rangeStart : totalDur;

      const concatPath = join(work, 'concat.mp4');
      cleanup.push(concatPath);
      /** 最终画面源：默认就是主链拼接结果；overlay 模式会再合成一层画中画 */
      let finalVideoPath = concatPath;
      let overlayCount = 0;
      if (plan.hasCrossfade) {
        // 有叠化：不能走 concat 协议的 `-c copy`（它只会首尾相接，做不出同时可见）。
        // 改成一条 filter 链，硬切用 concat 滤镜、叠化用 xfade，串在同一张图里，
        // 这样时间戳连续、混切也不会错位。代价是全片重编码一次（与烧字幕同量级）。
        const filter = buildTransitionFilter(plan, fps);
        const inputs = segments.flatMap((p) => ['-i', p]);
        const xfadeOk = await run([
          '-y',
          ...inputs,
          '-filter_complex', filter,
          '-map', '[vout]',
          '-an',
          '-c:v', 'libx264',
          '-pix_fmt', 'yuv420p',
          '-preset', 'veryfast',
          '-crf', '20',
          '-t', String(totalDur),
          concatPath,
        ]);
        if (!xfadeOk) throw new BadRequestException('叠化渲染失败（转场计算与素材不匹配）');
      } else {
        const listPath = join(work, 'list.txt');
        cleanup.push(listPath);
        await writeFile(
          listPath,
          segments.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n'),
          'utf8',
        );
        const concatOk = await run([
          '-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', concatPath,
        ]);
        if (!concatOk) throw new BadRequestException('片段拼接失败（编码不一致）');
      }

      // 1.5) 多画面轨真正叠加（画中画）：主链铺底，其余轨按 timelineStart 叠上去。
      // 之前的实现把 V2/V3 当串行片段拼进去，等于「备选镜头接在后面」；这里改成同帧叠加。
      if (overlayClips.length > 0) {
        /** 片段与渲染结果成对保存：中间某个下载失败时，时间点不会错位 */
        const ovRendered: { seg: string; clip: TimelineClip }[] = [];
        for (let i = 0; i < overlayClips.length; i += 1) {
          const clip = overlayClips[i];
          const url = clip.sourceUrl as string;
          const still = MEDIA_IMAGE_EXT.test(url);
          const src = join(work, `ov_src_${String(i).padStart(3, '0')}${mediaExt(url)}`);
          cleanup.push(src);
          // eslint-disable-next-line no-await-in-loop
          const ok = await this.exportService.materializeMediaToFile(url, src, cacheDir);
          if (!ok) {
            this.logger.warn(`画中画片段 ${i + 1} 下载失败，跳过`);
            continue;
          }
          const speed = clip.speed > 0 ? clip.speed : 1;
          const span = Math.max(0.05, (clip.outPoint - clip.inPoint) / speed);
          // 画中画默认占画面 42%，等比缩放居中偏右下；轨道 role=overlay 也可走同一条路径
          const boxW = Math.max(2, Math.round(width * 0.42 / 2) * 2);
          const boxH = Math.max(2, Math.round(height * 0.42 / 2) * 2);
          const seg = join(work, `ov_seg_${String(i).padStart(3, '0')}.mp4`);
          cleanup.push(seg);
          // eslint-disable-next-line no-await-in-loop
          const segOk = await run([
            '-y',
            ...(still ? ['-loop', '1', '-i', src] : ['-ss', String(Math.max(0, clip.inPoint)), '-i', src]),
            '-t', String(span),
            '-vf', [
              `scale=${boxW}:${boxH}:force_original_aspect_ratio=decrease`,
              'setsar=1',
              `fps=${fps}`,
            ].join(','),
            '-an',
            '-c:v', 'libx264',
            '-pix_fmt', 'yuv420p',
            '-preset', 'veryfast',
            '-crf', '20',
            seg,
          ]);
          if (!segOk) {
            this.logger.warn(`画中画片段 ${i + 1} 渲染失败，跳过`);
            continue;
          }
          ovRendered.push({ seg, clip });
        }

        if (ovRendered.length > 0) {
          const compositePath = join(work, 'composite.mp4');
          cleanup.push(compositePath);
          const inputs = [concatPath, ...ovRendered.map((o) => o.seg)].flatMap((p) => ['-i', p]);
          const chains: string[] = ['[0:v]setpts=PTS-STARTPTS[b0]'];
          for (let i = 0; i < ovRendered.length; i += 1) {
            const clip = ovRendered[i].clip;
            const start = Math.max(0, clip.timelineStart);
            const span = Math.max(0.05, (clip.outPoint - clip.inPoint) / (clip.speed > 0 ? clip.speed : 1));
            const end = start + span;
            chains.push(
              `[${i + 1}:v]setpts=PTS-STARTPTS+${start.toFixed(3)}/TB[o${i}]`,
            );
            chains.push(
              `[b${i}][o${i}]overlay=x=W-w-32:y=H-h-32:eof_action=pass:enable='between(t,${start.toFixed(
                3,
              )},${end.toFixed(3)})'[b${i + 1}]`,
            );
          }
          const filter = chains.join(';');
          const ok = await run([
            '-y',
            ...inputs,
            '-filter_complex', filter,
            '-map', `[b${ovRendered.length}]`,
            '-an',
            '-c:v', 'libx264',
            '-pix_fmt', 'yuv420p',
            '-preset', 'veryfast',
            '-crf', '20',
            '-t', String(totalDur),
            compositePath,
          ]);
          if (!ok) throw new BadRequestException('画中画合成失败（请检查片段编码）');
          finalVideoPath = compositePath;
          overlayCount = ovRendered.length;
          this.logger.log(
            `画中画合成：主链 ${segments.length} 段 + 叠加 ${overlayCount} 段`,
          );
        }
      }

      // 2) 音频轨：trim + 音量 + 延迟到 timelineStart，多轨 amix
      let audioPath: string | null = null;
      if (audioClips.length > 0) {
        const parts: string[] = [];
        for (let i = 0; i < audioClips.length; i += 1) {
          const a = audioClips[i];
          const src = join(work, `a_src_${String(i).padStart(3, '0')}.m4a`);
          cleanup.push(src);
          // eslint-disable-next-line no-await-in-loop
          const ok = await this.exportService.materializeMediaToFile(a.sourceUrl as string, src, cacheDir);
          if (!ok) {
            this.logger.warn(`音频片段 ${i + 1} 下载失败，跳过`);
            continue;
          }
          const span = Math.max(0.05, a.outPoint - a.inPoint);
          const delayMs = Math.max(0, Math.round(a.timelineStart * 1000));
          const part = join(work, `a_seg_${String(i).padStart(3, '0')}.wav`);
          cleanup.push(part);
          // eslint-disable-next-line no-await-in-loop
          const pOk = await run([
            '-y',
            '-ss', String(Math.max(0, a.inPoint)),
            '-i', src,
            '-t', String(span),
            '-vn',
            '-af', `${a.reverse ? 'areverse,' : ''}volume=${Math.min(1, Math.max(0, a.volume))},adelay=${delayMs}|${delayMs}`,
            '-ac', '2', '-ar', '44100', '-c:a', 'pcm_s16le',
            part,
          ]);
          if (pOk) parts.push(part);
        }
        if (parts.length > 0) {
          const mixed = join(work, 'audio_mix.m4a');
          cleanup.push(mixed);
          const inputs = parts.flatMap((p) => ['-i', p]);
          const mixArgs =
            parts.length === 1
              ? ['-y', '-i', parts[0], '-c:a', 'aac', '-b:a', '160k', mixed]
              : [
                  '-y', ...inputs,
                  '-filter_complex', `amix=inputs=${parts.length}:duration=longest:normalize=0`,
                  '-c:a', 'aac', '-b:a', '160k', mixed,
                ];
          const mixOk = await run(mixArgs);
          if (mixOk) audioPath = mixed;
        }
      }

      // 3) 字幕 + 最终封装
      const outName = `final_tl_${randomUUID().slice(0, 8)}.mp4`;
      const outDir = join(uploadDir(), projectId);
      await mkdir(outDir, { recursive: true });
      const outAbs = join(outDir, outName);
      const aigcMeta = ['-metadata', 'comment=AIGC-Generated-By-YIMU-AI-Workshop'];
      let done = false;
      if (burn && burnBin) {
        const assPath = join(work, 'subs.ass');
        cleanup.push(assPath);
        await writeFile(assPath, this.buildAss(audible, width, height), 'utf8');
        const fdir = this.fontDir();
        const vf = `ass=filename=subs.ass${fdir ? `:fontsdir=${fdir}` : ''}`;
        const audioIn = audioPath ? ['-i', audioPath] : [];
        const burnOk = await run(
          [
            '-y', '-i', finalVideoPath, ...audioIn,
            '-vf', vf,
            '-map', '0:v:0',
            ...(audioPath ? ['-map', '1:a:0'] : []),
            '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast', '-crf', '20',
            ...(audioPath ? ['-c:a', 'aac', '-b:a', '160k'] : ['-an']),
            '-t', String(totalDur),
            ...aigcMeta, outAbs,
          ],
          burnBin,
        );
        done = burnOk;
        if (!burnOk) this.logger.warn('字幕烧录失败，回退软字幕封装');
      }
      if (!done) {
        const audioIn = audioPath ? ['-i', audioPath] : [];
        const softOk = srt.trim()
          ? await (async () => {
              const srtPath = join(work, 'soft.srt');
              cleanup.push(srtPath);
              await writeFile(srtPath, srt, 'utf8');
              return run([
                '-y', '-i', finalVideoPath, ...audioIn, '-i', srtPath,
                '-map', '0:v:0',
                ...(audioPath ? ['-map', '1:a:0'] : []),
                '-map', audioPath ? '2:s:0' : '1:s:0',
                '-c:v', 'copy',
                ...(audioPath ? ['-c:a', 'copy'] : ['-an']),
                '-c:s', 'mov_text',
                '-t', String(totalDur),
                ...aigcMeta, outAbs,
              ]);
            })()
          : await run([
              '-y', '-i', finalVideoPath, ...audioIn,
              '-map', '0:v:0',
              ...(audioPath ? ['-map', '1:a:0'] : []),
              '-c:v', 'copy',
              ...(audioPath ? ['-c:a', 'copy'] : ['-an']),
              '-t', String(totalDur),
              ...aigcMeta, outAbs,
            ]);
        done = softOk;
      }
      if (!done) throw new BadRequestException('ffmpeg 导出失败：请检查本机 ffmpeg');

      // 选区导出：整片先按全时间轴合成（字幕/混音/叠化都在绝对时间上完成），
      // 最后再按 I/O 裁一刀。这样音频与烧录字幕不会因为提前裁剪而错位。
      if (wantRange && (rangeStart > 0.01 || rangeEnd < totalDur - 0.01)) {
        const ranged = join(work, 'ranged.mp4');
        cleanup.push(ranged);
        const rangeOk = await run([
          '-y',
          '-ss', rangeStart.toFixed(3),
          '-i', outAbs,
          '-t', finalDuration.toFixed(3),
          '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast', '-crf', '20',
          '-c:a', 'aac', '-b:a', '160k',
          '-movflags', '+faststart',
          ...aigcMeta, ranged,
        ]);
        if (!rangeOk) throw new BadRequestException('选区裁剪失败：导出中间文件不可读');
        await rename(ranged, outAbs);
        cleanup.splice(cleanup.indexOf(ranged), 1);
      }

      const st = await stat(outAbs);
      const fileUrl = `/uploads/${projectId}/${outName}`;
      const rows = await this.db
        .insert(assets)
        .values({
          projectId,
          assetType: 'video',
          name: `精剪成片-${project.title}`.slice(0, 120),
          fileUrl,
          filePath: outAbs,
          mimeType: 'video/mp4',
          fileSize: st.size,
          durationSeconds: String(finalDuration),
          sourceType: 'generated',
          sourceId: `timeline-export-${randomUUID()}`,
          generationPrompt: `按 EDL 导出 ${segments.length + overlayCount} 段（${audioPath ? '含混音' : '纯画面'}${srt.trim() ? '+字幕' : ''}${overlayCount ? '+画中画' : ''}${wantRange ? '·选区' : ''}）`,
          metadata: {
            aigcGenerated: true,
            hasAudio: Boolean(audioPath),
            hasSubtitles: Boolean(srt.trim()),
            timelineExport: true,
          } as never,
          status: 'ready',
        })
        .returning();
      const asset = this.mapAsset(rows[0]);
      const totalClips = segments.length + overlayCount;
      this.logger.log(
        `EDL 导出完成 ${projectId}：${totalClips} 段（叠加 ${overlayCount}）→ ${fileUrl}（${st.size}B）`,
      );
      return { asset, clips: totalClips, durationSeconds: finalDuration };
    } finally {
      for (const f of cleanup) await unlink(f).catch(() => {});
    }
  }

  private mapAsset(row: typeof assets.$inferSelect): Asset {
    return {
      id: row.id,
      projectId: row.projectId,
      assetType: row.assetType as Asset['assetType'],
      name: row.name,
      fileUrl: row.fileUrl ?? undefined,
      filePath: row.filePath ?? undefined,
      mimeType: row.mimeType ?? undefined,
      fileSize: row.fileSize ?? undefined,
      durationSeconds: row.durationSeconds ? Number(row.durationSeconds) : undefined,
      sourceType: row.sourceType ?? 'generated',
      sourceId: row.sourceId ?? undefined,
      generationPrompt: row.generationPrompt ?? undefined,
      version: row.version ?? 1,
      status: row.status ?? 'ready',
      locked: row.locked ?? false,
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.updatedAt),
    } as Asset;
  }
}
