/**
 * 音频效果链（FX rack）· 预览与导出共用
 * -------------------------------------------------------------
 * 数据形态：clip.audioFx = { nodes: AudioFxNode[] }
 *   nodes 按「信号路径」顺序排列（In → 节点 → Out），bypass 的节点跳过。
 *
 * 预览端（ShenJianStage）用 WebAudio 逐节点建链；导出端（timeline.service）
 * 用 buildAudioFxFilterArgs 把每个节点翻译成一个 ffmpeg 滤镜，插在
 * 「音量包络 volume 表达式」之前（OpenMotion 语义：fx → automation），
 * afade 淡变仍叠在包络之后。无 audioFx 的片段不追加任何 filter（命令不变）。
 *
 * FX 参数自动化（对齐 OpenMotion automation lane）：
 *   node.automation[paramKey] = [{ t, v }]——t 片段内相对秒（帧量化、升序），
 *   v 是该参数在该时刻的绝对值（clamp 到参数范围，与 AUDIO_FX_PARAM_DEFS 同表）。
 *   预览：paramAt 线性插值（端点外保持），Stage 逐帧原位写 AudioParam；
 *   导出：把片段时长按断点切成窗口，每窗口重建该节点的滤镜并挂
 *     enable='between(t,S,E)'（ffmpeg timeline 编辑）。
 *
 * 已知差异（诚实标注）：
 *   · reverb 预览用 ConvolverNode 卷积合成的指数衰减噪声 IR，导出用
 *     aecho 双抽头近似——早期反射密度近似尾音，听感略有差异；
 *   · delay 预览是 DelayNode 反馈回路（连续重复），导出用 aecho 两抽头
 *     近似（时间 / 2×时间）；
 *   · highpass/lowpass 的 q 参数只作用于预览 BiquadFilter，导出滤镜按
 *     poles=2 定宽，暂不映射 q；
 *   · FX 自动化导出是「阶梯近似」：窗口内保持窗口起点值（断点间跳变而非
 *     线性），断点密时阶梯细；相邻窗口末端收缩 1ms，避免边界帧被两个窗口
 *     同时处理（双应用）；
 *   · acompressor / aecho 在 ffmpeg 6.0 不支持 enable timeline 编辑（bass/
 *     equalizer/treble/highpass/lowpass 支持），因此 compressor/delay/reverb
 *     节点的自动化导出退回静态种子值（预览仍逐帧自动化）。
 */

export type AudioFxNodeType = 'eq' | 'compressor' | 'delay' | 'reverb' | 'highpass' | 'lowpass';

/** FX 自动化断点：t 片段内相对秒（帧量化），v 参数绝对值（clamp 到范围） */
export interface AudioFxAutomationPoint {
  t: number;
  v: number;
}

export interface TimelineClipAudioFxNode {
  /** 节点稳定 id：Inspector 展开态、预览原位更新都以它为键 */
  id: string;
  type: AudioFxNodeType;
  /** true = 跳过该节点（预览不建、导出不加滤镜） */
  bypass?: boolean;
  /** 扁平参数表：键随 type 白名单（见 AUDIO_FX_PARAM_DEFS），数值已夹紧 */
  params: Record<string, number>;
  /**
   * 参数自动化：key = 参数名（白名单见 AUDIO_FX_PARAM_DEFS[type]），断点
   * 升序、帧量化、v 为绝对值。无自动化时缺省（旧行为字节级不变）。
   */
  automation?: Record<string, AudioFxAutomationPoint[]>;
}

export interface TimelineClipAudioFx {
  nodes: TimelineClipAudioFxNode[];
}

/** 节点类型白名单（dto 与归一化共用） */
export const AUDIO_FX_NODE_TYPES: AudioFxNodeType[] = [
  'eq',
  'compressor',
  'delay',
  'reverb',
  'highpass',
  'lowpass',
];

/** 单片段最多效果器数量：防脏数据把滤镜链撑爆 */
export const AUDIO_FX_MAX_NODES = 12;

/** 单参数自动化断点上限：导出窗口数 = 断点数，防脏数据把滤镜串撑爆 */
export const AUDIO_FX_AUTOMATION_MAX_POINTS = 400;

