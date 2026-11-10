import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { mkdir, stat, unlink, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { asc, eq } from 'drizzle-orm';
import {
  assets,
  projects,
  scenes,
  shots,
  timelineClips,
  timelineDocuments,
} from '@server/database/schema';
import type {
  Asset,
  ExportTimelineResult,
  TimelineClip,
  TimelineDocument,
} from '@shared/api.interface';
import { uploadDir } from '../assets/upload-dir';
import { ExportService } from '../export/export.service';
import type { ExportTimelineDto, SaveTimelineDto, SaveTimelineClipDto } from './dto';

const num = (v: unknown, fallback = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const round3 = (n: number) => Math.round(n * 1000) / 1000;
const iso = (d: unknown): string =>
  d instanceof Date ? d.toISOString() : typeof d === 'string' ? d : new Date().toISOString();

/** 片段有效时长（时间线占位） */
const clipSpan = (c: Pick<TimelineClip, 'inPoint' | 'outPoint' | 'speed'>) =>
  Math.max(0, (c.outPoint - c.inPoint) / (c.speed > 0 ? c.speed : 1));

/**
 * 线性剪辑 EDL（Phase 3/4）
 * -------------------------------------------------------------
 * shots 是「生产台账」，timeline_clips 是「剪辑决策表」。未保存过 EDL 的项目
 * GET 时从 shots 现派生（只读不落库），保证编辑器打开就有内容；PUT 后以
 * timeline_clips 为准。导出按 EDL 渲染：trim → 统一编码 → concat → 混音 → 字幕。
 */
@Injectable()
export class TimelineService {
  private readonly logger = new Logger(TimelineService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    private readonly exportService: ExportService,
  ) {}

  private async requireProject(projectId: string) {
    const rows = await this.db
      .select({ id: projects.id, title: projects.title })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    if (rows.length === 0) throw new NotFoundException('项目不存在');
    return rows[0];
  }

  /** 从镜头台账派生默认 EDL（不落库）：视频轨为主，配音/字幕跟随视频镜头对齐 */
  private async deriveDefault(projectId: string): Promise<TimelineDocument> {
    const rows = await this.db
      .select({
        id: shots.id,
        sceneNumber: scenes.sceneNumber,
        shotNumber: shots.shotNumber,
        sortOrder: shots.sortOrder,
        duration: shots.duration,
        inPoint: shots.inPoint,
        outPoint: shots.outPoint,
        videoUrl: shots.videoUrl,
        voiceUrl: shots.voiceUrl,
        subtitleText: shots.subtitleText,
        dialogue: shots.dialogue,
        createdAt: shots.createdAt,
      })
      .from(shots)
      .innerJoin(scenes, eq(shots.sceneId, scenes.id))
      .where(eq(shots.projectId, projectId))
      .orderBy(asc(shots.sortOrder), asc(scenes.sceneNumber), asc(shots.shotNumber), asc(shots.createdAt));
    const now = new Date().toISOString();
    const clips: TimelineClip[] = [];
    let cursor = 0;
    let sort = 0;
    for (const s of rows) {
      const dur = Math.max(0.1, num(s.duration, 4));
      const inPoint = s.inPoint != null ? num(s.inPoint) : 0;
      const outPoint = s.outPoint != null ? num(s.outPoint) : round3(inPoint + dur);
      if (!s.videoUrl) continue;
      clips.push({
        id: `derived-v-${s.id}`,
        projectId,
        track: 'video',
        sourceShotId: s.id,
        sourceUrl: s.videoUrl,
        inPoint,
        outPoint,
        timelineStart: round3(cursor),
        lane: 0,
        speed: 1,
        volume: 1,
        transition: { type: 'none', duration: 0 },
        text: null,
        locked: false,
        sortOrder: sort++,
        createdAt: now,
        updatedAt: now,
      });
      if (s.voiceUrl) {
        clips.push({
          id: `derived-a-${s.id}`,
          projectId,
          track: 'audio',
          sourceShotId: s.id,
          sourceUrl: s.voiceUrl,
          inPoint: 0,
          outPoint: round3(outPoint - inPoint),
          timelineStart: round3(cursor),
          lane: 0,
          speed: 1,
          volume: 1,
          transition: { type: 'none', duration: 0 },
          text: null,
          locked: false,
          sortOrder: sort++,
          createdAt: now,
          updatedAt: now,
        });
      }
      const sub = (s.subtitleText || s.dialogue || '').trim();
      if (sub) {
        clips.push({
          id: `derived-s-${s.id}`,
          projectId,
          track: 'subtitle',
          sourceShotId: s.id,
          sourceUrl: null,
          inPoint: 0,
          outPoint: round3(outPoint - inPoint),
          timelineStart: round3(cursor),
          lane: 0,
          speed: 1,
          volume: 1,
          transition: { type: 'none', duration: 0 },
          text: sub,
          locked: false,
          sortOrder: sort++,
          createdAt: now,
          updatedAt: now,
        });
      }
      cursor = round3(cursor + (outPoint - inPoint));
    }
    return { projectId, fps: 24, width: 1080, height: 1920, clips };
  }

  private mapClip(row: typeof timelineClips.$inferSelect): TimelineClip {
    return {
      id: row.id,
      projectId: row.projectId,
      track: row.track as TimelineClip['track'],
      sourceShotId: row.sourceShotId,
      sourceUrl: row.sourceUrl,
      inPoint: num(row.inPoint),
      outPoint: num(row.outPoint),
      timelineStart: num(row.timelineStart),
      lane: row.lane ?? 0,
      speed: num(row.speed, 1) || 1,
      volume: num(row.volume, 1),
      transition: (row.transition as TimelineClip['transition']) ?? null,
      text: row.text,
      locked: row.locked,
      sortOrder: row.sortOrder,
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.updatedAt),
    };
  }

  async getDocument(projectId: string): Promise<TimelineDocument> {
    await this.requireProject(projectId);
    const docRows = await this.db
      .select()
      .from(timelineDocuments)
      .where(eq(timelineDocuments.projectId, projectId))
      .limit(1);
    if (docRows.length === 0) return this.deriveDefault(projectId);
    const clipRows = await this.db
      .select()
      .from(timelineClips)
      .where(eq(timelineClips.projectId, projectId))
      .orderBy(asc(timelineClips.sortOrder), asc(timelineClips.timelineStart));
    const doc = docRows[0];
    return {
      projectId,
      fps: doc.fps,
      width: doc.width,
      height: doc.height,
      clips: clipRows.map((r) => this.mapClip(r)),
      updatedAt: iso(doc.updatedAt),
    };
  }

  /**
   * 整体替换 EDL（单事务）。clip.id 一律由服务端生成：客户端回传的 id 只用于
   * 本地关联，落库后以响应中的新 id 为准，避免跨项目 id 覆写风险。
   */
  async saveDocument(projectId: string, dto: SaveTimelineDto): Promise<TimelineDocument> {
    await this.requireProject(projectId);
    const fps = dto.fps ?? 24;
    const width = dto.width ?? 1080;
    const height = dto.height ?? 1920;
    // 入出点合法性：out > in；超时长的片段在渲染时按源媒体截断
    for (const c of dto.clips) {
      if (c.outPoint <= c.inPoint) {
        throw new BadRequestException(`片段入出点无效：out(${c.outPoint}) 必须大于 in(${c.inPoint})`);
      }
    }
    const now = new Date();
    await this.db.transaction(async (tx) => {
      await tx.delete(timelineClips).where(eq(timelineClips.projectId, projectId));
      if (dto.clips.length > 0) {
        const values = dto.clips.map((c: SaveTimelineClipDto, i: number) => ({
          projectId,
          track: c.track,
          sourceShotId: c.sourceShotId ?? null,
          sourceUrl: c.sourceUrl ?? null,
          inPoint: String(c.inPoint),
          outPoint: String(c.outPoint),
          timelineStart: String(c.timelineStart),
          lane: c.lane ?? 0,
          speed: String(c.speed ?? 1),
          volume: String(c.volume ?? 1),
          transition: c.transition ?? null,
          text: c.text ?? null,
          locked: c.locked ?? false,
          sortOrder: c.sortOrder ?? i,
          updatedAt: now,
        }));
        await tx.insert(timelineClips).values(values);
      }
      const existing = await tx
        .select({ projectId: timelineDocuments.projectId })
        .from(timelineDocuments)
        .where(eq(timelineDocuments.projectId, projectId))
        .limit(1);
      if (existing.length === 0) {
        await tx.insert(timelineDocuments).values({ projectId, fps, width, height });
      } else {
        await tx
          .update(timelineDocuments)
          .set({ fps, width, height, updatedAt: now })
          .where(eq(timelineDocuments.projectId, projectId));
      }
    });
    return this.getDocument(projectId);
  }

  /** 字幕轨 → SRT（时间线坐标，供软字幕封装） */
  private buildSrt(clips: TimelineClip[]): string {
    const fmt = (sec: number) => {
      const ms = Math.round(Math.max(0, sec) * 1000);
      const p = (v: number, n: number) => String(v).padStart(n, '0');
      return `${p(Math.floor(ms / 3600000), 2)}:${p(Math.floor((ms % 3600000) / 60000), 2)}:${p(
        Math.floor((ms % 60000) / 1000),
        2,
      )},${p(ms % 1000, 3)}`;
    };
    const subs = clips
      .filter((c) => c.track === 'subtitle' && c.text && c.text.trim())
      .sort((a, b) => a.timelineStart - b.timelineStart);
    return subs
      .map((c, i) => {
        const end = c.timelineStart + clipSpan(c);
        return `${i + 1}\n${fmt(c.timelineStart)} --> ${fmt(end)}\n${c.text?.trim()}\n`;
      })
      .join('\n');
  }

  /**
   * 字幕轨 → ASS（样式内嵌）。
   * 烧录不再用 subtitles 滤镜的 force_style：那需要多层转义逗号，spawn 传参时
   * 极易解析失败；ASS 自带 Style，滤镜只需 `ass=file.ass`。
   */
  private buildAss(clips: TimelineClip[], width: number, height: number): string {
    const fmt = (sec: number) => {
      const cs = Math.round(Math.max(0, sec) * 100);
      const p = (v: number, n: number) => String(v).padStart(n, '0');
      return `${Math.floor(cs / 360000)}:${p(Math.floor((cs % 360000) / 6000), 2)}:${p(
        Math.floor((cs % 6000) / 100),
        2,
      )}.${p(cs % 100, 2)}`;
    };
    const font =
      process.platform === 'darwin'
        ? 'Arial Unicode MS'
        : process.platform === 'win32'
          ? 'Microsoft YaHei'
          : 'Noto Sans CJK SC';
    const fontSize = Math.max(16, Math.round(height * 0.03));
    const marginV = Math.max(24, Math.round(height * 0.07));
    const subs = clips
      .filter((c) => c.track === 'subtitle' && c.text && c.text.trim())
      .sort((a, b) => a.timelineStart - b.timelineStart);
    const events = subs.map((c) => {
      const end = c.timelineStart + clipSpan(c);
      const text = (c.text ?? '')
        .trim()
        .replace(/\r?\n/g, '\\N')
        .replace(/[{}]/g, '');
      return `Dialogue: 0,${fmt(c.timelineStart)},${fmt(end)},Default,,0,0,0,,${text}`;
    });
    return [
      '[Script Info]',
      'ScriptType: v4.00+',
      `PlayResX: ${width}`,
      `PlayResY: ${height}`,
      'WrapStyle: 0',
      '',
      '[V4+ Styles]',
      'Format: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, BackColour, Bold, Italic, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
      `Style: Default,${font},${fontSize},&H00FFFFFF,&H80000000,&H00000000,0,0,1,2,0,2,24,24,${marginV},1`,
      '',
      '[Events]',
      'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
      ...events,
      '',
    ].join('\n');
  }

  /** 烧录用字体目录：libass 在 macOS 上读不到系统保留字体，指定可读目录兜底 */
  private fontDir(): string | null {
    const candidates =
      process.platform === 'darwin'
        ? ['/System/Library/Fonts/Supplemental', '/Library/Fonts']
        : process.platform === 'win32'
          ? ['C:/Windows/Fonts']
          : ['/usr/share/fonts', '/usr/local/share/fonts'];
    return candidates.find((d) => existsSync(d)) ?? null;
  }

  /**
   * 挑一个带 libass 的 ffmpeg 做字幕烧录。
   * 主 ffmpeg（Homebrew 9.x）可能未编译 subtitles/ass 滤镜，直接用它烧录会静默
   * 退回软字幕；这里按候选顺序探测滤镜表并缓存结果（null = 都不支持）。
   */
  private burnBinPromise: Promise<string | null> | null = null;

  private resolveBurnFfmpeg(): Promise<string | null> {
    if (!this.burnBinPromise) {
      this.burnBinPromise = (async () => {
        const home = process.env.HOME ?? '';
        const candidates = [
          this.exportService.resolveFfmpegBin(),
          home ? `${home}/.local/bin/ffmpeg` : '',
          '/opt/homebrew/bin/ffmpeg',
          '/usr/local/bin/ffmpeg',
          'ffmpeg',
        ].filter(Boolean);
        for (const bin of [...new Set(candidates)]) {
          if (bin.includes('/') && !existsSync(bin)) continue;
          // eslint-disable-next-line no-await-in-loop
          if (await this.hasSubtitlesFilter(bin)) return bin;
        }
        this.logger.warn('未找到带 libass 的 ffmpeg，字幕将改为软封装');
        return null;
      })();
    }
    return this.burnBinPromise;
  }

  private hasSubtitlesFilter(bin: string): Promise<boolean> {
    return new Promise((resolve) => {
      const child = spawn(bin, ['-hide_banner', '-filters'], { stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      child.stdout.on('data', (d: Buffer) => {
        out += d.toString();
      });
      child.stderr.on('data', (d: Buffer) => {
        out += d.toString();
      });
      child.on('error', () => resolve(false));
      child.on('close', (code) => {
        resolve(code === 0 && /\b(subtitles|ass)\b\s+[VA-]/i.test(out));
      });
    });
  }

  /**
   * Phase 4：按 EDL 渲染成片。
   * 视频轨：按 timelineStart 排序 → 各自 trim/缩放/fps 统一 → concat；
   * 音频轨：trim + 音量 + adelay(timelineStart) 后 amix，时长以视频为准；
   * 字幕轨：默认软封装 mov_text；burnSubtitles=true 时烧录（失败回退软字幕）。
   * overlay 轨本期不渲染（EDL 保留决策）。
   */
  async exportTimeline(
    projectId: string,
    dto: ExportTimelineDto,
  ): Promise<ExportTimelineResult> {
    const project = await this.requireProject(projectId);
    const doc = await this.getDocument(projectId);
    const fps = doc.fps > 0 ? doc.fps : 24;
    const width = dto.width ?? doc.width ?? 1080;
    const height = dto.height ?? doc.height ?? 1920;
    const videoClips = doc.clips
      .filter((c) => c.track === 'video' && c.sourceUrl)
      .sort((a, b) => a.timelineStart - b.timelineStart);
    if (videoClips.length === 0) {
      throw new BadRequestException('时间线没有可导出的视频片段：请先生成镜头视频');
    }
    const audioClips = doc.clips
      .filter((c) => c.track === 'audio' && c.sourceUrl)
      .sort((a, b) => a.timelineStart - b.timelineStart);
    const srt = this.buildSrt(doc.clips);
    const burn = dto.burnSubtitles !== false && Boolean(srt.trim());

    const ffmpeg = this.exportService.resolveFfmpegBin();
    const burnBin = burn ? await this.resolveBurnFfmpeg() : null;
    const work = join(tmpdir(), `yimu-timeline-${randomUUID()}`);
    await mkdir(work, { recursive: true });
    const cacheDir = join(uploadDir(), projectId, 'clips');
    const cleanup: string[] = [];

    const run = async (args: string[], bin = ffmpeg) =>
      this.exportService.runFfmpeg(bin, args, work);
    try {
      // 1) 视频片段：统一分辨率/帧率/像素格式（concat 前的必要条件）
      const segments: string[] = [];
      let totalDur = 0;
      for (let i = 0; i < videoClips.length; i += 1) {
        const clip = videoClips[i];
        const src = join(work, `v_src_${String(i).padStart(3, '0')}.mp4`);
        cleanup.push(src);
        // eslint-disable-next-line no-await-in-loop
        const ok = await this.exportService.materializeMediaToFile(clip.sourceUrl as string, src, cacheDir);
        if (!ok) throw new BadRequestException(`片段 ${i + 1} 源媒体下载失败`);
        const span = Math.max(0.05, clip.outPoint - clip.inPoint);
        const speed = clip.speed > 0 ? clip.speed : 1;
        const seg = join(work, `v_seg_${String(i).padStart(3, '0')}.mp4`);
        cleanup.push(seg);
        const vf = [
          `scale=${width}:${height}:force_original_aspect_ratio=decrease`,
          `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black`,
          'setsar=1',
          `fps=${fps}`,
          ...(Math.abs(speed - 1) > 1e-3 ? [`setpts=PTS/${speed}`] : []),
        ].join(',');
        // eslint-disable-next-line no-await-in-loop
        const segOk = await run([
          '-y',
          '-ss', String(Math.max(0, clip.inPoint)),
          '-i', src,
          '-t', String(span),
          '-vf', vf,
          '-an',
          '-c:v', 'libx264',
          '-pix_fmt', 'yuv420p',
          '-preset', 'veryfast',
          '-crf', '20',
          seg,
        ]);
        if (!segOk) throw new BadRequestException(`片段 ${i + 1} 渲染失败（源媒体可能损坏）`);
        segments.push(seg);
        totalDur += span / speed;
      }
      totalDur = round3(totalDur);

      const listPath = join(work, 'list.txt');
      cleanup.push(listPath);
      await writeFile(
        listPath,
        segments.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n'),
        'utf8',
      );
      const concatPath = join(work, 'concat.mp4');
      cleanup.push(concatPath);
      const concatOk = await run([
        '-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', concatPath,
      ]);
      if (!concatOk) throw new BadRequestException('片段拼接失败（编码不一致）');

      // 2) 音频轨：trim + 音量 + 延迟到 timelineStart，多轨 amix
      let audioPath: string | null = null;
      if (audioClips.length > 0) {
        const parts: string[] = [];
        for (let i = 0; i < audioClips.length; i += 1) {
          const a = audioClips[i];
          const src = join(work, `a_src_${String(i).padStart(3, '0')}.m4a`);
          cleanup.push(src);
          // eslint-disable-next-line no-await-in-loop
          const ok = await this.exportService.materializeMediaToFile(a.sourceUrl as string, src, cacheDir);
          if (!ok) {
            this.logger.warn(`音频片段 ${i + 1} 下载失败，跳过`);
            continue;
          }
          const span = Math.max(0.05, a.outPoint - a.inPoint);
          const delayMs = Math.max(0, Math.round(a.timelineStart * 1000));
          const part = join(work, `a_seg_${String(i).padStart(3, '0')}.wav`);
          cleanup.push(part);
          // eslint-disable-next-line no-await-in-loop
          const pOk = await run([
            '-y',
            '-ss', String(Math.max(0, a.inPoint)),
            '-i', src,
            '-t', String(span),
            '-vn',
            '-af', `volume=${Math.min(1, Math.max(0, a.volume))},adelay=${delayMs}|${delayMs}`,
            '-ac', '2', '-ar', '44100', '-c:a', 'pcm_s16le',
            part,
          ]);
          if (pOk) parts.push(part);
        }
        if (parts.length > 0) {
          const mixed = join(work, 'audio_mix.m4a');
          cleanup.push(mixed);
          const inputs = parts.flatMap((p) => ['-i', p]);
          const mixArgs =
            parts.length === 1
              ? ['-y', '-i', parts[0], '-c:a', 'aac', '-b:a', '160k', mixed]
              : [
                  '-y', ...inputs,
                  '-filter_complex', `amix=inputs=${parts.length}:duration=longest:normalize=0`,
                  '-c:a', 'aac', '-b:a', '160k', mixed,
                ];
          const mixOk = await run(mixArgs);
          if (mixOk) audioPath = mixed;
        }
      }

      // 3) 字幕 + 最终封装
      const outName = `final_tl_${randomUUID().slice(0, 8)}.mp4`;
      const outDir = join(uploadDir(), projectId);
      await mkdir(outDir, { recursive: true });
      const outAbs = join(outDir, outName);
      const aigcMeta = ['-metadata', 'comment=AIGC-Generated-By-YIMU-AI-Workshop'];
      let done = false;
      if (burn && burnBin) {
        const assPath = join(work, 'subs.ass');
        cleanup.push(assPath);
        await writeFile(assPath, this.buildAss(doc.clips, width, height), 'utf8');
        const fdir = this.fontDir();
        const vf = `ass=filename=subs.ass${fdir ? `:fontsdir=${fdir}` : ''}`;
        const audioIn = audioPath ? ['-i', audioPath] : [];
        const burnOk = await run(
          [
            '-y', '-i', concatPath, ...audioIn,
            '-vf', vf,
            '-map', '0:v:0',
            ...(audioPath ? ['-map', '1:a:0'] : []),
            '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast', '-crf', '20',
            ...(audioPath ? ['-c:a', 'aac', '-b:a', '160k'] : ['-an']),
            '-t', String(totalDur),
            ...aigcMeta, outAbs,
          ],
          burnBin,
        );
        done = burnOk;
        if (!burnOk) this.logger.warn('字幕烧录失败，回退软字幕封装');
      }
      if (!done) {
        const audioIn = audioPath ? ['-i', audioPath] : [];
        const softOk = srt.trim()
          ? await (async () => {
              const srtPath = join(work, 'soft.srt');
              cleanup.push(srtPath);
              await writeFile(srtPath, srt, 'utf8');
              return run([
                '-y', '-i', concatPath, ...audioIn, '-i', srtPath,
                '-map', '0:v:0',
                ...(audioPath ? ['-map', '1:a:0'] : []),
                '-map', audioPath ? '2:s:0' : '1:s:0',
                '-c:v', 'copy',
                ...(audioPath ? ['-c:a', 'copy'] : ['-an']),
                '-c:s', 'mov_text',
                '-t', String(totalDur),
                ...aigcMeta, outAbs,
              ]);
            })()
          : await run([
              '-y', '-i', concatPath, ...audioIn,
              '-map', '0:v:0',
              ...(audioPath ? ['-map', '1:a:0'] : []),
              '-c:v', 'copy',
              ...(audioPath ? ['-c:a', 'copy'] : ['-an']),
              '-t', String(totalDur),
              ...aigcMeta, outAbs,
            ]);
        done = softOk;
      }
      if (!done) throw new BadRequestException('ffmpeg 导出失败：请检查本机 ffmpeg');

      const st = await stat(outAbs);
      const fileUrl = `/uploads/${projectId}/${outName}`;
      const rows = await this.db
        .insert(assets)
        .values({
          projectId,
          assetType: 'video',
          name: `精剪成片-${project.title}`.slice(0, 120),
          fileUrl,
          filePath: outAbs,
          mimeType: 'video/mp4',
          fileSize: st.size,
          durationSeconds: String(totalDur),
          sourceType: 'generated',
          sourceId: `timeline-export-${randomUUID()}`,
          generationPrompt: `按 EDL 导出 ${segments.length} 段（${audioPath ? '含混音' : '纯画面'}${srt.trim() ? '+字幕' : ''}）`,
          metadata: {
            aigcGenerated: true,
            hasAudio: Boolean(audioPath),
            hasSubtitles: Boolean(srt.trim()),
            timelineExport: true,
          } as never,
          status: 'ready',
        })
        .returning();
      const asset = this.mapAsset(rows[0]);
      this.logger.log(`EDL 导出完成 ${projectId}：${segments.length} 段 → ${fileUrl}（${st.size}B）`);
      return { asset, clips: segments.length, durationSeconds: totalDur };
    } finally {
      for (const f of cleanup) await unlink(f).catch(() => {});
    }
  }

  private mapAsset(row: typeof assets.$inferSelect): Asset {
    return {
      id: row.id,
      projectId: row.projectId,
      assetType: row.assetType as Asset['assetType'],
      name: row.name,
      fileUrl: row.fileUrl ?? undefined,
      filePath: row.filePath ?? undefined,
      mimeType: row.mimeType ?? undefined,
      fileSize: row.fileSize ?? undefined,
      durationSeconds: row.durationSeconds ? Number(row.durationSeconds) : undefined,
      sourceType: row.sourceType ?? 'generated',
      sourceId: row.sourceId ?? undefined,
      generationPrompt: row.generationPrompt ?? undefined,
      version: row.version ?? 1,
      status: row.status ?? 'ready',
      locked: row.locked ?? false,
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.updatedAt),
    } as Asset;
  }
}
