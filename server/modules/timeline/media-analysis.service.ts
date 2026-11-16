/**
 * Studio · 时间线媒体分析（帧缩略图 + 音频波形）
 * -------------------------------------------------------------
 * 时间线「看得见才剪得准」：视频片段要显示帧带，音频片段要显示波形。
 * 两者都在服务端用 ffmpeg 一次生成并缓存到 uploads/<projectId>/timeline-cache，
 * 前端只拿 URL + 元数据，随缩放切片显示，不重复解码、不占浏览器内存。
 *
 * 缓存策略：
 *   · sprite / peaks 以「媒体地址 + 参数」哈希命名，命中直接返回 JSON；
 *   · 同一组参数并发请求用 in-flight Map 去重，避免重复抽帧；
 *   · 生成失败不写缓存，下次请求会重试。
 */
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { mkdir, readFile, stat, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import type { TimelineThumbnails, TimelineWaveform } from '@shared/api.interface';
import { uploadDir } from '../assets/upload-dir';
import { ExportService } from '../export/export.service';

const THUMB_TILE_W = 168;
const THUMB_MAX_FRAMES = 240;
const THUMB_MAX_COLUMNS = 10;
const WAVE_POINTS = 1000;
const WAVE_RATE = 8000;
const SRC_MAX_BYTES = 512 * 1024 * 1024;

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const round3 = (n: number) => Math.round(n * 1000) / 1000;

@Injectable()
export class TimelineMediaService {
  private readonly logger = new Logger(TimelineMediaService.name);
  /** 同一份媒体 + 同一组参数的并发请求合并成一次生成 */
  private readonly inflight = new Map<string, Promise<unknown>>();

  constructor(private readonly exportService: ExportService) {}

  private cacheDir(projectId: string): string {
    return join(uploadDir(), projectId, 'timeline-cache');
  }

  private hash(input: string): string {
    return createHash('sha1').update(input).digest('hex').slice(0, 20);
  }

  private async readJson<T>(path: string): Promise<T | null> {
    try {
      return JSON.parse(await readFile(path, 'utf8')) as T;
    } catch {
      return null;
    }
  }

  /**
   * 把媒体物化成服务端本地文件（本地 /uploads 直接复用，公网 URL 走下载缓存）。
   * 生成 sprite / 波形都要先有本地文件，这里统一收口，避免各处重复处理路径穿越。
   */
  private async materialize(projectId: string, url: string): Promise<string> {
    const trimmed = url.trim();
    const dir = join(uploadDir(), projectId, 'timeline-src');
    await mkdir(dir, { recursive: true });
    const ext = (trimmed.split('?')[0].match(/\.[a-z0-9]{2,5}$/i)?.[0] ?? '.mp4').toLowerCase();
    const dest = join(dir, `${this.hash(trimmed)}${ext}`);
    const size = await stat(dest).then((s) => s.size).catch(() => 0);
    if (size > 1024) return dest;
    const ok = await this.exportService.materializeMediaToFile(
      trimmed,
      dest,
      join(uploadDir(), projectId, 'clips'),
    );
    if (!ok) throw new BadRequestException('媒体下载失败，无法生成缩略图/波形');
    return dest;
  }

  /** 读媒体时长（秒）；ffprobe 不可用返回 0 */
  private probeDuration(file: string): Promise<number> {
    const probeBin = this.exportService.resolveFfmpegBin().replace(/ffmpeg(\.exe)?$/i, 'ffprobe$1');
    return new Promise<number>((resolve) => {
      try {
        const child = spawn(
          probeBin,
          ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file],
          { stdio: ['ignore', 'pipe', 'ignore'] },
        );
        let out = '';
        child.stdout?.on('data', (d: Buffer) => {
          out += d.toString();
        });
        child.on('error', () => resolve(0));
        child.on('close', () => {
          const n = Number(String(out).trim());
          resolve(Number.isFinite(n) && n > 0 ? Number(n.toFixed(2)) : 0);
        });
      } catch {
        resolve(0);
      }
    });
  }

  /** 读媒体宽高（用于 sprite 单格高度） */
  private probeSize(file: string): Promise<{ w: number; h: number }> {
    const probeBin = this.exportService.resolveFfmpegBin().replace(/ffmpeg(\.exe)?$/i, 'ffprobe$1');
    return new Promise((resolve) => {
      try {
        const child = spawn(
          probeBin,
          [
            '-v', 'error',
            '-select_streams', 'v:0',
            '-show_entries', 'stream=width,height',
            '-of', 'csv=p=0',
            file,
          ],
          { stdio: ['ignore', 'pipe', 'ignore'] },
        );
        let out = '';
        child.stdout?.on('data', (d: Buffer) => {
          out += d.toString();
        });
        child.on('error', () => resolve({ w: 0, h: 0 }));
        child.on('close', () => {
          const [w, h] = String(out).trim().split(',').map((v) => Number(v));
          resolve({ w: Number.isFinite(w) ? w : 0, h: Number.isFinite(h) ? h : 0 });
        });
      } catch {
        resolve({ w: 0, h: 0 });
      }
    });
  }

  /**
   * 帧缩略图：抽帧拼成一张网格 sprite，返回可切片显示的元数据。
   * interval 默认 1 秒一帧；网格最多 10 列、240 帧，避免长视频把图撑爆。
   */
  async thumbnails(
    projectId: string,
    url: string,
    intervalIn?: number,
    tileWidthIn?: number,
  ): Promise<TimelineThumbnails> {
    const interval = clamp(intervalIn ?? 1, 0.5, 10);
    const tileWidth = clamp(Math.round(tileWidthIn ?? THUMB_TILE_W), 96, 320);
    const key = this.hash(`${url}|${interval}|${tileWidth}`);
    const cache = this.cacheDir(projectId);
    await mkdir(cache, { recursive: true });
    const spriteName = `thumb-${key}.jpg`;
    const spritePath = join(cache, spriteName);
    const metaPath = join(cache, `thumb-${key}.json`);

    const cached = await this.readJson<TimelineThumbnails>(metaPath);
    if (cached && existsSync(spritePath)) return cached;

    const tag = `thumb:${key}`;
    const running = this.inflight.get(tag);
    if (running) return running as Promise<TimelineThumbnails>;

    const task = this.buildThumbnails(
      projectId,
      url,
      interval,
      tileWidth,
      spritePath,
      metaPath,
      spriteName,
    );
    this.inflight.set(tag, task);
    try {
      return await task;
    } finally {
      this.inflight.delete(tag);
    }
  }

  private async buildThumbnails(
    projectId: string,
    url: string,
    interval: number,
    tileWidth: number,
    spritePath: string,
    metaPath: string,
    spriteName: string,
  ): Promise<TimelineThumbnails> {
    const src = await this.materialize(projectId, url);
    const srcSize = await stat(src).catch(() => null);
    if (srcSize && srcSize.size > SRC_MAX_BYTES) {
      throw new BadRequestException('源媒体过大，暂不生成缩略图');
    }
    const duration = await this.probeDuration(src);
    if (duration <= 0) throw new BadRequestException('无法读取视频时长，可能不是有效视频');

    const count = clamp(Math.ceil(duration / interval), 1, THUMB_MAX_FRAMES);
    const columns = Math.min(THUMB_MAX_COLUMNS, count);
    const rows = Math.ceil(count / columns);
    const work = join(tmpdir(), `yimu-thumb-${randomUUID()}`);
    await mkdir(work, { recursive: true });
    const ffmpeg = this.exportService.resolveFfmpegBin();
    // scale=W:-2 保证高度为偶数；tile 把 fps 抽出的帧拼成网格
    const vf = `fps=1/${interval},scale=${tileWidth}:-2,tile=${columns}x${rows}`;
    const ok = await this.exportService.runFfmpeg(
      ffmpeg,
      ['-y', '-v', 'error', '-i', src, '-vf', vf, '-frames:v', '1', '-q:v', '4', spritePath],
      work,
    );
    if (!ok) throw new BadRequestException('抽帧失败，源媒体可能损坏');

    const size = await this.probeSize(spritePath);
    const tileHeight =
      size.h > 0 ? Math.max(1, Math.round(size.h / rows)) : Math.round((tileWidth * 9) / 16);

    const result: TimelineThumbnails = {
      spriteUrl: `/uploads/${projectId}/timeline-cache/${spriteName}`,
      columns,
      rows,
      tileWidth,
      tileHeight,
      interval,
      count,
      duration,
    };
    await writeFile(metaPath, JSON.stringify(result), 'utf8');
    this.logger.log(
      `缩略图生成 ${projectId}：${count} 帧 ${columns}x${rows}（${duration.toFixed(1)}s）`,
    );
    return result;
  }

  /**
   * 音频波形：解码为单声道 8k PCM，按窗口取峰值并归一化。
   * 返回固定点数，前端按片段实际宽度重采样（缩放不需要重新请求）。
   */
  async waveform(projectId: string, url: string, pointsIn?: number): Promise<TimelineWaveform> {
    const points = clamp(Math.round(pointsIn ?? WAVE_POINTS), 200, 4000);
    const key = this.hash(`${url}|${points}`);
    const cache = this.cacheDir(projectId);
    await mkdir(cache, { recursive: true });
    const jsonPath = join(cache, `wave-${key}.json`);

    const cached = await this.readJson<TimelineWaveform>(jsonPath);
    if (cached) return cached;

    const tag = `wave:${key}`;
    const running = this.inflight.get(tag);
    if (running) return running as Promise<TimelineWaveform>;

    const task = this.buildWaveform(projectId, url, points, jsonPath);
    this.inflight.set(tag, task);
    try {
      return await task;
    } finally {
      this.inflight.delete(tag);
    }
  }

  private async buildWaveform(
    projectId: string,
    url: string,
    points: number,
    jsonPath: string,
  ): Promise<TimelineWaveform> {
    const src = await this.materialize(projectId, url);
    const duration = await this.probeDuration(src);
    if (duration <= 0) throw new BadRequestException('无法读取音频时长');
    const ffmpeg = this.exportService.resolveFfmpegBin();
    const pcm = await this.decodePcm(ffmpeg, src);
    if (pcm.length < 2) throw new BadRequestException('音频解码失败，可能是无声或损坏');

    const samples = Math.floor(pcm.length / 2);
    const chunk = Math.max(1, Math.floor(samples / points));
    const peaks: number[] = [];
    let max = 0;
    for (let i = 0; i < points; i += 1) {
      let hi = 0;
      const start = i * chunk;
      const end = Math.min(samples, start + chunk);
      for (let j = start; j < end; j += 1) {
        const v = Math.abs(pcm.readInt16LE(j * 2)) / 32768;
        if (v > hi) hi = v;
      }
      peaks.push(hi);
      if (hi > max) max = hi;
    }
    // 归一化：安静素材也能看清形状；全静音时保持全 0
    const norm = max > 0 ? peaks.map((p) => round3(p / max)) : peaks;
    const result: TimelineWaveform = { peaks: norm, duration, points: norm.length };
    await writeFile(jsonPath, JSON.stringify(result), 'utf8');
    this.logger.log(`波形生成 ${projectId}：${norm.length} 点（${duration.toFixed(1)}s）`);
    return result;
  }

  /** 解码为 PCM（s16le / mono / 8k），从 stdout 收集；不落盘 */
  private decodePcm(ffmpeg: string, src: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const child = spawn(
        ffmpeg,
        ['-v', 'error', '-i', src, '-vn', '-ac', '1', '-ar', String(WAVE_RATE), '-f', 's16le', '-'],
        { stdio: ['ignore', 'pipe', 'pipe'] },
      );
      const chunks: Buffer[] = [];
      let err = '';
      child.stdout.on('data', (d: Buffer) => chunks.push(d));
      child.stderr.on('data', (d: Buffer) => {
        err += d.toString();
      });
      child.on('error', (e) => reject(new BadRequestException(`ffmpeg 启动失败：${e.message}`)));
      child.on('close', (code) => {
        if (code === 0) resolve(Buffer.concat(chunks));
        else reject(new BadRequestException(`音频解码失败：${err.slice(-200) || `exit ${code}`}`));
      });
    });
  }
}
