/**
 * url-guard 回归测试（SSRF 防护）。
 *
 * 覆盖本轮修复的四处缺陷：
 * 1) decodeIpv4 短形式（inet_aton 语义）组合错误 —— 旧实现对所有段统一 *256+n，
 *    导致 '8.8' / '2130706433' 高位恒为 0，被 a===0 误判私网；
 * 2) isPrivateIpv6 在 expandIpv6 返回 null 时 fail-open —— 任何非规范 IPv6 文本
 *    （尤其是 dns.lookup 对 IPv4-mapped 地址返回的点分形式 ::ffff:127.0.0.1）
 *    都能绕过全部私网判定；
 * 3) expandIpv6 不支持末段点分四元组，使 (2) 的绕过成为可能；
 * 4) isSafeExternalUrlStatic 对端口无任何限制，http://public-host:22/ 可通过。
 *
 * 本文件只依赖纯函数，不引入 Nest / DB / 网络，可在 `npm test` 下稳定运行。
 */
import {
  decodeIpv4,
  expandIpv6,
  isPrivateIpv4,
  isPrivateIpv6,
  isSafeExternalUrlStatic,
} from '../../server/common/url-guard';

describe('decodeIpv4 — inet_aton 语义', () => {
  it('解析标准点分四元组', () => {
    expect(decodeIpv4('127.0.0.1')).toEqual([127, 0, 0, 1]);
    expect(decodeIpv4('8.8.8.8')).toEqual([8, 8, 8, 8]);
    expect(decodeIpv4('0.0.0.0')).toEqual([0, 0, 0, 0]);
  });

  it('解析十进制整数形式（回归：旧实现高位恒为 0）', () => {
    // 2130706433 === 127.0.0.1
    expect(decodeIpv4('2130706433')).toEqual([127, 0, 0, 1]);
    // 167772161 === 10.0.0.1
    expect(decodeIpv4('167772161')).toEqual([10, 0, 0, 1]);
  });

  it('解析十六进制形式', () => {
    expect(decodeIpv4('0x7f000001')).toEqual([127, 0, 0, 1]);
    expect(decodeIpv4('0xA000001')).toEqual([10, 0, 0, 1]);
  });

  it('解析八进制形式', () => {
    expect(decodeIpv4('0177.0.0.1')).toEqual([127, 0, 0, 1]);
  });

  it('解析两段省略形式（回归：旧实现把 8.8 算成 0.0.8.8 从而误判私网）', () => {
    // inet_aton('8.8') === 8.0.0.8
    expect(decodeIpv4('8.8')).toEqual([8, 0, 0, 8]);
    // inet_aton('10.1') === 10.0.0.1 → 私网
    expect(decodeIpv4('10.1')).toEqual([10, 0, 0, 1]);
  });

  it('解析三段省略形式', () => {
    // inet_aton('1.2.3') === 1.2.0.3
    expect(decodeIpv4('1.2.3')).toEqual([1, 2, 0, 3]);
    // inet_aton('127.0.1') === 127.0.0.1
    expect(decodeIpv4('127.0.1')).toEqual([127, 0, 0, 1]);
  });

  it('拒绝非法输入', () => {
    expect(decodeIpv4('999.1.1.1')).toBeNull();
    expect(decodeIpv4('1.2.3.4.5')).toBeNull();
    expect(decodeIpv4('example.com')).toBeNull();
    expect(decodeIpv4('')).toBeNull();
    expect(decodeIpv4('1..2')).toBeNull();
  });
});

describe('isPrivateIpv4 — 私网/保留段', () => {
  const cases: Array<[[number, number, number, number], boolean, string]> = [
    [[0, 0, 0, 0], true, '0.0.0.0/8'],
    [[10, 0, 0, 1], true, 'RFC1918 10/8'],
    [[127, 0, 0, 1], true, '环回'],
    [[100, 64, 0, 1], true, 'CGNAT 下界'],
    [[100, 127, 255, 255], true, 'CGNAT 上界'],
    [[100, 128, 0, 1], false, 'CGNAT 之外'],
    [[169, 254, 1, 1], true, '链路本地'],
    [[172, 16, 0, 1], true, 'RFC1918 172.16/12 下界'],
    [[172, 31, 255, 255], true, 'RFC1918 172.16/12 上界'],
    [[172, 32, 0, 1], false, '172.32 不属于私网'],
    [[192, 168, 1, 1], true, 'RFC1918 192.168/16'],
    [[192, 0, 2, 1], true, '192.0.0/24 保留'],
    [[198, 18, 0, 1], true, '基准测试 198.18/15'],
    [[198, 51, 100, 1], false, 'TEST-NET-2 不在拒绝表内'],
    [[224, 0, 0, 1], true, '组播下界'],
    [[239, 255, 255, 255], true, '组播上界'],
    [[240, 0, 0, 1], true, '保留段'],
    [[255, 255, 255, 255], true, '广播（回归：旧实现 a===255 分支为死逻辑）'],
    [[223, 255, 255, 255], false, '组播/保留段之外的最后一个公网地址'],
    [[8, 8, 8, 8], false, '公网 DNS'],
  ];

  it.each(cases)('%s → %s（%s）', (ip, expected) => {
    expect(isPrivateIpv4(ip)).toBe(expected);
  });
});

