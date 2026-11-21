/**
 * G16 素材元数据归一化纯函数回归测试
 * ------------------------------------------------------------------
 * 验证 ffprobe JSON → AssetMetadata 契约：fps 分数解析、缺字段 / 非法值 → null、
 * 错误素材（无 streams 无 format）→ 全 null 形状。
 */
import {
  emptyAssetMetadata,
  normalizeAssetMetadata,
  parseFpsFraction,
  type FfprobeOutput,
} from '../../server/modules/assets/asset-metadata';

describe('parseFpsFraction', () => {
  it('标准分数（NTSC 30000/1001 → 29.97）', () => {
    expect(parseFpsFraction('30000/1001')).toBe(29.97);
  });

  it('整数形式与整分数', () => {
    expect(parseFpsFraction('25')).toBe(25);
    expect(parseFpsFraction('24/1')).toBe(24);
    expect(parseFpsFraction(' 30 / 1 ')).toBe(30);
  });

  it('非法值返回 null：0/0 占位、0 分母、非数字', () => {
    expect(parseFpsFraction('0/0')).toBeNull();
    expect(parseFpsFraction('0/1001')).toBeNull();
    expect(parseFpsFraction('25/0')).toBeNull();
    expect(parseFpsFraction('abc')).toBeNull();
    expect(parseFpsFraction('-25/1')).toBeNull();
    expect(parseFpsFraction('')).toBeNull();
    expect(parseFpsFraction(null)).toBeNull();
    expect(parseFpsFraction(undefined)).toBeNull();
  });
});

describe('normalizeAssetMetadata', () => {
  const fullProbe: FfprobeOutput = {
    format: { duration: '63.525000', bit_rate: '2137587', size: '16924713' },
    streams: [
      {
        codec_type: 'video',
        codec_name: 'h264',
        width: 1080,
        height: 1920,
        pix_fmt: 'yuv420p',
        r_frame_rate: '30000/1001',
      },
      { codec_type: 'audio', codec_name: 'aac' },
    ],
  };

  it('完整探测：宽高 / 时长 / 双编码 / fps / 码率 / 像素格式 / 体积', () => {
    expect(normalizeAssetMetadata(fullProbe)).toEqual({
      width: 1080,
      height: 1920,
      durationSeconds: 63.525,
      videoCodec: 'h264',
      audioCodec: 'aac',
      fps: 29.97,
      bitRate: 2137587,
      pixFmt: 'yuv420p',
      sizeBytes: 16924713,
    });
  });

  it('纯音频：无视频流时宽高 / fps / pix_fmt 为 null', () => {
    const audioOnly: FfprobeOutput = {
      format: { duration: '180.0' },
      streams: [{ codec_type: 'audio', codec_name: 'mp3' }],
    };
    const meta = normalizeAssetMetadata(audioOnly);
    expect(meta.videoCodec).toBeNull();
    expect(meta.audioCodec).toBe('mp3');
    expect(meta.width).toBeNull();
    expect(meta.fps).toBeNull();
    expect(meta.durationSeconds).toBe(180);
    expect(meta.sizeBytes).toBeNull();
  });

  it('非法值逐字段兜底为 null，不抛错', () => {
    const broken: FfprobeOutput = {
      format: { duration: 'not-a-number', bit_rate: '-5', size: '0' },
      streams: [{ codec_type: 'video', width: 0, height: -3, r_frame_rate: '0/0' }],
    };
    const meta = normalizeAssetMetadata(broken);
    expect(meta.durationSeconds).toBeNull();
    expect(meta.bitRate).toBeNull();
    expect(meta.sizeBytes).toBeNull();
    expect(meta.width).toBeNull();
    expect(meta.height).toBeNull();
    expect(meta.fps).toBeNull();
    expect(meta.videoCodec).toBeNull();
  });

  it('空探测（错误素材 / 非媒体文件）→ 全 null 形状', () => {
    expect(normalizeAssetMetadata({})).toEqual(emptyAssetMetadata());
    expect(normalizeAssetMetadata({ streams: [] })).toEqual(emptyAssetMetadata());
    expect(emptyAssetMetadata()).toEqual({
      width: null,
      height: null,
      durationSeconds: null,
      videoCodec: null,
      audioCodec: null,
      fps: null,
      bitRate: null,
      pixFmt: null,
      sizeBytes: null,
    });
  });
});
