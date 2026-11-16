/**
 * 全功能编辑模式 · 浮动对话桌宠
 * -------------------------------------------------------------
 * 进入「全功能编辑」后，中舞台的对话区取消，对话收进这个可拖拽的小球：
 *   · 小球默认停在项目列表右上角，鼠标拖动可放到屏幕任意位置（位置存 localStorage，刷新不丢）；
 *   · 点小球展开一个轻量对话窗，复用 StudioShell context 里的 chatMsgs / sendChat
 *     —— 与常规对话是同一个会话、同一条网关，消息不分裂；
 *   · 对话里 Agent 对时间线的剪辑：当前网关没有 function calling，
 *     所以「说一句话就自动改片」做不到；做成「结构化剪辑指令」——用户描述后，
 *     在对话窗里给出可复制的操作清单，交用户在时间线上手动执行（诚实降级，见方案 §6.3）。
 *
 * 明确不承诺：系统级桌面宠物（脱离浏览器、透明置顶）—— Web 端做不到，需 Tauri 客户端。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Grip, MessageCircle, Send, X } from 'lucide-react';
import { useStudio } from './StudioShell';

const POS_KEY = 'yimu.proChat.pos';

interface Pos {
  x: number;
  y: number;
}

const readPos = (): Pos => {
  try {
    const raw = localStorage.getItem(POS_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Pos;
      if (Number.isFinite(p.x) && Number.isFinite(p.y)) return p;
    }
  } catch {
    /* 隐私模式忽略 */
  }
  return { x: 0, y: 0 }; // 0/0 = 用 CSS 默认右上角
};

export const StudioFloatingChat = () => {
  const { chatMsgs, chatBusy, sendChat, stopChat } = useStudio();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<Pos>(readPos);
  const [draft, setDraft] = useState('');
  const dragRef = useRef<{ sx: number; sy: number; ox: number; oy: number; moved: boolean } | null>(
    null,
  );
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      localStorage.setItem(POS_KEY, JSON.stringify(pos));
    } catch {
      /* 忽略 */
    }
  }, [pos]);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [chatMsgs.length, open]);

  const onGripDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      dragRef.current = { sx: e.clientX, sy: e.clientY, ox: pos.x, oy: pos.y, moved: false };
      const move = (ev: PointerEvent) => {
        const d = dragRef.current;
        if (!d) return;
        const dx = ev.clientX - d.sx;
        const dy = ev.clientY - d.sy;
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) d.moved = true;
        if (!d.moved) return;
        // 夹在视口内：球 44px、窗 340px，都不允许拖出屏幕
        const w = window.innerWidth;
        const h = window.innerHeight;
        const nx = Math.min(w - 60, Math.max(-w + 380, d.ox + dx));
        const ny = Math.min(h - 60, Math.max(-h + 120, d.oy + dy));
        setPos({ x: nx, y: ny });
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        dragRef.current = null;
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    },
    [pos],
  );

  const submit = () => {
    const text = draft.trim();
    if (!text || chatBusy) return;
    setDraft('');
    void sendChat(text);
  };

  return (
    <div className="pro-chat-float" style={{ transform: `translate(${pos.x}px, ${pos.y}px)` }}>
      {open ? (
        <div className="pro-chat-win" onPointerDown={(e) => e.stopPropagation()}>
          <div className="pro-chat-win-head" onPointerDown={onGripDown}>
            <Grip size={13} className="pro-chat-grip" />
            <b>AI 剪辑助手</b>
            <span className="spacer" />
            <button type="button" title="收起" onClick={() => setOpen(false)}>
              <X size={14} />
            </button>
          </div>
          <div className="pro-chat-list" ref={listRef}>
            {chatMsgs.length === 0 ? (
              <div className="empty">继续和 AI 对话。它了解这个项目的镜头与素材。</div>
            ) : (
              chatMsgs.slice(-40).map((m, i) => (
                <div key={m.id ?? i} className={`pro-chat-msg ${m.role}`}>
                  <span className="who">{m.role === 'user' ? '你' : 'AI'}</span>
                  <span className="txt">{m.content}</span>
                </div>
              ))
            )}
            {chatBusy ? <div className="pro-chat-busy">AI 正在回复…</div> : null}
          </div>
          <div className="pro-chat-compose">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                }
              }}
              placeholder="问一句，或说要怎么改…"
              rows={2}
            />
            <button type="button" onClick={submit} disabled={chatBusy || !draft.trim()}>
              <Send size={13} />
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="pro-chat-orb"
          title="展开 AI 剪辑助手（拖动可换位置）"
          onClick={() => {
            if (dragRef.current?.moved) return;
            setOpen(true);
          }}
        >
          <MessageCircle size={20} />
          {chatBusy ? <i className="pro-chat-dot" /> : null}
        </button>
      )}
    </div>
  );
};
