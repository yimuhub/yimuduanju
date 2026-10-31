/**
 * 自由画布 × 后端任务队列实时联动（对标 DramaClaw WorkflowRunRecoveryBar / LocalMiniDrama 分镜节点状态轮询）：
 * 订阅 GET /api/generation/jobs/stream（SSE，2s 全量推送，与任务队列页同源），
 * 把 generation_jobs 的状态与产物实时映射到画布节点：
 *  - 排队/生成中 → 关联节点状态徽章（running + 进度）
 *  - succeeded   → 产物 URL 回填关联节点；画布上没有该产物节点时自动落画布并连线到源节点
 *  - failed      → 关联节点错误徽章 + 失败原因
 * 节点匹配优先级：externalTaskId（画布内发起的生成）> backendShotId（分镜实体镜头）> backendCharId（角色定妆）。
 */
import { useEffect, useRef } from 'react';
import { openJobStream, listJobs } from '@client/src/api/generation';
import type { GenerationJob } from '@shared/api.interface';
import { useP3Store } from './pavo3Store';
import type { PavoFlowEdge, PavoFlowNode, PavoNodeData } from './pavo3Types';

/** 从任务产物里提取可用 URL（与服务端 settleJobSuccess 落库结构对齐） */
function extractJobOutput(job: GenerationJob): { url?: string; text?: string } {
  const out = (job.outputData ?? {}) as Record<string, unknown>;
  let url: string | undefined;
  if (Array.isArray(out.images)) {
    const first = (out.images as Record<string, unknown>[])[0];
    if (first && typeof first.url === 'string') url = first.url;
  }
  if (!url && typeof out.url === 'string') url = out.url;
  if (!url && typeof out.audioUrl === 'string') url = out.audioUrl;
  // data:URL 只回填状态不回填媒体（与服务端防膨胀策略一致，产物以 /uploads/ 为准）
  if (url?.startsWith('data:')) url = undefined;
  const text = typeof out.text === 'string' && out.text ? out.text : undefined;
  return { url, text };
}

/** 任务类型 → 画布节点类型 */
function jobNodeKind(job: GenerationJob): 'image' | 'video' | 'audio' | 'text' | null {
  if (job.jobType === 'image') return 'image';
  if (job.jobType === 'video') return 'video';
  if (job.jobType === 'tts') return 'audio';
  if (job.jobType === 'text' || job.jobType === 'script') return 'text';
  return null;
}

/** 在画布上找到该任务关联的节点（externalTaskId → 分镜镜头 → 角色定妆） */
function matchNodes(job: GenerationJob, nodes: PavoFlowNode[]): PavoFlowNode[] {
  const hit = nodes.filter((n) => (n.data as PavoNodeData).externalTaskId === job.id);
  if (hit.length > 0) return hit;
  if (job.targetType === 'shot' && job.targetId) {
    const family = job.jobType === 'video' ? 'shot-vid' : 'shot-img';
    const byFamily = nodes.filter(
      (n) => n.id.startsWith(family) && (n.data as PavoNodeData).backendShotId === job.targetId,
    );
    if (byFamily.length > 0) return byFamily;
    // 镜头任务但对应媒体节点不在画布：返回空（由调用方决定落新节点）
    return [];
  }
  if (job.targetType === 'character' && job.targetId) {
    return nodes.filter(
      (n) => n.id.startsWith('char-img') && (n.data as PavoNodeData).backendCharId === job.targetId,
    );
  }
  return [];
}

const ACTIVE_STATUS = new Set<GenerationJob['status']>(['pending', 'queued', 'running', 'retrying']);

