/**
 * 产物形态识别（前后端共用）
 * ------------------------------------------------------------------
 * 事故背景：有 2 个镜头 `video_url` 指向的是 `.../images/t2i/task_xxx.png`。
 * 上游轮询/中转把图片地址当成了视频结果，回写侧完全不校验形态就落库，
 * 于是「这镜有视频」成立、数量门被绕过、合成阶段拿到一张图当 mp4 拼。
 *
 * 纪律：**产物类型由 URL 形态先做一次硬校验**。
 * - 明确是图片/音频的视频产物 → 拒绝写入（宁可显示缺失，也不落一个假成片）；
 * - 识别不出来（无扩展名的签名链接）→ 放行但记一次 warn，交给 QC 兜底。
 */

export type ArtifactKind = 'video' | 'image' | 'audio' | 'unknown';

const VIDEO_EXT = new Set(['mp4', 'webm', 'mov', 'm4v', 'avi', 'mkv', 'mpeg', 'mpg']);
const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif', 'svg', 'heic']);
const AUDIO_EXT = new Set(['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac', 'opus', 'amr']);

/** 去掉 query/hash，取最后一个路径段（OBS/CDN 签名链接普遍长这样） */
function pathLeaf(url: string): string {
  const noQuery = url.split('?')[0].split('#')[0];
  const segments = noQuery.split('/');
  return segments[segments.length - 1] ?? '';
}

/** url → 产物形态；data URL 按 mime 判定 */
export function classifyArtifactUrl(url?: string | null): ArtifactKind {
  if (typeof url !== 'string') return 'unknown';
  const u = url.trim();
  if (!u) return 'unknown';

  const dataMatch = /^data:([a-z]+\/[a-z0-9.+-]+)/i.exec(u);
  if (dataMatch) {
    const mime = dataMatch[1].toLowerCase();
    if (mime.startsWith('video/')) return 'video';
    if (mime.startsWith('audio/')) return 'audio';
    if (mime.startsWith('image/')) return 'image';
    return 'unknown';
  }

  const leaf = pathLeaf(u);
  const dot = leaf.lastIndexOf('.');
  const ext = dot > 0 ? leaf.slice(dot + 1).toLowerCase() : '';
  if (VIDEO_EXT.has(ext)) return 'video';
  if (IMAGE_EXT.has(ext)) return 'image';
  if (AUDIO_EXT.has(ext)) return 'audio';

  // 无扩展名时退一步看路径语义（部分网关返回 /videos/{id} 这种裸路由）
  const lower = u.toLowerCase();
  if (/\/videos?\//.test(lower)) return 'video';
  if (/\/images?\//.test(lower)) return 'image';
  if (/\/audios?\//.test(lower)) return 'audio';
  return 'unknown';
}

export interface ArtifactCheck {
  ok: boolean;
  kind: ArtifactKind;
  /** 拒绝原因（ok=false 时有值） */
  reason?: string;
  /** 形态识别不出来但放行时的提示 */
  warning?: string;
}

/** 期望形态与 URL 实际形态是否冲突 */
export function checkArtifact(
  url: string | null | undefined,
  expected: 'video' | 'image' | 'audio',
): ArtifactCheck {
  const kind = classifyArtifactUrl(url);
  const label = { video: '视频', image: '图片', audio: '音频' }[expected];
  if (kind === expected) return { ok: true, kind };
  if (kind === 'unknown') {
    return { ok: true, kind, warning: `${label}产物地址无法识别形态，已放行：${String(url).slice(0, 120)}` };
  }
  return {
    ok: false,
    kind,
    reason: `${label}任务返回的是${{ video: '视频', image: '图片', audio: '音频' }[kind]}产物，已拒绝写入：${String(url).slice(0, 160)}`,
  };
}
