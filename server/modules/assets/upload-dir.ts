import { resolve } from 'path';

/** 本地上传根目录：UPLOAD_DIR 或 <cwd>/data/uploads */
export function uploadDir(): string {
  return resolve(process.cwd(), process.env.UPLOAD_DIR ?? 'data/uploads');
}
