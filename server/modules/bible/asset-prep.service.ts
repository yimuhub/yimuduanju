import { Injectable, Inject, Logger } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { and, eq, inArray } from 'drizzle-orm';
import { characters, generationJobs, locations, props } from '@server/database/schema';
import {
  evaluateAssetReadiness,
  evaluateCharacterAsset,
  evaluateLocationAsset,
  evaluatePropAsset,
  type AssetReadinessItem,
  type AssetReadinessSummary,
} from '@shared/asset-readiness';
import type { CharacterIdentityKit } from '@shared/api.interface';
import { BibleService } from './bible.service';

/**
 * 资产前置服务（asset-first）
 *
 * 这是「为什么别人的剧前后连贯、我们的不行」这个问题的根因修复点。
 *
 * 三家对标项目的共同纪律：**人物 / 场景 / 道具必须先出定妆图，才允许拆分镜、出首帧**
 * （火宝 `assetReadyCount === assetTotalCount`、ArcReel `referenced_assets_without_sheet`
 * 阻塞分镜、Toonflow baseAssets → generateAssets → storyboardTable → storyboardImages 固定顺序）。
 *
 * 我们的旧流程：
 *   script → parse_script（一句台词一镜）→ 立刻出首帧 → 出视频
 * 全程没有 characters / locations 的图，`splitScenes` 的正则里也没有任何资产概念，
 * 于是每镜都是「凭文字重新想象一个人」，跨镜必然换脸、换场景。
 *
 * 本服务把顺序拉回正轨：
 *   1. 缺资产清单 → 调 BibleService.generateBible 生成（人物/场景/道具/世界观/风格）；
 *   2. 已有清单但缺图 → 排定妆图任务（人物主图+四视角 / 场景参考图 / 关键道具设定图）；
 *   3. 返回就绪度，由任务门控与 UI 门卡共同消费。
 *
 * 幂等性：同一定妆目标已有在途任务时不再重复排，避免用户点两次就生成两套图。
 */

/** 单项目一次性补齐的上限：防止一个 60 场的剧本一口气排出上百张定妆图 */
const MAX_CHARACTERS = 8;
const MAX_LOCATIONS = 8;
const MAX_PROPS = 6;

/** 在途任务状态：这些状态下的目标不再重复排任务 */
const ACTIVE_STATUSES = ['pending', 'queued', 'running', 'retrying'] as const;

export interface PrepareAssetsOptions {
  providerName?: string;
  /** 只算就绪度、不排任务（预检 / UI 展示用） */
  dryRun?: boolean;
  scriptText?: string;
  /** 强制重跑圣经生成（即使已有资产） */
  regenerateBible?: boolean;
}

export interface PrepareAssetsResult {
  readiness: AssetReadinessSummary;
  bibleGenerated: boolean;
  bibleSource?: 'llm' | 'fallback';
  note?: string;
  /** 本次新排的定妆图任务数 */
  enqueued: number;
  /** 本次因已有在途任务而跳过的数量 */
  skippedInflight: number;
}

/** 串行链单段排产结果（drivePipeline 据此决定等待/推进/降级） */
export interface StageEnqueueResult {
  /** 本次新排任务数；0 且仍有缺图且无在途 = 上一轮任务失败，需要重试判定 */
  enqueued: number;
  /** 该段在途任务数 */
  inflight: number;
  /** 该段仍缺参考图的资产数 */
  missing: number;
  /** 缺图资产名（日志与 UI 提示用） */
  missingNames: string[];
}

@Injectable()
export class AssetPrepService {
  private readonly logger = new Logger(AssetPrepService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    private readonly bibleService: BibleService,
  ) {}

