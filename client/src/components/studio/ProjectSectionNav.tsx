/**
 * Studio · 项目功能条
 * -------------------------------------------------------------
 * 方案 F 的右产出坞只有 7 个 Tab（预览/剧本/圣经/分镜/资产/质检/导出），
 * 而项目里还有一批既有页面（概览 / 流程总控 / 人物 / 场景 / 导演台 / 时间线 /
 * AI助手 / 任务队列）。这里用一条紧凑的功能条把它们接进来，
 * 保证「换 UI 不丢功能」。
 *
 * 全部走真实路由（/project/:id/<seg>），刷新与分享链接都能落到同一页。
 */
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Bot,
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
  icon: React.ReactNode;
  title: string;
}

export const ProjectSectionNav = () => {
  const navigate = useNavigate();
  const location = useLocation();

  const m = location.pathname.match(/^\/project\/([^/]+)(?:\/([^/]+))?/);
  const projectId = m?.[1];
  const seg = m?.[2] ?? '';

  if (!projectId) return null;

  const sections: Section[] = [
    { seg: 'overview', label: '概览', icon: <LayoutDashboard />, title: '项目整体进度、成本与快捷入口' },
    { seg: 'flow', label: '流程总控', icon: <Workflow />, title: '九段流水线总控：确认门一键通过' },
    { seg: 'characters', label: '人物', icon: <Users />, title: '角色外貌、参考图与配音音色' },
    { seg: 'scenes', label: '场景', icon: <MapPin />, title: '场地设定与场景概念图' },
    { seg: 'director', label: '导演台', icon: <Video />, title: '景别 / 机位 / 焦段 / 运镜调节' },
    { seg: 'timeline', label: '时间线', icon: <Clock />, title: '五轨时间线：按秒拖拽调整节奏' },
    { seg: 'agents', label: 'AI助手', icon: <Bot />, title: '8 大影视工种智能体协同对话' },
    { seg: 'tasks', label: '任务队列', icon: <ListTodo />, title: '后台生成队列进度、重试与取消' },
  ];

  return (
    <div className="secnav" role="navigation" aria-label="项目功能">
      {sections.map((s) => (
        <button
          key={s.seg}
          type="button"
          className={`secnav-i${seg === s.seg ? ' on' : ''}`}
          title={s.title}
          onClick={() => navigate(`/project/${projectId}/${s.seg}`)}
        >
          {s.icon}
          {s.label}
        </button>
      ))}
      <span className="secnav-sep" />
      <button
        type="button"
        className="secnav-i"
        title="旗舰自由画布（沉浸全屏）"
        onClick={() => navigate(`/project/${projectId}/canvas-free3`)}
      >
        <PenTool />
        自由画布
      </button>
    </div>
  );
};
