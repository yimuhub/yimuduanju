/**
 * 神剪 · 低码率预览代理
 * -------------------------------------------------------------
 * 4K/本地大素材直接进 <video> 会让浏览器解码与 GPU 合成吃满。
 * 「流畅」档改为请求一条 540p / H.264 代理：只转码一次，按源地址哈希缓存，
 * 后续播放头拖动、切片段都复用同一条小文件。
 *
 * 代理不替代导出：导出仍走 ExportService 的原片管线，画质不受影响。
 * 远程素材沿用 materializeMediaToFile 的 SSRF 守卫与缓存，不在这里裸下载。
 */
import { Injectable, Logger } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { mkdir, stat, unlink } from 'fs/promises';
import { join, resolve } from 'path';
import { ExportService } from '../export/export.service';

const VIDEO_EXT = /\.(mp4|mov|m4v|webm|mkv|avi|mts|m2ts|flv|wmv)(?:$|[?#])/i;
const PROXY_WIDTH = 540;

@Injectable()
export class PreviewProxyService {
  private readonly log = new Logger(PreviewProxyService.name);
  private readonly inflight = new Map<string, Promise<string | null>>();

  constructor(private readonly exportService: ExportService) {}

  /**
   * 返回可播放的本地代理绝对路径；不是视频或转码失败返回 null（前端回退原片）。
   * projectId 只用于隔离缓存目录，不参与源地址解析。
   */
  async ensureProxy(projectId: string, src: string): Promise<string | null> {
    const raw = src.trim();
    if (!raw || !VIDEO_EXT.test(raw.split('#')[0])) return null;

    // 本地 /uploads、资产代理、远程 URL 都参与哈希；同一源只转一次
    const hash = createHash('sha1').update(raw).digest('hex').slice(0, 24);
    const dir = resolve(process.cwd(), 'data', 'preview-proxy', projectId);
    const out = join(dir, `${hash}.mp4`);
    const existing = await stat(out).then((s) => s.size).catch(() => 0);
    if (existing >= 1024) return out;

    const running = this.inflight.get(hash);
    if (running) return running;

    const task = this.build(raw, dir, out).finally(() => this.inflight.delete(hash));
    this.inflight.set(hash, task);
    return task;
  }

  private async build(src: string, dir: string, out: string): Promise<string | null> {
    const input = join(dir, `.src-${randomUUID()}.media`);
    try {
      await mkdir(dir, { recursive: true });
      const materialized = await this.exportService.materializeMediaToFile(
        src,
        input,
        join(dir, '.download-cache'),
      );
      if (!materialized) return null;

      const ffmpeg = this.exportService.resolveFfmpegBin();
      const args = [
        '-y',
        '-i', input,
        '-map', '0:v:0',
        '-map', '0:a?',
        '-vf', `scale='min(${PROXY_WIDTH},iw)':-2:flags=lanczos`,
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-crf', '30',
        '-threads', '2',
        '-c:a', 'aac',
        '-b:a', '64k',
        '-movflags', '+faststart',
        '-shortest',
        out,
      ];
      const ok = await this.run(ffmpeg, args);
      if (!ok) {
        await unlink(out).catch(() => {});
        this.log.warn(`预览代理转码失败：${src.slice(0, 120)}`);
        return null;
      }
      const size = await stat(out).then((s) => s.size).catch(() => 0);
      return size >= 1024 ? out : null;
    } catch (e) {
      this.log.warn(`预览代理异常：${(e as Error).message}`);
      return null;
    } finally {
      unlink(input).catch(() => {});
    }
  }

  private run(bin: string, args: string[]): Promise<boolean> {
    return new Promise((resolveOk) => {
      const child = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'] });
      let err = '';
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
      }, 8 * 60_000);
      child.stderr.on('data', (chunk) => {
        err += String(chunk);
        if (err.length > 6000) err = err.slice(-6000);
      });
      child.on('error', () => {
        clearTimeout(timer);
        resolveOk(false);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (code !== 0) this.log.debug(err);
        resolveOk(code === 0);
      });
    });
  }
}