  /**
   * 资产前置主入口：补齐清单 → 排定妆图 → 返回就绪度。
   * 幂等，可在 parse_script 前后、门卡刷新、任务对账里反复调用。
   */
  async prepareProjectAssets(
    projectId: string,
    opts: PrepareAssetsOptions = {},
  ): Promise<PrepareAssetsResult> {
    let bibleGenerated = false;
    let bibleSource: 'llm' | 'fallback' | undefined;
    let note: string | undefined;

    const before = await this.loadFacts(projectId);
    // 清单缺失（一个人物 / 一个场景都没有）时先补清单。
    // 这是「快速通道跳过 bible_ready」留下的坑：旧项目根本没进过圣经阶段。
    const needsBible =
      opts.regenerateBible === true ||
      before.characters.length === 0 ||
      before.locations.length === 0;

    if (needsBible) {
      try {
        const res = await this.bibleService.generateBible(projectId, {
          mode: 'fill',
          providerName: opts.providerName,
          scriptText: opts.scriptText,
        });
        bibleGenerated = true;
        bibleSource = res.source;
        note = res.note;
        this.logger.log(
          `资产清单已补齐 project=${projectId} source=${res.source} ` +
            `角色 ${res.counts.charactersCreated}+${res.counts.charactersUpdated} ` +
            `场景 ${res.counts.locationsCreated}+${res.counts.locationsUpdated} ` +
            `道具 ${res.counts.propsCreated}+${res.counts.propsUpdated}`,
        );
      } catch (e) {
        // 清单补不出来不能直接失败整条流水线：把原因带回去，
        // 由就绪度判定把项目卡在「资产未就绪」，用户看得到缺什么。
        note = `资产清单生成失败：${(e as Error).message.slice(0, 160)}`;
        this.logger.warn(`资产清单生成失败 project=${projectId}：${(e as Error).message}`);
      }
    }

    const facts = bibleGenerated ? await this.loadFacts(projectId) : before;
    const readiness = this.readinessOfFacts(facts);

    if (opts.dryRun) {
      return { readiness, bibleGenerated, bibleSource, note, enqueued: 0, skippedInflight: 0 };
    }

    const inflight = await this.inflightTargets(projectId);
    let enqueued = 0;
    let skippedInflight = 0;
    const bump = (key: string): boolean => {
      if (inflight.has(key)) {
        skippedInflight += 1;
        return false;
      }
      inflight.add(key);
      return true;
    };

    // 1) 人物定妆：主演走「主图 + 四视角」形象包，配角走单人形象图（控成本）
    for (const c of facts.characters.slice(0, MAX_CHARACTERS)) {
      const item = evaluateCharacterAsset(c);
      const isLead = (c.roleType ?? '').toLowerCase() === 'lead' || c.roleType === '主角' || c.roleType === '主演';
      // 主演：主图或任一视角缺失即补；配角：只要还没有任何一张图就补
      const needWork = isLead ? !item.complete : !item.ready;
      if (!needWork) continue;
      if (!bump(`character:${c.id}`)) continue;
      try {
        if (isLead) {
          // generateIdentityKit 内部只补缺槽，已生成过的视角不会重跑
          await this.bibleService.generateIdentityKit(projectId, c.id);
          enqueued += 1;
        } else {
          await this.bibleService.generateCharacterImage(projectId, c.id);
          enqueued += 1;
        }
      } catch (e) {
        skippedInflight += 0;
        this.logger.warn(`人物定妆任务创建失败 ${c.name}：${(e as Error).message}`);
      }
    }

    // 2) 场景定妆：每场至少一张空间参考图（构图/陈设/光位/色调的锚点）
    for (const l of facts.locations.slice(0, MAX_LOCATIONS)) {
      const item = evaluateLocationAsset(l);
      if (item.ready) continue;
      if (!bump(`location:${l.id}`)) continue;
      try {
        await this.bibleService.generateLocationImage(projectId, l.id);
        enqueued += 1;
      } catch (e) {
        this.logger.warn(`场景定妆任务创建失败 ${l.name}：${(e as Error).message}`);
      }
    }

    // 3) 关键道具：只有跨镜复现 / 带状态变体的道具才值得出设定图
    for (const p of facts.props.slice(0, MAX_PROPS)) {
      const item = evaluatePropAsset(p);
      if (item.ready) continue;
      const worthIt = (p.category ?? '') === 'recurring' || (p.category ?? '') === 'key';
      if (!worthIt) continue;
      if (!bump(`prop:${p.id}`)) continue;
      try {
        await this.bibleService.generatePropImage(projectId, p.id);
        enqueued += 1;
      } catch (e) {
        this.logger.warn(`道具定妆任务创建失败 ${p.name}：${(e as Error).message}`);
      }
    }

    if (enqueued > 0 || skippedInflight > 0) {
      this.logger.log(
        `资产定妆任务 project=${projectId} 新排 ${enqueued}，已在途跳过 ${skippedInflight}，${readiness.summary}`,
      );
    }
    return { readiness, bibleGenerated, bibleSource, note, enqueued, skippedInflight };
  }

