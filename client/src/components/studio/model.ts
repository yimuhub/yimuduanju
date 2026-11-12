/**
 * Studio · 单一数据源模型
 * -------------------------------------------------------------
 * 设计稿方案 F 的核心约束：画布 / 时间线 / 右侧预览 / 分镜 四者
 * 必须由**同一份镜头数据**派生，否则就会出现「时间码不自洽、
 * 引用索引错位」这类问题（设计稿注释里明确列了这两条修复项）。
 *
 * 本文件把后端的 Shot[] / Scene[] 归一成一个 StudioShot[]，
 * 并提供时间码、场次分组、状态派生等纯函数。
 */
import type { Scene, Shot, TimelineClip } from '@shared/api.interface';

export const FPS = 24;

/** EDL 片段在时间线上的有效时长（秒） */
export const clipSpan = (c: Pick<TimelineClip, 'inPoint' | 'outPoint' | 'speed'>) =>
  Math.max(0, (c.outPoint - c.inPoint) / (c.speed > 0 ? c.speed : 1));

/** EDL 片段在时间线上的结束秒 */
export const clipEnd = (c: Pick<TimelineClip, 'inPoint' | 'outPoint' | 'speed' | 'timelineStart'>) =>
  c.timelineStart + clipSpan(c);

/** 镜头在生产链上的三种状态（设计稿 data-st 同名） */
export type ShotState = 'done' | 'render' | 'pending';

/**
 * 归一化镜头：把后端 Shot 的字段名收敛成设计稿的语义。
 * - no   镜号（设计稿 #NN）
 * - sc   场号（设计稿 S01）
 * - dur  时长（秒）
 * - tag  景别（全景/中景/近景/特写/大特写/跟拍）
 * - txt  画面描述
 * - st   生产状态
 */
export interface StudioShot {
  /** 后端镜头 id */
  id: string;
  projectId: string;
  sceneId: string;
  /** 镜号（1 起） */
  no: number;
  /** 场号（1 起） */
  sceneNo: number;
  /** 场号展示用，如 S03 */
  sceneLabel: string;
  /** 时长（秒），至少 0.1 */
  dur: number;
  /** 景别 */
  tag: string;
  /** 画面描述 */
  txt: string;
  /** 台词 */
  dialogue?: string;
  /** 字幕文本（时间线 V2 轨） */
  subtitleText?: string;
  /** 运镜 */
  movement: string;
  /** 镜头角度 */
  cameraAngle: string;
  /** 首帧图 URL */
  frameUrl?: string;
  /** 视频 URL */
  videoUrl?: string;
  /** 配音 URL */
  voiceUrl?: string;
  /** 生产状态 */
  st: ShotState;
  /** 后端原始状态 */
  rawStatus: string;
  /** 在时间线上的起始秒 */
  start: number;
  /** 源媒体入点（秒）：预览/导出取段起点，缺省 0 */
  inPoint?: number;
  /** 源媒体出点（秒）：缺省 inPoint + duration */
  outPoint?: number;
  /** 本镜涉及的人物 id（与后端 shots.character_ids 一致，供一致性引用展示） */
  characterIds: string[];
  /** 所属场次的道具稳定编号（scenes.props，如 @PROP001） */
  propTags: string[];
  /** 本镜显式绑定的参考图 */
  referenceImageUrls: string[];
  /** 所属场景资产 id */
  locationId?: string;
}

/** 场次分组（画布分带 / 剧本纸 / 时间线标签共用） */
export interface StudioScene {
  id: string;
  no: number;
  label: string;
  title: string;
  shots: StudioShot[];
  /** 该场总时长（秒） */
  dur: number;
  /** 该场起始秒 */
  start: number;
}

/** 数字与时间码一律等宽 + 表格数字 */
export const pad2 = (n: number) => String(n).padStart(2, '0');

/** 秒 → 00:MM:SS:FF（设计稿 tc 格式） */
export function toTimecode(sec: number): string {
  const t = Math.max(0, sec);
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const f = Math.min(FPS - 1, Math.floor((t - Math.floor(t)) * FPS + 1e-6));
  return `00:${pad2(m)}:${pad2(s)}:${pad2(f)}`;
}

/** 秒 → m ss（设计稿 fmtDur） */
export function fmtDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}m ${pad2(s % 60)}s`;
}

/** 镜号展示：#01 */
export const shotLabel = (no: number) => `#${pad2(no)}`;

/** 景别兜底：后端 shotSize 为空时用中景 */
const normalizeTag = (raw?: string): string => {
  const t = (raw ?? '').trim();
  return t || '中景';
};

