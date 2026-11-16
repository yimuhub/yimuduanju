/**
 * 剪映草稿包 / 素材包兼容层
 * -------------------------------------------------------------
 * 事实边界（调研结论，2026-11）：
 *   · 剪映 5.9 及以下：draft_content.json 是明文 JSON，可解析；
 *   · 剪映 6.0+：draft_content.json 被 AES 加密，浏览器无法解密。
 * 因此这里明确「读明文、不破解加密」：
 *   · .json / .zip → 找 draft_content.json / draft_info.json；
 *   · 能解析就按 materials.videos / audios / images 提取素材；
 *   · 加密包直接报错，提示从剪映导出明文工程或使用 5.9。
 *
 * 导入粒度是「素材」而不是轨道：所有媒体文件上传成本项目资产，
 * 归入素材库「剪映草稿包」文件夹；轨道结构不强行映射（映射错比不映射更糟），
 * 用户在时间线里拖入即可。
 */
import { unzipSync } from 'fflate';
import { createAsset, updateAsset, uploadLocalFile } from '@client/src/api/assets';

export interface JianyingImportResult {
  imported: number;
  skipped: number;
  warnings: string[];
  sourceType: 'jianying' | 'pack';
}

type MediaKind = 'video' | 'image' | 'audio';

interface DraftMedia {
  name: string;
  path?: string;
  kind: MediaKind;
  durationSeconds?: number;
}

const VIDEO_EXT = /\.(mp4|mov|m4v|webm|mkv|avi|flv|wmv|ts)$/i;
const AUDIO_EXT = /\.(mp3|wav|aac|m4a|flac|ogg|opus|wma)$/i;
const IMAGE_EXT = /\.(jpg|jpeg|png|webp|gif|bmp|heic|tiff?)$/i;

const kindByPath = (path: string): MediaKind | null => {
  if (VIDEO_EXT.test(path)) return 'video';
  if (AUDIO_EXT.test(path)) return 'audio';
  if (IMAGE_EXT.test(path)) return 'image';
  return null;
};

const mimeOf = (kind: MediaKind, path: string): string => {
  const ext = path.split('.').pop()?.toLowerCase() || '';
  if (kind === 'video') return ext === 'webm' ? 'video/webm' : ext === 'mov' ? 'video/quicktime' : 'video/mp4';
  if (kind === 'audio') {
    if (ext === 'wav') return 'audio/wav';
    if (ext === 'ogg' || ext === 'opus') return 'audio/ogg';
    if (ext === 'flac') return 'audio/flac';
    return 'audio/mpeg';
  }
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'gif') return 'image/gif';
  return 'image/jpeg';
};

const baseName = (path: string) => {
  const normalized = path.replace(/\\/g, '/');
  const last = normalized.split('/').filter(Boolean).pop() || normalized;
  return last.replace(/^##_draftpath_[^/]*_/, '') || last;
};

const asSeconds = (raw: unknown): number | undefined => {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  // 剪映时间单位是微秒；已经小于 10000 的按秒处理（容错第三方清单）
  const sec = n > 10000 ? n / 1_000_000 : n;
  return sec > 0 && sec < 24 * 3600 ? Math.round(sec * 1000) / 1000 : undefined;
};

const collectMaterials = (draft: unknown): DraftMedia[] => {
  if (!draft || typeof draft !== 'object') return [];
  const root = draft as Record<string, unknown>;
  const materials = (root.materials ?? {}) as Record<string, unknown>;
  const out: DraftMedia[] = [];
  const buckets: { key: string; kind: MediaKind }[] = [
    { key: 'videos', kind: 'video' },
    { key: 'audios', kind: 'audio' },
    { key: 'images', kind: 'image' },
  ];
  for (const bucket of buckets) {
    const rows = materials[bucket.key];
    if (!Array.isArray(rows)) continue;
    for (const raw of rows) {
      if (!raw || typeof raw !== 'object') continue;
      const m = raw as Record<string, unknown>;
      const pathRaw =
        (typeof m.path === 'string' && m.path) ||
        (typeof m.file_Path === 'string' && m.file_Path) ||
        (typeof m.filePath === 'string' && m.filePath) ||
        (typeof m.url === 'string' && m.url) ||
        '';
      const nameRaw =
        (typeof m.material_name === 'string' && m.material_name) ||
        (typeof m.name === 'string' && m.name) ||
        (pathRaw ? baseName(pathRaw) : '') ||
        `${bucket.kind}-${out.length + 1}`;
      const durationSeconds =
        asSeconds(m.duration) ??
        asSeconds((m.source_timerange as Record<string, unknown> | undefined)?.duration) ??
        asSeconds((m.target_timerange as Record<string, unknown> | undefined)?.duration);
      out.push({
        name: nameRaw,
        path: pathRaw || undefined,
        kind: bucket.kind,
        durationSeconds,
      });
    }
  }
  return out;
};

const isJianyingDraft = (value: unknown): boolean => {
  if (!value || typeof value !== 'object') return false;
  const root = value as Record<string, unknown>;
  return !!root.materials || !!root.tracks || !!root.canvas_config;
};

const decodeText = (bytes: Uint8Array): string => {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return '';
  }
};

