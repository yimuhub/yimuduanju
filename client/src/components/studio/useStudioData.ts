/**
 * Studio · 数据接入层
 * -------------------------------------------------------------
 * 全部接真实后端，不使用任何 mock：
 *   · /api/projects            项目列表（左轨「进行中」）
 *   · /api/projects/:id        当前项目
 *   · /api/projects/:id/storyboard/shots    全项目镜头（单一数据源）
 *   · /api/projects/:id/storyboard/scenes   场次
 *   · /api/generation/jobs/stream            SSE 任务流（左轨队列 / 状态栏）
 *   · /api/generation/worker-stats           队列并发状态
 *   · /api/projects/:id/progress             生产链进度
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  listProjects,
  getProject,
  getProgress,
} from '@client/src/api/projects';
import { listAllShots, listScenes } from '@client/src/api/storyboard';
import {
  listJobs,
  openJobStream,
  workerStats,
  type JobStreamSnapshot,
} from '@client/src/api/generation';
import { getCostSummary, getStats } from '@client/src/api/dashboard';
import type {
  CostSummary,
  DashboardStats,
  GenerationJob,
  Project,
  ProjectListItem,
  ProjectProgressResponse,
  Scene,
  Shot,
} from '@shared/api.interface';
import {
  countStates,
  groupByScene,
  normalizeShots,
  totalDuration,
  type StudioScene,
  type StudioShot,
} from './model';

export interface StudioData {
  projects: ProjectListItem[];
  projectsLoading: boolean;
  project?: Project;
  projectId?: string;
  /** 归一化后的镜头（画布 / 时间线 / 预览 / 分镜共用） */
  shots: StudioShot[];
  scenes: StudioScene[];
  shotStats: { done: number; render: number; pending: number; total: number };
  totalSec: number;
  jobs: GenerationJob[];
  worker: { mode: string; concurrency: number; waiting: number; active: number } | null;
  progress: ProjectProgressResponse | null;
  /** 费用汇总（真实落库求和） */
  cost: CostSummary | null;
  /** 全局统计 */
  stats: DashboardStats | null;
  reloadShots: () => Promise<void>;
  reloadProjects: () => Promise<void>;
}

export function useStudioData(projectId?: string): StudioData {
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [project, setProject] = useState<Project | undefined>(undefined);
  const [rawShots, setRawShots] = useState<Shot[]>([]);
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [jobs, setJobs] = useState<GenerationJob[]>([]);
  const [worker, setWorker] = useState<StudioData['worker']>(null);
  const [progress, setProgress] = useState<ProjectProgressResponse | null>(null);
  const [cost, setCost] = useState<CostSummary | null>(null);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const reloadProjects = useCallback(async () => {
    try {
      const res = await listProjects({ page: 1, pageSize: 50 });
      if (mounted.current) setProjects(res.items ?? []);
    } catch {
      /* 列表失败不阻断主界面 */
    } finally {
      if (mounted.current) setProjectsLoading(false);
    }
  }, []);

  const reloadShots = useCallback(async () => {
    if (!projectId) {
      setRawShots([]);
      setScenes([]);
      return;
    }
    try {
      // 一次性取回全项目镜头与场次（后端支持一次查询，避免 N+1）
      const [shotList, sceneList] = await Promise.all([
        listAllShots(projectId),
        listScenes(projectId),
      ]);
      if (!mounted.current) return;
      setRawShots(shotList ?? []);
      setScenes(sceneList ?? []);
    } catch {
      if (mounted.current) {
        setRawShots([]);
        setScenes([]);
      }
    }
  }, [projectId]);

  // 项目列表
  useEffect(() => {
    void reloadProjects();
  }, [reloadProjects]);

  // 当前项目 + 其镜头/场次
  useEffect(() => {
    setProject(undefined);
    setProgress(null);
    setRawShots([]);
    setScenes([]);
    if (!projectId) return;
    void (async () => {
      try {
        const p = await getProject(projectId);
        if (mounted.current) setProject(p);
      } catch {
        /* 项目不存在时保持空态 */
      }
      try {
        const pr = await getProgress(projectId);
        if (mounted.current) setProgress(pr);
      } catch {
        /* 进度不可用不阻断 */
      }
    })();
    void reloadShots();
  }, [projectId, reloadShots]);

  // 任务队列：SSE 优先，失败降级轮询
  useEffect(() => {
    let cleanup: (() => void) | undefined;
    let timer: ReturnType<typeof setInterval> | undefined;

    const poll = async () => {
      try {
        const res = await listJobs({ page: 1, pageSize: 50 });
        if (mounted.current) setJobs(res.items ?? []);
        const wstats = await workerStats();
        if (mounted.current) setWorker(wstats);
        const c = await getCostSummary();
        if (mounted.current) setCost(c);
        const s = await getStats();
        if (mounted.current) setStats(s);
      } catch {
        /* 忽略瞬时错误 */
      }
    };

    void poll();
    cleanup = openJobStream(projectId, (snap: JobStreamSnapshot) => {
      if (mounted.current) setJobs(snap.jobs ?? []);
    });
    timer = setInterval(poll, 15000);

    return () => {
      cleanup?.();
      if (timer) clearInterval(timer);
    };
  }, [projectId]);

  const shots = useMemo(() => normalizeShots(rawShots, scenes), [rawShots, scenes]);
  const shotScenes = useMemo(() => groupByScene(shots), [shots]);
  const shotStats = useMemo(() => countStates(shots), [shots]);
  const totalSec = useMemo(() => totalDuration(shots), [shots]);

  return {
    projects,
    projectsLoading,
    project,
    projectId,
    shots,
    scenes: shotScenes,
    shotStats,
    totalSec,
    jobs,
    worker,
    progress,
    cost,
    stats,
    reloadShots,
    reloadProjects,
  };
}
