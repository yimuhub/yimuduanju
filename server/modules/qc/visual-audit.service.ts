/**
 * 角色一致性看图审计（migration 0025，对标 ArcReel `inspect_images`）
 * ---------------------------------------------------------------------------
 * 取项目全部角色定妆照 + 场景图 + 最新分镜首帧，用 LLM 逐一审计：
 * prompt 注入角色 LOCK 锚点（lock_anchors → identityKit 文本锁 → canonicalDescription
 * 三级回落）+ 受检图 URL，问「图片中的角色外貌是否与以下描述一致？列出差异点」。
 * 结果写入 qc 审计表（qc_reports，audit_type='visual'）：
 *   issues[] = { severity, category:'visual_audit', description, shotId?, meta: VisualAuditMeta }
 * 前端 QC Tab 渲染（角色名 | 一致/偏差/严重偏差 | 差异描述）。
 *
 * 与 ArcReel 的差异（如实记录）：YIMU 网关是文本通道，受检图以 URL 形式注入
 * prompt，不做 embedding 相似度——结论是 LLM 依据锚点描述给出的判断，
 * 「无法核验」结论留给缺图/缺锚点/调用失败的条目，不伪造确定性。
 */
import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { asc, and, eq } from 'drizzle-orm';
import { characters, locations, projects, qcReports, scenes, shots } from '@server/database/schema';
import type { QcIssue, QcRecommendation, VisualAuditMeta, VisualAuditReport, VisualAuditVerdict } from '@shared/api.interface';
import { ModelGatewayService } from '../generation/model-gateway.service';

/** 审计条目上限：定妆照 + 场景 + 逐镜逐角色，超过按镜序截断（成本可控） */
const MAX_AUDIT_ITEMS = 40;
/** 锚点摘要长度：塞进 prompt 的描述截断 */
const ANCHOR_EXCERPT_MAX = 300;

interface AuditInput {
  target: VisualAuditMeta['target'];
  refId: string;
  name: string;
  imageUrl: string;
  anchor: string;
  anchorExcerpt: string;
  shotId?: string;
  shotNumber?: number;
}

interface AuditOutcome extends AuditInput {
  verdict: VisualAuditVerdict;
  differences: string;
}

/** 从 LLM 回复中稳健提取 JSON 结论（容忍 ```json 围栏 / 前后废话） */
function parseVerdictReply(raw: string): { verdict: VisualAuditVerdict; differences: string } | null {
  const text = (raw ?? '').trim();
  // 1) 直接解析整段
  const candidates: string[] = [text];
  // 2) 围栏块
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) candidates.unshift(fence[1].trim());
  // 3) 首个 {...} 片段
  const brace = text.match(/\{[\s\S]*\}/);
  if (brace?.[0]) candidates.unshift(brace[0]);
  for (const cand of candidates) {
    try {
      const obj = JSON.parse(cand) as { verdict?: unknown; differences?: unknown; reason?: unknown };
      const v = typeof obj.verdict === 'string' ? obj.verdict.toLowerCase() : '';
      const verdict: VisualAuditVerdict | null =
        v.includes('severe') || v.includes('严重')
          ? 'severe_deviation'
          : v.includes('deviation') || v.includes('偏差')
            ? 'deviation'
            : v.includes('unverifiable') || v.includes('无法')
              ? 'unverifiable'
              : v.includes('consistent') || v.includes('一致')
                ? 'consistent'
                : null;
      if (!verdict) continue;
      const differences =
        (typeof obj.differences === 'string' && obj.differences.trim()) ||
        (typeof obj.reason === 'string' && obj.reason.trim()) ||
        '';
      return { verdict, differences: differences.slice(0, 500) };
    } catch {
      continue;
    }
  }
  return null;
}

