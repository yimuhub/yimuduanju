import {
  parseTimelineOpsProposal,
  stripAgentBlocks,
  summarizeOps,
} from '../../client/src/lib/timeline-agent-ops';

const fence = (body: unknown) =>
  '先说一句。\n```yimu-timeline\n' + JSON.stringify(body) + '\n```';

describe('parseTimelineOpsProposal', () => {
  it('解析合法提案并保留 summary / baseVersion', () => {
    const p = parseTimelineOpsProposal(
      fence({
        baseVersion: 7,
        summary: '把第二镜剪短 0.5s',
        ops: [{ op: 'trim', target: { clientKey: 'derived-v-s1' }, edge: 'right', deltaSec: -0.5 }],
      }),
    );
    expect(p?.baseVersion).toBe(7);
    expect(p?.summary).toContain('剪短');
    expect(p?.ops).toHaveLength(1);
  });

  it('取最后一个合法围栏（模型可能先给示例再给正式）', () => {
    const text =
      fence({ baseVersion: 1, ops: [{ op: 'delete', targets: [{ clientKey: 'a' }] }] }) +
      '\n修正如下：\n' +
      fence({ baseVersion: 2, ops: [{ op: 'delete', targets: [{ clientKey: 'b' }] }] });
    expect(parseTimelineOpsProposal(text)?.baseVersion).toBe(2);
  });

  it('混入未知 op 时整块拒绝（避免半套动作落库）', () => {
    const p = parseTimelineOpsProposal(
      fence({
        baseVersion: 1,
        ops: [
          { op: 'trim', target: { clientKey: 'a' }, edge: 'right', deltaSec: -1 },
          { op: 'explode', target: { clientKey: 'a' } },
        ],
      }),
    );
    expect(p).toBeNull();
  });

  it('缺 baseVersion / 空 ops 视为无效', () => {
    expect(parseTimelineOpsProposal(fence({ ops: [{ op: 'delete', targets: [] }] }))).toBeNull();
    expect(parseTimelineOpsProposal(fence({ baseVersion: 3, ops: [] }))).toBeNull();
    expect(parseTimelineOpsProposal('没有代码块')).toBeNull();
  });
});

describe('stripAgentBlocks', () => {
  it('剔除动作围栏与旧确认卡围栏，只留自然语言', () => {
    const text =
      '好的，我把第 3 镜删掉。\n```yimu-timeline\n{"baseVersion":1,"ops":[]}\n```\n' +
      '```yimu-action\n{"type":"deleteShot"}\n```\n完成。';
    const out = stripAgentBlocks(text);
    expect(out).not.toContain('yimu-timeline');
    expect(out).not.toContain('yimu-action');
    expect(out).toContain('我把第 3 镜删掉');
    expect(out).toContain('完成');
  });
});

describe('summarizeOps', () => {
  it('按动作类型计数，便于卡片标题一句话说明', () => {
    const s = summarizeOps([
      { op: 'trim', target: { clientKey: 'a' }, edge: 'right', deltaSec: -1 },
      { op: 'trim', target: { clientKey: 'b' }, edge: 'right', deltaSec: -1 },
      { op: 'delete', targets: [{ clientKey: 'c' }] },
    ]);
    expect(s).toContain('修剪');
    expect(s).toContain('2');
    expect(s).toContain('删除');
  });
});
