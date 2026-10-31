/**
 * 一幕·YIMU AI 短剧创作平台 · 自由画布 —— 真实生成代理服务（已收敛接入统一计费与预算守卫）
 * 三通道 API（火山方舟 / OpenAI 兼容中转 / 自定义）统一调用：
 *   text  → POST {baseUrl}/chat/completions
 *   image → POST {baseUrl}/images/generations（参考图走 image 字段，dataURL 直传）
 *   video → 自适应 volcengine_ark (/contents/generations/tasks)、agnes 与 OpenAI 兼容端点 (/videos/generations | /video/generations)
 *   audio → POST {baseUrl}/audio/speech（返回 WAV → 落盘或 base64 dataURL）
 * 整改增强：
 *   1. 生成前强制执行 BudgetCapService.assertAllowed() 月度预算上限检查与内容合规过滤
 *   2. 生成成功后自动通过 BillingService 计算真实费用（视频按时长阶梯折算），写入 generation_jobs 与 projects.total_cost
 *   3. 视频轮询超时保留 taskId 返回前端，支持断点续轮询，杜绝重试重复扣费
 */
import { Injectable, Logger, Inject } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { eq, and, sql } from 'drizzle-orm';
import { generationJobs, modelProviders, projects } from '../../database/schema';
import { decryptApiKey } from '../../common/crypto.util';
import { BudgetCapService } from '../generation/budget-cap.service';
import { BillingService } from '../billing/billing.service';
import { ModelGatewayService } from '../generation/model-gateway.service';

export interface P3RefInput {
  id?: string;
  title?: string;
  kind?: string;
  text?: string;
  url?: string; // 图片/视频/音频 dataURL 或 http(s) URL
}

export interface P3StyleInput {
  name: string;
  prompt: string; // 正向风格词
  negative: string; // 负面风格词
}

export interface P3GenerateRequest {
  type: 'text' | 'image' | 'video' | 'audio';
  prompt: string;
  negativePrompt?: string;
  size?: string; // '9:16' | '16:9' | '1:1' | '3:4' | '4:3' | '21:9'
  model?: string; // 指定模型（覆盖 provider 默认）
  refs?: P3RefInput[]; // 上游自动参考 + 手动参考
  style?: P3StyleInput | null;
  voice?: string;
  duration?: number;
  /** 可选关联项目 ID（传入后自动记入项目账单与任务表） */
  projectId?: string;
  /** 视频续轮询任务 ID（超时后再次查询同一远端任务，不重复创建扣费） */
  taskId?: string;
}

export interface P3GenerateResult {
  ok: boolean;
  message?: string;
  mediaKind?: 'image' | 'video' | 'audio';
  /** 文本产物 */
  text?: string;
  /** 图片/视频产物（远程 URL 或 dataURL） */
  url?: string;
  model?: string;
  provider?: string;
  /** 远端视频任务 ID（轮询超时时返回，供前端无损续查） */
  taskId?: string;
  /** 本次生成结算费用（元） */
  costCny?: number;
}

/** 画幅比例 → 像素（OpenAI 兼容 size 参数） */
const RATIO_SIZES: Record<string, string> = {
  '9:16': '1080x1920',
  '16:9': '1920x1080',
  '1:1': '1080x1080',
  '3:4': '1080x1440',
  '4:3': '1440x1080',
  '21:9': '2560x1080',
};

/** 基础合规高危词拦截正则（平台运营合规守卫） */
const PROHIBITED_PROMPT_PATTERN = /(赌博网站|六合彩|冰毒|海洛因|枪支买卖|炸药制作|恐怖主义袭击|儿童色情)/i;

@Injectable()
export class Pavo3Service {
  private readonly logger = new Logger(Pavo3Service.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    private readonly budgetCap: BudgetCapService,
    private readonly billingService: BillingService,
    private readonly modelGateway: ModelGatewayService,
  ) {}

  /** 当前是否已配置可用 Provider（前端生成前检测） */
  async status(): Promise<{ configured: boolean; providerName?: string }> {
    const p = await this.findDefaultProvider();
    if (!p || !p.apiKey || !p.baseUrl) return { configured: false };
    return { configured: true, providerName: p.name };
  }

  private async findDefaultProvider() {
    const rows = await this.db
      .select()
      .from(modelProviders)
      .where(and(eq(modelProviders.enabled, true)))
      .limit(20);
    if (rows.length === 0) return null;
    return rows.find((r) => r.isDefault) ?? rows[0];
  }

