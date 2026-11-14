import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { createReadStream } from 'node:fs';
import { open, stat as statAsync } from 'fs/promises';
import { join } from 'path';
import { compareImageAspect, parseImageSize } from '@shared/image-dimensions';
import {
  compareFingerprints,
  scoreArtifactFingerprint,
  type ArtifactFingerprint,
  type FingerprintRegression,
} from '@shared/qc-fingerprint';
import { uploadDir } from '../assets/upload-dir';

/**
 * 产物指纹与「不更坏」QC 比对（migration 0024 一致性工程 B3）：
 * - 重跑入口（storyboard.rerunShot）先快照旧产物指纹 → 任务 inputData.prevFingerprint；
 * - 任务成功结算（generation.settleJobSuccess）时对新产物重算指纹并比对，
 *   QC 分数下降 → outputData.regressWarn=true（任务仍 succeeded，只警示不拦截）。
 * 指纹 = 尺寸 + 文件大小 + md5 前 8 位；只对本地 /uploads/ 产物可算，
 * 远程 CDN 产物（视频直回 URL）静默跳过比对，不阻断主流程。
 */
@Injectable()
export class ArtifactQcService {
  private readonly logger = new Logger(ArtifactQcService.name);

  /** URL → 本地绝对路径；仅处理 /uploads/ 前缀，其余（远程 CDN/data:）返回 null */
  private localPath(url: string): string | null {
    if (!url.startsWith('/uploads/')) return null;
    return join(uploadDir(), url.slice('/uploads/'.length));
  }

  /** 计算本地产物指纹；文件缺失/不可读返回 null（绝不抛错阻断生成主流程） */
  async fingerprint(url: string, kind: 'image' | 'video'): Promise<ArtifactFingerprint | null> {
    const path = this.localPath(url);
    if (!path) return null;
    try {
      const st = await statAsync(path);
      if (!st.isFile() || st.size <= 0) return null;
      const md5 = await this.md5First8(path);
      const fp: ArtifactFingerprint = {
        kind,
        size: st.size,
        md5,
        url,
      };
      if (kind === 'image') {
        const dims = await this.imageDims(path);
        if (dims) {
          fp.width = dims.width;
          fp.height = dims.height;
        }
      }
      return fp;
    } catch (e) {
      this.logger.warn(`产物指纹计算失败（${url}）：${(e as Error).message}`);
      return null;
    }
  }

  /** 快照 + 记分：重跑入口用（expectedAspect 供画幅校验，缺省不校验画幅） */
  async snapshot(
    url: string | null | undefined,
    kind: 'image' | 'video',
    expectedAspect?: string,
  ): Promise<ArtifactFingerprint | null> {
    if (!url) return null;
    const fp = await this.fingerprint(url, kind);
    if (!fp) return null;
    fp.score = scoreArtifactFingerprint(fp, { aspectMismatch: this.aspectMismatch(fp, expectedAspect) });
    return fp;
  }

  /**
   * 新旧产物比对：QC 分下降 → FingerprintRegression（调用方落 outputData.regressWarn）。
   * 新产物非本地文件（远程视频 URL）→ null（无法算指纹，跳过警示）。
   */
  async compareAgainstPrev(
    prev: ArtifactFingerprint,
    newUrl: string | undefined,
    expectedAspect?: string,
  ): Promise<FingerprintRegression | null> {
    if (!newUrl) return null;
    const next = await this.fingerprint(newUrl, prev.kind);
    if (!next) return null;
    return compareFingerprints(prev, next, {
      aspectMismatch: this.aspectMismatch(next, expectedAspect),
    });
  }

  private aspectMismatch(fp: ArtifactFingerprint, expectedAspect?: string): boolean {
    if (!expectedAspect) return false;
    if (typeof fp.width !== 'number' || typeof fp.height !== 'number') return false;
    const check = compareImageAspect(expectedAspect, fp.width, fp.height);
    return check.ok !== true;
  }

  private md5First8(path: string): Promise<string> {
    return new Promise((resolvePromise, rejectPromise) => {
      const hash = createHash('md5');
      const stream = createReadStream(path);
      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('error', rejectPromise);
      stream.on('end', () => resolvePromise(hash.digest('hex').slice(0, 8)));
    });
  }

  /** 只读文件头 64KB 解析 PNG/JPEG/WebP/GIF 尺寸（复用 V8 产物侧校验的解析器） */
  private async imageDims(path: string): Promise<{ width: number; height: number } | null> {
    let handle: Awaited<ReturnType<typeof open>> | null = null;
    try {
      handle = await open(path, 'r');
      const buf = Buffer.alloc(65536);
      const { bytesRead } = await handle.read(buf, 0, buf.length, 0);
      return parseImageSize(buf.subarray(0, bytesRead));
    } catch {
      return null;
    } finally {
      await handle?.close().catch(() => undefined);
    }
  }
}
