/**
 * Studio · 项目功能条（重设计）
 * -------------------------------------------------------------
 * 把右坞之外的既有页面按「创作 / 设定 / 生产 / 运维」分组接进来，
 * 保证「换 UI 不丢功能」。全部走真实路由 /project/:id/<seg>。
 *
 * 宽度自适应与右坞 Tab 条采用同一套设计标准（按自身容器宽度分级）：
 *   ≥ 760px  full      图标 + 文字 + 分组竖线，9 项全平铺
 *   460–759  compact   保留图标 + 文字，去掉分组竖线与分组留白
 *   320–459  icons     只留图标，9 项全平铺，选中项带品牌红指示线
 *   < 320    overflow  前 3 个图标 + 「更多」下拉（含全部 9 项的完整名称）
 * 不变式：任何宽度下 9 个入口都可达，不做隐藏滚动条的静默裁切。
 *
 * 「时间线」是外壳动作项，不是内容页：点击直接展开底部真时间线
 * （EDL / timeline_clips 是唯一数据源），避免旧假页与底部时间线各写各的。
 */
import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useStudio } from './StudioShell';
import {
  Bot,
  ChevronDown,
  Clock,
  LayoutDashboard,
  ListTodo,
  MapPin,
  PenTool,
  Users,
  Video,
  Workflow,
} from 'lucide-react';

interface Section {
  seg: string;
  label: string;
  group: string;
  icon: React.ReactNode;
  title: string;
  /** 外壳动作：不切 URL，直接展开底部真时间线 */
  action?: 'timeline';
}

const SECTIONS: Section[] = [
  { seg: 'overview', label: '概览', group: '创作', icon: <LayoutDashboard />, title: '项目整体进度、成本与快捷入口' },
  { seg: 'flow', label: '流程总控', group: '创作', icon: <Workflow />, title: '九段流水线总控：确认门一键通过' },
  { seg: 'characters', label: '人物', group: '设定', icon: <Users />, title: '角色外貌、参考图与配音音色' },
  { seg: 'scenes', label: '场景', group: '设定', icon: <MapPin />, title: '场地设定与场景概念图' },
  { seg: 'director', label: '导演台', group: '生产', icon: <Video />, title: '景别 / 机位 / 焦段 / 运镜调节' },
  {
    seg: 'timeline',
    label: '时间线',
    group: '生产',
    icon: <Clock />,
    title: '展开底部多轨时间线 · EDL 落库，可修剪 / 加字幕音频 / 分割 / 导出成片',
    action: 'timeline',
  },
  { seg: 'agents', label: 'AI助手', group: '运维', icon: <Bot />, title: '8 大影视工种智能体协同对话' },
  { seg: 'tasks', label: '任务队列', group: '运维', icon: <ListTodo />, title: '后台生成队列进度、重试与取消' },
];

const CANVAS: Section = {
  seg: 'canvas-free3',
  label: '自由画布',
  group: '画布',
  icon: <PenTool />,
  title: '旗舰自由画布（沉浸全屏）',
};

type NavDensity = 'full' | 'compact' | 'icons' | 'overflow';
const densityOf = (w: number): NavDensity => {
  if (w >= 760) return 'full';
  if (w >= 460) return 'compact';
  if (w >= 320) return 'icons';
  return 'overflow';
};

export const ProjectSectionNav = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { setTlCollapsed } = useStudio();
  const [density, setDensity] = useState<NavDensity>('full');
  const [menuOpen, setMenuOpen] = useState(false);
  /** 点「时间线」后的短暂高亮，明确告诉用户入口在底部面板 */
  const [pulse, setPulse] = useState(false);
  const pulseTimer = useRef<number | null>(null);
  const navRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(
    () => () => {
      if (pulseTimer.current) window.clearTimeout(pulseTimer.current);
    },
    [],
  );

  const m = location.pathname.match(/^\/project\/([^/]+)(?:\/([^/]+))?/);
  const projectId = m?.[1];
  const seg = m?.[2] ?? '';

  useEffect(() => {
    const el = navRef.current;
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
  }, [projectId]);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false); };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  if (!projectId) return null;

  const go = (s: Section) => {
    setMenuOpen(false);
    if (s.action === 'timeline') {
      // 一个入口、一个数据源：只操作底部真时间线，不再跳到会写 shots.duration 的旧页
      setTlCollapsed(false);
      window.dispatchEvent(new CustomEvent('yimu:timeline-focus'));
      setPulse(true);
      if (pulseTimer.current) window.clearTimeout(pulseTimer.current);
      pulseTimer.current = window.setTimeout(() => setPulse(false), 2200);
      return;
    }
    navigate(`/project/${projectId}/${s.seg}`);
  };
  const all = [...SECTIONS, CANVAS];
  const visible = density === 'overflow' ? all.slice(0, 3) : all;
  const selectedInMenu = density === 'overflow' && !visible.some((s) => s.seg === seg);
  const current = all.find((s) => s.seg === seg)?.label;

  const item = (s: Section) => (
    <button
      key={s.seg}
      type="button"
      className={`secnav-i${!s.action && seg === s.seg ? ' on' : ''}${s.action === 'timeline' && pulse ? ' pulse' : ''}${s.seg === CANVAS.seg ? ' secnav-primary' : ''}`}
      title={s.title}
      aria-label={s.label}
      aria-current={!s.action && seg === s.seg ? 'page' : undefined}
      onClick={() => go(s)}
    >
      {s.icon}
      <span className="secnav-label">{s.label}</span>
    </button>
  );

  return (
    <div
      className={`secnav secnav-${density}`}
      role="navigation"
      aria-label="项目功能"
      ref={navRef}
    >
      {visible.map((s, i) => (
        <span className="secnav-cell" key={s.seg}>
          {density === 'full' && i > 0 && visible[i - 1].group !== s.group ? (
            <span className="secnav-g" aria-hidden="true" />
          ) : null}
          {item(s)}
        </span>
      ))}

      {density === 'overflow' ? (
        <div className="secnav-menu-wrap" ref={menuRef}>
          <button
            type="button"
            className={`secnav-more${menuOpen ? ' on' : ''}${selectedInMenu ? ' has-active' : ''}`}
            onClick={() => setMenuOpen((v) => !v)}
            aria-expanded={menuOpen}
            title={selectedInMenu ? `当前：${current} · 展开全部功能` : '展开全部功能'}
            aria-label="更多项目功能"
          >
            <ChevronDown size={14} />
          </button>
          {menuOpen ? (
            <div className="secnav-menu" role="menu">
              <div className="secnav-menu-h">项目功能 · 9</div>
              {all.map((s) => (
                <button
                  key={s.seg}
                  type="button"
                  role="menuitem"
                  className={`secnav-menu-i${!s.action && seg === s.seg ? ' on' : ''}`}
                  onClick={() => go(s)}
                >
                  {s.icon}
                  <span>{s.label}</span>
                  <em>{s.action === 'timeline' ? '底部面板' : s.group}</em>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};
