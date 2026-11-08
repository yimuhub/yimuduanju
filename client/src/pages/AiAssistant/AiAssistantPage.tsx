import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bot,
  Send,
  RotateCcw,
  Sparkles,
  User,
  Wand2,
  ExternalLink,
  Grip,
} from 'lucide-react';
import { toast } from 'sonner';
import { Link } from 'react-router-dom';
import { logger } from '@client/src/utils/logger';
import { assistant as assistantApi, skills as skillsApi } from '@client/src/api';
import type { SkillItem } from '@client/src/api/skills';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

const LINE_LABELS: Record<string, string> = {
  shortdrama: '短剧',
  comic: '漫画',
  ads: '广告营销',
  common: '通用',
};

const LINE_ORDER = ['shortdrama', 'comic', 'ads', 'common'];

const GREETING =
  '你好，我是「一幕 · YIMU AI 短剧创作平台」助手 👋 我可以帮你做剧本创作、分镜设计、角色设定、风格建议等轻量问答。左侧是我的技能面板，可以按需开关；要做完整的从想法到成片的流水线编排，请去「创作作战室」。';

const AiAssistantPage = () => {
  // ===== 技能面板 =====
  const [skills, setSkills] = useState<SkillItem[]>([]);
  const [skillsLoading, setSkillsLoading] = useState(true);
  const [skillsError, setSkillsError] = useState(false);
  const [togglingSlug, setTogglingSlug] = useState<string | null>(null);

  useEffect(() => {
    skillsApi
      .listSkills()
      .then((list) => {
        setSkills(list);
        setSkillsError(false);
      })
      .catch((e) => {
        logger.warn('加载技能列表失败', e);
        setSkillsError(true);
      })
      .finally(() => setSkillsLoading(false));
  }, []);

  const handleToggleSkill = async (skill: SkillItem) => {
    const next = !skill.enabled;
    setTogglingSlug(skill.slug);
    // 乐观更新，失败回滚
    setSkills((prev) =>
      prev.map((s) => (s.slug === skill.slug ? { ...s, enabled: next } : s)),
    );
    try {
      const updated = await skillsApi.setSkillEnabled(skill.slug, next);
      setSkills((prev) => prev.map((s) => (s.slug === updated.slug ? updated : s)));
    } catch {
      setSkills((prev) =>
        prev.map((s) => (s.slug === skill.slug ? { ...s, enabled: skill.enabled } : s)),
      );
      toast.error('技能开关设置失败，请重试');
    } finally {
      setTogglingSlug(null);
    }
  };

  const groupedSkills = useMemo(() => {
    const groups = new Map<string, SkillItem[]>();
    for (const s of skills) {
      const list = groups.get(s.line) ?? [];
      list.push(s);
      groups.set(s.line, list);
    }
    return [...groups.entries()].sort(
      (a, b) =>
        (LINE_ORDER.indexOf(a[0]) + 1 || 99) - (LINE_ORDER.indexOf(b[0]) + 1 || 99),
    );
  }, [skills]);
  const enabledSkillCount = skills.filter((s) => s.enabled).length;

  // ===== 对话区（保留原有真实网关对话） =====
  const [messages, setMessages] = useState<ChatMessage[]>([
    { id: 'msg-1', role: 'assistant', content: GREETING, createdAt: new Date().toISOString() },
  ]);
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || isSending) return;

    const userMsg: ChatMessage = {
      id: `msg-${Date.now()}`,
      role: 'user',
      content: text,
      createdAt: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setIsSending(true);

    // P1 修复：之前从 5 句预设里随机抽一句假装回答；现调真实文本网关
    try {
      const { reply } = await assistantApi.chat(text);
      const aiMsg: ChatMessage = {
        id: `msg-${Date.now() + 1}`,
        role: 'assistant',
        content: reply,
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, aiMsg]);
    } catch (err) {
      logger.error('AI assistant error', String(err));
      const errMsg: ChatMessage = {
        id: `msg-${Date.now() + 1}`,
        role: 'assistant',
        content:
          'AI 助手暂不可用（模型服务未配置或调用失败），请到「设置 → 供应商」配置模型服务后重试。',
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, errMsg]);
    } finally {
      setIsSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleNewChat = () => {
    setMessages([
      {
        id: `msg-${Date.now()}`,
        role: 'assistant',
        content: '你好！我是「一幕 · YIMU AI 短剧创作平台」助手，有什么新的创作想法吗？',
        createdAt: new Date().toISOString(),
      },
    ]);
  };

  return (
    /* @container：窄坞（极客模式右栏）内隐藏固定宽度技能侧栏并收敛渐变，避免竖排文字与白块 */
    <div className="@container flex h-[calc(100vh-10rem)] flex-col gap-4">
      {/* 顶部定位说明：与创作作战室（AgentStudio）拉开定位（深色主题下不使用白色渐变） */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-gradient-to-r from-primary/10 via-primary/5 to-transparent px-5 py-3.5 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-gradient text-white">
            <Wand2 className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-sm font-semibold text-foreground">
              一幕助手 · 技能面板与轻对话
            </h1>
            <p className="text-xs text-muted-foreground">
              查资料、问思路、开关创作技能的轻量入口；需要端到端流水线编排时，前往创作作战室
            </p>
          </div>
        </div>
        <Link
          to="/"
          className="flex items-center gap-1.5 rounded-lg border border-input bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:border-primary hover:text-primary"
        >
          前往创作作战室
          <ExternalLink className="h-3.5 w-3.5" />
        </Link>
      </div>

      <div className="flex min-h-0 flex-1 gap-6">
        {/* 左侧：技能面板（按产品线分组 + 启停开关）；
            @3xl 以下（窄坞渲染）隐藏，避免 w-72 固定宽度把对话区挤成 1 字/行竖排 */}
        <aside className="hidden w-72 shrink-0 flex-col overflow-hidden rounded-xl border bg-card shadow-sm @3xl:flex">
          <div className="border-b px-4 py-3">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              <span className="text-sm font-semibold text-foreground">技能面板</span>
              <span className="ml-auto rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                {skillsLoading ? '…' : `已启用 ${enabledSkillCount}/${skills.length}`}
              </span>
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              开关实时生效：启用的技能会注入对应生产环节的 Agent
            </p>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {skillsLoading ? (
              <div className="space-y-2 px-1 py-2">
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="h-12 animate-pulse rounded-lg bg-muted/60" />
                ))}
              </div>
            ) : skillsError ? (
              <div className="px-2 py-6 text-center text-xs leading-relaxed text-muted-foreground">
                技能列表加载失败，请确认后端服务正常后刷新页面重试
              </div>
            ) : skills.length === 0 ? (
              <div className="px-2 py-6 text-center text-xs leading-relaxed text-muted-foreground">
                暂无已注册技能，完成平台初始化后这里会列出短剧 / 漫画 / 广告各产品线的创作技能
              </div>
            ) : (
              groupedSkills.map(([line, list]) => (
                <div key={line} className="mb-3 last:mb-0">
                  <div className="px-1 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {LINE_LABELS[line] ?? line} · {list.length}
                  </div>
                  <div className="space-y-1">
                    {list.map((skill) => (
                      <div
                        key={skill.slug}
                        className={`rounded-lg border px-3 py-2.5 transition-colors ${
                          skill.enabled
                            ? 'border-primary/25 bg-primary/[0.04]'
                            : 'border-border/60 bg-card'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
                            {skill.name}
                          </span>
                          <button
                            onClick={() => handleToggleSkill(skill)}
                            disabled={togglingSlug === skill.slug}
                            title={skill.enabled ? '停用该技能' : '启用该技能'}
                            aria-label={`切换技能 ${skill.name}`}
                            className={`relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-60 ${
                              skill.enabled ? 'bg-primary' : 'bg-muted'
                            }`}
                          >
                            <span
                              className={`absolute top-0.5 h-4 w-4 rounded-full bg-card shadow-sm transition-transform ${
                                skill.enabled ? 'translate-x-4' : 'translate-x-0.5'
                              }`}
                            />
                          </button>
                        </div>
                        {skill.description && (
                          <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">
                            {skill.description}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        </aside>

        {/* 右侧：对话区（保留原有真实网关对话） */}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border bg-card shadow-sm">
          <div className="flex items-center gap-3 border-b px-6 py-4">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-gradient text-white">
              <Bot className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-semibold text-foreground">
                一幕助手
              </h2>
              <p className="text-xs text-muted-foreground">
                轻量创作问答 · 当前启用 {enabledSkillCount} 项技能
              </p>
            </div>
            <button
              onClick={handleNewChat}
              title="开启新对话"
              className="flex items-center gap-1.5 rounded-lg border border-input px-3 py-1.5 text-xs text-muted-foreground hover:border-primary hover:text-primary"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              新对话
            </button>
          </div>

          {/* Messages */}
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
            <div className="space-y-5">
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex items-start gap-3 ${
                    msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'
                  }`}
                >
                  <div
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                      msg.role === 'user'
                        ? 'bg-muted'
                        : 'bg-brand-gradient text-white'
                    }`}
                  >
                    {msg.role === 'user' ? (
                      <User className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <Bot className="h-4 w-4" />
                    )}
                  </div>
                  <div
                    className={`max-w-[70%] whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                      msg.role === 'user'
                        ? 'rounded-tr-sm bg-primary text-primary-foreground'
                        : 'rounded-tl-sm bg-muted text-foreground'
                    }`}
                  >
                    {msg.content}
                  </div>
                </div>
              ))}

              {messages.length === 0 && !isSending && (
                <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground">
                  <Grip className="mb-3 h-8 w-8 opacity-40" />
                  <p className="text-sm">从左侧挑几项技能，然后在这里开始提问</p>
                </div>
              )}

              {/* Typing indicator */}
              {isSending && (
                <div className="flex items-start gap-3">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-gradient text-white">
                    <Bot className="h-4 w-4" />
                  </div>
                  <div className="rounded-2xl rounded-tl-sm bg-muted px-4 py-3">
                    <div className="flex gap-1">
                      <span className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground/40 [animation-delay:-0.3s]" />
                      <span className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground/40 [animation-delay:-0.15s]" />
                      <span className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground/40" />
                    </div>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>
          </div>

          {/* Input area */}
          <div className="border-t p-4">
            <div className="flex items-end gap-3">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="输入你的问题...（Enter 发送，Shift+Enter 换行）"
                rows={2}
                className="flex-1 resize-none rounded-xl border border-input bg-card px-4 py-3 text-sm outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20"
              />
              <button
                onClick={handleSend}
                disabled={!input.trim() || isSending}
                className="flex h-11 items-center gap-2 rounded-xl bg-primary px-5 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 disabled:opacity-50"
              >
                <Send className="h-4 w-4" />
                发送
              </button>
            </div>
            <p className="mt-2 text-center text-[11px] text-muted-foreground">
              「一幕 · YIMU AI 短剧创作平台」AI 生成内容仅供参考，请仔细核对后使用
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AiAssistantPage;
