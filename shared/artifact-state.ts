/**
 * 产物状态与一致性体检（纯函数，前后端同源）
 *
 * 对标 ArcReel `lib/workflow/workflow_state.py` 的产物四态：
 *   current（当前可用）/ stale（产物比来源旧）/ missing（该有但没有）/ blocked（上游没就绪）
 * 并叠加 Toonflow 的分镜审阅口径（跳轴、景别原地踏步、段超长、场内有人却无绑定）。
 *
 * 为什么要这一层：用户问的「为什么别人连贯我们不行」，有一半是**看不见** ——
 * 分镜表里哪条已经过期、哪条会跳轴、哪个场次根本没绑场景，界面上没有任何信号，
 * 于是只能等成片出来才发现不对。这里把判定做成纯函数，前后端同一套。
 */

import type { AxisDirection, ScreenDirection } from './api.interface';
import { checkAxisContinuity, repetitiveShotSizes, SEGMENT_MAX_SECONDS } from './shot-craft';
import type { AssetReadinessItem } from './asset-readiness';

export type ArtifactState = 'current' | 'stale' | 'missing' | 'blocked';

export const ARTIFACT_STATE_LABELS: Record<ArtifactState, string> = {
  current: '当前可用',
  stale: '已过期',
  missing: '缺失',
  blocked: '被阻塞',
};

export type IssueLevel = 'error' | 'warn' | 'info';

export interface ConsistencyIssue {
  level: IssueLevel;
  code:
    | 'axis_break'
    | 'repetitive_shot_size'
    | 'segment_too_long'
    | 'shot_without_segment'
    | 'cast_unbound'
    | 'scene_without_location'
    | 'asset_not_ready'
    | 'artifact_missing'
    | 'artifact_stale';
  message: string;
  /** 定位信息：场号/段号/镜号 */
  sceneNumber?: number;
  segmentNumber?: number;
  shotNumber?: number;
  shotId?: string;
}

export interface DiagnoseAssetInput {
  id: string;
  name: string;
  kind: 'character' | 'location' | 'prop';
  ready: boolean;
}

export interface DiagnoseShotInput {
  id: string;
  sceneId: string;
  sceneNumber?: number;
  segmentId?: string | null;
  segmentNumber?: number;
  shotNumber: number;
  duration: number;
  shotSize?: string | null;
  dialogue?: string | null;
  /** 当前分镜画面描述：与 framePrompt 比对来判断首帧是否过期 */
  visualPrompt?: string | null;
  characterIds?: string[];
  referenceImageUrls?: string[];
  startFrameUrl?: string | null;
  videoUrl?: string | null;
  voiceUrl?: string | null;
  screenDirection?: ScreenDirection | null;
  axisDirection?: AxisDirection | null;
  /**
   * 生成当前首帧时实际送出的提示词（来自成功任务）。
   * 与当前 visualPrompt 不一致 = 这张首帧代表的不是这版分镜 → stale。
   * 不能用 shots.updated_at 与任务时间比较：产物回写（video_url / status）
   * 本身就会刷新 updated_at，那样会把「刚出完图」的镜头全判成过期。
   */
  framePrompt?: string | null;
}

export interface DiagnoseSegmentInput {
  id: string;
  sceneId: string;
  segmentNumber: number;
  durationSeconds: number;
  characterIds?: string[];
  axisDirection?: AxisDirection | null;
  spaceAnchor?: string | null;
}

export interface DiagnoseSceneInput {
  id: string;
  sceneNumber: number;
  locationId?: string | null;
  characterIds?: string[];
}

export interface DiagnoseInput {
  scenes: DiagnoseSceneInput[];
  segments: DiagnoseSegmentInput[];
  shots: DiagnoseShotInput[];
  assets: DiagnoseAssetInput[];
  /** 是否把「缺视频」算成 missing；只做分镜期体检时传 false */
  requireVideo?: boolean;
}

export interface ShotDiagnosis {
  shotId: string;
  sceneNumber?: number;
  segmentNumber?: number;
  shotNumber: number;
  state: ArtifactState;
  issues: ConsistencyIssue[];
}

export interface ProjectDiagnosis {
  shots: ShotDiagnosis[];
  issues: ConsistencyIssue[];
  /** 各状态镜数 */
  counts: Record<ArtifactState, number>;
  /** 体检结论：error 数量为 0 才算通过 */
  passed: boolean;
  summary: string;
}

