/**
 * 一木·YIMU AI 视频创作平台 画布 v2 —— Pavo 式节点类型与「节点即工具箱」工具集定义
 * 设计参照：Pavo 无限画布（节点=工具箱，点节点弹该类型专属 Agent 工具）
 * 视觉：浅白极简 + 青绿点缀（Agnes 绿），替换上一版紫色主题
 */

/** 画布节点类型（Pavo 主干 + 短剧生产节点） */
export type PavoNodeKind =
  | 'text'      // 文本节点：灵感/剧本/提示词
  | 'image'     // 图片节点：画面/设定图
  | 'video'     // 视频节点：镜头/成片
  | 'audio'     // 音频节点：配音/BGM/音效
  | 'character' // 角色节点：角色资产（三视图）
  | 'scene'     // 场景节点：场景资产（全景）
  | 'script'    // 剧本节点：故事/剧本大纲
  | 'storyboard'// 分镜节点：分镜表
  | 'director'  // 3D 导演台：站位/机位/运镜
  | 'asset'     // 资产节点：素材引用
  | 'note';     // 备注节点

/** 节点即工具箱 —— 每种节点可调用的 Agent 工具 */
export interface NodeToolDef {
  id: string;
  label: string;
  emoji: string;
  desc: string;
}

export interface PavoNodeMeta {
  kind: PavoNodeKind;
  label: string;      // 短名（左侧列表/节点标题）
  emoji: string;
  fullName: string;   // 全名
  width: number;
  /** 该节点类型专属工具集（Pavo 节点即工具箱） */
  tools: NodeToolDef[];
}

/** 浅白极简 + 青绿 视觉令牌 */
export const PAVO_C = {
  bg: '#F6F7F7',            // 画布底
  panel: '#FFFFFF',
  border: 'rgba(15,45,35,0.12)',
  borderSoft: 'rgba(15,45,35,0.08)',
  primary: '#1FA97E',       // Agnes 青绿主色
  primaryDeep: '#178A66',
  primarySoft: '#E7F6F0',
  accent: '#4AC2A1',
  text: '#1A1B1C',
  textSoft: '#6B7280',
  textFaint: '#9AA4A0',
  line: 'rgba(15,45,35,0.10)',
} as const;

