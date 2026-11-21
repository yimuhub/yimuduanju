/**
 * 音乐节拍分析（G14，OpenMotion 对齐）
 * -------------------------------------------------------------
 * 服务端把音频解码成 22050Hz mono s16le PCM，交给 shared/beat-detect 纯管线，
 * 返回节拍点（秒）+ BPM，供时间线节拍吸附 / 加拍标记（客户端接入由主会话完成）。
 *
 * 缓存策略与 media-analysis.service.ts 一致：
 *   · 结果以「素材地址 + 解码参数」哈希命名写进 timeline-cache（TTL + 容量
 *     淘汰复用既有 sweepTimelineCaches，本服务不再自带清扫）；
 *   · 同一组参数并发请求用 in-flight Map 去重；
 *   · 失败不写缓存，下次请求会重试；
 *   · 分析失败降级为 200 + { beats: [], bpm: 0, error }，绝不抛 500。
 */
import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { mkdir, readFile, stat, utimes, writeFile } from 'fs/promises';
import { join } from 'path';
import { eq } from 'drizzle-orm';
import type { TimelineBeatAnalysis } from '@shared/api.interface';
import { BEAT_SAMPLE_RATE, BEAT_WINDOW_SAMPLES, detectBeats } from '@shared/beat-detect';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { assets } from '../../database/schema';
import { resolveUnderUploads, uploadDir } from '../assets/upload-dir';
import { ExportService } from '../export/export.service';

/** 源媒体体积上限（与缩略图 / 波形同限）：超大文件不进节拍分析 */
const SRC_MAX_BYTES = 512 * 1024 * 1024;
/**
 * 解码后 PCM 上限（秒）：压缩源解出 PCM 会膨胀十几倍，不设上限会 OOM。
 * 超长音频只分析前 10 分钟（对曲速估计足够代表），截断记入服务端日志。
 */
const MAX_ANALYZE_SECONDS = 600;

