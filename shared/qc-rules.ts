/**
 * F3 质检规则统一函数（移植 ArcReel draft_workflow.py:148-167 纪律：
 * “晋升/确认/产出同一份代码”，防口径分叉）。
 * QC triggerQc 与生成前 preflight 必须调同一批函数，只做 issue/warning 映射，
 * 不各自重写阈值。规则分 error（硬门，可阻断）/ warning（只提示）。
 */
import { estimateSpeechSeconds, keywordSimilarity } from './text-metrics';
import { LEGACY_MOVEMENT_LABELS, rigById } from './camera-rigs';

export type RuleLevel = 'error' | 'warning';

export interface RuleHit {
  level: RuleLevel;
  code: string;
  message: string;
}

export interface ShotLike {
  id: string;
  shotNumber: number;
  duration?: unknown;
  movement?: unknown;
  shotSize?: unknown;
  dialogue?: unknown;
  action?: unknown;
  visualPrompt?: unknown;
  subtitleText?: unknown;
  startFrameUrl?: unknown;
  endFrameUrl?: unknown;
  whitemodelUrl?: unknown;
  whitemodelMeta?: unknown;
}

export interface WhitemodelMetaLike {
  durationSeconds?: number;
  movement?: string;
}

const num = (v: unknown) => Number(v) || 0;
const str = (v: unknown) => (typeof v === 'string' ? v : '');

export function ruleDialogueOverflow(s: ShotLike): RuleHit | null {
  const d = num(s.duration);
  const dialogue = str(s.dialogue);
  if (!dialogue || d <= 0) return null;
  const est = estimateSpeechSeconds(dialogue);
  if (est <= d * 1.15) return null;
  return {
    level: 'error',
    code: 'dialogue_overflow',
    message: `对白约需 ${est.toFixed(1)}s，超出镜头时长 ${d}s，配音会被截断或语速过快`,
  };
}

const STATIC_MOVEMENTS = new Set(['static', 'slow_push_in', 'push_in', 'zoom']);

export function ruleDeadTime(s: ShotLike, threshold: number): RuleHit | null {
  const d = num(s.duration);
  if (
    d >= threshold &&
    !str(s.dialogue) &&
    !str(s.action) &&
    STATIC_MOVEMENTS.has(str(s.movement) || 'static') &&
    !str(s.whitemodelUrl)
  ) {
    return {
      level: 'warning',
      code: 'dead_time',
      message: `时长 ${d}s 且无对白、无动作、无运镜、无白模，疑似死时间`,
    };
  }
  return null;
}

export function ruleWhitemodelMismatch(s: ShotLike): RuleHit[] {
  const hits: RuleHit[] = [];
  if (!str(s.whitemodelUrl)) return hits;
  const wm = (s.whitemodelMeta ?? {}) as WhitemodelMetaLike;
  const d = num(s.duration);
  if (
    typeof wm.durationSeconds === 'number' &&
    wm.durationSeconds > 0 &&
    d > 0
  ) {
    if (Math.abs(wm.durationSeconds - d) / d > 0.15) {
      hits.push({
        level: 'error',
        code: 'whitemodel_duration',
        message: `白模时长 ${wm.durationSeconds}s 与镜头时长 ${d}s 相差超 15%，时间节奏对不上`,
      });
    }
  }
  if (wm.movement && str(s.movement) && wm.movement !== str(s.movement)) {
    hits.push({
      level: 'error',
      code: 'whitemodel_movement',
      message: `白模运镜（${wm.movement}）与镜头运镜（${str(s.movement)}）不一致，生成时以镜头字段为准、白模会被浪费`,
    });
  }
  return hits;
}

export function ruleUnknownMovement(s: ShotLike): RuleHit | null {
  const m = str(s.movement);
  if (m && !rigById(m) && !LEGACY_MOVEMENT_LABELS[m]) {
    return {
      level: 'warning',
      code: 'unknown_movement',
      message: `运镜值「${m}」不在十种预设内，prompt 将原样透传`,
    };
  }
  return null;
}

export function ruleNoFirstFrame(
  s: ShotLike,
  chained: boolean,
): RuleHit | null {
  if (str(s.startFrameUrl)) return null;
  // V4 纯参考模式（学 ArcReel reference_video）：已绑白模的镜头走参考驱动，
  // 不再报"纯文本生成"（之前误报）；质感仍建议配首帧，但只在建议里提。
  if (str(s.whitemodelUrl)) return null;
  if (chained) {
    return {
      level: 'warning',
      code: 'chained_first_frame',
      message: '首帧继承自上镜，如构图已变请手动上传首帧覆盖',
    };
  }
  return {
    level: 'warning',
    code: 'no_first_frame',
    message:
      '无首帧图（且无可继承的上镜尾帧），将以纯文本生成，主体一致性无保障',
  };
}

export function ruleLocalWhitemodel(s: ShotLike): RuleHit | null {
  const url = str(s.whitemodelUrl);
  if (url && !/^https?:\/\//i.test(url)) {
    return {
      level: 'warning',
      code: 'local_whitemodel',
      message:
        '白模为本地地址，仅作存档与质检核对；云端 R2V 直喂需要公网可拉取 URL',
    };
  }
  return null;
}

/**
 * F5 台词红线（移植 ToonFlow production_agent_supervision R2/R4）：
 * - 字幕与对白不一-ahead：字幕是配音依据，偏离对白必须是有意改写，warning
 * - 单行超 20 字：建议拆镜或断句（ASS 按 15 字断行，超 20 字一镜念不完），info
 */
export function ruleSubtitleDrift(s: ShotLike): RuleHit | null {
  const sub = str(s.subtitleText).trim();
  const dlg = str(s.dialogue).trim();
  if (!sub || !dlg) return null;
  if (sub === dlg) return null;
  if (keywordSimilarity(sub, dlg) >= 0.8) return null;
  return {
    level: 'warning',
    code: 'subtitle_drift',
    message: '字幕与对白明显偏离（台词一字不差是红线），确认为有意改写再放行',
  };
}

export function ruleLongLines(s: ShotLike): RuleHit | null {  const text = `${str(s.subtitleText)}\n${str(s.dialogue)}`;
  const long = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 20);
  if (long.length === 0) return null;
  return {
    level: 'warning',
    code: 'long_lines',
    message: `有 ${long.length} 行超 20 字，建议拆镜或断句（一镜念不完）`,
  };
}

/**
 * S3 相邻镜景别错开（移植 ToonFlow production_agent_supervision）：
 * 连续 3 镜以上无理由同景别 → info。需有序镜头序列，QC 侧调用。
 */
export function ruleSameShotSize3(shots: ShotLike[]): RuleHit[] {
  const hits: RuleHit[] = [];
  const ordered = [...shots].sort((a, b) => a.shotNumber - b.shotNumber);
  let run = 1;
  for (let i = 1; i <= ordered.length; i += 1) {
    const same =
      i < ordered.length &&
      str(ordered[i].shotSize) !== '' &&
      str(ordered[i].shotSize) === str(ordered[i - 1].shotSize);
    if (same) {
      run += 1;
      continue;
    }
    if (run >= 3) {
      const last = ordered[i - 1];
      hits.push({
        level: 'warning',
        code: 'same_shotsize',
        message: `从镜 #${ordered[i - run].shotNumber} 起连续 ${run} 镜同景别（${str(last.shotSize)}），建议错开景别保持节奏`,
      });
    }
    run = 1;
  }
  return hits;
}
