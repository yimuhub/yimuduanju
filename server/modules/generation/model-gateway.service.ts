import {
  Injectable,
  Inject,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { modelProviders } from '@server/database/schema';
import { providerApiKeys } from '@server/database/billing.schema';
import { eq, and, desc } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { deflateSync } from 'zlib';
import { spawn } from 'child_process';
import { mkdir } from 'fs/promises';
import { join } from 'path';
// 修复（分层）：uploadDir 直接从工具模块导入。
// 旧写法 '../assets/uploads.controller' 依赖 Controller 里的再导出，
// 使网关在模块加载期就被迫拉起整条 Controller → Service → DI 依赖链。
import { uploadDir } from '../assets/upload-dir';
import type { ProviderType, FormatType, ModelCapabilities } from '@shared/api.interface';
// W1 安全修复：API Key 落库为 AES-256-GCM 密文，使用前解密（存量明文兼容）。
// 修复：本文件全部改用 tryDecryptApiKey —— 它处在供应商列表 / 连通性测试等读路径上，
// 密钥缺失或 GCM 认证失败（密钥轮换、密文损坏）时应返回 null 让调用方给出
// 「未配置 API Key」这类可读错误，而不是抛未捕获异常把所有 Provider 接口打成 500。
import { tryDecryptApiKey } from '../../common/crypto.util';

interface TextGenerateParams {
  prompt: string;
  systemPrompt?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

interface ImageGenerateParams {
  prompt: string;
  model?: string;
  size?: string;
  n?: number;
  negativePrompt?: string;
  /** 角色/场景参考图（用于保持跨镜头角色与空间一致性） */
  referenceImageUrl?: string;
  referenceImages?: string[];
  /** 固定随机种子（用于锁定角色/画风生成稳定性） */
  seed?: number;
}

interface VideoGenerateParams {
  prompt: string;
  model?: string;
  duration?: number;
  size?: string;
  imageUrl?: string;
  /**
   * 参考视频 URL（白模直喂）：仅当供应商 capabilities.videoReference 为 true
   * 且为公网可拉取的 http(s) 地址时透传；本地 /uploads 与 data: 一律不发送。
   */
  referenceVideoUrl?: string;
  /** 尾帧 URL（Agnes keyframe 模式用；非公网地址自动忽略） */
  lastFrameUrl?: string;
}

interface TTSGenerateParams {
  text: string;
  model?: string;
  voice?: string;
  speed?: number;
}

interface VideoPollResult {
  status: 'running' | 'succeeded' | 'failed' | 'rate_limit';
  progress?: number;
  outputData?: Record<string, unknown>;
  errorMessage?: string;
}

/** mock PNG 编码用：CRC32 查表（模块级懒加载，仅首次生成） */
const MockPngCrc = {
  _table: null as number[] | null,
  table(): number[] {
    if (!this._table) {
      const t: number[] = [];
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        t[n] = c >>> 0;
      }
      this._table = t;
    }
    return this._table;
  },
};

interface ProviderRecord {
  id: string;
  name: string;
  providerType: string;
  isDefault: boolean;
  baseUrl: string | null;
  apiKey: string | null;
  textModel: string | null;
  imageModel: string | null;
  videoModel: string | null;
  ttsModel: string | null;
  ttsVoice: string | null;
  formatType: string;
  capabilities: unknown;
  routingPriority: number;
  enabled: boolean;
  promptPrefix: string | null;
  modelParams: { videoDurations?: number[]; videoSizes?: string[]; imageSizes?: string[] } | null;
}

/**
 * 外部 HTTP 超时上限。
 * P0 修复：网关原本所有 fetch 都没有任何超时（全文件 grep AbortSignal /
 * AbortController / setTimeout 为 0 命中），而 export.service 与 pavo3.service
 * 都已经用了 AbortSignal.timeout —— 正确写法项目里有，网关漏了。
 * 后果：上游半开连接或假死时请求永久悬挂；BullMQ 并发默认只有 2
 * （JOB_WORKER_CONCURRENCY），两个挂死请求就能把整条产线堵死，
 * 且任务停在 running 无人回收（recoverOrphanedRunning 只在启动时跑一次）。
 */
const DEFAULT_HTTP_TIMEOUT_MS = 60_000;
/** 视频建任务/轮询：上游排队时间较长，单独给更宽的上限 */
const VIDEO_HTTP_TIMEOUT_MS = 120_000;

@Injectable()
export class ModelGatewayService {
  private readonly logger = new Logger(ModelGatewayService.name);

  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase) {}

  // ========== Text Generation ==========
  /**
   * 带 /v1 回退的 POST（用户常漏写 /v1，如填 http://host:8787）：
   * 先按原样打，404 且基址不以 /v1 结尾则补 /v1 再打一次。
   * 404 不产生费用，重试安全；返回最终 response 与实际 URL。
   */
  /**
   * 统一的外部 HTTP 入口：带超时的 fetch。
   * P0 修复见 DEFAULT_HTTP_TIMEOUT_MS 处的说明。
   */
  private async fetchWithTimeout(
    url: string,
    init: RequestInit = {},
    timeoutMs: number = DEFAULT_HTTP_TIMEOUT_MS,
  ): Promise<Response> {
    try {
      return await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      // 把超时翻译成可读错误：原生 TimeoutError 的 message 只有
      // "The operation was aborted due to timeout"，不含 URL 与上限，
      // 排障时看不出是哪一跳挂了。
      if ((e as { name?: string } | null)?.name === 'TimeoutError') {
        throw new Error(`请求超时（>${timeoutMs}ms）：${url}`);
      }
      throw e;
    }
  }

  private async postWithV1Fallback(
    baseUrl: string,
    endpoint: string,
    init: RequestInit,
  ): Promise<{ response: Response; url: string }> {
    const first = `${baseUrl}${endpoint}`;
    // eslint-disable-next-line no-await-in-loop
    let response = await this.fetchWithTimeout(first, init);
    if (response.status !== 404 || /\/v1$/.test(baseUrl)) {
      return { response, url: first };
    }
    // 修复（连接泄漏）：重发前必须取消第一个响应的 body，
    // 否则 undici 不会把连接归还连接池，404 回退每走一次就漏一条连接。
    await response.body?.cancel().catch(() => {});
    const second = `${baseUrl}/v1${endpoint}`;
    this.logger.log(`接口 404，自动补 /v1 重试：${second}`);
    // 说明：这里重试的是非幂等 POST。404 表示路由未命中、请求体未被业务处理，
    // 因此正常情况下不会重复下单；但若 404 由中间代理产生而源站已受理，
    // 仍可能重复扣费。上游若支持幂等键，请在 init.headers 带 Idempotency-Key。
    // eslint-disable-next-line no-await-in-loop
    response = await this.fetchWithTimeout(second, init);
    return { response, url: second };
  }

  // 修复（死代码 + 竞态）：删除 lastTextUsage 字段与 takeLastTextUsage()。
  // 全仓 grep 确认 takeLastTextUsage 零调用方（唯一命中就是它自己的定义），
  // 而 lastTextUsage 是单例上的可变状态，generateTextWithUsage 每次都写它，
  // 并发 >1 时用量会串到别的任务上。调用方一律使用返回的 { text, usage } 元组。

  /**
   * 并发安全的文本生成方法：直接返回 { text, usage }，不在单例上共享可变状态。
   */
  async generateTextWithUsage(
    params: TextGenerateParams,
    providerName?: string,
  ): Promise<{
    text: string;
    usage: { model: string; inputTokens: number; outputTokens: number } | null;
  }> {
    const provider = await this.getProvider(providerName, 'text');
    // P2-3 mock 通道（免 Key）：文本按规则产出可解析的剧本 JSON，
    // 与 story-skills.parseScriptJson 对齐，让"无 Key 演练"能真实走通全流程
    const model = params.model ?? provider.textModel;
    if (this.isMockProvider(provider)) {
      const text = this.mockTextResponse(params.prompt, model);
      return {
        text,
        usage: {
          model: model ?? 'mock-text',
          inputTokens: Math.ceil(params.prompt.length / 2),
          outputTokens: Math.ceil(text.length / 2),
        },
      };
    }
    const apiKey = provider.apiKey;
    if (!apiKey) {
      throw new BadRequestException('Provider 未配置 API Key');
    }

    if (!model) {
      throw new BadRequestException('未配置文本模型');
    }

    // B2 附加提示词：供应商自愿填写，拼进 system（不污染用户正文）
    const prefix = (provider.promptPrefix ?? '').trim();
    const base = this.normalizeBaseUrl(provider.baseUrl);
    const body = {
      model,
      messages: [
        ...(prefix ? [{ role: 'system', content: prefix }] : []),
        ...(params.systemPrompt
          ? [{ role: 'system', content: params.systemPrompt }]
          : []),
        { role: 'user', content: params.prompt },
      ],
      temperature: params.temperature ?? 0.7,
      ...(params.maxTokens ? { max_tokens: params.maxTokens } : {}),
    };

    try {
      const { response, url } = await this.postWithV1Fallback(base, '/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new BadRequestException(
          `文本生成失败 (${response.status}, ${url}): ${errText.slice(0, 200)}`,
        );
      }

      const data = await response.json();
      let usageObj: { model: string; inputTokens: number; outputTokens: number } | null = null;
      const usage = data.usage as { prompt_tokens?: unknown; completion_tokens?: unknown } | undefined;
      if (usage && (typeof usage.prompt_tokens === 'number' || typeof usage.completion_tokens === 'number')) {
        usageObj = {
          model,
          inputTokens: typeof usage.prompt_tokens === 'number' ? usage.prompt_tokens : 0,
          outputTokens: typeof usage.completion_tokens === 'number' ? usage.completion_tokens : 0,
        };
      }
      const text =
        data.choices?.[0]?.message?.content ??
        data.output?.text ??
        JSON.stringify(data);
      return { text, usage: usageObj };
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      this.logger.error(`文本生成请求失败: ${(error as Error).message}`);
      throw new BadRequestException(
        `文本生成请求失败: ${(error as Error).message}`,
      );
    }
  }

  async generateText(params: TextGenerateParams, providerName?: string): Promise<string> {
    const { text } = await this.generateTextWithUsage(params, providerName);
    return text;
  }

  // ========== Image Generation ==========
  async generateImage(
    params: ImageGenerateParams,
    providerName?: string,
  ): Promise<{ url: string; width?: number; height?: number }[]> {
    const provider = await this.getProvider(providerName, 'image');
    // P2-3 mock 通道（免 Key）：按 prompt 生成确定性占位 PNG（data URL）
    if (this.isMockProvider(provider)) {
      const n = Math.max(1, Math.min(4, params.n ?? 1));
      const images = Array.from({ length: n }, (_, i) => ({
        url: this.mockPngDataUrl(`${params.prompt}#${i}`, 384, 384),
        width: 384,
        height: 384,
      }));
      this.logger.log(`mock 图片生成 ${images.length} 张（占位 PNG，不消费 Key）`);
      return images;
    }
    const apiKey = provider.apiKey;
    if (!apiKey) {
      throw new BadRequestException('Provider 未配置 API Key');
    }

    const model = params.model ?? provider.imageModel;
    if (!model) {
      throw new BadRequestException('未配置图片模型');
    }

    const base = this.normalizeBaseUrl(provider.baseUrl);
    // B2 附加提示词：逗号拼进正文（图片接口无 system 位）
    const prefix = (provider.promptPrefix ?? '').trim();
    const refImg =
      params.referenceImageUrl ||
      (Array.isArray(params.referenceImages) && params.referenceImages.length > 0
        ? params.referenceImages[0]
        : undefined);
    const body = {
      model,
      prompt: prefix ? `${prefix}, ${params.prompt}` : params.prompt,
      size: params.size ?? '1024x1024',
      n: params.n ?? 1,
      // CDN 不可达时兜底：能回 b64 就不依赖 .cn 拉文件
      response_format: 'b64_json',
      ...(params.negativePrompt
        ? { negative_prompt: params.negativePrompt }
        : {}),
      ...(refImg ? { image: refImg } : {}),
      ...(typeof params.seed === 'number' && Number.isFinite(params.seed)
        ? { seed: Math.floor(params.seed) }
        : {}),
    };

    try {
      const { response, url } = await this.postWithV1Fallback(base, '/images/generations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new BadRequestException(
          `图片生成失败 (${response.status}, ${url}): ${errText.slice(0, 200)}`,
        );
      }

      const data = await response.json();
      const images = data.data ?? [];
      return images.map(
        (img: { url: string; b64_json: string; width?: number; height?: number }) => ({
          // P1 修复：b64_json 需拼 data: 前缀前端才能直接渲染；已是 data:/http 直接透传
          // || 而非 ??：Agnes 会回 url:"" + b64_json，空串会吞掉兜底
          url:
            img.url ||
            (img.b64_json
              ? img.b64_json.startsWith('data:')
                ? img.b64_json
                : `data:image/png;base64,${img.b64_json}`
              : ''),
          width: img.width,
          height: img.height,
        }),
      );
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      this.logger.error(`图片生成请求失败: ${(error as Error).message}`);
      throw new BadRequestException(
        `图片生成请求失败: ${(error as Error).message}`,
      );
    }
  }

  // ========== Video Generation ==========
  /**
   * P2-3 mock 视频通道（移植 forge --backend mock 思想）：
   * formatType='mock' 的供应商无需 Key，任务秒级成功，输出 URL 直接复用
   * 输入首帧/白模（离线剪辑时序占位），outputData 置 mock:true。
   * 用途：无 Key 全链路冒烟（建任务→轮询→回写→导出合成），绝不冒充真实生成。
   */
  private readonly mockVideoTasks = new Map<string, { url: string; at: number }>();

  async generateVideo(
    params: VideoGenerateParams,
    providerName?: string,
  ): Promise<{ taskId: string; status: string }> {
    const provider = await this.getProvider(providerName, 'video');
    const formatType = provider.formatType as FormatType;
    if (formatType === 'mock') {
      const taskId = `mock-${randomUUID()}`;
      // 占位输出：优先用首帧合成本地 mp4（静音轨，ffmpeg 可直接拼接进成片）；
      // ffmpeg 不可用/无首帧时回退白模/首帧 URL（调用方按 references[1]/[0] 传入亦可）
      const standIn = params.referenceVideoUrl || params.imageUrl || '';
      const mp4Url = await this.mockVideoMp4(taskId, { ...params, duration: params.duration ?? 8 }).catch(() => null);
      const url = mp4Url ?? standIn;
      this.mockVideoTasks.set(taskId, { url, at: Date.now() });
      if (this.mockVideoTasks.size > 200) {
        const oldest = [...this.mockVideoTasks.keys()][0];
        this.mockVideoTasks.delete(oldest);
      }
      this.logger.log(`mock 视频任务已创建 ${taskId}（${mp4Url ? '占位 mp4' : '占位 URL'}，不消费 Key）`);
      return { taskId, status: 'running' };
    }
    const apiKey = provider.apiKey;
    if (!apiKey) {
      throw new BadRequestException('Provider 未配置 API Key');
    }

    const model = params.model ?? provider.videoModel;
    if (!model) {
      throw new BadRequestException('未配置视频模型');
    }

    // V9 能力校验：声明了支持列表就按表 fail fast，不浪费一次调用
    const vparams = (provider.modelParams ?? {}) as {
      videoDurations?: unknown;
      videoSizes?: unknown;
    };
    const wantDuration = params.duration ?? 8;
    let effectiveDuration = wantDuration;
    if (Array.isArray(vparams.videoDurations) && vparams.videoDurations.length > 0) {
      const allowed = vparams.videoDurations.map(Number).filter(Number.isFinite);
      // 修复（fail-open）：声明了 videoDurations 但条目全部非数字时 allowed 为空，
      // 旧实现的 `allowed.length > 0 &&` 会直接跳过校验 —— 配置写错等于没有白名单。
      // 现在显式记 error 日志，让「白名单失效」可见，而不是静默放行任意时长。
      if (allowed.length === 0) {
        this.logger.error(
          `Provider ${provider.name} 的 modelParams.videoDurations 全部非法` +
            `（${JSON.stringify(vparams.videoDurations).slice(0, 120)}），本次不做时长校验`,
        );
      } else if (!allowed.includes(wantDuration)) {
        // 模型只支持离散时长（如 5/10s）时就近贴合，而不是整单失败：
        // 8s 默认时长在 5/10 能力表上会落到 10s，保持剧情完整优先。
        effectiveDuration = allowed.reduce(
          (best, d) => (Math.abs(d - wantDuration) < Math.abs(best - wantDuration) ? d : best),
          allowed[0],
        );
        this.logger.warn(
          `视频时长 ${wantDuration}s 不被 ${provider.name} 支持，自动贴合到 ${effectiveDuration}s` +
            `（支持 ${allowed.join('/')}s）`,
        );
      }
    }
    const wantSize = params.size;
    if (
      wantSize &&
      Array.isArray(vparams.videoSizes) &&
      vparams.videoSizes.length > 0 &&
      !vparams.videoSizes.includes(wantSize)
    ) {
      throw new BadRequestException(
        `该供应商视频尺寸仅支持 ${vparams.videoSizes.join('/')}，当前 ${wantSize}`,
      );
    }

    const baseUrl = this.normalizeBaseUrl(provider.baseUrl);

    // R2V 直喂门控：默认关闭（capabilities.videoReference 未开启时 body 与旧版完全一致）；
    // 本地相对路径与 data: URL 云端拉不到，直接丢弃并记日志，不伪装发送。
    const refUrl = (params.referenceVideoUrl ?? '').trim();
    const canR2v = (provider.capabilities as { videoReference?: boolean } | undefined)?.videoReference === true;
    const sendRef = canR2v && /^https?:\/\//i.test(refUrl);
    if (refUrl && !sendRef) {
      this.logger.warn(
        `参考视频未发送（${!canR2v ? '供应商未开启 videoReference' : '非公网 URL'}）：${refUrl.slice(0, 80)}`,
      );
    }

    let url: string;
    let body: Record<string, unknown>;
    // B2 附加提示词：视频正文前另起一段（不破坏运镜事实块）
    const vprefix = (provider.promptPrefix ?? '').trim();
    const withPrefix = (p: string) => (vprefix ? `${vprefix}\n${p}` : p);

    // Agnes 专用通道（测试版）：官方双接口，mode 按参考素材自动映射
    if (formatType === 'agnes') {
      return this.createAgnesVideo(provider, { ...params, duration: effectiveDuration }, withPrefix);
    }

    if (formatType === 'volcengine_ark') {
      // 火山方舟格式
      url = `${baseUrl}/contents/generations/tasks`;
      body = {
        model,
        prompt: withPrefix(params.prompt),
        duration: effectiveDuration,
        size: params.size ?? '720p',
        ...(params.imageUrl ? { image_url: params.imageUrl } : {}),
        ...(sendRef ? { reference_video_url: refUrl } : {}),
      };
    } else {
      // OpenAI 兼容格式
      url = `${baseUrl}/video/generations`;
      body = {
        model,
        prompt: withPrefix(params.prompt),
        duration: effectiveDuration,
        size: params.size ?? '1024x576',
        ...(params.imageUrl ? { image_url: params.imageUrl } : {}),
        ...(sendRef ? { reference_video: refUrl } : {}),
      };
    }

    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    };
    const payload = JSON.stringify(body);
    let response: Response;
    let finalUrl: string;
    if (formatType === 'volcengine_ark') {
      // 方舟基址固定为 .../api/v3，不做 /v1 回退
      finalUrl = url;
      response = await this.fetchWithTimeout(
        url,
        { method: 'POST', headers, body: payload },
        VIDEO_HTTP_TIMEOUT_MS,
      );
    } else {
      const ret = await this.postWithV1Fallback(baseUrl, '/video/generations', {
        method: 'POST',
        headers,
        body: payload,
      });
      response = ret.response;
      finalUrl = ret.url;
    }

    try {
      if (!response.ok) {
        const errText = await response.text();
        throw new BadRequestException(
          `视频生成失败 (${response.status}, ${finalUrl}): ${errText.slice(0, 200)}`,
        );
      }

      const data = await response.json();
      const taskId = data.id || data.task_id || data.taskId;
      if (!taskId) {
        throw new BadRequestException('视频生成响应中无任务 ID');
      }
      return { taskId, status: data.status ?? 'running' };
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      this.logger.error(`视频生成请求失败: ${(error as Error).message}`);
      throw new BadRequestException(
        `视频生成请求失败: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Agnes 视频通道（测试版，官方文档双接口）：
   * POST {base}/videos 建任务（mode: text/keyframe/reference 自动映射），
   * externalTaskId 编码为 agnes:{video_id}:{model}，供轮询拆解。
   * 公网 URL 判定：只有 http(s) 参考素材才发送，本地 /uploads 与 data: 跳过。
   */
  private async createAgnesVideo(
    provider: ProviderRecord,
    params: VideoGenerateParams,
    withPrefix: (p: string) => string,
  ): Promise<{ taskId: string; status: string }> {
    const apiKey = provider.apiKey;
    if (!apiKey) {
      throw new BadRequestException('Provider 未配置 API Key');
    }
    const model = params.model ?? provider.videoModel;
    if (!model) {
      throw new BadRequestException('未配置视频模型');
    }
    const isPublic = (u?: string) => !!u && /^https?:\/\//i.test(u);
    const base = this.normalizeBaseUrl(provider.baseUrl);
    const seconds = String(Math.max(4, Math.min(12, Math.round(params.duration ?? 8))));
    // mode 方言：官方 text/keyframe/reference；个别中转（如用户本地 relay）用
    // ti2vid/keyframes/multi_reference，可在供应商 modelParams.agnesModes 覆盖
    const dialect = ((provider.modelParams ?? {}) as { agnesModes?: { text?: string; keyframe?: string; reference?: string }; agnesSchema?: string }).agnesModes ?? {};
    const relaySchema = ((provider.modelParams ?? {}) as { agnesSchema?: string }).agnesSchema === 'relay';
    const modeText = dialect.text ?? 'text';
    const modeKeyframe = dialect.keyframe ?? 'keyframe';
    const modeReference = dialect.reference ?? 'reference';
    const body: Record<string, unknown> = {
      model,
      prompt: withPrefix(params.prompt),
      seconds,
      // 短剧竖屏默认；通用分支的尺寸体系不动
      size: '720P',
      aspect_ratio: '9:16',
    };
    if (isPublic(params.referenceVideoUrl)) {
      body.mode = modeReference;
      body.videos = [{ url: params.referenceVideoUrl }];
    } else if (isPublic(params.imageUrl)) {
      body.mode = modeKeyframe;
      if (relaySchema) {
        // relay 方言：image 数组（≥2 项），尾帧缺失时首帧重复垫
        const last = isPublic(params.lastFrameUrl) ? params.lastFrameUrl : params.imageUrl;
        body.image = [params.imageUrl, last];
      } else {
        body.first_frame = params.imageUrl;
        if (isPublic(params.lastFrameUrl)) body.last_frame = params.lastFrameUrl;
      }
    } else {
      body.mode = modeText;
    }
    const { response, url } = await this.postWithV1Fallback(base, '/videos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const errText = await response.text();
      throw new BadRequestException(`Agnes 视频建任务失败 (${response.status}, ${url}): ${errText.slice(0, 200)}`);
    }
    const data = await response.json();
    const videoId = data.video_id || data.task_id || data.id;
    if (!videoId) {
      throw new BadRequestException('Agnes 视频响应中无 video_id');
    }
    this.logger.log(`Agnes 视频任务已创建 ${videoId}（mode=${body.mode}）`);
    return { taskId: `agnes:${videoId}:${model}`, status: data.status ?? 'running' };
  }

  /** Agnes 轮询：GET {root}/agnesapi?video_id=&model_name=（root = 基址去 /v1） */
  private async pollAgnesVideo(
    provider: ProviderRecord,
    videoId: string,
    model: string,
  ): Promise<VideoPollResult> {
    const apiKey = provider.apiKey;
    if (!apiKey) {
      throw new BadRequestException('Provider 未配置 API Key');
    }
    const root = this.normalizeBaseUrl(provider.baseUrl).replace(/\/v1$/, '');
    const url = `${root}/agnesapi?video_id=${encodeURIComponent(videoId)}&model_name=${encodeURIComponent(model)}`;
    try {
      const response = await this.fetchWithTimeout(
        url,
        {
          method: 'GET',
          headers: { Authorization: `Bearer ${apiKey}` },
        },
        VIDEO_HTTP_TIMEOUT_MS,
      );
      if (!response.ok) {
        const errText = await response.text();
        // W: 状态查询限流（429/503）≠ 生成失败——返回 rate_limit 让 worker 走
        // 限流退避重试，不消耗重试次数；仅其它 4xx/5xx 按失败处理
        if (response.status === 429 || response.status === 503) {
          return { status: 'rate_limit', errorMessage: `Agnes 状态查询限流 (${response.status})` };
        }
        return { status: 'failed', errorMessage: `Agnes 查询失败 (${response.status}): ${errText.slice(0, 200)}` };
      }
      const data = await response.json();
      const status = data.status || 'running';
      if (status === 'completed' || status === 'success') {
        return {
          status: 'succeeded',
          progress: 100,
          outputData: { url: data.url, model },
        };
      }
      if (status === 'failed' || status === 'error') {
        const msg = data.error?.message || data.error || 'Agnes 视频生成失败';
        return { status: 'failed', errorMessage: typeof msg === 'string' ? msg : JSON.stringify(msg).slice(0, 200) };
      }
      return { status: 'running', progress: typeof data.progress === 'number' ? data.progress : 50 };
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      return { status: 'running', progress: 50 };
    }
  }

  async pollVideoTask(
    taskId: string,
    providerName?: string,
  ): Promise<VideoPollResult> {
    // Agnes 通道：externalTaskId 编码为 agnes:{video_id}:{model}
    if (taskId.startsWith('agnes:')) {
      const [, videoId, model] = taskId.split(':');
      if (!videoId || !model) {
        return { status: 'failed', errorMessage: 'Agnes 任务 ID 非法' };
      }
      const provider = await this.getProvider(providerName, 'video');
      return this.pollAgnesVideo(provider, videoId, model);
    }
    // P2-3 mock 通道：秒级成功，占位 URL 原样返回（调用方决定传白模还是首帧）
    if (taskId.startsWith('mock-')) {
      const entry = this.mockVideoTasks.get(taskId);
      if (!entry) {
        return { status: 'failed', errorMessage: 'mock 任务不存在或已过期（进程重启会清空）' };
      }
      this.mockVideoTasks.delete(taskId);
      return {
        status: 'succeeded',
        progress: 100,
        outputData: { url: entry.url, mock: true },
      };
    }
    const provider = await this.getProvider(providerName, 'video');
    const apiKey = provider.apiKey;
    if (!apiKey) {
      throw new BadRequestException('Provider 未配置 API Key');
    }

    const formatType = provider.formatType as FormatType;
    const baseUrl = this.normalizeBaseUrl(provider.baseUrl);

    let url: string;
    if (formatType === 'volcengine_ark') {
      url = `${baseUrl}/contents/generations/tasks/${taskId}`;
    } else {
      url = `${baseUrl}/video/generations/${taskId}`;
    }

    try {
      const response = await this.fetchWithTimeout(
        url,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${apiKey}`,
          },
        },
        VIDEO_HTTP_TIMEOUT_MS,
      );

      if (!response.ok) {
        // P1 修复：4xx（401/403/404/欠费等）不会自愈，转 failed 并写明原因，
        // 避免任务永远 running；429/5xx 视为瞬时故障继续 running
        const errText = await response.text();
        if (response.status === 429 || response.status >= 500) {
          this.logger.warn(
            `视频任务轮询瞬时失败 (${response.status})，稍后重试: taskId=${taskId}`,
          );
          return { status: 'running', progress: 50 };
        }
        return {
          status: 'failed',
          errorMessage: `视频任务查询失败 (${response.status}): ${errText.slice(0, 200)}`,
        };
      }

      const data = await response.json();
      const status =
        data.status || data.task_status || data.output?.status || 'running';

      if (status === 'succeeded' || status === 'success' || status === 'completed') {
        const outputUrl =
          data.output?.video_url ||
          data.video_url ||
          data.output?.url ||
          data.url;
        return {
          status: 'succeeded',
          progress: 100,
          outputData: { url: outputUrl },
        };
      }
      if (status === 'failed' || status === 'error') {
        return {
          status: 'failed',
          errorMessage: data.error?.message || '视频生成失败',
        };
      }
      return {
        status: 'running',
        progress: data.progress ?? 50,
      };
    } catch (error) {
      this.logger.warn(`视频任务轮询失败: ${(error as Error).message}`);
      return { status: 'running', progress: 50 };
    }
  }

  // ========== TTS Generation ==========
  async generateTTS(
    params: TTSGenerateParams,
    providerName?: string,
  ): Promise<{ audioUrl?: string; audioBase64?: string }> {
    const provider = await this.getProvider(providerName, 'tts');
    // P2-3 mock 通道（免 Key）：按文本长度合成一段占位 WAV（正弦音，含停顿）
    if (this.isMockProvider(provider)) {
      const audioBase64 = this.mockWavBase64(params.text);
      this.logger.log(
        `mock TTS 生成（${Math.ceil(params.text.length / 12)}s 占位 WAV，不消费 Key）`,
      );
      return { audioBase64 };
    }
    const apiKey = provider.apiKey;
    if (!apiKey) {
      throw new BadRequestException('Provider 未配置 API Key');
    }

    const model = params.model ?? provider.ttsModel;
    const voice = params.voice ?? provider.ttsVoice;
    if (!model) {
      throw new BadRequestException('未配置 TTS 模型');
    }

    const base = this.normalizeBaseUrl(provider.baseUrl);
    const body = {
      model,
      input: params.text,
      voice: voice ?? 'alloy',
      speed: params.speed ?? 1.0,
    };

    try {
      const { response, url } = await this.postWithV1Fallback(base, '/audio/speech', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new BadRequestException(
          `TTS 生成失败 (${response.status}, ${url}): ${errText.slice(0, 200)}`,
        );
      }

      // 返回可能是二进制音频或 JSON
      const contentType = response.headers.get('content-type') ?? '';
      if (contentType.includes('application/json')) {
        const data = await response.json();
        return {
          audioUrl: data.audio_url ?? data.url,
          audioBase64: data.audio_base64 ?? data.base64,
        };
      }
      // 二进制响应转 base64
      const buffer = await response.arrayBuffer();
      const base64 = Buffer.from(buffer).toString('base64');
      return { audioBase64: base64 };
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      this.logger.error(`TTS 生成请求失败: ${(error as Error).message}`);
      throw new BadRequestException(
        `TTS 生成请求失败: ${(error as Error).message}`,
      );
    }
  }

  // ========== Provider Test ==========
  async testProvider(providerId: string): Promise<{
    success: boolean;
    message: string;
    latencyMs?: number;
  }> {
    const rows = await this.db
      .select()
      .from(modelProviders)
      .where(eq(modelProviders.id, providerId));
    if (rows.length === 0) {
      return { success: false, message: 'Provider 不存在' };
    }
    const provider = rows[0];
    if (!provider.enabled) {
      return { success: false, message: 'Provider 未启用' };
    }
    // P2-3 mock 通道（免 Key）：直接返回连通成功（本地演练沙盒）
    if (this.isMockProvider(provider as unknown as ProviderRecord)) {
      return { success: true, message: 'Mock 演练沙盒连通成功（免 Key）', latencyMs: 1 };
    }
    if (!provider.apiKey) {
      return { success: false, message: '未配置 API Key' };
    }

    const startTime = Date.now();
    try {
      // 尝试简单的文本生成测试
      const caps = (provider.capabilities ?? {}) as ModelCapabilities;
      if (caps.text && provider.textModel) {
        await this.generateText(
          { prompt: 'Hi', model: provider.textModel },
          provider.name,
        );
      } else {
        // 否则 ping base url
        const url = this.normalizeBaseUrl(provider.baseUrl);
        const response = await this.fetchWithTimeout(url, {
          method: 'GET',
          // W1 安全修复：密文出库即解密后再用。
          // 改用 tryDecryptApiKey：连通性测试是读路径，密钥缺失/损坏时应给出
          // 「API Key 解密失败」这类可读结果，而不是抛未捕获异常把接口打成 500。
          headers: {
            Authorization: `Bearer ${tryDecryptApiKey(provider.apiKey) ?? ''}`,
          },
        });
        if (!response.ok && response.status >= 500) {
          throw new Error(`HTTP ${response.status}`);
        }
      }
      const latency = Date.now() - startTime;
      return { success: true, message: '连接成功', latencyMs: latency };
    } catch (error) {
      return {
        success: false,
        message: `连接失败: ${(error as Error).message}`,
        latencyMs: Date.now() - startTime,
      };
    }
  }

  /**
   * mock 视频占位 mp4：首帧循环 + 静音轨（libx264，按镜头时长）。
   * 只接受本地 /uploads 首帧（http 拉取与 data: 解码交给调用方的归档链）。
   * 失败返回 null（回退占位 URL），绝不让 mock 通道把流水线打挂。
   */
  private async mockVideoMp4(taskId: string, params: VideoGenerateParams): Promise<string | null> {
    const src = params.imageUrl ?? '';
    if (!src.startsWith('/uploads/')) return null;
    const localSrc = join(uploadDir(), src.replace(/^\/uploads\//, ''));
    const dir = join(uploadDir(), 'mock');
    await mkdir(dir, { recursive: true });
    const out = join(dir, `${taskId}.mp4`);
    const duration = Math.max(1, Math.min(15, Math.round(params.duration ?? 5)));
    const ok = await new Promise<boolean>((resolve) => {
      const child = spawn(
        'ffmpeg',
        [
          '-y', '-loop', '1', '-i', localSrc,
          '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
          '-t', String(duration),
          '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast',
          '-c:a', 'aac', '-shortest', out,
        ],
        { stdio: ['ignore', 'ignore', 'ignore'] },
      );
      child.on('error', () => resolve(false));
      child.on('close', (code) => resolve(code === 0));
    });
    if (!ok) return null;
    return `/uploads/mock/${taskId}.mp4`;
  }

  // ========== Mock（免 Key 演练沙盒）生成实现 ==========

  /** mock 通道判定：formatType='mock' 或基址指向本地 mock 端点 */
  private isMockProvider(provider: ProviderRecord): boolean {
    return (
      (provider.formatType as FormatType) === 'mock' ||
      /\/\/(localhost|127\.0\.0\.1)(:\d+)?\/mock(\/|$)/.test(provider.baseUrl ?? '')
    );
  }

  /** 文本 mock：规则文案——产出 parseScriptJson 可解析的剧本 JSON（题材按 prompt 关键词映射） */
  private mockTextResponse(prompt: string, model?: string): string {
    // 从提示词里提取"核心创意"：优先取【一句话创意】/【小说原文】等输入标记之后的段落，
    // 否则剔除 JSON 契约等脚手架，取可读文本
    const marked = prompt.split(
      /【一句话创意】|【小说原文】|【待改剧本】|【剧本原文】|【产品卖点】/,
    )[1];
    let motif = (marked
      ? marked
      : prompt
          .replace(/```[\s\S]*?```/g, ' ')
          .replace(/[{["}]/g, '\n')
          .split('\n')
          .map((l) => l.trim())
          .filter((l) => l.length > 8 && !/[:：]\s*$/.test(l))
          .join(' '));
    motif = motif
      .replace(/\s+/g, ' ')
      .replace(/\\["nrt]/g, ' ')
      .trim()
      .slice(0, 160);
    if (!motif) motif = '一个关于勇气与救赎的故事';
    // 题材按"核心创意"判定（motif 未命中再退回整个 prompt，避免风格块关键词误判）
    const theme = /科幻|未来|太空|宇航/.test(motif)
      ? '科幻'
      : /悬疑|犯罪|刑侦/.test(motif)
        ? '悬疑'
        : /都市|职场|爱情/.test(motif)
          ? '都市'
          : /奇幻|玄幻|魔法|书店|记忆/.test(motif)
            ? '奇幻'
            : '剧情';
    const scenes = [
      {
        heading: '第一场 城市街头·黄昏',
        summary: `（Mock 规则文案 · ${theme}）开场交代背景：${motif.slice(0, 60)}`,
        dialogues: [
          { character: '林晚', text: '这座城市每天都有人在告别，今天轮到我了。' },
          { character: '陆沉', text: '别急着走，事情还没完——你手里握着的，正是所有人都想要的答案。' },
        ],
      },
      {
        heading: '第二场 出租屋内·深夜',
        summary: `矛盾升级：${motif.slice(0, 60)}`,
        dialogues: [
          { character: '林晚', text: '我以为放下就能解脱，可它偏偏在深夜里长出了牙齿。' },
          { character: '陆沉', text: `那就正面它一次。${motif.slice(0, 30)}——从今晚开始，换我们追它。` },
        ],
      },
      {
        heading: '第三场 天台·黎明',
        summary: `收束与和解：${motif.slice(0, 60)}`,
        dialogues: [
          { character: '林晚', text: '原来我要找的东西，一直都在出发的地方。' },
          { character: '陆沉', text: '天亮了。去吧，这次为自己活一回。' },
        ],
      },
    ];
    const script = {
      title: `《${theme}·演练剧本》`,
      logline: motif.slice(0, 80),
      scenes,
    };
    return JSON.stringify(script);
  }

  /** 简单字符串哈希（确定性占位颜色用） */
  private mockHash(input: string): number {
    let h = 2166136261;
    for (let i = 0; i < input.length; i++) {
      h ^= input.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  /** PNG chunk：len + type + data + crc32 */
  private mockPngChunk(type: string, data: Buffer): Buffer {
    const crcTable = MockPngCrc.table();
    let crc = 0xffffffff;
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    for (const byte of body) {
      crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    }
    crc = (crc ^ 0xffffffff) >>> 0;
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc, 0);
    return Buffer.concat([len, body, crcBuf]);
  }

  /**
   * 图片 mock：确定性占位 PNG（data URL）。
   * 纯 Node（zlib）手写 PNG 编码，不需要 canvas 原生依赖：
   * 按 prompt 哈希取双色渐变 + 对角色块 + 边框，肉眼可辨、逐镜不同。
   */
  private mockPngDataUrl(prompt: string, w: number, h: number): string {
    const hash = this.mockHash(prompt);
    const hue1 = hash % 360;
    const hue2 = (hue1 + 60 + (hash % 120)) % 360;
    const rgb = (hue: number, l: number): [number, number, number] => {
      // 简化 HSL→RGB（s 固定 0.55）
      const s = 0.55;
      const c = (1 - Math.abs(2 * l - 1)) * s;
      const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
      const m = l - c / 2;
      const seg = Math.floor(hue / 60) % 6;
      const table: [number, number, number][] = [
        [c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x],
      ];
      const [r, g, b] = table[seg];
      return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
    };
    const c1 = rgb(hue1, 0.55);
    const c2 = rgb(hue2, 0.3);
    const raw = Buffer.alloc(h * (1 + w * 4));
    for (let y = 0; y < h; y++) {
      const rowStart = y * (1 + w * 4);
      raw[rowStart] = 0; // filter: none
      for (let x = 0; x < w; x++) {
        const t = (x + y) / (w + h);
        const stripe = Math.floor((x * y) / 64) % 2 === 0 ? 1 : 0.82;
        const border = x < 4 || y < 4 || x >= w - 4 || y >= h - 4 ? 0.15 : 1;
        const o = rowStart + 1 + x * 4;
        raw[o] = Math.round((c1[0] * (1 - t) + c2[0] * t) * stripe * border);
        raw[o + 1] = Math.round((c1[1] * (1 - t) + c2[1] * t) * stripe * border);
        raw[o + 2] = Math.round((c1[2] * (1 - t) + c2[2] * t) * stripe * border);
        raw[o + 3] = 255;
      }
    }
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(w, 0);
    ihdr.writeUInt32BE(h, 4);
    ihdr[8] = 8; // bit depth
    ihdr[9] = 6; // color type RGBA
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      this.mockPngChunk('IHDR', ihdr),
      this.mockPngChunk('IDAT', deflateSync(raw, { level: 6 })),
      this.mockPngChunk('IEND', Buffer.alloc(0)),
    ]);
    return `data:image/png;base64,${png.toString('base64')}`;
  }

  /**
   * TTS mock：按文本长度合成占位 WAV（16kHz 单声道正弦音，句读停顿）。
   * 返回完整 data:audio/wav;base64 URL，job-worker.ensureLocalAudioUrl 会落盘成 /uploads/ 文件。
   */
  private mockWavBase64(text: string): string {
    const sampleRate = 16000;
    const seconds = Math.min(6, Math.max(1, Math.ceil(text.length / 12)));
    const total = sampleRate * seconds;
    const pcm = Buffer.alloc(total * 2);
    for (let i = 0; i < total; i++) {
      const t = i / sampleRate;
      // 0.9s 发声 + 0.15s 停顿的节奏，结尾淡出
      const beat = t % 1.05;
      const env = beat < 0.9 ? Math.min(1, beat * 8) * Math.min(1, (0.9 - beat) * 8) : 0;
      const fade = Math.min(1, (total - i) / (sampleRate * 0.3));
      const sample =
        Math.sin(2 * Math.PI * 220 * t) * 0.5 +
        Math.sin(2 * Math.PI * 440 * t) * 0.25;
      pcm.writeInt16LE(Math.round(sample * env * fade * 12000), i * 2);
    }
    const header = Buffer.alloc(44);
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + pcm.length, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20); // PCM
    header.writeUInt16LE(1, 22); // mono
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(sampleRate * 2, 28);
    header.writeUInt16LE(2, 32);
    header.writeUInt16LE(16, 34);
    header.write('data', 36);
    header.writeUInt32LE(pcm.length, 40);
    return `data:audio/wav;base64,${Buffer.concat([header, pcm]).toString('base64')}`;
  }

  // ========== Internal Helpers ==========
  private async getProvider(
    providerName: string | undefined,
    capability: keyof ModelCapabilities,
  ): Promise<ProviderRecord> {
    let rows: typeof modelProviders.$inferSelect[];

    if (providerName) {
      rows = await this.db
        .select()
        .from(modelProviders)
        .where(
          and(eq(modelProviders.name, providerName), eq(modelProviders.enabled, true)),
        )
        .limit(1);
    } else {
      // 找默认 provider
      rows = await this.db
        .select()
        .from(modelProviders)
        .where(and(eq(modelProviders.isDefault, true), eq(modelProviders.enabled, true)))
        .limit(1);

      if (rows.length === 0) {
        // 没有默认的，找第一个启用的
        rows = await this.db
          .select()
          .from(modelProviders)
          .where(eq(modelProviders.enabled, true))
          .orderBy(desc(modelProviders.routingPriority))
          .limit(1);
      }
    }

    if (rows.length === 0) {
      // 修复（误导性错误）：显式指定 providerName 却查不到时，旧实现抛的是
      // 「未配置模型 Provider，请在设置中添加」，而真实原因是该 Provider
      // 不存在或已被禁用。两种情况处置完全不同（一个要去添加，一个要去启用），
      // 必须区分，否则用户会照着错误提示白忙一场。
      throw new BadRequestException(
        providerName
          ? `指定的模型 Provider「${providerName}」不存在或已禁用`
          : '未配置模型 Provider，请在设置中添加',
      );
    }

    const provider = rows[0];
    const caps = (provider.capabilities ?? {}) as ModelCapabilities;
    if (!caps[capability]) {
      this.logger.warn(
        `Provider ${provider.name} 可能不支持 ${capability} 能力，仍然尝试调用`,
      );
    }

    // 多 Key：生效 Key 行优先（最新激活的一条），无行时回落主 Key 列
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
    // W1 安全修复：出库即解密（存量明文行灰度兼容）。
    // 修复：改用 tryDecryptApiKey —— 本方法处在供应商列表等读路径上，
    // 密钥缺失或 GCM 认证失败（密钥轮换/密文损坏）时返回 null，
    // 由调用方给出「Provider 未配置 API Key」这类可读错误，
    // 而不是抛未捕获异常把所有 Provider 接口打成 500。
    if (keyRows.length > 0 && keyRows[0].apiKey) {
      return {
        ...(provider as unknown as ProviderRecord),
        apiKey: tryDecryptApiKey(keyRows[0].apiKey) ?? null,
      };
    }
    return {
      ...(provider as unknown as ProviderRecord),
      apiKey: tryDecryptApiKey(provider.apiKey) ?? null,
    };
  }

  private normalizeBaseUrl(baseUrl: string | null): string {
    if (!baseUrl) {
      throw new BadRequestException('Provider 未配置 Base URL');
    }
    return baseUrl.replace(/\/$/, '');
  }
}