  /** 只读就绪度（不排任何任务） */
  async readinessOf(projectId: string): Promise<AssetReadinessSummary> {
    return this.readinessOfFacts(await this.loadFacts(projectId));
  }

  // ========== 前置资产严格串行链（人物 → 场景 → 道具，每段完成才进下一段） ==========

  /**
   * 段 1 · 人物资产：为「分镜出场角色」补定妆照（只排人物，幂等）。
   * castIds 缺省时取全项目人物；已有图（主图/参考图任一）的跳过，避免重复生成。
   */
  async enqueueCastAssets(
    projectId: string,
    castIds?: string[],
  ): Promise<StageEnqueueResult> {
    const facts = await this.loadFacts(projectId);
    const wanted =
      castIds && castIds.length > 0
        ? facts.characters.filter((c) => castIds.includes(c.id))
        : facts.characters;
    const inflight = await this.inflightTargets(projectId);
    let enqueued = 0;
    const missing: string[] = [];
    for (const c of wanted.slice(0, MAX_CHARACTERS)) {
      const item = evaluateCharacterAsset(c);
      if (item.ready) continue;
      missing.push(c.name);
      if (inflight.has(`character:${c.id}`)) continue;
      const isLead =
        (c.roleType ?? '').toLowerCase() === 'lead' || c.roleType === '主角' || c.roleType === '主演';
      try {
        // 主演走「主图 + 四视角」形象包，配角走单人形象图（与 prepareProjectAssets 同口径）
        if (isLead) await this.bibleService.generateIdentityKit(projectId, c.id);
        else await this.bibleService.generateCharacterImage(projectId, c.id);
        inflight.add(`character:${c.id}`);
        enqueued += 1;
      } catch (e) {
        this.logger.warn(`[串行链·人物] 定妆任务创建失败 ${c.name}：${(e as Error).message}`);
      }
    }
    const stillInflight = [...inflight].filter((k) => k.startsWith('character:')).length;
    if (enqueued > 0) {
      this.logger.log(`[串行链·人物] project=${projectId} 新排 ${enqueued}，缺图 ${missing.length}（${missing.slice(0, 6).join('、')}）`);
    }
    return { enqueued, inflight: stillInflight, missing: missing.length, missingNames: missing };
  }

  /**
   * 段 2 · 场景资产：为「分镜出场场景」补场景图（只排场景，幂等）。
   * locationIds 缺省时取全项目场景。
   */
  async enqueueSceneAssets(
    projectId: string,
    locationIds?: string[],
  ): Promise<StageEnqueueResult> {
    const facts = await this.loadFacts(projectId);
    const wanted =
      locationIds && locationIds.length > 0
        ? facts.locations.filter((l) => locationIds.includes(l.id))
        : facts.locations;
    const inflight = await this.inflightTargets(projectId);
    let enqueued = 0;
    const missing: string[] = [];
    for (const l of wanted.slice(0, MAX_LOCATIONS)) {
      const item = evaluateLocationAsset(l);
      if (item.ready) continue;
      missing.push(l.name);
      if (inflight.has(`location:${l.id}`)) continue;
      try {
        await this.bibleService.generateLocationImage(projectId, l.id);
        inflight.add(`location:${l.id}`);
        enqueued += 1;
      } catch (e) {
        this.logger.warn(`[串行链·场景] 场景图任务创建失败 ${l.name}：${(e as Error).message}`);
      }
    }
    const stillInflight = [...inflight].filter((k) => k.startsWith('location:')).length;
    if (enqueued > 0) {
      this.logger.log(`[串行链·场景] project=${projectId} 新排 ${enqueued}，缺图 ${missing.length}（${missing.slice(0, 6).join('、')}）`);
    }
    return { enqueued, inflight: stillInflight, missing: missing.length, missingNames: missing };
  }

