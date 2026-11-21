/**
 * G15 人声避让混音纯函数回归测试
 * ------------------------------------------------------------------
 * 验证 planVoiceDucking 分类 / 激活判定与 buildVoiceDuckMixFilter 的
 * filter_complex 接线：人声 asplit 双路、sidechain 求和、音乐逐路压缩、
 * 最终 amix 与默认路径同参。未激活时返回 null（服务端走原命令，字节级不变）。
 */
import {
  buildVoiceDuckMixFilter,
  planVoiceDucking,
  type DuckPartInfo,
} from '../../shared/timeline-audio';

const music = (): DuckPartInfo => ({ duckUnderVoice: true, isVoice: false });
const voice = (): DuckPartInfo => ({ duckUnderVoice: false, isVoice: true });
const other = (): DuckPartInfo => ({ duckUnderVoice: false, isVoice: false });

describe('planVoiceDucking', () => {
  it('分类：显式标记的音乐优先于 isVoice', () => {
    const plan = planVoiceDucking([music(), voice(), other(), { duckUnderVoice: true, isVoice: true }]);
    expect(plan.musicIndexes).toEqual([0, 3]);
    expect(plan.voiceIndexes).toEqual([1]);
    expect(plan.otherIndexes).toEqual([2]);
  });

  it('只有同时存在音乐与人声才激活', () => {
    expect(planVoiceDucking([music(), other()]).active).toBe(false);
    expect(planVoiceDucking([voice(), voice()]).active).toBe(false);
    expect(planVoiceDucking([music(), voice(), other()]).active).toBe(true);
    expect(planVoiceDucking([]).active).toBe(false);
  });
});

describe('buildVoiceDuckMixFilter', () => {
  it('未激活返回 null（服务端必须走原有 amix 命令）', () => {
    const plan = planVoiceDucking([voice(), other()]);
    expect(buildVoiceDuckMixFilter([voice(), other()], plan)).toBeNull();
    expect(buildVoiceDuckMixFilter([], planVoiceDucking([]))).toBeNull();
  });

  it('单音乐 + 单人声：人声 asplit 双路，音乐过 sidechaincompress', () => {
    const parts = [music(), voice()];
    const plan = planVoiceDucking(parts);
    const graph = buildVoiceDuckMixFilter(parts, plan);
    expect(graph).not.toBeNull();
    expect(graph!.mapLabel).toBe('aout');
    expect(graph!.filter).toBe(
      '[1:a]asplit=2[vs1][vp1];' +
        '[0:a][vs1]sidechaincompress=threshold=0.03:ratio=8:attack=50:release=400[md0];' +
        '[md0][vp1]amix=inputs=2:duration=longest:normalize=0[aout]',
    );
  });

  it('多音乐 + 多人声：sidechain 求和后按音乐路数 split，最终 amix 每条流恰好出现一次', () => {
    const parts = [music(), voice(), other(), voice(), music()];
    const plan = planVoiceDucking(parts);
    const graph = buildVoiceDuckMixFilter(parts, plan);
    expect(graph).not.toBeNull();
    expect(graph!.filter).toBe(
      '[1:a]asplit=2[vs1][vp1];' +
        '[3:a]asplit=2[vs3][vp3];' +
        '[vs1][vs3]amix=inputs=2:duration=longest:normalize=0[vsum];' +
        '[vsum]asplit=2[sc0][sc1];' +
        '[0:a][sc0]sidechaincompress=threshold=0.03:ratio=8:attack=50:release=400[md0];' +
        '[4:a][sc1]sidechaincompress=threshold=0.03:ratio=8:attack=50:release=400[md1];' +
        '[md0][md1][vp1][vp3][2:a]amix=inputs=5:duration=longest:normalize=0[aout]',
    );
  });

  it('只有音乐没有人声时不会生成（plan.active=false 透传 null）', () => {
    const parts = [music(), music()];
    const plan = planVoiceDucking(parts);
    expect(plan.active).toBe(false);
    expect(buildVoiceDuckMixFilter(parts, plan)).toBeNull();
  });

  it('sidechain 参数可调', () => {
    const parts = [music(), voice()];
    const plan = planVoiceDucking(parts);
    const graph = buildVoiceDuckMixFilter(parts, plan, { threshold: 0.05, ratio: 6 });
    expect(graph!.filter).toContain('threshold=0.05:ratio=6:attack=50:release=400');
  });
});
