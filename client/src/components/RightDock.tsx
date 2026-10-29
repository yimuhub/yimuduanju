import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bot, ListTodo, Send, PanelRightClose, Loader2, RotateCcw } from 'lucide-react';
import { generation } from '@client/src/api';
import { assistant as assistantApi } from '@client/src/api';
import type { GenerationJob } from '@shared/api.interface';

/**
 * 三段式布局 · 右侧助手坞（Agent 风格常驻面板）。
 * 两个标签：任务动态（实时生成任务轮询）与 AI 快聊（assistant.chat 直连）。
 * xl 以上屏幕默认展开，可通过顶栏按钮或坞内按钮收起；窄屏（<xl）不占布局。
 * 收起状态持久化到 localStorage，跨页面保持。
 */

const JOB_TYPE_LABELS: Record<string, string> = {
  text: '文本',
  image: '图片',
  video: '视频',
  tts: '配音',
  voice: '配音',
};

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-amber-50 text-amber-600',
  running: 'bg-blue-50 text-blue-600',
  succeeded: 'bg-emerald-50 text-emerald-600',
  failed: 'bg-red-50 text-red-600',
  cancelled: 'bg-muted text-muted-foreground',
};

const STATUS_LABELS: Record<string, string> = {
  pending: '排队中',
  running: '生成中',
  succeeded: '已完成',
  failed: '失败',
  cancelled: '已取消',
};

const shortId = (id: string | undefined) => (id ? id.slice(0, 8) : '—');

type DockTab = 'jobs' | 'chat';

interface ChatMsg {
  role: 'user' | 'assistant';
  text: string;
}

const RightDock = ({ onClose }: { onClose: () => void }) => {
  const navigate = useNavigate();
  const [tab, setTab] = useState<DockTab>('jobs');

  // ---- 任务动态 ----
  const [jobs, setJobs] = useState<GenerationJob[]>([]);
  const [jobsLoading, setJobsLoading] = useState(true);
  const [jobsError, setJobsError] = useState<string | null>(null);

  const loadJobs = useCallback(async () => {
    try {
      const res = await generation.listJobs({ page: 1, pageSize: 20 });
      setJobs(res.items ?? []);
      setJobsError(null);
    } catch (e) {
      setJobsError((e as Error).message);
    } finally {
      setJobsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab !== 'jobs') return;
    void loadJobs();
    const timer = setInterval(() => void loadJobs(), 5000);
    return () => clearInterval(timer);
  }, [tab, loadJobs]);

  // ---- AI 快聊 ----
  const [messages, setMessages] = useState<ChatMsg[]>([
    { role: 'assistant', text: '你好！我是 YIMU 创作助手，可以问我怎么策划短剧、怎么用画布和成片流水线。' },
  ]);
  const [input, setInput] = useState('');
  const [chatting, setChatting] = useState(false);
  const chatBottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, tab]);

  const sendChat = async () => {
    const text = input.trim();
    if (!text || chatting) return;
    setInput('');
    setMessages((prev) => [...prev, { role: 'user', text }]);
    setChatting(true);
    try {
      const res = await assistantApi.chat(text);
      setMessages((prev) => [...prev, { role: 'assistant', text: res.reply }]);
    } catch (e) {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', text: `发送失败：${(e as Error).message}` },
      ]);
    } finally {
      setChatting(false);
    }
  };

  const tabBtn = (id: DockTab, label: string, Icon: typeof Bot) => (
    <button
      type="button"
      onClick={() => setTab(id)}
      className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium transition-colors ${
        tab === id
          ? 'bg-primary/10 text-primary'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground'
      }`}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  );

  return (
    <aside className="hidden h-full w-[320px] shrink-0 flex-col border-l border-sidebar-border bg-sidebar xl:flex">
      {/* 坞头 */}
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-sidebar-border px-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          助手坞
        </span>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="收起助手坞"
        >
          <PanelRightClose className="h-4 w-4" />
        </button>
      </div>

      {/* 标签切换 */}
      <div className="flex shrink-0 gap-1 border-b border-sidebar-border p-2">
        {tabBtn('jobs', '任务动态', ListTodo)}
        {tabBtn('chat', 'AI 助手', Bot)}
      </div>

      {tab === 'jobs' ? (
        <div className="flex-1 overflow-y-auto p-2.5">
          {jobsLoading && jobs.length === 0 ? (
            <div className="flex h-32 items-center justify-center text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
            </div>
          ) : jobsError ? (
            <div className="space-y-2 p-2 text-center text-xs text-muted-foreground">
              <p>任务列表加载失败：{jobsError}</p>
              <button
                type="button"
                onClick={() => void loadJobs()}
                className="inline-flex items-center gap-1 rounded-md border border-input px-2 py-1 hover:bg-muted"
              >
                <RotateCcw className="h-3 w-3" /> 重试
              </button>
            </div>
          ) : jobs.length === 0 ? (
            <div className="p-4 text-center text-xs text-muted-foreground">
              暂无生成任务。在项目工作台或画布里发起生成后，这里会实时展示进度。
            </div>
          ) : (
            <ul className="space-y-1.5">
              {jobs.map((job) => (
                <li key={job.id}>
                  <button
                    type="button"
                    onClick={() =>
                      job.projectId
                        ? navigate(`/project/${job.projectId}/tasks`)
                        : undefined
                    }
                    className="w-full rounded-lg border border-transparent bg-background px-2.5 py-2 text-left transition-colors hover:border-input hover:bg-muted/60"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-xs font-medium text-foreground">
                        {JOB_TYPE_LABELS[job.jobType] ?? job.jobType} · {shortId(job.id)}
                      </span>
                      <span
                        className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                          STATUS_STYLES[job.status] ?? 'bg-muted text-muted-foreground'
                        }`}
                      >
                        {STATUS_LABELS[job.status] ?? job.status}
                      </span>
                    </div>
                    {job.status === 'running' && (
                      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-primary transition-all"
                          style={{ width: `${Math.min(100, Math.max(2, job.progress || 2))}%` }}
                        />
                      </div>
                    )}
                    {job.status === 'failed' && job.errorMessage && (
                      <p className="mt-1 line-clamp-2 text-[10px] leading-snug text-red-500">
                        {job.errorMessage}
                      </p>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div className="flex flex-1 flex-col overflow-hidden">
          <div className="flex-1 space-y-2.5 overflow-y-auto p-3">
            {messages.map((m, i) => (
              <div
                key={i}
                className={`max-w-[92%] rounded-xl px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap ${
                  m.role === 'user'
                    ? 'ml-auto bg-primary text-primary-foreground'
                    : 'bg-background text-foreground'
                }`}
              >
                {m.text}
              </div>
            ))}
            {chatting && (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" /> 思考中…
              </div>
            )}
            <div ref={chatBottomRef} />
          </div>
          <div className="shrink-0 border-t border-sidebar-border p-2.5">
            <div className="relative">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.nativeEvent.isComposing) void sendChat();
                }}
                placeholder="问问创作建议…"
                className="h-9 w-full rounded-xl border border-input bg-background pl-3 pr-9 text-xs outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20"
              />
              <button
                type="button"
                onClick={() => void sendChat()}
                disabled={chatting || !input.trim()}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-primary disabled:opacity-40"
                aria-label="发送"
              >
                <Send className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
};

export default RightDock;