/* ============================ 参数注册表 ============================ */
/**
 * 每个节点的参数定义（Inspector 滑杆 / 归一化夹紧 / 导出取值共用一份）。
 * gain 类参数跨 0（0dB = 不增不减，中心刻度语义）；其余单向。
 */
export interface AudioFxParamDef {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  /** 显示单位（%、dB、ms） */
  unit: '' | 'dB' | 'ms';
  /** true = 0 为中心刻度（增益类） */
  centerZero?: boolean;
}

export const AUDIO_FX_PARAM_DEFS: Record<AudioFxNodeType, AudioFxParamDef[]> = {
  eq: [
    { key: 'lowGain', label: '低频增益', min: -24, max: 24, step: 0.5, unit: 'dB', centerZero: true },
    { key: 'lowFreq', label: '低频频率', min: 20, max: 800, step: 1, unit: '' },
    { key: 'midGain', label: '中频增益', min: -24, max: 24, step: 0.5, unit: 'dB', centerZero: true },
    { key: 'midFreq', label: '中频频率', min: 200, max: 5000, step: 10, unit: '' },
    { key: 'midQ', label: '中频宽度', min: 0.1, max: 10, step: 0.1, unit: '' },
    { key: 'highGain', label: '高频增益', min: -24, max: 24, step: 0.5, unit: 'dB', centerZero: true },
    { key: 'highFreq', label: '高频频率', min: 2000, max: 20000, step: 50, unit: '' },
  ],
  compressor: [
    { key: 'threshold', label: '阈值', min: -60, max: 0, step: 1, unit: 'dB' },
    { key: 'ratio', label: '压缩比', min: 1, max: 20, step: 0.1, unit: '' },
    { key: 'attack', label: '启动时间', min: 0, max: 200, step: 1, unit: 'ms' },
    { key: 'release', label: '释放时间', min: 10, max: 1000, step: 10, unit: 'ms' },
    { key: 'makeup', label: '补偿增益', min: 0, max: 24, step: 0.5, unit: 'dB' },
  ],
  delay: [
    { key: 'time', label: '延迟时间', min: 10, max: 2000, step: 10, unit: 'ms' },
    { key: 'feedback', label: '反馈量', min: 0, max: 0.9, step: 0.01, unit: '' },
    { key: 'mix', label: '干湿比', min: 0, max: 1, step: 0.01, unit: '' },
  ],
  reverb: [
    { key: 'mix', label: '干湿比', min: 0, max: 1, step: 0.01, unit: '' },
    { key: 'decay', label: '衰减时长', min: 100, max: 6000, step: 50, unit: 'ms' },
  ],
  highpass: [
    { key: 'freq', label: '截止频率', min: 20, max: 20000, step: 10, unit: '' },
    { key: 'q', label: '共振', min: 0.1, max: 10, step: 0.1, unit: '' },
  ],
  lowpass: [
    { key: 'freq', label: '截止频率', min: 20, max: 20000, step: 10, unit: '' },
    { key: 'q', label: '共振', min: 0.1, max: 10, step: 0.1, unit: '' },
  ],
};

/** 各节点默认参数（Inspector「添加效果」的初始值） */
export const AUDIO_FX_DEFAULT_PARAMS: Record<AudioFxNodeType, Record<string, number>> = {
  eq: { lowGain: 0, lowFreq: 200, midGain: 0, midFreq: 1000, midQ: 1, highGain: 0, highFreq: 5000 },
  compressor: { threshold: -20, ratio: 3, attack: 12, release: 180, makeup: 3 },
  delay: { time: 320, feedback: 0.35, mix: 0.3 },
  reverb: { mix: 0.3, decay: 1800 },
  highpass: { freq: 80, q: 0.707 },
  lowpass: { freq: 12000, q: 0.707 },
};

/** 节点显示名与分组（Inspector 添加菜单按组列出） */
export const AUDIO_FX_TYPE_LABEL: Record<AudioFxNodeType, string> = {
  eq: '三段 EQ',
  compressor: '压缩器',
  delay: '延迟',
  reverb: '混响',
  highpass: '高通滤波',
  lowpass: '低通滤波',
};

