/**
 * G14 节拍检测纯函数回归测试
 * ------------------------------------------------------------------
 * 用合成信号验证 detectBeats 管线（包络 → 挑峰 → BPM 归一）：
 *   1. 匀速 click 轨（120 / 90 BPM）要检出节拍且 BPM 命中；
 *   2. 静音返回空结果而不是抛错；
 *   3. 挑峰的最小间隔约束（防八分音误检）与 BPM 折半 / 倍频归一。
 */
import {
  BEAT_SAMPLE_RATE,
  computeEnvelope,
  detectBeats,
  estimateBpm,
  pickOnsetPeaks,
} from '../../shared/beat-detect';

/** 合成匀速 click 轨：每 intervalSec 一次短促衰减音 */
function synthClickTrack(intervalSec: number, durationSec: number, amp = 20000): Int16Array {
  const sr = BEAT_SAMPLE_RATE;
  const n = Math.floor(sr * durationSec);
  const buf = new Int16Array(n);
  const clickLen = 220; // ≈10ms
  const period = Math.round(intervalSec * sr);
  for (let t = Math.floor(period / 2); t < n - clickLen; t += period) {
    for (let j = 0; j < clickLen; j += 1) {
      const env = Math.exp(-j / 60);
      const v = Math.round(amp * env * Math.sin((2 * Math.PI * 440 * j) / sr));
      buf[t + j] = Math.max(-32768, Math.min(32767, v));
    }
  }
  return buf;
}

describe('computeEnvelope', () => {
  it('按窗口计算 RMS 与正差 flux', () => {
    const samples = new Int16Array(BEAT_SAMPLE_RATE); // 1s
    samples.fill(16384); // 0.5 满幅方波
    const { rms, flux, windowSec } = computeEnvelope(samples);
    expect(rms.length).toBe(Math.floor(BEAT_SAMPLE_RATE / 1024));
    expect(rms[0]).toBeCloseTo(0.5, 2);
    expect(flux[0]).toBe(0);
    expect(flux[1]).toBeCloseTo(0, 6); // 恒定能量没有 onset
    expect(windowSec).toBeCloseTo(1024 / BEAT_SAMPLE_RATE, 8);
  });

  it('能量下降不产生 flux（只对变响起反应）', () => {
    const samples = new Int16Array(2 * 1024);
    samples.fill(16000, 0, 1024); // 前一窗响
    samples.fill(4000, 1024); // 后一窗轻
    const { flux } = computeEnvelope(samples, BEAT_SAMPLE_RATE, 1024);
    expect(flux[1]).toBe(0);
  });
});

describe('pickOnsetPeaks', () => {
  it('最短间隔内的弱峰被丢弃（防八分音误检）', () => {
    const windowSec = 1024 / BEAT_SAMPLE_RATE;
    // 6 窗间隔 < 默认 0.28s（约 6 窗）；8 窗间隔安全
    const flux = new Array(30).fill(0.01);
    flux[3] = 0.9;
    flux[6] = 0.5; // 与 3 间隔 3 窗 → 太近，且更弱 → 被丢
    flux[14] = 0.8;
    flux[25] = 0.7; // 与 14 间隔 11 窗 → 保留
    const peaks = pickOnsetPeaks(flux, windowSec);
    expect(peaks).toEqual([3 * windowSec, 14 * windowSec, 25 * windowSec].map((v) => Math.round(v * 1000) / 1000));
  });

  it('最短间隔内的强峰顶掉弱峰', () => {
    const windowSec = 1024 / BEAT_SAMPLE_RATE;
    const flux = new Array(30).fill(0.01);
    flux[3] = 0.4;
    flux[6] = 0.9; // 更强 → 顶掉 3
    flux[20] = 0.8;
    const peaks = pickOnsetPeaks(flux, windowSec);
    expect(peaks).toEqual([6 * windowSec, 20 * windowSec].map((v) => Math.round(v * 1000) / 1000));
  });

  it('全零 flux 返回空（静音）', () => {
    expect(pickOnsetPeaks(new Array(100).fill(0), 0.05)).toEqual([]);
  });
});

describe('estimateBpm', () => {
  it('间隔直方图主峰命中（120 BPM）', () => {
    const onsets = [0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0];
    expect(estimateBpm(onsets)).toBe(120);
  });

  it('快于 180 的间隔折半归一（240 → 120）', () => {
    const onsets = [0, 0.25, 0.5, 0.75, 1.0, 1.25, 1.5];
    expect(estimateBpm(onsets)).toBe(120);
  });

  it('慢于 60 的间隔倍频归一（50 → 100）', () => {
    const onsets = [0, 1.2, 2.4, 3.6, 4.8, 6.0];
    expect(estimateBpm(onsets)).toBe(100);
  });

  it('onset 太少返回 0', () => {
    expect(estimateBpm([0, 0.5, 1.0])).toBe(0);
    expect(estimateBpm([])).toBe(0);
  });
});

describe('detectBeats（完整管线，合成信号）', () => {
  it('120 BPM click 轨：节拍数接近拍数且 BPM ≈ 120', () => {
    const durationSec = 12;
    const result = detectBeats(synthClickTrack(0.5, durationSec));
    const expected = Math.floor(durationSec / 0.5) - 1;
    // 管线不应大量漏拍 / 多拍（允许 ±2 的窗口边界抖动）
    expect(Math.abs(result.beats.length - expected)).toBeLessThanOrEqual(2);
    expect(result.bpm).toBe(120);
    // 节拍升序且落在半秒网格附近
    for (let i = 1; i < result.beats.length; i += 1) {
      expect(result.beats[i]).toBeGreaterThan(result.beats[i - 1]);
    }
    for (const b of result.beats) {
      // 拍点落在半秒网格（0.25, 0.75, ...）附近；onset 以包络窗起点报告，
      // 与真实 click 相差最多一个窗（≈46ms），容差放宽到 0.06s
      const nearest = Math.round((b - 0.25) / 0.5) * 0.5 + 0.25;
      expect(Math.abs(b - nearest)).toBeLessThan(0.06);
    }
    expect(result.durationSeconds).toBeCloseTo(durationSec, 1);
  });

  it('90 BPM click 轨：BPM ≈ 90', () => {
    const result = detectBeats(synthClickTrack(2 / 3, 12));
    expect(result.bpm).toBe(90);
    expect(result.beats.length).toBeGreaterThanOrEqual(14);
  });

  it('静音返回空节拍与 bpm 0，不抛错', () => {
    const result = detectBeats(new Int16Array(BEAT_SAMPLE_RATE * 5));
    expect(result.beats).toEqual([]);
    expect(result.bpm).toBe(0);
    expect(result.durationSeconds).toBeCloseTo(5, 1);
  });
});
