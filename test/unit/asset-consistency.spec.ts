import {
  evaluateAssetReadiness,
  evaluateCharacterAsset,
  evaluateLocationAsset,
  evaluatePropAsset,
  shotAssetGate,
  canEnterStage,
  PIPELINE_STAGE_ORDER,
} from '@shared/asset-readiness';
import {
  buildShotPrompt,
  composeShotReferences,
  referenceLabel,
  renderShotMentions,
  SHOT_REF_MAX,
} from '@shared/shot-context';

/**
 * 一致性链路单测：资产就绪度 + 参考图编号。
 *
 * 这两处是「跨镜换脸 / 场景漂移」的直接成因，改了口径此处必红：
 * - 空资产集合必须判为未就绪（旧实现 `every()` 对空数组返回 true，
 *   于是「一个人物都没有」也能通过校验直接出片）；
 * - 参考图编号必须是真实位置「图N」，且声明行与数组等长同序。
 */
describe('asset-readiness', () => {
  test('空集合判为未就绪（零人物不许出片）', () => {
    const summary = evaluateAssetReadiness([]);
    expect(summary.ready).toBe(false);
    expect(summary.total).toBe(0);
    expect(summary.summary).toContain('尚无任何一致性资产');
  });

  test('人物：有一张能用的脸即可通过硬门，四视角缺失只降级为不完整', () => {
    const partial = evaluateCharacterAsset({
      id: 'c1',
      name: '林晚',
      portraitUrl: '/uploads/p.png',
      views: { threeQuarter: '/uploads/v.png' },
    });
    expect(partial.ready).toBe(true);
    expect(partial.complete).toBe(false);
    expect(partial.missing).toContain('正面全身图');

    const complete = evaluateCharacterAsset({
      id: 'c1',
      name: '林晚',
      portraitUrl: '/p.png',
      views: { front: '/1.png', threeQuarter: '/2.png', side: '/3.png', back: '/4.png' },
    });
    expect(complete.complete).toBe(true);
    expect(complete.missing).toHaveLength(0);
  });

  test('人物：只有旧四视图拼图也不算完整（拼图不能冒充四张独立视角）', () => {
    const legacy = evaluateCharacterAsset({ id: 'c1', name: '林晚', sheetUrl: '/sheet.png' });
    expect(legacy.ready).toBe(true);
    expect(legacy.complete).toBe(false);
  });

  test('场景缺图阻塞，道具缺图默认不阻塞', () => {
    const summary = evaluateAssetReadiness([
      evaluateCharacterAsset({ id: 'c1', name: '林晚', portraitUrl: '/p.png' }),
      evaluateLocationAsset({ id: 'l1', name: '旧书店', referenceImageUrls: [] }),
      evaluatePropAsset({ id: 'p1', name: '怀表', referenceImageUrls: [] }),
    ]);
    expect(summary.ready).toBe(false);
    expect(summary.blockers.map((b) => b.kind)).toEqual(['location']);
    expect(summary.warnings.map((w) => w.kind)).toEqual(['prop']);
  });

  test('关键剧情道具（blocking=true）参与硬门', () => {
    const summary = evaluateAssetReadiness([
      evaluateCharacterAsset({ id: 'c1', name: '林晚', portraitUrl: '/p.png' }),
      evaluatePropAsset(
        { id: 'p1', name: '怀表', category: 'key', referenceImageUrls: [] },
        { blocking: true },
      ),
    ]);
    expect(summary.ready).toBe(false);
    expect(summary.blockingCount).toBe(1);
  });

  test('单镜放行：缺场景图即拦，缺道具图不拦', () => {
    const items = [
      evaluateCharacterAsset({ id: 'c1', name: '林晚', portraitUrl: '/p.png' }),
      evaluateLocationAsset({ id: 'l1', name: '旧书店', referenceImageUrls: [] }),
    ];
    expect(shotAssetGate(['c1'], 'l1', items).ok).toBe(false);
    expect(shotAssetGate(['c1'], null, items).ok).toBe(true);
  });

  test('阶段不得跳级：未完成资产不许进分镜', () => {
    expect(canEnterStage('storyboard', ['script', 'assets'])).toBe(true);
    expect(canEnterStage('storyboard', ['script'])).toBe(false);
    expect(PIPELINE_STAGE_ORDER.indexOf('assets')).toBeLessThan(
      PIPELINE_STAGE_ORDER.indexOf('storyboard'),
    );
  });
});

