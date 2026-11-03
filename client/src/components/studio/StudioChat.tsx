/**
 * Studio · 对话视图（方案 F 舞台）
 * -------------------------------------------------------------
 * 视觉遵循设计稿「C 的排版纪律」：去头像、去气泡，只靠留白与微标签
 * 区分说话人；工具调用折叠成 `.tools` 块；待确认动作摊开成 `.confirm` 卡。
 *
 * 功能全部接真实后端：
 *   · /api/assistant/chat            对话回复
 *   · /api/projects/quick-create     一键开拍（真实建项目 + 起流水线）
 *   · /api/projects/:id/progress      生产链进度（渲染成工具块）
 */
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { chat } from '@client/src/api/assistant';
import { quickCreate } from '@client/src/api/projects';
import type { AspectRatio, ArtStyle, BudgetMode } from '@shared/api.interface';
import { useStudio } from './StudioShell';
import { stateChip } from './model';

interface ChatMsg {
  id: string;
  role: 'user' | 'agent';
  text: string;
  at: string;
  /** 工具调用轨迹（真实进度步骤） */
  steps?: { label: string; state: 'done' | 'run' | 'wait'; detail?: string }[];
}

const QUICK_CHIPS = [
  '一句话创建短剧项目',
  '查看最近的生成任务',
  '给我一个大纲创意',
  '去画布生成图片',
];

const now = () =>
  new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });

