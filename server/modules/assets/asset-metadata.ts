/**
 * 素材媒体元数据（G16）—— ffprobe 输出归一化纯函数，可单测
 * ---------------------------------------------------------------------------
 * GET /api/assets/:id/metadata 的探测结果在这里做「ffprobe JSON → 契约形状」
 * 的纯转换：缺什么字段就给 null（错误素材 / 非媒体文件返回 200 + 全 null，
 * 前端兜底友好），fps 从 r_frame_rate 分数字符串解析。
 */

import type { AssetMetadata } from '@shared/api.interface';

/** ffprobe -show_format 的 JSON 形状（只取用到的字段，其余忽略） */
export interface FfprobeFormatSection {
  duration?: string;
  bit_rate?: string;
  size?: string;
  format_name?: string;
}

/** ffprobe -show_streams 的 JSON 形状 */
export interface FfprobeStreamSection {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  pix_fmt?: string;
  /** 帧率分数，如 "30000/1001"；也可能是整数形式 "25" */
  r_frame_rate?: string;
}

export interface FfprobeOutput {
  format?: FfprobeFormatSection;
  streams?: FfprobeStreamSection[];
}

/**
 * 解析 r_frame_rate 分数（"30000/1001" → 29.97；"25" → 25）。
 * 分母为 0（ffprobe 对图片流常给 0/0 占位）或非法 → null。保留 3 位小数。
 */
export function parseFpsFraction(raw: string | undefined | null): number | null {
  if (!raw) return null;
  const m = /^\s*(\d+)\s*\/\s*(\d+)\s*$/.exec(raw) ?? /^\s*(\d+)\s*$/.exec(raw);
  if (!m) return null;
  const num = Number(m[1]);
  const den = m[2] != null ? Number(m[2]) : 1;
  if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0 || num === 0) return null;
  const fps = num / den;
  return fps > 0 && Number.isFinite(fps) ? Math.round(fps * 1000) / 1000 : null;
}

const toFiniteNumber = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const toPositiveNumber = (v: unknown): number | null => {
  const n = toFiniteNumber(v);
  return n != null && n > 0 ? n : null;
};

const toNonEmptyString = (v: unknown): string | null => {
  const s = typeof v === 'string' ? v.trim() : '';
  return s ? s : null;
};

/** 全 null 兜底：探测失败 / 非媒体文件时返回 200 + 这份形状 */
export function emptyAssetMetadata(): AssetMetadata {
  return {
    width: null,
    height: null,
    durationSeconds: null,
    videoCodec: null,
    audioCodec: null,
    fps: null,
    bitRate: null,
    pixFmt: null,
    sizeBytes: null,
  };
}

/**
 * ffprobe JSON → AssetMetadata 契约。规则：
 *   · 宽高 / 编码 / pix_fmt 取第一条视频流；audioCodec 取第一条音频流；
 *   · duration / bitRate / size 取 format 段（size 优先 format.size，缺省 null）；
 *   · 任何字段缺失或非法都是 null，不抛错。
 */
export function normalizeAssetMetadata(probe: FfprobeOutput): AssetMetadata {
  const out = emptyAssetMetadata();
  const streams = Array.isArray(probe.streams) ? probe.streams : [];
  const video = streams.find((s) => s.codec_type === 'video');
  const audio = streams.find((s) => s.codec_type === 'audio');
  if (video) {
    out.width = toPositiveNumber(video.width);
    out.height = toPositiveNumber(video.height);
    out.videoCodec = toNonEmptyString(video.codec_name);
    out.pixFmt = toNonEmptyString(video.pix_fmt);
    out.fps = parseFpsFraction(video.r_frame_rate);
  }
  if (audio) {
    out.audioCodec = toNonEmptyString(audio.codec_name);
  }
  const fmt = probe.format ?? {};
  out.durationSeconds = toPositiveNumber(fmt.duration);
  out.bitRate = toPositiveNumber(fmt.bit_rate);
  out.sizeBytes = toPositiveNumber(fmt.size);
  return out;
}
