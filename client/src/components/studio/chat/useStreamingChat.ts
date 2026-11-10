import { useCallback, useRef, useState } from 'react';
import type { ChatMessage } from '@shared/api.interface';
import { streamChatSession } from '@client/src/api/chat';
import type { PendingAttachment } from './ChatComposer';

/**
 * 流式对话状态机：乐观用户消息 → 逐字增长 → 服务端最终消息替换占位。
 * 中止后保留已生成内容；服务端同样保留部分结果，刷新后仍可追溯。
 */
export function useStreamingChat() {
  const [msgs, setMsgs] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  const reset = useCallback((next: ChatMessage[] = []) => {
    abortRef.current?.abort();
    abortRef.current = null;
    busyRef.current = false;
    setBusy(false);
    setMsgs(next);
  }, []);

  const setMessages = useCallback((next: ChatMessage[]) => setMsgs(next), []);

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const send = useCallback(
    async (sessionId: string, text: string, attachments: PendingAttachment[] = []) => {
      const content = text.trim();
      if ((!content && attachments.length === 0) || busyRef.current) return;
      const now = new Date().toISOString();
      const tempUserId = `tmp-u-${Date.now()}`;
      const agentId = `tmp-a-${Date.now()}`;
      const optimisticUser: ChatMessage = {
        id: tempUserId,
        sessionId,
        role: 'user',
        content:
          content ||
          `（已上传附件：${attachments.map((a) => a.name).join('、')}）`,
        attachments: attachments.map((a) => ({
          name: a.name,
          size: a.size,
          chars: a.text?.length ?? 0,
        })),
        createdAt: now,
      };
      const placeholder: ChatMessage = {
        id: agentId,
        sessionId,
        role: 'agent',
        content: '',
        attachments: [],
        createdAt: now,
      };
      busyRef.current = true;
      setBusy(true);
      setMsgs((m) => [...m, optimisticUser, placeholder]);
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        await streamChatSession(
          sessionId,
          { message: content, attachments },
          {
            onUser: (msg) =>
              setMsgs((m) => m.map((x) => (x.id === tempUserId ? msg : x))),
            onDelta: (delta) =>
              setMsgs((m) =>
                m.map((x) => (x.id === agentId ? { ...x, content: x.content + delta } : x)),
              ),
            onDone: (msg) => setMsgs((m) => m.map((x) => (x.id === agentId ? msg : x))),
            onError: (err) =>
              setMsgs((m) =>
                m.map((x) =>
                  x.id === agentId ? { ...x, content: `回复失败：${err}` } : x,
                ),
              ),
          },
          controller.signal,
        );
      } catch (e) {
        if ((e as { name?: string } | null)?.name !== 'AbortError') {
          const message = `请求失败：${(e as Error).message}`;
          setMsgs((m) =>
            m.map((x) =>
              x.id === agentId && !x.content ? { ...x, content: message } : x,
            ),
          );
        }
      } finally {
        busyRef.current = false;
        setBusy(false);
        abortRef.current = null;
      }
    },
    [],
  );

  return { msgs, busy, send, stop, reset, setMessages };
}