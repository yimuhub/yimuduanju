import {
  Injectable,
  Inject,
  Logger,
  NotFoundException,
  BadRequestException,
  forwardRef,
} from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { modelProviders } from '@server/database/schema';
import { providerApiKeys } from '@server/database/billing.schema';
import { and, desc, eq } from 'drizzle-orm';
import { ModelGatewayService } from '../generation/model-gateway.service';
import type {
  ModelProvider,
  CreateProviderRequest,
  UpdateProviderRequest,
  ProviderTestResult,
  ModelCapabilities,
  ProviderModelParams,
  ProviderType,
  FormatType,
  ProviderConnectionRequest,
  ProviderFetchModelsResult,
  ProviderModelItem,
  ProviderApiKeyItem,
} from '@shared/api.interface';
import { classifyModelId } from '@shared/model-classify';
// W1 安全修复：API Key 落库 AES-256-GCM 加密，读取时解密
import { decryptApiKey, encryptApiKey } from '../../common/crypto.util';

@Injectable()
export class ProvidersService {
  private readonly logger = new Logger(ProvidersService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    @Inject(forwardRef(() => ModelGatewayService))
    private readonly gateway: ModelGatewayService,
  ) {}

  async list(): Promise<ModelProvider[]> {
    const rows = await this.db
      .select()
      .from(modelProviders)
      .orderBy(desc(modelProviders.routingPriority), desc(modelProviders.createdAt));
    const items: ModelProvider[] = [];
    for (const r of rows) {
      const base = this.mapProvider(r);
      // eslint-disable-next-line no-await-in-loop
      base.activeKeyCount = await this.countActiveKeys(r.id, Boolean(r.apiKey));
      items.push(base);
    }
    return items;
  }

  async get(id: string): Promise<ModelProvider> {
    const rows = await this.db
      .select()
      .from(modelProviders)
      .where(eq(modelProviders.id, id));
    if (rows.length === 0) throw new NotFoundException('Provider 不存在');
    const item = this.mapProvider(rows[0]);
    item.activeKeyCount = await this.countActiveKeys(rows[0].id, Boolean(rows[0].apiKey));
    return item;
  }

  async create(dto: CreateProviderRequest): Promise<ModelProvider> {
    // W1 商业化：official 类型由官方通道系统托管，禁止手工创建
    if (dto.providerType === 'official') {
      throw new BadRequestException('官方直供通道由系统托管，请在计费设置中配置');
    }
    const caps: ModelCapabilities = dto.capabilities ?? {
      text: true,
      image: false,
      video: false,
      tts: false,
    };

    return this.db.transaction(async (tx) => {
      // 如果设为默认，先清除其他默认
      if (dto.isDefault) {
        await tx
          .update(modelProviders)
          .set({ isDefault: false })
          .where(eq(modelProviders.isDefault, true));
      }

      const rows = await tx
        .insert(modelProviders)
        .values({
          name: dto.name,
          providerType: dto.providerType,
          baseUrl: dto.baseUrl,
          // W1 安全修复：落库前加密
          apiKey: encryptApiKey(dto.apiKey),
          textModel: dto.textModel,
          imageModel: dto.imageModel,
          videoModel: dto.videoModel,
          ttsModel: dto.ttsModel,
          ttsVoice: dto.ttsVoice,
          promptPrefix: dto.promptPrefix,
          modelParams: dto.modelParams as Record<string, unknown> | undefined,
          formatType: dto.formatType ?? 'openai',
          capabilities: caps,
          isDefault: dto.isDefault ?? false,
        })
        .returning();
      return this.mapProvider(rows[0]);
    });
  }

