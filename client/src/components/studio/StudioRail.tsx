/**
 * Studio · 左导航轨
 * -------------------------------------------------------------
 * 数据全部来自真实后端：
 *   · 「进行中」= /api/projects 的项目列表（状态映射为 chip）
 *   · 「任务队列」= /api/generation/jobs 的实时任务（含 SSE 推送）
 *   · 「用量与预算」= 项目累计花费（projects.totalCost）
 */
import { useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { APP_VERSION } from '@client/src/lib/version';
import {
  Clock,
  Coins,
  FolderOpen,
  Image as ImageIcon,
  LayoutGrid,
  LayoutTemplate,
  MessageSquare,
  Network,
  Palette,
  Plus,
  Settings,
  Sparkles,
  ScrollText,
  ClipboardCheck,
} from 'lucide-react';
import { getAvatarInitial, getNickname } from '@client/src/lib/identity';
import { useStudio } from './StudioShell';
import { projectStatusMeta } from './projectStatus';

export const StudioRail = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { data, stageView, setStageView, sel, projectId, chatMsgs, openNewWork } = useStudio();

  const runningJobs = useMemo(
    () => data.jobs.filter((j) => j.status === 'running' || j.status === 'queued' || j.status === 'retrying'),
    [data.jobs],
  );
  const failedJobs = useMemo(() => data.jobs.filter((j) => j.status === 'failed'), [data.jobs]);
  const totalCost = useMemo(
    () => data.projects.reduce((sum, p) => sum + (p.totalCost ?? 0), 0),
    [data.projects],
  );

  const activeProjectId = location.pathname.match(/^\/project\/([^/]+)/)?.[1];

  const navItem = (
    key: string,
    icon: React.ReactNode,
    label: string,
    onClick: () => void,
    badge?: { text: string; hot?: boolean },
    active = false,
  ) => (
    <div
      key={key}
      className={`nav-i${active ? ' on' : ''}`}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
      title={label}
    >
      {icon}
      <span className="nav-txt">{label}</span>
      {badge ? (
        <span className={`nav-badge num${badge.hot ? ' hot' : ''}`}>{badge.text}</span>
      ) : null}
    </div>
  );

  return (
    <aside className="rail" id="rail">
      <div className="rail-head">
        <div className="mark">
          <img src="/brand/mark.png" alt="一幕 YIMU" />
        </div>
        <div className="mark-txt">一幕</div>
        <div className="mark-sub">v{APP_VERSION || '3.4.3'}</div>
        <button
          type="button"
          className="rail-new"
          title="新建对话：先聊清楚方向，再创建作品"
          aria-label="新建对话"
          onClick={() => openNewWork()}
        >
          <Plus />
        </button>
      </div>

      <div className="rail-body">
        {/* ---------- 视图切换 ---------- */}
        <div className="grp">
          <div className="grp-label">视图</div>
          {navItem(
            'chat',
            <MessageSquare className="ico" />,
            // 顶部入口：未进入项目时是「新建对话」，进入项目后跟随会话状态
            projectId ? (chatMsgs.length > 0 ? '进行中的对话' : '对话') : '新建对话',
            () => {
              if (!projectId) {
                openNewWork();
                return;
              }
              setStageView('chat');
              if (location.pathname !== `/project/${projectId}`) {
                navigate(`/project/${projectId}`);
              }
            },
            undefined,
            !!projectId && stageView === 'chat',
          )}
          {projectId &&
            navItem(
              'canvas',
              <Network className="ico" />,
              '自由画布',
              () => navigate(`/project/${projectId}/canvas-free3`),
              data.shotStats.total ? { text: String(data.shotStats.total) } : undefined,
              location.pathname === `/project/${projectId}/canvas-free3`,
            )}
        </div>

        {/* ---------- 主导航 ---------- */}
        <div className="grp">
          {navItem(
            'workbench',
            <LayoutGrid className="ico" />,
            '工作台',
            () => navigate('/'),
            undefined,
            // 对话视图已经高亮，避免两处同时点亮
            location.pathname === '/' && !activeProjectId && stageView !== 'chat',
          )}
          {navItem(
            'projects',
            <FolderOpen className="ico" />,
            '我的项目',
            () => navigate('/projects'),
            data.projects.length ? { text: String(data.projects.length) } : undefined,
            location.pathname === '/projects',
          )}
          {navItem('create', <Sparkles className="ico" />, '一键创作', () => navigate('/create'))}
          {navItem(
            'canvases',
            <Network className="ico" />,
            '画布模式',
            () => navigate('/canvases'),
            undefined,
            location.pathname === '/canvases',
          )}
          {navItem(
            'templates',
            <LayoutTemplate className="ico" />,
            '模板中心',
            () => navigate('/templates'),
            undefined,
            location.pathname === '/templates',
          )}
          {navItem(
            'styles',
            <Palette className="ico" />,
            '风格中心',
            () => navigate('/styles'),
            undefined,
            location.pathname === '/styles',
          )}
          {navItem(
            'assets',
            <ImageIcon className="ico" />,
            '资产库',
            () => navigate('/assets'),
          )}
          {navItem('assistant', <Sparkles className="ico" />, 'AI助手', () => navigate('/ai-assistant'))}
          {navItem(
            'settings',
            <Settings className="ico" />,
            '设置',
            () => navigate('/settings'),
          )}
          {navItem(
            'system-logs',
            <ScrollText className="ico" />,
            '系统日志',
            () => navigate('/system-logs'),
            failedJobs.length ? { text: String(failedJobs.length) } : undefined,
            location.pathname === '/system-logs',
          )}
        </div>

        {/* ---------- 进行中的项目（真实数据） ---------- */}
        <div className="grp">
          <div className="grp-label">进行中 · {data.projects.length}</div>
          {data.projects.length === 0 ? (
            <div className="nav-i" style={{ cursor: 'default', color: 'var(--fg-4)' }}>
              <span className="nav-txt">暂无项目</span>
            </div>
          ) : (
            data.projects.slice(0, 12).map((p) => {
              const chip = projectStatusMeta(p.status);
              const running = chip.cls === 'run';
              return (
                <div
                  key={p.id}
                  className={`proj${activeProjectId === p.id ? ' on' : ''}`}
                  onClick={() => navigate(`/project/${p.id}`)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') navigate(`/project/${p.id}`);
                  }}
                  title={p.title}
                >
                  <div className="proj-top">
                    <span className={`proj-dot${running ? ' run' : ''}`} />
                    <span className="proj-name">{p.title}</span>
                  </div>
                  <div className="proj-meta">
                    <span className={`chip${chip.cls === 'idle' ? '' : ` ${chip.cls}`}`}>
                      {chip.text}
                    </span>
                    <span className="proj-pct num">
                      {p.totalCost ? `¥${p.totalCost.toFixed(2)}` : '—'}
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* ---------- 任务队列（真实数据） ---------- */}
        <div className="grp">
          <div className="grp-label">任务队列</div>
          {navItem(
            'jobs',
            <Clock className="ico" />,
            '生成任务',
            () => navigate(projectId ? `/project/${projectId}/tasks` : '/projects'),
            runningJobs.length
              ? { text: String(runningJobs.length), hot: true }
              : undefined,
          )}
          {navItem(
            'qc',
            <ClipboardCheck className="ico" />,
            '质检报告',
            () => navigate(projectId ? `/project/${projectId}/qc` : '/projects'),
            failedJobs.length ? { text: String(failedJobs.length) } : undefined,
          )}
          {navItem(
            'budget',
            <Coins className="ico" />,
            '用量与预算',
            () => navigate('/dashboard'),
            totalCost ? { text: `¥${totalCost.toFixed(0)}` } : undefined,
          )}
        </div>
      </div>

      <button
        type="button"
        className="rail-foot"
        title={`${getNickname()} · 进入用户中心`}
        onClick={() => navigate('/account')}
      >
        <div className="avatar">{getAvatarInitial(getNickname())}</div>
        <div className="who">
          <div className="who-n">{getNickname()}</div>
          <div className="who-r">PRO · 单机版</div>
        </div>
      </button>
    </aside>
  );
};