/** 节点短名（时间线 FX lane 标签 / 路径条 chips 用，窄幅可读） */
export const AUDIO_FX_TYPE_SHORT: Record<AudioFxNodeType, string> = {
  eq: 'EQ',
  compressor: '压缩',
  delay: '延迟',
  reverb: '混响',
  highpass: '高通',
  lowpass: '低通',
};

/** 添加菜单分组（OpenMotion filter/dynamics/time 三组语义 + eq 归入音色） */
export const AUDIO_FX_GROUPS: Array<{ label: string; types: AudioFxNodeType[] }> = [
  { label: '音色', types: ['eq'] },
  { label: '滤波', types: ['highpass', 'lowpass'] },
  { label: '动态', types: ['compressor'] },
  { label: '时间', types: ['delay', 'reverb'] },
];

const clampNum = (n: unknown, lo: number, hi: number) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return lo;
  return Math.min(hi, Math.max(lo, v));
};

/** 按注册表把参数表夹紧 + 过滤白名单之外的键（防御脏数据） */
export function clampAudioFxParams(type: AudioFxNodeType, params: Record<string, number> | null | undefined): Record<string, number> {
  const defs = AUDIO_FX_PARAM_DEFS[type] ?? [];
  const defaults = AUDIO_FX_DEFAULT_PARAMS[type] ?? {};
  const out: Record<string, number> = {};
  for (const def of defs) {
    const raw = params?.[def.key];
    out[def.key] = raw == null || !Number.isFinite(Number(raw)) ? defaults[def.key] : clampNum(raw, def.min, def.max);
  }
  return out;
}

/**
 * 参数值显示：增益带符号 dB，0–1 的混合/反馈类按百分比，其余按单位原样。
 * Inspector 滑杆读数与时间线 lane tooltip 共用（同一注册表同一格式）。
 */
export function formatAudioFxParamValue(def: AudioFxParamDef, v: number): string {
  if (def.key === 'mix' || def.key === 'feedback') return `${Math.round(v * 100)}%`;
  if (def.centerZero) {
    const r = Number(v.toFixed(1));
    return `${r > 0 ? '+' : ''}${r}dB`;
  }
  const r = Number(v.toFixed(v < 10 ? 2 : 0));
  return `${r}${def.unit}`;
}

/**
 * FX 参数自动化插值（对齐 volumeAt 语义）：两点之间线性、首点之前保持首点、
 * 末点之后保持末点；无该参数的自动化（或 t 非法）时返回 fallback（= 静态参数值）。
 * ShenJianStage 预览每帧调它写 AudioParam；导出端按窗口起点取值。
 */
export function paramAt(
  automation: Record<string, AudioFxAutomationPoint[]> | null | undefined,
  param: string,
  t: number,
  fallback: number,
): number {
  const points = automation?.[param];
  if (!Array.isArray(points) || points.length === 0) return fallback;
  const x = Number(t);
  if (!Number.isFinite(x)) return fallback;
  if (points.length === 1) return points[0].v;
  if (x <= points[0].t) return points[0].v;
  const last = points[points.length - 1];
  if (x >= last.t) return last.v;
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    if (x >= a.t && x <= b.t) {
      const spanT = b.t - a.t;
      if (spanT < 1e-9) return b.v;
      return a.v + ((b.v - a.v) * (x - a.t)) / spanT;
    }
  }
  return last.v;
}

/**
 * 归一化单节点的参数自动化：键走注册表白名单（非法键剔除）→ 断点过滤非法值 →
 * v 夹紧到参数范围 → t 帧量化（span 给定时再夹到 0–span）→ 升序 → 同帧保留
 * 先写入的点 → 截断到 AUDIO_FX_AUTOMATION_MAX_POINTS。有效断点数为 0 的参数
 * 剔除；全部剔除返回 undefined（= 无自动化，旧行为）。span/fps 缺省时只做
 * 结构防御（客户端写入前已按项目 fps 帧量化），落库前服务端会带 span 再防御一遍。
 */
