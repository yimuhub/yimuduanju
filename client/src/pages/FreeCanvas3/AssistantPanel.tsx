/**
 * 自由画布 · AI 对话助手面板（对话助手产品能力以 pavo3 架构重实现）
 * 单会话 + 本地历史 / 四工种人设 / @ 引用画布节点 / 回复一键落为画布节点
 */
import React, { useEffect, useRef, useState } from 'react';
import { MessageCircle, Send, Sparkles, Trash2, X, Pin } from 'lucide-react';
import { useReactFlow } from '@xyflow/react';
import { useP3Store } from './pavo3Store';
import { assistant } from '@client/src/api';
import { NODE_COLORS, P3 } from './pavo3Constants';

/** 工种人设（指令自动带上视角前缀，引导模型进入对应专业语境） */
const AGENTS = [
  { key: 'director', emoji: '🎬', name: '导演', desc: '镜头·节奏·成片' },
  { key: 'script', emoji: '📜', name: '编剧', desc: '剧情·对白·分集' },
  { key: 'artist', emoji: '🎨', name: '美术', desc: '角色·场景·风格' },
  { key: 'qc', emoji: '🔍', name: '质检', desc: '一致性·音画' },
] as const;

interface ChatMsg {
  role: 'user' | 'agent';
  agent?: string;
  text: string;
}

interface Props {
  /** 项目 id（历史按项目分存；空为默认键） */
  projectId?: string;
}

const WELCOME: ChatMsg = {
  role: 'agent',
  agent: '导演',
  text: '你好，我是自由画布 AI 助手。可以选择工种（导演/编剧/美术/质检）提问，@ 可引用画布节点，回复可一键「落地为画布节点」。',
};