@Injectable()
export class BeatAnalysisService {
  private readonly logger = new Logger(BeatAnalysisService.name);
  /** 同一份素材 + 同一组参数的并发请求合并成一次分析 */
  private readonly inflight = new Map<string, Promise<TimelineBeatAnalysis>>();

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    private readonly exportService: ExportService,
  ) {}

  private cacheDir(projectId: string): string {
    return join(uploadDir(), projectId, 'timeline-cache');
  }

  private hash(input: string): string {
    return createHash('sha1').update(input).digest('hex').slice(0, 20);
  }

  /**
   * 素材 id → 待分析源地址。按 id 查 assets 表（与 /api/assets/:id/content
   * 的解析口径一致：filePath 已归档直接用，否则走 fileUrl 物化）。
   */
  private async resolveAssetFile(projectId: string, assetId: string): Promise<string> {
    const rows = await this.db
      .select({ fileUrl: assets.fileUrl, filePath: assets.filePath })
      .from(assets)
      .where(eq(assets.id, assetId))
      .limit(1);
    const row = rows[0];
    if (!row) {
      throw new BadRequestException('素材不存在：请检查 assetId 是否属于有效素材');
    }
    // filePath 由服务端归档流程写入，但读取前仍做上传目录包含性校验（防御脏数据）
    if (row.filePath) {
      try {
        const abs = resolveUnderUploads(row.filePath);
        if (existsSync(abs)) return abs;
      } catch {
        /* 路径非法 → 走 fileUrl 物化 */
      }
    }
    if (!row.fileUrl) {
      throw new BadRequestException('素材没有文件地址，无法分析节拍');
    }
    // fileUrl（本地 /uploads 或公网 URL）物化成本地副本，与缩略图 / 波形同路径
    const dir = join(uploadDir(), projectId, 'timeline-src');
    await mkdir(dir, { recursive: true });
    const ext = (row.fileUrl.split('?')[0].match(/\.[a-z0-9]{2,5}$/i)?.[0] ?? '.mp4').toLowerCase();
    const dest = join(dir, `${this.hash(`beat-src:${row.fileUrl}`)}${ext}`);
    const size = await stat(dest).then((s) => s.size).catch(() => 0);
    if (size > 1024) {
      // 命中已下载副本：刷新访问时间，避免被缓存清扫单独淘汰
      await utimes(dest, new Date(), new Date()).catch(() => undefined);
      return dest;
    }
    const ok = await this.exportService.materializeMediaToFile(
      row.fileUrl,
      dest,
      join(uploadDir(), projectId, 'clips'),
    );
    if (!ok) throw new BadRequestException('素材下载失败，无法分析节拍');
    return dest;
  }

  /** 解码为 PCM（s16le / mono / 22050Hz），从 stdout 收集；不落盘 */
  private decodePcm(ffmpeg: string, src: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const child = spawn(
        ffmpeg,
        [
          '-v', 'error',
          '-i', src,
          '-vn', '-ac', '1',
          '-ar', String(BEAT_SAMPLE_RATE),
          '-f', 's16le', '-',
        ],
        { stdio: ['ignore', 'pipe', 'pipe'] },
      );
      const chunks: Buffer[] = [];
      let err = '';
      child.stdout.on('data', (d: Buffer) => chunks.push(d));
      child.stderr.on('data', (d: Buffer) => {
        err += d.toString();
      });
      child.on('error', (e) => reject(new Error(`ffmpeg 启动失败：${e.message}`)));
      child.on('close', (code) => {
        if (code === 0) resolve(Buffer.concat(chunks));
        else reject(new Error(`音频解码失败：${err.slice(-200) || `exit ${code}`}`));
      });
    });
  }

  /** int16 PCM（s16le 小端字节流）→ 采样数组（beat-detect 只依赖 ArrayLike） */
  private static toSamples(pcm: Buffer): Int16Array {
    const count = Math.floor(pcm.length / 2);
    const samples = new Int16Array(count);
    for (let i = 0; i < count; i += 1) samples[i] = pcm.readInt16LE(i * 2);
    return samples;
  }

  /**
   * 分析素材节拍。素材不存在 / 无文件地址抛 400（调用方参数错误）；
   * 解码与分析失败一律降级为 200 + 空结果 + error 说明，前端可直接渲染兜底。
   */
  async analyze(projectId: string, assetId: string): Promise<TimelineBeatAnalysis> {
    const source = await this.resolveAssetFile(projectId, assetId);
    const key = this.hash(`beat|${BEAT_SAMPLE_RATE}|${BEAT_WINDOW_SAMPLES}|${source}`);
    const cachePath = join(this.cacheDir(projectId), `beat-${key}.json`);

    const cached = await readFile(cachePath, 'utf8')
      .then<TimelineBeatAnalysis | null>((raw) => {
        try {
          return JSON.parse(raw) as TimelineBeatAnalysis;
        } catch {
          return null;
        }
      })
      .catch(() => null);
    if (cached && !cached.error) {
      await utimes(cachePath, new Date(), new Date()).catch(() => undefined);
      return cached;
    }

    const running = this.inflight.get(key);
    if (running) return running;

    const task = this.analyzeFile(projectId, source, cachePath);
    this.inflight.set(key, task);
    try {
      return await task;
    } finally {
      this.inflight.delete(key);
    }
  }

  private async analyzeFile(
    projectId: string,
    source: string,
    cachePath: string,
  ): Promise<TimelineBeatAnalysis> {
    try {
      const size = await stat(source).then((s) => s.size).catch(() => 0);
      if (size > SRC_MAX_BYTES) {
        return { beats: [], bpm: 0, durationSeconds: 0, error: '源媒体过大，暂不支持节拍分析' };
      }
      const ffmpeg = this.exportService.resolveFfmpegBin();
      const pcm = await this.decodePcm(ffmpeg, source);
      if (pcm.length < BEAT_WINDOW_SAMPLES * 4) {
        // 少于 4 个包络窗（≈0.19s）没有分析意义：太短或纯静音
        return { beats: [], bpm: 0, durationSeconds: 0, error: '音频太短或无声，无法检测节拍' };
      }
      const raw = BeatAnalysisService.toSamples(pcm);
      // 超长音频截断：只分析前 MAX_ANALYZE_SECONDS 秒，防止解码 PCM 把内存吃穿
      const maxSamples = BEAT_SAMPLE_RATE * MAX_ANALYZE_SECONDS;
      const samples = raw.length > maxSamples ? raw.subarray(0, maxSamples) : raw;
      const result = detectBeats(samples, BEAT_SAMPLE_RATE);
      // 检不出拍点也是合法结果（氛围垫乐 / 纯噪声），照常缓存；只有 error 才不缓存
      await mkdir(this.cacheDir(projectId), { recursive: true });
      await writeFile(cachePath, JSON.stringify(result), 'utf8');
      this.logger.log(
        `节拍分析 ${projectId}：${result.beats.length} 拍 · ${result.bpm} BPM（${result.durationSeconds.toFixed(1)}s）` +
          (raw.length > maxSamples ? `（超长素材，仅分析前 ${MAX_ANALYZE_SECONDS}s）` : ''),
      );
      return result;
    } catch (e) {
      const message = (e as Error)?.message ?? String(e);
      this.logger.warn(`节拍分析失败（降级返回空结果）：${message}`);
      return {
        beats: [],
        bpm: 0,
        durationSeconds: 0,
        error: `节拍分析失败：${message.slice(0, 160)}`,
      };
    }
  }
}
