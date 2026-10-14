import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from 'crypto';

/**
 * W1 安全修复：API Key 落库加密（AES-256-GCM）。
 *
 * - 写入前 encryptApiKey，明文只进内存不进库；
 * - 读取后 decryptApiKey，密文出库即解密；
 * - 存量明文兼容：不带 'enc:v1:' 前缀的值原样返回（灰度过渡期）；
 * - 密钥来自环境变量 YIMU_KEY_SECRET（64 位 hex = 32 字节），项目根 .env 配置，
 *   由 server/main.ts 的 dotenv/config 注入；显式设置的环境变量优先于 .env。
 * - 格式：'enc:v1:' + base64(iv[12] | authTag[16] | ciphertext)。
 */

const PREFIX = 'enc:v1:';
const ALGORITHM = 'aes-256-gcm';

function getKeySecret(): Buffer {
  const hex = process.env.YIMU_KEY_SECRET;
  if (!hex) {
    throw new Error(
      'YIMU_KEY_SECRET 未配置，无法加解密 API Key（请在项目根 .env 中配置 64 位 hex）',
    );
  }
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error('YIMU_KEY_SECRET 格式非法：应为 64 位 hex（32 字节）');
  }
  return Buffer.from(hex, 'hex');
}

/**
 * 写入落库前调用：明文 → 密文。
 * null / undefined / 空串原样返回（与 drizzle 列语义一致，不制造假值）。
 */
export function encryptApiKey(
  value: string | null | undefined,
): string | null | undefined {
  if (value === null || value === undefined || value === '') return value;
  const key = getKeySecret();
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, authTag, ciphertext]).toString('base64');
}

/**
 * 读取使用前调用：密文 → 明文。
 * 存量明文（无 'enc:v1:' 前缀）原样返回，便于新旧数据并存的灰度期；
 * null / undefined / 空串原样返回。
 */
export function decryptApiKey(
  value: string | null | undefined,
): string | null | undefined {
  if (value === null || value === undefined || value === '') return value;
  if (!value.startsWith(PREFIX)) return value; // 存量明文，灰度兼容
  const key = getKeySecret();
  const raw = Buffer.from(value.slice(PREFIX.length), 'base64');
  if (raw.length < 28) {
    throw new Error('API Key 密文损坏：长度不足（iv 12 + authTag 16）');
  }
  const iv = raw.subarray(0, 12);
  const authTag = raw.subarray(12, 28);
  const ciphertext = raw.subarray(28);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString(
    'utf8',
  );
}
