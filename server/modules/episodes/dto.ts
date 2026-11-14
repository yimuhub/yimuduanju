import type { EpisodeStatus, HandoffState } from '@shared/api.interface';

/**
 * episodes 模块 DTO。集是导航与确认的原子单位（方案②），
 * 写操作在边界处校验（与 storyboard/dto.ts 同一约定：非法直接 400）。
 */
export interface CreateEpisodeRequest {
  title?: string;
  /** 季号，缺省 1 */
  season?: number;
}

export interface UpdateEpisodeRequest {
  title?: string;
  status?: EpisodeStatus;
  locked?: boolean;
  /** 切换当前活跃集（project.metadata.activeEpisodeId） */
  active?: boolean;
}

export interface EpisodeDeleteQuery {
  /** 确认连带删除该集 shots/scenes（应用层级联；locked 集仍拒绝） */
  force?: boolean;
}

export interface AppendFactRequest {
  text: string;
}

export interface ResolvePropRequest {
  name: string;
  holder: string;
}

export interface UpsertRelationRequest {
  a: string;
  b: string;
  status: string;
}

export type EpisodeApproveStage = 'script' | 'storyboard' | 'preview' | 'final';

/** 交接账本读取（规范化后返回，永远三数组齐全） */
export type HandoffStateResponse = HandoffState;
