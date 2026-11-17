/**
 * ASR 适配层（单片段转写）
 * -------------------------------------------------------------
 * 统一入口，两种 provider：
 *   1. openai：任何兼容 /audio/transcriptions 的服务（OpenAI / 火山 / 自建中转）
 *   2. local ：本机 whisper / faster-whisper CLI
 *
 * 设计边界：
 *   · 只转写「当前片段引用的源媒体区间」，不整片重转，成本随剪辑范围走；
 *   · 输出 start/end 相对源媒体，服务端加回 inPoint 后写 timeline_clips.transcript；
 *   · 供应商只返回 text 时，按句子长度比例在片段时长内估算，confidence 留空，
 *     boundary 由索引层标为估算，不冒充词级时间戳。
 */
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { spawn, spawnSync } from 'child_process';
import { existsSync } from 'fs';
import { mkdir, readFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { ExportService } from '../export/export.service';
import { TimelineService, normalizeTranscriptSegments } from './timeline.service';
import type { TimelineAsrResult, TimelineTranscriptSegment } from '@shared/api.interface';

interface RawSegment {
  start?: number;
  end?: number;
  text?: string;
  confidence?: number;
}

type ProviderKind = 'openai' | 'local';

@Injectable()
export class AsrService {
  private readonly logger = new Logger(AsrService.name);

  constructor(
    private readonly timeline: TimelineService,
    private readonly exportService: ExportService,
  ) {}

  /** 当前可用的 provider；未配置抛 503，并把缺什么写清楚 */
  resolveProvider(): ProviderKind {
    const forced = (process.env.YIMU_ASR_PROVIDER ?? '').trim().toLowerCase();
    if (forced === 'openai' || forced === 'local') return forced;
    if ((process.env.YIMU_ASR_API_KEY ?? '').trim()) return 'openai';
    if (this.findWhisperBin()) return 'local';
    throw new ServiceUnavailableException(
      '未配置语音转写：设置 YIMU_ASR_API_KEY（OpenAI 兼容 /audio/transcriptions）或安装 whisper / faster-whisper 并设置 YIMU_WHISPER_BIN',
    );
  }

  /** 当前能力描述，供健康检查与前端提示 */
  status() {
    try {
      return {
        available: true,
        provider: this.resolveProvider(),
        model: process.env.YIMU_ASR_MODEL ?? 'whisper-1',
        reason: null as string | null,
      };
    } catch (err) {
      return {
        available: false,
        provider: null,
        model: null,
        reason: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async transcribeClip(
    projectId: string,
    clipId: string,
    language?: string | null,
  ): Promise<TimelineAsrResult> {
    const provider = this.resolveProvider();
    const doc = await this.timeline.getDocument(projectId);
    const clip = doc.clips.find((c) => c.id === clipId || c.clientKey === clipId);
    if (!clip) throw new NotFoundException('时间线片段不存在');
    if (clip.track !== 'video' && clip.track !== 'audio') {
      throw new BadRequestException('只有画面/音频片段可以转写');
    }
    if (!clip.sourceUrl) throw new BadRequestException('片段没有源媒体地址');
    const span = Math.max(0, clip.outPoint - clip.inPoint);
    if (span < 0.2) throw new BadRequestException('片段时长过短，无法转写');

    const dir = join(tmpdir(), `yimu-asr-${projectId.slice(0, 8)}-${Date.now().toString(36)}`);
    await mkdir(dir, { recursive: true });
    const src = join(dir, 'source.media');
    const wav = join(dir, 'audio.wav');
    try {
      const got = await this.exportService.materializeMediaToFile(clip.sourceUrl, src);
      if (!got || !existsSync(src)) throw new BadRequestException('源媒体无法读取');
      await this.extractAudio(src, wav, clip.inPoint, span);
      const raw = await this.callProvider(provider, wav, language ?? null, span);
      const segments = raw.map((s) => ({ ...s, start: s.start + clip.inPoint, end: s.end + clip.inPoint }));
      const clean = normalizeTranscriptSegments(segments);
      if (!clean.length) throw new BadRequestException('未识别到有效语音内容');
      await this.timeline.setClipTranscript(projectId, clip.id, clean);
      return {
        clipId: clip.id,
        provider,
        language: language ?? null,
        durationSec: Math.round(span * 1000) / 1000,
        segments: clean,
      };
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }

  private async extractAudio(src: string, wav: string, start: number, duration: number) {
    const ffmpeg = this.exportService.resolveFfmpegBin();
    const args = [
      '-y',
      '-hide_banner',
      '-loglevel', 'error',
      '-ss', String(Math.max(0, start)),
      '-t', String(Math.max(0.2, duration)),
      '-i', src,
      '-vn',
      '-ac', '1',
      '-ar', '16000',
      '-c:a', 'pcm_s16le',
      wav,
    ];
    const code = await new Promise<number>((resolve) => {
      const child = spawn(ffmpeg, args, { stdio: ['ignore', 'ignore', 'pipe'] });
      let err = '';
      child.stderr?.on('data', (d) => { err += String(d); });
      child.on('error', () => resolve(-1));
      child.on('close', (c) => {
        if (c !== 0) this.logger.warn(`[asr] ffmpeg 抽音失败 ${c}: ${err.slice(0, 200)}`);
        resolve(c ?? -1);
      });
    });
    if (code !== 0 || !existsSync(wav)) throw new BadRequestException('音频抽取失败');
  }

  private async callProvider(
    provider: ProviderKind,
    wav: string,
    language: string | null,
    duration: number,
  ): Promise<TimelineTranscriptSegment[]> {
    if (provider === 'openai') return this.callOpenAi(wav, language, duration);
    return this.callLocal(wav, language, duration);
  }

  private async callOpenAi(
    wav: string,
    language: string | null,
    duration: number,
  ): Promise<TimelineTranscriptSegment[]> {
    const key = (process.env.YIMU_ASR_API_KEY ?? '').trim();
    if (!key) throw new ServiceUnavailableException('缺少 YIMU_ASR_API_KEY');
    const base = (process.env.YIMU_ASR_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/+$/, '');
    const model = (process.env.YIMU_ASR_MODEL ?? 'whisper-1').trim();
    const buf = await readFile(wav);
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(buf)], { type: 'audio/wav' }), 'audio.wav');
    form.append('model', model);
    form.append('response_format', 'verbose_json');
    form.append('timestamp_granularities[]', 'segment');
    if (language) form.append('language', language);
    const res = await fetch(`${base}/audio/transcriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
      body: form,
      signal: AbortSignal.timeout(180_000),
    });
    const text = await res.text();
    if (!res.ok) {
      throw new ServiceUnavailableException(`ASR 服务返回 ${res.status}: ${text.slice(0, 180)}`);
    }
    let json: { text?: string; segments?: RawSegment[] } = {};
    try {
      json = JSON.parse(text) as typeof json;
    } catch {
      return [{ start: 0, end: duration, text: text.trim() }];
    }
    const segs = (json.segments ?? [])
      .map((s) => ({
        start: Number(s.start ?? 0),
        end: Number(s.end ?? 0),
        text: String(s.text ?? '').trim(),
      }))
      .filter((s) => s.text && s.end > s.start);
    if (segs.length) return segs;
    const plain = (json.text ?? '').trim();
    return plain ? splitByDuration(plain, duration) : [];
  }

  private findWhisperBin(): string | null {
    const explicit = (process.env.YIMU_WHISPER_BIN ?? '').trim();
    if (explicit && existsSync(explicit)) return explicit;
    for (const name of ['whisper', 'faster-whisper', 'whisper-cli']) {
      const r = spawnSync('which', [name], { encoding: 'utf8' });
      if (r.status === 0) {
        const p = r.stdout.trim().split('\n')[0];
        if (p) return p;
      }
    }
    return null;
  }

  private async callLocal(
    wav: string,
    language: string | null,
    duration: number,
  ): Promise<TimelineTranscriptSegment[]> {
    const bin = this.findWhisperBin();
    if (!bin) throw new ServiceUnavailableException('本机未安装 whisper');
    const model = (process.env.YIMU_ASR_MODEL ?? 'base').trim();
    const outDir = join(tmpdir(), `yimu-whisper-${Date.now().toString(36)}`);
    await mkdir(outDir, { recursive: true });
    const args = [
      wav,
      '--model', model,
      '--output_format', 'json',
      '--output_dir', outDir,
      '--task', 'transcribe',
      '--fp16', 'False',
    ];
    if (language) args.push('--language', language);
    const code = await new Promise<number>((resolve) => {
      const child = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'] });
      let err = '';
      child.stderr?.on('data', (d) => { err += String(d); });
      child.on('error', () => resolve(-1));
      child.on('close', (c) => {
        if (c !== 0) this.logger.warn(`[asr] whisper 失败 ${c}: ${err.slice(0, 300)}`);
        resolve(c ?? -1);
      });
    });
    try {
      if (code !== 0) throw new ServiceUnavailableException('whisper 转写失败');
      const jsonPath = join(outDir, 'audio.json');
      const json = JSON.parse(await readFile(jsonPath, 'utf8')) as {
        text?: string;
        segments?: RawSegment[];
      };
      const segs = (json.segments ?? [])
        .map((s) => ({
          start: Number(s.start ?? 0),
          end: Number(s.end ?? 0),
          text: String(s.text ?? '').trim(),
        }))
        .filter((s) => s.text && s.end > s.start);
      if (segs.length) return segs;
      const plain = (json.text ?? '').trim();
      return plain ? splitByDuration(plain, duration) : [];
    } catch (err) {
      if (err instanceof ServiceUnavailableException) throw err;
      throw new ServiceUnavailableException('whisper 输出无法解析');
    } finally {
      await rm(outDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

/** 无时间段时按句号/问号/感叹号切句，并按字符数比例分配时长（明确是估算） */
function splitByDuration(text: string, duration: number): TimelineTranscriptSegment[] {
  const sentences = text
    .replace(/\s+/g, ' ')
    .split(/(?<=[。！？!?；;])\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (!sentences.length) return [];
  const totalChars = sentences.reduce((n, s) => n + Math.max(1, s.length), 0);
  let cursor = 0;
  return sentences.map((s) => {
    const share = Math.max(1, s.length) / totalChars;
    const len = duration * share;
    const start = cursor;
    cursor = Math.min(duration, cursor + len);
    return { start, end: cursor, text: s };
  });
}
