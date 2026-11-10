import { BadRequestException, Injectable, Inject, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID, createHash } from 'crypto';
import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { mkdir, writeFile, unlink, stat, copyFile } from 'fs/promises';
import { join, resolve as resolvePath } from 'path';
import { tmpdir } from 'os';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import {
  projects,
  scenes,
  shots,
  assets,
  qcReports,
} from '@server/database/schema';
import { eq, desc, asc } from 'drizzle-orm';
// 修复（分层）：uploadDir 直接从工具模块导入。
// 旧写法依赖 uploads.controller 里的再导出，而该再导出已删除
// （它逼着导出服务在模块加载期拉起整条 Controller → Service → DI 依赖链）。
import { uploadDir } from '../assets/upload-dir';
import { isSafeExternalUrl, isSafeExternalUrlStatic } from '../../common/url-guard';
import type { Asset } from '@shared/api.interface';

/**
 * P1 导出真实化：分镜 JSON / 字幕 / 发布包为确定性序列化；
 * assembleFinalVideo 用本机 ffmpeg 把镜头成片按镜序拼成一条 MP4 并归档资产。
 */
@Injectable()
export class ExportService {
  private readonly logger = new Logger(ExportService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
  ) {}

  private async requireProject(projectId: string) {
    const rows = await this.db
      .select()
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    if (rows.length === 0) throw new NotFoundException('项目不存在');
    return rows[0];
  }

