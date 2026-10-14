import { createHmac } from 'crypto';

export interface LicenseInfo {
  mode: 'community' | 'enterprise';
  seats?: number;
  expiresAt?: string;
  expired?: boolean;
  message: string;
}

/**
 * W6 企业版 License（1.0 轻量实现）：
 * 格式 `base64url(payload).base64url(hmac_sha256(payload, LICENSE_SECRET))`，
 * payload 为 JSON：{"seats":50,"expiresAt":"2027-09-01T00:00:00.000Z"}。
 * 未配置 ENTERPRISE_LICENSE(_KEY) 时为 community 模式（功能全开、无商业授权）。
 */
const B64URL_RE = /^[A-Za-z0-9_-]+$/;

function b64urlDecode(input: string): string {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(padded, 'base64').toString('utf8');
}

export function verifyLicense(
  license: string | undefined,
  secret: string | undefined,
): LicenseInfo {
  if (!license) {
    return { mode: 'community', message: '未配置 License，运行于社区模式' };
  }
  if (!secret) {
    return {
      mode: 'community',
      message: 'License 缺少签名密钥（LICENSE_SECRET），回落社区模式',
    };
  }
  const parts = license.split('.');
  if (parts.length !== 2 || !parts.every((p) => B64URL_RE.test(p))) {
    return { mode: 'community', message: 'License 格式非法，回落社区模式' };
  }
  const [payloadB64, sigB64] = parts;
  const expected = createHmac('sha256', secret)
    .update(payloadB64)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  if (expected !== sigB64) {
    return { mode: 'community', message: 'License 签名无效，回落社区模式' };
  }
  try {
    const payload = JSON.parse(b64urlDecode(payloadB64)) as {
      seats?: number;
      expiresAt?: string;
    };
    const expired = payload.expiresAt
      ? Date.now() > new Date(payload.expiresAt).getTime()
      : false;
    if (expired) {
      return {
        mode: 'community',
        seats: payload.seats,
        expiresAt: payload.expiresAt,
        expired: true,
        message: 'License 已过期，回落社区模式，请续费',
      };
    }
    return {
      mode: 'enterprise',
      seats: payload.seats,
      expiresAt: payload.expiresAt,
      expired: false,
      message: '企业版授权有效',
    };
  } catch {
    return { mode: 'community', message: 'License 内容无法解析，回落社区模式' };
  }
}

/** 发 License 工具（供应商签发用）：node -e "console.log(sign({seats:50}, 'SECRET'))" */
export function signLicense(
  payload: { seats?: number; expiresAt?: string },
  secret: string,
): string {
  const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  const sig = createHmac('sha256', secret)
    .update(payloadB64)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `${payloadB64}.${sig}`;
}
