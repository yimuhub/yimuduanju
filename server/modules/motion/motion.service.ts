import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';
import { spawn } from 'child_process';
import { mkdir, rm, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { chromium, type Browser } from 'playwright';
import {
  buildSceneDocument,
  DEFAULT_MOTION_DOC,
  type MotionDocument,
  type MotionProject,
} from '@shared/html-motion';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { htmlMotionProjects } from '../../database/schema';
import { uploadDir } from '../assets/upload-dir';

// 以下两个全局只存在于 page.evaluate 的浏览器上下文，Node 侧不会求值
declare const document: { fonts?: { ready: Promise<unknown> } };
declare const window: { __hfSeek?: (t: number) => void };

const iso = (v: Date | string | null | undefined): string =>
  v instanceof Date ? v.toISOString() : String(v ?? new Date().toISOString());

type RenderJob = {
  id: string;
  projectId: string;
  status: 'queued' | 'capturing' | 'encoding' | 'done' | 'failed';
  progress: number;
  message: string;
  outputUrl?: string;
  error?: string;
  createdAt: string;
};

function chromePath(): string | undefined {
  const candidates = [
    process.env.MOTION_CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean) as string[];
  return candidates.find((p) => existsSync(p));
}

function run(cmd: string, args: string[], cwd?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += String(d)));
    child.stderr.on('data', (d) => (err += String(d)));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(out);
      else reject(new Error(`${cmd} exited ${code}\n${err.slice(-2000)}`));
    });
  });
}

function normalizeDoc(input: unknown): MotionDocument {
  const raw = (input ?? {}) as Partial<MotionDocument>;
  const width = Math.min(2160, Math.max(320, Math.floor(Number(raw.width) || 1080)));
  const height = Math.min(3840, Math.max(320, Math.floor(Number(raw.height) || 1920)));
  const fps = Math.min(60, Math.max(12, Math.floor(Number(raw.fps) || 24)));
  const scenes = Array.isArray(raw.scenes) && raw.scenes.length
    ? raw.scenes.map((s, i) => ({
        id: String(s.id || `scene-${i}`),
        name: String(s.name || `场景 ${i + 1}`),
        duration: Math.min(30, Math.max(0.2, Number(s.duration) || 3)),
        html: String(s.html ?? ''),
      }))
    : DEFAULT_MOTION_DOC.scenes;
  return {
    width,
    height,
    fps,
    background: String(raw.background || DEFAULT_MOTION_DOC.background),
    scenes,
  };
}

