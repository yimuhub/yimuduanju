import { encryptApiKey, decryptApiKey } from '../../server/common/crypto.util';
import { ExportService } from '../../server/modules/export/export.service';

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
});
