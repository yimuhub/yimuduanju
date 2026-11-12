/**
 * 视频提示词编排（纯函数，前后端同源）
 *
 * 为什么不能一句话给整镜：视频模型对「整段运动」的理解是模糊的，
 * 一句「林晚把怀表放进抽屉，回头看向门口」在 8 秒里既可能只用 1 秒做完，
 * 也可能做到一半就循环。火宝的做法是按 3 秒切段，每段只写这一段发生的
 * 可见动作与该段台词 —— 段内密度可控，段间衔接可控。
 *
 * 参考：
 * - 火宝 `backend/src/services/video-prompts.ts`：0-3s / 3-6s 分段写画面 + 台词；
 * - Toonflow `knowledge/shotCraft.md`：动作密度 2~3s ≈ 1 拍，7s+ ≈ 3 拍；
 *   相邻镜必须核对动作完成度与持物手；
 * - Toonflow `knowledge/videoPromptCraft.md`：一镜一主要运镜。
 */

import type { ScreenDirection, ShotBeat } from './api.interface';
import { normalizeBeats, VIDEO_BEAT_SECONDS } from './shot-craft';
import { normalizeAspect } from './aspect';
import {
  renderSceneEnv,
  renderVideoConstraintLine,
  type ImageConstraintInput,
} from './prompt-formula';

const SCREEN_DIRECTION_TEXT: Record<ScreenDirection, string> = {
  left_to_right: '画面内从左向右',
  right_to_left: '画面内从右向左',
  toward_camera: '朝向镜头',
  away_from_camera: '背离镜头',
  static: '主体基本不动，只有表演与光影变化',
};

export interface SegmentedVideoPromptInput {
  /** 镜头时长（秒） */
  duration: number;
  /** 3 秒节拍；缺省时用 fallbackDescription 兜底成单段 */
  beats?: ShotBeat[] | null;
  /** 本镜基础描述（分镜表 visualPrompt） */
  description?: string | null;
  /** 台词（含角色前缀也无妨，会原样保留） */
  dialogue?: string | null;
  shotSize?: string | null;
  movement?: string | null;
  screenDirection?: ScreenDirection | null;
  /** 场景名与外景/内景，用于稳住空间 */
  sceneName?: string | null;
  /** 在场角色名，画面里必须都是这些人 */
  characters?: string[];
  /** 上一镜结束状态（「前段结束状态 → 本段开始状态」的 continuity 约定） */
  previousEndState?: string | null;
  /** 空间与轴线（九宫格站位 / 轴线方向 / 本镜画面方向） */
  spatialNote?: string | null;
  /** 是否追加「不要字幕/水印」等负向约束（项目开启画面字幕时传 false） */
  negativeText?: boolean;
  /**
   * 全通道画面策略：画幅、场景环境、风格、道具文字例外。
   * 画幅保护与禁字统一由 prompt-formula 渲染，避免视频侧另写一套口径。
   */
  constraint?: ImageConstraintInput | null;
}

export interface SegmentedVideoPromptResult {
  prompt: string;
  /** 归一化后的节拍（已覆盖整镜时长） */
  beats: ShotBeat[];
  /** 是否走了「无节拍 → 单段兜底」路径（调用方应记 warning） */
  degraded: boolean;
}

/** 把秒数写成「0-3 秒」这种区间标注 */
function range(from: number, to: number): string {
  return `${trimNum(from)}-${trimNum(to)} 秒`;
}

function trimNum(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10);
}

/**
 * 拼装分段视频提示词。
 *
 * 结构固定为「连续性 → 分段节拍 → 镜头参数 → 禁止项」，
 * 因为视频模型对**靠后**的约束句更敏感，镜头参数和禁止项必须压尾。
 */