@Injectable()
export class MotionService {
  private readonly jobs = new Map<string, RenderJob>();

  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase) {}

  private map(row: typeof htmlMotionProjects.$inferSelect): MotionProject {
    return {
      id: row.id,
      title: row.title,
      document: normalizeDoc(row.document),
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.updatedAt),
    };
  }

  async list(): Promise<MotionProject[]> {
    const rows = await this.db
      .select()
      .from(htmlMotionProjects)
      .orderBy(desc(htmlMotionProjects.updatedAt))
      .limit(100);
    return rows.map((r) => this.map(r));
  }

  async create(body: { title?: string; document?: unknown }): Promise<MotionProject> {
    const document = normalizeDoc(body.document ?? DEFAULT_MOTION_DOC);
    const [row] = await this.db
      .insert(htmlMotionProjects)
      .values({ title: (body.title || '未命名 HTML 动画').slice(0, 255), document })
      .returning();
    return this.map(row);
  }

  async get(id: string): Promise<MotionProject> {
    const [row] = await this.db
      .select()
      .from(htmlMotionProjects)
      .where(eq(htmlMotionProjects.id, id))
      .limit(1);
    if (!row) throw new NotFoundException('HTML 动画工程不存在');
    return this.map(row);
  }

  async update(
    id: string,
    body: { title?: string; document?: unknown },
  ): Promise<MotionProject> {
    const current = await this.get(id);
    const [row] = await this.db
      .update(htmlMotionProjects)
      .set({
        title: body.title ? String(body.title).slice(0, 255) : current.title,
        document: body.document ? normalizeDoc(body.document) : current.document,
        updatedAt: new Date(),
      })
      .where(eq(htmlMotionProjects.id, id))
      .returning();
    return this.map(row);
  }

  async remove(id: string): Promise<{ ok: true }> {
    await this.get(id);
    await this.db.delete(htmlMotionProjects).where(eq(htmlMotionProjects.id, id));
    return { ok: true };
  }

  async startRender(id: string): Promise<RenderJob> {
    const project = await this.get(id);
    const jobId = `motion-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const job: RenderJob = {
      id: jobId,
      projectId: id,
      status: 'queued',
      progress: 0,
      message: '已进入渲染队列',
      createdAt: new Date().toISOString(),
    };
    this.jobs.set(jobId, job);
    void this.render(project, job);
    return job;
  }

  getJob(jobId: string): RenderJob {
    const job = this.jobs.get(jobId);
    if (!job) throw new NotFoundException('渲染任务不存在或已过期');
    return job;
  }

  private async render(project: MotionProject, job: RenderJob): Promise<void> {
    const doc = project.document;
    const root = join(uploadDir(), 'html-motion', project.id);
    const work = join(root, job.id);
    let browser: Browser | undefined;
    try {
      await mkdir(work, { recursive: true });
      job.status = 'capturing';
      job.message = '启动无头浏览器';

      browser = await chromium.launch({
        executablePath: chromePath(),
        headless: true,
        args: ['--disable-gpu', '--no-dev-shm-usage', '--font-render-hinting=none'],
      });

      const totalScenes = doc.scenes.length;
      const sceneFiles: string[] = [];
      for (let si = 0; si < totalScenes; si += 1) {
        const scene = doc.scenes[si];
        const frames = Math.max(1, Math.round(scene.duration * doc.fps));
        const sceneDir = join(work, `scene-${si}`);
        await mkdir(sceneDir, { recursive: true });
        const page = await browser.newPage({
          viewport: { width: doc.width, height: doc.height },
          deviceScaleFactor: 1,
        });
        await page.setContent(buildSceneDocument(scene, doc), {
          waitUntil: 'load',
          timeout: 45_000,
        });
        await page.evaluate(async () => {
          await document.fonts?.ready;
          await new Promise((r) => setTimeout(r, 260));
        });
        await page.evaluate(() => {
          window.__hfSeek?.(0);
        });

        for (let f = 0; f < frames; f += 1) {
          const t = f / doc.fps;
          await page.evaluate((seconds) => {
            window.__hfSeek?.(seconds);
          }, t);
          await page.screenshot({
            path: join(sceneDir, `frame-${String(f).padStart(5, '0')}.png`),
          });
          const overall = (si + (f + 1) / frames) / totalScenes;
          job.progress = Math.round(overall * 82);
          job.message = `截取第 ${si + 1}/${totalScenes} 场景 · ${f + 1}/${frames} 帧`;
        }

        await page.close();
        const sceneMp4 = join(work, `scene-${si}.mp4`);
        await run('ffmpeg', [
          '-y',
          '-framerate', String(doc.fps),
          '-i', join(sceneDir, 'frame-%05d.png'),
          '-c:v', 'libx264',
          '-pix_fmt', 'yuv420p',
          '-r', String(doc.fps),
          '-movflags', '+faststart',
          sceneMp4,
        ]);
        sceneFiles.push(sceneMp4);
        await rm(sceneDir, { recursive: true, force: true });
      }

      job.status = 'encoding';
      job.progress = 88;
      job.message = '合并场景并封装 MP4';
      const listFile = join(work, 'list.txt');
      await writeFile(
        listFile,
        sceneFiles.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join('\n'),
        'utf8',
      );
      const output = join(root, `${job.id}.mp4`);
      await run('ffmpeg', [
        '-y',
        '-f', 'concat',
        '-safe', '0',
        '-i', listFile,
        '-c', 'copy',
        '-movflags', '+faststart',
        output,
      ]);
      job.status = 'done';
      job.progress = 100;
      job.message = '渲染完成';
      job.outputUrl = `/uploads/html-motion/${project.id}/${job.id}.mp4`;
    } catch (e) {
      job.status = 'failed';
      job.error = (e as Error).message || '渲染失败';
      job.message = '渲染失败';
      await rm(work, { recursive: true, force: true }).catch(() => undefined);
    } finally {
      await browser?.close().catch(() => undefined);
    }
  }
}
