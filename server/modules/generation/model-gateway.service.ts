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
import type { ProviderType, FormatType, ModelCapabilities } from '@shared/api.interface';
// W1 安全修复：API Key 落库为 AES-256-GCM 密文，使用前解密（存量明文兼容）
import { decryptApiKey } from '../../common/crypto.util';

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
  status: 'running' | 'succeeded' | 'failed';
  progress?: number;
  outputData?: Record<string, unknown>;
  errorMessage?: string;
}

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
  private async postWithV1Fallback(
    baseUrl: string,
    endpoint: string,
    init: RequestInit,
  ): Promise<{ response: Response; url: string }> {
    const first = `${baseUrl}${endpoint}`;
    // eslint-disable-next-line no-await-in-loop
    let response = await fetch(first, init);
    if (response.status !== 404 || /\/v1$/.test(baseUrl)) {
      return { response, url: first };
    }
    const second = `${baseUrl}/v1${endpoint}`;
    this.logger.log(`接口 404，自动补 /v1 重试：${second}`);
    // eslint-disable-next-line no-await-in-loop
    response = await fetch(second, init);
    return { response, url: second };
  }
  /** F6：上一次文本调用的用量（take 语义，读走即清；无 usage 的接口返回 null） */
  private lastTextUsage: { model: string; inputTokens: number; outputTokens: number } | null = null;

  takeLastTextUsage(): { model: string; inputTokens: number; outputTokens: number } | null {
    const u = this.lastTextUsage;
    this.lastTextUsage = null;
    return u;
  }

  async generateText(params: TextGenerateParams, providerName?: string): Promise<string> {
    const provider = await this.getProvider(providerName, 'text');
    const apiKey = provider.apiKey;
    if (!apiKey) {
      throw new BadRequestException('Provider 未配置 API Key');
    }

    const model = params.model ?? provider.textModel;
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
      // F6 调用明细：OpenAI 兼容接口返回 usage 则暂存，供 worker 记入 outputData
      //（不改返回签名，老调用方无感）
      const usage = data.usage as { prompt_tokens?: unknown; completion_tokens?: unknown } | undefined;
      if (usage && (typeof usage.prompt_tokens === 'number' || typeof usage.completion_tokens === 'number')) {
        this.lastTextUsage = {
          model,
          inputTokens: typeof usage.prompt_tokens === 'number' ? usage.prompt_tokens : 0,
          outputTokens: typeof usage.completion_tokens === 'number' ? usage.completion_tokens : 0,
        };
      }
      return (
        data.choices?.[0]?.message?.content ??
        data.output?.text ??
        JSON.stringify(data)
      );
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      this.logger.error(`文本生成请求失败: ${(error as Error).message}`);
      throw new BadRequestException(
        `文本生成请求失败: ${(error as Error).message}`,
      );
    }
  }

  // ========== Image Generation ==========
  async generateImage(
    params: ImageGenerateParams,
    providerName?: string,
  ): Promise<{ url: string; width?: number; height?: number }[]> {
    const provider = await this.getProvider(providerName, 'image');
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
      // 占位输出：白模/首帧（调用方按 references[1]/[0] 传入 imageUrl 亦可，直传亦可）
      const standIn = params.referenceVideoUrl || params.imageUrl || '';
      this.mockVideoTasks.set(taskId, { url: standIn, at: Date.now() });
      if (this.mockVideoTasks.size > 200) {
        const oldest = [...this.mockVideoTasks.keys()][0];
        this.mockVideoTasks.delete(oldest);
      }
      this.logger.log(`mock 视频任务已创建 ${taskId}（占位输出，不消费 Key）`);
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
    const wantDuration = params.duration ?? 5;
    if (Array.isArray(vparams.videoDurations) && vparams.videoDurations.length > 0) {
      const allowed = vparams.videoDurations.map(Number).filter(Number.isFinite);
      if (allowed.length > 0 && !allowed.includes(wantDuration)) {
        throw new BadRequestException(
          `该供应商视频时长仅支持 ${allowed.join('/')}s，当前 ${wantDuration}s（请改镜头时长或换供应商）`,
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
      return this.createAgnesVideo(provider, params, withPrefix);
    }

    if (formatType === 'volcengine_ark') {
      // 火山方舟格式
      url = `${baseUrl}/contents/generations/tasks`;
      body = {
        model,
        prompt: withPrefix(params.prompt),
        duration: params.duration ?? 5,
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
        duration: params.duration ?? 5,
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
      response = await fetch(url, { method: 'POST', headers, body: payload });
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
    const seconds = String(Math.max(4, Math.min(12, Math.round(params.duration ?? 5))));
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
      const response = await fetch(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!response.ok) {
        const errText = await response.text();
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
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      });

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
        const response = await fetch(url, {
          method: 'GET',
          // W1 安全修复：密文出库即解密后再用
          headers: { Authorization: `Bearer ${decryptApiKey(provider.apiKey)}` },
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
      throw new BadRequestException('未配置模型 Provider，请在设置中添加');
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
    // W1 安全修复：出库即解密（存量明文行灰度兼容）
    if (keyRows.length > 0 && keyRows[0].apiKey) {
      return {
        ...(provider as unknown as ProviderRecord),
        apiKey: decryptApiKey(keyRows[0].apiKey) ?? null,
      };
    }
    return {
      ...(provider as unknown as ProviderRecord),
      apiKey: decryptApiKey(provider.apiKey) ?? null,
    };
  }

  private normalizeBaseUrl(baseUrl: string | null): string {
    if (!baseUrl) {
      throw new BadRequestException('Provider 未配置 Base URL');
    }
    return baseUrl.replace(/\/$/, '');
  }
}