describe('expandIpv6 — :: 压缩与末段点分四元组', () => {
  it('展开完整 8 组', () => {
    expect(expandIpv6('2001:db8:0:0:0:0:0:1')).toEqual([
      0x2001, 0xdb8, 0, 0, 0, 0, 0, 1,
    ]);
  });

  it('展开 :: 压缩', () => {
    expect(expandIpv6('::1')).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
    expect(expandIpv6('2001:db8::1')).toEqual([
      0x2001, 0xdb8, 0, 0, 0, 0, 0, 1,
    ]);
  });

  it('折叠末段点分四元组（回归：旧实现直接返回 null）', () => {
    // ::ffff:127.0.0.1 === ::ffff:7f00:1
    expect(expandIpv6('::ffff:127.0.0.1')).toEqual([
      0, 0, 0, 0, 0, 0xffff, 0x7f00, 0x0001,
    ]);
    expect(expandIpv6('::ffff:8.8.8.8')).toEqual([
      0, 0, 0, 0, 0, 0xffff, 0x0808, 0x0808,
    ]);
  });

  it('非末段的点分四元组非法', () => {
    expect(expandIpv6('127.0.0.1::1')).toBeNull();
  });

  it('非法文本返回 null', () => {
    expect(expandIpv6('bogus')).toBeNull();
    expect(expandIpv6('1:2:3')).toBeNull(); // 未压缩且不足 8 组
    expect(expandIpv6('1::2::3')).toBeNull(); // 两个 ::
  });
});

describe('isPrivateIpv6 — fail-closed 与 IPv4 映射段', () => {
  it('环回 / ULA / 链路本地', () => {
    expect(isPrivateIpv6('::1')).toBe(true);
    expect(isPrivateIpv6('::')).toBe(true);
    expect(isPrivateIpv6('fc00::1')).toBe(true);
    expect(isPrivateIpv6('fd12:3456::1')).toBe(true);
    expect(isPrivateIpv6('fe80::1')).toBe(true);
  });

  it('IPv4 映射段的十六进制形式', () => {
    expect(isPrivateIpv6('::ffff:7f00:1')).toBe(true);
    expect(isPrivateIpv6('::ffff:0a00:1')).toBe(true);
    expect(isPrivateIpv6('::ffff:808:808')).toBe(false);
  });

  it('IPv4 映射段的点分形式（回归：这是 SSRF 绕过的关键路径）', () => {
    // dns.lookup() 对 IPv4-mapped 地址返回的正是这种点分文本。
    // 旧实现 expandIpv6 解析失败 → groups 为 null → return false（判为安全），
    // 攻击者只要控制 AAAA 记录即可绕过全部私网判定。
    expect(isPrivateIpv6('::ffff:127.0.0.1')).toBe(true);
    expect(isPrivateIpv6('::ffff:10.0.0.1')).toBe(true);
    expect(isPrivateIpv6('::ffff:192.168.1.1')).toBe(true);
    expect(isPrivateIpv6('::ffff:8.8.8.8')).toBe(false);
  });

  it('IPv4 兼容段 ::a.b.c.d', () => {
    expect(isPrivateIpv6('::127.0.0.1')).toBe(true);
    expect(isPrivateIpv6('::8.8.8.8')).toBe(false);
  });

  it('无法解析的文本一律按不安全处理（fail-closed）', () => {
    // 旧实现在这里 return false，等于放行
    expect(isPrivateIpv6('not-an-ip')).toBe(true);
    expect(isPrivateIpv6('zzzz::1')).toBe(true);
    expect(isPrivateIpv6('')).toBe(true);
  });

  it('公网 IPv6 放行', () => {
    expect(isPrivateIpv6('2001:db8::1')).toBe(false);
    expect(isPrivateIpv6('2606:4700:4700::1111')).toBe(false);
  });

  it('带方括号的形式同样生效', () => {
    expect(isPrivateIpv6('[::1]')).toBe(true);
    expect(isPrivateIpv6('[::ffff:127.0.0.1]')).toBe(true);
  });
});

