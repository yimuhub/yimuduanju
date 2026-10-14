import { Injectable, Inject, Logger, NotFoundException } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import {
  qcReports,
  projects,
  shots,
  scenes,
  characters,
  generationJobs,
} from '@server/database/schema';
import { eq, desc } from 'drizzle-orm';
import type { QcReport, QcIssue, QcRecommendation } from '@shared/api.interface';
import { CTA_KEYWORDS } from '@shared/content-modes';
import { estimateSpeechSeconds } from '@shared/text-metrics';
import {
  ruleDeadTime,
  ruleDialogueOverflow,
  ruleLongLines,
  ruleSameShotSize3,
  ruleSubtitleDrift,
  ruleWhitemodelMismatch,
  type RuleHit,
} from '@shared/qc-rules';
import { StoryboardService } from '../storyboard/storyboard.service';

@Injectable()
export class QcService {
  private readonly logger = new Logger(QcService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    private readonly storyboardService: StoryboardService,
  ) {}

  async getLatest(projectId: string): Promise<QcReport | null> {
    const rows = await this.db
      .select()
      .from(qcReports)
      .where(eq(qcReports.projectId, projectId))
      .orderBy(desc(qcReports.createdAt))
      .limit(1);
    if (rows.length === 0) return null;
    return this.mapReport(rows[0]);
  }

  async listReports(projectId: string): Promise<QcReport[]> {
    const rows = await this.db
      .select()
      .from(qcReports)
      .where(eq(qcReports.projectId, projectId))
      .orderBy(desc(qcReports.createdAt))
      .limit(50);
    return rows.map((r) => this.mapReport(r));
  }

  async getReport(projectId: string, id: string): Promise<QcReport> {
    const rows = await this.db
      .select()
      .from(qcReports)
      .where(eq(qcReports.id, id));
    if (rows.length === 0 || rows[0].projectId !== projectId) {
      throw new NotFoundException('质检报告不存在');
    }
    return this.mapReport(rows[0]);
  }

