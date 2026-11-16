/**
 * 音频角色（波形分色）回归测试
 * ------------------------------------------------------------------
 * 「人声 / 配乐 / 音效」三个角色的判据只有一个来源：lane。
 * 这样数据里不会出现「说自己是配乐却躺在对白轨」的矛盾状态，
 * 换角色＝把片段挪到那条轨，配色跟着轨道走。
 *
 * 钉住三条：
 *   1. 只有音频片段有角色，画面/字幕/叠加一律 null（不要给它们上色）；
 *   2. lane 0 人声、1 配乐、≥2 音效（超出的扩展音轨按音效处理）；
 *   3. 角色 → lane 的映射必须与上面互逆，否则「换角色」会把片段送错轨。
 */
import { AUDIO_ROLE_LABEL, AUDIO_ROLE_LANE, audioRoleOf } from '../../client/src/components/studio/model';

describe('audioRoleOf', () => {
  it('lane 0 是对白轨 → 人声', () => {
    expect(audioRoleOf({ track: 'audio', lane: 0 })).toBe('voice');
  });

  it('lane 1 是配乐轨 → 配乐', () => {
    expect(audioRoleOf({ track: 'audio', lane: 1 })).toBe('music');
  });

  it('lane 2 是音效轨 → 音效', () => {
    expect(audioRoleOf({ track: 'audio', lane: 2 })).toBe('sfx');
  });

  it('拖出来的扩展音轨（lane ≥ 3）按音效色', () => {
    expect(audioRoleOf({ track: 'audio', lane: 5 })).toBe('sfx');
  });

  it('lane 缺省按 0 处理（老数据没有 lane 字段）', () => {
    expect(audioRoleOf({ track: 'audio', lane: undefined as unknown as number })).toBe('voice');
  });

  it('非音频片段没有角色（不给画面/字幕染色）', () => {
    expect(audioRoleOf({ track: 'video', lane: 0 })).toBeNull();
    expect(audioRoleOf({ track: 'subtitle', lane: 0 })).toBeNull();
    expect(audioRoleOf({ track: 'overlay', lane: 0 })).toBeNull();
  });
});

describe('角色 ↔ 轨道 映射自洽', () => {
  it('AUDIO_ROLE_LANE 的每个角色，反查回来还是自己', () => {
    (Object.keys(AUDIO_ROLE_LANE) as (keyof typeof AUDIO_ROLE_LANE)[]).forEach((role) => {
      expect(audioRoleOf({ track: 'audio', lane: AUDIO_ROLE_LANE[role] })).toBe(role);
    });
  });

  it('三个角色都有中文标签，且互不相同', () => {
    const labels = Object.values(AUDIO_ROLE_LABEL);
    expect(labels).toEqual(['人声', '配乐', '音效']);
    expect(new Set(labels).size).toBe(3);
  });
});
