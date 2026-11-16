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
 * 桌面悬浮：Chromium 116+ 支持 Document Picture-in-Picture 时，可把小球投成
 * 系统级置顶小窗（可拖到屏幕任意位置），点它回到主窗口继续对话；
 * Safari/Firefox 无此 API，退化为页内拖拽小球。全平台透明置顶宠物仍需 Tauri 壳。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Grip, MessageCircle, MonitorUp, Send, X } from 'lucide-react';
import { toast } from 'sonner';
import { useStudio } from './StudioShell';

/** Document Picture-in-Picture（Chromium 专有，TS lib 尚未收录） */
type DocPip = {
  requestWindow?: (opts?: { width?: number; height?: number }) => Promise<Window>;
  window?: Window | null;
};

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
  /** 已投到桌面的悬浮小窗（Document PiP） */
  const petWinRef = useRef<Window | null>(null);

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

  /**
   * 把 logo 投成系统级置顶小窗：Document PiP 窗口本身可被用户拖到屏幕任意位置，
   * 点一下聚焦主窗口并展开对话。React 事件不能跨窗口，所以这里用原生 DOM。
   */
  const popPetToDesktop = async () => {
    const dpip = (window as unknown as { documentPictureInPicture?: DocPip })
      .documentPictureInPicture;
    if (!dpip?.requestWindow) {
      toast.error('当前浏览器不支持桌面悬浮窗（需 Chrome / Edge 116+），已保留页内拖拽小球');
      return;
    }
    if (petWinRef.current && !petWinRef.current.closed) {
      petWinRef.current.close();
      petWinRef.current = null;
      return;
    }
    try {
      const w = await dpip.requestWindow({ width: 148, height: 148 });
      petWinRef.current = w;
      const doc = w.document;
      doc.body.innerHTML = '';
      Object.assign(doc.body.style, {
        margin: '0',
        background: 'transparent',
        overflow: 'hidden',
        display: 'grid',
        placeItems: 'center',
        height: '100vh',
        userSelect: 'none',
      });
      const ball = doc.createElement('button');
      ball.type = 'button';
      ball.title = '回到一幕，继续和 AI 对话（可拖到屏幕任意位置）';
      ball.style.cssText = [
        'width:96px',
        'height:96px',
        'border-radius:50%',
        'border:0',
        'cursor:pointer',
        'position:relative',
        'background:radial-gradient(circle at 32% 28%, #ff7a6e 0%, #ff403a 46%, #c81d19 100%)',
        'box-shadow:0 10px 28px rgba(255,64,58,.45), inset 0 -6px 12px rgba(0,0,0,.18)',
        'color:#fff',
        'font:700 15px/1.1 -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif',
        'letter-spacing:.08em',
        'display:grid',
        'place-items:center',
      ].join(';');
      ball.textContent = 'YIMU';
      ball.addEventListener('click', () => {
        try {
          window.focus();
        } catch {
          /* 某些环境禁止 focus，忽略 */
        }
        setOpen(true);
      });
      doc.body.appendChild(ball);
      toast.success('已投到桌面：拖动小窗到任意位置，点它回到对话', { duration: 2600 });
    } catch (e) {
      petWinRef.current = null;
      toast.error(`投到桌面失败：${(e as Error).message || '浏览器拒绝'} `);
    }
  };

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
            <button
              type="button"
              title="投到桌面悬浮窗（Chromium 支持，置顶可拖动）"
              onClick={() => void popPetToDesktop()}
            >
              <MonitorUp size={14} />
            </button>
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
