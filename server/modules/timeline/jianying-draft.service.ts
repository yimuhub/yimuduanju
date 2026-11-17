/**
 * 剪映草稿导出：把 EDL 打成可放进剪映草稿目录的 ZIP。
 * 目录结构：draft_content.json / draft_meta_info.json / draft_virtual_store.json / Resources/
 */
import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { mkdir, rm, writeFile } from 'fs/promises';
import { join, extname, basename } from 'path';
import { tmpdir } from 'os';
import { assets, projects } from '@server/database/schema';
import { buildJianyingDraftContent, buildJianyingMeta } from '@shared/jianying-draft';
import type { TimelineClip, TimelineDocument } from '@shared/api.interface';
import { ExportService } from '../export/export.service';
import { TimelineService } from './timeline.service';
import { zipDirectory } from './zip';

const IMAGE_EXT = /\.(png|jpe?g|webp|bmp|gif|tiff?)$/i;

@Injectable()
export class JianyingDraftService {
  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    private readonly timeline: TimelineService,
    private readonly exportService: ExportService,
  ) {}

  async exportZip(projectId: string): Promise<{ filename: string; path: string; cleanup: () => Promise<void> }> {
    const doc = await this.timeline.getDocument(projectId);
    const rows = await this.db
      .select({ title: projects.title })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    if (!rows.length) throw new NotFoundException('项目不存在');
    const draftId = randomUUID();
    const name = rows[0].title || '一幕神剪草稿';
    const dir = join(tmpdir(), `yimu-draft-${draftId.slice(0, 8)}`);
    const out = join(tmpdir(), `yimu-draft-${draftId.slice(0, 8)}.zip`);
    await mkdir(join(dir, 'Resources'), { recursive: true });
    const resources: Record<string, string> = {};
    const mediaSize: Record<string, { width: number; height: number; duration: number; type: 'video' | 'photo' }> = {};
    try {
      const sources = uniqueSources(doc);
      let seq = 0;
      for (const source of sources) {
        const image = await this.isImage(projectId, source);
        const ext = image ? safeImageExt(source) : '.mp4';
        const file = `${String(seq).padStart(3, '0')}-${basename(source.split('?')[0], extname(source.split('?')[0])).slice(0, 32) || 'media'}${ext}`;
        seq += 1;
        const dest = join(dir, 'Resources', file);
        const ok = await this.exportService.materializeMediaToFile(source, dest);
        if (!ok) continue;
        const rel = `##_draftpath_placeholder_${draftId.toUpperCase()}_##/Resources/${file}`;
        resources[source] = rel;
        const meta = await this.mediaMeta(dest, image);
        mediaSize[source] = meta;
      }
      if (!Object.keys(resources).length && doc.clips.some((c) => c.track === 'video' || c.track === 'audio')) {
        throw new BadRequestException('没有可导出的媒体文件');
      }
      const content = buildJianyingDraftContent(doc, { draftId, name, resources, mediaSize });
      const durationSec = (content.duration as number) / 1_000_000;
      const meta = buildJianyingMeta(draftId, name, durationSec);
      const virtualStore = {
        draft_id: draftId.toUpperCase(),
        draft_name: name,
        root_path: '',
        version: 1,
        children: [],
      };
      await writeFile(join(dir, 'draft_content.json'), JSON.stringify(content, null, 2), 'utf8');
      await writeFile(join(dir, 'draft_meta_info.json'), JSON.stringify(meta, null, 2), 'utf8');
      await writeFile(join(dir, 'draft_virtual_store.json'), JSON.stringify(virtualStore, null, 2), 'utf8');
      const ok = await zipDirectory(dir, out);
      if (!ok) throw new BadRequestException('草稿打包失败');
      await rm(dir, { recursive: true, force: true }).catch(() => {});
      return {
        filename: `${safeFilename(name)}-剪映草稿.zip`,
        path: out,
        cleanup: async () => { await rm(out, { force: true }).catch(() => {}); },
      };
    } catch (err) {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
      await rm(out, { force: true }).catch(() => {});
      throw err;
    }
  }

  private async isImage(projectId: string, source: string): Promise<boolean> {
    if (IMAGE_EXT.test(source.split('?')[0])) return true;
    const proxy = /^\/api\/assets\/([0-9a-f-]{16,})\/content/i.exec(source);
    if (!proxy) return false;
    const r = await this.db
      .select({ mime: assets.mimeType, fileUrl: assets.fileUrl })
      .from(assets)
      .where(eq(assets.id, proxy[1]))
      .limit(1);
    if (!r.length) return false;
    return (r[0].mime ?? '').startsWith('image/') || IMAGE_EXT.test(r[0].fileUrl ?? '');
  }

  private async mediaMeta(dest: string, image: boolean) {
    if (image) return { width: 1080, height: 1920, duration: 10_800, type: 'photo' as const };
    const ffprobe = this.exportService.resolveFfmpegBin().replace(/ffmpeg(\.exe)?$/i, 'ffprobe$1');
    const { spawn } = await import('child_process');
    const json = await new Promise<string>((resolve) => {
      const child = spawn(ffprobe, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', dest]);
      let out = '';
      child.stdout?.on('data', (d) => { out += String(d); });
      child.on('error', () => resolve(''));
      child.on('close', () => resolve(out));
    });
    try {
      const p = JSON.parse(json) as { streams?: { codec_type?: string; width?: number; height?: number }[]; format?: { duration?: string } };
      const video = (p.streams ?? []).find((s) => s.codec_type === 'video');
      return {
        width: video?.width ?? 1080,
        height: video?.height ?? 1920,
        duration: Number(p.format?.duration ?? 0) || 10,
        type: 'video' as const,
      };
    } catch {
      return { width: 1080, height: 1920, duration: 10, type: 'video' as const };
    }
  }
}

function uniqueSources(doc: TimelineDocument): string[] {
  const set = new Set<string>();
  for (const c of doc.clips) {
    if (c.enabled === false || !c.sourceUrl) continue;
    if (c.track === 'video' || c.track === 'audio') set.add(c.sourceUrl);
  }
  return [...set];
}

function safeImageExt(source: string): string {
  const clean = source.split('?')[0].split('#')[0];
  const m = /\.(png|jpe?g|webp|bmp|gif|tiff?)$/i.exec(clean);
  return m ? `.${m[1].toLowerCase()}` : '.png';
}

function safeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 80) || '一幕神剪草稿';
}
