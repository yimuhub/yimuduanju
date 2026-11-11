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
import { getTimeline } from '@client/src/api/timeline';
import { useVisibleInterval } from '@client/src/lib/hooks';
import type {
  CostSummary,
  DashboardStats,
  GenerationJob,
  Project,
  ProjectListItem,
  ProjectProgressResponse,
  Scene,
  Shot,
  TimelineDocument,
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
  /** 后端原始镜头（时间线编辑的乐观更新 / 撤销重做快照用） */
  rawShots: Shot[];
  /** 剪辑决策表（多轨时间线的唯一渲染源；未落库时由 shots 派生） */
  timeline: TimelineDocument | null;
  /** 本地编辑后的时间线写回（标记已触碰，避免 SSE 重拉覆盖） */
  commitTimeline: (doc: TimelineDocument) => void;
  /** 重新拉取 EDL；force=false 时用户已编辑过则跳过 */
  reloadTimeline: (force?: boolean) => Promise<void>;
  /**
   * 编辑通道写入镜头：递增编辑 epoch 并替换 rawShots。
   * epoch 变化会使编辑前发起、尚未返回的 reloadShots 结果被丢弃，
   * 避免 SSE 重拉把乐观更新覆盖回旧数据。
   */
  commitShots: (shots: Shot[]) => void;
  /** 编辑进行中锁定 reloadShots（SSE / 轮询重拉暂时跳过） */
  setShotsLocked: (locked: boolean) => void;
  scenes: StudioScene[];
  shotStats: { done: number; render: number; pending: number; total: number };
  totalSec: number;
  jobs: GenerationJob[];
  worker: { mode: string; concurrency: number; waiting: number; active: number } | null;
  progress: ProjectProgressResponse | null;
  /** 立即重拉生产链进度（确认门通过后不必等 5s 轮询） */
  reloadProgress: () => Promise<void>;
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
  const [timeline, setTimeline] = useState<TimelineDocument | null>(null);
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [jobs, setJobs] = useState<GenerationJob[]>([]);
  const [worker, setWorker] = useState<StudioData['worker']>(null);
  const [progress, setProgress] = useState<ProjectProgressResponse | null>(null);
  const [cost, setCost] = useState<CostSummary | null>(null);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const mounted = useRef(true);
  /** 编辑 epoch：commitShots 递增；过期的 reloadShots 响应据此丢弃 */
  const editEpochRef = useRef(0);
  /** 编辑进行中锁：锁定期间 SSE / 轮询触发的 reloadShots 直接跳过 */
  const shotsLockedRef = useRef(false);
  /** 时间线是否已被本地编辑：编辑后不再被自动重拉结果覆盖 */
  const timelineTouchedRef = useRef(false);

  const commitTimeline = useCallback((doc: TimelineDocument) => {
    timelineTouchedRef.current = true;
    setTimeline(doc);
  }, []);

  const reloadTimeline = useCallback(
    async (force = false) => {
      if (!projectId) {
        setTimeline(null);
        return;
      }
      if (!force && timelineTouchedRef.current) return;
      try {
        const doc = await getTimeline(projectId);
        if (mounted.current && (force || !timelineTouchedRef.current)) setTimeline(doc);
      } catch {
        /* 时间线不可用不阻断主界面：编辑器显示空态 */
      }
    },
    [projectId],
  );

  const commitShots = useCallback((next: Shot[]) => {
    editEpochRef.current += 1;
    setRawShots(next);
  }, []);

  const setShotsLocked = useCallback((locked: boolean) => {
    shotsLockedRef.current = locked;
  }, []);

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

  const reloadProgress = useCallback(async () => {
    if (!projectId) {
      setProgress(null);
      return;
    }
    try {
      const pr = await getProgress(projectId);
      if (mounted.current) setProgress(pr);
    } catch {
      /* 进度不可用不阻断主界面 */
    }
  }, [projectId]);

  const reloadShots = useCallback(async () => {
    if (!projectId) {
      setRawShots([]);
      setScenes([]);
      return;
    }
    if (shotsLockedRef.current) return;
    const epoch = editEpochRef.current;
    try {
      // 一次性取回全项目镜头与场次（后端支持一次查询，避免 N+1）
      const [shotList, sceneList] = await Promise.all([
        listAllShots(projectId),
        listScenes(projectId),
      ]);
      // 请求期间发生过编辑（epoch 变化）或仍被锁定：丢弃过期响应
      if (!mounted.current || epoch !== editEpochRef.current || shotsLockedRef.current) return;
      setRawShots(shotList ?? []);
      setScenes(sceneList ?? []);
    } catch {
      if (mounted.current && epoch === editEpochRef.current && !shotsLockedRef.current) {
        setRawShots([]);
        setScenes([]);
      }
    }
  }, [projectId]);

  // 项目列表
  // 后台状态会持续变化（脚本完成/确认门放行/生成推进），列表状态也要跟上；
  // 页签不可见时暂停轮询（useVisibleInterval 挂载即拉一次 + 回前台补拉）
  useVisibleInterval(() => void reloadProjects(), 20000);

  // 当前项目 + 其镜头/场次
  useEffect(() => {
    setProject(undefined);
    setProgress(null);
    setRawShots([]);
    setTimeline(null);
    setScenes([]);
    timelineTouchedRef.current = false;
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
    void reloadTimeline(true);
  }, [projectId, reloadShots, reloadTimeline]);

  // 当前项目状态 + 进度轮询：此前只在进入项目时拉一次，剧本生成完成/确认门放行后
  // 界面仍停在旧状态，用户会以为任务卡死（这是「等了好久没继续」的直接原因之一）。
  // 页签不可见时暂停轮询（useVisibleInterval 挂载即拉一次 + 回前台补拉）
  useVisibleInterval(() => {
    if (!projectId) return;
    void (async () => {
      try {
        const p = await getProject(projectId);
        if (mounted.current) setProject(p);
      } catch {
        /* 瞬时错误忽略，下一轮再试 */
      }
      try {
        const pr = await getProgress(projectId);
        if (mounted.current) setProgress(pr);
      } catch {
        /* 同上 */
      }
    })();
  }, 5000);

  // 任务队列：SSE 优先，失败降级轮询
  useEffect(() => {
    let cleanup: (() => void) | undefined;
    let timer: ReturnType<typeof setInterval> | undefined;

    const poll = async () => {
      try {
        const res = await listJobs({ projectId, page: 1, pageSize: 50 });
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

  // 任务状态变化（流水线物化镜头 / 出图 / 出片）后自动重拉镜头，
  // 让时间线、预览、画布随之联动，无需手动刷新页面。
  const jobSig = useMemo(
    () => jobs.map((j) => `${j.id}:${j.status}`).join('|'),
    [jobs],
  );
  useEffect(() => {
    if (!projectId || !jobSig) return;
    const t = setTimeout(() => {
      void reloadShots();
      // 新视频/配音完成后派生 EDL 需要跟着更新；用户手动编辑过则不覆盖
      void reloadTimeline();
    }, 1200);
    return () => clearTimeout(t);
  }, [jobSig, projectId, reloadShots, reloadTimeline]);
  const shotScenes = useMemo(() => groupByScene(shots), [shots]);
  const shotStats = useMemo(() => countStates(shots), [shots]);
  const totalSec = useMemo(() => totalDuration(shots), [shots]);

  return {
    projects,
    projectsLoading,
    project,
    projectId,
    shots,
    rawShots,
    timeline,
    commitTimeline,
    reloadTimeline,
    commitShots,
    setShotsLocked,
    scenes: shotScenes,
    shotStats,
    totalSec,
    jobs,
    worker,
    progress,
    reloadProgress,
    cost,
    stats,
    reloadShots,
    reloadProjects,
  };
}
