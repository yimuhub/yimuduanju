/**
 * 自由画布 3 · 1:1 复刻 Pavo AI Canvas
 * 类型定义
 */
import type { Node, Edge } from '@xyflow/react';

/** 节点类型：7 类画布节点 */
export type PavoNodeType =
  | 'text'
  | 'image'
  | 'video'
  | 'audio'
  | 'composite'
  | 'director';

/** 节点执行状态 */
export type NodeStatus = 'idle' | 'running' | 'done' | 'error';

/** 图片生成面板状态 */
export interface GenPanelState {
  prompt: string;
  style?: string;
  refs: string[]; // 参考节点 id（手动选择；上游自动参考实时计算）
  refMode: boolean; // 从画布选择参考模式
  ratio: string; // 9:16 / 16:9 / 1:1 / 3:4 / 4:3 / 21:9
  res: string; // 1K / 2K / 4K
  preset: string;
  count: number;
  negative?: string; // 负面提示词
  strength?: number; // 参考强度 0-1
  styleName?: string; // 已应用风格
  mode?: string; // 视频生成模式：文生视频 / 全能参考 / 首尾帧
  duration?: string; // 视频时长：4s / 8s / 12s / 15s / 30s
}

/** 节点业务数据 */
export interface PavoNodeData {
  nodeType: PavoNodeType;
  title: string; // 「文本节点 1」
  status: NodeStatus;
  progress?: number; // 生成中 0-100
  /** 文本节点 markdown 内容 */
  markdown?: string;
  /** 自己编写富文本内容（纯文本） */
  richText?: string;
  /** 图片/视频/音频产物 URL（演示模式为占位） */
  mediaUrl?: string;
  mediaKind?: 'image' | 'video' | 'audio';
  /** 生成失败原因（真实 API 调用失败时展示） */
  errorMessage?: string;
  /** 是否为演示产物（未配置 API 时的降级标注） */
  isDemo?: boolean;
  /** 生成面板 */
  gen?: GenPanelState;
  /** 导演台：最近导出截图 */
  directorShot?: string;
  /** xyflow v12 Node 约束 data extends Record<string, unknown>，加索引签名 */
  [key: string]: unknown;
}

export type PavoFlowNode = Node<PavoNodeData, 'pavo'>;
export type PavoFlowEdge = Edge;

/** 大模型弹窗类型（按节点类型区分） */
export type DialogKind =
  | 'text' // 文本生成：textarea + 模型 + 翻译 + 发送
  | 'image' // 图片生成面板：描述 + 风格/参考 + 模型 + 比例 + 张数 + 发送
  | 'video'
  | 'audio'
  | 'composite'
  | 'director'
  | 'write'; // 自己编写：Slate 富文本

/** 模型条目（对接三通道 API 的展示结构） */
export interface ModelItem {
  id: string;
  name: string;
  tag?: '免费' | '付费';
  desc: string;
  kind: DialogKind;
}
