/**
 * 音乐节拍检测（G14，OpenMotion 对齐）—— 纯函数管线，无 DOM / 无 IO，可单测
 * ---------------------------------------------------------------------------
 * 服务端（beat-analysis.service.ts）先用 ffmpeg 把音频解码成 22050Hz mono
 * s16le PCM，再走这条纯管线：
 *
 *   PCM 采样 → 能量包络（1024 采样窗 RMS）
 *            → onset 强度（相邻窗能量的正差，正差才算：只对「变响」起反应）
 *            → 自适应阈值峰值挑选（局部均值 + k·标准差，最小间隔防八分音误检）
 *            → BPM 估计（onset 间隔直方图，折半 / 倍频归一到 60–180）
 *
 * 时间线接入（节拍吸附 / 加拍标记）由客户端消费这里的 beats（秒，升序）。
 */

/** 解码采样率：与 beat-analysis.service.ts 的 ffmpeg 参数保持一致 */
export const BEAT_SAMPLE_RATE = 22050;
/** 能量包络窗口（采样数）：≈46ms @22050，一拍（0.5s）约 10 个窗 */
export const BEAT_WINDOW_SAMPLES = 1024;
/** 相邻 onset 最小间隔（秒）：0.28s ≈ 214 BPM，高于常见曲速上限，防误检 */
export const BEAT_MIN_INTERVAL_SEC = 0.28;
/** BPM 归一区间：慢于 60 / 快于 180 的间隔按倍频折入 */
export const BEAT_BPM_MIN = 60;
export const BEAT_BPM_MAX = 180;
/** onset 数低于该值时不估 BPM（间隔太少没有统计意义） */
export const BEAT_MIN_ONSETS_FOR_BPM = 4;

const round3 = (n: number) => Math.round(n * 1000) / 1000;

export interface EnvelopeResult {
  /** 每窗 RMS（0–1，已按 int16 满幅归一） */
  rms: number[];
  /** onset 强度：相邻窗 RMS 的正差（首窗为 0） */
  flux: number[];
  /** 单窗时长（秒） */
  windowSec: number;
}

/**
 * 能量包络 + onset 强度。samples 是 int16 原始采样值
 * （服务端用 readInt16LE 展开成 Int16Array；这里只依赖 ArrayLike，便于造测试数据）。
 */
export function computeEnvelope(
  samples: ArrayLike<number>,
  sampleRate = BEAT_SAMPLE_RATE,
  windowSamples = BEAT_WINDOW_SAMPLES,
): EnvelopeResult {
  const win = Math.max(1, Math.floor(windowSamples));
  const frames = Math.floor(samples.length / win);
  const rms: number[] = [];
  for (let f = 0; f < frames; f += 1) {
    let sumSq = 0;
    const start = f * win;
    for (let j = 0; j < win; j += 1) {
      const v = samples[start + j] / 32768;
      sumSq += v * v;
    }
    rms.push(Math.sqrt(sumSq / win));
  }
  // onset 强度：只取正差 —— 音量下降不是新拍
  const flux: number[] = new Array(frames).fill(0);
  for (let i = 1; i < frames; i += 1) {
    flux[i] = Math.max(0, rms[i] - rms[i - 1]);
  }
  return { rms, flux, windowSec: win / sampleRate };
}

export interface PeakPickOptions {
  /** 自适应阈值系数：局部均值 + k·标准差 */
  thresholdK?: number;
  /** 最小 onset 间隔（秒） */
  minIntervalSec?: number;
  /** 局部统计窗口（每侧窗数），默认 ±0.5s */
  localWindows?: number;
  /** 相对全局峰值的下限比例：滤掉底噪，低于它的窗不可能是拍点 */
  peakFloorRatio?: number;
}

export const DEFAULT_PEAK_OPTIONS: Required<PeakPickOptions> = {
  thresholdK: 1.4,
  minIntervalSec: BEAT_MIN_INTERVAL_SEC,
  localWindows: 11,
  peakFloorRatio: 0.15,
};

/**
 * 从 onset 强度序列挑拍点。返回 onset 时间（秒，升序）。
 * 规则：局部极大 + 高于「局部均值 + k·标准差」+ 高于全局峰值的 floor 比例；
 * 间隔小于 minIntervalSec 时保留能量更高的那个（后者更强则顶掉前者）。
 */
