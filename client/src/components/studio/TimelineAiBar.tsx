/**
 * 选区 AI 条（G19 · OpenMotion TimelineMediaBar 对齐）
 * -------------------------------------------------------------
 * 单选片段时在片段上方浮出一条 680px 工具条：上下文行（起止秒 + 片段名）
 * + prompt 输入 + 「询问 AI」/「生成字幕」/「人声避让」（音频片段）。
 * C3 补齐 TimelineMediaBar 的 range 触发：I/O 工作区有效（≥0.2s）时也弹出，
 * 上下文行「区域 起止s · N 个片段」；单选片段优先于区域（互斥）。
 *
 * 锚定方案：直接查询时间线的 .clip2.selected 元素做 getBoundingClientRect，
 * 250ms 轮询 + resize/scroll(capture) 重算；片段上方放不下就翻到下方；
 * 区域模式锚在 .lanes-wrap 标尺上沿、区域中点的横坐标（px/s 从
 * yimu:shenjian-zoom-state 事件同步，不侵入 ShenJianTimeline）；
 * 锚点元素丢失（时间线未挂载/被卸载/收起）时整条隐藏，代价远小于
 * OpenMotion 的 useMediaPopoverPosition，且完全不侵入 ShenJianTimeline。
 *
 * 隐藏时机：播放中 / 片段拖拽中（.clip2.dragging）/ 右键菜单打开 /
 * Esc / 点击条外。动效 180ms（--m-duration-panel），品牌红点缀。
 *
 * 「询问 AI」接线：复用 WorkbenchContext.sendChat（与浮动对话同一个会话），
 * 并按 OpenMotionChrome.onAssistant 的既有方式点开 .pro-chat-orb 浮窗。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Captions, Loader2, Send, Sparkles, Volume1, X } from 'lucide-react';
import { toast } from 'sonner';
import { useStudio } from './StudioShell';
import { useEdl } from './EdlContext';
import { clipSpan } from './model';
import { getAsrStatus, transcribeClip } from '@client/src/api/timeline';

const BAR_MAX_W = 680;
/** I/O 区域触发阈值（秒）：太小的区域误触率高，不弹 */
const REGION_MIN_SEC = 0.2;
/** 时间线默认 px/s：zoom 事件到来前兜底（ShenJianTimeline 初始 zoom=44） */
const DEFAULT_PX_PER_SEC = 44;

const nameFromUrl = (url?: string | null) => {
  if (!url) return '';
  const tail = url.split('/').pop() ?? '';
  try {
    return decodeURIComponent(tail.replace(/\.[a-z0-9]+(?:\?.*)?$/i, ''));
  } catch {
    return tail;
  }
};