/**
 * 产物是否还代表当前分镜：比对「生成时用的提示词」与「现在的提示词」。
 * 拿不到生成时的提示词就不判 —— 宁可漏报，也不要把整片误标成过期。
 */
function isStale(shot: DiagnoseShotInput): boolean {
  const current = (shot.visualPrompt ?? '').trim();
  const used = (shot.framePrompt ?? '').trim();
  if (!current || !used) return false;
  return current !== used;
}

/**
 * 单镜体检：先判「能不能出」，再判「出的东西还对不对」。
 * 状态优先级 blocked > missing > stale > current —— 阻塞是上游问题，
 * 上游没解决时讨论产物新旧没有意义。
 */
export function diagnoseShot(
  shot: DiagnoseShotInput,
  ctx: {
    assets: DiagnoseAssetInput[];
    scene?: DiagnoseSceneInput;
    segment?: DiagnoseSegmentInput;
    requireVideo?: boolean;
  },
): ShotDiagnosis {
  const issues: ConsistencyIssue[] = [];
  const base = {
    sceneNumber: shot.sceneNumber ?? ctx.scene?.sceneNumber,
    segmentNumber: shot.segmentNumber ?? ctx.segment?.segmentNumber,
    shotNumber: shot.shotNumber,
    shotId: shot.id,
  };

  // 1) 阻塞：本镜声明的人物 / 所属场景的资产还没出图
  const readyById = new Map(ctx.assets.map((a) => [a.id, a]));
  const castIds = shot.characterIds ?? [];
  const unreadyCast = castIds
    .map((id) => readyById.get(id))
    .filter((a): a is DiagnoseAssetInput => Boolean(a) && a.ready === false);
  if (unreadyCast.length > 0) {
    issues.push({
      ...base,
      level: 'error',
      code: 'asset_not_ready',
      message: `人物「${unreadyCast.map((a) => a.name).join('、')}」还没定妆图，本镜无法出首帧`,
    });
  }
  const locAsset = ctx.scene?.locationId ? readyById.get(ctx.scene.locationId) : undefined;
  if (ctx.scene && ctx.scene.locationId && locAsset && !locAsset.ready) {
    issues.push({
      ...base,
      level: 'error',
      code: 'asset_not_ready',
      message: `场景「${locAsset.name}」还没有参考图，空间一致性无从保证`,
    });
  }
  if (issues.length > 0) {
    return { ...base, state: 'blocked', issues };
  }

  // 2) 缺失：该有产物但没有
  let missing = false;
  if (!shot.startFrameUrl) {
    missing = true;
    issues.push({ ...base, level: 'warn', code: 'artifact_missing', message: '还没有首帧' });
  }
  if (ctx.requireVideo && !shot.videoUrl) {
    missing = true;
    issues.push({ ...base, level: 'warn', code: 'artifact_missing', message: '还没有视频' });
  }
  if ((shot.dialogue ?? '').trim() && !shot.voiceUrl && ctx.requireVideo) {
    missing = true;
    issues.push({ ...base, level: 'info', code: 'artifact_missing', message: '有台词但还没有配音' });
  }

  // 3) 过期：首帧是按旧提示词生成的，分镜改过之后它已经不代表这版
  if (shot.startFrameUrl && isStale(shot)) {
    issues.push({
      ...base,
      level: 'warn',
      code: 'artifact_stale',
      message: '首帧是按修改前的提示词生成的，当前首帧不代表这版分镜',
    });
    return { ...base, state: 'stale', issues };
  }

  if (missing) return { ...base, state: 'missing', issues };

  // 4) 绑定类问题不改变产物状态，但要报出来
  if (castIds.length === 0) {
    const declared = (ctx.segment?.characterIds ?? ctx.scene?.characterIds ?? []).length > 0;
    if (declared) {
      issues.push({
        ...base,
        level: 'warn',
        code: 'cast_unbound',
        message: '本场/本段有人物，但这一镜没有绑定任何人 —— 首帧会重新想象一张脸',
      });
    }
  }
  return { ...base, state: 'current', issues };
}

