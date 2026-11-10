/**
 * Studio · 应用骨架（方案 F）
 * -------------------------------------------------------------
 * 布局契约（与 design-mockups/方案F-canvas-preview.html 完全一致）：
 *
 *   ┌────────┬──────────────────────────┬────────────┐
 *   │        │  stage-head（面包屑/状态） │            │
 *   │  rail  ├──────────────────────────┤   dock     │
 *   │ 导航轨 │  对话 / 无限画布 / 内容页 │  产出坞    │
 *   │        ├──────────────────────────┤  7 Tab     │
 *   │        │  时间线（真实时长刻度）    │            │
 *   ├────────┴──────────────────────────┴────────────┤
 *   │  statusbar（IDE 状态栏）                       │
 *   └───────────────────────────────────────────────┘
 *
 * 快捷键（设计稿底部状态栏标注）：
 *   [ 折叠/展开导航轨   ] 折叠/展开产出坞   \ 折叠/展开时间线
 *   G 对话 ↔ 无限画布   - / + 缩放   0 适应画布   ← → 上一镜/下一镜
 *
 * 状态真源：URL。右坞 Tab 与舞台视图都由路由片段推导，
 * 刷新 / 分享链接 / 前进后退都能落到同一处（见 studioRoutes.ts）。
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import type { ChatMessage } from '@shared/api.interface';
import { createChatSession, getChatSession } from '@client/src/api/chat';
import { StudioRail } from './StudioRail';
import { StudioStage } from './StudioStage';
import { StudioDock } from './StudioDock';
import { StudioTimeline } from './StudioTimeline';
import { StudioStatusBar } from './StudioStatusBar';
import { NewWorkDialog, type NewWorkOpenOptions } from './NewWorkDialog';
import { useStreamingChat } from './chat/useStreamingChat';
import type { PendingAttachment } from './chat/ChatComposer';
import { useStudioData, type StudioData } from './useStudioData';
import { clipSpan, shotIndexAt } from './model';
import {
  DOCK_SEG,
  DOCK_SEG_OF,
  PAGE_SEGS,
  type DockTabKey,
} from './studioRoutes';

export type StageView = 'chat' | 'canvas' | 'page';

/** 时间线收起态跨页持久（localStorage 键） */
export const TL_COLLAPSED_KEY = 'yimu.timelineCollapsed';

/**
 * 导航轨折叠（图标模式）持久键 —— 与经典模式侧栏共用同一个 key，
 * 用户手动展开/收起后全模式保持；未设置过时 /create、/canvases 等
 * 需要完整宽度的页面默认折叠为图标栏（hover 显 tooltip，点击轨开关展开）。
 */
export const SIDEBAR_COLLAPSED_KEY = 'yimu.sidebarCollapsed';

/** 需要完整内容宽度的路由（默认折叠导航轨） */
const WIDE_STAGE_PATHS = ['/create', '/canvases'];

const readSidebarCollapsed = (pathname: string): boolean => {
  try {
    const stored = localStorage.getItem(SIDEBAR_COLLAPSED_KEY);
    if (stored === '1' || stored === '0') return stored === '1';
  } catch {
    /* 隐私模式读不到：按路径默认 */
  }
  return WIDE_STAGE_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
};

