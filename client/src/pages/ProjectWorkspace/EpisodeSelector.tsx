import { useNavigate, useParams } from 'react-router-dom';
import { Film, Plus, Settings2 } from 'lucide-react';
import { useEpisodeScope } from './EpisodeContext';

/** 集状态 → 展示文案（与 episodes.service 状态机一致） */
const EP_STATUS_LABELS: Record<string, string> = {
  draft: '草稿',
  script_ready: '剧本就绪',
  shots_ready: '分镜就绪',
  video_generating: '生成中',
  completed: '已完成',
};

const epLabel = (number: number, title?: string | null) =>
  `第 ${number} 集${title ? ` · ${title}` : ''}`;

/**
 * 顶部剧集选择器（长篇多集项目专属；has_episodes=false 不渲染，旧项目零打扰）：
 * 集号下拉（切换即激活）+ 「+ 新建集」（服务端自动递增集号）+ 管理入口（概览）。
 */
const EpisodeSelector = () => {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const { hasEpisodes, episodes, activeEpisodeId, activeEpisode, setActiveEpisodeId, createEpisode, creating } =
    useEpisodeScope();

  if (!hasEpisodes) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card px-3 py-2">
      <span className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
        <Film className="h-3.5 w-3.5 text-primary" /> 剧集
      </span>
      <select
        value={activeEpisodeId ?? ''}
        onChange={(e) => setActiveEpisodeId(e.target.value)}
        className="rounded-lg border border-input bg-background px-2.5 py-1.5 text-xs font-medium text-foreground outline-none focus:border-primary"
        aria-label="选择剧集"
      >
        {episodes.length === 0 && <option value="">（暂无集）</option>}
        {episodes.map((e) => (
          <option key={e.id} value={e.id}>
            {epLabel(e.number, e.title)}
          </option>
        ))}
      </select>
      {activeEpisode && (
        <span className="pill pill-neutral text-[11px]">
          {EP_STATUS_LABELS[activeEpisode.status] ?? activeEpisode.status}
        </span>
      )}
      <button
        onClick={() => void createEpisode()}
        disabled={creating}
        className="inline-flex items-center gap-1 rounded-lg border border-primary/40 bg-primary/5 px-2.5 py-1.5 text-xs font-medium text-primary hover:bg-primary/10 disabled:opacity-50"
      >
        <Plus className="h-3.5 w-3.5" /> 新建集
      </button>
      <button
        onClick={() => id && navigate(`/project/${id}`)}
        className="inline-flex items-center gap-1 rounded-lg border border-input px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted"
        title="在概览中管理集（重命名/删除）"
      >
        <Settings2 className="h-3.5 w-3.5" /> 管理集
      </button>
      <span className="text-[11px] text-muted-foreground/70">
        切换集后，分镜 / 场景 / 人物按集加载
      </span>
    </div>
  );
};

export default EpisodeSelector;
