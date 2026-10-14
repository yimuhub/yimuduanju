import {
  ruleDeadTime,
  ruleDialogueOverflow,
  ruleLocalWhitemodel,
  ruleLongLines,
  ruleNoFirstFrame,
  ruleSubtitleDrift,
  ruleUnknownMovement,
  ruleWhitemodelMismatch,
} from '@shared/qc-rules';

/**
 * F8 关键链路单测：质检统一规则（与 preflight 同源，改阈值此处必红）。
 */
describe('qc-rules', () => {
  test('对白超长判 error', () => {
    const hit = ruleDialogueOverflow({
      id: 's1',
      shotNumber: 1,
      duration: 4,
      dialogue: '这是一段很长很长很长很长很长的对白一定念不完',
    });
    expect(hit?.level).toBe('error');
    expect(hit?.code).toBe('dialogue_overflow');
  });

  test('对白刚好不判', () => {
    expect(
      ruleDialogueOverflow({
        id: 's1',
        shotNumber: 1,
        duration: 10,
        dialogue: '你好',
      }),
    ).toBeNull();
  });

  test('死时间判 warning（含广告 5s 阈值由调用方传入）', () => {
    const hit = ruleDeadTime(
      { id: 's1', shotNumber: 2, duration: 10, movement: 'static' },
      8,
    );
    expect(hit?.code).toBe('dead_time');
    expect(
      ruleDeadTime(
        { id: 's1', shotNumber: 2, duration: 4, movement: 'static' },
        8,
      ),
    ).toBeNull();
  });

  test('白模时长/运镜失配判两个 error', () => {
    const hits = ruleWhitemodelMismatch({
      id: 's1',
      shotNumber: 1,
      duration: 4,
      movement: 'dolly',
      whitemodelUrl: 'https://x/wm.mp4',
      whitemodelMeta: { durationSeconds: 8, movement: 'orbit' },
    });
    expect(hits.map((h) => h.code).sort()).toEqual([
      'whitemodel_duration',
      'whitemodel_movement',
    ]);
    expect(hits.every((h) => h.level === 'error')).toBe(true);
  });

  test('无白模不判失配', () => {
    expect(
      ruleWhitemodelMismatch({ id: 's1', shotNumber: 1, duration: 4 }),
    ).toEqual([]);
  });

  test('未知运镜判 warning，预设内不判', () => {
    expect(
      ruleUnknownMovement({ id: 's1', shotNumber: 1, movement: 'xxx_fly' })
        ?.code,
    ).toBe('unknown_movement');
    expect(
      ruleUnknownMovement({ id: 's1', shotNumber: 1, movement: 'dolly' }),
    ).toBeNull();
    expect(
      ruleUnknownMovement({ id: 's1', shotNumber: 1, movement: 'push_in' }),
    ).toBeNull();
  });

  test('无首帧判 warning，有链继承换文案', () => {
    expect(ruleNoFirstFrame({ id: 's1', shotNumber: 1 }, false)?.code).toBe(
      'no_first_frame',
    );
    expect(ruleNoFirstFrame({ id: 's1', shotNumber: 1 }, true)?.code).toBe(
      'chained_first_frame',
    );
    expect(
      ruleNoFirstFrame(
        { id: 's1', shotNumber: 1, startFrameUrl: 'https://x.png' },
        false,
      ),
    ).toBeNull();
  });

  test('本地白模判 warning，公网不判', () => {
    expect(
      ruleLocalWhitemodel({
        id: 's1',
        shotNumber: 1,
        whitemodelUrl: '/uploads/a.webm',
      })?.code,
    ).toBe('local_whitemodel');
    expect(
      ruleLocalWhitemodel({
        id: 's1',
        shotNumber: 1,
        whitemodelUrl: 'https://x/wm.mp4',
      }),
    ).toBeNull();
  });

  test('字幕偏离判 warning，一致不判', () => {
    expect(
      ruleSubtitleDrift({
        id: 's1',
        shotNumber: 1,
        dialogue: '你好',
        subtitleText: '完全无关的另一句',
      })?.code,
    ).toBe('subtitle_drift');
    expect(
      ruleSubtitleDrift({
        id: 's1',
        shotNumber: 1,
        dialogue: '你好世界',
        subtitleText: '你好世界',
      }),
    ).toBeNull();
  });

  test('超 20 字行判 warning', () => {
    expect(
      ruleLongLines({
        id: 's1',
        shotNumber: 1,
        dialogue: '这是一句非常非常非常非常非常非常长的对白一定超过二十个字',
      })?.code,
    ).toBe('long_lines');
    expect(
      ruleLongLines({ id: 's1', shotNumber: 1, dialogue: '你好' }),
    ).toBeNull();
  });
});

describe('V4 pure reference mode', () => {
  test('已绑白模不再报无首帧', async () => {
    const mod = await import('@shared/qc-rules');
    expect(
      mod.ruleNoFirstFrame({ id: 's1', shotNumber: 1, whitemodelUrl: 'https://x/wm.mp4' }, false),
    ).toBeNull();
  });
});
