/**
 * 一木·YIMU AI 视频创作平台 画布 v2 —— 右侧对话助手（小云雀融合）
 * 多会话标签页 / Agent 切换 / @ 引用资产 / 创意助手（热点·爆点·选题·方案）/ 流式 / 落地画布
 */
import { useEffect, useRef, useState } from 'react';
import { Send, Plus, X, MessageCircle, Sparkles, Trash2 } from 'lucide-react';
import { PAVO_C } from './pavoTypes';

export interface ChatMsg { role: 'user' | 'agent'; agent?: string; text: string; }
export interface ChatSession { id: string; title: string; messages: ChatMsg[]; }

const AGENTS_CHAT = [
  { key: 'director', emoji: '🎬', name: '导演', desc: '镜头·节奏·成片' },
  { key: 'script', emoji: '📜', name: '编剧', desc: '剧情·对白·分集' },
  { key: 'artist', emoji: '🎨', name: '美术', desc: '角色·场景·风格' },
  { key: 'qc', emoji: '🔍', name: '质检', desc: '一致性·音画' },
];

interface Props {
  contextLabel: string | null;
  referable: Array<{ id: string; title: string; emoji: string }>;
  onSend: (agentName: string, instruction: string) => Promise<string>;
  onApplyNode: (text: string, kind?: string) => void;
}

const CREATIVE_AGENTS = [
  { id: 'hotspot', label: '热点检索', emoji: '🔥' },
  { id: 'bomb', label: '爆点解析', emoji: '💥' },
  { id: 'topic', label: '选题推荐', emoji: '🎯' },
  { id: 'plan', label: '方案输出', emoji: '🧭' },
];

