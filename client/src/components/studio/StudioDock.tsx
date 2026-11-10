/**
 * Studio · 右产出坞（Graphite 重设计）
 * -------------------------------------------------------------
 * 8 个 Tab（与设计稿一致）：
 *   预览   —— StudioPreview（可上下拖拽分割预览高度）
 *   剧本   —— StudioScriptTab（结构化阅读 / 编辑双模式）
 *   圣经   —— 复用 ProjectBibleTab
 *   道具   —— StudioPropsTab（道具资产 / 状态变体 / AI 生成）
 *   分镜   —— 复用 ProjectStoryboardTab
 *   资产   —— 复用 ProjectAssetsTab
 *   质检   —— 复用 ProjectQcTab
 *   导出   —— 复用 ProjectExportTab
 *
 * 被复用的页签均通过 useParams 取项目 id，因此本组件必须渲染在
 * /project/:id 路由内部（由 StudioProjectPage 保证）。
 *
 * 视觉：所有 Tab 共享一条顶部工具条 + 统一的 .dp-content 内容容器，
 * 旧页签无需改动即可获得一致的卡片 / 排版 / 输入 / 按钮语言。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BookOpen,
  Box,
  ChevronDown,
  Clapperboard,
  Download,
  FileText,
  Image as ImageIcon,
  Play,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react';
import { useStudio } from './StudioShell';
import { StudioPreview } from './StudioPreview';
import { StudioScriptTab } from './StudioScriptTab';
import { StudioPropsTab } from './StudioPropsTab';
import { DOCK_TABS, type DockTabKey } from './studioRoutes';
import ProjectBibleTab from '@client/src/pages/ProjectWorkspace/tabs/ProjectBibleTab';
import ProjectStoryboardTab from '@client/src/pages/ProjectWorkspace/tabs/ProjectStoryboardTab';
import ProjectAssetsTab from '@client/src/pages/ProjectWorkspace/tabs/ProjectAssetsTab';
import ProjectQcTab from '@client/src/pages/ProjectWorkspace/tabs/ProjectQcTab';
import ProjectExportTab from '@client/src/pages/ProjectWorkspace/tabs/ProjectExportTab';

/** 右坞宽度：下限保证可用，上限按窗口动态计算（保留中舞台最小宽度） */
const DOCK_MIN = 320;
const MIN_STAGE = 320;
const DOCK_W_KEY = 'yimu.dockWidth';

/** 宽度预设：按屏幕比例算，小屏也不会把中舞台挤没 */
const WIDTH_PRESETS = [
  { key: 'std', label: '标准', ratio: 0 },
  { key: 'wide', label: '宽屏', ratio: 0.55 },
  { key: 'max', label: '超宽', ratio: 0.68 },
] as const;
type PresetKey = (typeof WIDTH_PRESETS)[number]['key'] | null;

/** 拖拽上限：保证中舞台至少还有 MIN_STAGE 可用 */
const maxDockWidth = () =>
  Math.max(DOCK_MIN + 120, Math.round(window.innerWidth - 262 - MIN_STAGE));

const presetWidth = (key: PresetKey): number | null => {
  if (!key || key === 'std') return null;
  const p = WIDTH_PRESETS.find((x) => x.key === key);
  if (!p) return null;
  return Math.min(maxDockWidth(), Math.round(window.innerWidth * p.ratio));
};

/* ==================================================================
 * 产出坞 Tab 条「宽度自适应规范」—— 唯一真源，勿在别处另写一套
 * ------------------------------------------------------------------
 * 判定依据是「产出坞实际宽度」（ResizeObserver 量 .dock），
 * 不是 window.innerWidth：右坞能独立拖拽，视口宽度不能代表它的可用空间。
 *
 *   ≥ 580px   full      图标 + 文字 + 计数徽章，8 项全平铺，显示「产出」品牌标签
 *   450–579   compact   收起品牌标签与徽章，图标 + 文字，8 项全平铺（默认 548 落此档）
 *   400–449   icons     只留图标，8 项全平铺，选中项带品牌红指示点
 *   < 400     overflow  前 4 个图标 + 「更多」下拉，下拉里是全部 8 项的完整名称与徽章
 *
 * 不变式（回归时逐条验收）：
 *   1. 任何宽度下 8 个 Tab 都可达，「导出」永不消失、永不被静默裁切；
 *   2. 不做横向滚动来藏内容——隐藏滚动条 + overflow:hidden 是旧版丢按钮的根因；
 *   3. 当前选中项若被收进下拉，「更多」按钮显示品牌红指示点并标注当前模块名；
 *   4. 分级只减少信息密度（徽章 → 文字 → 溢出），不改变导航语义与 URL 行为。
 * ================================================================== */