  /**
   * 段 3 · 道具资产：为分镜关键道具补设定图。
   * 轻量提取逻辑：分镜画面描述/台词/场次道具标签里出现过的道具名或 PROP 编号才算关键道具，
   * 纯陈设（set_dressing）与没入镜的道具不出图，避免浪费生成额度。
   */
  async enqueuePropAssets(
    projectId: string,
    shotTexts: string[],
    scenePropTags: string[],
  ): Promise<StageEnqueueResult> {
    const facts = await this.loadFacts(projectId);
    const inflight = await this.inflightTargets(projectId);
    // 分镜文本归一化后做包含匹配（与 job-worker 的 matchCastIds 同一套宽松口径）
    const norm = (v: string): string =>
      v.replace(/[\s·・、,，.。:：!！?？"“”'‘’（）()【】[\]<>《》\-—_/\\|]/g, '').toLowerCase();
    const hay = norm(shotTexts.join('\n'));
    const tagSet = new Set(scenePropTags);
    let enqueued = 0;
    const missing: string[] = [];
    for (const p of facts.props.slice(0, MAX_PROPS)) {
      const item = evaluatePropAsset(p);
      if (item.ready) continue;
      // 关键性判定：场次道具标签命中，或道具名/编号出现在分镜文本里
      const code = norm(p.code ?? '');
      const name = norm(p.name);
      const inText =
        (name.length >= 2 && hay.includes(name)) ||
        (code.length >= 2 && hay.includes(code)) ||
        [...tagSet].some((t) => {
          const nt = norm(t.replace(/^@/, ''));
          return nt === code || nt === name || (name.length >= 2 && nt.endsWith(name));
        });
      if (!inText) continue;
      missing.push(p.name);
      if (inflight.has(`prop:${p.id}`)) continue;
      try {
        await this.bibleService.generatePropImage(projectId, p.id);
        inflight.add(`prop:${p.id}`);
        enqueued += 1;
      } catch (e) {
        this.logger.warn(`[串行链·道具] 设定图任务创建失败 ${p.name}：${(e as Error).message}`);
      }
    }
    const stillInflight = [...inflight].filter((k) => k.startsWith('prop:')).length;
    if (enqueued > 0) {
      this.logger.log(`[串行链·道具] project=${projectId} 新排 ${enqueued}，缺图 ${missing.length}（${missing.slice(0, 6).join('、')}）`);
    }
    return { enqueued, inflight: stillInflight, missing: missing.length, missingNames: missing };
  }

  /**
   * 单镜放行判定：本镜引用的人物 / 场景是否都具备参考图。
   * 与 `shared/asset-readiness.ts` 的 `shotAssetGate` 同口径。
   */
  async missingAssetsForShot(
    projectId: string,
    refs: { characterIds?: string[] | null; locationId?: string | null },
  ): Promise<AssetReadinessItem[]> {
    const facts = await this.loadFacts(projectId);
    const items = this.readinessOfFacts(facts).items;
    const byId = new Map(items.map((i) => [`${i.kind}:${i.id}`, i]));
    const missing: AssetReadinessItem[] = [];
    for (const cid of refs.characterIds ?? []) {
      const hit = byId.get(`character:${cid}`);
      if (!hit) {
        missing.push({
          kind: 'character',
          id: cid,
          name: cid,
          ready: false,
          complete: false,
          missing: ['形象主图'],
          blocking: true,
        });
      } else if (!hit.ready && hit.blocking) {
        missing.push(hit);
      }
    }
    if (refs.locationId) {
      const hit = byId.get(`location:${refs.locationId}`);
      if (!hit) {
        missing.push({
          kind: 'location',
          id: refs.locationId,
          name: refs.locationId,
          ready: false,
          complete: false,
          missing: ['场景参考图'],
          blocking: true,
        });
      } else if (!hit.ready && hit.blocking) {
        missing.push(hit);
      }
    }
    return missing;
  }

  // ========== 内部 ==========

  private async loadFacts(projectId: string): Promise<{
    characters: {
      id: string;
      name: string;
      roleType: string | null;
      portraitUrl: string | null;
      views: CharacterIdentityKit['views'] | null;
      sheetUrl: string | null;
      referenceImageUrls: string[] | null;
    }[];
    locations: { id: string; name: string; referenceImageUrls: string[] | null }[];
    props: { id: string; name: string; code: string | null; category: string | null; referenceImageUrls: string[] | null }[];
  }> {
    const [charRows, locRows, propRows] = await Promise.all([
      this.db
        .select({
          id: characters.id,
          name: characters.name,
          roleType: characters.roleType,
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
      this.db
        .select({
          id: props.id,
          name: props.name,
          code: props.code,
          category: props.category,
          referenceImageUrls: props.referenceImageUrls,
        })
        .from(props)
        .where(eq(props.projectId, projectId)),
    ]);

    return {
      characters: charRows.map((c) => {
        const kit = (c.identityKit as CharacterIdentityKit | null) ?? null;
        return {
          id: c.id,
          name: c.name,
          roleType: c.roleType ?? null,
          portraitUrl: kit?.portraitUrl ?? null,
          views: kit?.views ?? null,
          sheetUrl: kit?.sheetUrl ?? null,
          referenceImageUrls: c.referenceImageUrls ?? [],
        };
      }),
      locations: locRows.map((l) => ({
        id: l.id,
        name: l.name,
        referenceImageUrls: l.referenceImageUrls ?? [],
      })),
      props: propRows.map((p) => ({
        id: p.id,
        name: p.name,
        code: p.code ?? null,
        category: p.category ?? null,
        referenceImageUrls: p.referenceImageUrls ?? [],
      })),
    };
  }

  private readinessOfFacts(facts: {
    characters: Parameters<typeof evaluateCharacterAsset>[0][];
    locations: Parameters<typeof evaluateLocationAsset>[0][];
    props: Parameters<typeof evaluatePropAsset>[0][];
  }): AssetReadinessSummary {
    return evaluateAssetReadiness([
      ...facts.characters.map((c) => evaluateCharacterAsset(c)),
      ...facts.locations.map((l) => evaluateLocationAsset(l)),
      // 道具默认不拦路：只有关键剧情道具（category=key）才参与硬门
      ...facts.props.map((p) =>
        evaluatePropAsset(p, { blocking: (p.category ?? '') === 'key' }),
      ),
    ]);
  }

  /** 在途定妆目标集合：`character:<id>` / `location:<id>` / `prop:<id>` */
  private async inflightTargets(projectId: string): Promise<Set<string>> {
    const rows = await this.db
      .select({
        targetType: generationJobs.targetType,
        targetId: generationJobs.targetId,
      })
      .from(generationJobs)
      .where(
        and(
          eq(generationJobs.projectId, projectId),
          eq(generationJobs.jobType, 'image'),
          inArray(generationJobs.status, [...ACTIVE_STATUSES]),
        ),
      );
    const set = new Set<string>();
    for (const r of rows) {
      if (!r.targetId || !r.targetType) continue;
      if (r.targetType === 'character' || r.targetType === 'location' || r.targetType === 'prop') {
        set.add(`${r.targetType}:${r.targetId}`);
      }
    }
    return set;
  }
}
