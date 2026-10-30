import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  Clapperboard,
  LayoutDashboard,
  FolderKanban,
  Palette,
  LayoutTemplate,
  Image,
  Bot,
  UserCircle,
  Settings,
  type LucideIcon,
} from 'lucide-react';

/**
 * 全局右栏标签页状态（AI-EOS 极客模式：全站只有一张三栏屏）
 * ─────────────────────────────────────────────
 * 左栏功能网格 / 旧路由重定向 / ⌘K 命令面板统一通过 openTab 在右栏打开功能签；
 * 右栏 WorkspaceRightDock 按 pageKey 懒渲染真实页面组件。
 * 「产出」签固定存在不可关闭；其余功能签可切换 / 可关闭。
 */

export type WorkspacePageKey =
  | 'dashboard'
  | 'projects'
  | 'styles'
  | 'templates'
  | 'assets'
  | 'ai-assistant'
  | 'account'
  | 'settings';

export interface WorkspacePageMeta {
  key: WorkspacePageKey;
  title: string;
  icon: LucideIcon;
  description: string;
}

/** 左栏功能网格 + ⌘K + 右栏「+」号共用的功能注册表 */
export const WORKSPACE_PAGES: WorkspacePageMeta[] = [
  { key: 'dashboard', title: '数据看板', icon: LayoutDashboard, description: '产出与流水线数据总览' },
  { key: 'projects', title: '我的项目', icon: FolderKanban, description: '全部短剧项目管理' },
  { key: 'styles', title: '风格中心', icon: Palette, description: '画风与视觉风格库' },
  { key: 'templates', title: '模板中心', icon: LayoutTemplate, description: '短剧模板与灵感剧场' },
  { key: 'assets', title: '资产库', icon: Image, description: '图片 / 视频 / 配音资产' },
  { key: 'ai-assistant', title: 'AI助手', icon: Bot, description: '独立 AI 助手对话' },
  { key: 'account', title: '用户中心', icon: UserCircle, description: '账号与会员信息' },
  { key: 'settings', title: '设置', icon: Settings, description: '供应商 / 计费 / 偏好' },
];

export const WORKSPACE_PAGE_MAP: Record<WorkspacePageKey, WorkspacePageMeta> =
  Object.fromEntries(WORKSPACE_PAGES.map((p) => [p.key, p])) as Record<
    WorkspacePageKey,
    WorkspacePageMeta
  >;

export interface WorkspaceTab {
  /** 唯一 key：产出签为 'output'，功能签与 pageKey 同值 */
  key: string;
  title: string;
  icon: LucideIcon;
  pageKey?: WorkspacePageKey;
}

/** 固定产出签：不可关闭（AI-EOS 右栏默认签） */
export const OUTPUT_TAB: WorkspaceTab = {
  key: 'output',
  title: '产出',
  icon: Clapperboard,
};

export interface WorkspaceTabsValue {
  tabs: WorkspaceTab[];
  activeKey: string;
  setActiveKey: (key: string) => void;
  /** 已存在则激活，否则新开并激活 */
  openTab: (key: WorkspacePageKey) => void;
  /** 关闭标签页（产出签不可关；关闭当前签时自动切到相邻签） */
  closeTab: (key: string) => void;
}

const WorkspaceTabsContext = createContext<WorkspaceTabsValue | null>(null);

export const WorkspaceTabsProvider = ({ children }: { children: ReactNode }) => {
  const [tabs, setTabs] = useState<WorkspaceTab[]>([OUTPUT_TAB]);
  const [activeKey, setActiveKey] = useState<string>(OUTPUT_TAB.key);

  const openTab = useCallback((key: WorkspacePageKey) => {
    const meta = WORKSPACE_PAGE_MAP[key];
    if (!meta) return;
    setTabs((prev) => {
      if (prev.some((t) => t.key === key)) return prev;
      return [...prev, { key: meta.key, title: meta.title, icon: meta.icon, pageKey: meta.key }];
    });
    setActiveKey(key);
  }, []);

  const closeTab = useCallback((key: string) => {
    if (key === OUTPUT_TAB.key) return;
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.key === key);
      if (idx < 0) return prev;
      const next = prev.filter((t) => t.key !== key);
      setActiveKey((cur) => {
        if (cur !== key) return cur;
        const fallback = next[Math.max(0, idx - 1)];
        return fallback?.key ?? OUTPUT_TAB.key;
      });
      return next;
    });
  }, []);

  const value = useMemo(
    () => ({ tabs, activeKey, setActiveKey, openTab, closeTab }),
    [tabs, activeKey, openTab, closeTab],
  );

  return <WorkspaceTabsContext.Provider value={value}>{children}</WorkspaceTabsContext.Provider>;
};

export const useWorkspaceTabs = (): WorkspaceTabsValue => {
  const ctx = useContext(WorkspaceTabsContext);
  if (!ctx) throw new Error('useWorkspaceTabs 必须在 WorkspaceTabsProvider 内使用');
  return ctx;
};
