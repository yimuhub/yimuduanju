/**
 * 对话确认卡解析单测（migration 0025，对标 zenstory pendingEdits）
 * 覆盖：围栏提取、单对象/数组/actions 包装三种载荷、白名单收敛、非法块原样保留。
 */
import {
  AGENT_ACTION_FENCE,
  parseAgentActions,
  sanitizeShotPatch,
} from '../../client/src/lib/agent-actions';

describe('sanitizeShotPatch', () => {
  it('只保留白名单字段，拒绝产物字段越权写入', () => {
    const patch = sanitizeShotPatch({
      visualPrompt: '新提示词',
      dialogue: '台词',
      duration: 5,
      startFrameUrl: 'https://evil.example/x.png',
      videoUrl: '/uploads/x.mp4',
      locked: false,
      id: 'whatever',
    });
    expect(patch).toEqual({ visualPrompt: '新提示词', dialogue: '台词', duration: 5 });
  });

  it('非对象/非法值返回空对象或跳过', () => {
    expect(sanitizeShotPatch(null)).toEqual({});
    expect(sanitizeShotPatch('x')).toEqual({});
    expect(sanitizeShotPatch({ visualPrompt: 123 })).toEqual({});
    expect(sanitizeShotPatch({ duration: Number.NaN })).toEqual({});
  });
});

describe('parseAgentActions', () => {
  const shotAction = {
    action: 'update_shot',
    targetId: '11111111-1111-1111-1111-111111111111',
    summary: '改第3镜提示词',
    patch: { visualPrompt: '新提示词', negativePrompt: '避免字幕' },
  };

  it('无协议块时正文原样、actions 为空', () => {
    const r = parseAgentActions('普通回复文本');
    expect(r.text).toBe('普通回复文本');
    expect(r.actions).toEqual([]);
  });

  it('解析单个 update_shot 对象并从正文移除围栏块', () => {
    const content = `建议修改如下。\n\n\`\`\`${AGENT_ACTION_FENCE}\n${JSON.stringify(shotAction)}\n\`\`\`\n以上。`;
    const r = parseAgentActions(content);
    expect(r.actions).toHaveLength(1);
    expect(r.actions[0]).toMatchObject({ action: 'update_shot', targetId: shotAction.targetId });
    expect(r.text).toBe('建议修改如下。\n\n以上。');
  });

  it('解析 { actions: [...] } 包装与数组载荷（保序）', () => {
    const wrapped = { actions: [shotAction, { action: 'update_script', script: '新剧本' }] };
    const r = parseAgentActions(`\`\`\`${AGENT_ACTION_FENCE}\n${JSON.stringify(wrapped)}\n\`\`\``);
    expect(r.actions).toHaveLength(2);
    expect(r.actions[0].action).toBe('update_shot');
    expect(r.actions[1]).toMatchObject({ action: 'update_script', script: '新剧本' });
  });

  it('缺少 targetId 或 patch 为空的 update_shot 被丢弃', () => {
    const r = parseAgentActions(
      `\`\`\`${AGENT_ACTION_FENCE}\n${JSON.stringify({ actions: [{ action: 'update_shot', patch: { visualPrompt: 'x' } }, shotAction] })}\n\`\`\``,
    );
    expect(r.actions).toHaveLength(1);
    expect(r.actions[0].targetId).toBe(shotAction.targetId);
  });

  it('非法 JSON 围栏块原样保留在正文（不吞内容）', () => {
    const block = `\`\`\`${AGENT_ACTION_FENCE}\n{oops not json}\n\`\`\``;
    const r = parseAgentActions(`前文${block}后文`);
    expect(r.actions).toEqual([]);
    expect(r.text).toContain(block);
  });

  it('update_script 缺 script 被丢弃；script 超长截断', () => {
    const long = 'x'.repeat(120000);
    const r = parseAgentActions(
      `\`\`\`${AGENT_ACTION_FENCE}\n${JSON.stringify({ actions: [{ action: 'update_script' }, { action: 'update_script', script: long }] })}\n\`\`\``,
    );
    expect(r.actions).toHaveLength(1);
    expect(r.actions[0].script!.length).toBe(100000);
  });
});
