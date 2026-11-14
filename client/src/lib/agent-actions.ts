/**
 * 对话确认卡解析（对标 zenstory pendingEdits：AI 修改 = 待审批 diff）
 * ---------------------------------------------------------------------------
 * 后端 agents.sendMessage / assistant 的 system prompt 要求：当 Agent 建议
 * 修改项目数据（改分镜提示词 / 改剧本等）时，在回复末尾用 ```yimu-action 围栏
 * 输出结构化 JSON；前端在这里解析成待审批卡片，用户点「应用」才调真实 API。
 *
 * 本文件必须保持纯函数（零 @client 依赖），供 jest 单测直接覆盖。
 */
import type { AgentActionProposal } from '@shared/api.interface';

/** 协议围栏语言标记 */
export const AGENT_ACTION_FENCE = 'yimu-action';

export interface ParsedAgentReply {
  /** 去掉协议块后给用户看的正文 */
  text: string;
  /** 解析出的待审批变更（保序） */
  actions: AgentActionProposal[];
}

const UPDATE_SHOT_FIELDS = [
  'subject',
  'action',
  'emotion',
  'dialogue',
  'visualPrompt',
  'negativePrompt',
  'subtitleText',
  'shotSize',
  'cameraAngle',
  'lens',
  'movement',
  'duration',
] as const;

/** 补丁里唯一合法的数值字段（其余字段必须是字符串，防止类型注入） */
const NUMERIC_PATCH_FIELDS: readonly string[] = ['duration'];

/** 白名单收敛 shot 补丁：防止协议块夹带 startFrameUrl/videoUrl 等产物字段越权写入 */
export function sanitizeShotPatch(raw: unknown): Record<string, string | number> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!(UPDATE_SHOT_FIELDS as readonly string[]).includes(k)) continue;
    if (typeof v === 'string') out[k] = v.slice(0, 4000);
    else if (NUMERIC_PATCH_FIELDS.includes(k) && typeof v === 'number' && Number.isFinite(v)) out[k] = v;
  }
  return out;
}

function toProposal(raw: unknown): AgentActionProposal | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Record<string, unknown>;
  if (o.action === 'update_shot') {
    const patch = sanitizeShotPatch(o.patch);
    if (!o.targetId || Object.keys(patch).length === 0) return null;
    return {
      action: 'update_shot',
      targetId: String(o.targetId),
      summary: typeof o.summary === 'string' ? o.summary.slice(0, 200) : undefined,
      patch,
    };
  }
  if (o.action === 'update_script') {
    const script = typeof o.script === 'string' ? o.script.slice(0, 100_000) : '';
    if (!script.trim()) return null;
    return {
      action: 'update_script',
      summary: typeof o.summary === 'string' ? o.summary.slice(0, 200) : undefined,
      script,
    };
  }
  return null;
}

/**
 * 解析 Agent 回复：提取全部 ```yimu-action 围栏块并从正文移除。
 * 支持三种载荷：单个对象 / { "actions": [...] } / 数组。解析失败的块原样保留在正文，
 * 不吞内容。
 */
export function parseAgentActions(content: string): ParsedAgentReply {
  const text = content ?? '';
  const actions: AgentActionProposal[] = [];
  const fenceRe = new RegExp("```" + AGENT_ACTION_FENCE + "\\s*([\\s\\S]*?)```", 'gi');
  let cleaned = text;
  let m: RegExpExecArray | null;
  while ((m = fenceRe.exec(text)) !== null) {
    const payload = m[1].trim();
    let parsedAll = false;
    try {
      const json = JSON.parse(payload) as unknown;
      const candidates: unknown[] = Array.isArray(json)
        ? json
        : Array.isArray((json as { actions?: unknown[] })?.actions)
          ? ((json as { actions: unknown[] }).actions)
          : [json];
      const proposals = candidates.map(toProposal).filter((p): p is AgentActionProposal => p !== null);
      if (proposals.length > 0) {
        actions.push(...proposals);
        parsedAll = true;
      }
    } catch {
      parsedAll = false;
    }
    if (parsedAll) {
      cleaned = cleaned.replace(m[0], '');
    }
  }
  return { text: cleaned.replace(/\n{3,}/g, '\n\n').trim(), actions };
}