export const NODE_META_V2: Record<PavoNodeKind, PavoNodeMeta> = {
  text: {
    kind: 'text', label: '文本', emoji: '✏️', fullName: '文本节点', width: 210,
    tools: [
      { id: 'write', label: '自己编写', emoji: '⌨️', desc: '直接在节点内编辑文本' },
      { id: 'gen-script', label: '一句话生成剧本', emoji: '📜', desc: '输入一句话，AI 展开为完整剧本' },
      { id: 'text2img', label: '文生图', emoji: '🖼️', desc: '文本 → 图片' },
      { id: 'text2video', label: '文生视频', emoji: '🎞️', desc: '文本 → 视频' },
      { id: 'reverse-prompt', label: '图片反推提示词', emoji: '🔍', desc: '上传图片，反推提示词' },
    ],
  },
  image: {
    kind: 'image', label: '图片', emoji: '🖼️', fullName: '图片节点', width: 210,
    tools: [
      { id: 'img2img', label: '图生图', emoji: '🎨', desc: '基于参考图生成新图' },
      { id: 'char-fourview', label: '角色四视图', emoji: '👤', desc: '生成角色多视角设定图' },
      { id: 'scene-set', label: '场景设定图', emoji: '🏞️', desc: '生成场景设定图' },
      { id: 'product-set', label: '产品设定图', emoji: '📦', desc: '生成产品/道具设定图' },
      { id: 'img2video', label: '生成视频', emoji: '🎞️', desc: '图片 → 视频' },
    ],
  },
  video: {
    kind: 'video', label: '视频', emoji: '🎞️', fullName: '视频节点', width: 220,
    tools: [
      { id: 'firstlast-frame', label: '首尾帧', emoji: '📐', desc: '指定首帧/尾帧生成过渡' },
      { id: 'all-ref', label: '全能参考', emoji: '🧩', desc: '参考多主体生成镜头' },
      { id: 'regenerate', label: '局部重生成', emoji: '🔄', desc: '该镜头重新生成，保留旧版分支' },
    ],
  },
  audio: {
    kind: 'audio', label: '音频', emoji: '🎵', fullName: '音频节点', width: 200,
    tools: [
      { id: 'voice', label: '配音', emoji: '🎙️', desc: '生成角色配音' },
      { id: 'bgm', label: 'BGM', emoji: '🎼', desc: '生成背景音乐' },
      { id: 'sfx', label: '音效', emoji: '🔔', desc: '生成环境音效' },
    ],
  },
  character: {
    kind: 'character', label: '角色', emoji: '👤', fullName: '角色节点', width: 220,
    tools: [
      { id: 'char-set', label: '角色设定', emoji: '📝', desc: '设计角色设定图' },
      { id: 'char-fourview', label: '角色四视图', emoji: '🔄', desc: '正面/侧面/背面/45° 锁定一致性' },
      { id: 'char2video', label: '角色出演', emoji: '🎞️', desc: '角色 → 视频镜头' },
    ],
  },
  scene: {
    kind: 'scene', label: '场景', emoji: '🏛️', fullName: '场景节点', width: 220,
    tools: [
      { id: 'scene-set', label: '场景设定图', emoji: '🏞️', desc: '设计场景设定图' },
      { id: 'panorama', label: '720° 全景', emoji: '🌐', desc: '生成全景场景锁定空间' },
    ],
  },
  script: {
    kind: 'script', label: '剧本', emoji: '📜', fullName: '剧本节点', width: 240,
    tools: [
      { id: 'script-outline', label: '剧本大纲', emoji: '📋', desc: '展开故事大纲/分集' },
      { id: 'script2storyboard', label: '拆解分镜', emoji: '🎬', desc: '剧本 → 分镜表' },
      { id: 'script2img', label: '生成关键帧', emoji: '🖼️', desc: '剧本 → 关键帧画面' },
    ],
  },
  storyboard: {
    kind: 'storyboard', label: '分镜', emoji: '🎬', fullName: '分镜节点', width: 230,
    tools: [
      { id: 'storyboard2img', label: '生成关键帧', emoji: '🖼️', desc: '分镜 → 关键帧画面' },
      { id: 'storyboard2video', label: '生成视频', emoji: '🎞️', desc: '分镜 → 动态镜头' },
      { id: 'regenerate', label: '局部重生成', emoji: '🔄', desc: '该分镜重新生成，保留旧版' },
    ],
  },
  director: {
    kind: 'director', label: '导演台', emoji: '🎥', fullName: '3D 导演台', width: 200,
    tools: [
      { id: 'open-director', label: '打开导演台', emoji: '🎥', desc: '摆位/机位/运镜预演' },
    ],
  },
  asset: {
    kind: 'asset', label: '资产', emoji: '📦', fullName: '资产节点', width: 200,
    tools: [
      { id: 'pick-asset', label: '引用资产', emoji: '🔗', desc: '从资产库引用素材' },
      { id: 'asset2video', label: '资产出演', emoji: '🎞️', desc: '资产 → 视频镜头' },
    ],
  },
  note: {
    kind: 'note', label: '备注', emoji: '📌', fullName: '备注节点', width: 200,
    tools: [{ id: 'edit-note', label: '编辑备注', emoji: '✏️', desc: '记录想法' }],
  },
};

export const NODE_KINDS_V2 = Object.keys(NODE_META_V2) as PavoNodeKind[];

/** 左侧「画布元素」列表分组（Pavo 左栏） */
export const ELEMENTS_GROUPS: Array<{ title: string; kinds: PavoNodeKind[] }> = [
  { title: '内容', kinds: ['text', 'image', 'video', 'audio'] },
  { title: '生产', kinds: ['script', 'storyboard'] },
  { title: '资产', kinds: ['character', 'scene', 'asset'] },
  { title: '工程', kinds: ['director', 'note'] },
];

/** 画布节点数据 */
export interface PavoNodeData {
  kind: PavoNodeKind;
  title: string;
  values: Record<string, string>;
  seed: string;
  generating?: boolean;
  /** 节点自身是否含图（演示缩略图用） */
  hasImage?: boolean;
  /** 是否资产（角色/场景已固化为资产，可被引用） */
  isAsset?: boolean;
  [key: string]: unknown;
}

/** 根据 kind 生成默认节点 */
export function defaultPavoNode(kind: PavoNodeKind, title?: string): PavoNodeData {
  return { kind, title: title || NODE_META_V2[kind].label, values: {}, seed: `${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}` };
}

/** 节点摘要（节点卡片副标题） */
export function pavoSummary(d: PavoNodeData): string {
  const v = d.values || {};
  const prefer = ['content', 'title', 'line', 'value', 'description', 'name', 'prompt', 'text', 'script', 'dialogue'];
  for (const p of prefer) {
    if (v[p]) {
      const s = String(v[p]).replace(/\s+/g, ' ');
      return s.length > 42 ? s.slice(0, 42) + '…' : s;
    }
  }
  const keys = Object.keys(v);
  for (const k of keys) {
    if (v[k]) {
      const s = String(v[k]).replace(/\s+/g, ' ');
      return s.length > 42 ? s.slice(0, 42) + '…' : s;
    }
  }
  return '';
}
