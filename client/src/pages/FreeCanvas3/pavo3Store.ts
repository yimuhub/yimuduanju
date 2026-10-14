/**
 * 自由画布 3 · 1:1 复刻 Pavo AI Canvas
 * zustand 全局状态 + 画布动作（生成演示闭环 / 三通道 API hook 预留）
 */
import { create } from 'zustand';
import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type EdgeChange,
  type NodeChange,
  type XYPosition,
} from '@xyflow/react';
import type { DialogKind, ModelItem, PavoFlowEdge, PavoFlowNode, PavoNodeData, PavoNodeType } from './pavo3Types';
import { DEMO_AUDIO, DEMO_IMAGE, DEMO_VIDEO, MODELS, NODE_TYPES, type StyleItem } from './pavo3Constants';
import { pavo3 as pavo3Api } from '@client/src/api';

interface AddMenuState {
  visible: boolean;
  x: number; // 视口像素（弹窗定位）
  y: number;
  sourceId?: string; // 从端口拖出时的源节点
  /** 从节点左右加号打开：创建节点方向 */
  side?: 'left' | 'right';
  /** 加号所在锚点节点 */
  anchorNodeId?: string;
}

/** 生成面板参数（runGeneration 传入） */
export interface GenRunOptions {
  refs?: string[]; // 手动参考节点 id
  style?: StyleItem | null;
  negative?: string;
  ratio?: string;
  strength?: number;
  preset?: string;
  count?: number;
  duration?: string; // 视频时长：4s / 8s / 12s / 15s / 30s
  mode?: string; // 视频模式：文生视频 / 全能参考 / 首尾帧
  res?: string; // 视频分辨率
}

interface FreeCanvas3State {
  projectName: string;
  nodes: PavoFlowNode[];
  edges: PavoFlowEdge[];
  counters: Record<PavoNodeType, number>;
  filter: string;
  addMenu: AddMenuState | null;
  dialogNodeId: string | null;
  dialogKind: DialogKind | null;
  modelSelectFor: DialogKind | null;
  styleLibOpen: boolean;
  assetsOpen: boolean;
  shortcutsOpen: boolean;
  minimap: boolean;
  snapGrid: boolean;
  reorganizeConfirm: boolean;
  reorganizeSnapshot: { id: string; x: number; y: number }[] | null;
  director3DOpen: boolean;
  directorNodeId: string | null; // 当前打开的导演台节点
  hideEmpty: boolean;
  selectedModels: Record<string, string>;
  selectedNodeIds: string[];
  history: { nodes: PavoFlowNode[]; edges: PavoFlowEdge[] }[];
  future: { nodes: PavoFlowNode[]; edges: PavoFlowEdge[] }[];