const AUDIT_SYSTEM_PROMPT =
  '你是「一幕·YIMU AI 短剧创作平台」的角色一致性审计员（对标 ArcReel inspect_images：' +
  '判断生成结果能否使用——与设定或提示词是否相符、同一角色是否前后一致）。' +
  '对每张受检图，对照给定的身份锚点描述判断一致程度，只输出一个 JSON 对象：' +
  '{"verdict":"consistent|deviation|severe_deviation|unverifiable","differences":"差异点（中文，≤200字）"}。' +
  '判定口径：consistent=外貌与锚点一致或仅有无关紧要的差别；deviation=有可见差异但角色仍可辨认' +
  '（发型/服饰颜色等可修）；severe_deviation=脸型/性别/明显换了人，画面不可用，建议重跑；' +
  'unverifiable=无法依据所给信息判断。不要编造看不到的细节。';

@Injectable()
export class VisualAuditService {
  private readonly logger = new Logger(VisualAuditService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    private readonly modelGateway: ModelGatewayService,
  ) {}

  /** 身份锚点三级回落：lock_anchors 逐字锁 → identityKit 文本锁 → canonicalDescription */
  private anchorOf(c: typeof characters.$inferSelect): { anchor: string; excerpt: string } {
    const lockAnchors = Array.isArray(c.lockAnchors) ? (c.lockAnchors as string[]) : [];
    const kit = (c.identityKit ?? null) as
      | { identityDescriptor?: string; wardrobe?: string; signatureDetails?: string }
      | null;
    const anchor =
      lockAnchors.filter((a) => typeof a === 'string' && a.trim()).join('；') ||
      [kit?.identityDescriptor, kit?.wardrobe, kit?.signatureDetails]
        .filter((v) => typeof v === 'string' && v.trim())
        .join('；') ||
      (c.canonicalDescription ?? '').trim();
    return { anchor, excerpt: anchor.slice(0, ANCHOR_EXCERPT_MAX) };
  }

  /** 组装审计输入清单：定妆照 → 场景图 → 逐镜首帧 × 出场角色 */
  private async collectAuditInputs(projectId: string): Promise<AuditInput[]> {
    const [charRows, shotRows, sceneRows] = await Promise.all([
      this.db.select().from(characters).where(eq(characters.projectId, projectId)).orderBy(asc(characters.sortOrder)),
      this.db
        .select()
        .from(shots)
        .where(eq(shots.projectId, projectId))
        .orderBy(asc(shots.shotNumber)),
      this.db.select().from(scenes).where(eq(scenes.projectId, projectId)),
    ]);
    const sceneById = new Map(sceneRows.map((s) => [s.id, s] as const));

    const inputs: AuditInput[] = [];
    const charById = new Map(charRows.map((c) => [c.id, c] as const));

    // ① 角色定妆照：主图回落参考图第一张；锚点缺失或无图的记「无法核验」
    for (const c of charRows) {
      const kit = (c.identityKit ?? null) as { portraitUrl?: string } | null;
      const imageUrl =
        (kit?.portraitUrl ?? '').trim() || (c.referenceImageUrls ?? [])[0] || '';
      const { anchor, excerpt } = this.anchorOf(c);
      inputs.push({
        target: 'character',
        refId: c.id,
        name: c.name,
        imageUrl,
        anchor,
        anchorExcerpt: excerpt,
      });
    }

    // ② 场景图：locations.referenceImageUrls（场景「定妆照」）对照场景/地点描述
    const sceneLocationIds = [
      ...new Set(sceneRows.map((s) => s.locationId).filter((v): v is string => Boolean(v))),
    ];
    if (sceneLocationIds.length > 0) {
      const locRows = await this.db
        .select()
        .from(locations)
        .where(eq(locations.projectId, projectId));
      for (const loc of locRows) {
        if (!sceneLocationIds.includes(loc.id)) continue;
        const imageUrl = (loc.referenceImageUrls ?? [])[0] ?? '';
        const anchor =
          [loc.description, loc.architecture, loc.lighting, loc.colorPalette]
            .filter((v) => typeof v === 'string' && v.trim())
            .join('；') || `${loc.name}（${loc.timeOfDay ?? ''} ${loc.weather ?? ''}）`;
        inputs.push({
          target: 'scene',
          refId: loc.id,
          name: loc.name,
          imageUrl,
          anchor,
          anchorExcerpt: anchor.slice(0, ANCHOR_EXCERPT_MAX),
        });
      }
    }

    // ③ 逐镜首帧 × 出场角色：一张首帧对每个出场角色各审一次（ArcReel 三方对照思想：
    //    设定锚点 + 受检图 + 该镜提示词）
    for (const s of shotRows) {
      if (!s.startFrameUrl) continue;
      const ids = (s.characterIds ?? []) as string[];
      const sceneName = sceneById.get(s.sceneId)?.title ?? '';
      for (const cid of ids) {
        const c = charById.get(cid);
        if (!c) continue;
        const { anchor, excerpt } = this.anchorOf(c);
        inputs.push({
          target: 'character',
          refId: c.id,
          name: c.name,
          imageUrl: s.startFrameUrl,
          anchor,
          anchorExcerpt: excerpt,
          shotId: s.id,
          shotNumber: s.shotNumber,
        });
        if (inputs.length >= MAX_AUDIT_ITEMS) break;
      }
      if (inputs.length >= MAX_AUDIT_ITEMS) {
        this.logger.warn(`一致性审计 ${projectId}：条目超过 ${MAX_AUDIT_ITEMS}，截断（可重跑补齐其余镜头）`);
        break;
      }
    }
    return inputs.slice(0, MAX_AUDIT_ITEMS);
  }