  async triggerQc(
    projectId: string,
    opts: { thresholdPass?: number; thresholdReview?: number },
  ): Promise<QcReport> {
    // P1 真实化：旧逻辑为 Math.random() 随机分，现改为确定性规则检查——
    // 缺图/缺视频/缺配音/缺字幕/空镜头/失败任务逐项扣分，issue 精确到 shotId，前端可一键跳转修复。
    // 仍非 AI 审片，报告如实反映“完整性”，不伪装成质量评价。
    const projectRows = await this.db
      .select({ id: projects.id, contentMode: projects.contentMode })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    if (projectRows.length === 0) throw new NotFoundException('项目不存在');
    // 双模式口径：广告节奏更快，死时间阈值 5s（短剧/通用 8s）
    const contentMode = projectRows[0].contentMode ?? 'general';
    const deadTimeThreshold = contentMode === 'ads' ? 5 : 8;

    const thresholdReview = this.clampScore(opts.thresholdReview ?? 80);
    const thresholdPass = Math.max(
      this.clampScore(opts.thresholdPass ?? 90),
      thresholdReview,
    );

    const [shotRows, sceneRows, charRows, jobRows] = await Promise.all([
      this.db.select().from(shots).where(eq(shots.projectId, projectId)),
      this.db.select().from(scenes).where(eq(scenes.projectId, projectId)),
      this.db.select().from(characters).where(eq(characters.projectId, projectId)),
      this.db.select().from(generationJobs).where(eq(generationJobs.projectId, projectId)),
    ]);

    const issues: QcIssue[] = [];
    const recommendations: QcRecommendation[] = [];
    // issue 上限，避免 jsonb 膨胀；超限收敛为一条聚合提示
    const pushIssue = (issue: QcIssue) => {
      if (issues.length < 30) issues.push(issue);
      else if (issues.length === 30)
        issues.push({
          severity: 'info',
          category: 'overflow',
          description: '其余同类问题已收敛，请逐个修复后重新质检',
        });
    };

    let characterConsistency: number;
    let sceneConsistency: number;
    let motionQuality: number;
    let audioSync: number;
    let subtitleAccuracy: number;
    let storyCoherence: number;
    let technicalQuality: number;

    if (shotRows.length === 0) {
      characterConsistency = 0;
      sceneConsistency = 0;
      motionQuality = 0;
      audioSync = 0;
      subtitleAccuracy = 0;
      storyCoherence = 0;
      technicalQuality = 0;
      pushIssue({
        severity: 'error',
        category: 'empty',
        description: '项目暂无分镜数据，请先解析剧本或创建分镜后再质检',
      });
      recommendations.push({
        category: 'empty',
        suggestion: '前往「分镜」页创建镜头，或用「一键创作」重新生成',
      });
    } else {
      const n = shotRows.length;
      const missingImage = shotRows.filter((s) => !s.startFrameUrl);
      const missingVideo = shotRows.filter((s) => !s.videoUrl);
      const dialogueShots = shotRows.filter((s) => s.dialogue || s.subtitleText);
      const missingVoice = dialogueShots.filter((s) => !s.voiceUrl);
      const missingSubtitle = shotRows.filter((s) => !s.subtitleText);
      const emptyShots = shotRows.filter(
        (s) => !s.dialogue && !s.visualPrompt && !s.subject && !s.action,
      );

      // 技术完整性：缺关键帧图扣 50 权重，缺成片视频扣 30 权重
      technicalQuality = this.clampScore(
        100 - 50 * (missingImage.length / n) - 30 * (missingVideo.length / n),
      );
      for (const s of missingImage.slice(0, 10))
        pushIssue({
          severity: 'warning',
          category: 'image',
          description: `镜头 #${s.shotNumber} 缺少关键帧图`,
          shotId: s.id,
        });
      if (missingImage.length > 10)
        pushIssue({
          severity: 'info',
          category: 'image',
          description: `另有 ${missingImage.length - 10} 个镜头缺少关键帧图`,
        });

      // 动态质量：无视频则无法评价，按缺视频比扣分
      motionQuality = this.clampScore(100 - 80 * (missingVideo.length / n));
      for (const s of missingVideo.slice(0, 10))
        pushIssue({
          severity: 'warning',
          category: 'motion',
          description: `镜头 #${s.shotNumber} 缺少生成视频`,
          shotId: s.id,
        });
      if (missingVideo.length > 10)
        pushIssue({
          severity: 'info',
          category: 'motion',
          description: `另有 ${missingVideo.length - 10} 个镜头缺少生成视频`,
        });

      // 音画同步：有对白无配音扣分；全片无对白则中性分
      if (dialogueShots.length === 0) {
        audioSync = 85;
        recommendations.push({
          category: 'audio',
          suggestion: '全片暂无对白/字幕，如需配音请先在分镜填写对白后生成配音',
        });
      } else {
        audioSync = this.clampScore(
          100 - 70 * (missingVoice.length / dialogueShots.length),
        );
        for (const s of missingVoice.slice(0, 10))
          pushIssue({
            severity: 'warning',
            category: 'audio',
            description: `镜头 #${s.shotNumber} 有对白但缺少配音`,
            shotId: s.id,
          });
      }

      // 字幕准确性：用字幕覆盖率近似
      subtitleAccuracy = this.clampScore(
        100 - 70 * (missingSubtitle.length / n),
      );
      if (missingSubtitle.length > 0)
        pushIssue({
          severity: 'info',
          category: 'subtitle',
          description: `${missingSubtitle.length} 个镜头缺少字幕文本`,
        });

      // 故事连贯性：空镜头（无对白无画面描述）占比扣分
      storyCoherence = this.clampScore(100 - 80 * (emptyShots.length / n));
      for (const s of emptyShots.slice(0, 10))
        pushIssue({
          severity: 'warning',
          category: 'story',
          description: `镜头 #${s.shotNumber} 缺少对白与画面描述，故事信息为空`,
          shotId: s.id,
        });

      // F3 统一规则：与生成前 preflight 同一份 shared/qc-rules（ArcReel 纪律），
      // 此处只做 issue 映射，不重写阈值。分数中性。
      for (const s of shotRows) {
        const hits = [
          ruleDialogueOverflow(s),
          ruleDeadTime(s, deadTimeThreshold),
          ...ruleWhitemodelMismatch(s),
          ruleSubtitleDrift(s),
          ruleLongLines(s),
        ].filter((h): h is RuleHit => h !== null);
        for (const hit of hits) {
          if (issues.length >= 30) break;
          pushIssue({
            severity: hit.level === 'error' ? 'warning' : hit.code === 'dead_time' || hit.code === 'long_lines' ? 'info' : 'warning',
            category: 'previz',
            description: `镜头 #${s.shotNumber} ${hit.message}`,
            shotId: s.id,
          });
        }
      }
      if (issues.some((i) => i.category === 'previz')) {
        recommendations.push({
          category: 'previz',
          suggestion: '到「导演台」用机位预设统一运镜口径，并为关键镜头录制白模锁定运镜与节奏',
        });
      }
      // S3 相邻镜景别错开（需有序序列，preflight 单镜调不到，只在 QC 做）
      for (const hit of ruleSameShotSize3(shotRows)) {
        if (issues.length >= 30) break;
        pushIssue({ severity: 'info', category: 'previz', description: hit.message });
      }

      // 双模式口径（分数中性，启发式建议）：
      // ads: 尾镜必须有 CTA（Hook+PAS+CTA 三段式缺一不可），无 CTA 只提示不扣分；
      // drama: 首镜必须有钩子（对白/动作至少一样），否则 3 秒划走。
      if (contentMode === 'ads' && shotRows.length > 0) {
        const ordered = [...shotRows].sort((a, b) => a.shotNumber - b.shotNumber);
        const last = ordered[ordered.length - 1];
        const tailText = `${last.dialogue ?? ''} ${last.subtitleText ?? ''} ${last.action ?? ''}`;
        if (!CTA_KEYWORDS.some((k) => tailText.includes(k))) {
          pushIssue({
            severity: 'info',
            category: 'previz',
            description: `广告模式：尾镜（#${last.shotNumber}）未检测到 CTA 文案，建议收口到单一明确动作（购买/下单/点击链接/领取试用/预约咨询）`,
            shotId: last.id,
          });
        }
      }
      if (contentMode === 'drama' && shotRows.length > 0) {
        const ordered = [...shotRows].sort((a, b) => a.shotNumber - b.shotNumber);
        const first = ordered[0];
        if (!first.dialogue && !first.action) {
          pushIssue({
            severity: 'info',
            category: 'previz',
            description: '短剧模式：首镜无对白无动作，钩子前置失败风险高（前 3 秒决定划走还是留下）',
            shotId: first.id,
          });
        }
      }

      // 角色一致性：角色缺参考图/标准描述则扣分；无角色给中性分并提示
      if (charRows.length === 0) {
        characterConsistency = 60;
        pushIssue({
          severity: 'info',
          category: 'character',
          description: '项目暂无角色设定，无法评估角色一致性',
        });
        recommendations.push({
          category: 'character',
          suggestion: '前往「人物」页创建角色并上传参考图，可显著提升一致性',
        });
      } else {
        const incomplete = charRows.filter(
          (c) =>
            !c.canonicalDescription ||
            !c.referenceImageUrls ||
            c.referenceImageUrls.length === 0,
        );
        characterConsistency = this.clampScore(
          100 - 60 * (incomplete.length / charRows.length),
        );
        if (incomplete.length > 0)
          pushIssue({
            severity: 'warning',
            category: 'character',
            description: `${incomplete.length} 个角色缺少标准描述或参考图（${incomplete
              .slice(0, 5)
              .map((c) => c.name)
              .join('、')}${incomplete.length > 5 ? '…' : ''}）`,
          });
        // W4 一致性：逐镜检查——引用了“问题角色”的镜头逐个挂 issue（可一键跳转修复）
        const badCharIds = new Set(incomplete.map((c) => c.id));
        const charNameOf = new Map(charRows.map((c) => [c.id, c.name] as const));
        let consistencyFlagged = 0;
        for (const s of shotRows) {
          const hitNames = ((s.characterIds ?? []) as string[])
            .filter((cid) => badCharIds.has(cid))
            .map((cid) => charNameOf.get(cid) ?? '未知角色');
          if (hitNames.length === 0) continue;
          if (consistencyFlagged < 10) {
            pushIssue({
              severity: 'warning',
              category: 'consistency',
              description: `镜头 #${s.shotNumber} 引用的角色缺少参考图/标准描述（${[...new Set(hitNames)].join('、')}），生成时一致性无保障`,
              shotId: s.id,
            });
          }
          consistencyFlagged += 1;
        }
        if (consistencyFlagged > 10)
          pushIssue({
            severity: 'info',
            category: 'consistency',
            description: `另有 ${consistencyFlagged - 10} 个镜头存在同样的角色一致性风险`,
          });
        if (consistencyFlagged > 0)
          recommendations.push({
            category: 'consistency',
            suggestion: '先补全角色参考图与标准描述，再用下方「一键重跑问题镜头」重新生成受影响镜头',
          });
      }

      // 场景一致性：场景缺纪要扣分；无场景给中性分
      if (sceneRows.length === 0) {
        sceneConsistency = 60;
        pushIssue({
          severity: 'info',
          category: 'scene',
          description: '项目暂无场景数据',
        });
      } else {
        const noSummary = sceneRows.filter((s) => !s.summary);
        sceneConsistency = this.clampScore(
          100 - 60 * (noSummary.length / sceneRows.length),
        );
      }
    }

    // 失败任务：每条失败任务一条 error issue（最多 10 条）
    const failedJobs = jobRows.filter((j) => j.status === 'failed');
    for (const j of failedJobs.slice(0, 10))
      pushIssue({
        severity: 'error',
        category: 'job',
        description: `生成任务失败（${j.jobType}${j.errorMessage ? `：${j.errorMessage.slice(0, 60)}` : ''}），请在任务队列重试`,
      });
    if (failedJobs.length > 10)
      pushIssue({
        severity: 'info',
        category: 'job',
        description: `另有 ${failedJobs.length - 10} 个失败任务，请在任务队列批量重试`,
      });
    if (failedJobs.length > 0)
      recommendations.push({
        category: 'job',
        suggestion: '前往「任务」页重试失败任务，成功后重新质检可提分',
      });

    const scores = [
      characterConsistency,
      sceneConsistency,
      motionQuality,
      audioSync,
      subtitleAccuracy,
      storyCoherence,
      technicalQuality,
    ];
    const overallScore = Math.round(
      scores.reduce((a, b) => a + b, 0) / scores.length,
    );
    const pass = overallScore >= thresholdPass;

    const rows = await this.db
      .insert(qcReports)
      .values({
        projectId,
        overallScore,
        characterConsistency,
        sceneConsistency,
        motionQuality,
        audioSync,
        subtitleAccuracy,
        storyCoherence,
        technicalQuality,
        issues,
        recommendations,
        pass,
        thresholdPass,
        thresholdReview,
      })
      .returning();

    return this.mapReport(rows[0]);
  }