type TabDensity = 'full' | 'compact' | 'icons' | 'overflow';
const densityOf = (w: number): TabDensity => {
  if (w >= 580) return 'full';
  if (w >= 450) return 'compact';
  if (w >= 400) return 'icons';
  return 'overflow';
};

const TAB_META: Record<DockTabKey, { icon: LucideIcon; hint: string }> = {
  preview: { icon: Play, hint: '画面 · 属性 · 镜头' },
  script: { icon: FileText, hint: '剧本文稿' },
  bible: { icon: BookOpen, hint: '世界观与设定' },
  props: { icon: Box, hint: '道具资产 · 状态变体 · AI 生成' },
  board: { icon: Clapperboard, hint: '分镜与镜头台账' },
  assets: { icon: ImageIcon, hint: '图片 / 视频 / 音频' },
  qc: { icon: ShieldCheck, hint: '质检与问题清单' },
  export: { icon: Download, hint: '成片与交付物' },
};

export const StudioDock = () => {
  const { data, dockTab, setDockTab, projectId, dockW, setDockW } = useStudio();
  const tab = dockTab || 'preview';
  const [dragging, setDragging] = useState(false);
  const [preset, setPreset] = useState<PresetKey>('std');
  const [density, setDensity] = useState<TabDensity>('compact');
  const [menuOpen, setMenuOpen] = useState(false);
  const draggingRef = useRef(false);
  const dockRef = useRef<HTMLElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  /** 恢复上次拖拽的宽度 */
  useEffect(() => {
    try {
      const saved = Number(localStorage.getItem(DOCK_W_KEY));
      if (saved >= DOCK_MIN) {
        setDockW(Math.min(maxDockWidth(), saved));
        setPreset(null);
      }
    } catch {
      /* 隐私模式忽略 */
    }
  }, [setDockW]);

  /** 按右坞自身宽度分级；拖拽时实时跟随，不依赖窗口 resize */
  useEffect(() => {
    const el = dockRef.current;
    if (!el) return;
    const measure = (w: number) => setDensity(densityOf(w));
    measure(el.getBoundingClientRect().width);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (typeof w === 'number' && w > 0) measure(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /** 关闭溢出下拉：切 Tab / 点击外部 / Esc */
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  /** 拖拽左缘把手调整右坞宽度：向下不限、向左可一直拖到舞台仅剩 MIN_STAGE */
  const onResizeStart = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      draggingRef.current = true;
      setDragging(true);
      let last = dockW ?? 548;
      const max = maxDockWidth();
      const move = (ev: PointerEvent) => {
        if (!draggingRef.current) return;
        last = Math.max(DOCK_MIN, Math.min(max, Math.round(window.innerWidth - ev.clientX)));
        setDockW(last);
      };
      const up = () => {
        draggingRef.current = false;
        setDragging(false);
        setPreset(null);
        try {
          localStorage.setItem(DOCK_W_KEY, String(last));
        } catch {
          /* 忽略 */
        }
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    },
    [dockW, setDockW],
  );

  const applyPreset = useCallback(
    (key: PresetKey) => {
      const next = presetWidth(key);
      setDockW(next);
      setPreset(key);
      try {
        if (next === null) localStorage.removeItem(DOCK_W_KEY);
        else localStorage.setItem(DOCK_W_KEY, String(next));
      } catch {
        /* 忽略 */
      }
    },
    [setDockW],
  );

  /** 双击把手：恢复设计稿默认宽度 */
  const onResizeReset = useCallback(() => {
    applyPreset('std');
  }, [applyPreset]);

  const badge = (key: DockTabKey) => {
    if (density !== 'full') return null;
    const n = key === 'board'
      ? data.shotStats.total
      : key === 'qc'
        ? data.jobs.filter((j) => j.status === 'failed').length
        : 0;
    return n ? <span className="tab-count num">{n}</span> : null;
  };

  const selectTab = (key: DockTabKey) => {
    setDockTab(key);
    setMenuOpen(false);
  };

  const renderPane = () => {
    if (tab === 'preview') return <StudioPreview />;
    if (!projectId) {
      return (
        <div className="dp-empty">
          <div className="dp-empty-ico"><FileText size={20} /></div>
          <b>还没有进入项目</b>
          <p>进入一个项目后，这里会显示剧本、圣经、分镜、资产、质检与导出。</p>
        </div>
      );
    }
    switch (tab) {
      case 'script':
        return <StudioScriptTab />;
      case 'bible':
        return <ProjectBibleTab />;
      case 'props':
        return <StudioPropsTab />;
      case 'board':
        return <ProjectStoryboardTab />;
      case 'assets':
        return <ProjectAssetsTab />;
      case 'qc':
        return <ProjectQcTab />;
      case 'export':
        return <ProjectExportTab />;
      default:
        return <StudioPreview />;
    }
  };

  const meta = TAB_META[tab];
  const TabIcon = meta.icon;
  const isPreview = tab === 'preview';
  const visibleTabs = density === 'overflow' ? DOCK_TABS.slice(0, 4) : DOCK_TABS;
  const selectedInMenu = density === 'overflow' && !visibleTabs.some((t) => t.key === tab);
  const currentLabel = DOCK_TABS.find((t) => t.key === tab)?.label ?? '产出';

  return (
    <aside className={`dock density-${density}`} id="dock" ref={dockRef}>
      <div
        className={`dock-resizer${dragging ? ' dragging' : ''}`}
        onPointerDown={onResizeStart}
        onDoubleClick={onResizeReset}
        title="拖拽调整产出坞宽度 · 双击恢复默认"
        role="separator"
        aria-orientation="vertical"
      >
        <span className="dock-grip" />
      </div>

      {/* 一级导航：Tab 条（按右坞宽度分级，见文件头「宽度自适应规范」） */}
      <div className="dock-head">
        <span className="dock-brand">产出</span>
        <div className={`tabs tabs-${density}`} id="tabs" role="tablist" aria-label="产出坞模块">
          {visibleTabs.map((t) => {
            const Icon = TAB_META[t.key].icon;
            return (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={tab === t.key}
                aria-label={t.label}
                className={`tab${tab === t.key ? ' on' : ''}`}
                onClick={() => selectTab(t.key)}
                title={`${t.label} · ${TAB_META[t.key].hint}`}
              >
                <Icon size={13} strokeWidth={1.9} />
                <span className="tab-label">{t.label}</span>
                {badge(t.key)}
              </button>
            );
          })}
        </div>

        {density === 'overflow' ? (
          <div className="dock-menu-wrap" ref={menuRef}>
            <button
              type="button"
              className={`dock-more${menuOpen ? ' on' : ''}${selectedInMenu ? ' has-active' : ''}`}
              onClick={() => setMenuOpen((v) => !v)}
              aria-expanded={menuOpen}
              aria-label={`更多模块${selectedInMenu ? `（当前：${currentLabel}）` : ''}`}
              title={selectedInMenu ? `当前：${currentLabel} · 点击展开全部 8 个模块` : '展开全部 8 个模块'}
            >
              <ChevronDown size={14} strokeWidth={2} />
            </button>
            {menuOpen ? (
              <div className="dock-menu" role="menu">
                <div className="dock-menu-h">全部模块 · 8</div>
                {DOCK_TABS.map((t) => {
                  const Icon = TAB_META[t.key].icon;
                  return (
                    <button
                      key={t.key}
                      type="button"
                      role="menuitem"
                      className={`dock-menu-i${tab === t.key ? ' on' : ''}`}
                      onClick={() => selectTab(t.key)}
                    >
                      <Icon size={14} strokeWidth={1.8} />
                      <span className="dock-menu-lb">{t.label}</span>
                      <span className="dock-menu-hint">{TAB_META[t.key].hint}</span>
                      {badge(t.key)}
                    </button>
                  );
                })}
                <div className="dock-menu-f">拉宽产出坞即可恢复完整标签</div>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* 二级工具条：模块说明 + 宽度预设（所有 Tab 共用） */}
      <div className="dp-topbar">
        <div className="dp-topbar-l">
          <TabIcon size={13} strokeWidth={1.9} />
          <span className="dp-eyebrow">{currentLabel}</span>
          <span className="dp-topbar-sep" />
          <span className="dp-topbar-hint">{meta.hint}</span>
        </div>
        <div className="dp-width" role="group" aria-label="产出坞宽度">
          {WIDTH_PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              className={`dp-width-b${preset === p.key ? ' on' : ''}`}
              onClick={() => applyPreset(p.key)}
              title={
                p.key === 'std'
                  ? '恢复默认宽度（548px）'
                  : `把右坞设为约 ${presetWidth(p.key)}px 宽`
              }
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="dock-body">
        <div className={`pane on${isPreview ? ' pane-pv' : ''}`}>
          {isPreview ? renderPane() : <div className="dp-content">{renderPane()}</div>}
        </div>
      </div>
    </aside>
  );
};
