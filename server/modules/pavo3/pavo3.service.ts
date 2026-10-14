/**
 * 一木·YIMU AI 视频创作平台 · 自由画布 3 —— 真实生成代理服务
 * 三通道 API（火山方舟 / OpenAI 兼容中转 / 自定义）统一 OpenAI 兼容调用：
 *   text  → POST {baseUrl}/chat/completions
 *   image → POST {baseUrl}/images/generations（参考图走 image 字段，dataURL 直传）
 *   video → POST {baseUrl}/videos/generations（首帧参考走 image 字段）
 *   audio → POST {baseUrl}/audio/speech（返回 WAV → base64 dataURL）
 * 未配置默认 Provider 时返回可读错误，前端明确提示，绝不伪造结果。
 */
import { Injectable, Logger } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { eq, and } from 'drizzle-orm';
import { modelProviders } from '../../database/schema';
// W1 安全修复：API Key 落库为 AES-256-GCM 密文，使用前解密（存量明文兼容）
import { decryptApiKey } from '../../common/crypto.util';

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

@Injectable()
export class Pavo3Service {
  private readonly logger = new Logger(Pavo3Service.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
  ) {}

  /** 当前是否已配置可用 Provider（前端生成前检测） */
  async status(): Promise<{ configured: boolean; providerName?: string }> {
    const p = await this.findDefaultProvider();
    // P1 诚信修复：之前只要有行就报 configured，需 Key + BaseURL 齐全才算可用
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
    const provider = await this.findDefaultProvider();
    if (!provider) {
      return { ok: false, message: '未配置模型供应商：请先在「设置 → 模型服务」中添加并启用 API（火山方舟 / OpenAI 兼容中转 / 自定义）' };
    }
    if (!provider.apiKey || !provider.baseUrl) {
      return { ok: false, message: `供应商「${provider.name}」未配置完整的 API Key 或 Base URL` };
    }

    const baseUrl = provider.baseUrl.replace(/\/+$/, '');
    // W1 安全修复：密文出库即解密后再用（存量明文行灰度兼容）
    const apiKey = decryptApiKey(provider.apiKey) ?? undefined;
    // P1 修复：之前 AbortController 从未传入 fetch，180s 超时形同虚设；现 signal 透传到全部请求
    const timeoutMs = 180_000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const signal = controller.signal;

    try {
      switch (req.type) {
        case 'text':
          return await this.generateText(provider, baseUrl, apiKey, req, signal);
        case 'image':
          return await this.generateImage(provider, baseUrl, apiKey, req, signal);
        case 'video':
          return await this.generateVideo(provider, baseUrl, apiKey, req, signal);
        case 'audio':
          return await this.generateAudio(provider, baseUrl, apiKey, req, signal);
        default:
          return { ok: false, message: `不支持的生成类型: ${req.type}` };
      }
    } catch (error) {
      // 超时中断给出明确提示，而非裸 AbortError
      if ((error as Error)?.name === 'AbortError') {
        return { ok: false, message: '请求超时（180s），请检查网络或稍后重试' };
      }
      this.logger.error(`pavo3 generate failed: ${(error as Error).message}`);
      return { ok: false, message: `生成调用失败：${(error as Error).message}` };
    } finally {
      clearTimeout(timer);
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
    const ref = (req.refs ?? []).find((r) => r.url && (r.kind === 'image' || r.kind === 'video' || r.kind === 'director'));
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

  private async generateText(provider: any, baseUrl: string, apiKey: string, req: P3GenerateRequest, signal?: AbortSignal): Promise<P3GenerateResult> {
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
              '你是「一木·YIMU AI 视频创作平台」的创作助手。根据用户描述生成可直接使用的短剧内容：' +
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

  private async generateImage(provider: any, baseUrl: string, apiKey: string, req: P3GenerateRequest, signal?: AbortSignal): Promise<P3GenerateResult> {
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

  private async generateVideo(provider: any, baseUrl: string, apiKey: string, req: P3GenerateRequest, signal?: AbortSignal): Promise<P3GenerateResult> {
    const model = req.model || provider.videoModel || 'seedance-2.5';
    const prompt = this.buildPrompt(req);
    const body: Record<string, unknown> = {
      model,
      prompt,
      response_format: 'url',
      size: RATIO_SIZES[req.size ?? '9:16'] ?? '1080x1920',
    };
    if (req.duration) body.duration = req.duration;
    const refImage = this.pickImageRef(req);
    if (refImage) body.image = refImage; // 首帧参考
    // 首尾帧：refs 第二张图作为尾帧（seedance / 兼容 OpenAI 视频接口 image_tail 字段）
    const refImages = this.pickImageRefs(req);
    if (refImages.length > 1) {
      body.image_tail = refImages[1];
    }
    const data = await this.jsonFetch(`${baseUrl}/videos/generations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal,
    });
    // 兼容：直接返回 url / 任务轮询（火山 seedance 为异步任务）
    const item = data?.data?.[0];
    const url = item?.url || data?.url || (item?.b64_json ? `data:video/mp4;base64,${item.b64_json}` : undefined);
    if (url) return { ok: true, url, mediaKind: 'video', model, provider: provider.name };
    // 异步任务：轮询等结果（P1 修复：45 轮 90s 改为 20 轮 40s，避免长时间占用请求连接；
    // 超时由外层 AbortSignal 兜底，前端可重试继续等待）
    const taskId = item?.id || data?.id;
    if (taskId) {
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        try {
          const poll = await this.jsonFetch(`${baseUrl}/videos/generations/${taskId}`, {
            method: 'GET',
            headers: { Authorization: `Bearer ${apiKey}` },
            signal,
          });
          const it = poll?.data?.[0] || poll;
          if (it?.status === 'succeeded' || it?.status === 'completed') {
            const u = it?.url || it?.output?.url || (it?.b64_json ? `data:video/mp4;base64,${it.b64_json}` : undefined);
            if (u) return { ok: true, url: u, mediaKind: 'video', model, provider: provider.name };
          }
          if (it?.status === 'failed' || it?.error) {
            throw new Error(it?.error?.message || '视频生成任务失败');
          }
        } catch (e) {
          if ((e as Error).message.includes('404') || (e as Error).message.includes('not found')) break;
        }
      }
      return { ok: false, message: '视频任务排队中（已等待 40s），请稍后重试继续等待' };
    }
    return { ok: false, message: '视频接口未返回结果' };
  }

  private async generateAudio(provider: any, baseUrl: string, apiKey: string, req: P3GenerateRequest, signal?: AbortSignal): Promise<P3GenerateResult> {
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
    return { ok: true, url: `data:audio/wav;base64,${b64}`, mediaKind: 'audio', model, provider: provider.name };
  }
}