/** 项目级体检：逐镜状态 + 结构性告警（跳轴 / 景别 / 段超长 / 未归段 / 场次无场景） */
export function diagnoseProject(input: DiagnoseInput): ProjectDiagnosis {
  const scenesById = new Map(input.scenes.map((s) => [s.id, s]));
  const segmentsById = new Map(input.segments.map((s) => [s.id, s]));
  const issues: ConsistencyIssue[] = [];

  // 场次没绑场景
  for (const sc of input.scenes) {
    if (!sc.locationId) {
      issues.push({
        level: 'warn',
        code: 'scene_without_location',
        sceneNumber: sc.sceneNumber,
        message: `第 ${sc.sceneNumber} 场没有绑定场景资产，同一场地会每镜都不一样`,
      });
    }
  }

  // 段超长
  for (const seg of input.segments) {
    if (seg.durationSeconds > SEGMENT_MAX_SECONDS + 0.01) {
      const sc = scenesById.get(seg.sceneId);
      issues.push({
        level: 'info',
        code: 'segment_too_long',
        sceneNumber: sc?.sceneNumber,
        segmentNumber: seg.segmentNumber,
        message: `第 ${sc?.sceneNumber ?? '?'} 场第 ${seg.segmentNumber} 段 ${seg.durationSeconds}s 超过 ${SEGMENT_MAX_SECONDS}s，动作可能做到一半就被切断`,
      });
    }
  }

  const shotDiagnoses = input.shots.map((shot) =>
    diagnoseShot(shot, {
      assets: input.assets,
      scene: scenesById.get(shot.sceneId),
      segment: shot.segmentId ? segmentsById.get(shot.segmentId) : undefined,
      requireVideo: input.requireVideo,
    }),
  );

  // 未归段
  for (const d of shotDiagnoses) {
    if (!d.issues.some((i) => i.code === 'shot_without_segment')) {
      const shot = input.shots.find((s) => s.id === d.shotId);
      if (shot && !shot.segmentId) {
        issues.push({
          level: 'info',
          code: 'shot_without_segment',
          sceneNumber: d.sceneNumber,
          shotNumber: d.shotNumber,
          shotId: d.shotId,
          message: `第 ${d.sceneNumber ?? '?'} 场第 ${d.shotNumber} 镜没有归入片段，段内镜像链与轴线校验对它无效`,
        });
      }
    }
  }

  // 跳轴与景别节奏：按「段」「场」分组
  for (const seg of input.segments) {
    const inSeg = input.shots
      .filter((s) => s.segmentId === seg.id)
      .sort((a, b) => a.shotNumber - b.shotNumber)
      .map((s) => ({
        shotNumber: s.shotNumber,
        axisDirection: seg.axisDirection ?? s.axisDirection ?? null,
        screenDirection: s.screenDirection ?? null,
      }));
    for (const v of checkAxisContinuity(inSeg)) {
      const sc = scenesById.get(seg.sceneId);
      issues.push({
        level: 'warn',
        code: 'axis_break',
        sceneNumber: sc?.sceneNumber,
        segmentNumber: seg.segmentNumber,
        shotNumber: v.shotNumber,
        message: v.message,
      });
    }
  }
  for (const sc of input.scenes) {
    const inScene = input.shots
      .filter((s) => s.sceneId === sc.id)
      .sort((a, b) => a.shotNumber - b.shotNumber)
      .map((s) => ({ shotNumber: s.shotNumber, shotSize: s.shotSize }));
    for (const n of repetitiveShotSizes(inScene)) {
      issues.push({
        level: 'info',
        code: 'repetitive_shot_size',
        sceneNumber: sc.sceneNumber,
        shotNumber: n,
        message: `第 ${sc.sceneNumber} 场连续三镜同景别（到镜 ${n}），没有信息推进时会显得拖`,
      });
    }
  }

  const counts: Record<ArtifactState, number> = {
    current: 0,
    stale: 0,
    missing: 0,
    blocked: 0,
  };
  for (const d of shotDiagnoses) counts[d.state] += 1;
  const errors = [
    ...shotDiagnoses.flatMap((d) => d.issues),
    ...issues,
  ].filter((i) => i.level === 'error').length;
  const warns = [
    ...shotDiagnoses.flatMap((d) => d.issues),
    ...issues,
  ].filter((i) => i.level === 'warn').length;

  return {
    shots: shotDiagnoses,
    issues,
    counts,
    passed: errors === 0,
    summary:
      `${input.scenes.length} 场 ${input.segments.length} 段 ${input.shots.length} 镜：` +
      `可用 ${counts.current}、缺失 ${counts.missing}、过期 ${counts.stale}、阻塞 ${counts.blocked}；` +
      `错误 ${errors} 项、告警 ${warns} 项`,
  };
}