export const TimelineAiBar = () => {
  const { data, projectId, playing, sendChat, chatBusy, workIn, workOut } = useStudio();
  const edl = useEdl();
  const clips = data.timeline?.clips ?? [];

  const [prompt, setPrompt] = useState('');
  const [dismissedFor, setDismissedFor] = useState('');
  const [blocked, setBlocked] = useState(false); // 拖拽 / 右键菜单期间临时隐藏
  const [asrBusy, setAsrBusy] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number; below: boolean } | null>(null);
  const barRef = useRef<HTMLElement | null>(null);

  /** 单选片段（G19 的触发条件）：多选 / 空选一律不出现 */
  const clip = useMemo(() => {
    if (edl.selectedIds.length !== 1) return null;
    return clips.find((c) => c.id === edl.selectedIds[0]) ?? null;
  }, [clips, edl.selectedIds]);

  /**
   * I/O 工作区（C3）：有效区域（≥0.2s）也触发；单选片段优先（互斥）。
   * in/out 允许反设（I/O 顺序颠倒时取 min/max，与走带循环同语义）。
   */
  const region = useMemo(() => {
    if (clip || workIn == null || workOut == null) return null;
    const a = Math.min(workIn, workOut);
    const b = Math.max(workIn, workOut);
    if (b - a < REGION_MIN_SEC) return null;
    const count = clips.filter(
      (c) => c.timelineStart < b && c.timelineStart + clipSpan(c) > a,
    ).length;
    return { start: a, end: b, count };
  }, [clip, workIn, workOut, clips]);

  const identity = clip
    ? `${clip.id}:${clip.timelineStart.toFixed(3)}`
    : region
      ? `region:${region.start.toFixed(3)}:${region.end.toFixed(3)}`
      : '';
  const start = clip ? clip.timelineStart : region?.start ?? 0;
  const end = clip ? clip.timelineStart + clipSpan(clip) : region?.end ?? 0;
  const label = clip
    ? clip.track === 'subtitle'
      ? clip.text?.trim() || '字幕片段'
      : nameFromUrl(clip.sourceUrl) || '选中片段'
    : region
      ? `区域 · ${region.count} 个片段`
      : '选中片段';

  /* 时间线 px/s（区域模式换算横坐标用）：只读 ShenJianTimeline 广播的 zoom 状态，不侵入其内部 */
  const pxPerSecRef = useRef(DEFAULT_PX_PER_SEC);
  useEffect(() => {
    const onZoom = (e: Event) => {
      const v = Number((e as CustomEvent).detail);
      if (Number.isFinite(v) && v > 0) pxPerSecRef.current = v;
    };
    window.addEventListener('yimu:shenjian-zoom-state', onZoom);
    return () => window.removeEventListener('yimu:shenjian-zoom-state', onZoom);
  }, []);

  /* 锚定：轮询重算（片段被拖动 / 缩放 / 滚动时跟随），锚点丢失时回退到视口下方居中 */
  useEffect(() => {
    if ((!clip && !region) || playing) {
      setPos(null);
      return;
    }
    const measure = () => {
      const vw = document.documentElement.clientWidth || window.innerWidth;
      const vh = document.documentElement.clientHeight || window.innerHeight;
      const w = Math.min(BAR_MAX_W, vw - 24);
      let anchor: { cx: number; top: number; bottom: number; ok: boolean };
      if (region) {
        // 区域模式：锚在时间线标尺（lanes-wrap）上沿、区域中点的横坐标
        const lanes = document.querySelector('.sj2 .lanes-wrap') as HTMLElement | null;
        if (!lanes) {
          anchor = { cx: 0, top: 0, bottom: 0, ok: false };
        } else {
          const r = lanes.getBoundingClientRect();
          const mid = ((region.start + region.end) / 2) * pxPerSecRef.current - lanes.scrollLeft;
          anchor = { cx: r.left + mid, top: r.top, bottom: r.bottom, ok: r.width > 0 };
        }
      } else {
        const el = document.querySelector('.sj2 .clip2.selected') as HTMLElement | null;
        if (!el) {
          anchor = { cx: 0, top: 0, bottom: 0, ok: false };
        } else {
          const r = el.getBoundingClientRect();
          anchor = { cx: r.left + r.width / 2, top: r.top, bottom: r.bottom, ok: r.width > 0 || r.height > 0 };
        }
      }
      if (!anchor.ok) {
        setPos((prev) => (prev === null ? prev : null));
        return;
      }
      const left = Math.max(12 + w / 2, Math.min(vw - 12 - w / 2, anchor.cx));
      const aboveTop = anchor.top - 10;
      const below = aboveTop < 120; // 上方空间不够（工具栏/预览占位）就翻到锚点下方
      const top = below ? Math.min(vh - 12, anchor.bottom + 10) : aboveTop;
      // 值没变就不换对象，避免 250ms 轮询带来的无谓重渲染
      setPos((prev) => (prev && prev.left === left && prev.top === top && prev.below === below ? prev : { left, top, below }));
    };
    measure();
    const timer = window.setInterval(() => {
      // 拖拽 / 右键菜单期间只隐藏不重算，避免条跟着乱跑
      const dragging = document.querySelector('.sj2 .clip2.dragging');
      setBlocked((prev) => {
        const next = Boolean(dragging);
        return next === prev ? prev : next;
      });
      measure();
    }, 250);
    const onScroll = () => measure();
    window.addEventListener('resize', onScroll);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('resize', onScroll);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [clip, region, playing]);

  /* 右键菜单打开时临时隐藏：菜单关闭的下一次 pointerdown 恢复；点击条外 / Esc 关闭 */
  useEffect(() => {
    if (!identity) return undefined;
    const onCtx = () => setBlocked(true);
    const onDown = (e: PointerEvent) => {
      setBlocked(false);
      if (barRef.current && !barRef.current.contains(e.target as Node)) {
        setDismissedFor(identity);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDismissedFor(identity);
    };
    window.addEventListener('contextmenu', onCtx, true);
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('contextmenu', onCtx, true);
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [identity]);

  /* 换选区 / 片段移动后重新允许弹出（dismiss 只对当次选中生效） */
  const prevIdentityRef = useRef(identity);
  useEffect(() => {
    if (prevIdentityRef.current !== identity) {
      prevIdentityRef.current = identity;
      setDismissedFor('');
    }
  }, [identity]);

  const hidden = (!clip && !region) || !pos || playing || blocked || dismissedFor === identity;

  const openChat = () => {
    // 复用 OpenMotionChrome.onAssistant 的既有通路：小球在就点开，已展开就不动
    const orb = document.querySelector<HTMLButtonElement>('.pro-chat-orb');
    if (orb) orb.click();
  };

  /** 询问 AI：把选区/区域上下文注入既有对话（同一会话、同一网关） */
  const askAi = () => {
    const text = prompt.trim();
    if (!text) {
      toast.info('先描述你想对这段做什么，再交给 AI');
      return;
    }
    if (chatBusy) {
      toast.info('神剪助手正在执行，稍后再发');
      return;
    }
    const ctx = region
      ? `【时间线区域 ${start.toFixed(2)}s–${end.toFixed(2)}s · 覆盖 ${region.count} 个片段】`
      : `【时间线选区 ${start.toFixed(2)}s–${end.toFixed(2)}s · ${label}】`;
    openChat();
    void sendChat(`${ctx} ${text}`);
    setPrompt('');
    setDismissedFor(identity);
  };

  /** 生成字幕：与 ParityTimeline 的自动字幕同一条 ASR 链路 */
  const autoCaption = async () => {
    if (!projectId || !clip || asrBusy) return;
    if (clip.track !== 'video' && clip.track !== 'audio') {
      toast.info('字幕只能生成到画面或音频片段上');
      return;
    }
    setAsrBusy(true);
    const loading = toast.loading('正在识别语音…');
    try {
      const status = await getAsrStatus(projectId);
      if (!status.available) {
        toast.error(`语音识别未配置：${status.reason || '请先在 Provider 设置里配置 ASR'}`);
        return;
      }
      const res = await transcribeClip(projectId, clip.id);
      if (!res.segments.length) {
        toast.info('没有识别到有效语音');
        return;
      }
      let added = 0;
      for (const s of res.segments) {
        const id = edl.addSubtitle(s.start, 0, s.text, undefined, Math.max(0.3, s.end - s.start));
        if (id) added += 1;
      }
      toast.success(`已生成 ${added} 条字幕`);
    } catch (err) {
      toast.error(`自动字幕失败：${(err as Error).message}`);
    } finally {
      toast.dismiss(loading);
      setAsrBusy(false);
    }
  };

  /** 人声避让：仅音频片段（既有 G15 编辑器 op） */
  const duckVoice = () => {
    if (!clip) return;
    if (clip.track !== 'audio') {
      toast.info('人声避让只对音频片段生效（把配乐/音效放在 A 轨再试）');
      return;
    }
    const ok = edl.applyDuckUnderVoice(clip.id);
    if (ok) toast.success('已生成人声避让包络：人声出现时自动压低');
    else toast.info('没有找到人声片段：把人声放在对白轨（A1）或做一次音画分离后再试');
  };

  if (hidden) return null;

  const barW = Math.min(BAR_MAX_W, (document.documentElement.clientWidth || window.innerWidth) - 24);
  // 挂进 .sj2 根：设计令牌（--m-*）定义在这个作用域上，portal 到 body 会读不到
  const host = document.querySelector('.sj2') ?? document.body;

  return createPortal(
    <aside
      ref={barRef}
      className={`yimu-ai-bar${pos.below ? ' is-below' : ''}`}
      style={{ left: pos.left, top: pos.top, width: barW }}
      role="toolbar"
      aria-label="选区 AI 操作"
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        // 输入框内按键不给全局快捷键；条内 Esc 自己关
        e.stopPropagation();
        if (e.key === 'Escape') setDismissedFor(identity);
      }}
    >
      <div className="yimu-ai-bar-context">
        <span className="yimu-ai-bar-range">
          {start.toFixed(2)}s–{end.toFixed(2)}s
        </span>
        <span className="yimu-ai-bar-label" title={label}>
          {label}
        </span>
        <button type="button" className="yimu-ai-bar-close" aria-label="关闭选区 AI 条" onClick={() => setDismissedFor(identity)}>
          <X size={13} />
        </button>
      </div>
      <form
        className="yimu-ai-bar-form"
        onSubmit={(e) => {
          e.preventDefault();
          askAi();
        }}
      >
        <Sparkles size={14} className="yimu-ai-bar-spark" />
        <input
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="对这段选区说点什么：改成快节奏 / 加字幕 / 配乐避让人声…"
          aria-label="选区 AI 指令"
        />
        <button type="submit" className="yimu-ai-bar-primary" disabled={chatBusy}>
          <Send size={13} />
          询问 AI
        </button>
        {/* 区域模式只有「询问 AI」：ASR / 人声避让都需要落在具体片段上 */}
        {clip ? (
          <>
            <button type="button" onClick={() => void autoCaption()} disabled={asrBusy} title="对选中片段跑 ASR 并生成字幕">
              {asrBusy ? <Loader2 size={13} className="yimu-ai-spin" /> : <Captions size={13} />}
              生成字幕
            </button>
            <button
              type="button"
              onClick={duckVoice}
              className="yimu-ai-bar-audio"
              title={clip?.track === 'audio' ? '人声出现时自动压低这段音频' : '仅音频片段支持'}
            >
              <Volume1 size={13} />
              人声避让
            </button>
          </>
        ) : null}
      </form>
    </aside>,
    host,
  );
};

export default TimelineAiBar;
