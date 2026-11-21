/**
 * W6 节拍吸附纯函数单测
 * ------------------------------------------------------------------
 * 覆盖 timeline-beats 的两块纯逻辑：
 *   · mapBeatsToClip：源媒体节拍 → 时间线坐标（入点偏移 + 变速），
 *     片段范围外的节拍裁掉；
 *   · activeBeatTimes：当前吸附用哪一组节拍——时间线上第一个命中
 *     已分析素材的音频片段，拖动中的片段自身旧节拍不参与。
 * 这两条一旦回归，表现就是「吸附到错误的拍子 / 拖音乐时被自己的旧位置拽住」。
 */
import {
  activeBeatTimes,
  mapBeatsToClip,
  type BeatSourceClip,
} from '../../client/src/lib/timeline-beats';

const clip = (over: Partial<BeatSourceClip> = {}): BeatSourceClip => ({
  id: 'a1',
  track: 'audio',
  sourceAssetId: 'asset-1',
  inPoint: 0,
  outPoint: 10,
  speed: 1,
  timelineStart: 0,
  ...over,
});

describe('mapBeatsToClip', () => {
  it('speed=1：timelineStart - inPoint + beat，片段内的节拍全部保留', () => {
    expect(mapBeatsToClip(clip({ timelineStart: 4, inPoint: 2 }), [2, 2.5, 3]))
      .toEqual([4, 4.5, 5]);
  });

  it('片段范围外的节拍裁掉：只取 [timelineStart, timelineStart+span]', () => {
    // 片段占时间线 2–7s，源节拍 0–6.5s（in=1,out=6 → span 5s）
    const c = clip({ timelineStart: 2, inPoint: 1, outPoint: 6 });
    expect(mapBeatsToClip(c, [0.5, 1, 2, 5.9, 6.5]))
      .toEqual([2, 3, 6.9]);
  });

  it('变速 2×：时间线位置按 (beat - inPoint) / speed 收缩', () => {
    const c = clip({ inPoint: 0, outPoint: 10, speed: 2 });
    expect(mapBeatsToClip(c, [0, 1, 2, 9])).toEqual([0, 0.5, 1, 4.5]);
  });

  it('非法 speed（0/负数）按 1 处理，与 clipSpan 同语义', () => {
    const c = clip({ speed: 0, inPoint: 1, outPoint: 5 });
    expect(mapBeatsToClip(c, [1, 3])).toEqual([0, 2]);
  });

  it('结果按毫秒取整，避免浮点漂移进吸附比较', () => {
    const c = clip({ inPoint: 0, outPoint: 4, speed: 3 });
    expect(mapBeatsToClip(c, [1 / 3, 2 / 3])).toEqual([0.111, 0.222]);
  });
});

describe('activeBeatTimes', () => {
  const byAsset = new Map([
    ['music', { beats: [0, 0.5, 1], bpm: 120 }],
    ['voice', { beats: [0, 2], bpm: 90 }],
  ]);

  it('取时间线上第一个命中已分析素材的音频片段（按 timelineStart，不看数组顺序）', () => {
    const clips = [
      clip({ id: 'v1', track: 'video', sourceAssetId: 'music' }), // 画面片段不参与
      clip({ id: 'a2', sourceAssetId: 'music', timelineStart: 8 }), // 后放的配乐
      clip({ id: 'a1', sourceAssetId: 'voice', timelineStart: 0 }), // 最先出现的音频
    ];
    expect(activeBeatTimes(clips, byAsset)).toEqual([0, 2]);
  });

  it('没有已分析素材的音频片段时返回空数组', () => {
    expect(activeBeatTimes([clip({ sourceAssetId: 'none' })], byAsset)).toEqual([]);
    expect(activeBeatTimes([clip()], new Map())).toEqual([]);
  });

  it('excludeId（拖动中的片段）被跳过：不吸到自己旧位置的节拍', () => {
    const clips = [clip({ id: 'a1', sourceAssetId: 'music', timelineStart: 8 })];
    expect(activeBeatTimes(clips, byAsset, 'a1')).toEqual([]);
    // 同素材的另一个片段还在时，仍用它的位置出节拍
    const pair = [clips[0], clip({ id: 'a2', sourceAssetId: 'music', timelineStart: 0 })];
    expect(activeBeatTimes(pair, byAsset, 'a1')).toEqual([0, 0.5, 1]);
  });

  it('没有 sourceAssetId 的片段不参与', () => {
    expect(activeBeatTimes([clip({ sourceAssetId: null })], byAsset)).toEqual([]);
  });
});
