/**
 * 首帧/尾帧「临时公开素材」生命周期（staged media）
 * ============================================================================
 * 背景：Agnes /videos 的 first_frame / last_frame 只接受**可公开访问的 http(s) URL**，
 * 本地 `/uploads/xxx.png` 会被判成非公网素材直接丢弃，静默退化成 mode=text。
 * 官方文档措辞：「所有媒体 URL 都应可由 Agnes AI 服务公开访问，并在任务完成前保持有效」。
 *
 * 用户的诉求是「先传到我服务器上，产出视频以后自动删除这个图片」—— 完全可行，
 * 而且官方明确给了「任务完成前保持有效」这个删除时点。但要落到实处有三个坑：
 *
 *  1) **绝不能删原图**。首帧是项目资产：分镜页、自由画布、导出、单镜重做都要读
 *     shots.start_frame_url。删了等于毁项目。要删的只是「临时公开副本」。
 *  2) **不该用复制上传，也不该额外占空间**。本地 /uploads 里的图本来就在磁盘上，
 *     用 hard link 生成一个随机/不可猜名字的临时条目，与原图共享 inode —— 零额外
 *     数据块，用户担心的「服务器空间不大」根本不是问题。删链接不影响原图。
 *  3) **删除时机必须覆盖全部终态 + 兜底**。只挂「成功」会漏掉失败/取消/进程崩溃，
 *     临时副本会永久残留、长期公开。这里提供 releaseForJob()（三个终态调用）和
 *     sweepExpired()（worker 周期扫描，TTL 兜底，防任务卡死/后端被杀）。
 *
 * 两种后端（配置驱动，默认本地硬链接，零依赖、零成本）：
 *  - local（默认）：`_staged/<jobId>/0.png`，由 YIMU_PUBLIC_MEDIA_BASE / .tunnel-url
 *    拼成公网 URL（cloudflared 隧道已实测 200 image/png）。
 *  - remote（可选，用户自有服务器）：设置 YIMU_MEDIA_UPLOAD_URL 后走 HTTP PUT/DELETE。
 *    约定：PUT  `{UPLOAD_URL}/_staged/<jobId>/<idx><ext>`  （body=图片二进制）
 *          URL  `{YIMU_PUBLIC_MEDIA_BASE}/uploads/_staged/<jobId>/<idx><ext>`
 *          DELETE `{UPLOAD_URL}/_staged/<jobId>/<idx><ext>`
 *    鉴权用 `Authorization: Bearer ${YIMU_MEDIA_UPLOAD_TOKEN}`（可选）。
 *    用户服务器只要实现这三个动词即可（nginx dav / 极简 Node / S3 预签名网关都行）。
 *
 * 名字用 jobId（UUID，不可枚举）作目录，索引作文件名：天然幂等 —— 同一任务
 * 重试 100 次也只覆盖同一组条目，不会把临时目录撑爆。
 */
import { copyFile, link, mkdir, readFile, readdir, rm, stat } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { uploadDir } from '../assets/upload-dir';
import { isLocalUploadPath, publicMediaBase } from './media-input';

/** /uploads 下的临时子目录名（静态伺服已覆盖子目录，隧道同源透传） */
const STAGE_DIR = '_staged';
/** TTL 兜底：超过这个时长的临时副本强制清理（防任务卡死/后端崩溃残留） */
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

export interface StagedFrame {
  /** 交给上游的公网 URL；失败时为原始值，由调用方继续走既有降级链 */
  url: string;
  /** 本次是否真的生成了临时副本（用于统计/日志） */
  staged: boolean;
}

function rootDir(): string {
  return join(uploadDir(), STAGE_DIR);
}

function jobKey(jobId: string, idx: number, ext: string): string {
  // 只用 UUID 目录 + 数字文件名；不放用户可控字符，杜绝路径穿越
  return `${STAGE_DIR}/${jobId}/${idx}${ext}`;
}