export function normalizeFxAutomation(
  type: AudioFxNodeType,
  automation: Record<string, AudioFxAutomationPoint[]> | null | undefined,
  span?: number,
  fps = 24,
): Record<string, AudioFxAutomationPoint[]> | undefined {
  if (!automation || typeof automation !== 'object') return undefined;
  const defs = AUDIO_FX_PARAM_DEFS[type] ?? [];
  const safeFps = Math.max(1, fps);
  const maxSpan = span == null ? Number.POSITIVE_INFINITY : Math.max(0, Number(span));
  const out: Record<string, AudioFxAutomationPoint[]> = {};
  for (const def of defs) {
    const raw = automation[def.key];
    if (!Array.isArray(raw)) continue;
    const clean = raw
      .filter((p) => p && Number.isFinite(Number(p.t)) && Number.isFinite(Number(p.v)))
      .map((p) => ({
        t: Math.min(maxSpan, Math.max(0, Math.round(Number(p.t) * safeFps) / safeFps)),
        v: clampNum(p.v, def.min, def.max),
      }))
      .sort((a, b) => a.t - b.t);
    const list: AudioFxAutomationPoint[] = [];
    for (const p of clean) {
      const last = list[list.length - 1];
      // 同帧冲突保留先写入者：FX 参数没有「越低越对」的统一方向语义（与音量包络不同）
      if (last && Math.abs(last.t - p.t) < 1e-6) continue;
      list.push(p);
      if (list.length >= AUDIO_FX_AUTOMATION_MAX_POINTS) break;
    }
    if (list.length > 0) out[def.key] = list;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** 组装一个节点（Inspector 添加效果 / 具名决策共用），params 未给的键取默认值 */
export function makeAudioFxNode(type: AudioFxNodeType, params?: Record<string, number>): TimelineClipAudioFxNode {
  const seed = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10);
  return {
    id: `fx-${type}-${seed}`,
    type,
    params: { ...AUDIO_FX_DEFAULT_PARAMS[type], ...(params ?? {}) },
  };
}

/**
 * 归一化 FX 节点链（落库前 / 读取旧数据时防御）：
 * 过滤非法类型 → id 兜底 → 参数夹紧 → 自动化归一化 → 截断到上限。
 * span/fps 给定时对自动化断点帧量化并夹到片段时长内。
 * 空链返回 null（等同无 FX，向后兼容旧数据）；无自动化的节点不产生
 * automation 键（序列化与旧行为字节级一致）。
 */
export function normalizeAudioFxNodes(
  nodes: TimelineClipAudioFxNode[] | null | undefined,
  opts?: { span?: number; fps?: number },
): TimelineClipAudioFxNode[] | null {
  if (!Array.isArray(nodes)) return null;
  const out: TimelineClipAudioFxNode[] = [];
  for (let i = 0; i < nodes.length && out.length < AUDIO_FX_MAX_NODES; i += 1) {
    const node = nodes[i];
    if (!node || typeof node !== 'object') continue;
    const type = node.type;
    if (!type || !AUDIO_FX_NODE_TYPES.includes(type)) continue;
    const id = typeof node.id === 'string' && node.id.trim() ? node.id.trim().slice(0, 64) : `fx-${out.length}-${i}`;
    const item: TimelineClipAudioFxNode = {
      id,
      type,
      params: clampAudioFxParams(type, node.params),
    };
    if (node.bypass === true) item.bypass = true;
    const automation = normalizeFxAutomation(type, node.automation, opts?.span, opts?.fps);
    if (automation) item.automation = automation;
    out.push(item);
  }
  return out.length > 0 ? out : null;
}

/* ============================ 导出：ffmpeg 滤镜构建 ============================ */

const fxNum = (n: number, digits = 2) => {
  const v = Number(n.toFixed(digits));
  return Number.isFinite(v) ? String(v) : '0';
};

/**
 * 单节点滤镜按「参数组」拆分：每个组是一枚 ffmpeg 滤镜 + 它依赖的参数键。
 * eq 三段各成一组（可各自被自动化窗口化），其余类型单组 main。
 * filter 为 null = 当前参数下该组不产出滤镜（eq 某段 0dB）。
 * 静态导出 = 组序拼串（与旧实现字节级一致）。
 */
export interface AudioFxFilterGroup {
  /** 组标识：窗口化重建时按它找回同一枚滤镜 */
  group: string;
  /** 依赖的参数键：任一键被自动化，该组走 enable 窗口 */
  keys: string[];
  filter: string | null;
}

export function audioFxFilterGroups(type: AudioFxNodeType, p: Record<string, number>): AudioFxFilterGroup[] {
  switch (type) {
    case 'eq': {
      // 三段 = lowshelf / peaking / highshelf 的 ffmpeg 对应：
      // bass（低架式）、equalizer（峰式，t=q 时 w 即 Q 值）、treble（高架式）
      return [
        {
          group: 'low',
          keys: ['lowGain', 'lowFreq'],
          filter: p.lowGain !== 0 ? `bass=g=${fxNum(p.lowGain)}:f=${fxNum(p.lowFreq, 0)}` : null,
        },
        {
          group: 'mid',
          keys: ['midGain', 'midFreq', 'midQ'],
          filter: p.midGain !== 0 ? `equalizer=g=${fxNum(p.midGain)}:f=${fxNum(p.midFreq, 0)}:t=q:w=${fxNum(p.midQ)}` : null,
        },
        {
          group: 'high',
          keys: ['highGain', 'highFreq'],
          filter: p.highGain !== 0 ? `treble=g=${fxNum(p.highGain)}:f=${fxNum(p.highFreq, 0)}` : null,
        },
      ];
    }
    case 'compressor':
      // acompressor 的 attack/release 单位 ms、threshold/makeup 单位 dB，与注册表一致
      return [
        {
          group: 'main',
          keys: ['threshold', 'ratio', 'attack', 'release', 'makeup'],
          filter: `acompressor=threshold=${fxNum(p.threshold)}dB:ratio=${fxNum(p.ratio, 1)}:attack=${fxNum(p.attack, 0)}:release=${fxNum(p.release, 0)}:makeup=${fxNum(p.makeup)}`,
        },
      ];
    case 'delay': {
      // 两抽头近似 WebAudio 反馈延迟：主延迟 + 2×主延迟的第二声反射。
      // 干声 = 1-mix（in_gain），抽头衰减随 mix、feedback 递增。
      const d1 = clampNum(p.mix * (0.5 + 0.5 * p.feedback), 0.02, 0.9);
      const d2 = clampNum(d1 * (0.35 + 0.65 * p.feedback), 0.01, 0.85);
      return [
        {
          group: 'main',
          keys: ['time', 'feedback', 'mix'],
          filter: `aecho=${fxNum(1 - p.mix)}:0.9:${fxNum(p.time, 0)}|${fxNum(Math.min(5000, p.time * 2), 0)}:${fxNum(d1)}|${fxNum(d2)}`,
        },
      ];
    }
    case 'reverb': {
      // 诚实近似：预览是卷积 IR，导出用 aecho 双抽头（20/40ms 早期反射），
      // 衰减随 mix（干湿）与 decay（衰减时长）换算，无平滑尾音。
      const k = clampNum(p.mix, 0, 1);
      const len = Math.sqrt(clampNum(p.decay / 1800, 0.05, 4));
      const d1 = clampNum(0.34 * k * len, 0.02, 0.8);
      const d2 = clampNum(0.2 * k * len * 0.7, 0.01, 0.6);
      return [
        { group: 'main', keys: ['mix', 'decay'], filter: `aecho=0.8:0.9:20|40:${fxNum(d1)}|${fxNum(d2)}` },
      ];
    }
    case 'highpass':
      return [{ group: 'main', keys: ['freq', 'q'], filter: `highpass=f=${fxNum(p.freq, 0)}:poles=2` }];
    case 'lowpass':
      return [{ group: 'main', keys: ['freq', 'q'], filter: `lowpass=f=${fxNum(p.freq, 0)}:poles=2` }];
    default:
      return [];
  }
}

/**
 * 支持 enable timeline 编辑的节点类型（ffmpeg 6.0 实测：bass/equalizer/treble/
 * highpass/lowpass 有 "timeline through the 'enable' option"，acompressor/aecho
 * 没有）。不支持的类型自动化导出退回静态种子值（文件头差异清单有标注）。
 */
const AUDIO_FX_ENABLE_TYPES: ReadonlySet<AudioFxNodeType> = new Set(['eq', 'highpass', 'lowpass']);

/** 相邻窗口末端收缩量：避免恰好落在边界的滤镜帧被两个窗口同时处理（双应用） */
const FX_WINDOW_EPS = 0.001;

/**
 * 阶梯窗口：把 0–span 按断点（各自动化键并集，夹到片段内）切成 [s, e) 段，
 * 段内值 = 段起点插值（paramAt）。相邻段所有键的起点值都相同则合并；
 * 过窄（< 2×EPS）的段丢弃。首段从 0 起（首断点前保持首点值），末段到 span。
 */
function fxStepWindows(
  automation: Record<string, AudioFxAutomationPoint[]>,
  keys: string[],
  span: number,
): Array<{ s: number; e: number; last: boolean }> {
  const cuts = new Set<number>([0, span]);
  for (const k of keys) {
    for (const p of automation[k] ?? []) {
      const t = Math.min(span, Math.max(0, p.t));
      if (t > 0 && t < span) cuts.add(t);
    }
  }
  const edges = [...cuts].sort((a, b) => a - b);
  const raw: Array<{ s: number; e: number; last: boolean }> = [];
  for (let i = 0; i < edges.length - 1; i += 1) {
    const s = edges[i];
    const e = edges[i + 1];
    if (e - s < 2 * FX_WINDOW_EPS) continue;
    raw.push({ s, e, last: i + 2 === edges.length });
  }
  const merged: Array<{ s: number; e: number; last: boolean }> = [];
  for (const w of raw) {
    const prev = merged[merged.length - 1];
    const same = prev != null && keys.every((k) => {
      const a = paramAt(automation, k, prev.s, Number.NaN);
      const b = paramAt(automation, k, w.s, Number.NaN);
      return Math.abs(a - b) < 1e-9;
    });
    if (same) {
      prev.e = w.e;
      prev.last = w.last;
    } else merged.push({ ...w });
  }
  return merged;
}

/** enable 选项：末段到片段末尾（含），中间段末端收缩 1ms（半开近似，防双应用） */
const fxEnable = (w: { s: number; e: number; last: boolean }) =>
  `:enable='between(t,${w.s.toFixed(3)},${w.last ? w.e.toFixed(3) : Math.max(w.s + 2 * FX_WINDOW_EPS, w.e - FX_WINDOW_EPS).toFixed(3)})'`;

/**
 * buildFxAutomationFilterArgs：单节点滤镜——无自动化（或该类型不支持 enable）
 * 时与静态构建字节级一致；有自动化时，被自动化的「参数组」按断点切窗口，
 * 每窗口以「窗口起点参数值」重建该组滤镜并挂 enable='between(t,S,E)'，
 * 未自动化的组保持静态滤镜（基参数其他键 = 静态值）。
 */
export function buildFxAutomationFilterArgs(node: TimelineClipAudioFxNode, span?: number): string[] {
  const groups = audioFxFilterGroups(node.type, node.params);
  const auto = span != null && span > 0 ? normalizeFxAutomation(node.type, node.automation, span) : undefined;
  const automated = (key: string) => (auto?.[key]?.length ?? 0) > 0;
  if (!auto || !AUDIO_FX_ENABLE_TYPES.has(node.type)) {
    // 无自动化，或 compressor/delay/reverb 的自动化（导出不支持 enable）：
    // 全部按静态种子值出滤镜，无 automation 时与旧行为字节级一致
    return groups.map((g) => g.filter).filter((f): f is string => f != null);
  }
  const out: string[] = [];
  for (const g of groups) {
    const keys = g.keys.filter(automated);
    if (keys.length === 0) {
      // 该组没被自动化：静态滤镜原样保留（基参数其他键 = 静态值）
      if (g.filter != null) out.push(g.filter);
      continue;
    }
    // 注意 g.filter 可能为 null（如该段静态 0dB）——被自动化时仍要切窗口，
    // 窗口内的有效值不为 0 就会产出滤镜
    for (const w of fxStepWindows(auto, keys, span)) {
      const effective = { ...node.params };
      for (const k of keys) effective[k] = paramAt(auto, k, w.s, node.params[k]);
      // 按组标识重建：eq 某段在窗口内回 0dB 时该窗口不产出滤镜（与静态语义一致）
      const filter = audioFxFilterGroups(node.type, effective).find((gg) => gg.group === g.group)?.filter;
      if (filter != null) out.push(`${filter}${fxEnable(w)}`);
    }
  }
  return out;
}

/**
 * buildAudioFxFilterArgs：把 FX 节点链逐个翻译成 ffmpeg 音频滤镜。
 * 顺序 = 链序（In → Out），bypass / 非法节点跳过，空链返回 []（调用方不追加任何 filter）。
 * span（片段内有效秒）给定时，节点上的 FX 参数自动化导出为 enable 窗口
 * （阶梯近似）；不传或片段无自动化时行为与旧版完全一致。
 */
export function buildAudioFxFilterArgs(
  nodes: TimelineClipAudioFxNode[] | null | undefined,
  span?: number,
): string[] {
  const list = normalizeAudioFxNodes(nodes) ?? [];
  const out: string[] = [];
  for (const node of list) {
    if (node.bypass === true) continue;
    out.push(...buildFxAutomationFilterArgs(node, span));
  }
  return out;
}

/* ============================ 具名一键决策 ============================ */
/**
 * 照 OpenMotion audioFxJobs 的语义：不给用户一台裸机器，给一个「已经做好的
 * 决定」。每个决策是一个普通节点（电话声是两个），参数即推荐值，加进链后
 * 仍可继续调。中文命名为本项目文案，参数对标 OpenMotion jobs：
 *   Tame Boominess 200Hz -4dB（本项目 -6dB 更明显）/ Reduce Mud 250→400Hz /
 *   Add Clarity 3kHz / Soften Harshness 3.2→8kHz / Telephone / Space。
 */
export interface AudioFxJob {
  id: string;
  label: string;
  /** 一句话说明（按钮 tooltip / 菜单注释） */
  note: string;
  /** 追加进链的节点（含推荐参数） */
  nodes: TimelineClipAudioFxNode[];
}

export const AUDIO_FX_JOBS: AudioFxJob[] = [
  {
    id: 'tame-boominess',
    label: '去闷闷响',
    note: '低架式 200Hz -6dB：压掉贴近话筒的胸腔共鸣',
    nodes: [makeAudioFxNode('eq', { lowGain: -6, lowFreq: 200 })],
  },
  {
    id: 'reduce-mud',
    label: '去浑浊',
    note: '峰式 400Hz -4dB（q1.4）：声音不再像隔着纸箱',
    nodes: [makeAudioFxNode('eq', { midGain: -4, midFreq: 400, midQ: 1.4 })],
  },
  {
    id: 'add-clarity',
    label: '加清晰度',
    note: '峰式 3kHz +3dB：人声/主体更靠前',
    nodes: [makeAudioFxNode('eq', { midGain: 3, midFreq: 3000, midQ: 1 })],
  },
  {
    id: 'soften-harshness',
    label: '柔化刺耳感',
    note: '高架式 8kHz -3dB：磨掉毛糙的高频毛刺',
    nodes: [makeAudioFxNode('eq', { highGain: -3, highFreq: 8000 })],
  },
  {
    id: 'telephone',
    label: '电话声',
    note: '高通 300Hz + 低通 3400Hz：老式电话的窄带质感',
    nodes: [makeAudioFxNode('highpass', { freq: 300 }), makeAudioFxNode('lowpass', { freq: 3400 })],
  },
  {
    id: 'space',
    label: '空间感',
    note: '混响 干湿 30% · 1.8s 衰减：给干声一点房间感',
    nodes: [makeAudioFxNode('reverb', { mix: 0.3, decay: 1800 })],
  },
];
