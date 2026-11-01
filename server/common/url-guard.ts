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

/**
 * 危险端口黑名单。
 * 修复：旧实现对端口没有任何限制，`http://public-host:22/` 也能通过校验，
 * 使 SSRF 守卫退化成「只能挡私网 IP」，挡不住借服务端身份对公网主机上
 * 基础设施端口（SSH / DB / Redis / ES / Docker API …）的探测与打点。
 * 这里用黑名单而非白名单：外部媒体 CDN 绝大多数走 80/443，但确有非标准端口的
 * 合法源，白名单会误伤业务；而基础设施端口是明确可枚举的。
 */
const BLOCKED_PORTS = new Set([
  '20', '21', '22', '23', '25', '53', '110', '135', '139', '143', '445',
  '1433', '1521', '2375', '2376', '3306', '3389', '5432', '5900', '5984',
  '6379', '7001', '9200', '9300', '11211', '27017', '27018', '50070',
]);

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
    // 末段可占满剩余字节（inet_aton 语义：k 段时末段宽 5-k 字节），其余段 ≤ 255
    const max = i === parts.length - 1 ? 256 ** (5 - parts.length) - 1 : 255;
    if (n > max) return null;
    nums.push(n);
  }
  // 按位权组合成 32 位整数（等价 inet_aton 的省略段语义），再拆 4 段。
  // 修复：前 k-1 段各占 1 字节，末段必须左移 (5-k) 字节后并入；
  // 旧实现对所有段统一 *256+n，短形式（如 8.8 / 2130706433）高位恒为 0，
  // 会被 a===0 误判私网，与「inet_aton 语义」的注释不符。
  let value = 0;
  for (let i = 0; i < nums.length - 1; i += 1) {
    value = (value * 256 + nums[i]) >>> 0;
  }
  const tailBytes = 5 - nums.length;
  value = (value * 2 ** (8 * tailBytes) + nums[nums.length - 1]) >>> 0;
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
    a >= 224 // 224.0.0.0/4 组播 + 240.0.0.0/4 保留 + 255.255.255.255 广播，一律拒绝
  );
}

/** IPv6 是否为环回/私网/链路本地/IPv4 映射私网 */
// 导出仅为可测试性：这是 SSRF 守卫里唯一处理 dns.lookup() 返回值的函数，
// 而 lookup 对 IPv4-mapped 地址返回的正是点分形式 ::ffff:127.0.0.1，
// 必须能被单测直接覆盖（见 test/unit/url-guard.spec.ts）。
export function isPrivateIpv6(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (h === '::' || h === '::1') return true;
  if (h.startsWith('fe8') || h.startsWith('fe9') || h.startsWith('fea') || h.startsWith('feb')) return true;
  if (/^f[cd]/.test(h)) return true; // fc00::/7 ULA
  // ::ffff:0:0/96 IPv4 映射段：URL 序列化通常会把点分形式规范成十六进制（如 ::ffff:7f00:1），
  // 但 dns.lookup() 对 IPv4-mapped 地址恰恰返回点分形式 ::ffff:127.0.0.1，
  // 而本函数的入参正是 lookup 的 address。因此先展开成 8 组 16 位数（含点分四元组），
  // 再取末 32 位按 IPv4 判定。
  const groups = expandIpv6(h);
  // 安全修复：解析失败必须 fail-closed。旧实现在 groups 为 null 时 return false（判为安全），
  // 使得任何非规范 IPv6 文本（如 ::ffff:127.0.0.1）直接绕过全部私网判定。
  if (!groups) return true;
  if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) {
    const hi = groups[6];
    const lo = groups[7];
    return isPrivateIpv4([(hi >>> 8) & 255, hi & 255, (lo >>> 8) & 255, lo & 255]);
  }
  // ::a.b.c.d IPv4 兼容段（已废弃但仍可路由到本机），同样按 IPv4 判定
  if (groups.slice(0, 6).every((g) => g === 0)) {
    const hi = groups[6];
    const lo = groups[7];
    return isPrivateIpv4([(hi >>> 8) & 255, hi & 255, (lo >>> 8) & 255, lo & 255]);
  }
  return false;
}

/** 展开 IPv6 文本为 8 组 16 位整数；支持 :: 压缩与末段点分四元组，解析失败返回 null */
// 导出仅为可测试性（点分四元组折叠与 fail-closed 行为需要直接覆盖）
export function expandIpv6(h: string): number[] | null {
  if (!/^[0-9a-f:.]+$/.test(h)) return null;
  const sections = h.split('::');
  if (sections.length > 2) return null;
  const parseGroups = (s: string, allowDotted: boolean): number[] | null => {
    if (s === '') return [];
    const parts = s.split(':');
    const out: number[] = [];
    for (let i = 0; i < parts.length; i += 1) {
      const p = parts[i];
      // 点分四元组只允许出现在整个地址的最末尾（如 ::ffff:127.0.0.1），折成两组 16 位。
      // allowDotted=false 用于 '::' 的前段 —— 否则 '127.0.0.1::1' 这类非法文本会被接受。
      if (p.includes('.')) {
        if (!allowDotted || i !== parts.length - 1) return null;
        const v4 = decodeIpv4(p);
        if (!v4) return null;
        out.push((v4[0] << 8) | v4[1], (v4[2] << 8) | v4[3]);
        continue;
      }
      if (!/^[0-9a-f]{1,4}$/.test(p)) return null;
      out.push(parseInt(p, 16));
    }
    return out;
  };
  // 未压缩形式（无 '::'）整体就是完整地址，末段可带点分四元组；
  // 压缩形式只有 '::' 之后的尾段可以带。
  const head = parseGroups(sections[0] ?? '', sections.length === 1);
  const tail = sections.length === 2 ? parseGroups(sections[1] ?? '', true) : [];
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
  // 修复：端口黑名单（见 BLOCKED_PORTS 说明）。parsed.port 为默认端口时是空串。
  if (parsed.port !== '' && BLOCKED_PORTS.has(parsed.port)) return false;
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
    // 安全修复：文件头承诺「任一解析结果落在私网/保留段即拒绝」，但旧实现用
    // { all: false } 只取一条记录。多 A 记录主机（公网 + 内网混排）可能只检查到
    // 公网那条，随后 fetch 又解析到内网记录，形成 DNS 记录轮换式绕过。
    const records = await lookup(host, { all: true, verbatim: true });
    if (records.length === 0) return false;
    for (const { address } of records) {
      const v4 = decodeIpv4(address);
      if (v4 ? isPrivateIpv4(v4) : isPrivateIpv6(address)) return false;
    }
    return true;
  } catch {
    return false; // 解析失败按不安全处理
  }
}
