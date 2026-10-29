import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Send,
  Paperclip,
  Plus,
  Search,
  Loader2,
  FolderKanban,
  ListTodo,
  ImageIcon,
  Sparkles,
  Trash2,
  Film,
  ExternalLink,
  X,
} from 'lucide-react';
import { assets as assetsApi, assistant as assistantApi, generation as generationApi, projects as projectsApi } from '@client/src/api';
import type { Asset, GenerationJob, Project } from '@shared/api.interface';

/**
 * 创作作战室（首页 · Agent 三段式）
 * ─────────────────────────────────────────────
 * 左：会话列表（今天/更早分组，localStorage 持久）
 * 中：对话流 = 创作过程。支持附件、快捷指令、项目卡片（一键进入专业工作台）
 * 右：产出面板（项目资产 + 生成任务实时进度）
 *
 * Agent 编排 v1 为前端编排：开放对话走 assistant.chat；结构化指令
 * （一句话建项目）直接调 quick-create 真实接口，产出真实项目与任务。
 * 后续演进：把编排迁移到后端 Agent 服务（见 docs/多端架构与客户端打包规划.md）。
 */

interface Attachment {
  name: string;
  size: number;
  dataUrl?: string;
  text?: string;
}

interface ChatMsg {
  id: string;
  role: 'user' | 'agent';
  text: string;
  attachments?: Attachment[];
  /** 动作卡片：建好的项目 / 任务列表，点击直达工作台 */
  card?: { kind: 'project'; projectId: string; title: string; status?: string } | { kind: 'jobs'; jobs: GenerationJob[] };
  chips?: string[];
}

interface Session {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  projectId?: string;
  messages: ChatMsg[];
}

const LS_KEY = 'yimu.agentSessions.v1';
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

const QUICK_CHIPS = ['🎬 一句话创建短剧项目', '📋 查看最近的生成任务', '✨ 给我一个大纲创意', '🖼 去画布生成图片'];

const newSession = (): Session => ({
  id: uid(),
  title: '新的对话',
  createdAt: Date.now(),
  updatedAt: Date.now(),
  messages: [
    {
      id: uid(),
      role: 'agent',
      text:
        '你好，我是 YIMU 创作作战室 🎬\n\n把你的想法告诉我——一句话、一段剧本、一张参考图都行，我来把它变成短剧。\n\n试试：直接输入"做一部关于外卖骑手逆袭的 45 秒竖屏短剧"，或点下面的快捷指令。',
      chips: QUICK_CHIPS,
    },
  ],
});

const loadSessions = (): Session[] => {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const arr = JSON.parse(raw) as Session[];
      if (Array.isArray(arr) && arr.length) return arr;
    }
  } catch { /* 忽略坏档 */ }
  return [newSession()];
};

const dayLabel = (ts: number) => {
  const d = new Date(ts);
  const today = new Date();
  const isSameDay = d.toDateString() === today.toDateString();
  return isSameDay ? '今天' : d.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
};

const JOB_STATUS_LABELS: Record<string, string> = {
  pending: '排队中', running: '生成中', succeeded: '已完成', failed: '失败', cancelled: '已取消',
};