export const StudioChat = () => {
  const navigate = useNavigate();
  const { data, projectId } = useStudio();
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [autoMode, setAutoMode] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs, busy]);

  const send = async (text?: string) => {
    const content = (text ?? input).trim();
    if (!content || busy) return;
    setInput('');
    setBusy(true);
    setMsgs((m) => [...m, { id: `u${Date.now()}`, role: 'user', text: content, at: now() }]);
    try {
      const res = await chat(content);
      setMsgs((m) => [
        ...m,
        { id: `a${Date.now()}`, role: 'agent', text: res.reply || '（无回复）', at: now() },
      ]);
    } catch (e) {
      setMsgs((m) => [
        ...m,
        {
          id: `a${Date.now()}`,
          role: 'agent',
          text: `请求失败：${(e as Error).message}`,
          at: now(),
        },
      ]);
    } finally {
      setBusy(false);
    }
  };

  /** 一键开拍：真实创建项目并启动流水线，然后跳到项目工作区 */
  const startProduction = async () => {
    const prompt = input.trim() || msgs.filter((m) => m.role === 'user').pop()?.text || '';
    if (!prompt) {
      toast.error('先描述你想要的短剧');
      return;
    }
    setBusy(true);
    try {
      const res = await quickCreate({
        prompt,
        durationSeconds: 60,
        aspectRatio: '9:16' as AspectRatio,
        artStyle: 'realistic' as ArtStyle,
        budgetMode: 'balanced' as BudgetMode,
      });
      toast.success(`项目已创建，流水线启动中`);
      navigate(`/project/${res.projectId}`);
    } catch (e) {
      toast.error(`开拍失败：${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  /** 生产链进度 → 工具块（真实数据） */
  const progressSteps = (data.progress?.steps ?? []).map((s) => ({
    label: s.stepLabel || s.step,
    state:
      s.status === 'completed'
        ? ('done' as const)
        : s.status === 'running'
          ? ('run' as const)
          : ('wait' as const),
    detail: s.message,
  }));

  return (
    <>
      <div className="thread" ref={scrollRef}>
        <div className="thread-in">
          <div className="daysep">
            <span>{new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })}</span>
          </div>

          {msgs.length === 0 ? (
            <div className="turn agent">
              <div className="turn-h">
                <span className="turn-w a">一幕 Agent</span>
                <span className="turn-when">现在</span>
              </div>
              <div className="turn-b">
                <p>
                  我可以直接把一个想法变成可出片的短剧流水线：<strong>剧本 → 人物场景 → 分镜 → 首帧 → 视频 → 质检 → 成片</strong>。
                </p>
                <p>描述题材和节奏，我会拆成可确认的步骤；花钱的环节会先摊开给你看。</p>
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 14, marginLeft: 15 }}>
                {QUICK_CHIPS.map((c) => (
                  <button key={c} type="button" className="btn" onClick={() => void send(c)}>
                    {c}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {msgs.map((m) => (
            <div key={m.id} className={`turn ${m.role}`}>
              <div className="turn-h">
                <span className={`turn-w${m.role === 'agent' ? ' a' : ''}`}>
                  {m.role === 'agent' ? '一幕 Agent' : '你'}
                </span>
                <span className="turn-when">{m.at}</span>
              </div>
              <div className="turn-b">
                {m.text.split('\n').map((line, i) =>
                  line ? <p key={i}>{line}</p> : <br key={i} />,
                )}
              </div>
            </div>
          ))}

          {/* 生产链进度：真实 steps → 工具块 */}
          {progressSteps.length > 0 ? (
            <div className="tools">
              {progressSteps.map((s, i) => (
                <div key={i} className={`tool${s.state === 'run' ? ' open' : ''}`}>
                  <div className="tool-h">
                    <svg
                      className="tool-car"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.4"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M9 18l6-6-6-6" />
                    </svg>
                    <span className="tool-name">{s.label}</span>
                    <span className="tool-st">
                      {s.state === 'done' ? (
                        <span className="chip ok">完成</span>
                      ) : s.state === 'run' ? (
                        <span className="chip run">运行中</span>
                      ) : (
                        <span className="chip">等待</span>
                      )}
                    </span>
                  </div>
                  {s.detail ? (
                    <div className="tool-body">
                      <div className="tool-log">{s.detail}</div>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}

          {/* 待确认卡：开拍前把花费与范围摊开 */}
          {!projectId && msgs.some((m) => m.role === 'user') ? (
            <div className="confirm">
              <div className="confirm-h">
                <svg
                  className="ico"
                  viewBox="0 0 24 24"
                  style={{ width: 14, height: 14, color: 'var(--brand)' }}
                >
                  <path d="M12 9v4M12 17h.01" />
                  <path d="M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z" />
                </svg>
                <span className="confirm-t">需要你决定 · 开拍参数</span>
              </div>
              <div className="confirm-facts">
                <div className="cf">
                  <span>单集时长</span>
                  <b>60s</b>
                </div>
                <div className="cf">
                  <span>画幅</span>
                  <b>9:16</b>
                </div>
                <div className="cf">
                  <span>预算档</span>
                  <b>均衡</b>
                </div>
              </div>
              <div className="confirm-act">
                <button
                  type="button"
                  className="btn pri"
                  onClick={() => void startProduction()}
                  disabled={busy}
                >
                  确认开拍
                </button>
                <button type="button" className="btn" onClick={() => setInput('')}>
                  改主意
                </button>
                <span className="confirm-note">创建项目并启动流水线</span>
              </div>
            </div>
          ) : null}

          {busy ? (
            <div className="turn-b" style={{ marginTop: 14 }}>
              <span className="caret" />
            </div>
          ) : null}
        </div>
      </div>

      {/* ---------- 输入区 ---------- */}
      <div className="composer">
        <div className="composer-in">
          <div className="cbox">
            <textarea
              rows={1}
              value={input}
              placeholder="描述你想要的镜头、节奏或改动，Agent 会直接执行…"
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  void send();
                }
              }}
            />
            <div className="cbar">
              <button
                type="button"
                className={`ctool${autoMode ? ' on' : ''}`}
                onClick={() => setAutoMode((v) => !v)}
                title="自动模式：Agent 自动决定调用哪些工具"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 3l1.9 5.7L19.5 10l-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.3z" />
                </svg>
                自动模式
              </button>
              <button type="button" className="ctool" onClick={() => navigate('/create')}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" />
                </svg>
                一键创作
              </button>
              <button type="button" className="ctool" onClick={() => navigate('/project/assets')}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="4" width="18" height="16" rx="2" />
                  <path d="M3 9h18" />
                </svg>
                引用镜头
              </button>
              <div className="spacer" />
              <span className="kbd">⌘ ↵</span>
              <button
                type="button"
                className="send"
                onClick={() => void send()}
                disabled={busy}
                aria-label="发送"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 2L11 13M22 2l-7 20-4-9-9-4z" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};