describe('isSafeExternalUrlStatic — 协议 / 主机名 / 端口', () => {
  it('拒绝非 http(s) 协议', () => {
    expect(isSafeExternalUrlStatic('ftp://example.com/x')).toBe(false);
    expect(isSafeExternalUrlStatic('file:///etc/passwd')).toBe(false);
    expect(isSafeExternalUrlStatic('gopher://example.com/')).toBe(false);
  });

  it('拒绝无法解析的输入', () => {
    expect(isSafeExternalUrlStatic('')).toBe(false);
    expect(isSafeExternalUrlStatic('not a url')).toBe(false);
    expect(isSafeExternalUrlStatic('//example.com/x')).toBe(false);
  });

  it('拒绝本地主机名', () => {
    expect(isSafeExternalUrlStatic('http://localhost/x')).toBe(false);
    expect(isSafeExternalUrlStatic('http://a.localhost/x')).toBe(false);
    expect(isSafeExternalUrlStatic('http://foo.local/x')).toBe(false);
    expect(isSafeExternalUrlStatic('http://bar.internal/x')).toBe(false);
  });

  it('拒绝私网 IPv4 的各种数字变体', () => {
    expect(isSafeExternalUrlStatic('http://127.0.0.1/x')).toBe(false);
    expect(isSafeExternalUrlStatic('http://10.0.0.5/x')).toBe(false);
    expect(isSafeExternalUrlStatic('http://192.168.1.1/x')).toBe(false);
    expect(isSafeExternalUrlStatic('http://169.254.169.254/latest/meta-data')).toBe(false);
    expect(isSafeExternalUrlStatic('http://2130706433/x')).toBe(false); // 十进制环回
    expect(isSafeExternalUrlStatic('http://0x7f000001/x')).toBe(false); // 十六进制环回
    expect(isSafeExternalUrlStatic('http://0177.0.0.1/x')).toBe(false); // 八进制环回
  });

  it('拒绝 IPv6 环回与映射地址', () => {
    expect(isSafeExternalUrlStatic('http://[::1]/x')).toBe(false);
    expect(isSafeExternalUrlStatic('http://[::ffff:7f00:1]/x')).toBe(false);
    // URL 序列化会把点分形式规范成十六进制，两种写法都必须被拒
    expect(isSafeExternalUrlStatic('http://[::ffff:127.0.0.1]/x')).toBe(false);
    expect(isSafeExternalUrlStatic('http://[fe80::1]/x')).toBe(false);
  });

  it('放行公网地址与域名', () => {
    expect(isSafeExternalUrlStatic('https://example.com/x')).toBe(true);
    expect(isSafeExternalUrlStatic('http://8.8.8.8/x')).toBe(true);
    expect(isSafeExternalUrlStatic('http://[::ffff:8.8.8.8]/x')).toBe(true);
    expect(isSafeExternalUrlStatic('http://[2606:4700:4700::1111]/x')).toBe(true);
  });

  it('拒绝基础设施端口（回归：旧实现对端口无任何限制）', () => {
    expect(isSafeExternalUrlStatic('http://8.8.8.8:22/x')).toBe(false); // SSH
    expect(isSafeExternalUrlStatic('http://8.8.8.8:6379/x')).toBe(false); // Redis
    expect(isSafeExternalUrlStatic('http://8.8.8.8:3306/x')).toBe(false); // MySQL
    expect(isSafeExternalUrlStatic('http://8.8.8.8:5432/x')).toBe(false); // Postgres
    expect(isSafeExternalUrlStatic('http://8.8.8.8:9200/x')).toBe(false); // Elasticsearch
    expect(isSafeExternalUrlStatic('http://8.8.8.8:2375/x')).toBe(false); // Docker API
    expect(isSafeExternalUrlStatic('http://8.8.8.8:3389/x')).toBe(false); // RDP
  });

  it('放行常规 Web 端口', () => {
    expect(isSafeExternalUrlStatic('http://8.8.8.8:80/x')).toBe(true);
    expect(isSafeExternalUrlStatic('https://8.8.8.8:443/x')).toBe(true);
    expect(isSafeExternalUrlStatic('http://8.8.8.8:8080/x')).toBe(true);
    expect(isSafeExternalUrlStatic('https://example.com:8443/x')).toBe(true);
    // 非标准但非基础设施端口不应被误伤（媒体 CDN 确有此类源）
    expect(isSafeExternalUrlStatic('https://example.com:9000/x')).toBe(true);
  });
});