/**
 * 状态派生：后端 shot.status → 设计稿三态。
 * done=**已有成片**；render=任务在跑或只出了首帧；pending=待生成。
 * 旧实现把「有首帧图」也算 done，状态栏会显示「已渲 1/1」而实际一个视频都没有，
 * 是「只生成一个视频就报完成」错觉的放大器。
 */
function deriveState(shot: Shot): ShotState {
  const s = (shot.status ?? '').toLowerCase();
  if (shot.videoUrl) {
    // 仍在生成中的任务优先标记为 render
    if (s === 'generating' || s === 'running' || s === 'processing') return 'render';
    return 'done';
  }
  if (shot.startFrameUrl) {
    // 首帧已出、成片未出：仍是链路中间态
    return 'render';
  }
  if (s === 'generating' || s === 'running' || s === 'processing' || s === 'queued') {
    return 'render';
  }
  return 'pending';
}

export const stateText = (st: ShotState) =>
  st === 'done' ? '已渲染' : st === 'render' ? '渲染中' : '待生成';
export const stateShort = (st: ShotState) =>
  st === 'done' ? '已渲' : st === 'render' ? '渲染中' : '待生成';
export const stateChip = (st: ShotState): 'ok' | 'run' | '' =>
  st === 'done' ? 'ok' : st === 'render' ? 'run' : '';

/** 画面描述：优先 subject/action，其次 visualPrompt */
function deriveText(shot: Shot): string {
  const parts = [shot.subject, shot.action].filter(Boolean).join('，');
  return parts || shot.visualPrompt || shot.dialogue || '待补充画面描述';
}

/**
 * 把后端镜头 + 场次归一成 StudioShot[]（按镜号排序，时间轴连续）。
 */
export function normalizeShots(shots: Shot[], scenes: Scene[]): StudioShot[] {
  const sceneMap = new Map(scenes.map((s) => [s.id, s]));
  const sorted = [...shots].sort(
    (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.shotNumber - b.shotNumber,
  );
  let t = 0;
  return sorted.map((shot, idx) => {
    const scene = sceneMap.get(shot.sceneId);
    const sceneNo = scene?.sceneNumber ?? 1;
    const dur = Math.max(0.1, Number(shot.duration ?? 0) || 0.1);
    const st = deriveState(shot);
    const result: StudioShot = {
      id: shot.id,
      projectId: shot.projectId,
      sceneId: shot.sceneId,
      no: shot.shotNumber || idx + 1,
      sceneNo,
      sceneLabel: `S${pad2(sceneNo)}`,
      dur,
      tag: normalizeTag(shot.shotSize),
      txt: deriveText(shot),
      dialogue: shot.dialogue,
      subtitleText: shot.subtitleText,
      movement: shot.movement ?? '',
      cameraAngle: shot.cameraAngle ?? '',
      frameUrl: shot.startFrameUrl,
      videoUrl: shot.videoUrl,
      voiceUrl: shot.voiceUrl,
      st,
      rawStatus: shot.status ?? '',
      start: t,
      inPoint: shot.inPoint,
      outPoint: shot.outPoint,
      // 一致性引用不再丢弃：右坞预览 / 分镜 / 画布 / 时间线看到的是同一份数据
      characterIds: shot.characterIds ?? [],
      propTags: scene?.props ?? [],
      referenceImageUrls: shot.referenceImageUrls ?? [],
      locationId: scene?.locationId,
    };
    t += dur;
    return result;
  });
}

/** 按场次分组（保持镜号顺序） */
export function groupByScene(shots: StudioShot[]): StudioScene[] {
  const map = new Map<string, StudioScene>();
  for (const shot of shots) {
    let g = map.get(shot.sceneId);
    if (!g) {
      g = {
        id: shot.sceneId,
        no: shot.sceneNo,
        label: shot.sceneLabel,
        title: '',
        shots: [],
        dur: 0,
        start: shot.start,
      };
      map.set(shot.sceneId, g);
    }
    g.shots.push(shot);
    g.dur += shot.dur;
  }
  return [...map.values()].sort((a, b) => a.no - b.no);
}

/** 总时长 */
export const totalDuration = (shots: StudioShot[]) =>
  shots.reduce((sum, s) => sum + s.dur, 0);

/** 某一时刻落在第几镜（时间线播放头定位） */
export function shotIndexAt(shots: StudioShot[], t: number): number {
  for (let i = 0; i < shots.length; i += 1) {
    if (t < shots[i].start + shots[i].dur) return i;
  }
  return Math.max(0, shots.length - 1);
}

/** 统计：已完成 / 渲染中 / 待生成 */
export function countStates(shots: StudioShot[]) {
  let done = 0;
  let render = 0;
  let pending = 0;
  for (const s of shots) {
    if (s.st === 'done') done += 1;
    else if (s.st === 'render') render += 1;
    else pending += 1;
  }
  return { done, render, pending, total: shots.length };
}
