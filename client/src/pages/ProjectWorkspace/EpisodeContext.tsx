import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { Episode, Project } from '@shared/api.interface';
import { episodes as episodesApi } from '@client/src/api';
import { toast } from 'sonner';
import { logger } from '@client/src/utils/logger';

/**
 * 剧集导航作用域（长篇多集架构，migration 0024）：
 * - 仅当项目 has_episodes=true 时 Provider 才会加载集列表；
 * - has_episodes=false 的项目走完全原路径（episodes 为空、activeEpisodeId 为 null），
 *   各 Tab 据此回落项目级查询，硬向后兼容；
 * - 选择集即调 activate：写 project.metadata.activeEpisodeId，后续新建 shots 自动归入。
 */
export interface EpisodeScopeValue {
  hasEpisodes: boolean;
  episodes: Episode[];
  activeEpisodeId: string | null;
  activeEpisode: Episode | null;
  /** 切换当前集（持久化为活跃集）；传 '' 清除本地选择 */
  setActiveEpisodeId: (id: string) => void;
  /** 新建集（服务端季内自动递增集号），成功后自动切换到新集 */
  createEpisode: (title?: string) => Promise<Episode | null>;
  reload: () => Promise<void>;
  creating: boolean;
  loading: boolean;
}

const EpisodeScopeContext = createContext<EpisodeScopeValue | null>(null);

export const EpisodeScopeProvider = ({
  project,
  children,
}: {
  project: Project | null;
  children: React.ReactNode;
}) => {
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [activeEpisodeId, setActive] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const hasEpisodes = project?.hasEpisodes === true;
  const loadedOnce = useRef(false);

  const reload = useCallback(async () => {
    if (!project) return;
    setLoading(true);
    try {
      const list = await episodesApi.listEpisodes(project.id);
      setEpisodes(list);
    } catch (err) {
      logger.error('Load episodes failed:', String(err));
    } finally {
      setLoading(false);
    }
  }, [project]);

  useEffect(() => {
    if (!hasEpisodes) {
      // 关集模式：清空，保证旧项目行为与 3.8.x 一致
      setEpisodes([]);
      setActive(null);
      loadedOnce.current = false;
      return;
    }
    if (!project || loadedOnce.current) return;
    loadedOnce.current = true;
    void reload().then(() => {
      // 默认选中项目记录的活跃集；无记录则选第 1 集
      const saved = project.metadata?.activeEpisodeId;
      setActive((cur) => cur ?? saved ?? null);
    });
  }, [hasEpisodes, project, reload]);

  // 项目元数据里的活跃集变化（如另一端切换）且本地未手动选过时跟随
  useEffect(() => {
    if (!hasEpisodes || !project) return;
    const saved = project.metadata?.activeEpisodeId ?? null;
    setActive((cur) => (cur === null ? saved : cur));
  }, [hasEpisodes, project]);

  // 活跃集被外部删除时回落到第 1 集
  useEffect(() => {
    if (!hasEpisodes || activeEpisodeId === null) return;
    if (episodes.length > 0 && !episodes.some((e) => e.id === activeEpisodeId)) {
      setActive(episodes[0].id);
    }
  }, [hasEpisodes, episodes, activeEpisodeId]);

  const setActiveEpisodeId = useCallback(
    (id: string) => {
      setActive(id || null);
      if (!project || !id) return;
      // 选择即激活：写回活跃集，保证新建 shots 自动归入当前集
      episodesApi.activateEpisode(project.id, id).catch((err) => {
        logger.error('Activate episode failed:', String(err));
        toast.error('切换活跃集失败');
      });
    },
    [project],
  );

  const createEpisode = useCallback(
    async (title?: string): Promise<Episode | null> => {
      if (!project) return null;
      setCreating(true);
      try {
        const created = await episodesApi.createEpisode(project.id, title ? { title } : {});
        toast.success(`已创建第 ${created.number} 集`);
        await reload();
        setActive(created.id);
        return created;
      } catch (err) {
        logger.error('Create episode failed:', String(err));
        toast.error('新建集失败');
        return null;
      } finally {
        setCreating(false);
      }
    },
    [project, reload],
  );

  const value = useMemo<EpisodeScopeValue>(() => {
    const activeEpisode = episodes.find((e) => e.id === activeEpisodeId) ?? null;
    return {
      hasEpisodes,
      episodes,
      activeEpisodeId: hasEpisodes ? activeEpisodeId : null,
      activeEpisode,
      setActiveEpisodeId,
      createEpisode,
      reload,
      creating,
      loading,
    };
  }, [hasEpisodes, episodes, activeEpisodeId, setActiveEpisodeId, createEpisode, reload, creating, loading]);

  return <EpisodeScopeContext.Provider value={value}>{children}</EpisodeScopeContext.Provider>;
};

export const useEpisodeScope = (): EpisodeScopeValue => {
  const ctx = useContext(EpisodeScopeContext);
  if (!ctx) {
    // Provider 缺失（理论上不会发生）：回落关集模式
    return {
      hasEpisodes: false,
      episodes: [],
      activeEpisodeId: null,
      activeEpisode: null,
      setActiveEpisodeId: () => undefined,
      createEpisode: async () => null,
      reload: async () => undefined,
      creating: false,
      loading: false,
    };
  }
  return ctx;
};
