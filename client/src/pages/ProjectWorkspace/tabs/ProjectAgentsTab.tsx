import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Bot, Send, Trash2, Sparkles, User as UserIcon } from 'lucide-react';
import { agents } from '@client/src/api';
import type { AgentRegistryItem } from '@client/src/api/agents';
import type { AgentMessage } from '@shared/api.interface';
import { logger } from '@client/src/utils/logger';
import { showConfirm } from '@client/src/components/ui/confirm';

// 3.0：Agent 列表来自后端注册表（人设/技能绑定动态下发），前端不再写死
const fallbackList = [{ name: '项目导演', desc: '把控全局，规划生产计划', icon: '🎬' }];

const quickPrompts = [
  '帮我规划一下这部短剧的完整生产计划',
  '这个角色的人设不够立体，帮我重新设计',
  '所有对话镜头建议用 50mm 焦段',
  '把整体节奏加快一些',
  '帮我检查一下成片质检要点',
];

const ProjectAgentsTab = () => {
  const { id } = useParams<{ id: string }>();
  useEffect(() => {
    agents.listRegistry().then((r) => setRegistry(r ?? [])).catch(() => setRegistry([]));
  }, []);
  const [registry, setRegistry] = useState<AgentRegistryItem[]>([]);
  const [active, setActive] = useState('项目导演');
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const loadMessages = () => {
    if (!id) return;
    setLoading(true);
    agents.listMessages(id)
      .then((msgs) => setMessages(msgs))
      .catch((err) => { logger.error('load msgs', String(err)); setError('加载对话失败'); })
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadMessages(); }, [id]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  const handleSend = async (text?: string) => {
    const content = (text ?? input).trim();
    if (!content || !id || sending) return;
    setSending(true);
    setInput('');
    try {
      const reply = await agents.sendMessage(id, { content, agentName: active });
      setMessages((prev) => [...prev, {
        id: `local-${Date.now()}`, projectId: id, role: 'user', content, agentName: active, createdAt: new Date().toISOString(),
      }, reply]);
    } catch (err) {
      logger.error('send failed', String(err));
      setError('发送失败，请稍后重试');
    } finally {
      setSending(false);
    }
  };

  const handleClear = async () => {
    if (!id) return;
    if (!await showConfirm('确定清空当前项目的全部对话记录吗？')) return;
    try {
      await agents.clearMessages(id);
      setMessages([]);
    } catch (err) {
      logger.error('clear failed', String(err));
    }
  };

  return (
    <div className="flex h-[640px] gap-4">
      {/* 左：助手列表 */}
      <div className="w-56 shrink-0 space-y-2 overflow-y-auto rounded-xl border bg-white p-3 shadow-sm scrollbar-thin">
        <div className="mb-2 px-1 text-xs font-medium text-muted-foreground">多智能体 · 项目协作</div>
        {(registry.length ? registry.map((a) => ({ name: a.name, desc: '', icon: a.avatar })) : fallbackList).map((a) => (
          <button
            key={a.name}
            onClick={() => setActive(a.name)}
            className={`w-full rounded-lg p-2.5 text-left transition-colors ${
              active === a.name ? 'bg-primary/10 ring-1 ring-primary/30' : 'hover:bg-muted/50'
            }`}
          >
            <div className="flex items-center gap-2">
              <span className="text-base">{a.icon}</span>
              <div className="min-w-0">
                <div className={`truncate text-sm font-medium ${active === a.name ? 'text-primary' : 'text-foreground'}`}>{a.name}</div>
                <div className="truncate text-[10px] text-muted-foreground">{a.desc}</div>
              </div>
            </div>
          </button>
        ))}
      </div>

      {/* 中：对话区 */}
      <div className="flex min-w-0 flex-1 flex-col rounded-xl border bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="text-base">{(registry.find((a) => a.name === active)?.avatar) ?? fallbackList[0].icon}</span>
            <span className="text-sm font-semibold text-foreground">{active}</span>
            <span className="text-xs text-muted-foreground">· 项目专属 AI 智能体</span>
          </div>
          <button onClick={handleClear} className="flex items-center gap-1 rounded-md border border-input bg-white px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:border-red-300 hover:text-red-500">
            <Trash2 className="h-3.5 w-3.5" /> 清空
          </button>
        </div>

        {error && <div className="mx-4 mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-600">{error}</div>}

        <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto p-4 scrollbar-thin">
          {loading ? (
            <div className="text-center text-sm text-muted-foreground">加载中...</div>
          ) : messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-gradient text-white shadow-md">
                <Bot className="h-6 w-6" />
              </div>
              <div className="text-sm font-medium text-foreground">你好，我是{active}</div>
              <div className="max-w-sm text-xs leading-relaxed text-muted-foreground">
                可以和我讨论剧本、分镜、角色、镜头与节奏。生成的内容会自动关联到项目，可直接应用到对应标签页。
              </div>
              <div className="mt-2 flex max-w-md flex-wrap justify-center gap-2">
                {quickPrompts.map((p) => (
                  <button
                    key={p}
                    onClick={() => handleSend(p)}
                    className="rounded-full border border-primary/20 bg-primary/5 px-3 py-1.5 text-xs text-primary hover:bg-primary/10"
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((m) => (
              <div key={m.id} className={`flex gap-2.5 ${m.role === 'user' ? 'justify-end' : ''}`}>
                {m.role !== 'user' && (
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-gradient text-white">
                    <Bot className="h-3.5 w-3.5" />
                  </div>
                )}
                <div className={`max-w-[75%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
                  m.role === 'user'
                    ? 'rounded-tr-sm bg-primary text-primary-foreground'
                    : 'rounded-tl-sm bg-muted text-foreground'
                }`}>
                  <div className="mb-1 text-[10px] opacity-60">{m.agentName || (m.role === 'user' ? '我' : active)}</div>
                  <div className="whitespace-pre-wrap">{m.content}</div>
                  <div className="mt-1 text-right text-[9px] opacity-50">
                    {new Date(m.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
                {m.role === 'user' && (
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-foreground/70">
                    <UserIcon className="h-3.5 w-3.5" />
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        <div className="border-t border-border p-3">
          <div className="flex items-end gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
              rows={1}
              placeholder={`向 ${active} 提问...（Enter 发送，Shift+Enter 换行）`}
              className="max-h-32 min-h-[42px] flex-1 resize-none rounded-lg border border-input px-3 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
            <button
              onClick={() => handleSend()}
              disabled={sending || !input.trim()}
              className="flex h-[42px] items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90 disabled:opacity-50"
            >
              {sending ? <Sparkles className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              发送
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProjectAgentsTab;
