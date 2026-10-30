import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Search, MessageSquare, CornerDownLeft } from 'lucide-react';
import {
  WORKSPACE_PAGES,
  useWorkspaceTabs,
  type WorkspacePageMeta,
} from '@client/src/components/workspace/WorkspaceTabsContext';

/**
 * ⌘K 功能搜索浮层（AI-EOS 极客模式同款）
 * ─────────────────────────────────────────────
 * 列出全部功能（回车在右栏开签）与历史会话（回车跳回作战室并激活该会话）。
 * 会话数据直接读 AgentStudio 的 localStorage 档；激活通过自定义事件通知作战室。
 */

const SESSIONS_LS_KEY = 'yimu.agentSessions.v1';
export const OPEN_SESSION_EVENT = 'yimu:open-session';

interface PaletteSession {
  id: string;
  title: string;
  updatedAt: number;
}

const loadSessions = (): PaletteSession[] => {
  try {
    const raw = localStorage.getItem(SESSIONS_LS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as { id: string; title?: string; updatedAt?: number }[];
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((s) => s && typeof s.id === 'string')
      .map((s) => ({ id: s.id, title: s.title || '新的对话', updatedAt: s.updatedAt ?? 0 }))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 20);
  } catch {
    return [];
  }
};

type Item =
  | { kind: 'page'; page: WorkspacePageMeta }
  | { kind: 'session'; session: PaletteSession };

const CommandPalette = () => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const [sessions, setSessions] = useState<PaletteSession[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const { openTab } = useWorkspaceTabs();

  // ⌘K / Ctrl+K 呼出；Esc 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => {
          if (!v) {
            setQuery('');
            setCursor(0);
            setSessions(loadSessions());
          }
          return !v;
        });
      }
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // 打开时聚焦（浮层条件渲染后需要等一帧）
  useEffect(() => {
    if (open) window.setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  const items = useMemo<Item[]>(() => {
    const q = query.trim().toLowerCase();
    const pages = WORKSPACE_PAGES.filter(
      (p) =>
        !q ||
        p.title.toLowerCase().includes(q) ||
        p.key.includes(q) ||
        p.description.toLowerCase().includes(q),
    ).map((p): Item => ({ kind: 'page', page: p }));
    const sess = sessions
      .filter((s) => !q || s.title.toLowerCase().includes(q))
      .map((s): Item => ({ kind: 'session', session: s }));
    return [...pages, ...sess];
  }, [query, sessions]);

  useEffect(() => {
    setCursor((c) => Math.min(c, Math.max(0, items.length - 1)));
  }, [items.length]);

  const run = (item: Item | undefined) => {
    if (!item) return;
    setOpen(false);
    if (item.kind === 'page') {
      openTab(item.page.key);
      if (location.pathname !== '/') navigate('/', { replace: true });
    } else {
      if (location.pathname !== '/') navigate('/', { replace: true });
      window.setTimeout(() => {
        window.dispatchEvent(new CustomEvent(OPEN_SESSION_EVENT, { detail: item.session.id }));
      }, 30);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[1200] flex items-start justify-center bg-black/50 p-4 pt-[12vh]"
      onClick={() => setOpen(false)}
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-2xl border border-border bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 border-b border-border px-4">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setCursor((c) => Math.min(c + 1, items.length - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setCursor((c) => Math.max(c - 1, 0));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                run(items[cursor]);
              }
            }}
            placeholder="搜索功能或会话…（↑↓ 选择，回车打开）"
            className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <kbd className="shrink-0 rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
            Esc
          </kbd>
        </div>
        <div className="max-h-[46vh] overflow-y-auto p-1.5">
          {items.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-muted-foreground">没有匹配的功能或会话</p>
          ) : (
            items.map((item, i) => {
              const active = i === cursor;
              if (item.kind === 'page') {
                return (
                  <button
                    key={`page-${item.page.key}`}
                    type="button"
                    onMouseEnter={() => setCursor(i)}
                    onClick={() => run(item)}
                    className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                      active ? 'bg-primary/10 text-primary' : 'text-foreground hover:bg-muted'
                    }`}
                  >
                    <item.page.icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{item.page.title}</span>
                      <span className="block truncate text-[11px] text-muted-foreground">{item.page.description}</span>
                    </span>
                    {active && <CornerDownLeft className="h-3 w-3 shrink-0 text-muted-foreground" />}
                  </button>
                );
              }
              return (
                <button
                  key={`session-${item.session.id}`}
                  type="button"
                  onMouseEnter={() => setCursor(i)}
                  onClick={() => run(item)}
                  className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                    active ? 'bg-primary/10 text-primary' : 'text-foreground hover:bg-muted'
                  }`}
                >
                  <MessageSquare className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{item.session.title}</span>
                  <span className="shrink-0 text-[10px] text-muted-foreground">会话</span>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};

export default CommandPalette;
