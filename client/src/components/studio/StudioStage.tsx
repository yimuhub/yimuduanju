/**
 * Studio · 中舞台
 * -------------------------------------------------------------
 * 三种视图互斥：
 *   chat   对话视图（StudioChat）—— 与 Agent 对话、一键开拍
 *   canvas 画布入口已统一指向「自由画布」（/project/:id/canvas-free3，全屏沉浸，见 StudioShell），
 *           中舞台不再渲染内嵌画布，canvas 段落到对话视图
 *   page   内容页 —— 复用现有项目页签（流程总控 / 概览 / 人物 / 场景 / 导演台 / 时间线 / AI助手 / 任务队列）
 *
 * 头部为面包屑 + 生产链状态 pill；进入项目后追加一条「项目功能条」，
 * 让方案 F 右坞之外的既有页面也能被完整触达。
 */
import type { ReactNode } from 'react';
import { Search } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { useStudio } from './StudioShell';
import { StudioChat } from './StudioChat';
import { ProjectSectionNav } from './ProjectSectionNav';

/** 全局页面的面包屑标题（无项目时用） */
const PAGE_TITLES: Record<string, string> = {
  '/': '工作台',
  '/projects': '我的项目',
  '/templates': '模板中心',
  '/styles': '风格库',
  '/assets': '资产库',
  '/ai-assistant': 'AI助手',
  '/account': '账户',
  '/settings': '设置',
  '/dashboard': '用量与预算',
  '/create': '一键创作',
};

export const StudioStage = ({ children }: { children?: ReactNode }) => {
  const { data, stageView, projectId } = useStudio();
  const location = useLocation();
  const project = data.project;

  const crumbTitle = project?.title ?? PAGE_TITLES[location.pathname] ?? '工作台';

  const progress = data.progress?.overallProgress ?? 0;
  const running = data.shotStats.render > 0 || (data.jobs ?? []).some((j) => j.status === 'running');

  const statusText = project
    ? running
      ? '生产链运行中'
      : data.shotStats.done > 0
        ? '生产链已完成'
        : '待启动'
    : '未进入项目';

  const showPage = stageView === 'page' && !!children;

  return (
    <section className="stage">
      <div className="stage-head">
        <div className="crumb">
          <span className="crumb-t">{project ? '我的项目' : '工作台'}</span>
          <span className="crumb-sep">/</span>
          <span className="crumb-t on">{crumbTitle}</span>
        </div>
        <div className="spacer" />
        {projectId ? (
          <span className="pill">
            <span className={`dot${running ? ' run' : ''}`} />
            {statusText} <span className="num">{Math.round(progress)}%</span>
          </span>
        ) : null}
        <button type="button" className="icon-btn" title="命令面板 ⌘K" aria-label="命令面板">
          <Search />
        </button>
      </div>

      {projectId ? <ProjectSectionNav /> : null}

      <div className="stage-body">
        {/* 画布体验统一走全屏自由画布（canvas-free3）；中舞台在 page/chat 之间切换 */}
        {showPage ? children : <StudioChat />}
      </div>
    </section>
  );
};
