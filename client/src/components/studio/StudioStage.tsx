/**
 * Studio · 中舞台
 * -------------------------------------------------------------
 * 三种视图互斥：
 *   chat   对话视图（StudioChat）—— 与 Agent 对话、一键开拍
 *   canvas 画布入口已统一指向「自由画布」（/project/:id/canvas-free3，全屏沉浸，见 StudioShell），
 *           中舞台不再渲染内嵌画布，canvas 段落到对话视图
 *   page   内容页 —— 复用现有项目页签（流程总控 / 概览 / 人物 / 场景 / 导演台 / AI助手 / 任务队列）；
 *           时间线不再是内容页，而是常驻底部的 EDL 面板
 *
 * 头部为面包屑 + 生产链状态 pill；进入项目后追加一条「项目功能条」，
 * 让方案 F 右坞之外的既有页面也能被完整触达。
 */
import type { ReactNode } from 'react';
import type { ProjectStatus } from '@shared/api.interface';
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
  '/canvases': '画布模式',
};

/** 项目状态 → 舞台头部状态文案（确认门等待也算「阶段已到」） */
const PROJECT_STATUS_TEXT: Partial<Record<ProjectStatus, string>> = {
  draft: '待启动',
  parsing: '剧本解析中',
  planning: '制作规划中',
  bible_ready: '设定就绪',
  storyboard_ready: '分镜就绪',
  assets_generating: '资产生产中',
  video_generating: '视频生产中',
  audio_generating: '音频生产中',
  editing: '剪辑中',
  qc: '质检中',
};

export const StudioStage = ({ children }: { children?: ReactNode }) => {
  const { data, stageView, projectId } = useStudio();
  const location = useLocation();
  const project = data.project;

  const crumbTitle = project?.title ?? PAGE_TITLES[location.pathname] ?? '工作台';

  const progress = data.progress?.overallProgress ?? 0;
  const running = data.shotStats.render > 0 || (data.jobs ?? []).some((j) => j.status === 'running');

  // 以项目状态为准：不能只用「已渲镜头数」判断，否则剧本/分镜就绪、正等确认门的项目
  // 会一直显示「待启动」，用户会误以为流程没往前走
  const statusText = project
    ? running
      ? '生产链运行中'
      : project.status === 'ready' || project.status === 'exported'
        ? '生产链已完成'
        : project.status === 'failed'
          ? '生产链失败'
          : PROJECT_STATUS_TEXT[project.status] ?? '待启动'
    : '未进入项目';

  const showPage = stageView === 'page' && !!children;
  // 工作台首页不再重复「工作台 / 工作台」，只在非首页时给上一级
  const crumbRoot = project ? '我的项目' : crumbTitle === '工作台' ? null : '工作台';

  return (
    <section className="stage">
      <div className="stage-head">
        <div className="crumb">
          {crumbRoot ? (
            <>
              <span className="crumb-t">{crumbRoot}</span>
              <span className="crumb-sep">/</span>
            </>
          ) : null}
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
        {/* 画布体验统一走全屏自由画布（canvas-free3）；中舞台在 page/chat 之间切换。
            内容页包进 .studio-page（flex:1 + min-height:0 + overflow-y:auto）：
            stage-body 本身 overflow:hidden，若不包滚动容器，窗口小于内容时下方会被裁切且无法滚动 */}
        {showPage ? <div className="studio-page">{children}</div> : <StudioChat />}
      </div>
    </section>
  );
};
