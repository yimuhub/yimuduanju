/**
 * 对话剪辑确认卡
 * -------------------------------------------------------------
 * 模型只出「提案」，这里先干跑 diff（同一份纯函数），用户点「应用」才走
 * /timeline/agent-ops 事务落库；应用后进入编辑器撤销栈，⌘Z 可整体回退。
 */
import { useMemo, useState } from 'react';
import { Check, Loader2, Sparkles, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import { useEdlOptional } from './EdlContext';
import {
  parseTimelineOpsProposal,
  summarizeOps,
  timelineOpLabel,
} from '@client/src/lib/timeline-agent-ops';

const APPLIED_KEY = 'yimu.agentops.applied';

const readApplied = (): string[] => {
  try {
    const raw = JSON.parse(localStorage.getItem(APPLIED_KEY) ?? '[]') as unknown;
    return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
};

const markApplied = (id: string) => {
  try {
    const list = readApplied();
    const next = [...new Set([id, ...list])].slice(0, 80);
    localStorage.setItem(APPLIED_KEY, JSON.stringify(next));
  } catch {
    /* 隐私模式忽略 */
  }
};

export const TimelineOpsCard = ({
  content,
  messageId,
}: {
  content: string;
  messageId: string;
}) => {
  const editor = useEdlOptional();
  const proposal = useMemo(() => parseTimelineOpsProposal(content), [content]);
  const [applied, setApplied] = useState(() => readApplied().includes(messageId));
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const preview = useMemo(
    () => (editor && proposal ? editor.previewAgentOps(proposal.ops) : null),
    [editor, proposal],
  );

  if (!editor || !proposal || !preview) return null;

  const blocked = preview.errors.length > 0;
  const stale = proposal.baseVersion !== editor.version;

  const apply = async () => {
    if (blocked || applying || applied) return;
    setApplying(true);
    setError(null);
    try {
      await editor.applyAgentOps(proposal.ops, proposal.summary);
      markApplied(messageId);
      setApplied(true);
      toast.success('已应用到时间线', {
        description: `${summarizeOps(proposal.ops)} · 可用 ⌘Z 撤销本次修改`,
        duration: 3000,
      });
    } catch (err) {
      const e = err as {
        response?: { status?: number; data?: { message?: string | string[] } };
        message?: string;
      };
      const status = e.response?.status;
      const msg = e.response?.data?.message ?? e.message ?? '应用失败';
      const text = Array.isArray(msg) ? msg.join('；') : String(msg);
      setError(text);
      toast.error(status === 409 ? '时间线已更新' : '剪辑动作未应用', {
        description:
          status === 409
            ? '当前时间线版本已变化，请让 Agent 重新生成提案'
            : text,
        duration: 5000,
      });
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="tl-ops-card">
      <div className="tl-ops-h">
        <Sparkles size={13} />
        <b>剪辑建议</b>
        <span>{proposal.summary}</span>
        <em>基于 v{proposal.baseVersion}</em>
      </div>
      {stale ? (
        <div className="tl-ops-stale">
          提案基于 v{proposal.baseVersion}，当前已到 v{editor.version}；应用时会按当前时间线重新校验。
        </div>
      ) : null}
      <div className="tl-ops-list">
        {preview.diffs.map((d, i) => (
          <div className="tl-ops-row" key={`${d.opIndex}-${i}`}>
            <span className="tl-ops-op">{timelineOpLabel(d.op)}</span>
            <span className="tl-ops-before">{d.before}</span>
            <span className="tl-ops-arrow">→</span>
            <span className="tl-ops-after">{d.after}</span>
            {d.note ? <em className="tl-ops-note">{d.note}</em> : null}
          </div>
        ))}
      </div>
      {blocked ? (
        <div className="tl-ops-err">
          <TriangleAlert size={13} />
          {preview.errors.map((e) => `#${e.opIndex + 1} ${e.message}`).join('；')}
        </div>
      ) : null}
      {error ? <div className="tl-ops-err">{error}</div> : null}
      <div className="tl-ops-actions">
        {Math.abs(preview.durationDelta) > 0.001 ? (
          <span className="tl-ops-meta">
            总时长 {preview.durationDelta > 0 ? '+' : ''}
            {preview.durationDelta.toFixed(2)}s
          </span>
        ) : null}
        <button
          type="button"
          className="btn tl-ops-apply"
          disabled={blocked || applying || applied}
          onClick={() => void apply()}
        >
          {applying ? <Loader2 className="spin" size={12} /> : applied ? <Check size={12} /> : null}
          {applied ? '已应用（⌘Z 可撤销）' : applying ? '应用中…' : `应用 ${proposal.ops.length} 个动作`}
        </button>
      </div>
    </div>
  );
};