  async generate(req: P3GenerateRequest): Promise<P3GenerateResult> {
    // 1. 内容安全合规校验
    if (PROHIBITED_PROMPT_PATTERN.test(req.prompt || '')) {
      return {
        ok: false,
        message: '提示词包含平台合规禁止的高危违规内容，请修改后再试',
      };
    }

    // 2. 月度预算上限强制守卫（修复 Pavo3 绕过预算管控漏洞）
    try {
      await this.budgetCap.assertAllowed();
    } catch (err) {
      return {
        ok: false,
        message: (err as Error).message || '月度生成预算已达上限',
      };
    }

    const provider = await this.findDefaultProvider();
    if (!provider) {
      return {
        ok: false,
        message:
          '未配置模型供应商：请先在「设置 → 模型服务」中添加并启用 API（火山方舟 / OpenAI 兼容中转 / 自定义）',
      };
    }
    if (!provider.apiKey || !provider.baseUrl) {
      return {
        ok: false,
        message: `供应商「${provider.name}」未配置完整的 API Key 或 Base URL`,
      };
    }

    const baseUrl = provider.baseUrl.replace(/\/+$/, '');
    const apiKey = decryptApiKey(provider.apiKey) ?? '';
    const timeoutMs = 180_000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const signal = controller.signal;

    try {
      let result: P3GenerateResult;
      switch (req.type) {
        case 'text':
          result = await this.generateText(provider, baseUrl, apiKey, req, signal);
          break;
        case 'image':
          result = await this.generateImage(provider, baseUrl, apiKey, req, signal);
          break;
        case 'video':
          result = await this.generateVideo(provider, baseUrl, apiKey, req, signal);
          break;
        case 'audio':
          result = await this.generateAudio(provider, baseUrl, apiKey, req, signal);
          break;
        default:
          return { ok: false, message: `不支持的生成类型: ${req.type}` };
      }

      // 3. 真实生成成功后，统一写入计费流水与 generation_jobs 表（杜绝计费漏损）
      if (result.ok) {
        const costCny = await this.recordBillingAndJob(req, provider.name, result);
        result.costCny = costCny;
      }
      return result;
    } catch (error) {
      if ((error as Error)?.name === 'AbortError') {
        return { ok: false, message: '请求超时（180s），请检查网络或稍后重试' };
      }
      this.logger.error(`pavo3 generate failed: ${(error as Error).message}`);
      return { ok: false, message: `生成调用失败：${(error as Error).message}` };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * 登记画布生成任务并按档位/时长阶梯结算成本。
   */
  private async recordBillingAndJob(
    req: P3GenerateRequest,
    providerName: string,
    result: P3GenerateResult,
  ): Promise<number> {
    try {
      const jobType = req.type === 'audio' ? 'tts' : req.type;
      const basePrice = await this.billingService.getUnitPrice(jobType, 'balanced');
      // 视频按时长阶梯计费（基准 5s，每多 5s 按比例递增）
      const durationFactor =
        jobType === 'video' && req.duration && req.duration > 5
          ? Math.max(1, Number((req.duration / 5).toFixed(2)))
          : 1;
      const cost = Number((basePrice * durationFactor).toFixed(4));
      const validUuid =
        req.projectId &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(req.projectId)
          ? req.projectId
          : undefined;

      await this.db.insert(generationJobs).values({
        projectId: validUuid,
        jobType,
        targetType: 'canvas',
        status: 'succeeded',
        progress: 100,
        providerName,
        modelName: result.model,
        inputData: {
          prompt: req.prompt.slice(0, 500),
          size: req.size,
          duration: req.duration,
        },
        outputData: {
          url: result.url?.startsWith('data:') ? '[inline-data-url]' : result.url,
          text: result.text?.slice(0, 500),
        },
        cost: String(cost),
        startedAt: new Date(),
        completedAt: new Date(),
      });

      if (validUuid && cost > 0) {
        await this.db
          .update(projects)
          .set({
            totalCost: sql`COALESCE(${projects.totalCost}, 0) + ${cost}`,
            updatedAt: new Date(),
          })
          .where(eq(projects.id, validUuid))
          .catch(() => {});
      }
      return cost;
    } catch (e) {
      this.logger.warn(`pavo3 计费落盘失败（不影响返回结果）: ${(e as Error).message}`);
      return 0;
    }
  }

  /** 组装提示词：用户词 + 风格词 + 上游文本参考 */
  private buildPrompt(req: P3GenerateRequest): string {
    const parts: string[] = [];
    if (req.style?.prompt) parts.push(`[风格: ${req.style.prompt}]`);
    if (req.prompt.trim()) parts.push(req.prompt.trim());
    const textRefs = (req.refs ?? [])
      .filter((r) => r.kind === 'text' && r.text)
      .map((r) => r.text)
      .join('\n');
    if (textRefs) parts.push(`[参考文本]\n${textRefs}`);
    return parts.join('\n');
  }

  private pickImageRef(req: P3GenerateRequest): string | undefined {
    const ref = (req.refs ?? []).find(
      (r) => r.url && (r.kind === 'image' || r.kind === 'video' || r.kind === 'director'),
    );
    return ref?.url;
  }

  /** 返回全部图片参考的 url 数组（按前端传入顺序，用于首尾帧等多图场景） */
  private pickImageRefs(req: P3GenerateRequest): string[] {
    return (req.refs ?? [])
      .filter((r) => r.url && (r.kind === 'image' || r.kind === 'video' || r.kind === 'director'))
      .map((r) => r.url!);
  }

  private async jsonFetch(url: string, options: RequestInit): Promise<any> {
    const res = await fetch(url, options);
    const raw = await res.text();
    let data: any = null;
    try {
      data = raw ? JSON.parse(raw) : null;
    } catch {
      data = raw;
    }
    if (!res.ok) {
      const msg =
        (data && (data.error?.message || data.message)) ||
        `HTTP ${res.status}`;
      throw new Error(`${msg}`);
    }
    return data;
  }

  private async generateText(
    provider: any,
    baseUrl: string,
    apiKey: string,
    req: P3GenerateRequest,
    signal?: AbortSignal,
  ): Promise<P3GenerateResult> {
    const model = req.model || provider.textModel || 'gpt-4o-mini';
    const prompt = this.buildPrompt(req);
    const data = await this.jsonFetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content:
              '你是「一幕·YIMU AI 短剧创作平台」的创作助手。根据用户描述生成可直接使用的短剧内容：' +
              '文本生成请输出结构化 Markdown（分镜/剧本/角色设定等）；图片提示词生成请输出精炼的英文图像提示词；' +
              '回答使用与用户提问相同的语言。',
          },
          { role: 'user', content: prompt },
        ],
        stream: false,
      }),
      signal,
    });
    const text = data?.choices?.[0]?.message?.content?.trim();
    if (!text) return { ok: false, message: '模型未返回内容' };
    return { ok: true, text, model, provider: provider.name };
  }

  private async generateImage(
    provider: any,
    baseUrl: string,
    apiKey: string,
    req: P3GenerateRequest,
    signal?: AbortSignal,
  ): Promise<P3GenerateResult> {
    const model = req.model || provider.imageModel || 'seedream-5.0-pro';
    const prompt = this.buildPrompt(req);
    const body: Record<string, unknown> = {
      model,
      prompt,
      n: 1,
      response_format: 'url',
      size: RATIO_SIZES[req.size ?? '9:16'] ?? '1080x1920',
    };
    const refImage = this.pickImageRef(req);
    if (refImage) body.image = refImage; // 参考图（dataURL 或 URL）
    if (req.negativePrompt || req.style?.negative) {
      body.negative_prompt = [req.negativePrompt, req.style?.negative].filter(Boolean).join(', ');
    }
    const data = await this.jsonFetch(`${baseUrl}/images/generations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal,
    });
    const item = data?.data?.[0];
    const url = item?.url || (item?.b64_json ? `data:image/png;base64,${item.b64_json}` : undefined);
    if (!url) return { ok: false, message: '图像接口未返回结果' };
    return { ok: true, url, mediaKind: 'image', model, provider: provider.name };
  }

  private async generateVideo(
    provider: any,
    baseUrl: string,
    apiKey: string,
    req: P3GenerateRequest,
    signal?: AbortSignal,
  ): Promise<P3GenerateResult> {
    const model = req.model || provider.videoModel || 'seedance-2.5';
    const formatType = String(provider.formatType || 'openai');

    // Agnes 专用通道直接复用 ModelGatewayService
    if (formatType === 'agnes') {
      const refImages = this.pickImageRefs(req);
      const created = req.taskId
        ? { taskId: req.taskId }
        : await this.modelGateway.generateVideo(
            {
              prompt: this.buildPrompt(req),
              model,
              duration: req.duration ?? 5,
              size: RATIO_SIZES[req.size ?? '9:16'] ?? '720P',
              imageUrl: refImages[0],
              lastFrameUrl: refImages[1],
            },
            provider.name,
          );
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const polled = await this.modelGateway.pollVideoTask(created.taskId, provider.name);
        if (polled.status === 'succeeded' && typeof polled.outputData?.url === 'string') {
          return {
            ok: true,
            url: polled.outputData.url,
            mediaKind: 'video',
            model,
            provider: provider.name,
            taskId: created.taskId,
          };
        }
        if (polled.status === 'failed') {
          return { ok: false, message: polled.errorMessage || 'Agnes 视频生成失败', taskId: created.taskId };
        }
      }
      return {
        ok: false,
        taskId: created.taskId,
        message: `视频任务排队中（已等待 40s，任务 ID: ${created.taskId}），再次点击发送可继续查询进度而不重复扣费`,
      };
    }

    // 确定提交与轮询端点（兼容 volcengine_ark /contents/generations/tasks 与 OpenAI /videos/generations | /video/generations）
    const isArk = formatType === 'volcengine_ark';
    const createEndpoint = isArk ? `${baseUrl}/contents/generations/tasks` : `${baseUrl}/videos/generations`;

    let taskId = req.taskId;
    if (!taskId) {
      const prompt = this.buildPrompt(req);
      const body: Record<string, unknown> = {
        model,
        prompt,
        response_format: 'url',
        size: isArk ? '720p' : RATIO_SIZES[req.size ?? '9:16'] ?? '1080x1920',
      };
      if (req.duration) body.duration = req.duration;
      const refImage = this.pickImageRef(req);
      if (refImage) {
        if (isArk) body.image_url = refImage;
        else body.image = refImage;
      }
      const refImages = this.pickImageRefs(req);
      if (refImages.length > 1) {
        body.image_tail = refImages[1];
      }

      let data: any;
      try {
        data = await this.jsonFetch(createEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify(body),
          signal,
        });
      } catch (e) {
        // 若 /videos/generations 404，自动回退尝试单数 /video/generations（对齐 ModelGatewayService）
        if (!isArk && (e as Error).message.includes('404')) {
          data = await this.jsonFetch(`${baseUrl}/video/generations`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
            body: JSON.stringify(body),
            signal,
          });
        } else {
          throw e;
        }
      }

      const item = data?.data?.[0];
      const directUrl =
        item?.url ||
        data?.url ||
        data?.output?.video_url ||
        (item?.b64_json ? `data:video/mp4;base64,${item.b64_json}` : undefined);
      if (directUrl) {
        return { ok: true, url: directUrl, mediaKind: 'video', model, provider: provider.name };
      }
      taskId = item?.id || data?.id || data?.task_id || data?.taskId;
    }

    if (taskId) {
      const pollBase = isArk ? `${baseUrl}/contents/generations/tasks/${taskId}` : `${baseUrl}/videos/generations/${taskId}`;
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        try {
          let poll: any;
          try {
            poll = await this.jsonFetch(pollBase, {
              method: 'GET',
              headers: { Authorization: `Bearer ${apiKey}` },
              signal,
            });
          } catch (innerErr) {
            if (!isArk && (innerErr as Error).message.includes('404')) {
              poll = await this.jsonFetch(`${baseUrl}/video/generations/${taskId}`, {
                method: 'GET',
                headers: { Authorization: `Bearer ${apiKey}` },
                signal,
              });
            } else {
              throw innerErr;
            }
          }
          const it = poll?.data?.[0] || poll;
          const st = it?.status || it?.task_status || it?.output?.status;
          if (st === 'succeeded' || st === 'completed' || st === 'success') {
            const u =
              it?.url ||
              it?.video_url ||
              it?.output?.video_url ||
              it?.output?.url ||
              (it?.b64_json ? `data:video/mp4;base64,${it.b64_json}` : undefined);
            if (u) {
              return { ok: true, url: u, mediaKind: 'video', model, provider: provider.name, taskId };
            }
          }
          if (st === 'failed' || st === 'error' || it?.error) {
            throw new Error(it?.error?.message || '视频生成任务失败');
          }
        } catch (e) {
          if ((e as Error).message.includes('视频生成任务失败')) throw e;
          if ((e as Error).message.includes('404') || (e as Error).message.includes('not found')) break;
        }
      }
      return {
        ok: false,
        taskId,
        message: `视频任务排队中（已等待 40s，任务 ID: ${taskId}），请稍后重试继续等待（已保留任务 ID，不会重复扣费）`,
      };
    }
    return { ok: false, message: '视频接口未返回结果' };
  }

  private async generateAudio(
    provider: any,
    baseUrl: string,
    apiKey: string,
    req: P3GenerateRequest,
    signal?: AbortSignal,
  ): Promise<P3GenerateResult> {
    const model = req.model || provider.ttsModel || 'tts-1';
    const res = await fetch(`${baseUrl}/audio/speech`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        input: req.prompt,
        voice: req.voice || provider.ttsVoice || 'alloy',
        response_format: 'wav',
      }),
      signal,
    });
    if (!res.ok) {
      const raw = await res.text();
      throw new Error(`TTS HTTP ${res.status}: ${raw.slice(0, 160)}`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const b64 = buf.toString('base64');
    return {
      ok: true,
      url: `data:audio/wav;base64,${b64}`,
      mediaKind: 'audio',
      model,
      provider: provider.name,
    };
  }
}
