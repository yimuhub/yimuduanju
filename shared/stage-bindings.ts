/**
 * B1 分环节模型绑定（移植 ToonFlow agentDeploy：按环节绑 vendorId:model + 温度）。
 * 未绑定的环节回落供应商默认（= ToonFlow 简易模式思想，无需额外模式开关）。
 */

export type StageKey = 'script' | 'image' | 'video' | 'tts';

export interface StageMeta {
  key: StageKey;
  label: string;
  desc: string;
}

export const STAGE_METAS: StageMeta[] = [
  { key: 'script', label: '剧本技能', desc: '小说/扩写/改写/广告/人物/分镜表技能的文本模型' },
  { key: 'image', label: '图片生成', desc: '分镜首帧图、关键帧、角色参考图的图片模型' },
  { key: 'video', label: '视频生成', desc: '镜头成片的视频模型（最烧钱）' },
  { key: 'tts', label: '配音合成', desc: '对白配音的语音模型' },
];

export interface StageBinding {
  stage: StageKey;
  providerId?: string;
  providerName?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  updatedAt?: string;
}

/** jobType → 环节（boards/script 技能走 script；其余直连） */
export function stageOfJobType(jobType: string): StageKey | undefined {
  if (jobType === 'script' || jobType === 'boards' || jobType === 'text') return 'script';
  if (jobType === 'image') return 'image';
  if (jobType === 'video') return 'video';
  if (jobType === 'tts') return 'tts';
  return undefined;
}
