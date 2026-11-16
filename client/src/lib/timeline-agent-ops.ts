/**
 * 对话输出解析：把模型回复里的 ```yimu-timeline 代码块解析成可执行提案。
 * -------------------------------------------------------------
 * 容错策略：宁可返回 null（不展示卡片），也不执行半截 JSON。
 * 模型常见的多余解释、代码块前后空白都可接受；语法错误一律丢弃并保留原文，
 * 用户仍能读到自然语言说明。
 */
import type { TimelineOp } from '@shared/timeline-ops';
import { TIMELINE_OP_NAMES } from '@shared/timeline-ops';

export interface TimelineOpsProposal {
  baseVersion: number;
  summary: string;
  ops: TimelineOp[];
  raw: string;
}

const FENCE = /```yimu-timeline\s*([\s\S]*?)```/g;

/** 提取最后一个合法代码块（模型有时先解释再给动作） */
export function parseTimelineOpsProposal(content: string): TimelineOpsProposal | null {
  if (!content || !content.includes('yimu-timeline')) return null;
  const matches = [...content.matchAll(FENCE)];
  for (let i = matches.length - 1; i >= 0; i -= 1) {
    const raw = matches[i][1]?.trim();
    if (!raw) continue;
    try {
      const data = JSON.parse(raw) as {
        baseVersion?: unknown;
        summary?: unknown;
        ops?: unknown;
      };
      const baseVersion = Number(data.baseVersion);
      if (!Number.isFinite(baseVersion) || baseVersion < 0) continue;
      if (!Array.isArray(data.ops) || data.ops.length === 0) continue;
      const ops = data.ops.filter(
        (o): o is TimelineOp =>
          Boolean(o) &&
          typeof o === 'object' &&
          typeof (o as { op?: unknown }).op === 'string' &&
          TIMELINE_OP_NAMES.includes((o as { op: string }).op as never),
      );
      // 有一条不合法就整块不认：避免「部分动作偷偷生效」
      if (ops.length !== data.ops.length || ops.length > 40) continue;
      return {
        baseVersion,
        summary:
          typeof data.summary === 'string' && data.summary.trim()
            ? data.summary.trim().slice(0, 200)
            : '按你的要求调整时间线',
        ops,
        raw,
      };
    } catch {
      /* 继续尝试更早的代码块 */
    }
  }
  return null;
}

/** 从展示文本里剔除协议代码块（自然语言保留） */
export function stripAgentBlocks(content: string): string {
  return content
    .replace(/```yimu-timeline\s*[\s\S]*?```/g, '')
    .replace(/```yimu-action\s*[\s\S]*?```/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const OP_LABEL: Record<string, string> = {
  move: '移动',
  trim: '修剪',
  split: '分割',
  delete: '删除',
  subtitle: '字幕',
  speed: '变速',
  volume: '音量',
  lock: '锁定',
  track: '轨道',
};

export const timelineOpLabel = (op: string): string => OP_LABEL[op] ?? op;

/** 一句话概括一批动作（卡片标题/历史标签用） */
export function summarizeOps(ops: TimelineOp[]): string {
  const counts = new Map<string, number>();
  for (const op of ops) counts.set(op.op, (counts.get(op.op) ?? 0) + 1);
  return [...counts.entries()]
    .map(([name, n]) => `${timelineOpLabel(name)}${n > 1 ? `×${n}` : ''}`)
    .join('、');
}
