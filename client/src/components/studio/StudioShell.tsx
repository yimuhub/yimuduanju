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
  useState,
} from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { StudioRail } from './StudioRail';
import { StudioStage } from './StudioStage';
import { StudioDock } from './StudioDock';
import { StudioTimeline } from './StudioTimeline';
import { StudioStatusBar } from './StudioStatusBar';
import { useStudioData, type StudioData } from './useStudioData';
import { shotIndexAt } from './model';
import {
  DOCK_SEG,
  DOCK_SEG_OF,
  PAGE_SEGS,
  type DockTabKey,
} from './studioRoutes';

export type StageView = 'chat' | 'canvas' | 'page';

export interface StudioContextValue {
  data: StudioData;
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

  const [railCollapsed, setRailCollapsed] = useState(false);
  const [dockCollapsed, setDockCollapsed] = useState(false);
  const [tlCollapsed, setTlCollapsed] = useState(false);
  const [dockTab, setDockTabState] = useState<DockTabKey>('preview');
  const [dockW, setDockW] = useState<number | null>(null);
  const [stageView, setStageViewState] = useState<StageView>('chat');
  const [sel, setSelRaw] = useState(0);
  const [curT, setCurT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [canvasApi, setCanvasApi] = useState<StudioContextValue['canvasApi']>(null);

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
      setCurT(shots[i].start);
    },
    [shots],
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
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT') return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      switch (e.key) {
        case '[':
          setRailCollapsed((v) => !v);
          break;
        case ']':
          setDockCollapsed((v) => !v);
          break;
        case '\\':
          setTlCollapsed((v) => !v);
          break;
        case 'g':
        case 'G':
          setStageView(stageView === 'canvas' ? 'chat' : 'canvas');
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
  }, [canvasApi, stepShot, setStageView, stageView]);

  // 播放：按镜头真实时长推进播放头
  useEffect(() => {
    if (!playing || shots.length === 0) return undefined;
    const timer = setInterval(() => {
      setCurT((t) => {
        const next = t + 0.1;
        const total = shots.reduce((s, x) => s + x.dur, 0);
        if (next >= total) {
          setPlaying(false);
          return 0;
        }
        return next;
      });
    }, 100);
    return () => clearInterval(timer);
  }, [playing, shots]);

  // 播放头移动 → 选中镜位跟随
  useEffect(() => {
    if (!playing || shots.length === 0) return;
    const idx = shotIndexAt(shots, curT);
    setSelRaw((prev) => (prev === idx ? prev : idx));
  }, [curT, playing, shots]);

  // 全局页（无项目）不展示产出坞与时间线：它们属于项目上下文
  const dockHidden = dockCollapsed || (!projectId && hasChildren);
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
      sel,
      setSel,
      curT,
      setCurT,
      playing,
      setPlaying,
      stageView,
      setStageView,
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
      sel,
      setSel,
      curT,
      playing,
      stageView,
      setStageView,
      dockTab,
      setDockTab,
      dockW,
      canvasApi,
    ],
  );

  // 内容页：项目内按 URL 片段选既有页签；全局页用传入的 children
  const PageComp = projectId ? PAGE_SEGS[seg] : null;
  const pageContent = PageComp ? <PageComp /> : children;

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
          onClick={() => setRailCollapsed((v) => !v)}
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
      </div>
    </StudioContext.Provider>
  );
};
