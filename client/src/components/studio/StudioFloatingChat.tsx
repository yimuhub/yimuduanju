/**
 * 全功能编辑模式 · 浮动对话桌宠
 * -------------------------------------------------------------
 * 进入「全功能编辑」后，中舞台的对话区取消，对话收进这个可拖拽的小球：
 *   · 小球默认停在项目列表右上角，鼠标拖动可放到屏幕任意位置（位置存 localStorage，刷新不丢）；
 *   · 点小球展开一个轻量对话窗，复用 StudioShell context 里的 chatMsgs / sendChat
 *     —— 与常规对话是同一个会话、同一条网关，消息不分裂；
 *   · 对话里 Agent 对时间线的剪辑：Agent 返回结构化 ops，TimelineOpsCard 在浮窗里
 *     给出 diff 预览，点「应用」才落库，可撤销；不是只给文字建议。
 *
 * 桌面悬浮：Chromium 116+ 支持 Document Picture-in-Picture 时，可把小球投成
 * 系统级置顶小窗（可拖到屏幕任意位置），点它回到主窗口继续对话；
 * Safari/Firefox 无此 API，退化为页内拖拽小球。全平台透明置顶宠物仍需 Tauri 壳。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Grip, MessageCircle, MonitorUp, Send, X } from 'lucide-react';
import { toast } from 'sonner';
import { useStudio } from './StudioShell';
import { ChatTurns } from './chat/ChatTurns';
import { AGENT_AUTONOMY_DESC, AGENT_AUTONOMY_KEY, AGENT_AUTONOMY_LABEL, readAgentAutonomy, type AgentAutonomy } from '@client/src/lib/agent-autonomy';

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

const ORB_SIZE = 46;
const WIN_W = 380;

/**
 * 小球/浮窗都挂在右下角（right:24 / bottom:76）再用 translate 位移。
 * 这里把「视觉上必须完整留在视口内」换算成 translate 的合法区间：
 * 关闭时只保证 46px 小球可见，打开时保证 380×560 的浮窗可见。
 */
const clampPos = (p: Pos, open: boolean): Pos => {
  if (typeof window === 'undefined') return p;
  const w = window.innerWidth;
  const h = window.innerHeight;
  const width = open ? Math.min(WIN_W, w - 16) : ORB_SIZE;
  const height = open ? Math.min(560, h - 110) : ORB_SIZE;
  const baseLeft = w - 24 - width;
  const baseTop = h - 76 - height;
  const minX = 8 - baseLeft;
  const minY = 8 - baseTop;
  const maxX = 16; // (w-8-width) - baseLeft
  const maxY = 68; // (h-8-height) - baseTop
  return {
    x: Math.min(Math.max(maxX, minX), Math.max(minX, Math.min(maxX, p.x))),
    y: Math.min(Math.max(maxY, minY), Math.max(minY, Math.min(maxY, p.y))),
  };
};

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
  const [autonomy, setAutonomy] = useState<AgentAutonomy>(readAgentAutonomy);
  const [draft, setDraft] = useState('');
  const dragRef = useRef<{ sx: number; sy: number; ox: number; oy: number; moved: boolean } | null>(
    null,
  );
  /** 拖拽结束后抑制一次 click，避免「拖完顺手打开/关闭」 */
  const suppressClickRef = useRef(false);
  /** 已投到桌面的悬浮小窗（Document PiP） */
  const petWinRef = useRef<Window | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(AGENT_AUTONOMY_KEY, autonomy);
    } catch {
      /* 忽略 */
    }
  }, [autonomy]);

  useEffect(() => {
    try {
      localStorage.setItem(POS_KEY, JSON.stringify(pos));
    } catch {
      /* 忽略 */
    }
  }, [pos]);

  const onGripDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragRef.current = { sx: e.clientX, sy: e.clientY, ox: pos.x, oy: pos.y, moved: false };
      suppressClickRef.current = false;
      const move = (ev: PointerEvent) => {
        const d = dragRef.current;
        if (!d) return;
        const dx = ev.clientX - d.sx;
        const dy = ev.clientY - d.sy;
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) d.moved = true;
        if (!d.moved) return;
        suppressClickRef.current = true;
        setPos(clampPos({ x: d.ox + dx, y: d.oy + dy }, open));
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', up);
        dragRef.current = null;
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
    },
    [pos, open],
  );

  /** 打开/收起时把浮窗也夹回屏幕内，避免从边角展开后跑出可视区 */
  const setChatOpen = useCallback((next: boolean) => {
    setOpen(next);
    setPos((p) => clampPos(p, next));
  }, []);

  useEffect(() => {
    const onResize = () => setPos((p) => clampPos(p, open));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [open]);

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
            <button type="button" title="收起" onClick={() => setChatOpen(false)}>
              <X size={14} />
            </button>
          </div>
          <div className="pro-chat-thread">
            <ChatTurns
              msgs={chatMsgs}
              busy={chatBusy}
              autonomy={autonomy}
              empty={
                <div className="pro-chat-empty">
                  继续和 AI 对话。它可以读取项目镜头/素材，也能直接改时间线；
                  执行权限可在下方切换，完全授权时会直接执行合法提案，⌘Z 可整体撤销。
                </div>
              }
            />
          </div>
          <div className="pro-chat-auth" title={AGENT_AUTONOMY_DESC[autonomy]}>
            <span>执行权限</span>
            <select
              aria-label="Agent 时间线执行权限"
              value={autonomy}
              onChange={(e) => setAutonomy(e.target.value as AgentAutonomy)}
            >
              {(['ask', 'reduced', 'full'] as const).map((v) => (
                <option key={v} value={v}>{AGENT_AUTONOMY_LABEL[v]}</option>
              ))}
            </select>
            <small>{autonomy === 'full' ? '直接执行' : autonomy === 'reduced' ? '低风险直执' : '先确认'}</small>
          </div>
          <div className="pro-chat-quick" aria-label="深度剪辑快捷指令">
            {[
              '把当前时间线剪成 1 分钟宣传片：通读全部对白，选开场钩子、核心信息、情绪高点、结尾，直接给粗剪方案',
              '通读全部素材，剪一个 30 秒高光版，不要只取开头',
              '删掉所有空白和语气词，把节奏压紧',
            ].map((q) => (
              <button
                key={q}
                type="button"
                disabled={chatBusy}
                onClick={() => void sendChat(q)}
                title={q}
              >
                {q.startsWith('把当前时间线') ? '1 分钟宣传片' : q.startsWith('通读全部素材') ? '30 秒高光' : '压紧节奏'}
              </button>
            ))}
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
              placeholder="例：删掉空白片段 / 每段加 0.3 秒淡入 / 压到 30 秒…"
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
          className={`pro-chat-orb${chatBusy ? ' is-active' : ''}`}
          title="AI 剪辑助手：可在整个屏幕任意拖动；点击继续对话"
          aria-label="AI 剪辑助手，可拖动"
          onPointerDown={onGripDown}
          onClick={() => {
            if (suppressClickRef.current) {
              suppressClickRef.current = false;
              return;
            }
            setChatOpen(true);
          }}
        >
          <MessageCircle size={20} />
          {chatBusy ? <i className="pro-chat-dot" /> : null}
        </button>
      )}
    </div>
  );
};