export function buildSegmentedVideoPrompt(
  input: SegmentedVideoPromptInput,
): SegmentedVideoPromptResult {
  const duration = Number.isFinite(input.duration) && input.duration > 0 ? input.duration : 5;
  const normalized = normalizeBeats(input.beats, duration);
  const degraded = normalized.length === 0;
  const beats: ShotBeat[] = degraded
    ? [
        {
          from: 0,
          to: Math.round(duration * 10) / 10,
          description: (input.description ?? '').trim() || '延续本镜构图，人物表演自然推进',
          dialogue: (input.dialogue ?? '').trim() || undefined,
        },
      ]
    : normalized;

  const lines: string[] = [];

  // 1) 连续性：先声明承接关系，模型才知道这不是一个从零开始的空镜
  if (input.previousEndState?.trim()) {
    lines.push(`【承接上一镜】${input.previousEndState.trim()}`);
  }

  // 2) 分段节拍：每段只写这一段发生的可见动作
  lines.push('【分段动作】');
  for (const b of beats) {
    const head = `${range(b.from, b.to)}：${b.description.trim()}`;
    const dlg = (b.dialogue ?? '').trim();
    lines.push(dlg ? `${head}；台词「${dlg}」` : head);
  }

  // 3) 镜头与空间参数（压尾，模型对末尾更敏感）
  const camera: string[] = [];
  if (input.shotSize) camera.push(`景别 ${input.shotSize}`);
  if (input.movement && input.movement !== 'static') camera.push(`运镜 ${input.movement}`);
  else camera.push('固定机位');
  if (input.screenDirection) camera.push(`画面方向 ${SCREEN_DIRECTION_TEXT[input.screenDirection]}`);
  if (input.sceneName) camera.push(`场景 ${input.sceneName}`);
  if (input.constraint?.aspectRatio) camera.push(`画幅 ${normalizeAspect(input.constraint.aspectRatio)}`);
  if (camera.length > 0) lines.push(`【镜头】${camera.join('；')}`);

  // 场景环境与风格：旧实现只把 location 数据拼进首帧锁块，视频侧完全没有场景描述，
  // 结果「镜头对、场地飘」。这里与首帧共用同一份 sceneEnv 事实。
  const scene = renderSceneEnv(input.constraint?.sceneEnv);
  if (scene) lines.push(scene);
  const style = (input.constraint?.styleBlock ?? '').trim();
  if (style) lines.push(`【视觉风格】${style}`);

  const spatial = (input.spatialNote ?? '').trim();
  if (spatial) lines.push(`【空间与轴线】${spatial}`);

  const cast = (input.characters ?? []).map((c) => c.trim()).filter(Boolean);
  if (cast.length > 0) {
    lines.push(`【在场人物】${cast.join('、')}（长相、发型、服装逐字一致，不得替换成他人或增减人数）`);
  }

  // 压尾：模型对末尾更敏感。文字政策 + 画幅保护 + 一镜一运镜一次说清，
  // 且【禁止】必须是最后一行（历史测试与生产约束都依赖这一点）。
  const constraint: ImageConstraintInput = {
    ...(input.constraint ?? {}),
    allowOnScreenText: input.negativeText === false,
  };
  const guardBits = renderVideoConstraintLine(constraint).split('；');
  if (input.negativeText === false) guardBits.shift(); // 用户显式开启画面字幕
  lines.push(`【禁止】${guardBits.join('；')}`);

  return { prompt: lines.join('\n'), beats, degraded };
}

/**
 * 视频续接描述：把上一镜的结束状态压缩成一句可直接引用的话。
 * 传空则返回空串，调用方不要拼这一段。
 */
export function describeContinuity(input: {
  previousShotNumber?: number | null;
  previousDialogue?: string | null;
  previousAction?: string | null;
  shotSize?: string | null;
}): string {
  const bits: string[] = [];
  if (input.previousShotNumber != null) bits.push(`承接镜 ${input.previousShotNumber} 的结束状态`);
  const action = (input.previousAction ?? '').trim();
  if (action) bits.push(`上一镜结束时：${action}`);
  const dlg = (input.previousDialogue ?? '').trim();
  if (dlg) bits.push(`上一句台词是「${dlg}」，本镜不得重复念`);
  if (input.shotSize && input.shotSize !== 'wide' && input.shotSize !== 'long') {
    bits.push('保持同一轴线与光位，人物站位与持物手不变');
  }
  return bits.join('；');
}

export { VIDEO_BEAT_SECONDS };
