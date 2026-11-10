import { useEffect, useRef } from 'react';
import { Loader2 } from 'lucide-react';
import type { ChatMessage } from '@shared/api.interface';
import { ChatText } from './ChatText';

const when = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
};

interface ChatTurnsProps {
  msgs: ChatMessage[];
  busy: boolean;
  /** 顶部固定内容（阶段确认卡 / 一致性卡 / 生产链进度） */
  header?: React.ReactNode;
  /** 无消息时的开场内容（新建作品弹窗用） */
  empty?: React.ReactNode;
}

/**
 * 对话消息流。所有消息来自服务端（含刷新后的历史）；
 * 生成中最后一条 agent 消息逐字增长，并显示光标。
 */
export const ChatTurns = ({ msgs, busy, header, empty }: ChatTurnsProps) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs, busy]);

  const last = msgs[msgs.length - 1];
  const streaming = busy && last?.role === 'agent';

  return (
    <div className="thread" ref={scrollRef}>
      <div className="thread-in">
        {header}
        {msgs.length === 0 && empty ? <>{empty}</> : null}
        {msgs.map((m, i) => {
          const isLastAgent = streaming && i === msgs.length - 1;
          const thinking = isLastAgent && !m.content;
          return (
            <div key={m.id} className={`turn ${m.role === 'user' ? 'user' : 'agent'}`}>
              <div className="turn-h">
                <span className={`turn-w${m.role === 'agent' ? ' a' : ''}`}>
                  {m.role === 'agent' ? '一幕 Agent' : '你'}
                </span>
                <span className="turn-when">{when(m.createdAt)}</span>
              </div>
              {m.attachments.length > 0 ? (
                <div className="chat-files">
                  {m.attachments.map((a, idx) => (
                    <span key={`${a.name}-${idx}`} className="chat-file">
                      {a.name}
                      {a.chars ? <em>{Math.round(a.chars / 100) / 10}k 字</em> : null}
                    </span>
                  ))}
                </div>
              ) : null}
              <div className="turn-b">
                {thinking ? (
                  <span className="chat-thinking">
                    <Loader2 className="spin" /> 正在思考…
                  </span>
                ) : (
                  <ChatText text={m.content} />
                )}
                {isLastAgent && m.content ? <span className="chat-cursor" /> : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};