const looksEncrypted = (_bytes: Uint8Array, text: string): boolean => {
  if (!text) return true;
  const first = text.replace(/^\uFEFF/, '').trimStart()[0];
  return first !== '{' && first !== '[';
};

const safeName = (name: string, fallback: string) => {
  const cleaned = name.replace(/[/\\?%*:|"<>]/g, '_').trim();
  return (cleaned || fallback).slice(-180);
};

const importBlob = async (
  projectId: string,
  blob: Blob,
  name: string,
  durationSeconds: number | undefined,
  sourceType: 'jianying' | 'pack',
): Promise<boolean> => {
  const res = await uploadLocalFile(projectId, blob, safeName(`[剪映] ${name}`, '剪映素材'), durationSeconds);
  if (!res.asset?.id) return false;
  try {
    await updateAsset(res.asset.id, { sourceType });
  } catch {
    /* 资产已落库；来源标签失败不影响可用性 */
  }
  return true;
};

const importRemote = async (
  projectId: string,
  url: string,
  name: string,
  kind: MediaKind,
  durationSeconds: number | undefined,
  sourceType: 'jianying' | 'pack',
): Promise<boolean> => {
  if (!/^(https?:\/\/|\/uploads\/)/i.test(url)) return false;
  await createAsset({
    projectId,
    assetType: kind,
    name: safeName(`[剪映] ${name}`, '剪映素材'),
    fileUrl: url,
    durationSeconds,
    sourceType,
  });
  return true;
};

const parseDraftJson = (text: string): Record<string, unknown> | null => {
  try {
    const parsed = JSON.parse(text) as unknown;
    return isJianyingDraft(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};

/**
 * 从 .zip 解出草稿 JSON 和媒体文件。
 * 没有 draft_content/draft_info 时按普通素材包处理（zip 内所有音视频/图片）。
 */
const importZip = async (
  file: File,
  projectId: string,
): Promise<JianyingImportResult> => {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(new Uint8Array(await file.arrayBuffer()));
  } catch {
    throw new Error('ZIP 解压失败：文件可能损坏或不是标准 zip');
  }

  const allPaths = Object.keys(entries).filter((p) => !p.endsWith('/'));
  const jsonPaths = allPaths.filter((p) => /draft_(content|info)\.json$/i.test(p));
  let draft: Record<string, unknown> | null = null;
  let encrypted = false;
  for (const path of jsonPaths) {
    const bytes = entries[path];
    const text = decodeText(bytes);
    if (looksEncrypted(bytes, text)) {
      encrypted = true;
      continue;
    }
    const parsed = parseDraftJson(text);
    if (parsed) {
      draft = parsed;
      break;
    }
  }
  if (!draft && encrypted) {
    throw new Error(
      '这是剪映 6.0+ 加密草稿（draft_content.json 已加密），浏览器无法读取。请在剪映「导出/另存工程」导出明文包，或用 5.9 及以下版本另存后再导入。',
    );
  }

  const sourceType: 'jianying' | 'pack' = draft ? 'jianying' : 'pack';
  const materials = draft ? collectMaterials(draft) : [];
  const warnings: string[] = [];
  const mediaByBase = new Map<string, string>();
  for (const path of allPaths) {
    if (!kindByPath(path)) continue;
    const base = baseName(path).toLowerCase();
    if (!mediaByBase.has(base)) mediaByBase.set(base, path);
  }

  // 草稿材料优先按路径 basename 匹配；找不到则按同类型顺序兜底
  const materialMap = new Map<string, DraftMedia>();
  for (const m of materials) {
    if (!m.path) continue;
    materialMap.set(baseName(m.path).toLowerCase(), m);
  }

  const candidates: { path: string; name: string; kind: MediaKind; duration?: number }[] = [];
  const used = new Set<string>();
  for (const [base, path] of mediaByBase) {
    const m = materialMap.get(base);
    const kind = m?.kind || kindByPath(path);
    if (!kind) continue;
    used.add(path);
    candidates.push({
      path,
      name: m?.name || baseName(path),
      kind,
      duration: m?.durationSeconds,
    });
  }
  // 草稿里登记了远程路径的素材，也一并进资产库
  const remote: DraftMedia[] = materials.filter(
    (m) => !!m.path && /^(https?:\/\/|\/uploads\/)/i.test(m.path) && !mediaByBase.has(baseName(m.path!).toLowerCase()),
  );

  let imported = 0;
  let skipped = 0;
  for (const item of candidates.slice(0, 100)) {
    try {
      const bytes = entries[item.path];
      const copy = new Uint8Array(bytes.byteLength);
      copy.set(bytes);
      const blob = new Blob([copy], { type: mimeOf(item.kind, item.path) });
      if (await importBlob(projectId, blob, item.name, item.duration, sourceType)) imported += 1;
      else skipped += 1;
    } catch {
      skipped += 1;
    }
  }
  for (const item of remote.slice(0, Math.max(0, 100 - imported))) {
    try {
      if (await importRemote(projectId, item.path!, item.name, item.kind, item.durationSeconds, sourceType)) imported += 1;
      else skipped += 1;
    } catch {
      skipped += 1;
    }
  }
  if (candidates.length + remote.length > 100) {
    warnings.push('单次最多导入 100 条，多余素材已跳过，可拆分压缩包后再导入。');
  }
  if (imported === 0) {
    if (jsonPaths.length === 0) {
      throw new Error('压缩包里没有找到剪映 draft_content.json，也没有可导入的音视频/图片');
    }
    throw new Error('草稿解析成功，但包内没有可读取的媒体文件（可能素材引用的是剪映缓存目录，未随包导出）');
  }
  if (materials.length > imported) {
    warnings.push(`草稿登记 ${materials.length} 条素材，成功读取 ${imported} 条；缺失的多为剪映缓存路径，未随包导出。`);
  }
  return { imported, skipped, warnings, sourceType };
};

/** 明文 draft_content.json / 资产清单 JSON */
const importJson = async (file: File, projectId: string): Promise<JianyingImportResult> => {
  const text = await file.text();
  if (!text.trim()) throw new Error('JSON 文件为空');
  const parsed = parseDraftJson(text);
  if (!parsed) {
    if (text.trim().startsWith('{')) {
      throw new Error('JSON 能读，但不是剪映草稿结构（缺少 materials / tracks）');
    }
    throw new Error('不是可读的明文剪映草稿；剪映 6.0+ 请先从剪映导出明文工程');
  }
  const materials = collectMaterials(parsed);
  if (materials.length === 0) throw new Error('草稿里没有素材');
  let imported = 0;
  let skipped = 0;
  for (const m of materials.slice(0, 100)) {
    if (!m.path) {
      skipped += 1;
      continue;
    }
    if (/^(https?:\/\/|\/uploads\/)/i.test(m.path)) {
      if (await importRemote(projectId, m.path, m.name, m.kind, m.durationSeconds, 'jianying')) imported += 1;
      else skipped += 1;
    } else {
      // 绝对本地路径浏览器读不到；zip 包才能带媒体
      skipped += 1;
    }
  }
  if (imported === 0) {
    throw new Error('草稿里的素材是本地路径，浏览器无法直接读取。请改导入包含媒体文件的 .zip 草稿包。');
  }
  return {
    imported,
    skipped,
    warnings:
      skipped > 0
        ? [`${skipped} 条本地路径素材无法读取；需要导入带媒体的 zip 草稿包。`]
        : [],
    sourceType: 'jianying',
  };
};

/**
 * 入口：根据扩展名分派。
 * 只处理 .zip / .json；.yimupack 由对话框原有清单逻辑处理。
 */
export const importJianyingPackage = async (
  file: File,
  projectId: string,
): Promise<JianyingImportResult> => {
  if (!projectId) throw new Error('缺少项目 ID');
  const name = file.name.toLowerCase();
  if (name.endsWith('.zip')) return importZip(file, projectId);
  if (name.endsWith('.json')) return importJson(file, projectId);
  throw new Error('只支持 .zip 或 .json 的剪映草稿包/资产包');
};