  /**
   * 导出合成媒体代理：浏览器端 FFmpeg.wasm 直接 fetch 远端 CDN 会被 CORS 拦截
   * （前端表现为 "Failed to fetch"）。本端点以服务端身份取流，前端用同源
   * /export/media?url=... 喂给 fetchFile 即可绕开跨域。
   * 安全：仅放行本项目镜头/资产登记过的 URL（防开放代理），并过 SSRF 守卫。
   */
  async proxyProjectMedia(
    projectId: string,
    rawUrl: string,
  ): Promise<{ buffer: Buffer; mime: string }> {
    await this.requireProject(projectId);
    if (!/^https?:\/\//i.test(rawUrl)) {
      throw new BadRequestException('仅支持 http/https 媒体地址');
    }
    const [shotRows, assetRows] = await Promise.all([
      this.db.select().from(shots).where(eq(shots.projectId, projectId)),
      this.db.select().from(assets).where(eq(assets.projectId, projectId)),
    ]);
    const allowed = new Set<string>();
    for (const s of shotRows) {
      const urls = [
        s.videoUrl, s.voiceUrl, s.startFrameUrl, s.endFrameUrl, s.whitemodelUrl,
        ...(s.sfxUrls ?? []), ...(s.referenceImageUrls ?? []),
      ];
      for (const u of urls) if (u) allowed.add(u);
    }
    for (const a of assetRows) {
      if (a.fileUrl) allowed.add(a.fileUrl);
      if (a.thumbnailUrl) allowed.add(a.thumbnailUrl);
    }
    if (!allowed.has(rawUrl)) {
      throw new BadRequestException('该媒体地址不属于本项目');
    }
    if (!(await isSafeExternalUrl(rawUrl))) {
      throw new BadRequestException('媒体地址被安全策略拦截（仅允许公网 http/https）');
    }
    // Agnes CDN 双域名互为镜像，单域名偶发不可达时切换重试（与资产取流一致）
    const candidates = [rawUrl];
    if (rawUrl.includes('cos-platform-outputs.agnes-ai.cn')) {
      candidates.push(rawUrl.replace('cos-platform-outputs.agnes-ai.cn', 'platform-outputs.agnes-ai.space'));
    }
    if (rawUrl.includes('platform-outputs.agnes-ai.space')) {
      candidates.push(rawUrl.replace('platform-outputs.agnes-ai.space', 'cos-platform-outputs.agnes-ai.cn'));
    }
    let lastErr = '';
    for (const target of [...new Set(candidates)]) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30_000);
      try {
        // eslint-disable-next-line no-await-in-loop
        const resp = await fetch(target, { signal: controller.signal, redirect: 'follow' });
        if (!resp.ok) {
          lastErr = `HTTP ${resp.status}`;
          continue;
        }
        const mime = resp.headers.get('content-type') || 'application/octet-stream';
        // eslint-disable-next-line no-await-in-loop
        const buffer = Buffer.from(await resp.arrayBuffer());
        if (buffer.length > 64) return { buffer, mime };
        lastErr = '响应体过小';
      } catch (e) {
        lastErr = (e as Error).message;
      } finally {
        clearTimeout(timer);
      }
    }
    throw new BadRequestException(`媒体源暂时不可达（${lastErr || 'CDN 超时'}）`);
  }

  async getStoryboard(projectId: string) {
    const project = await this.requireProject(projectId);
    const [sceneRows, shotRows] = await Promise.all([
      this.db
        .select()
        .from(scenes)
        .where(eq(scenes.projectId, projectId))
        .orderBy(asc(scenes.sceneNumber)),
      this.db
        .select()
        .from(shots)
        .where(eq(shots.projectId, projectId))
        .orderBy(asc(shots.shotNumber)),
    ]);
    return {
      project: {
        id: project.id,
        title: project.title,
        status: project.status,
        durationSeconds: project.durationSeconds,
        aspectRatio: project.aspectRatio,
        artStyle: project.artStyle,
        totalCost: Number(project.totalCost ?? 0),
        exportedAt: new Date().toISOString(),
      },
      scenes: sceneRows,
      shots: shotRows,
    };
  }

  async getManifest(projectId: string) {
    const project = await this.requireProject(projectId);
    const [sceneRows, shotRows, assetRows, qcRows] = await Promise.all([
      this.db
        .select({
          id: scenes.id,
          sceneNumber: scenes.sceneNumber,
          title: scenes.title,
        })
        .from(scenes)
        .where(eq(scenes.projectId, projectId))
        .orderBy(asc(scenes.sceneNumber)),
      this.db
        .select({
          id: shots.id,
          sceneId: shots.sceneId,
          shotNumber: shots.shotNumber,
          duration: shots.duration,
          startFrameUrl: shots.startFrameUrl,
          videoUrl: shots.videoUrl,
          voiceUrl: shots.voiceUrl,
          subtitleText: shots.subtitleText,
        })
        .from(shots)
        .where(eq(shots.projectId, projectId))
        .orderBy(asc(shots.shotNumber)),
      this.db
        .select({
          id: assets.id,
          assetType: assets.assetType,
          name: assets.name,
          fileUrl: assets.fileUrl,
        })
        .from(assets)
        .where(eq(assets.projectId, projectId)),
      this.db
        .select({
          overallScore: qcReports.overallScore,
          pass: qcReports.pass,
          createdAt: qcReports.createdAt,
        })
        .from(qcReports)
        .where(eq(qcReports.projectId, projectId))
        .orderBy(desc(qcReports.createdAt))
        .limit(1),
    ]);

    const totalDuration = shotRows.reduce(
      (sum, s) => sum + Number(s.duration ?? 0),
      0,
    );
    return {
      project: {
        id: project.id,
        title: project.title,
        status: project.status,
        aspectRatio: project.aspectRatio,
        artStyle: project.artStyle,
        totalCost: Number(project.totalCost ?? 0),
      },
      counts: {
        scenes: sceneRows.length,
        shots: shotRows.length,
        assets: assetRows.length,
        withVideo: shotRows.filter((s) => s.videoUrl).length,
        withVoice: shotRows.filter((s) => s.voiceUrl).length,
        withSubtitle: shotRows.filter((s) => s.subtitleText).length,
      },
      totalDurationSeconds: Math.round(totalDuration * 10) / 10,
      latestQc:
        qcRows.length > 0
          ? {
              overallScore: qcRows[0].overallScore ?? 0,
              pass: qcRows[0].pass ?? false,
              createdAt: qcRows[0].createdAt.toISOString(),
            }
          : null,
      scenes: sceneRows,
      shots: shotRows,
      assets: assetRows,
      exportedAt: new Date().toISOString(),
    };
  }

  /**
   * P1-2 卡拉 OK 字幕 ASS（移植 ai-shorts-generator captions.py/assemble.py）。
   * 分行：标点优先断句，每行 ≤15 字；逐字 {\k} 高亮沿时间轴均分。
   * 诚实边界：均分≠语音对齐（shorts 用 faster-whisper word_timestamps + difflib
   * 对脚本纠错，我们无词级时间戳，TTS 回传词级时长后可升级为真对齐）。
   * 烧录：ffmpeg -vf "ass=karaoke.ass:fontsdir=./fonts"（短视频竖屏用 1080x1920 头）。
   */
  async getKaraokeAss(projectId: string): Promise<string> {
    const project = await this.requireProject(projectId);
    const shotRows = await this.db
      .select({
        shotNumber: shots.shotNumber,
        duration: shots.duration,
        dialogue: shots.dialogue,
        subtitleText: shots.subtitleText,
      })
      .from(shots)
      .where(eq(shots.projectId, projectId))
      .orderBy(asc(shots.shotNumber));

    const vertical = (project.aspectRatio ?? '9:16') === '9:16';
    const playResX = vertical ? 1080 : 1920;
    const playResY = vertical ? 1920 : 1080;
    const fontSize = vertical ? 84 : 64;
    const marginV = vertical ? 620 : 120;
    const header = `[Script Info]
Title: ${project.title ?? 'yimu'}-karaoke
ScriptType: v4.00+
PlayResX: ${playResX}
PlayResY: ${playResY}
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Karaoke,Noto Sans CJK SC,${fontSize},&H00FFFFFF,&H0000FFFF,&H80000000,&H80000000,0,0,0,0,100,100,0,0,1,7,5,2,40,40,${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

    let cursor = 0;
    const events: string[] = [];
    for (const s of shotRows) {
      const dur = Math.max(0.5, Number(s.duration ?? 0) || 4);
      const text = (s.subtitleText || s.dialogue || '').trim().replace(/\s+/g, '');
      const start = cursor;
      cursor += dur;
      if (!text) continue;
      // 标点优先断句，每行 ≤15 字（shorts captions.py:55-75 的中文等价版）
      const lines = this.splitKaraokeLines(text, 15);
      const totalChars = lines.join('').length || 1;
      let t = start;
      for (const line of lines) {
        const lineDur = (dur * line.length) / totalChars;
        const end = t + lineDur;
        const csPerChar = Math.max(1, Math.round(((lineDur / line.length) * 100)));
        const kara = [...line].map((ch) => `{\\k${csPerChar}}${ch}`).join('');
        events.push(
          `Dialogue: 0,${this.formatAssTime(t)},${this.formatAssTime(end)},Karaoke,,0,0,0,,${kara}`,
        );
        t = end;
      }
    }
    return header + events.join('\n') + '\n';
  }

  /** 标点优先断句：，；。！？… 断行，超长行硬切 15 字 */
  private splitKaraokeLines(text: string, maxLen: number): string[] {
    const parts = text.split(/(?<=[，。；。！？…!?,;])/g).map((s) => s.trim()).filter(Boolean);
    const lines: string[] = [];
    for (const p of parts) {
      if (p.length <= maxLen) {
        lines.push(p);
        continue;
      }
      for (let i = 0; i < p.length; i += maxLen) lines.push(p.slice(i, i + maxLen));
    }
    return lines.length > 0 ? lines : [text];
  }

  private formatAssTime(totalSeconds: number): string {
    const cs = Math.max(0, Math.round(totalSeconds * 100));
    const h = Math.floor(cs / 360000);
    const mm = Math.floor((cs % 360000) / 6000);
    const s = Math.floor((cs % 6000) / 100);
    const c = cs % 100;
    const pad = (n: number, w: number) => String(n).padStart(w, '0');
    return `${h}:${pad(mm, 2)}:${pad(s, 2)}.${pad(c, 2)}`;
  }

  /** 按镜头时长累加生成 SRT（无对白/字幕的镜头跳过，时间轴连续） */
  async getSubtitles(projectId: string): Promise<string> {
    await this.requireProject(projectId);
    const shotRows = await this.db
      .select({
        shotNumber: shots.shotNumber,
        duration: shots.duration,
        dialogue: shots.dialogue,
        subtitleText: shots.subtitleText,
      })
      .from(shots)
      .where(eq(shots.projectId, projectId))
      .orderBy(asc(shots.shotNumber));

    let cursor = 0;
    let index = 0;
    const blocks: string[] = [];
    for (const s of shotRows) {
      const dur = Math.max(0.5, Number(s.duration ?? 0) || 4);
      const text = (s.subtitleText || s.dialogue || '').trim();
      const start = cursor;
      cursor += dur;
      if (!text) continue;
      index += 1;
      blocks.push(
        `${index}\n${this.formatSrtTime(start)} --> ${this.formatSrtTime(cursor)}\n${text}\n`,
      );
    }
    return blocks.join('\n');
  }

  /**
   * P2-3 发布包 metadata（移植 ai-shorts metadata.txt 思想的模板版）：
   * 按平台（抖音/视频号/快手/B站/TikTok/Shorts/YouTube）生成标题/简介/话题，
   * 内容来自项目真实数据（标题/类型/时长/镜数），话题为固定池+类型词，
   * 非 AI 撰写，发布前请人工改一版。
   */
  async getPublishPack(projectId: string): Promise<string> {
    const project = await this.requireProject(projectId);
    const shotRows = await this.db
      .select({
        shotNumber: shots.shotNumber,
        duration: shots.duration,
        subtitleText: shots.subtitleText,
        dialogue: shots.dialogue,
      })
      .from(shots)
      .where(eq(shots.projectId, projectId))
      .orderBy(asc(shots.shotNumber));
    const total = shotRows.reduce((s, r) => s + (Number(r.duration) || 0), 0);
    const title = project.title || '未命名作品';
    const cm = (project as { contentMode?: string }).contentMode ?? 'general';
    const kind = cm === 'ads' ? '广告' : cm === 'drama' ? '短剧' : '通用';
    const vertical = (project.aspectRatio ?? '9:16') === '9:16';
    const tags = ['AI短剧', 'AIGC', kind, `${Math.round(total)}秒`, project.genre ?? '原创']
      .filter(Boolean)
      .map((t) => `#${t}`)
      .join(' ');
    const firstLine = shotRows
      .map((s) => (s.subtitleText || s.dialogue || '').trim())
      .find(Boolean) ?? '';
    const platforms: { name: string; format: string; note: string }[] = [
      { name: '抖音', format: '9:16', note: '前3秒钩子决定生死，标题≤20字，带2-3个话题' },
      { name: '视频号', format: '9:16', note: '封面首帧即广告位，简介可稍长' },
      { name: '快手', format: '9:16', note: '老铁语气，评论区引导' },
      { name: 'B站', format: vertical ? '9:16' : '16:9', note: '可投竖屏区，简介写制作方式易获推荐' },
      { name: 'TikTok', format: '9:16', note: '英文标题另起，首帧无文字' },
      { name: 'YouTube Shorts', format: '9:16', note: '标题英文+中文双语，描述挂系列合集' },
    ];
    const out: string[] = [
      `一幕·YIMU AI 短剧创作平台发布包 · ${title}`,
      `类型：${kind} · 总时长 ${Math.round(total)}s · ${shotRows.length} 镜 · 画幅 ${project.aspectRatio ?? '9:16'}`,
      `开场钩子句：${firstLine || '（首镜无对白，建议补钩子）'}`,
      '',
    ];
    for (const p of platforms) {
      out.push(
        `【${p.name}｜${p.format}】`,
        `标题：${title}`,
        `简介：${kind}《${title}》${firstLine ? `——${firstLine.slice(0, 30)}` : ''}（模板生成，发布前人工改一版）`,
        `话题：${tags}`,
        `提示：${p.note}`,
        '',
      );
    }
    return out.join('\n');
  }

  /**
   * F1 剪映草稿（对齐 pyJianYingDraft SDK + ArcReel 配方）：
   * - 直接返回 draft_content.json 本体（去掉旧 {meta,draft} 包裹层；旧版为实验格式）
   * - 三轨 video/text"字幕"/audio"旁白"，target/source_timerange 微秒，volume 视频1.0/旁白1.4
   * - 相邻视频段之间叠化转场（effect 322577，500ms，is_overlap，与 SDK 常量一致）
   * - 字幕样式抄 ArcReel：白字加粗、黑描边30、阴影、底部 -0.75 定位、max_line_width
   * - 远端 path 仍需下载到本地后替换（剪映只认本地路径），CapCut 未验证
   */
  async getJianyingDraft(projectId: string): Promise<unknown> {
    const project = await this.requireProject(projectId);
    const shotRows = await this.db
      .select({
        shotNumber: shots.shotNumber,
        duration: shots.duration,
        videoUrl: shots.videoUrl,
        voiceUrl: shots.voiceUrl,
        subtitleText: shots.subtitleText,
        dialogue: shots.dialogue,
      })
      .from(shots)
      .where(eq(shots.projectId, projectId))
      .orderBy(asc(shots.shotNumber));

    const vertical = (project.aspectRatio ?? '9:16') !== '16:9';
    const width = vertical ? 1080 : 1920;
    const height = vertical ? 1920 : 1080;
    const toUs = (sec: number) => Math.round(sec * 1_000_000);
    const basename = (url: string) => {
      try {
        const p = new URL(url).pathname.split('/').filter(Boolean).pop() ?? 'media';
        return decodeURIComponent(p).slice(0, 80) || 'media';
      } catch {
        return url.slice(-80);
      }
    };
    // 字幕样式常量：抄 ArcReel jianying_draft_service.py:136-152（SDK 实测值）
    const textSize = vertical ? 12.0 : 8.0;
    const lineMaxWidth = vertical ? 0.82 : 0.6;
    const subtitleY = vertical ? -0.75 : -0.8;

    const videos: unknown[] = [];
    const audios: unknown[] = [];
    const texts: unknown[] = [];
    const transitions: unknown[] = [];
    const speeds: unknown[] = [];
    const videoSegments: unknown[] = [];
    const audioSegments: unknown[] = [];
    const textSegments: unknown[] = [];
    let totalUs = 0;

    const baseSeg = () => ({
      visible: true,
      id: randomUUID(),
      common_keyframes: [],
      keyframe_refs: [],
      speed: 1.0,
      enable_adjust: true,
      enable_color_correct_adjust: false,
      enable_color_curves: true,
      enable_color_match_adjust: false,
      enable_color_wheels: true,
      enable_lut: true,
      enable_smart_color_adjust: false,
      is_tone_modify: false,
      track_attribute: 0,
      track_render_index: 0,
      render_index: 0,
      uniform_scale: { on: true, value: 1.0 },
    });
    const fullCrop = () => ({
      upper_left_x: 0.0, upper_left_y: 0.0, upper_right_x: 1.0, upper_right_y: 0.0,
      lower_left_x: 0.0, lower_left_y: 1.0, lower_right_x: 1.0, lower_right_y: 1.0,
    });

    const videoShots = shotRows.filter((s) => s.videoUrl);
    // 单 cursor 时间轴：无视频的镜头在视频轨留空隙，旁白/字幕仍按镜位对齐
    const slotOf = new Map<number, { startUs: number; durUs: number }>();
    {
      let c = 0;
      for (const s of shotRows) {
        const dur = Math.max(0.5, Number(s.duration ?? 0) || 4);
        slotOf.set(s.shotNumber, { startUs: toUs(c), durUs: toUs(dur) });
        c += dur;
        totalUs += toUs(dur);
      }
    }
    videoShots.forEach((s, idx) => {
      const slot = slotOf.get(s.shotNumber) as { startUs: number; durUs: number };
      const { startUs, durUs } = slot;
      const vid = randomUUID();
      videos.push({
        audio_fade: null,
        category_id: '',
        category_name: 'local',
        check_flag: 63487,
        crop: fullCrop(),
        crop_ratio: 'free',
        crop_scale: 1.0,
        duration: durUs,
        height,
        id: vid,
        local_material_id: '',
        material_id: vid,
        material_name: basename(s.videoUrl as string),
        media_path: '',
        path: s.videoUrl,
        type: 'video',
        width,
      });
      const speedId = randomUUID();
      speeds.push({ curve_speed: null, id: speedId, mode: 0, speed: 1.0, type: 'speed' });
      const extraRefs: string[] = [speedId];
      if (idx < videoShots.length - 1) {
        const trId = randomUUID();
        transitions.push({
          category_id: '',
          category_name: '',
          duration: 500000,
          effect_id: '322577',
          id: trId,
          is_overlap: true,
          name: '叠化',
          platform: 'all',
          resource_id: '6724845717472416269',
          type: 'transition',
        });
        extraRefs.push(trId);
      }
      videoSegments.push({
        ...baseSeg(),
        material_id: vid,
        target_timerange: { start: startUs, duration: durUs },
        source_timerange: { start: 0, duration: durUs },
        volume: 1.0,
        last_nonzero_volume: 1.0,
        reverse: false,
        extra_material_refs: extraRefs,
        clip: {
          alpha: 1.0,
          flip: { horizontal: false, vertical: false },
          rotation: 0.0,
          scale: { x: 1.0, y: 1.0 },
          transform: { x: 0.0, y: 0.0 },
        },
        hdr_settings: { intensity: 1.0, mode: 1, nits: 1000 },
      });
    });

    // 旁白轨与字幕轨：与视频轨同一 cursor（无视频镜位留空隙，对齐不漂移）
    for (const s of shotRows) {
      const slot = slotOf.get(s.shotNumber) as { startUs: number; durUs: number };
      const { startUs, durUs } = slot;
      if (s.voiceUrl) {
        const aid = randomUUID();
        audios.push({
          app_id: 0,
          category_id: '',
          category_name: 'local',
          check_flag: 3,
          copyright_limit_type: 'none',
          duration: durUs,
          effect_id: '',
          formula_id: '',
          id: aid,
          local_material_id: aid,
          music_id: aid,
          name: basename(s.voiceUrl),
          path: s.voiceUrl,
          source_platform: 0,
          type: 'extract_music',
          wave_points: [],
        });
        audioSegments.push({
          ...baseSeg(),
          material_id: aid,
          target_timerange: { start: startUs, duration: durUs },
          source_timerange: { start: 0, duration: durUs },
          volume: 1.4,
          last_nonzero_volume: 1.4,
          reverse: false,
          extra_material_refs: [],
          // golden 对照：audio 段无 uniform_scale，有 hdr_settings
          uniform_scale: undefined,
          hdr_settings: { intensity: 1.0, mode: 1, nits: 1000 },
          clip: {
            alpha: 1.0,
            flip: { horizontal: false, vertical: false },
            rotation: 0.0,
            scale: { x: 1.0, y: 1.0 },
            transform: { x: 0.0, y: 0.0 },
          },
        });
      }
      const text = (s.subtitleText || s.dialogue || '').trim();
      if (text) {
        const tid = randomUUID();
        texts.push({
          id: tid,
          content: JSON.stringify({
            styles: [
              {
                fill: { alpha: 1.0, content: { render_type: 'solid', solid: { alpha: 1.0, color: [1.0, 1.0, 1.0] } } },
                range: [0, text.length],
                size: textSize,
                bold: true,
                italic: false,
                underline: false,
                strokes: [
                  { content: { solid: { alpha: 1.0, color: [0.0, 0.0, 0.0] } }, width: 0.06 },
                ],
                shadows: [
                  { diffuse: 0.013333333333333334, alpha: 0.7, distance: 3.0, content: { solid: { color: [0.0, 0.0, 0.0] } }, angle: -45.0 },
                ],
              },
            ],
            text,
          }),
          typesetting: 0,
          alignment: 1,
          letter_spacing: 0.0,
          line_spacing: 0.02,
          line_feed: 1,
          line_max_width: lineMaxWidth,
          force_apply_line_max_width: false,
          check_flag: 47,
          type: 'subtitle',
          global_alpha: 1.0,
        });
        textSegments.push({
          ...baseSeg(),
          material_id: tid,
          target_timerange: { start: startUs, duration: durUs },
          source_timerange: null,
          volume: 1.0,
          last_nonzero_volume: 1.0,
          reverse: false,
          extra_material_refs: [],
          clip: {
            alpha: 1.0,
            flip: { horizontal: false, vertical: false },
            rotation: 0.0,
            scale: { x: 1.0, y: 1.0 },
            transform: { x: 0.0, y: subtitleY },
          },
        });
      }
    }

    // 素材组：SDK 会导出全量分组，空数组占位保证导入器不缺 key
    const emptyGroups = [
      'ai_translates', 'audio_balances', 'audio_effects', 'audio_fades',
      'audio_track_indexes', 'beats', 'canvases', 'chromas', 'color_curves',
      'digital_humans', 'drafts', 'effects', 'flowers', 'green_screens',
      'handwrites', 'hsl', 'images', 'log_color_wheels', 'loudnesses',
      'manual_deformations', 'masks', 'material_animations', 'material_colors',
      'multi_language_refs', 'placeholders', 'plugin_effects',
      'primary_color_wheels', 'realtime_denoises', 'shapes', 'smart_crops',
      'smart_relights', 'sound_channel_mappings', 'speeds_placeholder',
      'stickers', 'tail_leaders', 'text_templates', 'time_marks',
      'video_effects', 'video_trackings', 'vocal_beautifys', 'vocal_separations',
    ];
    const materials: Record<string, unknown> = {
      videos, audios, texts, transitions, speeds,
    };
    for (const g of emptyGroups) materials[g] = [];
    // 注：speeds 已有真实条目，speeds_placeholder 仅为防缺 key 的空位（导入器宽容即无害）

    return {
      canvas_config: { width, height, ratio: 'original' },
      color_space: -1,
      create_time: Math.floor(Date.now() / 1000),
      duration: totalUs,
      fps: 30,
      id: randomUUID(),
      keyframes: {},
      keyframe_graph_list: [],
      version: 360000,
      materials,
      tracks: [
        { id: randomUUID(), type: 'video', name: 'video', render_index: null, segments: videoSegments },
        { id: randomUUID(), type: 'text', name: '字幕', render_index: null, segments: textSegments },
        { id: randomUUID(), type: 'audio', name: '旁白', render_index: null, segments: audioSegments },
      ],
    };
  }

  private formatSrtTime(totalSeconds: number): string {
    const ms = Math.round(totalSeconds * 1000);
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    const rest = ms % 1000;
    const pad = (v: number, len: number) => String(v).padStart(len, '0');
    return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)},${pad(rest, 3)}`;
  }

  /**
   * 跨平台探测 ffmpeg 可执行文件路径（消除硬编码 /Users/shanziya/.local/bin/ffmpeg）。
   * public：线性剪辑 EDL 导出（TimelineExportService）复用同一探测逻辑。
   */
  resolveFfmpegBin(): string {
    if (process.env.FFMPEG_PATH && process.env.FFMPEG_PATH.trim()) {
      return process.env.FFMPEG_PATH.trim();
    }
    if (process.platform === 'darwin') {
      const home = process.env.HOME ?? '';
      const candidates = [
        '/opt/homebrew/bin/ffmpeg',
        '/usr/local/bin/ffmpeg',
        ...(home ? [`${home}/.local/bin/ffmpeg`] : []),
      ];
      for (const c of candidates) {
        if (existsSync(c)) return c;
      }
    }
    return 'ffmpeg';
  }

  /**
   * SSRF 防护：校验外部媒体 URL 必须为公网 http(s) 地址，禁止访问回环、私网与云元数据地址。
   * W7 起委托共享守卫 server/common/url-guard（数字 IP 变体、IPv6、DNS 解析复检均已覆盖）。
   */
  public isSafeExternalUrl(rawUrl: string): boolean {
    return isSafeExternalUrlStatic(rawUrl);
  }

  /** 异步完整校验（含 DNS 解析复检），媒体下载入口使用 */
  public async checkExternalUrl(rawUrl: string): Promise<boolean> {
    return isSafeExternalUrl(rawUrl);
  }

  /**
   * 将本地 /uploads/ 路径、data: Base64 URI 或安全公网 URL 物化为本地临时文件。
   * public：线性剪辑 EDL 导出复用（http(s) 走 downloadClip：SSRF 守卫 + Agnes 双镜像 fallback）。
   */
  async materializeMediaToFile(
    url: string,
    dest: string,
    cacheDir?: string,
  ): Promise<boolean> {
    const trimmed = url.trim();
    // 1. data: URI
    if (trimmed.startsWith('data:')) {
      const commaIdx = trimmed.indexOf(',');
      if (commaIdx < 0) return false;
      const b64 = trimmed.slice(commaIdx + 1);
      const buf = Buffer.from(b64, 'base64');
      if (buf.length < 128) return false;
      await writeFile(dest, buf);
      return true;
    }
    // 2. 本地 /uploads/ 相对路径（防目录穿越）
    if (trimmed.startsWith('/uploads/')) {
      const rel = trimmed.replace(/^\/uploads\/+/, '');
      const baseDir = resolvePath(uploadDir());
      const abs = resolvePath(baseDir, rel);
      if (!abs.startsWith(baseDir) || !existsSync(abs)) return false;
      await copyFile(abs, dest);
      return true;
    }
    // 3. 公网 http(s) URL（带缓存与 SSRF 防护）
    if (cacheDir) {
      await mkdir(cacheDir, { recursive: true });
      const cacheKey = createHash('sha1').update(trimmed).digest('hex').slice(0, 16);
      const cachePath = join(cacheDir, `${cacheKey}.media`);
      const cachedSize = await stat(cachePath).then((s) => s.size).catch(() => 0);
      if (cachedSize >= 1024) {
        await copyFile(cachePath, dest);
        return true;
      }
      const ok = await this.downloadClip(trimmed, dest, 60_000, 4);
      if (ok) {
        await copyFile(dest, cachePath).catch(() => {});
      }
      return ok;
    }
    return this.downloadClip(trimmed, dest, 60_000, 4);
  }

  /**
   * 服务端成片（升级版）：按镜序下载镜头成片 + 混流各镜 TTS 配音轨（voiceUrl）+ 烧录/封装字幕 + 写入 AIGC 合规元数据。
   * 可拼片段不足时 400 明示；成功返回资产（项目资产页直接可见）。
   */
  async assembleFinalVideo(projectId: string): Promise<{ asset: Asset; clips: number; durationSeconds: number }> {
    const project = await this.requireProject(projectId);
    const shotRows = await this.db
      .select({
        id: shots.id,
        sceneId: shots.sceneId,
        sceneSort: scenes.sortOrder,
        shotNumber: shots.shotNumber,
        duration: shots.duration,
        videoUrl: shots.videoUrl,
        voiceUrl: shots.voiceUrl,
        dialogue: shots.dialogue,
        subtitleText: shots.subtitleText,
      })
      .from(shots)
      .innerJoin(scenes, eq(shots.sceneId, scenes.id))
      .where(eq(shots.projectId, projectId))
      .orderBy(asc(scenes.sceneNumber), asc(shots.shotNumber));
    const withVideo = shotRows.filter((s) => s.videoUrl);
    if (withVideo.length === 0) {
      throw new BadRequestException('暂无镜头成片可合成：请先生成视频');
    }
    // 镜号按场内递增：必须 场序→镜序 排，否则跨场穿插
    withVideo.sort((a, b) => {
      if (a.sceneSort !== b.sceneSort) return a.sceneSort - b.sceneSort;
      return a.shotNumber - b.shotNumber;
    });

    const ffmpegBin = this.resolveFfmpegBin();
    const work = join(tmpdir(), `yimu-assemble-${randomUUID()}`);
    await mkdir(work, { recursive: true });
    const listPath = join(work, 'list.txt');
    const lines: string[] = [];
    let downloaded = 0;
    const hasAnyVoice = withVideo.some((s) => Boolean(s.voiceUrl));
    const cleanup: string[] = [];
    try {
      const cacheDir = join(uploadDir(), projectId, 'clips');
      for (let i = 0; i < withVideo.length; i += 1) {
        const clip = withVideo[i];
        const url = clip.videoUrl as string;
        const rawLocal = join(work, `clip_raw_${String(i).padStart(3, '0')}.mp4`);
        cleanup.push(rawLocal);
        // eslint-disable-next-line no-await-in-loop
        const ok = await this.materializeMediaToFile(url, rawLocal, cacheDir);
        if (!ok) throw new BadRequestException(`下载镜头 ${clip.shotNumber} 成片失败`);
        // eslint-disable-next-line no-await-in-loop
        const st = await stat(rawLocal);
        if (st.size < 1024) throw new BadRequestException(`镜头 ${clip.shotNumber} 成片文件异常（过小）`);

        let segmentForConcat = rawLocal;
        // 若全片存在配音，则将每个镜头统一混流为带 AAC 音轨的片段（有 voiceUrl 混入配音，无则补静音轨保证 concat 音轨一致）
        if (hasAnyVoice) {
          const muxedLocal = join(work, `clip_mux_${String(i).padStart(3, '0')}.mp4`);
          cleanup.push(muxedLocal);
          let voiceLocal: string | null = null;
          if (clip.voiceUrl) {
            const candidateVoice = join(work, `voice_${String(i).padStart(3, '0')}.wav`);
            cleanup.push(candidateVoice);
            // eslint-disable-next-line no-await-in-loop
            const voiceOk = await this.materializeMediaToFile(clip.voiceUrl, candidateVoice, cacheDir);
            if (voiceOk) voiceLocal = candidateVoice;
          }
          const muxArgs = voiceLocal
            ? [
                '-y', '-i', rawLocal, '-i', voiceLocal,
                '-map', '0:v:0', '-map', '1:a:0',
                '-c:v', 'copy', '-c:a', 'aac', '-ar', '44100', '-ac', '2',
                '-shortest', muxedLocal,
              ]
            : [
                '-y', '-i', rawLocal,
                '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
                '-map', '0:v:0', '-map', '1:a:0',
                '-c:v', 'copy', '-c:a', 'aac', '-ar', '44100', '-ac', '2',
                '-shortest', muxedLocal,
              ];
          // eslint-disable-next-line no-await-in-loop
          const muxOk = await this.runFfmpeg(ffmpegBin, muxArgs, work);
          if (muxOk) segmentForConcat = muxedLocal;
        }

        lines.push(`file '${segmentForConcat.replace(/'/g, "'\\''")}'`);
        downloaded += 1;
      }
      await writeFile(listPath, lines.join('\n'), 'utf8');
      cleanup.push(listPath);

      // 生成 SRT 字幕文件供软字幕封装或同目录归档
      const srtContent = await this.getSubtitles(projectId).catch(() => '');
      const srtPath = join(work, 'subtitles.srt');
      const hasSrt = Boolean(srtContent.trim());
      if (hasSrt) {
        await writeFile(srtPath, srtContent, 'utf8');
        cleanup.push(srtPath);
      }

      const outName = `final_${randomUUID().slice(0, 8)}.mp4`;
      const dir = join(uploadDir(), projectId);
      await mkdir(dir, { recursive: true });
      const outAbs = join(dir, outName);
      const aigcMeta = ['-metadata', 'comment=AIGC-Generated-By-YIMU-AI-Workshop'];
      // 先试流拷贝（同源片段通常同编码）；若含软字幕则一并封装 mov_text
      const copyArgs = hasSrt
        ? [
            '-y', '-f', 'concat', '-safe', '0', '-i', listPath,
            '-i', srtPath,
            '-c:v', 'copy', '-c:a', 'copy', '-c:s', 'mov_text',
            ...aigcMeta, outAbs,
          ]
        : ['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', ...aigcMeta, outAbs];
      const copyOk = await this.runFfmpeg(ffmpegBin, copyArgs, work);
      if (!copyOk) {
        // 重编码兜底：保留音轨（若存在配音），不再一刀切 -an 抹除声音
        const reArgs = [
          '-y', '-f', 'concat', '-safe', '0', '-i', listPath,
          '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
          '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast',
          ...(hasAnyVoice ? ['-c:a', 'aac', '-b:a', '128k'] : ['-an']),
          ...aigcMeta,
          outAbs,
        ];
        const reOk = await this.runFfmpeg(ffmpegBin, reArgs, work);
        if (!reOk) {
          // 终极兜底：纯视频合成
          const fallbackArgs = [
            '-y', '-f', 'concat', '-safe', '0', '-i', listPath,
            '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
            '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast',
            '-an', ...aigcMeta, outAbs,
          ];
          const fbOk = await this.runFfmpeg(ffmpegBin, fallbackArgs, work);
          if (!fbOk) throw new BadRequestException('ffmpeg 合成失败：请检查本机 ffmpeg 与片段编码');
        }
      }
      const outStat = await stat(outAbs);
      const durationSeconds = Number(
        withVideo.reduce((sum, s) => sum + (Number(s.duration) > 0 ? Number(s.duration) : 0), 0).toFixed(1),
      ) || undefined;
      const fileUrl = `/uploads/${projectId}/${outName}`;
      const rows = await this.db
        .insert(assets)
        .values({
          projectId,
          assetType: 'video',
          name: `成片-${project.title}`.slice(0, 120),
          fileUrl,
          filePath: outAbs,
          mimeType: 'video/mp4',
          fileSize: outStat.size,
          durationSeconds: durationSeconds !== undefined ? String(durationSeconds) : undefined,
          sourceType: 'generated',
          sourceId: `assemble-${randomUUID()}`,
          generationPrompt: `服务端拼接 ${downloaded} 条镜头成片（${hasAnyVoice ? '含配音音轨混流' : '纯画面'}${hasSrt ? '+内嵌字幕轨' : ''}）`,
          metadata: { aigcGenerated: true, hasAudio: hasAnyVoice, hasSubtitles: hasSrt } as any,
          status: 'ready',
        })
        .returning();
      this.logger.log(`成片合成完成 ${projectId}：${downloaded} 片 → ${fileUrl}（${outStat.size}B）`);
      const mapped = {
        id: rows[0].id,
        projectId,
        assetType: rows[0].assetType,
        name: rows[0].name,
        fileUrl: rows[0].fileUrl ?? undefined,
        filePath: rows[0].filePath ?? undefined,
        mimeType: rows[0].mimeType ?? undefined,
        fileSize: rows[0].fileSize ?? undefined,
        durationSeconds: rows[0].durationSeconds ? Number(rows[0].durationSeconds) : undefined,
        sourceType: rows[0].sourceType ?? 'generated',
        sourceId: rows[0].sourceId ?? undefined,
        generationPrompt: rows[0].generationPrompt ?? undefined,
        version: rows[0].version ?? 1,
        status: rows[0].status ?? 'ready',
        locked: rows[0].locked ?? false,
        createdAt: (rows[0].createdAt as Date)?.toISOString?.() ?? new Date().toISOString(),
        updatedAt: (rows[0].updatedAt as Date)?.toISOString?.() ?? new Date().toISOString(),
      } as Asset;
      return { asset: mapped, clips: downloaded, durationSeconds: durationSeconds ?? 0 };
    } finally {
      for (const f of cleanup) await unlink(f).catch(() => {});
      await unlink(join(work, 'list.txt')).catch(() => {});
    }
  }

  /** curl 拉取镜头成片：带 SSRF 校验，.cn/.space 互为镜像优先 space，退避重试；curl 失败走 node fetch */
  private async downloadClip(url: string, dest: string, timeoutMs: number, retries: number): Promise<boolean> {
    if (!(await this.checkExternalUrl(url))) {
      this.logger.warn(`拦截不安全的外部媒体 URL（SSRF 防护）: ${url.slice(0, 100)}`);
      return false;
    }
    const candidates = [
      url.replace('cos-platform-outputs.agnes-ai.cn', 'platform-outputs.agnes-ai.space'),
      url.replace('platform-outputs.agnes-ai.space', 'cos-platform-outputs.agnes-ai.cn'),
      url,
    ].filter((u) => isSafeExternalUrlStatic(u));
    const unique = [...new Set(candidates)];
    if (unique.length === 0) return false;
    const timeoutSec = Math.max(20, Math.ceil(timeoutMs / 1000));
    for (let attempt = 0; attempt < retries; attempt += 1) {
      const target = unique[attempt % unique.length];
      const viaCurl = await this.curlOnce(target, dest, timeoutSec);
      if (viaCurl.ok) return true;
      this.logger.warn(`curl 下载失败 attempt=${attempt + 1} exit=${viaCurl.code} url=${target.slice(0, 80)}: ${viaCurl.err.slice(0, 160)}`);
      if (attempt === 1) {
        // 第 2 次失败后补一次 node fetch（不同网络栈）
        const viaFetch = await this.fetchClip(url, dest, timeoutMs);
        if (viaFetch) return true;
        this.logger.warn(`fetch 兜底下载失败 url=${url.slice(0, 80)}`);
      }
      if (attempt < retries - 1) await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    }
    return false;
  }

  private curlOnce(url: string, dest: string, timeoutSec: number): Promise<{ ok: boolean; code: number | null; err: string }> {
    const curlBin = process.platform === 'win32' ? 'curl.exe' : 'curl';
    return new Promise((resolve) => {
      const child = spawn(
        curlBin,
        ['-sS', '-f', '-L', '--proto', '=http,https', '--connect-timeout', '15', '--max-time', String(timeoutSec), '-o', dest, url],
        { stdio: ['ignore', 'ignore', 'pipe'] },
      );
      let err = '';
      child.stderr.on('data', (d: Buffer) => { err += d.toString(); });
      child.on('error', (e) => resolve({ ok: false, code: null, err: e.message }));
      child.on('close', (code) => resolve({ ok: code === 0, code, err }));
    });
  }

  private async fetchClip(url: string, dest: string, timeoutMs: number): Promise<boolean> {
    if (!(await this.checkExternalUrl(url))) return false;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), redirect: 'follow' });
      if (!res.ok) return false;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 1024) return false;
      await writeFile(dest, buf);
      return true;
    } catch {
      return false;
    }
  }

  /** public：线性剪辑 EDL 导出复用同一 ffmpeg 执行器（失败返回 false 并记 stderr 尾部） */
  runFfmpeg(bin: string, args: string[], cwd: string): Promise<boolean> {
    return new Promise((resolve) => {
      const child = spawn(bin, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
      let err = '';
      child.stderr.on('data', (d: Buffer) => { err += d.toString(); });
      child.on('error', () => resolve(false));
      child.on('close', (code) => {
        if (code !== 0) this.logger.warn(`ffmpeg exit ${code}: ${err.slice(-400)}`);
        resolve(code === 0);
      });
    });
  }
}
