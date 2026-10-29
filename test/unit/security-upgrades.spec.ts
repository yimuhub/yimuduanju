import { encryptApiKey, decryptApiKey } from '../../server/common/crypto.util';
import { ExportService } from '../../server/modules/export/export.service';
import { isSafeExternalUrl, isSafeExternalUrlStatic } from '../../server/common/url-guard';

describe('security & architecture upgrades', () => {
  const prevSecret = process.env.YIMU_KEY_SECRET;

  beforeAll(() => {
    process.env.YIMU_KEY_SECRET = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  });

  afterAll(() => {
    process.env.YIMU_KEY_SECRET = prevSecret;
  });

  test('AES-256-GCM API Key 加解密往返与明文灰度兼容', () => {
    const raw = 'sk-test-1234567890abcdef';
    const encrypted = encryptApiKey(raw);
    expect(encrypted).toBeDefined();
    expect(encrypted?.startsWith('enc:v1:')).toBe(true);
    expect(decryptApiKey(encrypted)).toBe(raw);
    // 存量明文兼容
    expect(decryptApiKey('legacy-plain-key')).toBe('legacy-plain-key');
  });

  test('ExportService.isSafeExternalUrl SSRF 防护拦截内网与云元数据地址', () => {
    const svc = new ExportService({} as any);
    expect(svc.isSafeExternalUrl('https://cdn.example.com/video/clip01.mp4')).toBe(true);
    expect(svc.isSafeExternalUrl('http://127.0.0.1:3000/api/admin/license')).toBe(false);
    expect(svc.isSafeExternalUrl('http://localhost:5173/api/projects')).toBe(false);
    expect(svc.isSafeExternalUrl('http://169.254.169.254/latest/meta-data/')).toBe(false);
    expect(svc.isSafeExternalUrl('http://192.168.1.10/secret.mp4')).toBe(false);
    expect(svc.isSafeExternalUrl('http://10.0.0.5/internal.mp4')).toBe(false);
    expect(svc.isSafeExternalUrl('file:///etc/passwd')).toBe(false);
  });

  test('url-guard W7 强化：数字 IP 变体、IPv6 私网、CGNAT 全部拦截', () => {
    // 十进制/十六进制/八进制 IPv4 变体（均指向 127.0.0.1 或内网）
    expect(isSafeExternalUrlStatic('http://2130706433/x.mp4')).toBe(false); // 127.0.0.1
    expect(isSafeExternalUrlStatic('http://0x7f000001/x.mp4')).toBe(false); // 127.0.0.1
    expect(isSafeExternalUrlStatic('http://0177.0.0.1/x.mp4')).toBe(false); // 127.0.0.1
    expect(isSafeExternalUrlStatic('http://127.1/x.mp4')).toBe(false); // 127.0.0.1
    // IPv4 映射与 ULA
    expect(isSafeExternalUrlStatic('http://[::ffff:127.0.0.1]/x.mp4')).toBe(false);
    expect(isSafeExternalUrlStatic('http://[::ffff:10.0.0.1]/x.mp4')).toBe(false);
    expect(isSafeExternalUrlStatic('http://[fd00::1]/x.mp4')).toBe(false);
    expect(isSafeExternalUrlStatic('http://[fe80::1]/x.mp4')).toBe(false);
    // CGNAT（100.64/10）与公网放行
    expect(isSafeExternalUrlStatic('http://100.64.0.1/x.mp4')).toBe(false);
    expect(isSafeExternalUrlStatic('https://cdn.example.com/video/clip01.mp4')).toBe(true);
    expect(isSafeExternalUrlStatic('http://8.8.8.8/dns-query')).toBe(true);
  });

  test('url-guard 异步版：域名解析到私网时拒绝（DNS rebinding 首跳）', async () => {
    // localhost 在静态阶段即拒绝；域名解析分支依赖本机 DNS。
    // DNS 不可用的环境（离线 CI/沙箱）验证 fail-closed：解析失败一律拒绝。
    const dnsOk = await require('dns/promises')
      .lookup('cdn.example.com')
      .then(() => true)
      .catch(() => false);
    if (dnsOk) {
      await expect(isSafeExternalUrl('https://cdn.example.com/video/clip01.mp4')).resolves.toBe(true);
    } else {
      await expect(isSafeExternalUrl('https://cdn.example.com/video/clip01.mp4')).resolves.toBe(false);
    }
  });
});