const readTlCollapsed = (): boolean => {
  try {
    return localStorage.getItem(TL_COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
};

export interface StudioContextValue {
  data: StudioData;
  /** 底部时间线是否收起（细条模式），持久到 localStorage */
  tlCollapsed: boolean;
  setTlCollapsed: (v: boolean) => void;
  toggleTlCollapsed: () => void;
  /** 当前项目 id；为空表示「未进入项目」的工作台态 */
  projectId?: string;
  /** 当前选中的镜头下标（画布 / 时间线 / 预览 / 分镜 四处同步） */
  sel: number;
  setSel: (index: number) => void;
  /** 播放头位置（秒） */
  curT: number;
  setCurT: (t: number) => void;
  playing: boolean;
  setPlaying: (v: boolean) => void;
  stageView: StageView;
  setStageView: (v: StageView) => void;
  /** 当前项目会话（落库，刷新/切页可恢复） */
  chatMsgs: ChatMessage[];
  chatBusy: boolean;
  chatLoading: boolean;
  sendChat: (text: string, attachments?: PendingAttachment[]) => Promise<void>;
  stopChat: () => void;
  /** 打开「新建作品」对话弹窗；传 sessionId 可恢复草稿会话 */
  openNewWork: (options?: NewWorkOpenOptions) => void;
  /** 右侧产出坞当前 Tab */
  dockTab: DockTabKey;
  setDockTab: (t: DockTabKey) => void;
  /** 右坞宽度（可拖拽调整，null = 用设计稿默认宽度） */
  dockW: number | null;
  setDockW: (n: number | null) => void;
  /** 画布缩放与平移（由画布组件注册，供快捷键调用） */
  canvasApi: {
    zoomIn: () => void;
    zoomOut: () => void;
    fit: () => void;
  } | null;
  setCanvasApi: (api: StudioContextValue['canvasApi']) => void;
}

const StudioContext = createContext<StudioContextValue | null>(null);

export const useStudio = () => {
  const ctx = useContext(StudioContext);
  if (!ctx) throw new Error('useStudio 必须在 StudioShell 内使用');
  return ctx;
};

interface StudioShellProps {
  /** 覆盖从 URL 解析出的项目 id（一般不需要传） */
  projectId?: string;
  children?: React.ReactNode;
}

/** 从路径解析 /project/:id/<seg> */
function parseProjectPath(pathname: string): { id?: string; seg: string } {
  const m = pathname.match(/^\/project\/([^/]+)(?:\/([^/]+))?/);
  if (!m) return { seg: '' };
  return { id: m[1], seg: m[2] ?? '' };
}

export const StudioShell = ({ projectId: projectIdProp, children }: StudioShellProps) => {
  const location = useLocation();
  const navigate = useNavigate();

  // 先从 URL 解析项目，再拉数据（否则 useStudioData 拿不到项目 id）
  const parsed = useMemo(() => parseProjectPath(location.pathname), [location.pathname]);
  const projectId = projectIdProp ?? parsed.id;
  const seg = parsed.seg;

  const data = useStudioData(projectId);

  const [railCollapsed, setRailCollapsed] = useState(() => readSidebarCollapsed(location.pathname));
  const [dockCollapsed, setDockCollapsed] = useState(false);
  const [tlCollapsed, setTlCollapsedState] = useState(readTlCollapsed);

  const setTlCollapsed = useCallback((v: boolean) => {
    setTlCollapsedState(v);
    try {
      localStorage.setItem(TL_COLLAPSED_KEY, v ? '1' : '0');
    } catch {
      /* 隐私模式等场景忽略写失败 */
    }
  }, []);

  const toggleTlCollapsed = useCallback(() => {
    setTlCollapsed(!tlCollapsed);
  }, [tlCollapsed, setTlCollapsed]);

  /** 导航轨折叠切换：写档持久（与经典模式侧栏共用 yimu.sidebarCollapsed） */
  const toggleRailCollapsed = useCallback(() => {
    setRailCollapsed((v) => {
      try {
        localStorage.setItem(SIDEBAR_COLLAPSED_KEY, v ? '0' : '1');
      } catch {
        /* 隐私模式写失败：本次会话仍生效 */
      }
      return !v;
    });
  }, []);
  const [dockTab, setDockTabState] = useState<DockTabKey>('preview');
  const [dockW, setDockW] = useState<number | null>(null);
  const [stageView, setStageViewState] = useState<StageView>('chat');
  const [sel, setSelRaw] = useState(0);
  const [curT, setCurT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [canvasApi, setCanvasApi] = useState<StudioContextValue['canvasApi']>(null);
  const {
    msgs: chatMsgs,
    busy: chatBusy,
    send: sendStreamChat,
    stop: stopChat,
    reset: resetChat,
    setMessages: setChatMessages,
  } = useStreamingChat();
  const [chatSessionId, setChatSessionId] = useState<string | null>(null);
  const [chatLoading, setChatLoading] = useState(false);
  /** 切换项目时作废在途的历史加载 */
  const chatEpochRef = useRef(0);
  const [newWork, setNewWork] = useState<{ options?: NewWorkOpenOptions } | null>(null);

  const openNewWork = useCallback((options?: NewWorkOpenOptions) => {
    setNewWork({ options });
  }, []);
  const closeNewWork = useCallback(() => setNewWork(null), []);

  // 进入/切换项目：恢复该项目最近一条会话（新建作品时草稿会话已挂到项目上）
  useEffect(() => {
    const epoch = ++chatEpochRef.current;
    resetChat([]);
    setChatSessionId(null);
    if (!projectId) {
      setChatLoading(false);
      return;
    }
    setChatLoading(true);
    void (async () => {
      try {
        const session = await createChatSession({ projectId });
        const detail = await getChatSession(session.id);
        if (epoch !== chatEpochRef.current) return;
        setChatSessionId(session.id);
        setChatMessages(detail.messages);
      } catch {
        /* 会话加载失败不阻断项目页面 */
      } finally {
        if (epoch === chatEpochRef.current) setChatLoading(false);
      }
    })();
  }, [projectId, resetChat, setChatMessages]);

  const sendChat = useCallback(
    async (text: string, attachments: PendingAttachment[] = []) => {
      let sid = chatSessionId;
      if (!sid) {
        try {
          const session = await createChatSession(projectId ? { projectId } : {});
          sid = session.id;
          setChatSessionId(sid);
        } catch (e) {
          toast.error(`对话创建失败：${(e as Error).message}`);
          return;
        }
      }
      await sendStreamChat(sid, text, attachments);
    },
    [chatSessionId, projectId, sendStreamChat],
  );

  const hasChildren = !!children;

  // URL → 状态（唯一真源）
  useEffect(() => {
    if (projectId) {
      setDockTabState(DOCK_SEG[seg] ?? 'preview');
      setStageViewState(
        seg === 'canvas' ? 'canvas' : PAGE_SEGS[seg] ? 'page' : 'chat',
      );
    } else {
      setDockTabState('preview');
      setStageViewState(hasChildren ? 'page' : 'chat');
    }
  }, [projectId, seg, hasChildren]);

  const shots = data.shots;
  /** 播放总时长以 EDL 为准（片段可被拖动/修剪，不再等于镜头时长之和） */
  const timelineTotal = useMemo(() => {
    let end = 0;
    for (const c of data.timeline?.clips ?? []) {
      end = Math.max(end, c.timelineStart + clipSpan(c));
    }
    return end > 0 ? end : data.totalSec;
  }, [data.timeline, data.totalSec]);

  // 镜头集合变化时把选中项收敛到合法范围
  useEffect(() => {
    if (shots.length === 0) {
      setSelRaw(0);
      return;
    }
    setSelRaw((prev) => (prev >= shots.length ? shots.length - 1 : prev));
  }, [shots.length]);

  const setSel = useCallback(
    (index: number) => {
      if (shots.length === 0) return;
      const i = Math.max(0, Math.min(shots.length - 1, index));
      setSelRaw(i);
      // 预览跳到该镜在时间线上的真实位置（EDL 可被移动，shots.start 只是生产顺序）
      const shot = shots[i];
      const clip = (data.timeline?.clips ?? [])
        .filter((c) => c.track === 'video' && c.sourceShotId === shot.id)
        .sort((a, b) => a.timelineStart - b.timelineStart)[0];
      setCurT(clip ? clip.timelineStart : shot.start);
    },
    [shots, data.timeline],
  );

  const stepShot = useCallback(
    (delta: number) => {
      if (shots.length === 0) return;
      setSel((sel + delta + shots.length) % shots.length);
    },
    [sel, shots.length, setSel],
  );

  /** 切舞台视图：在项目内改 URL（可分享），在全局页只改本地状态 */
  const setStageView = useCallback(
    (v: StageView) => {
      if (projectId && v !== 'page') {
        navigate(v === 'canvas' ? `/project/${projectId}/canvas` : `/project/${projectId}`);
        return;
      }
      setStageViewState(v);
    },
    [projectId, navigate],
  );

  /** 切右坞 Tab：在项目内改 URL（可分享） */
  const setDockTab = useCallback(
    (t: DockTabKey) => {
      if (projectId) {
        const s = DOCK_SEG_OF[t];
        navigate(s ? `/project/${projectId}/${s}` : `/project/${projectId}`);
        return;
      }
      setDockTabState(t);
    },
    [projectId, navigate],
  );

  // 快捷键
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT') return;
      if (el?.isContentEditable) return;
      // ⌥T：切换时间线收起（输入框聚焦时不触发，已在上方拦截）
      if (e.altKey && !e.metaKey && !e.ctrlKey && (e.key === 't' || e.key === 'T')) {
        e.preventDefault();
        toggleTlCollapsed();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      switch (e.key) {
        case ' ':
          // 空格：播放 / 暂停（阻止页面滚动与焦点按钮误触发）
          e.preventDefault();
          setPlaying((v) => !v);
          break;
        case '[':
          toggleRailCollapsed();
          break;
        case ']':
          setDockCollapsed((v) => !v);
          break;
        case '\\':
          toggleTlCollapsed();
          break;
        case 'g':
        case 'G':
          // 自由画布（原旗舰 canvas-free3，沉浸全屏）↔ 对话：按当前是否已在自由画布切换
          if (projectId && location.pathname === `/project/${projectId}/canvas-free3`) {
            navigate(`/project/${projectId}`);
          } else if (projectId) {
            navigate(`/project/${projectId}/canvas-free3`);
          }
          break;
        case '-':
        case '_':
          canvasApi?.zoomOut();
          break;
        case '=':
        case '+':
          canvasApi?.zoomIn();
          break;
        case '0':
          canvasApi?.fit();
          break;
        case 'ArrowLeft':
          stepShot(-1);
          break;
        case 'ArrowRight':
          stepShot(1);
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canvasApi, stepShot, setStageView, stageView, toggleTlCollapsed]);

  // 播放：按真实经过时间推进播放头（时间戳差值，避免 setInterval 漂移）
  useEffect(() => {
    if (!playing || timelineTotal <= 0) return undefined;
    const total = timelineTotal;
    let last = performance.now();
    const timer = setInterval(() => {
      const now = performance.now();
      const dt = (now - last) / 1000;
      last = now;
      setCurT((t) => {
        const next = t + dt;
        if (next >= total) {
          setPlaying(false);
          return 0;
        }
        return next;
      });
    }, 100);
    return () => clearInterval(timer);
  }, [playing, timelineTotal, setPlaying]);

  // 播放头移动 → 通过 EDL 视频片段反查镜头（片段被移动后仍能跟随）
  useEffect(() => {
    if (shots.length === 0) return;
    const video = (data.timeline?.clips ?? []).filter((c) => c.track === 'video');
    let idx = -1;
    if (video.length > 0) {
      const active = video
        .filter((c) => curT >= c.timelineStart && curT < c.timelineStart + clipSpan(c))
        .sort((a, b) => a.timelineStart - b.timelineStart)
        .pop();
      const fallback = video
        .filter((c) => c.timelineStart <= curT)
        .sort((a, b) => a.timelineStart - b.timelineStart)
        .pop();
      const hit = active ?? fallback;
      if (hit?.sourceShotId) idx = shots.findIndex((s) => s.id === hit.sourceShotId);
    }
    if (idx < 0) idx = shotIndexAt(shots, curT);
    setSelRaw((prev) => (prev === idx ? prev : idx));
  }, [curT, shots, data.timeline]);

  // 无项目时产出坞不渲染；同时释放它占的网格列，否则舞台会被挤成窄条、右侧留大片空白
  const dockHidden = dockCollapsed || !projectId;
  const tlHidden = tlCollapsed || !projectId;

  const appClass = useMemo(
    () =>
      [
        'app',
        railCollapsed ? 'rail-collapsed' : '',
        dockHidden ? 'dock-collapsed' : '',
        tlHidden ? 'tl-collapsed' : '',
        stageView === 'canvas' ? 'canvas-mode' : '',
      ]
        .filter(Boolean)
        .join(' '),
    [railCollapsed, dockHidden, tlHidden, stageView],
  );

  const ctxValue = useMemo<StudioContextValue>(
    () => ({
      data,
      projectId,
      tlCollapsed,
      setTlCollapsed,
      toggleTlCollapsed,
      sel,
      setSel,
      curT,
      setCurT,
      playing,
      setPlaying,
      stageView,
      setStageView,
      chatMsgs,
      chatBusy,
      chatLoading,
      sendChat,
      stopChat,
      openNewWork,
      dockTab,
      setDockTab,
      dockW,
      setDockW,
      canvasApi,
      setCanvasApi,
    }),
    [
      data,
      projectId,
      tlCollapsed,
      setTlCollapsed,
      toggleTlCollapsed,
      sel,
      setSel,
      curT,
      playing,
      stageView,
      setStageView,
      chatMsgs,
      chatBusy,
      chatLoading,
      sendChat,
      stopChat,
      openNewWork,
      dockTab,
      setDockTab,
      dockW,
      canvasApi,
    ],
  );

  // 内容页：项目内按 URL 片段选既有页签；全局页用传入的 children
  const PageComp = projectId ? PAGE_SEGS[seg] : null;
  const pageContent = PageComp ? <PageComp /> : children;

  /** 新建作品成功：刷新左轨列表并进入新项目对话 */
  const handleWorkCreated = useCallback(
    (id: string) => {
      setNewWork(null);
      void data.reloadProjects();
      navigate(`/project/${id}`);
    },
    [data.reloadProjects, navigate],
  );

  return (
    <StudioContext.Provider value={ctxValue}>
      <div
        className={appClass}
        style={dockW ? ({ '--dock-w': `${dockW}px` } as React.CSSProperties) : undefined}
      >
        <button
          type="button"
          className="rail-toggle"
          title={railCollapsed ? '展开侧栏 ( [ )' : '收起侧栏 ( [ )'}
          aria-label="收起或展开侧栏"
          onClick={toggleRailCollapsed}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{
              transform: railCollapsed ? 'rotate(180deg)' : undefined,
              transition: 'transform 260ms cubic-bezier(.22,1,.36,1)',
            }}
          >
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        {projectId ? (
          <button
            type="button"
            className="dock-toggle"
            title={dockCollapsed ? '展开产出坞 ( ] )' : '收起产出坞 ( ] )'}
            aria-label="收起或展开产出坞"
            onClick={() => setDockCollapsed((v) => !v)}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{
                transform: dockCollapsed ? 'rotate(180deg)' : undefined,
                transition: 'transform 260ms cubic-bezier(.22,1,.36,1)',
              }}
            >
              <path d="M9 18l6-6-6-6" />
            </svg>
          </button>
        ) : null}

        <StudioRail />
        <StudioStage>{pageContent}</StudioStage>
        {projectId ? <StudioDock /> : null}
        {projectId ? <StudioTimeline /> : null}
        <StudioStatusBar />
        <NewWorkDialog
          open={!!newWork}
          options={newWork?.options}
          onClose={closeNewWork}
          onCreated={handleWorkCreated}
        />
      </div>
    </StudioContext.Provider>
  );
};
