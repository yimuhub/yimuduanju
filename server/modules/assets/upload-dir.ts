import { isAbsolute, relative, resolve, sep } from 'path';

/** 本地上传根目录：UPLOAD_DIR 或 <cwd>/data/uploads */
export function uploadDir(): string {
  return resolve(process.cwd(), process.env.UPLOAD_DIR ?? 'data/uploads');
}

/**
 * /uploads/ 相对地址或服务端绝对路径 → 上传目录内绝对路径，并做包含性校验。
 * 用 path.relative 判定而不是 startsWith 前缀（后者放行 data/uploads-backup 等兄弟目录）。
 * 供内容取流与元数据探测共用（G16）。
 */
export function resolveUnderUploads(fileUrlOrPath: string): string {
  const input = fileUrlOrPath.replace(/^\/uploads\//, '');
  const base = resolve(uploadDir());
  // fileUrl 通常是 /uploads/ 相对地址，服务端归档则会写绝对 filePath；
  // 两种形式都允许，但最终路径必须仍在上传目录内。
  const abs = isAbsolute(input) ? resolve(input) : resolve(base, input);
  const rel = relative(base, abs);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error('非法路径');
  }
  return abs;
}