  async update(id: string, dto: UpdateProviderRequest): Promise<ModelProvider> {
    const patch: Record<string, unknown> = {};
    if (dto.name !== undefined) patch.name = dto.name;
    if (dto.baseUrl !== undefined) patch.baseUrl = dto.baseUrl;
    // W1 安全修复：落库前加密
    if (dto.apiKey !== undefined) patch.apiKey = encryptApiKey(dto.apiKey);
    if (dto.textModel !== undefined) patch.textModel = dto.textModel;
    if (dto.imageModel !== undefined) patch.imageModel = dto.imageModel;
    if (dto.videoModel !== undefined) patch.videoModel = dto.videoModel;
    if (dto.ttsModel !== undefined) patch.ttsModel = dto.ttsModel;
    if (dto.ttsVoice !== undefined) patch.ttsVoice = dto.ttsVoice;
    if (dto.promptPrefix !== undefined) patch.promptPrefix = dto.promptPrefix || null;
    if (dto.modelParams !== undefined)
      patch.modelParams = dto.modelParams as Record<string, unknown> | null;
    if (dto.formatType !== undefined) patch.formatType = dto.formatType;
    if (dto.capabilities !== undefined) patch.capabilities = dto.capabilities;
    if (dto.enabled !== undefined) patch.enabled = dto.enabled;
    if (dto.routingPriority !== undefined)
      patch.routingPriority = dto.routingPriority;

    return this.db.transaction(async (tx) => {
      if (dto.isDefault === true) {
        await tx
          .update(modelProviders)
          .set({ isDefault: false })
          .where(eq(modelProviders.isDefault, true));
        patch.isDefault = true;
      }

      if (Object.keys(patch).length === 0) {
        const rows = await tx
          .select()
          .from(modelProviders)
          .where(eq(modelProviders.id, id));
        if (rows.length === 0) throw new NotFoundException('Provider 不存在');
        return this.mapProvider(rows[0]);
      }
      patch.updatedAt = new Date();

      const rows = await tx
        .update(modelProviders)
        .set(patch)
        .where(eq(modelProviders.id, id))
        .returning();
      if (rows.length === 0) throw new NotFoundException('Provider 不存在');
      return this.mapProvider(rows[0]);
    });
  }

  async delete(id: string): Promise<void> {
    const rows = await this.db
      .delete(modelProviders)
      .where(eq(modelProviders.id, id))
      .returning({ id: modelProviders.id });
    if (rows.length === 0) throw new NotFoundException('Provider 不存在');
  }

  /**
   * 生效 Key 解析（与网关 getProvider 同口径，不各自发明）：
   * 多 Key 行（最新激活）优先，主 Key 列回落。测试/拉模型必须走这里，
   * 否则多 Key 用户永远“未配置 API Key”。
   */
  private async resolveEffectiveKey(
    provider: typeof modelProviders.$inferSelect,
  ): Promise<string | undefined> {
    const keyRows = await this.db
      .select({ apiKey: providerApiKeys.apiKey })
      .from(providerApiKeys)
      .where(
        and(
          eq(providerApiKeys.providerId, provider.id),
          eq(providerApiKeys.isActive, true),
        ),
      )
      .orderBy(desc(providerApiKeys.createdAt))
      .limit(1);
    // W1 安全修复：出库即解密（存量明文行灰度兼容）
    if (keyRows.length > 0 && keyRows[0].apiKey)
      return decryptApiKey(keyRows[0].apiKey) ?? undefined;
    return decryptApiKey(provider.apiKey) ?? undefined;
  }

  /** 表单 Key 优先（用户刚粘贴的），否则用已保存供应商的生效 Key */
  private async resolveFormKey(
    dto: ProviderConnectionRequest,
  ): Promise<{ apiKey?: string; fromSaved: boolean }> {
    if (dto.apiKey?.trim()) return { apiKey: dto.apiKey.trim(), fromSaved: false };
    if (dto.providerId) {
      const rows = await this.db
        .select()
        .from(modelProviders)
        .where(eq(modelProviders.id, dto.providerId))
        .limit(1);
      if (rows.length > 0) {
        const key = await this.resolveEffectiveKey(rows[0]);
        if (key) return { apiKey: key, fromSaved: true };
      }
    }
    return { fromSaved: false };
  }

