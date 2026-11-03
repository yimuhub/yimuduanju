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
import {
  Clock,
  Coins,
  FolderOpen,
  Image as ImageIcon,
  LayoutGrid,
  LayoutTemplate,
  MessageSquare,
  Network,
  Settings,
  Sparkles,
  ClipboardCheck,
} from 'lucide-react';
import type { ProjectStatus } from '@shared/api.interface';
import { useStudio } from './StudioShell';

/** 项目状态 → (chip 样式, 文案) */
function projectChip(status: ProjectStatus): { cls: 'ok' | 'run' | 'warn' | ''; text: string } {
  switch (status) {
    case 'video_generating':
    case 'assets_generating':
    case 'audio_generating':
    case 'parsing':
    case 'planning':
    case 'editing':
      return { cls: 'run', text: '生产中' };
    case 'bible_ready':
      return { cls: '', text: '设定就绪' };
    case 'storyboard_ready':
      return { cls: 'ok', text: '分镜就绪' };
    case 'qc':
      return { cls: 'warn', text: '质检中' };
    case 'ready':
      return { cls: 'ok', text: '成片就绪' };
    case 'exported':
      return { cls: 'ok', text: '已导出' };
    case 'failed':
      return { cls: 'warn', text: '失败' };
    default:
      return { cls: '', text: '草稿' };
  }
}

export const StudioRail = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { data, stageView, setStageView, sel, projectId } = useStudio();

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
        <div className="mark">幕</div>
        <div className="mark-txt">一幕</div>
        <div className="mark-sub">v3.4.2</div>
      </div>

      <div className="rail-body">
        {/* ---------- 视图切换 ---------- */}
        <div className="grp">
          <div className="grp-label">视图</div>
          {navItem(
            'chat',
            <MessageSquare className="ico" />,
            '对话',
            () => {
              setStageView('chat');
              if (!projectId && location.pathname !== '/') navigate('/');
            },
            undefined,
            stageView === 'chat',
          )}
          {navItem(
            'canvas',
            <Network className="ico" />,
            '无限画布',
            () => {
              setStageView('canvas');
              if (!projectId && location.pathname !== '/') navigate('/');
            },
            data.shotStats.total ? { text: String(data.shotStats.total) } : undefined,
            stageView === 'canvas',
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
            'templates',
            <LayoutTemplate className="ico" />,
            '模板中心',
            () => navigate('/templates'),
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
              const chip = projectChip(p.status);
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
                    <span className={`chip${chip.cls ? ` ${chip.cls}` : ''}`}>{chip.text}</span>
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

      <div className="rail-foot">
        <div className="avatar">幕</div>
        <div className="who">
          <div className="who-n">
            {localStorage.getItem('yimu.account.nickname') || '一幕用户'}
          </div>
          <div className="who-r">PRO · 单机版</div>
        </div>
      </div>
    </aside>
  );
};