const AgentStudio = () => {
  const navigate = useNavigate();
  const [sessions, setSessions] = useState<Session[]>(loadSessions);
  const [activeId, setActiveId] = useState(() => '');
  const [searchText, setSearchText] = useState('');
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [rightTab, setRightTab] = useState<'assets' | 'jobs'>('jobs');
  const [panelAssets, setPanelAssets] = useState<Asset[]>([]);
  const [panelJobs, setPanelJobs] = useState<GenerationJob[]>([]);
  const streamRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const active = useMemo(
    () => sessions.find((s) => s.id === activeId) ?? sessions[0],
    [sessions, activeId],
  );
  useEffect(() => { if (!active) setActiveId(sessions[0]?.id ?? ''); }, [active, sessions]);

  const persist = useCallback((next: Session[]) => {
    setSessions(next);
    try { localStorage.setItem(LS_KEY, JSON.stringify(next.slice(0, 50))); } catch { /* 容量满则忽略 */ }
  }, []);

  const patchSession = useCallback((id: string, fn: (s: Session) => Session) => {
    setSessions((prev) => {
      const next = prev.map((s) => (s.id === id ? { ...fn(s), updatedAt: Date.now() } : s));
      try { localStorage.setItem(LS_KEY, JSON.stringify(next.slice(0, 50))); } catch { /* 容量满则忽略 */ }
      return next;
    });
  }, []);

  const appendMsg = useCallback((sid: string, msg: ChatMsg) => {
    patchSession(sid, (s) => ({ ...s, messages: [...s.messages, msg] }));
  }, [patchSession]);

  // 右侧面板数据：跟随会话绑定的项目
  useEffect(() => {
    const pid = active?.projectId;
    if (pid) {
      void assetsApi.listByProject(pid).then((r) => setPanelAssets(r ?? [])).catch(() => setPanelAssets([]));
    } else {
      setPanelAssets([]);
    }
  }, [active?.projectId]);

  useEffect(() => {
    const jobParams = { page: 1, pageSize: 15, ...(active?.projectId ? { projectId: active.projectId } : {}) };
    void generationApi.listJobs(jobParams).then((r) => setPanelJobs(r.items ?? [])).catch(() => setPanelJobs([]));
    const timer = setInterval(() => {
      void generationApi.listJobs(jobParams).then((r) => setPanelJobs(r.items ?? [])).catch(() => { /* 静默 */ });
    }, 5000);
    return () => clearInterval(timer);
  }, [active?.projectId]);

  useEffect(() => {
    streamRef.current?.scrollTo({ top: streamRef.current.scrollHeight, behavior: 'smooth' });
  }, [active?.messages.length, busy]);

  // ---- 动作：一句话创建项目（走真实 quick-create 流水线） ----
  const runQuickCreate = useCallback(async (sid: string, prompt: string) => {
    appendMsg(sid, { id: uid(), role: 'agent', text: `收到！开始为你搭建短剧项目：\n「${prompt.slice(0, 60)}」\n\n正在创建项目并启动剧本解析…` });
    try {
      const res = await projectsApi.quickCreate({
        prompt,
        durationSeconds: 45,
        aspectRatio: '9:16',
        artStyle: 'realistic',
        budgetMode: 'balanced',
        mode: 'quick',
        expandScript: true,
      });
      patchSession(sid, (s) => ({ ...s, projectId: res.projectId }));
      appendMsg(sid, {
        id: uid(),
        role: 'agent',
        text: '项目已创建，剧本流水线已启动 ✅',
        card: { kind: 'project', projectId: res.projectId, title: prompt.slice(0, 40), status: res.status },
        chips: ['📋 查看最近的生成任务', '🖼 去画布生成图片'],
      });
      void projectsApi.getProject(res.projectId).then((p: Project) => {
        if (p?.title) patchSession(sid, (s) => ({ ...s, title: p.title }));
      }).catch(() => { /* 标题失败不影响 */ });
    } catch (e) {
      appendMsg(sid, { id: uid(), role: 'agent', text: `创建失败：${(e as Error).message}\n请检查后端服务与供应商配置（设置 → 供应商）。` });
    }
  }, [appendMsg, patchSession]);

  // ---- 动作：最近任务卡片 ----
  const showRecentJobs = useCallback(async (sid: string) => {
    try {
      const res = await generationApi.listJobs({ page: 1, pageSize: 8 });
      appendMsg(sid, { id: uid(), role: 'agent', text: `最近 ${(res.items ?? []).length} 个生成任务：`, card: { kind: 'jobs', jobs: res.items ?? [] } });
    } catch (e) {
      appendMsg(sid, { id: uid(), role: 'agent', text: `任务查询失败：${(e as Error).message}` });
    }
  }, [appendMsg]);

  // ---- 发送 ----
  const send = async (rawText?: string) => {
    const text = (rawText ?? input).trim();
    if ((!text && attachments.length === 0) || busy || !active) return;
    const sid = active.id;

    // 快捷指令分发
    if (text.includes('一句话创建') || /^(做|来|拍)一(部|个|条).{0,30}(剧|片|视频)/.test(text)) {
      const prompt = text.replace(/^[🎬🎬\s]*一句话创建短剧项目$/, '').trim() || text;
      if (text.includes('一句话创建')) {
        setInput('');
        appendMsg(sid, { id: uid(), role: 'user', text: '🎬 一句话创建短剧项目' });
        setBusy(true);
        try {
          const fill = window.prompt('用一句话描述你的短剧（题材/人物/反转）：', '深夜便利店，店员捡到一只会说话的猫，它要用九条命换一个愿望');
          if (fill && fill.trim()) await runQuickCreate(sid, fill.trim());
        } finally { setBusy(false); }
        return;
      }
      setInput('');
      appendMsg(sid, { id: uid(), role: 'user', text, attachments: attachments.length ? attachments : undefined });
      setAttachments([]);
      setBusy(true);
      try { await runQuickCreate(sid, prompt); } finally { setBusy(false); }
      return;
    }
    if (text.includes('查看最近的生成任务') || text.includes('查看任务')) {
      setInput('');
      appendMsg(sid, { id: uid(), role: 'user', text });
      setBusy(true);
      try { await showRecentJobs(sid); } finally { setBusy(false); }
      return;
    }

    // 普通对话：附件转文字上下文 + assistant.chat
    const attachNote = attachments.length
      ? `\n\n[附件 ${attachments.length} 个：${attachments.map((a) => a.name).join('、')}${attachments.some((a) => a.text) ? '，已提取文本一并参考' : ''}]`
      : '';
    setInput('');
    appendMsg(sid, { id: uid(), role: 'user', text: text || '(附件)', attachments: attachments.length ? attachments : undefined });
    const payloadText = text + attachNote + (attachments.map((a) => a.text ? `\n\n--- ${a.name} ---\n${a.text.slice(0, 2000)}` : '').join(''));
    setAttachments([]);
    setBusy(true);
    try {
      const res = await assistantApi.chat(payloadText);
      appendMsg(sid, {
        id: uid(), role: 'agent', text: res.reply,
        chips: /剧|片|故事|创意/.test(res.reply) ? ['🎬 一句话创建短剧项目'] : undefined,
      });
    } catch (e) {
      appendMsg(sid, { id: uid(), role: 'agent', text: `连接失败：${(e as Error).message}\n请确认后端已启动（scripts/start.sh）。` });
    } finally { setBusy(false); }
  };

  // ---- 附件 ----
  const onPickFiles = async (files: FileList | null) => {
    if (!files) return;
    const next: Attachment[] = [];
    for (const f of Array.from(files).slice(0, 4)) {
      if (f.size > 8 * 1024 * 1024) { continue; }
      const att: Attachment = { name: f.name, size: f.size };
      if (f.type.startsWith('image/')) {
        att.dataUrl = await new Promise<string>((ok) => {
          const r = new FileReader();
          r.onload = () => ok(String(r.result));
          r.readAsDataURL(f);
        });
      } else if (f.type.startsWith('text/') || /\.(txt|md|srt|ass|json)$/i.test(f.name)) {
        att.text = (await f.text()).slice(0, 8000);
      }
      next.push(att);
    }
    setAttachments((prev) => [...prev, ...next].slice(0, 4));
    if (fileRef.current) fileRef.current.value = '';
  };

  // ---- 会话管理 ----
  const createSession = () => { const s = newSession(); persist([s, ...sessions]); setActiveId(s.id); };
  const deleteSession = (id: string) => {
    const next = sessions.filter((s) => s.id !== id);
    persist(next.length ? next : [newSession()]);
    if (id === active?.id) setActiveId(next[0]?.id ?? '');
  };

  const filtered = sessions.filter(
    (s) => !searchText.trim() || s.title.includes(searchText.trim()) ||
      s.messages.some((m) => m.text.includes(searchText.trim())),
  );
  const groups = useMemo(() => {
    const map = new Map<string, Session[]>();
    for (const s of filtered) {
      const k = dayLabel(s.updatedAt);
      map.set(k, [...(map.get(k) ?? []), s]);
    }
    return [...map.entries()];
  }, [filtered]);

  // ---- 渲染子件 ----
  const msgCard = (m: ChatMsg) => {
    if (m.card?.kind === 'project') {
      return (
        <div className="mt-2 rounded-xl border border-primary/25 bg-primary/5 p-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-primary">
            <Film className="h-3.5 w-3.5" /> 项目已就绪
          </div>
          <p className="mt-1 text-sm font-medium text-foreground">{m.card.title}</p>
          <div className="mt-2.5 flex flex-wrap gap-2">
            <button
              onClick={() => navigate(`/project/${m.card.kind === 'project' ? m.card.projectId : ''}`)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90"
            >
              <FolderKanban className="h-3.5 w-3.5" /> 进入专业工作台
            </button>
            <button
              onClick={() => navigate(`/project/${m.card.kind === 'project' ? m.card.projectId : ''}/tasks`)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-input bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
            >
              <ListTodo className="h-3.5 w-3.5" /> 任务队列
            </button>
          </div>
        </div>
      );
    }
    if (m.card?.kind === 'jobs') {
      return (
        <div className="mt-2 space-y-1.5">
          {m.card.jobs.length === 0 && <p className="text-xs text-muted-foreground">暂无任务记录。</p>}
          {m.card.jobs.map((j) => (
            <div key={j.id} className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-medium text-foreground">{j.jobType} · {j.id.slice(0, 8)}</span>
                <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  {JOB_STATUS_LABELS[j.status] ?? j.status}{j.status === 'running' ? ` ${j.progress ?? 0}%` : ''}
                </span>
              </div>
            </div>
          ))}
        </div>
      );
    }
    return null;
  };

  const sessionBtn = (s: Session) => (
    <div key={s.id} className="group relative">
      <button
        onClick={() => setActiveId(s.id)}
        className={`w-full rounded-lg px-3 py-2.5 text-left text-sm transition-colors ${
          s.id === active?.id
            ? 'bg-primary/10 text-foreground'
            : 'text-foreground/75 hover:bg-sidebar-accent'
        }`}
      >
        <span className="block truncate pr-6 font-medium">{s.title}</span>
        <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
          {s.messages.length} 条消息 · {new Date(s.updatedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
        </span>
      </button>
      <button
        onClick={(e) => { e.stopPropagation(); deleteSession(s.id); }}
        className="absolute right-1.5 top-2.5 hidden rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground group-hover:block"
        aria-label="删除会话"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );

  return (
    <div className="flex h-full min-h-0 w-full overflow-hidden">
      {/* ============ 左：会话列表 ============ */}
      <aside className="hidden w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar md:flex">
        <div className="border-b border-sidebar-border p-3">
          <button
            onClick={createSession}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-3 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm transition-opacity hover:opacity-90"
          >
            <Plus className="h-4 w-4" /> 新的对话
          </button>
          <div className="relative mt-2.5">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="搜索会话"
              className="h-8 w-full rounded-lg border border-input bg-background pl-8 pr-2 text-xs outline-none focus:border-primary"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {groups.map(([label, list]) => (
            <div key={label} className="mb-2">
              <div className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
              <div className="space-y-0.5">{list.map(sessionBtn)}</div>
            </div>
          ))}
        </div>
        <div className="border-t border-sidebar-border p-2">
          {[
            { to: '/projects', label: '项目中心', icon: FolderKanban },
            { to: '/assets', label: '资产库', icon: ImageIcon },
            { to: '/dashboard', label: '数据看板', icon: ListTodo },
          ].map((it) => (
            <button
              key={it.to}
              onClick={() => navigate(it.to)}
              className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-foreground/75 hover:bg-sidebar-accent"
            >
              <it.icon className="h-4 w-4" /> {it.label}
            </button>
          ))}
        </div>
      </aside>

      {/* ============ 中：对话流 ============ */}
      <section className="flex min-w-0 flex-1 flex-col bg-background">
        <header className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
          <div className="flex min-w-0 items-center gap-2">
            <Sparkles className="h-4 w-4 shrink-0 text-primary" />
            <span className="truncate text-sm font-semibold text-foreground">{active?.title ?? '创作作战室'}</span>
            {active?.projectId && (
              <button
                onClick={() => navigate(`/project/${active.projectId}`)}
                className="ml-1 inline-flex shrink-0 items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary hover:bg-primary/20"
              >
                工作台 <ExternalLink className="h-3 w-3" />
              </button>
            )}
          </div>
          <span className="hidden shrink-0 text-[11px] text-muted-foreground lg:inline">
            对话即创作 · 进入工作流后可在项目工作台精细操作
          </span>
        </header>

        <div ref={streamRef} className="flex-1 overflow-y-auto px-4 py-5 sm:px-8">
          <div className="mx-auto max-w-2xl space-y-4">
            {(active?.messages ?? []).map((m) => (
              <div key={m.id} className={m.role === 'user' ? 'flex justify-end' : ''}>
                <div className={`max-w-[88%] ${m.role === 'user' ? 'order-1' : ''}`}>
                  <div
                    className={`rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
                      m.role === 'user'
                        ? 'bg-primary text-primary-foreground'
                        : 'border border-border bg-muted/40 text-foreground'
                    }`}
                  >
                    {m.text}
                  </div>
                  {m.attachments && m.attachments.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap justify-end gap-1.5">
                      {m.attachments.map((a, i) => (
                        <span key={i} className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/50 px-1.5 py-0.5 text-[11px] text-muted-foreground">
                          {a.dataUrl
                            ? <img src={a.dataUrl} alt={a.name} className="h-6 w-6 rounded object-cover" />
                            : <Paperclip className="h-3 w-3" />}
                          {a.name.slice(0, 16)}
                        </span>
                      ))}
                    </div>
                  )}
                  {msgCard(m)}
                  {m.chips && m.role === 'agent' && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {m.chips.map((c) => (
                        <button
                          key={c}
                          onClick={() => void send(c)}
                          className="rounded-full border border-primary/30 bg-primary/5 px-2.5 py-1 text-xs text-primary transition-colors hover:bg-primary/15"
                        >
                          {c}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {busy && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> 正在处理…
              </div>
            )}
          </div>
        </div>

        {/* 输入区 */}
        <div className="shrink-0 border-t border-border bg-background px-4 py-3 sm:px-8">
          <div className="mx-auto max-w-2xl">
            {attachments.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-1.5">
                {attachments.map((a, i) => (
                  <span key={i} className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-muted/50 py-1 pl-1.5 pr-2 text-xs text-foreground">
                    {a.dataUrl
                      ? <img src={a.dataUrl} alt={a.name} className="h-7 w-7 rounded object-cover" />
                      : <Paperclip className="h-3.5 w-3.5 text-muted-foreground" />}
                    <span className="max-w-[140px] truncate">{a.name}</span>
                    <button onClick={() => setAttachments((p) => p.filter((_, j) => j !== i))} aria-label="移除附件">
                      <X className="h-3 w-3 text-muted-foreground hover:text-foreground" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="flex items-end gap-2 rounded-2xl border border-input bg-background p-2 shadow-sm focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20">
              <button
                onClick={() => fileRef.current?.click()}
                className="rounded-xl p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label="添加附件（图片 / 剧本 / 字幕文本）"
                title="添加附件（图片 / 剧本 / 字幕文本）"
              >
                <Paperclip className="h-4.5 w-4.5" />
              </button>
              <input ref={fileRef} type="file" multiple accept="image/*,.txt,.md,.srt,.ass,.json" className="hidden" onChange={(e) => void onPickFiles(e.target.files)} />
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    void send();
                  }
                }}
                rows={1}
                placeholder="描述你的短剧创意，或拖入剧本 / 参考图…（Enter 发送，Shift+Enter 换行）"
                className="max-h-32 min-h-[38px] flex-1 resize-none bg-transparent py-2 text-sm outline-none placeholder:text-muted-foreground"
              />
              <button
                onClick={() => void send()}
                disabled={busy || (!input.trim() && attachments.length === 0)}
                className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
                aria-label="发送"
              >
                <Send className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-1.5 text-center text-[11px] text-muted-foreground">
              附件支持图片预览与文本提取 · 建项目后自动进入短剧工作流
            </p>
          </div>
        </div>
      </section>

      {/* ============ 右：产出面板 ============ */}
      <aside className="hidden w-[300px] shrink-0 flex-col border-l border-sidebar-border bg-sidebar lg:flex">
        <div className="flex shrink-0 gap-1 border-b border-sidebar-border p-2">
          {([['jobs', '生成任务', ListTodo], ['assets', '产出资产', ImageIcon]] as const).map(([id, label, Icon]) => (
            <button
              key={id}
              onClick={() => setRightTab(id)}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium transition-colors ${
                rightTab === id ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              <Icon className="h-3.5 w-3.5" /> {label}
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto p-2.5">
          {active?.projectId && (
            <div className="mb-2 rounded-lg bg-primary/5 px-2.5 py-1.5 text-[11px] text-primary">
              当前会话已绑定项目，展示该项目产出
            </div>
          )}
          {rightTab === 'jobs' ? (
            panelJobs.length === 0 ? (
              <p className="p-3 text-center text-xs text-muted-foreground">暂无生成任务</p>
            ) : (
              <ul className="space-y-1.5">
                {panelJobs.map((j) => (
                  <li key={j.id} className="rounded-lg border border-transparent bg-background px-2.5 py-2 hover:border-input">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-xs font-medium text-foreground">{j.jobType} · {j.id.slice(0, 8)}</span>
                      <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        {JOB_STATUS_LABELS[j.status] ?? j.status}
                      </span>
                    </div>
                    {j.status === 'running' && (
                      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-muted">
                        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${Math.min(100, Math.max(2, j.progress || 2))}%` }} />
                      </div>
                    )}
                    {j.status === 'failed' && j.errorMessage && (
                      <p className="mt-1 line-clamp-2 text-[10px] text-red-500">{j.errorMessage}</p>
                    )}
                  </li>
                ))}
              </ul>
            )
          ) : panelAssets.length === 0 ? (
            <p className="p-3 text-center text-xs text-muted-foreground">
              {active?.projectId ? '该项目暂无产出资产' : '创建项目后，生成的图片 / 视频 / 配音会出现在这里'}
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {panelAssets.slice(0, 24).map((a) => (
                <div key={a.id} className="overflow-hidden rounded-lg border border-border bg-background">
                  {a.assetType === 'image' && a.fileUrl ? (
                    <img src={`/api/assets/${a.id}/content`} alt={a.name} loading="lazy" className="h-24 w-full object-cover" />
                  ) : (
                    <div className="flex h-24 items-center justify-center text-muted-foreground">
                      {a.assetType === 'video' ? <Film className="h-6 w-6" /> : <ImageIcon className="h-6 w-6" />}
                    </div>
                  )}
                  <p className="truncate px-1.5 py-1 text-[10px] text-muted-foreground">{a.name}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
};

export default AgentStudio;
