import { lookup } from 'dns/promises';

/**
 * 外部媒体 URL 安全校验（SSRF 防护，W7 强化版）。
 *
 * 校验项：
 * - 仅允许 http/https；
 * - 拒绝 localhost / 0.0.0.0 / .local / .internal 主机名；
 * - 拒绝全部私网/保留段 IPv4（点分、十进制、十六进制、八进制等数字变体统一解码后判断）；
 * - 拒绝 IPv6 环回、ULA（fc00::/7）、链路本地（fe80::/10）与 IPv4 映射地址（::ffff:a.b.c.d）；
 * - 域名先经系统 DNS 解析，任一解析结果落在私网/保留段即拒绝（防 DNS rebinding 首跳）。
 *
 * 用途：服务端代表项目拉取外部媒体（导出合成、资产取流）。BYO 供应商 baseUrl 不走此守卫——
 * 本地模式直连 Ollama/中转站是核心功能；SaaS 多租户部署时应以网络层出站策略隔离。
 */

const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/** 把 IPv4 文本（含十进制/十六进制/八进制变体）解码为 4 段；无法解码返回 null */
export function decodeIpv4(host: string): [number, number, number, number] | null {
  if (IPV4_RE.test(host)) {
    const parts = host.split('.').map(Number);
    if (parts.some((n) => n > 255)) return null; // URL 解析不会出现，双保险
    return [parts[0], parts[1], parts[2], parts[3]];
  }
  if (!/^[0-9xXa-fA-F.]+$/.test(host)) return null;
  // 仅含数字与点（可能省略段）或 0x 前缀变体，按 inet_aton 语义解析
  const parts = host.split('.');
  if (parts.length > 4) return null;
  const nums: number[] = [];
  for (let i = 0; i < parts.length; i += 1) {
    const p = parts[i];
    if (p === '') return null;
    let n: number;
    if (/^0[xX][0-9a-fA-F]+$/.test(p)) n = parseInt(p, 16);
    else if (/^0[0-7]+$/.test(p)) n = parseInt(p, 8);
    else if (/^\d+$/.test(p)) n = parseInt(p, 10);
    else return null;
    // 末段可到 32bit（inet_aton 最后一段全量），其余段 ≤ 255
    const max = i === parts.length - 1 ? 256 ** (5 - parts.length) - 1 : 255;
    if (n > max) return null;
    nums.push(n);
  }
  // 按位权组合成 32 位整数（等价 inet_aton 的省略段语义），再拆 4 段
  let value = 0;
  for (const n of nums) value = value * 256 + n;
  return [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255];
}

/** 判断解码后的 IPv4 是否落在私网/保留段 */
export function isPrivateIpv4([a, b]: [number, number, number, number]): boolean {
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a >= 224 && a !== 255) || // 组播/保留（255.x 仅留 x.x.255.255 广播，实际也拒绝）
    (a === 255)
  );
}

/** IPv6 是否为环回/私网/链路本地/IPv4 映射私网 */
function isPrivateIpv6(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (h === '::' || h === '::1') return true;
  if (h.startsWith('fe8') || h.startsWith('fe9') || h.startsWith('fea') || h.startsWith('feb')) return true;
  if (/^f[cd]/.test(h)) return true; // fc00::/7 ULA
  // ::ffff:0:0/96 IPv4 映射段：URL 序列化会把点分形式规范成十六进制（如 ::ffff:7f00:1），
  // 因此先展开成 8 组 16 位数，再取末 32 位按 IPv4 判定
  const groups = expandIpv6(h);
  if (groups) {
    if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) {
      const hi = groups[6];
      const lo = groups[7];
      return isPrivateIpv4([(hi >>> 8) & 255, hi & 255, (lo >>> 8) & 255, lo & 255]);
    }
    return false;
  }
  return false;
}

/** 展开 IPv6 文本为 8 组 16 位整数；支持 :: 压缩，解析失败返回 null */
function expandIpv6(h: string): number[] | null {
  if (!/^[0-9a-f:.]+$/.test(h)) return null;
  const sections = h.split('::');
  if (sections.length > 2) return null;
  const parseGroups = (s: string): number[] | null => {
    if (s === '') return [];
    const parts = s.split(':');
    const out: number[] = [];
    for (const p of parts) {
      if (!/^[0-9a-f]{1,4}$/.test(p)) return null;
      out.push(parseInt(p, 16));
    }
    return out;
  };
  const head = parseGroups(sections[0] ?? '');
  const tail = sections.length === 2 ? parseGroups(sections[1] ?? '') : [];
  if (!head || !tail) return null;
  if (sections.length === 2) {
    if (head.length + tail.length > 7) return null;
    return [...head, ...Array(8 - head.length - tail.length).fill(0), ...tail];
  }
  return head.length === 8 ? head : null;
}

/** 同步静态校验：URL 结构与数字地址；不解析 DNS */
export function isSafeExternalUrlStatic(rawUrl: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  const host = parsed.hostname.toLowerCase();
  if (!host) return false;
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    return false;
  }
  const v4 = decodeIpv4(host);
  if (v4) return !isPrivateIpv4(v4);
  if (host.includes(':')) return !isPrivateIpv6(host); // 裸 IPv6 或 [v6]
  return true; // 域名：静态阶段放行，DNS 校验在异步版完成
}

/** 异步完整校验：静态校验 + DNS 解析结果复检（防域名解析到内网地址） */
export async function isSafeExternalUrl(rawUrl: string): Promise<boolean> {
  if (!isSafeExternalUrlStatic(rawUrl)) return false;
  let host: string;
  try {
    host = new URL(rawUrl).hostname;
  } catch {
    return false;
  }
  if (decodeIpv4(host) || host.includes(':')) return true; // 数字地址已在静态阶段判定
  try {
    const { address } = await lookup(host, { all: false });
    const v4 = decodeIpv4(address);
    if (v4) return !isPrivateIpv4(v4);
    return !isPrivateIpv6(address);
  } catch {
    return false; // 解析失败按不安全处理
  }
}