  /** 逐条审计（调用文本 LLM；受检图以 URL 注入 prompt） */
  private async auditItem(item: AuditInput): Promise<AuditOutcome> {
    if (!item.imageUrl || !item.anchor) {
      return {
        ...item,
        verdict: 'unverifiable',
        differences: !item.imageUrl
          ? '缺少受检图（尚未生成定妆照/首帧），无法审计'
          : '缺少身份锚点（请先补全角色锁定描述）',
      };
    }
    const prompt =
      `受检图：${item.imageUrl}\n` +
      (item.shotNumber ? `受检对象：镜头 #${item.shotNumber} 的首帧画面\n` : '受检对象：该对象的定妆/设定图\n') +
      `身份锚点（必须逐字一致的外貌事实）：\n${item.anchor}\n\n` +
      '图片中的对象外貌是否与以上描述一致？列出差异点。只输出 JSON：' +
      '{"verdict":"consistent|deviation|severe_deviation|unverifiable","differences":"..."}';
    try {
      const reply = await this.modelGateway.generateText({ prompt, systemPrompt: AUDIT_SYSTEM_PROMPT, temperature: 0.2 });
      const parsed = parseVerdictReply(reply);
      if (!parsed) {
        return { ...item, verdict: 'unverifiable', differences: `审计输出无法解析：${reply.slice(0, 160)}` };
      }
      return { ...item, ...parsed };
    } catch (e) {
      const msg = (e as Error)?.message ?? '未知错误';
      return { ...item, verdict: 'unverifiable', differences: `审计调用失败：${msg.slice(0, 200)}` };
    }
  }