const PavoChatPanel = ({ contextLabel, referable, onSend, onApplyNode }: Props) => {
  const [open, setOpen] = useState(false);
  const [sessions, setSessions] = useState<ChatSession[]>([
    { id: 's1', title: '会话 1', messages: [{ role: 'agent', agent: '导演', text: '你好，我是画布 AI 助手。选中节点或双击添加节点后，我可以帮你生成、改写、编排。输入 @ 可引用画布资产。' }] },
  ]);
  const [activeId, setActiveId] = useState('s1');
  const [input, setInput] = useState('');
  const [activeAgent, setActiveAgent] = useState('director');
  const [loading, setLoading] = useState(false);
  const [typing, setTyping] = useState(false);
  const [streamed, setStreamed] = useState('');
  const [showRefs, setShowRefs] = useState(false);
  const [showCreative, setShowCreative] = useState(false);
  // P0 修复：打字机全文存 ref，effect 只依赖 typing/typingSeq；
  // 之前 effect 依赖 streamed，每次 setStreamed 截断后重跑并把截断前缀当全文，长回复只剩前几个字
  const fullRef = useRef('');
  const targetSessionRef = useRef(activeId);
  const targetAgentRef = useRef('导演');
  const [typingSeq, setTypingSeq] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const active = AGENTS_CHAT.find((a) => a.key === activeAgent) || AGENTS_CHAT[0];
  const session = sessions.find((s) => s.id === activeId) || sessions[0];

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [sessions, activeId, streamed, typing]);

  useEffect(() => {
    if (!typing) return;
    const full = fullRef.current;
    if (!full) { setTyping(false); return; }
    let i = 0;
    const t = setInterval(() => {
      i += 3;
      if (i >= full.length) {
        clearInterval(t);
        // P0 修复：打字完成后把完整回复落入会话，否则气泡消失、回复丢失
        pushMsg(targetSessionRef.current, { role: 'agent', agent: targetAgentRef.current, text: full });
        fullRef.current = '';
        setStreamed('');
        setTyping(false);
      }
      else setStreamed(full.slice(0, i));
    }, 12);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typing, typingSeq]);

  const pushMsg = (sid: string, msg: ChatMsg) => {
    setSessions((ss) => ss.map((s) => (s.id === sid ? { ...s, messages: [...s.messages, msg] } : s)));
  };

  const send = async (text: string) => {
    if (!text.trim() || loading) return;
    pushMsg(activeId, { role: 'user', text: text.trim() });
    setInput('');
    setLoading(true); setStreamed(''); setTyping(false);
    try {
      const reply = await onSend(active.name, text.trim());
      fullRef.current = reply;
      targetSessionRef.current = activeId;
      targetAgentRef.current = active.name;
      setStreamed('');
      setTypingSeq((n) => n + 1);
      setTyping(true);
    } catch (e) {
      // P0 修复：失败时给明确提示并结束 typing，之前会卡在空白闪烁气泡
      pushMsg(activeId, { role: 'agent', agent: active.name, text: `请求失败：${(e as Error)?.message || '未知错误'}，请稍后重试。` });
      setTyping(false);
    } finally { setLoading(false); }
  };

  const newSession = () => {
    const id = `s${Date.now()}`;
    setSessions((ss) => [...ss, { id, title: `会话 ${ss.length + 1}`, messages: [{ role: 'agent', agent: '导演', text: '新会话已开启。选节点或双击加节点开始创作。' }] }]);
    setActiveId(id);
  };

  const creativeAct = (id: string) => {
    const prompts: Record<string, string> = {
      hotspot: '🔥 热点检索：帮我看一眼最近 7 天抖音爆款短剧的题材热点',
      bomb: '💥 爆点解析：拆解一部爆款短剧的开场钩子和反转结构',
      topic: '🎯 选题推荐：给 3 个适合新手入局的短剧选题',
      plan: '🧭 方案输出：把上面思路整理成一部短剧的完整创作方案',
    };
    send(prompts[id]);
  };

  return (
    <>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{ position: 'fixed', right: 16, bottom: 78, zIndex: 210, width: 46, height: 46, borderRadius: '50%', background: PAVO_C.primary, color: '#fff', border: 'none', cursor: 'pointer', boxShadow: '0 6px 20px rgba(31,169,126,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        title={open ? '收起对话' : '打开对话助手'}
      >
        {open ? <X size={20} /> : <MessageCircle size={20} />}
      </button>

      {open && (
        <div data-yimu-panel style={{ position: 'fixed', top: 12, right: 12, bottom: 12, zIndex: 300, width: 372, display: 'flex', flexDirection: 'column', background: PAVO_C.panel, borderRadius: 14, border: `1px solid ${PAVO_C.border}`, boxShadow: '0 10px 40px rgba(15,45,35,0.14)', fontFamily: "'Roboto','PingFang SC','Segoe UI',Arial,sans-serif", overflow: 'hidden' }}>
          {/* 会话 Tab */}
          <div style={{ padding: '8px 10px 0', display: 'flex', alignItems: 'center', gap: 5, borderBottom: `1px solid ${PAVO_C.borderSoft}`, flexShrink: 0 }}>
            {sessions.map((s) => (
              <button key={s.id} onClick={() => setActiveId(s.id)} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '5px 10px', borderRadius: '8px 8px 0 0', cursor: 'pointer', fontSize: 10.5, background: s.id === activeId ? PAVO_C.primarySoft : '#fff', color: s.id === activeId ? PAVO_C.primaryDeep : '#6B7A74', border: 'none', borderBottom: s.id === activeId ? `2px solid ${PAVO_C.primary}` : '2px solid transparent', fontWeight: 600 }}>
                {s.title}
              </button>
            ))}
            <button onClick={newSession} title="新建会话" style={{ marginLeft: 'auto', border: 'none', background: 'none', cursor: 'pointer', color: PAVO_C.primary, padding: 4 }}><Plus size={14} /></button>
          </div>

          {/* Agent 切换 */}
          <div style={{ padding: '7px 10px 4px', display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 5, flexShrink: 0 }}>
            {AGENTS_CHAT.map((a) => (
              <button key={a.key} onClick={() => setActiveAgent(a.key)} title={a.desc} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, padding: '4px 2px', borderRadius: 8, cursor: 'pointer', background: a.key === activeAgent ? PAVO_C.primarySoft : '#fff', border: a.key === activeAgent ? `1px solid rgba(31,169,126,0.3)` : `1px solid ${PAVO_C.borderSoft}` }}>
                <span style={{ fontSize: 14 }}>{a.emoji}</span>
                <span style={{ fontSize: 8.5, color: a.key === activeAgent ? PAVO_C.primaryDeep : '#5E6B65' }}>{a.name}</span>
              </button>
            ))}
          </div>

          {/* 上下文 */}
          <div style={{ padding: '5px 12px' }}>
            <div style={{ padding: '4px 9px', borderRadius: 8, fontSize: 9.5, background: contextLabel ? PAVO_C.primarySoft : '#F3F6F5', color: contextLabel ? PAVO_C.primaryDeep : '#8A948F' }}>
              {contextLabel ? `🎯 已选中：${contextLabel}` : '未选中节点 · 指令作用于整幅画布'}
            </div>
          </div>

          {/* 创意助手 */}
          <div style={{ padding: '0 12px 4px', display: 'flex', flexWrap: 'wrap', gap: 4, flexShrink: 0 }}>
            <button onClick={() => setShowCreative((s) => !s)} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 8px', borderRadius: 7, cursor: 'pointer', background: '#fff', border: `1px solid ${PAVO_C.border}`, fontSize: 9.5, color: '#3E4944' }}><Sparkles size={10} color={PAVO_C.primary} /> 创意助手</button>
          </div>
          {showCreative && (
            <div style={{ padding: '0 12px 6px', display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 4, flexShrink: 0 }}>
              {CREATIVE_AGENTS.map((c) => (
                <button key={c.id} onClick={() => creativeAct(c.id)} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 8px', borderRadius: 8, cursor: 'pointer', background: PAVO_C.primarySoft, border: 'none', fontSize: 9.5, color: PAVO_C.primaryDeep }}>{c.emoji} {c.label}</button>
              ))}
            </div>
          )}

          {/* 消息 */}
          <div ref={listRef} style={{ flex: 1, overflowY: 'auto', padding: '6px 12px', display: 'flex', flexDirection: 'column', gap: 8, minHeight: 0 }}>
            {session.messages.map((m, i) => (
              <div key={i} style={{ display: 'flex', gap: 6, flexDirection: m.role === 'user' ? 'row-reverse' : 'row' }}>
                <span style={{ width: 23, height: 23, borderRadius: '50%', background: m.role === 'user' ? PAVO_C.primary : PAVO_C.primarySoft, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, flexShrink: 0 }}>{m.role === 'user' ? '🧑' : '🤖'}</span>
                <div style={{ maxWidth: '84%', padding: '7px 10px', borderRadius: 10, fontSize: 10.5, lineHeight: 1.65, whiteSpace: 'pre-wrap', wordBreak: 'break-word', background: m.role === 'user' ? PAVO_C.primarySoft : '#fff', border: m.role === 'user' ? 'none' : `1px solid ${PAVO_C.borderSoft}`, color: '#33403A' }}>
                  {m.role === 'agent' && m.agent && <div style={{ fontSize: 9, color: PAVO_C.primaryDeep, fontWeight: 700, marginBottom: 2 }}>{m.agent}</div>}
                  {m.text}
                </div>
              </div>
            ))}
            {typing && (
              <div style={{ display: 'flex', gap: 6 }}>
                <span style={{ width: 23, height: 23, borderRadius: '50%', background: PAVO_C.primarySoft, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11 }}>🤖</span>
                <div style={{ maxWidth: '84%', padding: '7px 10px', borderRadius: 10, fontSize: 10.5, lineHeight: 1.65, whiteSpace: 'pre-wrap', background: '#fff', border: `1px solid ${PAVO_C.borderSoft}`, color: '#33403A' }}>
                  <div style={{ fontSize: 9, color: PAVO_C.primaryDeep, fontWeight: 700, marginBottom: 2 }}>{active.name}</div>
                  {streamed}
                  <span style={{ display: 'inline-block', width: 6, height: 12, background: PAVO_C.primary, marginLeft: 2, animation: 'yimuBlink 0.8s step-end infinite' }} />
                </div>
              </div>
            )}
            {loading && !typing && (
              <div style={{ padding: '7px 10px', fontSize: 10.5, color: '#8A948F', display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 10, height: 10, borderRadius: '50%', border: `2px solid rgba(31,169,126,0.3)`, borderTopColor: PAVO_C.primary, animation: 'yimuSpin 0.8s linear infinite', display: 'inline-block' }} /> 思考中…
              </div>
            )}
            {!typing && !loading && session.messages.length > 1 && (
              <div style={{ textAlign: 'right' }}>
                <button onClick={() => onApplyNode(streamed || session.messages[session.messages.length - 1].text)} style={{ fontSize: 9, padding: '3px 9px', borderRadius: 6, background: PAVO_C.primary, color: '#fff', border: 'none', cursor: 'pointer' }}>
                  📌 落地为画布节点
                </button>
              </div>
            )}
          </div>

          {/* 输入 + @ 引用 */}
          <div style={{ padding: '6px 12px 10px', borderTop: `1px solid ${PAVO_C.borderSoft}`, flexShrink: 0 }}>
            {showRefs && (
              <div style={{ marginBottom: 6, maxHeight: 120, overflowY: 'auto', border: `1px solid ${PAVO_C.borderSoft}`, borderRadius: 9, padding: 5 }}>
                {referable.length === 0 && <div style={{ fontSize: 9.5, color: '#8A948F', padding: 5 }}>暂无资产节点</div>}
                {referable.map((r) => (
                  <button key={r.id} onClick={() => { setInput((v) => `${v}@${r.title} `); setShowRefs(false); }} style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', padding: '4px 7px', borderRadius: 7, cursor: 'pointer', background: '#fff', border: 'none', fontSize: 10, color: '#3E4944', textAlign: 'left' }}>
                    <span>{r.emoji}</span><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.title}</span>
                  </button>
                ))}
              </div>
            )}
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={() => setShowRefs((s) => !s)} title="@ 引用资产" style={{ width: 32, height: 32, borderRadius: 9, cursor: 'pointer', background: '#fff', border: `1px solid ${PAVO_C.border}`, color: PAVO_C.primary, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700 }}>@</button>
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') send(input); }}
                placeholder={`和${active.name}对话，@ 引用资产…`}
                style={{ flex: 1, padding: '7px 10px', borderRadius: 9, fontSize: 11, border: `1px solid ${PAVO_C.border}`, outline: 'none', background: '#FAFCFB' }}
              />
              <button onClick={() => send(input)} disabled={loading} style={{ width: 32, height: 32, borderRadius: 9, background: PAVO_C.primary, color: '#fff', border: 'none', cursor: loading ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Send size={13} /></button>
            </div>
            <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 6, fontSize: 9, color: '#9AA4A0' }}>
              <Sparkles size={9} /> 演示模式 · 阶段四接入三通道 API
              <div style={{ flex: 1 }} />
              <button onClick={() => setSessions((ss) => ss.map((s) => (s.id === activeId ? { ...s, messages: [s.messages[0]] } : s)))} title="清空本会话" style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#9AA4A0' }}><Trash2 size={11} /></button>
            </div>
          </div>
        </div>
      )}
      <style>{`@keyframes yimuBlink { 50% { opacity: 0 } }`}</style>
    </>
  );
};

export default PavoChatPanel;
