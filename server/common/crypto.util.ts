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

/**
 * 密钥缓存。
 * 修复：旧实现每次 encrypt/decrypt 都重读并重校验 process.env，热路径上纯属浪费；
 * 更关键的是配置错误只在「第一次真正用到密钥」时才暴露，表现为供应商列表接口莫名 500，
 * 运维难以定位。现在缓存解析结果，并提供 validateCryptoConfig() 供启动期自检。
 */
let cachedKey: Buffer | null = null;
let cachedKeyHex: string | null = null;

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
  // 仅在环境变量未变化时复用缓存（保留测试中改写 env 的能力）
  if (cachedKey && cachedKeyHex === hex) return cachedKey;
  cachedKey = Buffer.from(hex, 'hex');
  cachedKeyHex = hex;
  return cachedKey;
}

/**
 * 启动期自检：把「密钥缺失 / 格式非法」从首次调用时的 500 提前到启动日志。
 * 返回问题描述数组，空数组表示就绪。本函数不抛异常，由调用方决定是否 fail-fast。
 */
export function validateCryptoConfig(): string[] {
  const problems: string[] = [];
  try {
    getKeySecret();
  } catch (e) {
    problems.push((e as Error).message);
  }
  return problems;
}

/**
 * 读路径安全解密：密钥缺失或 GCM 认证失败（密钥轮换 / 密文损坏）时返回 null，
 * 而不是抛出未捕获异常。
 * 修复：decryptApiKey 处在供应商列表等读路径上（model-gateway 的 enrich），
 * 一次配置疏漏或一次密钥轮换会让所有 Provider 接口 500，且错误信息不可读。
 * 写路径与真正要拿密钥发请求的路径仍应使用会抛异常的 decryptApiKey。
 */
export function tryDecryptApiKey(
  value: string | null | undefined,
): string | null {
  if (value === null || value === undefined || value === '') return null;
  try {
    return decryptApiKey(value) ?? null;
  } catch {
    return null;
  }
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