  onNodesChange: (changes: NodeChange<PavoFlowNode>[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  setEdges: (edges: PavoFlowEdge[]) => void;
  onConnect: (conn: Connection) => void;
  createNode: (type: PavoNodeType, pos: XYPosition, opts?: { source?: string; target?: string; autoOpen?: boolean }) => void;
  removeNode: (id: string) => void;
  updateNodeData: (id: string, patch: Partial<PavoNodeData>) => void;
  undo: () => void;
  redo: () => void;
  setProjectName: (name: string) => void;
  restoreCanvas: (snap: { nodes: PavoFlowNode[]; edges: PavoFlowEdge[]; projectName: string }) => void;
  setFilter: (f: string) => void;
  openAddMenu: (m: AddMenuState) => void;
  closeAddMenu: () => void;
  /** 点击节点左右加号 → 打开节点类型菜单（右侧建输出节点 / 左侧建输入节点） */
  openHandleMenu: (nodeId: string, side: 'left' | 'right', x: number, y: number) => void;
  /** 收集某节点的全部上游节点（左侧连线可达，递归）——自动参考来源 */
  getUpstreamRefs: (nodeId: string) => PavoFlowNode[];
  openDialog: (nodeId: string, kind: DialogKind) => void;
  closeDialog: () => void;
  setModelSelectFor: (k: DialogKind | null) => void;
  setStyleLibOpen: (v: boolean) => void;
  setAssetsOpen: (v: boolean) => void;
  setShortcutsOpen: (v: boolean) => void;
  toggleMinimap: () => void;
  toggleSnapGrid: () => void;
  setReorganizeConfirm: (v: boolean) => void;
  setDirector3DOpen: (v: boolean) => void;
  setDirectorNodeId: (id: string | null) => void;
  setSelectedModel: (kind: string, modelId: string) => void;
  reorganize: (keep: boolean) => void;
  startReorganize: () => void;
  keepReorganize: () => void;
  revertReorganize: () => void;
  runGeneration: (nodeId: string, kind: DialogKind, prompt: string, model?: ModelItem | null, opts?: GenRunOptions) => void;
  runTryAction: (nodeId: string, action: string) => void;
}

/** 简单中文→英文演示翻译（演示模式；对接 API 后由后端翻译） */
export function translatePrompt(text: string): string {
  if (!/[\u4e00-\u9fff]/.test(text)) return text;
  return (
    text +
    ' (English prompt: ' +
    (text.length > 40 ? text.slice(0, 40) + '…' : text) +
    ')'
  );
}

export const useP3Store = create<FreeCanvas3State>((set, get) => ({
  projectName: '未命名项目',
  nodes: [],
  edges: [],
  counters: { text: 0, image: 0, video: 0, audio: 0, composite: 0, director: 0 },
  filter: 'all',
  addMenu: null,
  dialogNodeId: null,
  dialogKind: null,
  modelSelectFor: null,
  styleLibOpen: false,
  assetsOpen: false,
  shortcutsOpen: false,
  minimap: true,
  snapGrid: true,
  reorganizeConfirm: false,
  reorganizeSnapshot: null,
  director3DOpen: false,
  directorNodeId: null,
  hideEmpty: false,
  selectedModels: {
    text: 'agnes-2.0-flash',
    image: 'agnes-image-2.1-flash',
    video: 'agnes-video-1.5',
    audio: 'agnes-tts',
  },
  history: [],
  future: [],
  selectedNodeIds: [],

  onNodesChange: (changes) =>
    set({ nodes: applyNodeChanges(changes, get().nodes) }),

  onEdgesChange: (changes) =>
    set({ edges: applyEdgeChanges(changes, get().edges) }),

  setEdges: (edges) =>
    set({
      edges,
      history: pushHistory(get()),
      future: [],
    }),

  onConnect: (conn) =>
    set({
      edges: addEdge({ ...conn, type: 'pavoEdge' }, get().edges),
      history: pushHistory(get()),
      future: [],
    }),

  createNode: (type, pos, opts) => {
    const s = get();
    const n = s.counters[type] + 1;
    const meta = NODE_TYPES.find((t) => t.type === type)!;
    const base: PavoNodeData = {
      nodeType: type,
      title: `${meta.label}节点 ${n}`,
      status: 'idle',
      gen:
        type === 'image'
          ? { prompt: '', refs: [], refMode: false, ratio: '9:16', res: '1K', preset: '通用', count: 1 }
          : type === 'video'
            ? { prompt: '', refs: [], refMode: false, ratio: '9:16', res: '720P', preset: '通用', count: 1, mode: '文生视频', duration: '4s' }
            : undefined,
    };
    const node: PavoFlowNode = {
      id: `${type}-${n}-${Date.now()}`,
      type: 'pavo',
      position: pos,
      data: base,
    };
    const edges: PavoFlowEdge[] = [...s.edges];
    if (opts?.source) {
      edges.push({
        id: `e-${opts.source}-${node.id}`,
        source: opts.source,
        target: node.id,
        type: 'pavoEdge',
      });
    }
    if (opts?.target) {
      edges.push({
        id: `e-${node.id}-${opts.target}`,
        source: node.id,
        target: opts.target,
        type: 'pavoEdge',
      });
    }
    set({
      nodes: [...s.nodes, node],
      edges,
      counters: { ...s.counters, [type]: n },
      history: pushHistory(s),
      future: [],
    });
    // 图片 / 视频节点创建后自动打开生成面板（自动参考左侧上游；Pavo 同款；上传资源场景可关闭）
    if (opts?.autoOpen === false) return;
    if (type === 'image') {
      get().openDialog(node.id, 'image');
    } else if (type === 'video') {
      get().openDialog(node.id, 'video');
    }
  },

  removeNode: (id) =>
    set({
      nodes: get().nodes.filter((n) => n.id !== id),
      edges: get().edges.filter((e) => e.source !== id && e.target !== id),
      history: pushHistory(get()),
      future: [],
    }),

  undo: () => {
    const s = get();
    const prev = s.history[s.history.length - 1];
    if (!prev) return;
    set({
      nodes: prev.nodes,
      edges: prev.edges,
      history: s.history.slice(0, -1),
      future: [{ nodes: s.nodes, edges: s.edges }, ...s.future].slice(0, 50),
    });
  },

  redo: () => {
    const s = get();
    const next = s.future[0];
    if (!next) return;
    set({
      nodes: next.nodes,
      edges: next.edges,
      history: [...s.history, { nodes: s.nodes, edges: s.edges }].slice(-50),
      future: s.future.slice(1),
    });
  },

  updateNodeData: (id, patch) =>
    set({
      nodes: get().nodes.map((n) =>
        n.id === id ? { ...n, data: { ...n.data, ...patch } } : n,
      ),
    }),

  setProjectName: (name) => set({ projectName: name }),
  restoreCanvas: (snap) => {
    const nodes = (snap.nodes ?? []).map((n) => ({
      ...n,
      position: {
        x: Number.isFinite(n.position.x) ? n.position.x : 0,
        y: Number.isFinite(n.position.y) ? n.position.y : 0,
      },
    }));
    const counters = { text: 0, image: 0, video: 0, audio: 0, composite: 0, director: 0 } as Record<PavoNodeType, number>;
    nodes.forEach((n) => {
      const k = n.data.nodeType;
      const m = n.data.title?.match(/(\d+)\s*$/);
      const num = m ? Number(m[1]) : 1;
      if (num > (counters[k] ?? 0)) counters[k] = num;
    });
    set({
      nodes,
      edges: snap.edges ?? [],
      projectName: snap.projectName || '未命名项目',
      counters,
      history: [],
      future: [],
    });
  },
  setFilter: (f) => set({ filter: f }),

  openAddMenu: (m) => set({ addMenu: m }),
  closeAddMenu: () => set({ addMenu: null }),

  openHandleMenu: (nodeId, side, x, y) =>
    set({ addMenu: { visible: true, x, y, side, anchorNodeId: nodeId } }),

  /** 收集上游节点（左侧连线可达，递归）——自动参考来源 */
  getUpstreamRefs: (nodeId) => {
    const s = get();
    const visited = new Set<string>();
    const result: PavoFlowNode[] = [];
    const queue = [nodeId];
    while (queue.length) {
      const cur = queue.shift()!;
      s.edges.forEach((e) => {
        if (e.target === cur && !visited.has(e.source)) {
          visited.add(e.source);
          const n = s.nodes.find((x) => x.id === e.source);
          if (n) {
            result.push(n);
            queue.push(e.source);
          }
        }
      });
    }
    return result;
  },

  openDialog: (nodeId, kind) => set({ dialogNodeId: nodeId, dialogKind: kind }),
  closeDialog: () => set({ dialogNodeId: null, dialogKind: null }),

  setModelSelectFor: (k) => set({ modelSelectFor: k }),
  setStyleLibOpen: (v) => set({ styleLibOpen: v }),
  setAssetsOpen: (v) => set({ assetsOpen: v }),
  setShortcutsOpen: (v) => set({ shortcutsOpen: v }),
  toggleMinimap: () => set({ minimap: !get().minimap }),
  toggleSnapGrid: () => set({ snapGrid: !get().snapGrid }),
  setReorganizeConfirm: (v) => set({ reorganizeConfirm: v }),
  setDirector3DOpen: (v) => set({ director3DOpen: v }),
  setDirectorNodeId: (id) => set({ directorNodeId: id }),
  setSelectedModel: (kind, modelId) =>
    set({ selectedModels: { ...get().selectedModels, [kind]: modelId } }),

  /** 整理画布（Pavo 同款：点按钮立即执行 → 弹「是否保留」→ 保留/还原） */
  startReorganize: () => {
    const s = get();
    if (s.nodes.length === 0) return;
    // 1. 保存原布局快照（用于还原）
    const snapshot = s.nodes.map((n) => ({ id: n.id, x: n.position.x, y: n.position.y }));
    // 2. 按连接关系分层（DAG 最长路径分层：无源节点在第 0 层，向右递增）
    const layer = new Map<string, number>();
    const getLayer = (id: string, visited = new Set<string>()): number => {
      if (layer.has(id)) return layer.get(id)!;
      if (visited.has(id)) return 0;
      visited.add(id);
      const incoming = s.edges.filter((e) => e.target === id);
      if (incoming.length === 0) { layer.set(id, 0); return 0; }
      const l = Math.max(...incoming.map((e) => getLayer(e.source, visited))) + 1;
      layer.set(id, l);
      return l;
    };
    s.nodes.forEach((n) => getLayer(n.id));
    // 3. 同层节点按原 y 排序，垂直排列；层间水平排列
    const byLayer = new Map<number, string[]>();
    s.nodes.forEach((n) => {
      const l = layer.get(n.id) ?? 0;
      if (!byLayer.has(l)) byLayer.set(l, []);
      byLayer.get(l)!.push(n.id);
    });
    byLayer.forEach((ids) => {
      ids.sort((a, b) => {
        const na = s.nodes.find((n) => n.id === a)!;
        const nb = s.nodes.find((n) => n.id === b)!;
        return na.position.y - nb.position.y || na.position.x - nb.position.x;
      });
    });
    // 4. 不可变更新节点位置（创建新对象，确保 React 重渲染）
    const colW = 380;
    const rowH = 520;
    const marginX = 80;
    const marginY = 80;
    const newNodes = s.nodes.map((n) => {
      const l = layer.get(n.id) ?? 0;
      const layerIds = byLayer.get(l)!;
      const idx = layerIds.indexOf(n.id);
      return { ...n, position: { x: marginX + l * colW, y: marginY + idx * rowH } };
    });
    set({ nodes: newNodes, reorganizeSnapshot: snapshot, reorganizeConfirm: true });
  },
  /** 保留整理结果 */
  keepReorganize: () => set({ reorganizeConfirm: false, reorganizeSnapshot: null }),
  /** 还原到整理前布局 */
  revertReorganize: () => {
    const s = get();
    if (!s.reorganizeSnapshot) { set({ reorganizeConfirm: false }); return; }
    const newNodes = s.nodes.map((n) => {
      const snap = s.reorganizeSnapshot!.find((p) => p.id === n.id);
      return snap ? { ...n, position: { x: snap.x, y: snap.y } } : n;
    });
    set({ nodes: newNodes, reorganizeConfirm: false, reorganizeSnapshot: null });
  },
  /** 兼容旧调用 */
  reorganize: (keep) => {
    if (keep) get().keepReorganize();
    else get().revertReorganize();
  },

  /** 生成：真实三通道 API（后端可达且已配置）→ 真实产物；后端不可达/未配置 → 演示降级并明确标注 */
  runGeneration: (nodeId, kind, prompt, model, opts) => {
    const s = get();
    const node = s.nodes.find((n) => n.id === nodeId);
    if (!node) return;
    const data = node.data;

    // 「自己编写」：纯文本直接保存，不经过 AI 生成
    if (kind === 'write') {
      const text = (prompt ?? '').trim();
      if (!text) return;
      s.updateNodeData(nodeId, {
        markdown: text,
        richText: text,
        status: 'done',
        progress: 100,
        errorMessage: undefined,
        isDemo: undefined,
      });
      return;
    }

    // ── 组装参考（自动上游 + 手动选择）──
    const upstream = s.getUpstreamRefs(nodeId);
    const manualRefs = opts?.refs ?? data.gen?.refs ?? [];
    const refIds = [...new Set([...manualRefs, ...upstream.map((n) => n.id)])];
    const refs = refIds
      .map((id) => {
        const n = s.nodes.find((x) => x.id === id);
        if (!n) return null;
        return {
          id: n.id,
          title: n.data.title,
          kind: n.data.nodeType,
          text: n.data.markdown ?? n.data.richText,
          url: n.data.mediaUrl ?? n.data.directorShot,
        };
      })
      .filter((r): r is NonNullable<typeof r> => Boolean(r));

    const size = opts?.ratio ?? data.gen?.ratio ?? '9:16';
    const negative = opts?.negative ?? data.gen?.negative ?? '';
    const style = opts?.style ?? null;

    // 先进入执行中
    s.updateNodeData(nodeId, { status: 'running', progress: 2, errorMessage: undefined });

    const finish = (patch: Partial<PavoNodeData>) => {
      s.updateNodeData(nodeId, { ...patch, status: 'done', progress: 100 });
    };
    const fail = (message: string) => {
      s.updateNodeData(nodeId, { status: 'error', progress: 0, errorMessage: message });
    };

    // ── 1) 探测后端生成服务 ──
    (async () => {
      let backendOk = false;
      let configured = false;
      try {
        const st = await pavo3Api.status();
        backendOk = true;
        configured = st.configured;
      } catch {
        backendOk = false;
      }

      if (backendOk && configured) {
        try {
          const res = await pavo3Api.generate({
            // P1 修复：'write' 已在上文提前 return，此处不可能为 write；其余 kind 收敛为后端四类型
            type: kind as 'text' | 'image' | 'video' | 'audio',
            prompt,
            negativePrompt: negative || undefined,
            size,
            model: model?.id,
            refs,
            style: style ? { name: style.name, prompt: style.prompt, negative: style.negative } : null,
            duration: opts?.duration ? parseInt(String(opts.duration), 10) || undefined : undefined,
          });
          if (!res.ok) {
            fail(res.message ?? '生成失败');
            return;
          }
          if (res.text !== undefined) {
            finish({ markdown: res.text, mediaUrl: undefined, mediaKind: undefined });
          } else if (res.url) {
            finish({ mediaUrl: res.url, mediaKind: res.mediaKind ?? 'image', markdown: undefined });
          } else {
            fail('接口未返回内容');
          }
          return;
        } catch (e) {
          fail(`后端调用失败：${(e as Error).message}`);
          return;
        }
      }

      // ── 2) 后端不可达 / 未配置 → 演示降级（明确标注，绝不冒充真实） ──
      const demoNote = backendOk
        ? '（未配置模型供应商，演示数据。请到「设置 → 模型服务」配置 API）'
        : '（未连接后端服务，演示数据。请启动后端并在「设置 → 模型服务」配置 API）';
      const tick = (p: number) => {
        s.updateNodeData(nodeId, { status: 'running', progress: p });
        if (p >= 100) {
          const patch: Partial<PavoNodeData> = { status: 'done', progress: 100, isDemo: true };
          // P1 修复：'write' 已提前 return，此处仅 text 分支
          if (kind === 'text') {
            patch.markdown = buildMarkdown(prompt) + `\n\n> ⚠️ 演示数据 ${demoNote}`;
          } else if (kind === 'image') {
            patch.mediaUrl = DEMO_IMAGE;
            patch.mediaKind = 'image';
            patch.errorMessage = undefined;
            patch.markdown = undefined;
          } else if (kind === 'video') {
            patch.mediaUrl = DEMO_VIDEO;
            patch.mediaKind = 'video';
          } else if (kind === 'audio') {
            patch.mediaUrl = DEMO_AUDIO;
            patch.mediaKind = 'audio';
          }
          s.updateNodeData(nodeId, patch);
          return;
        }
        setTimeout(() => tick(Math.min(100, p + 8 + Math.random() * 14)), 160);
      };
      tick(6);
    })();
  },

  /** 节点「尝试」动作 */
  runTryAction: (nodeId, action) => {
    const s = get();
    const node = s.nodes.find((n) => n.id === nodeId);
    if (!node) return;
    const kind = node.data.nodeType;
    if (action === '自己编写') {
      s.openDialog(nodeId, 'write');
      return;
    }
    if (kind === 'text') {
      // 一句话生成剧本 / 文生图 / 文生视频 / 图片反推提示词 → 打开大模型弹窗并预填动作提示
      s.openDialog(nodeId, 'text');
      return;
    }
    if (kind === 'video') {
      s.openDialog(nodeId, 'video');
      return;
    }
    if (kind === 'audio') {
      s.openDialog(nodeId, 'audio');
      return;
    }
    if (kind === 'director') {
      s.setDirector3DOpen(true);
    }
  },
}));

/** 快照历史（结构变更前 push） */
function pushHistory(s: FreeCanvas3State) {
  return [...s.history, { nodes: s.nodes, edges: s.edges }].slice(-50);
}

/** 演示 markdown（模拟大模型产出） */
function buildMarkdown(prompt: string): string {
  return [
    '```markdown',
    'Image Generation Prompt',
    '',
    'Subject',
    '',
    prompt,
    '',
    'Composition',
    '',
    'Cinematic framing, medium shot, shallow depth of field, soft studio lighting.',
    '',
    'Style',
    '',
    'Photorealistic render, consistent character design, high detail.',
    '```',
  ].join('\n');
}
