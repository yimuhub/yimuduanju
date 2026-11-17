/**
 * 时间线与修订面板：体检 + 历史 + 回滚。
 * 数据全部来自服务端 /timeline/issues 与 /timeline/revisions；
 * 回滚后走 useEdl().reloadAfterConflict()，保证撤销栈与选中态回到同一数据源。
 */
import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, History, RotateCcw, X } from 'lucide-react';
import {
  getTimelineIssues,
  listTimelineRevisions,
  restoreTimelineRevision,
  type TimelineIssue,
  type TimelineRevision,
} from '@client/src/api/timeline';
import { useEdlOptional } from './EdlContext';

const severityText: Record<TimelineIssue['severity'], string> = {
  blocking: '阻断',
  warning: '警告',
  info: '提示',
};

export const TimelineHealthPanel = ({
  open,
  projectId,
  onClose,
}: {
  open: boolean;
  projectId: string;
  onClose: () => void;
}) => {
  const edl = useEdlOptional();
  const [tab, setTab] = useState<'issues' | 'revisions'>('issues');
  const [issues, setIssues] = useState<TimelineIssue[]>([]);
  const [revisions, setRevisions] = useState<TimelineRevision[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [restoring, setRestoring] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [issueRes, revRes] = await Promise.all([
        getTimelineIssues(projectId),
        listTimelineRevisions(projectId, 40),
      ]);
      setIssues(issueRes.issues);
      setRevisions(revRes);
    } catch (e) {
      setError((e as Error).message || '读取失败');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  if (!open) return null;

  const restore = async (revision: number) => {
    setRestoring(revision);
    setError('');
    try {
      await restoreTimelineRevision(projectId, revision);
      await edl?.reloadAfterConflict();
      await load();
      setTab('revisions');
    } catch (e) {
      setError((e as Error).message || '回滚失败');
    } finally {
      setRestoring(null);
    }
  };

  const blocking = issues.filter((i) => i.severity === 'blocking').length;

  return (
    <div className="tl-modal-mask" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="tl-modal thp-modal" onClick={(e) => e.stopPropagation()}>
        <div className="tl-modal-head">
          <b>
            {tab === 'issues' ? '时间线体检' : '修订历史'}
            {tab === 'issues' && issues.length > 0 ? (
              <span className="thp-count">
                {blocking > 0 ? `${blocking} 阻断` : '可出片'} · {issues.length} 项
              </span>
            ) : null}
          </b>
          <span className="thp-tabs">
            <button
              type="button"
              className={tab === 'issues' ? 'on' : ''}
              onClick={() => setTab('issues')}
            >
              <AlertTriangle size={12} /> 体检
            </button>
            <button
              type="button"
              className={tab === 'revisions' ? 'on' : ''}
              onClick={() => setTab('revisions')}
            >
              <History size={12} /> 历史
            </button>
          </span>
          <button type="button" aria-label="关闭" onClick={onClose}>
            <X size={14} />
          </button>
        </div>

        {error ? <div className="thp-error">{error}</div> : null}
        {loading ? <div className="thp-empty">读取中…</div> : null}

        {!loading && tab === 'issues' ? (
          issues.length === 0 ? (
            <div className="thp-empty">
              <CheckCircle2 size={18} /> 没有发现问题，可以出片。
            </div>
          ) : (
            <ul className="thp-list">
              {issues.map((issue, i) => (
                <li key={`${issue.code}-${i}`} className={`sev-${issue.severity}`}>
                  <span className="thp-sev">{severityText[issue.severity]}</span>
                  <span className="thp-msg">
                    {issue.message}
                    {issue.suggestion ? <em>建议：{issue.suggestion}</em> : null}
                  </span>
                </li>
              ))}
            </ul>
          )
        ) : null}

        {!loading && tab === 'revisions' ? (
          revisions.length === 0 ? (
            <div className="thp-empty">还没有修订记录，保存一次后开始记账。</div>
          ) : (
            <ul className="thp-list thp-revs">
              {revisions.map((rev) => (
                <li key={rev.revision}>
                  <span className="thp-rev">v{rev.revision}</span>
                  <span className="thp-msg">
                    {rev.summary || (rev.author === 'agent' ? 'Agent 剪辑' : '手动保存')}
                    <em>
                      {rev.author === 'agent' ? 'Agent' : rev.author === 'restore' ? '回滚' : '手动'}
                      {rev.changedClientKeys?.length
                        ? ` · ${rev.changedClientKeys.length} 个片段`
                        : ''}
                    </em>
                  </span>
                  <button
                    type="button"
                    className="thp-restore"
                    disabled={restoring !== null}
                    onClick={() => void restore(rev.revision)}
                  >
                    <RotateCcw size={11} />
                    {restoring === rev.revision ? '回滚中…' : '回到此版'}
                  </button>
                </li>
              ))}
            </ul>
          )
        ) : null}
      </div>
    </div>
  );
};