export function pickOnsetPeaks(
  flux: number[],
  windowSec: number,
  options: PeakPickOptions = {},
): number[] {
  if (flux.length < 3 || windowSec <= 0) return [];
  const { thresholdK, minIntervalSec, localWindows, peakFloorRatio } = {
    ...DEFAULT_PEAK_OPTIONS,
    ...options,
  };
  // 循环取最大值：spread 在超长音频（>6.5 万窗）会撞参数上限，不能 Math.max(...flux)
  let max = 0;
  for (let i = 0; i < flux.length; i += 1) {
    if (flux[i] > max) max = flux[i];
  }
  if (max <= 0) return [];
  const floor = max * peakFloorRatio;
  const minGapWindows = Math.max(1, Math.round(minIntervalSec / windowSec));

  /** 候选（局部极大且过双阈值），按窗下标存 */
  const candidates: number[] = [];
  for (let i = 1; i < flux.length - 1; i += 1) {
    if (flux[i] < floor) continue;
    if (flux[i] < flux[i - 1] || flux[i] < flux[i + 1]) continue;
    const lo = Math.max(0, i - localWindows);
    const hi = Math.min(flux.length, i + localWindows + 1);
    let sum = 0;
    let sumSq = 0;
    for (let j = lo; j < hi; j += 1) {
      sum += flux[j];
      sumSq += flux[j] * flux[j];
    }
    const n = hi - lo;
    const mean = sum / n;
    const std = Math.sqrt(Math.max(0, sumSq / n - mean * mean));
    if (flux[i] >= mean + thresholdK * std) candidates.push(i);
  }

  // 最小间隔约束：贪心保留更强者（新候选更强则顶掉上一个，否则丢弃）
  const kept: number[] = [];
  for (const idx of candidates) {
    const prev = kept[kept.length - 1];
    if (prev != null && idx - prev < minGapWindows) {
      if (flux[idx] > flux[prev]) kept[kept.length - 1] = idx;
      continue;
    }
    kept.push(idx);
  }
  return kept.map((i) => round3(i * windowSec));
}

export interface BpmOptions {
  /** 主峰周期附近纳入均值精修的窗口（相对主峰周期的倍率区间） */
  refineRatio?: number;
}

/**
 * BPM 估计：对相邻 onset 间隔做直方图。
 * 每个间隔折半 / 倍频归一到 [60,180] 后按 1 BPM 分桶取主桶；再用主桶的
 * 拍周期 T 精修 —— 把落在 [T·(1-r), T·(1+r)] 的归一间隔（按周期域）取均值。
 * 均值精修在「周期域」而不是「BPM 域」做：包络窗量化会让间隔在 T±1 窗之间
 * 抖动（对应 BPM 一边偏高一边偏低），按周期平均才能抵消量化误差。
 * r 默认 0.25：足够覆盖 ±1 窗抖动，又能排除附点（1.5T）与半拍（0.5T）间隔。
 * 返回 0 表示 onset 太少 / 无法估计。
 */
export function estimateBpm(onsets: number[], options: BpmOptions = {}): number {
  const { refineRatio = 0.25 } = options;
  if (onsets.length < BEAT_MIN_ONSETS_FOR_BPM) return 0;
  const foldToRange = (bpm: number): number => {
    let v = bpm;
    while (v > BEAT_BPM_MAX) v /= 2;
    while (v < BEAT_BPM_MIN) v *= 2;
    return v;
  };
  const folded: number[] = [];
  for (let i = 1; i < onsets.length; i += 1) {
    const gap = onsets[i] - onsets[i - 1];
    if (gap <= 0) continue;
    folded.push(foldToRange(60 / gap));
  }
  if (folded.length === 0) return 0;
  const bins = new Map<number, number>();
  for (const bpm of folded) {
    const key = Math.round(bpm);
    bins.set(key, (bins.get(key) ?? 0) + 1);
  }
  let modeBpm = 0;
  let modeCount = 0;
  for (const [bpm, count] of bins) {
    if (count > modeCount || (count === modeCount && bpm < modeBpm)) {
      modeBpm = bpm;
      modeCount = count;
    }
  }
  const modePeriod = 60 / modeBpm;
  let periodSum = 0;
  let count = 0;
  for (const bpm of folded) {
    const period = 60 / bpm;
    if (period >= modePeriod * (1 - refineRatio) && period <= modePeriod * (1 + refineRatio)) {
      periodSum += period;
      count += 1;
    }
  }
  return count > 0 ? Math.round(60 / (periodSum / count)) : modeBpm;
}

export interface BeatDetectionResult {
  /** 节拍时间点（秒，升序） */
  beats: number[];
  /** 估计 BPM；0 = 未能估计 */
  bpm: number;
  /** 音频时长（秒） */
  durationSeconds: number;
}

/**
 * 完整管线：int16 采样 → 包络 → 挑峰 → BPM。
 * 全静音（rms 全 0）返回空 beats 与 bpm 0，不视为错误。
 */
export function detectBeats(
  samples: ArrayLike<number>,
  sampleRate = BEAT_SAMPLE_RATE,
): BeatDetectionResult {
  const { flux, windowSec } = computeEnvelope(samples, sampleRate);
  const beats = pickOnsetPeaks(flux, windowSec);
  const bpm = estimateBpm(beats);
  return {
    beats,
    bpm,
    durationSeconds: round3(samples.length / sampleRate),
  };
}
