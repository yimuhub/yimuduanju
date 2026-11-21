/**
 * 版本历史面板（G17 · OpenMotion MotionHistoryPanel 对齐）
 * -------------------------------------------------------------
 * 左侧修订列表（版本号 / 徽章 / 时间 / 操作者 / 改动片段数）+ 顶部
 * 「保存当前版本」显式落一次修订 + 每行「恢复此版本」（确认后走既有
 * 恢复 API，恢复后用 reloadAfterConflict 重新拉取时间线，选中态清空）。
 * C4 补齐 Pinned：行内星标切换（PUT /timeline/revisions/:revision/pin，
 * 乐观更新失败回滚）+「只看已固定」过滤 chip + 行内「已固定」徽章。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Clock3, History, Loader2, RotateCcw, Save, Star } from 'lucide-react';
import { toast } from 'sonner';
import {
  listTimelineRevisions,
  pinTimelineRevision,
  restoreTimelineRevision,
  type TimelineRevision,
} from '@client/src/api/timeline';
import { useStudio } from './StudioShell';
import { useEdl } from './EdlContext';

type AuthorFilter = 'all' | 'user' | 'agent' | 'restore';

const AUTHOR_LABEL: Record<string, string> = {
  user: '手动编辑',
  agent: 'Agent',
  restore: '恢复操作',
};

const fmtTime = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

export const HistoryPanel = () => {
  const { projectId } = useStudio();
  const edl = useEdl();
  const [rows, setRows] = useState<TimelineRevision[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<AuthorFilter>('all');
  const [onlyPinned, setOnlyPinned] = useState(false);
  const [pinBusy, setPinBusy] = useState<number | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const list = await listTimelineRevisions(projectId, 50);
      // 服务端按修订号返回，这里再稳一道：最新在最前
      const sorted = [...list].sort((a, b) => b.revision - a.revision);
      if (mounted.current) {
        setRows(sorted);
        setError('');
      }
    } catch (e) {
      if (mounted.current) setError((e as Error).message || '修订历史读取失败');
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /** 保存当前版本：与 ⌘S 同一条链路（edl.saveNow = 编辑器 flush），落库即生成一条修订 */
  const keepCurrent = async () => {
    if (busy) return;
    if (!edl.dirty) {
      toast.info('没有待保存的改动，当前时间线已是最新版本');
      return;
    }
    setBusy(true);
    try {
      const ok = await edl.saveNow();
      if (ok) toast.success('已保存当前版本');
      await refresh();
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  /** 恢复此版本：先把手上的改动落成一条修订（不丢历史），再走恢复 API，最后重拉时间线 */
  const restore = async (rev: TimelineRevision) => {
    if (busy || !projectId) return;
    const ok = window.confirm(
      `恢复到版本 #${rev.revision}？\n\n恢复会生成一条新修订，不会改写历史；当前未保存的改动会先保存为一条修订。`,
    );
    if (!ok) return;
    setBusy(true);
    try {
      // 未保存的改动先落成一条修订：保证「恢复前」的状态本身也在历史里
      if (edl.dirty && !(await edl.saveNow())) {
        toast.error('当前改动保存失败，已取消恢复（避免丢失未保存内容）');
        return;
      }
      const res = await restoreTimelineRevision(projectId, rev.revision);
      edl.setSelection([]);
      // 恢复后服务端文档已变：用既有 reloadAfterConflict 重新拉取并重置本地撤销栈
      await edl.reloadAfterConflict();
      toast.success(`已恢复到版本 #${res.restoredFrom}（新修订 #${res.newRevision}）`);
      await refresh();
    } catch (e) {
      toast.error(`恢复失败：${(e as Error).message || '请稍后重试'}`);
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  /** 固定 / 取消固定（C4）：乐观更新，服务端失败回滚并提示（旧后端无此路由时仍可用） */
  const togglePin = async (rev: TimelineRevision) => {
    if (pinBusy != null || !projectId) return;
    const next = !rev.pinned;
    setPinBusy(rev.revision);
    setRows((prev) => prev.map((r) => (r.revision === rev.revision ? { ...r, pinned: next } : r)));
    try {
      await pinTimelineRevision(projectId, rev.revision, next);
    } catch (e) {
      if (mounted.current) {
        setRows((prev) => prev.map((r) => (r.revision === rev.revision ? { ...r, pinned: !next } : r)));
        toast.error(`星标保存失败：${(e as Error).message || '请稍后重试'}`);
      }
    } finally {
      if (mounted.current) setPinBusy(null);
    }
  };

  const counts = useMemo(() => {
    const c: Record<AuthorFilter, number> = { all: rows.length, user: 0, agent: 0, restore: 0 };
    for (const r of rows) {
      const key = (r.author in c ? r.author : 'all') as AuthorFilter;
      if (key !== 'all') c[key] += 1;
    }
    return c;
  }, [rows]);

  const pinnedCount = useMemo(() => rows.filter((r) => r.pinned).length, [rows]);

  const shown = useMemo(
    () =>
      rows
        .filter((r) => (filter === 'all' ? true : r.author === filter))
        .filter((r) => (onlyPinned ? r.pinned : true)),
    [rows, filter, onlyPinned],
  );

  return (
    <section className="hist-panel" aria-label="版本历史">
      <div className="hist-toolbar">
        <div className="hist-toolbar-text">
          <b>版本历史</b>
          <span>剪辑自动记为修订，可随时恢复；恢复不改写历史。</span>
        </div>
        <button type="button" className="hist-btn hist-btn-primary" disabled={busy || loading || !projectId} onClick={() => void keepCurrent()}>
          <Save size={13} />
          保存当前版本
        </button>
      </div>

      <div className="hist-filters" aria-label="按来源过滤">
        {(['all', 'user', 'agent', 'restore'] as AuthorFilter[]).map((k) => (
          <button key={k} type="button" className={filter === k ? 'on' : ''} aria-pressed={filter === k} onClick={() => setFilter(k)}>
            {k === 'all' ? '全部' : AUTHOR_LABEL[k]}
            <span>{counts[k]}</span>
          </button>
        ))}
        <button
          type="button"
          className={`hist-pin-filter${onlyPinned ? ' on' : ''}`}
          aria-pressed={onlyPinned}
          title="只看星标固定的版本"
          onClick={() => setOnlyPinned((v) => !v)}
        >
          <Star size={11} />
          已固定
          <span>{pinnedCount}</span>
        </button>
      </div>

      {error ? (
        <div className="hist-error" role="alert">
          {error}
          <button type="button" disabled={busy} onClick={() => void refresh()}>重试</button>
        </div>
      ) : null}

      <div className="hist-list" aria-label="修订列表">
        {loading ? <p className="hist-empty">读取版本…</p> : null}
        {!loading && !shown.length ? (
          <p className="hist-empty">
            <History size={18} />
            {onlyPinned ? '还没有星标固定的版本。点任意修订行右上角的星标即可固定。' : '还没有任何修订。编辑时间线或点「保存当前版本」即可生成第一条。'}
          </p>
        ) : null}
        {shown.map((rev) => (
          <div key={rev.revision} className="hist-item">
            <div className="hist-item-head">
              <strong>版本 #{rev.revision}</strong>
              {/* 「最新」按修订号判定：过滤（只看已固定 / 按来源）后首行未必是全库最新 */}
              {rev.revision === rows[0]?.revision ? <span className="hist-badge hist-badge-latest">最新</span> : null}
              <span className="hist-badge">{AUTHOR_LABEL[rev.author] ?? rev.author}</span>
              {rev.pinned ? <span className="hist-badge hist-badge-pinned">已固定</span> : null}
              <button
                type="button"
                className={`hist-pin${rev.pinned ? ' on' : ''}`}
                aria-pressed={rev.pinned}
                disabled={pinBusy === rev.revision}
                title={rev.pinned ? '取消固定此版本' : '固定此版本（历史里快速定位）'}
                onClick={() => void togglePin(rev)}
              >
                <Star size={12} />
              </button>
            </div>
            {rev.summary ? <div className="hist-item-summary" title={rev.summary}>{rev.summary}</div> : null}
            <div className="hist-item-meta">
              <time dateTime={rev.createdAt}>
                <Clock3 size={11} />
                {fmtTime(rev.createdAt)}
              </time>
              <span>{rev.changedClientKeys?.length ? `改动 ${rev.changedClientKeys.length} 个片段` : '无片段改动'}</span>
            </div>
            <button
              type="button"
              className="hist-restore"
              disabled={busy || rev.revision === rows[0]?.revision}
              title={rev.revision === rows[0]?.revision ? '已是最新版本' : '回滚到这个版本（生成新修订）'}
              onClick={() => void restore(rev)}
            >
              {busy ? <Loader2 size={12} className="hist-spin" /> : <RotateCcw size={12} />}
              恢复此版本
            </button>
          </div>
        ))}
      </div>

      <div className="hist-foot">恢复会生成一条新修订并重新载入时间线；当前改动会先自动保存。</div>
    </section>
  );
};

export default HistoryPanel;