export const useJobCanvasSync = (projectId: string | undefined) => {
  // 已处理去重：同一任务同状态只应用一次（SSE 2s 全量快照会重复推送）
  const seenRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!projectId || typeof EventSource === 'undefined') return;

    const applyJob = (job: GenerationJob) => {
      const key = `${job.id}:${job.status}:${job.updatedAt}`;
      if (seenRef.current.has(key)) return;
      seenRef.current.add(key);
      if (seenRef.current.size > 500) seenRef.current = new Set([...seenRef.current].slice(-200));

      const st = useP3Store.getState();
      const kind = jobNodeKind(job);
      const matched = matchNodes(job, st.nodes);
      const { url, text } = extractJobOutput(job);

      // ── 进行中：仅刷新关联节点的状态徽章与进度（不动内容） ──
      if (ACTIVE_STATUS.has(job.status)) {
        matched.forEach((n) => {
          // 已有产物的节点不打断展示（重跑场景除外：重跑任务会把 done 拉回 running）
          st.updateNodeData(n.id, { status: 'running', progress: Math.max(2, Math.min(99, job.progress || 5)) });
        });
        return;
      }

      // ── 失败：关联节点显示失败原因 ──
      if (job.status === 'failed') {
        matched.forEach((n) => {
          st.updateNodeData(n.id, { status: 'error', progress: 0, errorMessage: job.errorMessage || '生成失败，可到「任务队列」重试' });
        });
        return;
      }

      // ── succeeded：回填产物；无关联节点时自动落画布 ──
      if (job.status !== 'succeeded' || !kind) return;

      if (matched.length > 0) {
        matched.forEach((n) => {
          const patch: Partial<PavoNodeData> = { status: 'done', progress: 100, errorMessage: undefined };
          if (kind === 'text' && text) patch.markdown = text;
          if (url) {
            patch.mediaUrl = url;
            patch.mediaKind = kind === 'text' ? undefined : kind;
            if (kind === 'text') patch.markdown = undefined;
          }
          if (!url && !text) return; // 无产物不改变内容态
          st.updateNodeData(n.id, patch);
        });
        return;
      }

      // 画布上没有关联节点：为该任务产物落一个新节点（DramaClaw「生成结果自动上画布」同款）
      if (!url && !text) return;
      const nodes = useP3Store.getState().nodes;
      const edges = useP3Store.getState().edges;
      // 连线源：镜头任务的另一侧媒体节点（如视频任务 → 已在画布的镜头首帧节点）
      let sourceId: string | undefined;
      if (job.targetType === 'shot' && job.targetId) {
        const siblingFamily = kind === 'video' ? 'shot-img' : 'shot-vid';
        sourceId = nodes.find(
          (n) => n.id.startsWith(siblingFamily) && (n.data as PavoNodeData).backendShotId === job.targetId,
        )?.id;
      }
      const maxX = nodes.reduce((m, n) => Math.max(m, n.position.x), 0);
      const sameColCount = nodes.filter((n) => n.position.x >= maxX - 1).length;
      const nodeId = `job-${job.id.slice(0, 8)}`;
      if (nodes.some((n) => n.id === nodeId)) return;
      const metaTitle =
        kind === 'image' ? '生成图片' : kind === 'video' ? '生成视频' : kind === 'audio' ? '生成配音' : '生成文本';
      const node: PavoFlowNode = {
        id: nodeId,
        type: 'pavo',
        position: sourceId
          ? (() => {
              const src = nodes.find((n) => n.id === sourceId)!;
              return { x: src.position.x + 400, y: src.position.y };
            })()
          : { x: maxX + 400, y: 80 + sameColCount * 460 },
        data: {
          nodeType: kind,
          title: `${metaTitle} · ${job.jobType === 'tts' ? '配音' : `#${job.id.slice(0, 5)}`}`,
          status: 'done',
          progress: 100,
          externalTaskId: job.id,
          backendShotId: job.targetType === 'shot' ? job.targetId : undefined,
          markdown: kind === 'text' ? text : undefined,
          mediaUrl: url,
          mediaKind: kind === 'text' ? undefined : kind,
        },
      };
      const newEdges: PavoFlowEdge[] = sourceId
        ? [...edges, { id: `e-${sourceId}-${nodeId}`, source: sourceId, target: nodeId, type: 'pavoEdge' }]
        : edges;
      useP3Store.setState({
        nodes: [...nodes, node],
        edges: newEdges,
        counters: useP3Store.getState().counters, // 计数器不变：任务节点不占「文本节点 N」序号
      });
    };

    // SSE 断流时 openJobStream 回调 onError：降级为 5s 轮询 listJobs，保证徽章最终一致
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let close: (() => void) | null = null;
    const startPolling = () => {
      if (pollTimer) return;
      pollTimer = setInterval(async () => {
        try {
          const res = await listJobs({ projectId, pageSize: 50, page: 1 });
          (res.items ?? []).forEach(applyJob);
        } catch {
          /* 后端不可达：静默，下一轮再试 */
        }
      }, 5000);
    };
    try {
      close = openJobStream(
        projectId,
        (snap) => {
          (snap.jobs ?? []).forEach(applyJob);
        },
        () => startPolling(),
      );
    } catch {
      startPolling();
    }
    return () => {
      close?.();
      if (pollTimer) clearInterval(pollTimer);
    };
  }, [projectId]);
};
