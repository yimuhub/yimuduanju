import {
  isAgnesEndpoint,
  normalizeFormatType,
  parseVideoChannelPreference,
  resolveVideoChannel,
  videoChannelHint,
  videoChannelLabel,
} from '@shared/video-channel';

/**
 * 回归：视频通道必须显式可分辨（2026-11-16）
 *
 * 用户诉求原话：「Agnes 视频模型是一个单独的选项，而不是通用选项；只有配置了
 * Agnes 的密钥、或接通这个模型以后，它才会起作用。我们还要有一套针对通用版
 * 视频生成的 API 通道。」
 *
 * 旧实现靠 `formatType === 'agnes' || agnesSchema === 'relay'` 隐式推断，
 * 两个真实事故：
 * 1) 官方 Agnes 端点被配成 openai 格式 → 网关按通用 /video/generations 发
 *    通用字段 → Agnes 只认 /videos 方言 → 稳定 400（11-14 图片侧同源事故的视频版）；
 * 2) DB 里火山供应商的 format_type 是历史脏值 `volcano`，枚举里却是
 *    `volcengine_ark` → 掉进通用分支、拿空 baseUrl 发请求。
 */

describe('视频通道解析：Agnes 专用 / 通用 / 火山', () => {
  it('formatType=agnes 明确走 Agnes 通道', () => {
    expect(
      resolveVideoChannel({
        formatType: 'agnes',
        baseUrl: 'https://apihub.agnes-ai.com/v1',
        videoModel: 'agnes-video-2.5-flash',
      }),
    ).toBe('agnes');
  });

  it('官方 Agnes 端点被错配成 openai，仍凭端点识别为 Agnes（关键回归）', () => {
    expect(
      resolveVideoChannel({
        formatType: 'openai',
        baseUrl: 'https://apihub.agnes-ai.com/v1',
        videoModel: 'some-model',
      }),
    ).toBe('agnes');
  });

  it('端点被配成内网中继但模型名是 agnes/*，仍识别为 Agnes', () => {
    expect(
      resolveVideoChannel({
        formatType: 'openai',
        baseUrl: 'http://127.0.0.1:3425/v1',
        videoModel: 'agnes/agnes-video-2.5-flash',
      }),
    ).toBe('agnes');
  });

  it('agnesSchema=relay 走 Agnes 方言（本地中继）', () => {
    expect(
      resolveVideoChannel({
        formatType: 'openai',
        baseUrl: 'http://127.0.0.1:3425/v1',
        videoModel: 'custom-video',
        modelParams: { agnesSchema: 'relay' },
      }),
    ).toBe('agnes');
  });

  it('没有任何 agnes 特征时走通用通道，不会误抢', () => {
    expect(
      resolveVideoChannel({
        formatType: 'openai',
        baseUrl: 'https://api.example.com/v1',
        videoModel: 'veo-3',
      }),
    ).toBe('generic');
  });

  it('火山历史脏值 volcano 归一化为 volcengine_ark', () => {
    expect(normalizeFormatType('volcano')).toBe('volcengine_ark');
    expect(
      resolveVideoChannel({
        formatType: 'volcano',
        baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
        videoModel: 'doubao-seedance-2-0-260128',
      }),
    ).toBe('volcengine_ark');
  });

  it('显式声明 videoChannel=generic 时，即使端点是 Agnes 也按用户选择走通用', () => {
    expect(
      resolveVideoChannel({
        formatType: 'agnes',
        baseUrl: 'https://apihub.agnes-ai.com/v1',
        videoModel: 'agnes-video-2.5-flash',
        modelParams: { videoChannel: 'generic' },
      }),
    ).toBe('generic');
  });

  it('显式声明 Agnes 时，即使 formatType 是 openai 也走 Agnes（纠偏优先）', () => {
    expect(
      resolveVideoChannel({
        formatType: 'openai',
        baseUrl: 'https://relay.example.com/v1',
        videoModel: 'custom',
        modelParams: { videoChannel: 'agnes' },
      }),
    ).toBe('agnes');
  });

  it('非 Agnes 通道不会因为模型名里带 agnes 子串而误判（需要分隔符）', () => {
    expect(
      resolveVideoChannel({
        formatType: 'openai',
        baseUrl: 'https://api.example.com/v1',
        videoModel: 'notagnes-video',
      }),
    ).toBe('generic');
  });
});

describe('通道声明解析与文案', () => {
  it('脏值/空值一律视为 auto', () => {
    expect(parseVideoChannelPreference(undefined)).toBe('auto');
    expect(parseVideoChannelPreference('')).toBe('auto');
    expect(parseVideoChannelPreference('whatever')).toBe('auto');
  });

  it('常见别名归一化', () => {
    expect(parseVideoChannelPreference('OpenAI')).toBe('generic');
    expect(parseVideoChannelPreference('openai-compatible')).toBe('generic');
    expect(parseVideoChannelPreference('volcano')).toBe('volcengine_ark');
    expect(parseVideoChannelPreference('ARK')).toBe('volcengine_ark');
  });

  it('端点识别只认 agnes-ai.com 域名', () => {
    expect(isAgnesEndpoint({ baseUrl: 'https://apihub.agnes-ai.com/v1' })).toBe(true);
    expect(isAgnesEndpoint({ baseUrl: 'https://notagnes-ai.com.evil.com/v1' })).toBe(false);
    expect(isAgnesEndpoint({ baseUrl: 'http://127.0.0.1:3425/v1' })).toBe(false);
  });

  it('每个通道都有可读标签与说明，说明里不承诺未实现的能力', () => {
    expect(videoChannelLabel('agnes')).toContain('Agnes');
    expect(videoChannelLabel('generic')).toContain('通用');
    expect(videoChannelLabel('volcengine_ark')).toContain('火山');
    expect(videoChannelHint('agnes')).toContain('/videos');
    expect(videoChannelHint('generic')).toContain('/video/generations');
    expect(videoChannelHint('volcengine_ark')).toContain('/contents/generations/tasks');
  });
});
