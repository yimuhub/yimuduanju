import { Injectable, Inject, Logger, BadRequestException } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { modelProviders, stageModelBindings } from '@server/database/schema';
import { eq } from 'drizzle-orm';
import type { StageBinding, StageKey } from '@shared/stage-bindings';
import { STAGE_METAS } from '@shared/stage-bindings';

const STAGES = STAGE_METAS.map((s) => s.key);

/**
 * B1 分环节模型绑定（移植 ToonFlow agentDeploy）：
 * 每环节独立指定供应商 + 模型 + 温度/token 上限；未绑定回落供应商默认。
 */
@Injectable()
export class StageBindingsService {
  private readonly logger = new Logger(StageBindingsService.name);

  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase) {}

  async list(): Promise<StageBinding[]> {
    const rows = await this.db
      .select({
        stage: stageModelBindings.stage,
        providerId: stageModelBindings.providerId,
        model: stageModelBindings.model,
        temperature: stageModelBindings.temperature,
        maxTokens: stageModelBindings.maxTokens,
        updatedAt: stageModelBindings.updatedAt,
        providerName: modelProviders.name,
      })
      .from(stageModelBindings)
      .leftJoin(modelProviders, eq(stageModelBindings.providerId, modelProviders.id));
    const byStage = new Map(rows.map((r) => [r.stage, r]));
    return STAGES.map((stage) => {
      const r = byStage.get(stage);
      return {
        stage: stage as StageKey,
        providerId: r?.providerId ?? undefined,
        providerName: r?.providerName ?? undefined,
        model: r?.model ?? undefined,
        temperature: r?.temperature !== null && r?.temperature !== undefined ? Number(r.temperature) : undefined,
        maxTokens: r?.maxTokens ?? undefined,
        updatedAt: r?.updatedAt?.toISOString(),
      };
    });
  }

  async set(
    stage: string,
    dto: { providerId?: string | null; model?: string; temperature?: number; maxTokens?: number },
  ): Promise<StageBinding> {
    if (!(STAGES as string[]).includes(stage)) {
      throw new BadRequestException(`未知环节: ${stage}（可选 ${STAGES.join('/')}）`);
    }
    const key = stage as StageKey;
    if (dto.providerId) {
      const prow = await this.db
        .select({ id: modelProviders.id })
        .from(modelProviders)
        .where(eq(modelProviders.id, dto.providerId))
        .limit(1);
      if (prow.length === 0) throw new BadRequestException('供应商不存在');
    }
    const temperatureNum =
      dto.temperature === undefined || dto.temperature === null
        ? null
        : Math.max(0, Math.min(2, Number(dto.temperature)));
    if (temperatureNum !== null && !Number.isFinite(temperatureNum)) {
      throw new BadRequestException('temperature 须为 0-2 的数字');
    }
    // drizzle numeric 列以字符串读写
    const temperature = temperatureNum === null ? null : temperatureNum.toFixed(2);
    const maxTokens =
      dto.maxTokens === undefined || dto.maxTokens === null
        ? null
        : Math.max(1, Math.min(128000, Math.floor(Number(dto.maxTokens))));
    if (maxTokens !== null && !Number.isFinite(maxTokens)) {
      throw new BadRequestException('maxTokens 须为正整数');
    }
    await this.db
      .insert(stageModelBindings)
      .values({
        stage: key,
        providerId: dto.providerId || null,
        model: dto.model?.trim() || null,
        temperature,
        maxTokens,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: stageModelBindings.stage,
        set: {
          providerId: dto.providerId || null,
          model: dto.model?.trim() || null,
          temperature,
          maxTokens,
          updatedAt: new Date(),
        },
      });
    this.logger.log(`环节绑定已保存 ${key}`);
    const all = await this.list();
    return all.find((b) => b.stage === key) as StageBinding;
  }

  async clear(stage: string): Promise<void> {
    if (!(STAGES as string[]).includes(stage)) {
      throw new BadRequestException(`未知环节: ${stage}`);
    }
    await this.db.delete(stageModelBindings).where(eq(stageModelBindings.stage, stage as StageKey));
  }

  /** worker 用：取某环节绑定（无绑定返回空对象，调用方回落默认） */
  async resolve(stage: StageKey): Promise<StageBinding> {
    const all = await this.list();
    return all.find((b) => b.stage === stage) ?? { stage };
  }
}