describe('shot-context 参考图编排', () => {
  test('编号即位置，从图1 起', () => {
    expect(referenceLabel(0)).toBe('图1');
    expect(referenceLabel(7)).toBe('图8');
  });

  test('排序：角色主图→角度图→场景→道具→上一镜', () => {
    const r = composeShotReferences({
      characters: [{ id: 'c1', name: '林晚', primaryUrl: '/p.png', viewUrls: ['/v1.png'] }],
      scene: { id: 'l1', name: '旧书店', url: '/s.png' },
      props: [{ id: 'p1', code: 'PROP001', name: '怀表', url: '/pr.png' }],
      previousShot: { shotNumber: 3, url: '/prev.png' },
    });
    expect(r.refs.map((x) => x.url)).toEqual(['/p.png', '/v1.png', '/s.png', '/pr.png', '/prev.png']);
    expect(r.refs.map((x) => x.label)).toEqual(['图1', '图2', '图3', '图4', '图5']);
    expect(r.refs.map((x) => x.kind)).toEqual([
      'character',
      'character',
      'location',
      'prop',
      'previous_shot',
    ]);
  });

  test('同一张图只进一次，重复不导致图号错位', () => {
    const r = composeShotReferences({
      characters: [{ id: 'c1', name: '林晚', primaryUrl: '/same.png', viewUrls: ['/same.png'] }],
      scene: { id: 'l1', name: '旧书店', url: '/same.png' },
    });
    expect(r.refs).toHaveLength(1);
  });

  test('声明行与参考图等长同序，同一人共用图号', () => {
    const r = composeShotReferences({
      characters: [{ id: 'c1', name: '林晚', primaryUrl: '/p.png', viewUrls: ['/v1.png'] }],
      scene: { id: 'l1', name: '旧书店', url: '/s.png' },
      previousShot: { shotNumber: 2, url: '/prev.png' },
    });
    expect(r.declaration).toContain('图1、图2为角色「林晚」的参考图');
    expect(r.declaration).toContain('图3为场景「旧书店」的参考图');
    expect(r.declaration).toContain('图4为上一分镜图，只参考构图与色调');
    for (const ref of r.refs) expect(r.declaration).toContain(ref.label);
  });

  test('超出上限去尾，并报告丢弃数量', () => {
    const props = Array.from({ length: SHOT_REF_MAX + 3 }, (_, i) => ({
      id: `p${i}`,
      name: `道具${i}`,
      url: `/pr${i}.png`,
    }));
    const r = composeShotReferences({ props });
    expect(r.refs).toHaveLength(SHOT_REF_MAX);
    expect(r.dropped).toBe(3);
  });

  test('@名称 机械替换为 @图N，对不上的原样保留', () => {
    const r = composeShotReferences({
      characters: [{ id: 'c1', name: '林晚', primaryUrl: '/p.png' }],
      props: [{ id: 'p1', code: 'PROP001', name: '怀表', url: '/pr.png' }],
    });
    expect(renderShotMentions('@林晚 把 @PROP001 收好，@路人甲 走过', r.refs)).toBe(
      '@图1 把 @图2 收好，@路人甲 走过',
    );
  });

  test('提示词分「不可变上下文 / 可变画面」两段，且不再出现字面量 [图N]', () => {
    const r = composeShotReferences({
      characters: [
        { id: 'c1', name: '林晚', primaryUrl: '/p.png', lock: '深蓝旗袍；左手银戒' },
      ],
      scene: { id: 'l1', name: '旧书店', url: '/s.png', lock: '木质书架；暖黄台灯' },
    });
    const prompt = buildShotPrompt('@林晚 抬头看向门口', r);
    expect(prompt).toContain('【一致性上下文 · 不可变】');
    expect(prompt).toContain('【本镜画面 · 可变】');
    expect(prompt).toContain('图1 角色「林晚」 —— 深蓝旗袍；左手银戒');
    expect(prompt).toContain('@图1 抬头看向门口');
    expect(prompt).not.toContain('[图N]');
  });

  test('没有任何资产时不编造上下文块', () => {
    const r = composeShotReferences({});
    expect(r.refs).toHaveLength(0);
    expect(r.declaration).toBe('');
    expect(buildShotPrompt('纯文本', r)).toBe('纯文本');
  });
});
