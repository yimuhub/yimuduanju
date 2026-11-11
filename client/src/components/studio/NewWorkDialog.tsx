/**
 * 新建作品弹窗
 * -------------------------------------------------------------
 * 左上角「新建对话」不再直接建任务：先在这里把方向聊清楚，
 * 对话全程落库并可恢复；点「确认创建」才真正建项目并启动流水线。
 * 创建成功后会话挂到项目上，左侧项目列表出现带作品名的任务。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Loader2, Sparkles, X, ArrowRight } from 'lucide-react';
import { toast } from 'sonner';
import {
  createChatSession,
  getChatSession,
  linkChatSession,
  suggestChatTitle,
  updateChatSessionTitle,
} from '@client/src/api/chat';
import { quickCreate } from '@client/src/api/projects';
import type {
  ArtStyle,
  AspectRatio,
  BudgetMode,
  ChatMessage,
} from '@shared/api.interface';
import { budgetOptions, styleOptions } from '@client/src/pages/CreateWizard/WizardSettings';
import { styleCover, styleFamily } from '@client/src/data/styleCovers';
import { ChatTurns } from './chat/ChatTurns';
import { ChatComposer, type PendingAttachment } from './chat/ChatComposer';
import { useStreamingChat } from './chat/useStreamingChat';

const DURATIONS = [15, 30, 60, 90, 120, 180];

const RATIOS: { value: AspectRatio; label: string; hint: string }[] = [
  { value: '9:16', label: '9:16', hint: '竖屏' },
  { value: '16:9', label: '16:9', hint: '横屏' },
  { value: '3:4', label: '3:4', hint: '竖版' },
  { value: '4:3', label: '4:3', hint: '横版' },
  { value: '1:1', label: '1:1', hint: '方形' },
  { value: '21:9', label: '21:9', hint: '宽银幕' },
];

const clampDuration = (n: number) => Math.min(7200, Math.max(5, Math.round(n) || 5));

/** 从对话里提取取名素材：用户原话优先，附件正文不参与命名 */
const titleSource = (msgs: ChatMessage[], extra?: string) => {
  const parts = msgs
    .filter(
      (m) =>
        m.role === 'user' &&
        m.content.trim() &&
        !m.content.startsWith('（已上传附件：'),
    )
    .map((m) => m.content.trim());
  if (extra?.trim()) parts.push(extra.trim());
  return parts.join('\n').slice(0, 4000);
};

const IDEAS = [
  '做一部 90 秒穿越到唐朝的甜宠短剧，女主是现代甜品师',
  '3 分钟悬疑短剧：雨夜出租车里的乘客身份成谜',
  '30 秒国风广告片，主角是一把会认主的剑',
  '都市职场逆袭，60 秒一集，女主冷静强硬',
];

export interface NewWorkOpenOptions {
  /** 恢复一条草稿会话（首页「最近对话」） */
  sessionId?: string;
  /** 预填一句创意 */
  prompt?: string;
}

interface NewWorkDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated: (projectId: string) => void;
  options?: NewWorkOpenOptions | null;
}

