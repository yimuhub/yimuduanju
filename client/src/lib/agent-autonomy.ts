/**
 * 一幕·神剪 · Agent 时间线执行权限
 * -------------------------------------------------------------
 * 权限只决定「客户端拿到结构化提案后要不要停下来等人点确认」，
 * 服务端仍然会做 target / 版本 / 事务校验，不会因为完全授权而跳过安全边界。
 */
export type AgentAutonomy = 'ask' | 'reduced' | 'full';

export const AGENT_AUTONOMY_KEY = 'yimu.agentAutonomy';

export const AGENT_AUTONOMY_LABEL: Record<AgentAutonomy, string> = {
  ask: '每条都询问',
  reduced: '减少询问',
  full: '完全授权',
};

export const AGENT_AUTONOMY_DESC: Record<AgentAutonomy, string> = {
  ask: '每个剪辑提案都停下来，点“应用”才落库。',
  reduced: '移动、修剪、速度、音量、字幕、锁定等低风险动作直接执行；删除/分割仍请示。',
  full: '所有合法提案直接执行；仍会经过服务端 target 与版本校验。',
};

export const readAgentAutonomy = (): AgentAutonomy => {
  try {
    const raw = localStorage.getItem(AGENT_AUTONOMY_KEY);
    if (raw === 'ask' || raw === 'reduced' || raw === 'full') return raw;
  } catch {
    /* 隐私模式忽略 */
  }
  return 'ask';
};

/** 删除 / 分割会改变片段存在性，减少询问模式下仍要求确认。 */
export const isDestructiveTimelineOp = (action: string): boolean =>
  action === 'delete' || action === 'split';
