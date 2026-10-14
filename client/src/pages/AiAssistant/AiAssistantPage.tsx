import { useEffect, useRef, useState } from 'react';
import {
  Bot,
  Send,
  Plus,
  MessageSquare,
  Sparkles,
  User,
} from 'lucide-react';
import { logger } from '@client/src/utils/logger';
import { assistant as assistantApi } from '@client/src/api';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

interface Conversation {
  id: string;
  name: string;
  description?: string;
}

const AiAssistantPage = () => {
  const [conversations] = useState<Conversation[]>([
    { id: 'global', name: '一木·YIMU AI 视频创作平台助手', description: '全局创作助手' },
  ]);
  const [activeConvId, setActiveConvId] = useState('global');
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'msg-1',
      role: 'assistant',
      content:
        '你好！我是「一木·YIMU AI 视频创作平台」助手 👋 我可以帮你进行剧本创作、分镜设计、角色设定、风格建议等短剧创作相关的工作。有什么我可以帮你的吗？',
      createdAt: new Date().toISOString(),
    },
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
          'AI 助手暂不可用（模型服务未配置或调用失败），请到「设置 → 模型服务」配置后重试。',
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
        content: '你好！我是「一木·YIMU AI 视频创作平台」助手，有什么新的创作想法吗？',
        createdAt: new Date().toISOString(),
      },
    ]);
  };

  const activeConv = conversations.find((c) => c.id === activeConvId);

  return (
    <div className="flex h-[calc(100vh-10rem)] gap-6">
      {/* Left sidebar - conversation list */}
      <div className="flex w-60 shrink-0 flex-col gap-3">
        <button
          onClick={handleNewChat}
          className="flex items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" />
          新建对话
        </button>

        <div className="flex-1 overflow-y-auto rounded-xl border bg-white shadow-sm">
          <div className="p-2">
            <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
              我的对话
            </div>
            {conversations.map((conv) => (
              <button
                key={conv.id}
                onClick={() => setActiveConvId(conv.id)}
                className={`mb-1 flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm transition-colors ${
                  activeConvId === conv.id
                    ? 'bg-primary/10 text-primary'
                    : 'text-foreground hover:bg-muted/50'
                }`}
              >
                <MessageSquare className="h-4 w-4 shrink-0" />
                <span className="truncate font-medium">{conv.name}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Tips card */}
        <div className="rounded-xl border bg-gradient-to-br from-primary/5 to-[#FF7A3A]/5 p-4 shadow-sm">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <span className="text-sm font-semibold text-foreground">
              创作小贴士
            </span>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            试试问我：「帮我设计一个都市悬疑短剧的开头」或「给我一些角色设定建议」
          </p>
        </div>
      </div>

      {/* Right - chat area */}
      <div className="flex flex-1 flex-col overflow-hidden rounded-xl border bg-white shadow-sm">
        {/* Chat header */}
        <div className="flex items-center gap-3 border-b px-6 py-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-primary to-[#FF7A3A] text-white">
            <Bot className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-foreground">
              {activeConv?.name || '一木·YIMU AI 视频创作平台助手'}
            </h2>
            <p className="text-xs text-muted-foreground">
              {activeConv?.description || '你的智能创作伙伴'}
            </p>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-6 py-6">
          <div className="space-y-5">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex items-start gap-3 ${
                  msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'
                }`}
              >
                {/* Avatar */}
                <div
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                    msg.role === 'user'
                      ? 'bg-muted'
                      : 'bg-gradient-to-br from-primary to-[#FF7A3A] text-white'
                  }`}
                >
                  {msg.role === 'user' ? (
                    <User className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <Bot className="h-4 w-4" />
                  )}
                </div>

                {/* Message bubble */}
                <div
                  className={`max-w-[70%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                    msg.role === 'user'
                      ? 'rounded-tr-sm bg-primary text-primary-foreground'
                      : 'rounded-tl-sm bg-muted text-foreground'
                  }`}
                >
                  {msg.content}
                </div>
              </div>
            ))}

            {/* Typing indicator */}
            {isSending && (
              <div className="flex items-start gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-[#FF7A3A] text-white">
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
              className="flex-1 resize-none rounded-xl border border-input bg-white px-4 py-3 text-sm outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20"
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
            AI 生成内容仅供参考，请仔细核对后使用
          </p>
        </div>
      </div>
    </div>
  );
};

export default AiAssistantPage;