export const NewWorkDialog = ({ open, onClose, onCreated, options }: NewWorkDialogProps) => {
  const { msgs, busy, send, stop, reset, setMessages } = useStreamingChat();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [title, setTitle] = useState('');
  const [titleLoading, setTitleLoading] = useState(false);
  const [duration, setDuration] = useState(60);
  const [durationText, setDurationText] = useState('60');
  const [customDuration, setCustomDuration] = useState(false);
  const [artStyle, setArtStyle] = useState<ArtStyle>('realistic');
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('9:16');
  const [budgetMode, setBudgetMode] = useState<BudgetMode>('balanced');
  const [creating, setCreating] = useState(false);
  /** 用户手动改过标题后，不再用 AI 结果覆盖 */
  const titleTouched = useRef(false);
  /** 取名请求序号：只接受最后一次返回，避免连续发言时旧标题回写 */
  const titleSeq = useRef(0);
  const durationRef = useRef<HTMLInputElement>(null);
  /** 本轮对话上传过的附件正文：确认创建时带入 prompt，恢复草稿时从消息回填 */
  const sentAttachments = useRef<PendingAttachment[]>([]);

  const currentStyle = styleOptions.find((s) => s.value === artStyle) ?? styleOptions[0];
  const currentRatio = RATIOS.find((r) => r.value === aspectRatio) ?? RATIOS[0];
  const currentBudget = budgetOptions.find((b) => b.value === budgetMode) ?? budgetOptions[1];

  const generateTitle = useCallback(
    async (source: string, sid?: string | null, force = false) => {
      const text = source.trim();
      if (!text) return;
      const seq = ++titleSeq.current;
      setTitleLoading(true);
      try {
        const next = await suggestChatTitle(text, sid ?? undefined);
        if (seq === titleSeq.current && (force || !titleTouched.current)) {
          setTitle(next);
        }
      } catch {
        /* 取名失败不阻断创建，确认时还会再兜一次 */
      } finally {
        if (seq === titleSeq.current) setTitleLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (!open) return;
    reset([]);
    stop();
    setSessionId(options?.sessionId ?? null);
    setInput(options?.prompt ?? '');
    setAttachments([]);
    setTitle('');
    setTitleLoading(false);
    setDuration(60);
    setDurationText('60');
    setCustomDuration(false);
    setArtStyle('realistic');
    setAspectRatio('9:16');
    setBudgetMode('balanced');
    setCreating(false);
    titleTouched.current = false;
    titleSeq.current += 1;
    sentAttachments.current = [];

    if (!options?.sessionId) return;
    setLoadingHistory(true);
    getChatSession(options.sessionId)
      .then((d) => {
        setMessages(d.messages);
        const stored = d.session.title?.trim() ?? '';
        // 旧会话标题是整句截断（长句/含标点）时按内容重取；短标题视为已命名，不覆盖
        const looksTruncated = !stored || stored.length >= 18 || /[，,。.；;]/.test(stored);
        if (titleSource(d.messages) && looksTruncated) {
          void generateTitle(titleSource(d.messages), options.sessionId);
        } else if (stored && !stored.startsWith('（已上传附件：')) {
          setTitle(stored);
        }
        // 草稿恢复：把历史消息里的附件正文取回来，确认创建时仍能作为剧本素材
        sentAttachments.current = d.messages.flatMap((m) =>
          (m.metadata?.attachments ?? [])
            .filter((a) => typeof a.text === 'string' && a.text.trim())
            .map((a) => ({ name: a.name ?? '附件', text: a.text, size: a.text?.length })),
        );
      })
      .catch((e) => toast.error(`对话加载失败：${(e as Error).message}`))
      .finally(() => setLoadingHistory(false));
    // 只在弹窗打开/恢复目标变化时初始化
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, options?.sessionId]);

  const close = useCallback(() => {
    stop();
    onClose();
  }, [stop, onClose]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  // 手动改写的片名防抖落库，草稿重开不丢
  useEffect(() => {
    if (!open || !sessionId || !titleTouched.current) return undefined;
    const value = title.trim();
    if (!value) return undefined;
    const timer = window.setTimeout(() => {
      void updateChatSessionTitle(sessionId, value).catch(() => {
        /* 落库失败不打扰输入 */
      });
    }, 700);
    return () => window.clearTimeout(timer);
  }, [open, sessionId, title]);

  const pickDuration = (d: number) => {
    setCustomDuration(false);
    setDuration(d);
    setDurationText(String(d));
  };

  const openCustomDuration = () => {
    setCustomDuration(true);
    setDurationText(String(duration));
    window.setTimeout(() => durationRef.current?.select(), 0);
  };

  const changeCustomDuration = (v: string) => {
    const digits = v.replace(/[^\d]/g, '').slice(0, 4);
    setDurationText(digits);
    const n = Number(digits);
    if (n >= 5 && n <= 7200) setDuration(n);
  };

  const normalizeCustomDuration = () => {
    const n = clampDuration(Number(durationText));
    setDuration(n);
    setDurationText(String(n));
  };

  const handleSend = async () => {
    const text = input.trim();
    if ((!text && attachments.length === 0) || busy || loadingHistory) return;
    let sid = sessionId;
    if (!sid) {
      try {
        const s = await createChatSession({});
        sid = s.id;
        setSessionId(sid);
      } catch (e) {
        toast.error(`新建对话失败：${(e as Error).message}`);
        return;
      }
    }
    const atts = attachments;
    if (atts.length > 0) sentAttachments.current = [...sentAttachments.current, ...atts];
    const source = titleSource(msgs, text);
    setInput('');
    setAttachments([]);
    // 取名与回复并行，别等整段回复结束才出片名
    if (!titleTouched.current) void generateTitle(source, sid);
    await send(sid, text, atts);
  };

  const confirmCreate = async () => {
    if (creating) return;
    const userTexts = msgs
      .filter(
        (m) =>
          m.role === 'user' &&
          m.content.trim() &&
          !m.content.startsWith('（已上传附件：'),
      )
      .map((m) => m.content.trim())
      .filter(Boolean);
    const refs = sentAttachments.current
      .filter((a) => a.text?.trim())
      .map((a) => `【附件：${a.name}】\n${a.text!.trim()}`)
      .join('\n\n');
    if (userTexts.length === 0 && !refs) {
      toast.error('先在对话里描述你要创作的方向');
      return;
    }
    const prompt = [userTexts.join('\n'), refs ? `参考资料：\n${refs}` : '']
      .filter(Boolean)
      .join('\n\n')
      .slice(0, 5000);
    const seconds = customDuration ? clampDuration(duration) : duration;
    setCreating(true);
    try {
      // 未手动命名时现取一次 AI 片名，避免把整句需求写进作品名
      let finalTitle = title.trim();
      if (!titleTouched.current) {
        try {
          finalTitle =
            (await suggestChatTitle(prompt.slice(0, 4000), sessionId ?? undefined)) || finalTitle;
        } catch {
          /* 取名失败用句首兜底 */
        }
      }
      finalTitle = (
        finalTitle ||
        userTexts[0]?.split(/[，,。.；;！!？?\s]/)[0]?.slice(0, 24) ||
        sentAttachments.current[0]?.name.replace(/\.[^.]+$/, '') ||
        '未命名作品'
      ).slice(0, 120);
      setTitle(finalTitle);
      const res = await quickCreate({
        prompt,
        title: finalTitle,
        durationSeconds: seconds,
        aspectRatio,
        artStyle,
        budgetMode,
      });
      if (sessionId) {
        try {
          await linkChatSession(sessionId, res.projectId, finalTitle);
        } catch {
          /* 会话挂载失败不阻断创作，项目仍可用 */
        }
      }
      toast.success('作品已创建，剧本生成中');
      onCreated(res.projectId);
    } catch (e) {
      toast.error(`创建失败：${(e as Error).message}`);
    } finally {
      setCreating(false);
    }
  };

  if (!open) return null;

  const hasUserMessage = msgs.some((m) => m.role === 'user');

  return createPortal(
    <div className="nw-backdrop" onClick={close} role="presentation">
      <div
        className="nw-panel"
        role="dialog"
        aria-modal="true"
        aria-label="新建作品"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="nw-head">
          <div className="nw-head-main">
            <div className="nw-head-ico">
              <Sparkles />
            </div>
            <div>
              <div className="nw-title">新建作品</div>
              <div className="nw-sub">先聊清楚方向，确认后进入生产；对话会自动保存</div>
            </div>
          </div>
          <button type="button" className="nw-x" onClick={close} aria-label="关闭">
            <X />
          </button>
        </header>

        <div className="nw-body">
          <div className="nw-chat">
            {loadingHistory ? (
              <div className="nw-loading">
                <Loader2 className="spin" /> 加载对话记录…
              </div>
            ) : (
              <ChatTurns
                msgs={msgs}
                busy={busy}
                empty={
                  <div className="nw-intro">
                    <h2>把一句话，聊成一部短剧</h2>
                    <p>
                      描述题材、主角、时长和画风。信息够了就点右侧「确认创建」，
                      我会自动拆剧本、定人物场景，再逐阶段请你确认。
                    </p>
                    <div className="nw-chips">
                      {IDEAS.map((idea) => (
                        <button
                          key={idea}
                          type="button"
                          className="nw-chip"
                          onClick={() => setInput(idea)}
                        >
                          {idea}
                        </button>
                      ))}
                    </div>
                  </div>
                }
              />
            )}
            <ChatComposer
              value={input}
              onChange={setInput}
              onSend={() => void handleSend()}
              busy={busy}
              onStop={stop}
              attachments={attachments}
              onAddAttachment={(a) => setAttachments((v) => [...v, a])}
              onRemoveAttachment={(i) => setAttachments((v) => v.filter((_, idx) => idx !== i))}
              placeholder="例如：做一部 90 秒穿越到唐朝的甜宠短剧，女主是现代甜品师…"
              sendHint="Enter"
            />
          </div>

          <aside className="nw-setup">
            <div className="nw-setup-h">作品设置</div>

            <div className="nw-label-row">
              <label className="nw-label" htmlFor="nw-title">
                作品名称
              </label>
              <button
                type="button"
                className="nw-gen"
                disabled={titleLoading || (!hasUserMessage && !input.trim())}
                onClick={() =>
                  void generateTitle(titleSource(msgs, input), sessionId, true)
                }
              >
                {titleLoading ? <Loader2 className="spin" /> : <Sparkles />}
                {titleLoading ? '取名中' : 'AI 取名'}
              </button>
            </div>
            <input
              id="nw-title"
              className="nw-input"
              value={title}
              maxLength={60}
              placeholder="按对话内容自动取名，也可直接改写"
              onChange={(e) => {
                titleTouched.current = true;
                setTitle(e.target.value);
              }}
            />

            <label className="nw-label">单集时长</label>
            <div className="nw-chips tight">
              {DURATIONS.map((d) => (
                <button
                  key={d}
                  type="button"
                  className={`nw-chip${!customDuration && duration === d ? ' on' : ''}`}
                  onClick={() => pickDuration(d)}
                >
                  {d}s
                </button>
              ))}
              <button
                type="button"
                className={`nw-chip${customDuration ? ' on' : ''}`}
                onClick={openCustomDuration}
              >
                自定义
              </button>
            </div>
            {customDuration ? (
              <div className="nw-custom">
                <input
                  ref={durationRef}
                  type="number"
                  inputMode="numeric"
                  min={5}
                  max={7200}
                  className="nw-input"
                  value={durationText}
                  onChange={(e) => changeCustomDuration(e.target.value)}
                  onBlur={normalizeCustomDuration}
                  aria-label="自定义单集时长（秒）"
                />
                <span>秒</span>
              </div>
            ) : null}

            <label className="nw-label">画风 · 定长相</label>
            <div className="nw-style-current">
              <img src={styleCover(artStyle)} alt="" />
              <span className="nw-style-current-main">
                <b>{currentStyle.label}</b>
                <span>{currentStyle.desc}</span>
              </span>
              <span className="nw-style-current-tag">{styleFamily(artStyle)}</span>
            </div>

            <label className="nw-label">画幅</label>
            <div className="nw-ratios">
              {RATIOS.map((r) => {
                const [w, h] = r.value.split(':').map(Number);
                const gw = w >= h ? 22 : Math.round((22 * w) / h);
                const gh = w >= h ? Math.round((22 * h) / w) : 22;
                return (
                  <button
                    key={r.value}
                    type="button"
                    className={`nw-ratio${aspectRatio === r.value ? ' on' : ''}`}
                    onClick={() => setAspectRatio(r.value)}
                    title={`${r.label} ${r.hint}`}
                  >
                    <i className="nw-ratio-glyph" style={{ width: gw, height: gh }} />
                    <span className="nw-ratio-t">{r.label}</span>
                    <span className="nw-ratio-h">{r.hint}</span>
                  </button>
                );
              })}
            </div>

            <label className="nw-label">预算</label>
            <div className="nw-budgets">
              {budgetOptions.map((b) => (
                <button
                  key={b.value}
                  type="button"
                  className={`nw-budget${budgetMode === b.value ? ' on' : ''}`}
                  onClick={() => setBudgetMode(b.value)}
                >
                  <b>{b.label}</b>
                  <span>{b.desc}</span>
                </button>
              ))}
            </div>

            <div className="nw-summary">
              <span>{duration}s</span>
              <i />
              <span>
                {currentRatio.label} {currentRatio.hint}
              </span>
              <i />
              <span>{currentStyle.label}</span>
              <i />
              <span>{currentBudget.label}</span>
            </div>

            <div className="nw-setup-note">
              确认后立即创建作品并生成剧本；剧本、分镜、成片各有一次确认门，
              不会未经你确认就批量花钱。
            </div>

            <button
              type="button"
              className="btn pri nw-confirm"
              disabled={!hasUserMessage || creating}
              onClick={() => void confirmCreate()}
            >
              {creating ? (
                <>
                  <Loader2 className="spin" /> 创建中…
                </>
              ) : (
                <>
                  确认创建 <ArrowRight className="ico" />
                </>
              )}
            </button>
            {!hasUserMessage ? (
              <div className="nw-hint">先在左侧聊两句，确认按钮才会亮起</div>
            ) : null}
          </aside>
        </div>

        {/* 底部完整风格条：21 种画风一屏可扫，3D / 国漫 / 真人 / 写实 一眼区分 */}
        <section className="nw-styles" aria-label="画风选择">
          <div className="nw-styles-h">
            <span className="nw-styles-title">画风 · 定长相</span>
            <span className="nw-styles-sub">21 种主流画风 · 真人 / 2D 漫 / 3D / 风格化</span>
            <span className="nw-styles-selected">已选：{currentStyle.label}</span>
          </div>
          <div className="nw-style-rail" role="radiogroup" aria-label="画风">
            {styleOptions.map((s) => {
              const on = artStyle === s.value;
              return (
                <button
                  key={s.value}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  className={`nw-style-card${on ? ' on' : ''}`}
                  onClick={() => setArtStyle(s.value)}
                  title={`${s.label} · ${s.desc}`}
                >
                  <img src={styleCover(s.value)} alt="" loading="lazy" />
                  <span className="nw-style-card-b">{styleFamily(s.value)}</span>
                  {on ? <Check className="nw-style-check" /> : null}
                  <span className="nw-style-card-n">{s.label}</span>
                </button>
              );
            })}
          </div>
        </section>
      </div>
    </div>,
    document.body,
  );
};