  /**
   * 模型列表探测（含 /v1 回退）：
   * 用户常漏写 /v1（如填 http://host:8787），此时先按原样打一次，
   * 404 且地址不以 /v1 结尾则补 /v1 再打一次。返回最终状态与实际地址，
   * 调用方不再各自猜路径。 models 只在 200 时解析。
   */
  private async probeModels(
    baseUrl: string,
    apiKey: string,
  ): Promise<{
    status: number | 'network-error';
    latencyMs: number;
    url: string;
    models: ProviderModelItem[];
    error?: string;
  }> {
    const startTime = Date.now();
    const candidates = [`${baseUrl}/models`];
    if (!/\/v1$/.test(baseUrl)) candidates.push(`${baseUrl}/v1/models`);
    let lastStatus: number | 'network-error' = 'network-error';
    let lastError = '';
    let lastUrl = candidates[0];
    for (const url of candidates) {
      lastUrl = url;
      try {
        // eslint-disable-next-line no-await-in-loop
        const response = await fetch(url, {
          method: 'GET',
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        lastStatus = response.status;
        if (response.status === 404) continue; // 换下一个候选
        if (!response.ok) {
          return { status: response.status, latencyMs: Date.now() - startTime, url, models: [] };
        }
        // eslint-disable-next-line no-await-in-loop
        const data = (await response.json()) as { data?: ProviderModelItem[]; models?: ProviderModelItem[] };
        return {
          status: 200,
          latencyMs: Date.now() - startTime,
          url,
          models: data.data || data.models || [],
        };
      } catch (e) {
        lastError = (e as Error).message;
        break; // 网络错误换地址也一样，直接出
      }
    }
    return {
      status: lastStatus,
      latencyMs: Date.now() - startTime,
      url: lastUrl,
      models: [],
      error: lastError || undefined,
    };
  }

  async test(id: string): Promise<ProviderTestResult> {
    const rows = await this.db
      .select()
      .from(modelProviders)
      .where(eq(modelProviders.id, id));
    if (rows.length === 0) {
      return { success: false, message: 'Provider 不存在' };
    }
    const provider = rows[0];
    if (!provider.enabled) {
      return { success: false, message: 'Provider 未启用' };
    }
    const apiKey = await this.resolveEffectiveKey(provider);
    if (!apiKey) {
      return { success: false, message: '未配置 API Key（主 Key 与多 Key 均为空，请先添加）' };
    }
    if (!provider.baseUrl) {
      return { success: false, message: '未配置 Base URL' };
    }

    const baseUrl = provider.baseUrl.replace(/\/$/, '');
    const probed = await this.probeModels(baseUrl, apiKey);
    const { status, latencyMs, url } = probed;
    if (status === 200) {
      return { success: true, message: '连接成功', latencyMs, url };
    }
    if (status === 'network-error') {
      return {
        success: false,
        message: `网络错误: ${probed.error ?? '无法建立连接'}（请求地址 ${url}）`,
        latencyMs,
        url,
      };
    }
    // 401 也说明连接上了，只是鉴权问题
    if (status === 401 || status === 403) {
      return {
        success: false,
        message: `鉴权失败 (HTTP ${status})，请检查 API Key`,
        latencyMs,
        url,
      };
    }
    if (status === 404) {
      // 中转站常见缺 /models 接口：有文本模型则用最小文本调用验证（约 1 token）
      if (provider.textModel) {
        const r = await this.probeChat(baseUrl, apiKey, provider.textModel, Date.now() - latencyMs);
        return { ...r, url: r.url ?? url };
      }
      return {
        success: false,
        message: `接口不存在 (HTTP 404)，请求地址 ${url}；请检查 Base URL 路径（如火山方舟需以 /api/v3 结尾）；部分中转站不支持 /models，可填写文本模型后重测`,
        latencyMs,
        url,
      };
    }
    return {
      success: false,
      message: `连接异常 (HTTP ${status})（请求地址 ${url}）`,
      latencyMs,
      url,
    };
  }

  /**
   * 文本探测：POST chat/completions 发送 1 token 请求验证连通+鉴权。
   * 用于 /models 不可用的中转站/专有网关，成本可忽略。
   */
  private async probeChat(
    baseUrl: string,
    apiKey: string,
    model: string,
    startTime: number,
  ): Promise<ProviderTestResult> {
    try {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 1,
        }),
      });
      const latency = Date.now() - startTime;
      if (response.ok) {
        return { success: true, message: '连接成功（经文本接口验证，/models 不可用）', latencyMs: latency };
      }
      if (response.status === 401 || response.status === 403) {
        return { success: false, message: `鉴权失败 (HTTP ${response.status})，请检查 API Key`, latencyMs: latency };
      }
      const errText = await response.text().catch(() => '');
      return {
        success: false,
        message: `文本接口异常 (HTTP ${response.status})${errText ? `：${errText.slice(0, 120)}` : ''}`,
        latencyMs: latency,
      };
    } catch (error) {
      return { success: false, message: `网络错误: ${(error as Error).message}`, latencyMs: Date.now() - startTime };
    }
  }

  /** 用表单参数直接测试连通性（不保存到数据库） */
  async testConnection(dto: ProviderConnectionRequest): Promise<ProviderTestResult> {
    const baseUrl = (dto.baseUrl || '').replace(/\/$/, '');
    if (!baseUrl) return { success: false, message: '请填写 Base URL' };

    // offline / preview 不需要 Key（零成本零网络）；只有 live 才要求 Key
    // 模式一 offline：纯本地格式校验，零成本零网络（对标 ArcReel 的离线检查）
    if (dto.mode === 'offline') {
      let parsed: URL;
      try {
        parsed = new URL(baseUrl);
      } catch {
        return { success: false, message: 'Base URL 格式非法' };
      }
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        return { success: false, message: 'Base URL 必须以 http(s):// 开头' };
      }
      return { success: true, message: '格式校验通过（未发起网络请求，零成本）' };
    }

    // 模式二 preview：渲染将发送的请求（含脱敏头），不触网不计费
    if (dto.mode === 'preview') {
      return {
        success: true,
        message: '请求预览已生成（未发送，零成本）',
        preview: {
          url: `${baseUrl}/models`,
          method: 'GET',
          headers: { Authorization: 'Bearer ***（已脱敏）' },
        },
      };
    }

    // 模式三 live：真实请求，需要 Key（表单优先，已保存次之）
    const { apiKey } = await this.resolveFormKey(dto);
    if (!apiKey) return { success: false, message: '请填写 API Key（或先保存供应商并添加 Key）' };

    const probed = await this.probeModels(baseUrl, apiKey);
    const { status, latencyMs, url } = probed;
    if (status === 200) {
      return { success: true, message: '连接成功', latencyMs, url };
    }
    if (status === 'network-error') {
      return {
        success: false,
        message: `网络错误: ${probed.error ?? '无法建立连接'}（请求地址 ${url}）`,
        latencyMs,
        url,
      };
    }
    if (status === 401 || status === 403) {
      return { success: false, message: `鉴权失败 (HTTP ${status})，请检查 API Key`, latencyMs, url };
    }
    if (status === 404 && dto.model?.trim()) {
      const r = await this.probeChat(baseUrl, apiKey, dto.model.trim(), Date.now() - latencyMs);
      return { ...r, url: r.url ?? url };
    }
    if (status === 404) {
      return { success: false, message: `接口不存在 (HTTP 404)，请求地址 ${url}；请检查 Base URL 路径；若为中转站请填写文本模型后重测`, latencyMs, url };
    }
    return { success: false, message: `连接异常 (HTTP ${status})（请求地址 ${url}）`, latencyMs, url };
  }

  /** 用表单参数获取该密钥下的模型列表 */
  async fetchModels(dto: ProviderConnectionRequest): Promise<ProviderFetchModelsResult> {
    const baseUrl = (dto.baseUrl || '').replace(/\/$/, '');
    if (!baseUrl) return { success: false, message: '请填写 Base URL' };
    const { apiKey } = await this.resolveFormKey(dto);
    if (!apiKey) return { success: false, message: '请填写 API Key（或先保存供应商并添加 Key）' };

    const probed = await this.probeModels(baseUrl, apiKey);
    if (probed.status === 200) {
      const models = probed.models.map((m) => ({
        ...m,
        kind: classifyModelId(m.id),
      }));
      return {
        success: true,
        models,
        latencyMs: probed.latencyMs,
        message: `共获取到 ${models.length} 个模型（${probed.url}），已按命名规律自动归类`,
      };
    }
    if (probed.status === 'network-error') {
      return { success: false, message: `网络错误: ${probed.error ?? '无法建立连接'}（请求地址 ${probed.url}）`, latencyMs: probed.latencyMs };
    }
    if (probed.status === 404) {
      return { success: false, message: `接口不存在 (HTTP 404)：该地址不支持 /models 列表（请求地址 ${probed.url}，中转站常见），请手动填写模型名`, latencyMs: probed.latencyMs };
    }
    return { success: false, message: `获取失败 (HTTP ${probed.status})`, latencyMs: probed.latencyMs };
  }

  /**
   * B3 按能力探活（移植 ToonFlow vendorConfig/modelTest 思想的轻量版）：
   * 用该供应商已配好的模型做一次最小真实调用（文本 1 问、图片 1 张、配音 1 句），
   * 结果直接返回不落库。视频太贵太慢不探，用成片任务验证。
   */
  async probe(
    id: string,
    capability: 'text' | 'image' | 'tts',
  ): Promise<{ ok: boolean; message: string; latencyMs?: number; url?: string; reply?: string }> {
    const rows = await this.db
      .select()
      .from(modelProviders)
      .where(eq(modelProviders.id, id))
      .limit(1);
    if (rows.length === 0) throw new NotFoundException('Provider 不存在');
    const provider = rows[0];
    if (!provider.enabled) return { ok: false, message: 'Provider 未启用' };
    const startTime = Date.now();
    try {
      if (capability === 'text') {
        if (!provider.textModel) return { ok: false, message: '未配置文本模型，无法探活' };
        const text = await this.gateway.generateText(
          { prompt: '请只回复“连通”二字', maxTokens: 8 },
          provider.name,
        );
        return {
          ok: true,
          message: '文本探活成功',
          latencyMs: Date.now() - startTime,
          reply: text.slice(0, 100),
        };
      }
      if (capability === 'image') {
        if (!provider.imageModel) return { ok: false, message: '未配置图片模型，无法探活' };
        const images = await this.gateway.generateImage(
          { prompt: '一只红色的苹果，极简，纯色背景', size: '512x512' },
          provider.name,
        );
        return {
          ok: true,
          message: '图片探活成功',
          latencyMs: Date.now() - startTime,
          url: images[0]?.url,
        };
      }
      if (!provider.ttsModel) return { ok: false, message: '未配置配音模型，无法探活' };
      const result = await this.gateway.generateTTS({ text: '连通性测试' }, provider.name);
      return {
        ok: true,
        message: '配音探活成功',
        latencyMs: Date.now() - startTime,
        url: result.audioUrl,
      };
    } catch (e) {
      return { ok: false, message: `探活失败：${(e as Error).message}`, latencyMs: Date.now() - startTime };
    }
  }

  async setDefault(id: string): Promise<ModelProvider> {    return this.db.transaction(async (tx) => {
      // 清除现有默认
      await tx
        .update(modelProviders)
        .set({ isDefault: false, updatedAt: new Date() })
        .where(eq(modelProviders.isDefault, true));

      const rows = await tx
        .update(modelProviders)
        .set({ isDefault: true, updatedAt: new Date() })
        .where(eq(modelProviders.id, id))
        .returning();
      if (rows.length === 0) throw new NotFoundException('Provider 不存在');
      return this.mapProvider(rows[0]);
    });
  }

  // ========== 多 Key 管理（对标 ArcReel：隔离项目/测试生产分离/轮换） ==========
  private maskKey(apiKey: string): string {
    if (!apiKey || apiKey.length <= 7) return '****';
    return `${apiKey.slice(0, 3)}****${apiKey.slice(-4)}`;
  }

  private mapKeyItem(row: typeof providerApiKeys.$inferSelect): ProviderApiKeyItem {
    return {
      id: row.id,
      label: row.label,
      maskedKey: this.maskKey(row.apiKey),
      isActive: row.isActive ?? false,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private async ensureProvider(id: string): Promise<void> {
    const rows = await this.db
      .select({ id: modelProviders.id })
      .from(modelProviders)
      .where(eq(modelProviders.id, id))
      .limit(1);
    if (rows.length === 0) throw new NotFoundException('Provider 不存在');
  }

  /** 某供应商的 Key 列表（Key 本体永不返回，只给脱敏标识） */
  async listKeys(providerId: string): Promise<ProviderApiKeyItem[]> {
    await this.ensureProvider(providerId);
    const rows = await this.db
      .select()
      .from(providerApiKeys)
      .where(eq(providerApiKeys.providerId, providerId))
      .orderBy(desc(providerApiKeys.createdAt));
    return rows.map((r) => this.mapKeyItem(r));
  }

  /** 新增 Key：轮换流程要求先加后验证再激活；若当前无生效 Key 则自动激活 */
  async addKey(
    providerId: string,
    dto: { label?: string; apiKey: string },
  ): Promise<ProviderApiKeyItem> {
    await this.ensureProvider(providerId);
    if (!dto.apiKey?.trim()) throw new BadRequestException('API Key 不能为空');
    const existing = await this.db
      .select({ id: providerApiKeys.id })
      .from(providerApiKeys)
      .where(
        and(
          eq(providerApiKeys.providerId, providerId),
          eq(providerApiKeys.isActive, true),
        ),
      )
      .limit(1);
    const rows = await this.db
      .insert(providerApiKeys)
      .values({
        providerId,
        label: dto.label?.trim() || 'Key',
        // W1 安全修复：落库前加密
        apiKey: encryptApiKey(dto.apiKey.trim()),
        isActive: existing.length === 0,
        createdAt: new Date(),
      })
      .returning();
    return this.mapKeyItem(rows[0]);
  }

  /** 激活某 Key（同供应商其他 Key 自动失效） */
  async activateKey(providerId: string, keyId: string): Promise<ProviderApiKeyItem[]> {
    await this.ensureProvider(providerId);
    const target = await this.db
      .select({ id: providerApiKeys.id })
      .from(providerApiKeys)
      .where(
        and(eq(providerApiKeys.id, keyId), eq(providerApiKeys.providerId, providerId)),
      )
      .limit(1);
    if (target.length === 0) throw new NotFoundException('Key 不存在');
    await this.db.transaction(async (tx) => {
      await tx
        .update(providerApiKeys)
        .set({ isActive: false })
        .where(eq(providerApiKeys.providerId, providerId));
      await tx
        .update(providerApiKeys)
        .set({ isActive: true })
        .where(eq(providerApiKeys.id, keyId));
    });
    return this.listKeys(providerId);
  }

  /** 删除 Key（归属双条件，防跨供应商误删） */
  async removeKey(providerId: string, keyId: string): Promise<void> {
    const rows = await this.db
      .delete(providerApiKeys)
      .where(
        and(eq(providerApiKeys.id, keyId), eq(providerApiKeys.providerId, providerId)),
      )
      .returning({ id: providerApiKeys.id });
    if (rows.length === 0) throw new NotFoundException('Key 不存在');
  }

  /** 生效 Key 数量（含主 Key 行）：供可用性判断 */
  async countActiveKeys(providerId: string, legacyHasKey: boolean): Promise<number> {
    const rows = await this.db
      .select({ id: providerApiKeys.id })
      .from(providerApiKeys)
      .where(
        and(
          eq(providerApiKeys.providerId, providerId),
          eq(providerApiKeys.isActive, true),
        ),
      );
    return rows.length + (legacyHasKey ? 1 : 0);
  }

  // 注意：返回给前端时 mask 掉 api_key（仅返回 hasApiKey 供可用性判断）
  private mapProvider(row: typeof modelProviders.$inferSelect): ModelProvider {
    const caps = (row.capabilities ?? {
      text: false,
      image: false,
      video: false,
      tts: false,
    }) as ModelCapabilities;

    return {
      id: row.id,
      name: row.name,
      providerType: row.providerType as ProviderType,
      isDefault: row.isDefault ?? false,
      // P1 修复：此前漏返 baseUrl，编辑页 baseUrl 永远空白；此处回显以便编辑
      baseUrl: row.baseUrl ?? undefined,
      textModel: row.textModel ?? undefined,
      imageModel: row.imageModel ?? undefined,
      videoModel: row.videoModel ?? undefined,
      ttsModel: row.ttsModel ?? undefined,
      ttsVoice: row.ttsVoice ?? undefined,
      promptPrefix: row.promptPrefix ?? undefined,
      modelParams: (row.modelParams as ProviderModelParams | null) ?? undefined,
      formatType: (row.formatType ?? 'openai') as FormatType,
      capabilities: caps,
      routingPriority: row.routingPriority ?? 10,
      enabled: row.enabled ?? true,
      hasApiKey: Boolean(row.apiKey),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
