/**
 * 图片上游策略回归（2026-11-14 事故）
 * ------------------------------------------------------------------
 * ① 「Agnes 官方 API」被配成 format_type=openai，网关照发 negative_prompt，
 *    9 张纯文生图全部 400「negative_prompt is not supported by text image queue」；
 *    带参考图的 i2i 请求反而成功，所以症状看起来像「设定图全挂、首帧正常」。
 * ② gptfree-pool 免费额度上限、内容政策拒绝这类确定性 400 也被重试 3 次，
 *    配合 60s 超时在 20 点打出 150 次超时，把本地中继彻底堵死。
 */
import {
  isAgnesImageChannel,
  isPermanentImageUpstreamError,
} from '@server/modules/generation/rate-limit.util';

describe('Agnes 图片通道识别（不能只信 formatType）', () => {
  it('formatType=agnes 时按 Agnes 处理', () => {
    expect(isAgnesImageChannel('agnes', 'https://apihub.agnes-ai.com/v1')).toBe(true);
  });

  it('官方 Agnes 端点被误配成 openai 时仍按 Agnes 处理', () => {
    expect(isAgnesImageChannel('openai', 'https://apihub.agnes-ai.com/v1')).toBe(true);
    expect(isAgnesImageChannel('openai', 'HTTPS://APIHUB.AGNES-AI.COM/V1')).toBe(true);
  });

  it('本地中继与其它供应商不被误判（仍可发送 negative_prompt）', () => {
    expect(isAgnesImageChannel('openai', 'http://127.0.0.1:3425/v1')).toBe(false);
    expect(isAgnesImageChannel('openai', 'https://api.openai.com/v1')).toBe(false);
    expect(isAgnesImageChannel('volcano', '')).toBe(false);
  });
});

describe('确定性上游拒绝不再消耗重试预算', () => {
  it.each([
    [
      '参数不支持',
      '图片生成失败 (400, https://apihub.agnes-ai.com/v1/images/generations): {"error":{"message":"negative_prompt is not supported by text image queue"}}',
    ],
    [
      '免费额度上限',
      '图片生成失败 (400, http://127.0.0.1:3425/v1/images/generations): gptfree-pool: 你已达到 Free 套餐的图像生成请求上限。上限将在 17小时 后重置',
    ],
    [
      '内容政策拒绝',
      '图片生成失败 (400, http://127.0.0.1:3425/v1/images/generations): 非常抱歉，生成的图片可能违反了我们的内容政策',
    ],
  ])('%s → 判定为确定性失败', (_label, message) => {
    expect(isPermanentImageUpstreamError(message)).toBe(true);
  });

  it.each([
    '图片生成请求失败: 请求超时（>60000ms）：http://127.0.0.1:3425/v1/images/generations',
    '图片生成被上游拒绝 (429): You have reached the API rate limit for free users',
    '视频生成失败 (503, https://apihub.agnes-ai.com/v1/videos): video_queue_full',
    'Agnes 图片接口临时返回 502 Bad Gateway',
  ])('可恢复故障仍走原有重试路径：%s', (message) => {
    expect(isPermanentImageUpstreamError(message)).toBe(false);
  });
});