  /** 全项目一致性审计：结果写 qc_reports（audit_type='visual'），返回最新报告 */
  async runAudit(projectId: string): Promise<VisualAuditReport> {
    const projRows = await this.db
      .select({ id: projects.id, title: projects.title })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    if (projRows.length === 0) throw new NotFoundException('项目不存在');

    const inputs = await this.collectAuditInputs(projectId);
    if (inputs.length === 0) {
      throw new NotFoundException('项目暂无可审计对象：请先生成角色定妆照或镜头首帧');
    }

    const outcomes: AuditOutcome[] = [];
    for (const item of inputs) {
      // eslint-disable-next-line no-await-in-loop
      outcomes.push(await this.auditItem(item));
    }

    // 结论 → issue 映射：severity 承载可跳转/可重跑的优先级
    const severityOf = (v: VisualAuditVerdict): string =>
      v === 'severe_deviation' ? 'error' : v === 'deviation' ? 'warning' : 'info';
    const labelOf = (v: VisualAuditVerdict): string =>
      v === 'consistent' ? '一致' : v === 'deviation' ? '偏差' : v === 'severe_deviation' ? '严重偏差' : '无法核验';
    const issues: QcIssue[] = outcomes.map((o) => {
      const meta: VisualAuditMeta = {
        target: o.target,
        name: o.name,
        verdict: o.verdict,
        imageUrl: o.imageUrl || undefined,
        anchorExcerpt: o.anchorExcerpt || undefined,
        refId: o.refId,
      };
      const where = o.shotNumber ? `（镜头 #${o.shotNumber} 首帧）` : o.target === 'scene' ? '（场景图）' : '（定妆照）';
      return {
        severity: severityOf(o.verdict),
        category: 'visual_audit',
        description: `${o.name}${where}：${labelOf(o.verdict)}${o.differences ? ` —— ${o.differences}` : ''}`,
        shotId: o.shotId,
        meta,
      };
    });

    const judged = outcomes.filter((o) => o.verdict !== 'unverifiable');
    const consistent = judged.filter((o) => o.verdict === 'consistent').length;
    const deviation = judged.filter((o) => o.verdict === 'deviation').length;
    const severe = judged.filter((o) => o.verdict === 'severe_deviation').length;
    // 记分（如实口径）：一致 1 分、偏差 0.5、严重偏差 0；无法核验不计入分母
    const score =
      judged.length > 0
        ? Math.round(((consistent + deviation * 0.5) / judged.length) * 100)
        : 0;
    const recommendations: QcRecommendation[] = [];
    if (severe > 0) {
      recommendations.push({
        category: 'visual_audit',
        suggestion: `${severe} 处严重偏差（多为脸型/换人级别）：先补全或重出对应角色锚点图，再重跑这些镜头的首帧`,
      });
    }
    if (deviation > 0) {
      recommendations.push({
        category: 'visual_audit',
        suggestion: `${deviation} 处可见偏差：多为发型/服饰级别，可修改镜头提示词后重跑首帧`,
      });
    }
    if (outcomes.some((o) => o.verdict === 'unverifiable')) {
      recommendations.push({
        category: 'visual_audit',
        suggestion: '部分条目无法核验（缺图/缺锚点/调用失败）：补齐定妆照与角色锁定描述后重新审计',
      });
    }
    if (judged.length > 0 && severe === 0) {
      recommendations.push({
        category: 'visual_audit',
        suggestion: '无严重偏差：角色一致性整体可用，可继续视频生成',
      });
    }

    const rows = await this.db
      .insert(qcReports)
      .values({
        projectId,
        auditType: 'visual',
        overallScore: score,
        characterConsistency: score,
        issues,
        recommendations,
        pass: judged.length > 0 && severe === 0,
        thresholdPass: 90,
        thresholdReview: 80,
      })
      .returning();
    this.logger.log(
      `一致性审计 ${projectId}：${outcomes.length} 条（一致 ${consistent} / 偏差 ${deviation} / 严重 ${severe} / 无法核验 ${outcomes.length - judged.length}），得分 ${score}`,
    );
    return this.mapReport(rows[0]);
  }

  /** 最新一份看图审计报告（无则 null，前端展示空态） */
  async getLatestAudit(projectId: string): Promise<VisualAuditReport | null> {
    const rows = await this.db
      .select()
      .from(qcReports)
      .where(and(eq(qcReports.projectId, projectId), eq(qcReports.auditType, 'visual')))
      .orderBy(asc(qcReports.createdAt));
    const latest = rows[rows.length - 1];
    return latest ? this.mapReport(latest) : null;
  }

  private mapReport(row: typeof qcReports.$inferSelect) {
    const issues = (row.issues as QcIssue[]) ?? [];
    return {
      id: row.id,
      projectId: row.projectId,
      auditType: 'visual' as const,
      overallScore: row.overallScore ?? 0,
      pass: row.pass ?? false,
      items: issues.map((i) => ({
        name: i.meta?.name ?? '未知对象',
        target: i.meta?.target ?? ('character' as const),
        verdict: i.meta?.verdict ?? ('unverifiable' as VisualAuditVerdict),
        differences: i.description.split('——')[1]?.trim() || '',
        imageUrl: i.meta?.imageUrl,
        anchorExcerpt: i.meta?.anchorExcerpt,
        shotId: i.shotId,
      })),
      recommendations: (row.recommendations as QcRecommendation[]) ?? [],
      createdAt: row.createdAt.toISOString(),
    };
  }
}