  private clampScore(v: number): number {
    if (!Number.isFinite(v)) return 0;
    return Math.max(0, Math.min(100, Math.round(v)));
  }

  /**
   * 对白时长启发式估算：统一口径见 shared/text-metrics（QC 与生成前自检共用）。
   */
  private estimateSpeechSeconds(dialogue: string): number {
    return estimateSpeechSeconds(dialogue);
  }

  /**
   * W4 AI critic 回环（教练模式）：基于最新报告的问题清单，
   * 对可修复镜头自动创建重跑任务（image/consistency→图，motion→视频，audio→配音）。
   * 去重 + 上限 10 镜；预算超限时如实返回已创建与失败明细。
   */
  async retryFailedShots(
    projectId: string,
  ): Promise<{ jobIds: string[]; retriedShots: number; skipped: number; errors: string[] }> {
    const latest = await this.getLatest(projectId);
    if (!latest) throw new NotFoundException('暂无质检报告，请先发起质检');
    const actionable = new Map<string, 'image' | 'video' | 'tts'>();
    for (const issue of latest.issues) {
      if (!issue.shotId || actionable.has(issue.shotId)) continue;
      if (actionable.size >= 10) break;
      if (issue.category === 'image' || issue.category === 'consistency') {
        actionable.set(issue.shotId, 'image');
      } else if (issue.category === 'motion') {
        actionable.set(issue.shotId, 'video');
      } else if (issue.category === 'audio') {
        actionable.set(issue.shotId, 'tts');
      }
    }
    const jobIds: string[] = [];
    const errors: string[] = [];
    for (const [shotId, type] of actionable) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const { jobId } = await (type === 'image'
          ? this.storyboardService.generateShotImage(projectId, shotId)
          : type === 'video'
            ? this.storyboardService.generateShotVideo(projectId, shotId)
            : this.storyboardService.generateShotVoice(projectId, shotId));
        jobIds.push(jobId);
      } catch (e) {
        errors.push(`镜头 ${shotId.slice(0, 8)}：${(e as Error).message}`);
      }
    }
    const skipped = latest.issues.filter((i) => i.shotId).length - actionable.size;
    return { jobIds, retriedShots: actionable.size, skipped: Math.max(0, skipped), errors };
  }

  private mapReport(row: typeof qcReports.$inferSelect): QcReport {
    // P1 修复：分数列 DB 可空，兜底保证契约必填字段永不为 null
    return {
      id: row.id,
      projectId: row.projectId,
      overallScore: row.overallScore ?? 0,
      characterConsistency: row.characterConsistency ?? 0,
      sceneConsistency: row.sceneConsistency ?? 0,
      motionQuality: row.motionQuality ?? 0,
      audioSync: row.audioSync ?? 0,
      subtitleAccuracy: row.subtitleAccuracy ?? 0,
      storyCoherence: row.storyCoherence ?? 0,
      technicalQuality: row.technicalQuality ?? 0,
      issues: (row.issues as QcIssue[]) ?? [],
      recommendations: (row.recommendations as QcRecommendation[]) ?? [],
      pass: row.pass ?? false,
      thresholdPass: row.thresholdPass ?? 90,
      thresholdReview: row.thresholdReview ?? 80,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
