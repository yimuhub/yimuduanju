/**
 * 对话确认卡（对标 zenstory pendingEdits：AI 修改 = 待审批 diff）
 * ---------------------------------------------------------------------------
 * Agent 回复中解析出的可操作变更建议，在消息下方渲染成确认卡：
 * 显示 before → after diff（before 取自当前真实数据），用户点「应用」才调用
 * updateShot / updateProject 等真实 API 执行。应用后卡片锁定为「已应用」，
 * 拒绝则仅收起——对话永远不直接改数据，落点必须经确认（对话改意，面板落地）。
 */
import { useEffect, useState } from 'react';
import { Check, Loader2, RefreshCw, X, FileText, Clapperboard } from 'lucide-react';
import { toast } from 'sonner';
import { projects, storyboard } from '@client/src/api';
import type { AgentActionProposal, Shot } from '@shared/api.interface';
import { logger } from '@client/src/utils/logger';

interface AgentActionCardProps {
  projectId: string;
  action: AgentActionProposal;
  /** 应用成功后的外层回调（如刷新镜头列表） */
  onApplied?: () => void;
}

type Status = 'reviewing' | 'loading' | 'ready' | 'applying' | 'applied' | 'error';

/** patch 字段中文名（确认卡 diff 行标签） */
const FIELD_LABELS: Record<string, string> = {
  visualPrompt: '画面提示词',
  negativePrompt: '负面提示词',
  dialogue: '对白',
  subtitleText: '字幕',
  subject: '镜头标题',
  action: '动作描述',
  emotion: '情绪',
  shotSize: '景别',
  cameraAngle: '机位',
  lens: '焦段',
  movement: '运镜',
  duration: '时长（秒）',
};

const AgentActionCard = ({ projectId, action, onApplied }: AgentActionCardProps) => {
  const [status, setStatus] = useState<Status>('loading');
  const [dismissed, setDismissed] = useState(false);
  const [before, setBefore] = useState<Record<string, unknown>>({});
  const [after, setAfter] = useState<Record<string, unknown>>({});
  const [detail, setDetail] = useState<string>('');

  // 拉取当前真实数据构建 before（取不到时降级为仅展示 after）
  useEffect(() => {
    let alive = true;
    const load = async () => {
      setStatus('loading');
      try {
        if (action.action === 'update_shot' && action.targetId) {
          const shot = await storyboard.getShot(projectId, action.targetId);
          if (!alive) return;
          const b: Record<string, unknown> = {};
          const a: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(action.patch ?? {})) {
            b[k] = (shot as unknown as Record<string, unknown>)[k] ?? '';
            a[k] = v;
          }
          setBefore(b);
          setAfter(a);
        } else if (action.action === 'update_script') {
          const p = await projects.getProject(projectId);
          if (!alive) return;
          setBefore({ scriptText: (p.scriptText ?? '').slice(0, 400) });
          setAfter({ scriptText: (action.script ?? '').slice(0, 400) });
        }
        setStatus('ready');
      } catch (e) {
        logger.error('AgentActionCard load failed:', String(e));
        setDetail((e as Error).message);
        setStatus('error');
      }
    };
    void load();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, action.targetId]);

  const apply = async () => {
    if (status === 'applying' || status === 'applied') return;
    setStatus('applying');
    try {
      if (action.action === 'update_shot' && action.targetId) {
        await storyboard.updateShot(projectId, action.targetId, action.patch as Partial<Shot>);
      } else if (action.action === 'update_script') {
        await projects.updateProject(projectId, { scriptText: action.script } as never);
      } else {
        throw new Error('不支持的建议类型');
      }
      setStatus('applied');
      toast.success('已应用 AI 建议的修改');
      onApplied?.();
    } catch (e) {
      logger.error('AgentActionCard apply failed:', String(e));
      toast.error((e as Error).message || '应用失败');
      setStatus('ready');
    }
  };

  if (dismissed) return null;

  if (status === 'loading') {
    return (
      <div className="mt-2 flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2.5 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> 正在读取当前数据以生成对比…
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="mt-2 rounded-xl border border-border bg-card px-3 py-2.5 text-xs text-muted-foreground">
        该建议无法执行（{detail || '目标不存在'}），请检查后重试。
      </div>
    );
  }

  const isShot = action.action === 'update_shot';
  const title = action.summary || (isShot ? '建议修改分镜' : '建议改写剧本');

  return (
    <div className="mt-2 rounded-xl border border-primary/30 bg-card p-3">
      <div className="flex items-center gap-2 text-xs font-semibold text-primary">
        {isShot ? <Clapperboard className="h-3.5 w-3.5" /> : <FileText className="h-3.5 w-3.5" />}
        确认卡 · {title}
      </div>
      <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
        AI 建议以下修改，应用前不会改动任何数据（对标 zenstory 待审批 diff）。
      </p>
      <div className="mt-2 space-y-1.5">
        {Object.keys(after).length === 0 ? (
          <p className="text-xs text-muted-foreground">（无可展示的变更字段）</p>
        ) : (
          Object.entries(after).map(([k, v]) => (
            <div key={k} className="rounded-lg border border-border bg-background p-2">
              <div className="text-[10px] font-medium text-muted-foreground">
                {FIELD_LABELS[k] ?? k}
              </div>
              <div className="mt-1 grid gap-1.5">
                <p className="whitespace-pre-wrap rounded bg-muted/50 px-2 py-1 text-[11px] leading-relaxed text-muted-foreground line-through decoration-red-400/60">
                  {String(before[k] ?? '（空）').slice(0, 400) || '（空）'}
                </p>
                <p className="whitespace-pre-wrap rounded bg-primary/5 px-2 py-1 text-[11px] leading-relaxed text-foreground">
                  {String(v ?? '').slice(0, 400) || '（空）'}
                </p>
              </div>
            </div>
          ))
        )}
      </div>
      <div className="mt-2.5 flex gap-2">
        {status === 'applied' ? (
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary">
            <Check className="h-3.5 w-3.5" /> 已应用
          </span>
        ) : (
          <>
            <button
              onClick={() => void apply()}
              disabled={status === 'applying'}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {status === 'applying' ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              应用
            </button>
            <button
              onClick={() => setDismissed(true)}
              title="忽略该建议（不改动数据）"
              className="inline-flex items-center gap-1.5 rounded-lg border border-input px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted"
            >
              <X className="h-3.5 w-3.5" /> 忽略
            </button>
          </>
        )}
      </div>
    </div>
  );
};

export default AgentActionCard;