/** 本地 /uploads/xxx → 上传目录内的绝对路径（含穿越校验） */
function localAbsolute(uploadPath: string): string | null {
  const root = resolve(uploadDir());
  const rel = uploadPath.replace(/^\/uploads\//, '').replace(/^\/+/, '');
  const abs = resolve(root, rel);
  if (abs !== root && !abs.startsWith(root + sep)) return null;
  return abs;
}

function remoteEndpoint(): string {
  return (process.env.YIMU_MEDIA_UPLOAD_URL ?? '').trim().replace(/\/+$/, '');
}

async function putRemote(key: string, abs: string): Promise<boolean> {
  const endpoint = remoteEndpoint();
  if (!endpoint) return false;
  const buf = await readFile(abs);
  const token = (process.env.YIMU_MEDIA_UPLOAD_TOKEN ?? '').trim();
  const res = await fetch(`${endpoint}/${key}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/octet-stream',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: buf,
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`远程素材 PUT 失败 (${res.status})`);
  return true;
}

/**
 * 为一个视频任务准备首帧/尾帧的公网 URL。
 * 已经是 http(s) 的（上游 CDN 回传图）原样返回，不做任何改动；
 * 本地 /uploads 图生成临时公开副本；任何失败都返回原值，由既有链路继续降级，
 * 绝不因为「临时素材」这一步把视频提交打断。
 */
export async function stageFramesForJob(
  jobId: string,
  raws: Array<string | undefined | null>,
): Promise<StagedFrame[]> {
  const out: StagedFrame[] = [];
  const useRemote = !!remoteEndpoint();
  const base = publicMediaBase();

  for (let i = 0; i < raws.length; i += 1) {
    const raw = (raws[i] ?? '').trim();
    if (!raw || /^https?:\/\//i.test(raw) || /^data:/i.test(raw)) {
      out.push({ url: raw, staged: false });
      continue;
    }
    if (!isLocalUploadPath(raw)) {
      out.push({ url: raw, staged: false });
      continue;
    }
    const abs = localAbsolute(raw);
    if (!abs || !base) {
      out.push({ url: raw, staged: false });
      continue;
    }
    const ext = extname(abs).toLowerCase().replace(/[^.a-z0-9]/g, '') || '.png';
    const key = jobKey(jobId, i, ext);
    try {
      if (useRemote) {
        await putRemote(key, abs);
      } else {
        const target = join(uploadDir(), key);
        await mkdir(join(rootDir(), jobId), { recursive: true });
        // 硬链接 = 零额外磁盘占用；跨设备/不支持时退回复制（仍会在终态删除）
        try {
          await rm(target, { force: true });
          await link(abs, target);
        } catch {
          await copyFile(abs, target);
        }
      }
      out.push({ url: `${base}/uploads/${key}`, staged: true });
    } catch (e) {
      // 临时副本失败不应阻断提交：原 /uploads 路径仍能被 publicMediaBase 拼成公网 URL
      out.push({ url: raw, staged: false });
      console.warn(`[staged-media] ${jobId} 第${i}帧暂存失败，回退原路径：${(e as Error).message}`);
    }
  }
  return out;
}

/** 任务终态（succeeded / failed / cancelled）调用：删除该任务的全部临时公开副本 */
export async function releaseStagedFrames(jobId: string): Promise<void> {
  if (!jobId) return;
  const endpoint = remoteEndpoint();
  try {
    if (endpoint) {
      const token = (process.env.YIMU_MEDIA_UPLOAD_TOKEN ?? '').trim();
      // 首帧/尾帧最多两路，扩展名按常见图片枚举
      for (const idx of [0, 1]) {
        for (const ext of ['.png', '.jpg', '.jpeg', '.webp']) {
          // eslint-disable-next-line no-await-in-loop
          await fetch(`${endpoint}/${STAGE_DIR}/${jobId}/${idx}${ext}`, {
            method: 'DELETE',
            headers: token ? { Authorization: `Bearer ${token}` } : {},
            signal: AbortSignal.timeout(8_000),
          }).catch(() => undefined);
        }
      }
    }
    await rm(join(rootDir(), jobId), { recursive: true, force: true });
  } catch (e) {
    console.warn(`[staged-media] 清理 ${jobId} 临时素材失败：${(e as Error).message}`);
  }
}

/**
 * TTL 兜底扫描：删掉超过 maxAgeMs 的临时目录。
 * 为什么必须有：任务被永久卡住、后端被 SIGKILL、用户手动删任务时，
 * releaseForJob 永远不会执行；没有这层，临时公开副本会长期留在公网可访问目录里。
 * 由 worker tick 周期调用（低频即可）。
 */
export async function sweepExpiredStagedFrames(maxAgeMs = DEFAULT_TTL_MS): Promise<number> {
  let removed = 0;
  try {
    await mkdir(rootDir(), { recursive: true });
    const entries = await readdir(rootDir(), { withFileTypes: true });
    const now = Date.now();
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dir = join(rootDir(), entry.name);
      try {
        // eslint-disable-next-line no-await-in-loop
        const info = await stat(dir);
        if (now - info.mtimeMs <= maxAgeMs) continue;
        // eslint-disable-next-line no-await-in-loop
        await releaseStagedFrames(entry.name);
        removed += 1;
      } catch {
        /* 单个目录失败不影响其余清理 */
      }
    }
  } catch (e) {
    console.warn(`[staged-media] TTL 扫描失败：${(e as Error).message}`);
  }
  return removed;
}
