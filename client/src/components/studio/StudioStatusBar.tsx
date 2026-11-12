/**
 * Studio · 底 IDE 状态栏
 * -------------------------------------------------------------
 * 全部真实数据：
 *   连接状态   —— 后端可达即「已连接」
 *   任务       —— generationJobs 的 running / queued 计数
 *   通道       —— 当前任务实际使用的 providerName
 *   预算       —— /api/dashboard/cost-summary 的月度花费与上限
 */
import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStudio } from './StudioShell';
import { APP_VERSION } from '@client/src/lib/version';

export const StudioStatusBar = () => {
  const { data } = useStudio();
  const navigate = useNavigate();

  const running = useMemo(
    () => data.jobs.filter((j) => j.status === 'running').length,
    [data.jobs],
  );
  const queued = useMemo(
    () => data.jobs.filter((j) => j.status === 'queued' || j.status === 'pending').length,
    [data.jobs],
  );
  const channel = useMemo(() => {
    const withProvider = data.jobs.find((j) => j.providerName)?.providerName;
    if (withProvider) return withProvider;
    if (data.worker?.mode) {
      return data.worker.mode === 'bullmq' ? 'BullMQ 队列' : '进程内队列';
    }
    return '—';
  }, [data.jobs, data.worker]);

  const monthly = data.cost?.monthlyCost ?? 0;
  const cap = data.cost?.budgetCap ?? null;

  return (
    <footer className="statusbar">
      <span className="sb">
        <span className="dot run" />
        <b className="sb-ok">已连接</b>
      </span>
      {/* 排队数字可点：多项目并行时一键直达全站排队页看真实执行顺序 */}
      <button
        type="button"
        className="sb hoverable"
        title="点击打开全站排队：查看跨项目执行顺序，可暂停 / 终止 / 调整顺序"
        onClick={() => navigate('/queue')}
      >
        任务 <b className="num">{running}</b> 运行中 / <b className="num">{queued}</b> 排队
      </button>
      <span className="sb hoverable">
        通道 <b>{channel}</b>
      </span>
      <span className="sb hoverable">
        预算 <b className="num">¥{monthly.toFixed(2)}</b>
        {cap !== null ? (
          <>
            {' / '}
            <span className="num">¥{cap}</span>
          </>
        ) : null}
      </span>
      <span className="sb hoverable">
        镜头 <b className="num">{data.shotStats.total}</b> · 已渲{' '}
        <b className="num">{data.shotStats.done}</b>
      </span>
      <span className="grow" />
      <button
        type="button"
        className="sb hoverable"
        title="点击打开命令面板（⌘K）可切换界面模式"
        onClick={() =>
          window.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true }),
          )
        }
      >
        方案 <b className="sb-accent">F</b>
      </button>
      <span className="sb hoverable">
        <span className="kbd">[</span> <span className="kbd">]</span>{' '}
        <span className="kbd">\</span> <span className="kbd">G</span>{' '}
        <span className="kbd">←→</span>
      </span>
      <span className="sb">v{APP_VERSION || '3.4.3'}</span>
    </footer>
  );
};