export const AssistantPanel = ({ projectId }: Props) => {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMsg[]>([WELCOME]);
  const [input, setInput] = useState('');
  const [agent, setAgent] = useState<string>('director');
  const [loading, setLoading] = useState(false);
  const [showRefs, setShowRefs] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const { screenToFlowPosition } = useReactFlow();

  const nodes = useP3Store((s) => s.nodes);
  const persistKey = `yimu-free3-chat-${projectId ?? 'default'}`;

  /* 本地历史（单会话 + 持久化） */
  useEffect(() => {
    try {
      const raw = localStorage.getItem(persistKey);
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr) && arr.length) setMessages(arr);
      }
    } catch {
      /* 损坏数据忽略 */
    }
  }, [persistKey]);

  useEffect(() => {
    try {
      localStorage.setItem(persistKey, JSON.stringify(messages));
    } catch {
      /* 容量不足忽略 */
    }
  }, [messages, persistKey]);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages, loading]);

  const activeAgent = AGENTS.find((a) => a.key === agent) ?? AGENTS[0];

  const send = async (raw: string) => {
    const text = raw.trim();
    if (!text || loading) return;
    const userMsg: ChatMsg = { role: 'user', text };
    setMessages((m) => [...m, userMsg]);
    setInput('');
    setLoading(true);
    try {
      // 画布上下文：引用的节点标题 + 全部节点摘要（截断防超长）
      const mentioned = nodes
        .filter((n) => text.includes(`@${n.data.title}`) || text.includes(n.data.title))
        .slice(0, 6)
        .map((n) => `「${n.data.title}」(${n.data.nodeType})：${(n.data.markdown || n.data.profile || '').slice(0, 160)}`);
      const canvasBrief = nodes.length
        ? `\n\n[画布上下文] 当前画布有 ${nodes.length} 个节点：${nodes.slice(0, 12).map((n) => n.data.title).join('、')}`
        : '';
      const refBlock = mentioned.length ? `\n\n[引用节点]\n${mentioned.join('\n')}` : '';
      const res = await assistant.chat(`【${activeAgent.name}视角 · 短剧创作】${text}${refBlock}${canvasBrief}`);
      setMessages((m) => [...m, { role: 'agent', agent: activeAgent.name, text: res.reply || '（空回复）' }]);
    } catch (e) {
      setMessages((m) => [
        ...m,
        { role: 'agent', agent: activeAgent.name, text: `请求失败：${(e as Error)?.message || '未知错误'}，请稍后重试。` },
      ]);
    } finally {
      setLoading(false);
    }
  };

  /** 回复落地为画布文本节点（核心价值：对话产出直接进画布） */
  const applyLastToCanvas = () => {
    const last = [...messages].reverse().find((m) => m.role === 'agent');
    if (!last || last === messages[0]) return;
    const st = useP3Store.getState();
    const flowPos = screenToFlowPosition({
      x: window.innerWidth - 460,
      y: Math.round(window.innerHeight / 2),
    });
    st.createNode('text', { x: flowPos.x - 140, y: flowPos.y - 80 }, { autoOpen: false });
    const created = useP3Store.getState().nodes[useP3Store.getState().nodes.length - 1];
    if (created) {
      st.updateNodeData(created.id, {
        title: `助手落地 · ${activeAgent.name}`,
        markdown: last.text,
        richText: last.text,
        status: 'done',
        progress: 100,
      });
    }
  };

  const lastAgentMsg = [...messages].reverse().find((m) => m.role === 'agent');

  return (
    <>
      {/* 悬浮开关（右下，避开 Controls / MiniMap） */}
      <button
        onClick={() => setOpen((o) => !o)}
        title={open ? '收起 AI 助手' : '打开 AI 助手'}
        style={{
          position: 'fixed', right: 16, bottom: 88, zIndex: 260,
          width: 46, height: 46, borderRadius: '50%',
          background: P3.primary, color: '#fff', border: 'none', cursor: 'pointer',
          boxShadow: '0 6px 20px rgba(10,188,207,0.4)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        {open ? <X size={20} /> : <MessageCircle size={20} />}
      </button>

      {open && (
        <div
          data-yimu-panel
          style={{
            position: 'fixed', top: 12, right: 12, bottom: 12, zIndex: 300, width: 372,
            display: 'flex', flexDirection: 'column', background: '#fff',
            borderRadius: 14, border: `1px solid ${P3.border}`,
            boxShadow: '0 10px 40px rgba(0,0,0,0.14)', overflow: 'hidden',
          }}
        >
          {/* 标题 */}
          <div style={{ padding: '10px 14px 8px', borderBottom: `1px solid ${P3.border}`, display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
            <Sparkles size={15} color={P3.primary} />
            <span style={{ fontSize: 14, fontWeight: 600, color: P3.text }}>画布 AI 助手</span>
            <div style={{ flex: 1 }} />
            <button
              title="清空会话"
              onClick={() => setMessages([WELCOME])}
              style={{ border: 'none', background: 'none', cursor: 'pointer', color: P3.weak, padding: 4 }}
            >
              <Trash2 size={14} />
            </button>
            <button title="收起" onClick={() => setOpen(false)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: P3.weak, padding: 4 }}>
              <X size={16} />
            </button>
          </div>

          {/* 工种切换 */}
          <div style={{ padding: '8px 10px 4px', display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 5, flexShrink: 0 }}>
            {AGENTS.map((a) => (
              <button
                key={a.key}
                onClick={() => setAgent(a.key)}
                title={a.desc}
                style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
                  padding: '5px 2px', borderRadius: 8, cursor: 'pointer',
                  background: a.key === agent ? 'rgba(10,188,207,0.1)' : '#fff',
                  border: a.key === agent ? `1px solid rgba(10,188,207,0.4)` : `1px solid ${P3.border}`,
                  fontSize: 11, color: a.key === agent ? P3.primary : P3.helper,
                }}
              >
                <span style={{ fontSize: 14 }}>{a.emoji}</span>
                {a.name}
              </button>
            ))}
          </div>

          {/* 消息列表 */}
          <div ref={listRef} style={{ flex: 1, overflowY: 'auto', padding: '8px 14px', display: 'flex', flexDirection: 'column', gap: 8, minHeight: 0 }}>
            {messages.map((m, i) => (
              <div key={i} style={{ display: 'flex', gap: 6, flexDirection: m.role === 'user' ? 'row-reverse' : 'row' }}>
                <span style={{ width: 24, height: 24, borderRadius: '50%', background: m.role === 'user' ? P3.primary : 'rgba(10,188,207,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, flexShrink: 0 }}>
                  {m.role === 'user' ? '🧑' : '🤖'}
                </span>
                <div
                  style={{
                    maxWidth: '84%', padding: '7px 10px', borderRadius: 10,
                    fontSize: 12, lineHeight: 1.65, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                    background: m.role === 'user' ? 'rgba(10,188,207,0.1)' : '#fff',
                    border: `1px solid ${m.role === 'user' ? 'transparent' : P3.border}`,
                    color: P3.text,
                  }}
                >
                  {m.role === 'agent' && m.agent && (
                    <div style={{ fontSize: 10, color: P3.primary, fontWeight: 700, marginBottom: 2 }}>{m.agent}</div>
                  )}
                  {m.text}
                </div>
              </div>
            ))}
            {loading && (
              <div style={{ padding: '6px 10px', fontSize: 12, color: P3.helper, display: 'flex', alignItems: 'center', gap: 6 }}>
                <span
                  style={{
                    width: 12, height: 12, borderRadius: '50%',
                    border: '2px solid rgba(10,188,207,0.3)', borderTopColor: P3.primary,
                    animation: 'p3spin 0.8s linear infinite', display: 'inline-block',
                  }}
                />
                思考中…
              </div>
            )}
            {!loading && lastAgentMsg && messages.indexOf(lastAgentMsg) > 0 && (
              <div style={{ textAlign: 'right' }}>
                <button
                  onClick={applyLastToCanvas}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    fontSize: 11, padding: '4px 10px', borderRadius: 7,
                    background: P3.primary, color: '#fff', border: 'none', cursor: 'pointer',
                  }}
                >
                  <Pin size={11} /> 落地为画布节点
                </button>
              </div>
            )}
          </div>

          {/* @ 引用面板 */}
          {showRefs && (
            <div style={{ margin: '0 14px 6px', maxHeight: 140, overflowY: 'auto', border: `1px solid ${P3.border}`, borderRadius: 9, padding: 5, flexShrink: 0 }}>
              {nodes.length === 0 && <div style={{ fontSize: 11, color: P3.weak, padding: 5 }}>画布暂无节点</div>}
              {nodes.map((n) => (
                <button
                  key={n.id}
                  onClick={() => {
                    setInput((v) => `${v}@${n.data.title} `);
                    setShowRefs(false);
                  }}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', padding: '4px 7px', borderRadius: 7, cursor: 'pointer', background: '#fff', border: 'none', fontSize: 12, color: P3.text, textAlign: 'left' }}
                >
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: NODE_COLORS[n.data.nodeType] ?? P3.helper, flexShrink: 0 }} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.data.title}</span>
                </button>
              ))}
            </div>
          )}

          {/* 输入区 */}
          <div style={{ padding: '8px 14px 12px', borderTop: `1px solid ${P3.border}`, flexShrink: 0 }}>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                onClick={() => setShowRefs((s) => !s)}
                title="@ 引用画布节点"
                style={{ width: 32, height: 32, borderRadius: 9, cursor: 'pointer', background: '#fff', border: `1px solid ${P3.border}`, color: P3.primary, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700 }}
              >
                @
              </button>
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.nativeEvent.isComposing) send(input);
                }}
                placeholder={`和${activeAgent.name}对话，@ 引用画布节点…`}
                style={{ flex: 1, padding: '7px 10px', borderRadius: 9, fontSize: 12, border: `1px solid ${P3.border}`, outline: 'none', background: '#FAFAFA', color: P3.text }}
              />
              <button
                onClick={() => send(input)}
                disabled={loading}
                style={{ width: 32, height: 32, borderRadius: 9, background: P3.primary, color: '#fff', border: 'none', cursor: loading ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                <Send size={13} />
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
