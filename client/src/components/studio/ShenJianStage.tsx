/**
 * 一幕·神剪 · 中舞台（原型同款画布 + 走带）
 * 预览内容来自真实 EDL：当前播放头命中哪条画面轨，就渲染哪条片段的真实媒体。
 * 走带（G7/G8）：rAF 引擎在 WorkbenchContext 推进 curT，本组件负责媒体跟随——
 * 正放用原生 play（playbackRate = 片段速度 × 走带速度），倒放/倒放片段逐帧 seek；
 * 循环按钮 + 音频电平表（G9）挂在预览控制条。
 * 音频效果链（FX rack）：音频轨 GainNode 之后按 audioFx.nodes 顺序建 WebAudio
 * 子图（EQ/压缩/延迟/混响/高通/低通），结构变化整链重建、参数变化原位更新；
 * 节点带 FX 参数自动化时按播放头（片段内相对秒）逐帧插值写 AudioParam，
 * 与音量包络 clipGainAt 的逐帧时机同款（对齐 OpenMotion automation lane）。
 * 预览缩放/平移（对齐 OpenMotion NLEPreview）：Ctrl/⌘+滚轮以光标为锚缩放、滚轮/中键平移、
 * Fit/双击/Esc 复位、右下 HUD + minimap 导航器；数学在 stageZoom.ts，UI 在 ShenJianStageZoom.tsx。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { AudioLines, Eye, Maximize2, Repeat, Volume2, VolumeX } from 'lucide-react';
import { IconFrameNext, IconFramePrev, IconFullscreen, IconPause, IconPlay, IconSkipEnd, IconSkipStart } from './ShenJianIcons';
import { StageMinimap, StageZoomControls, StageZoomHud } from './ShenJianStageZoom';
import {
  canStartStagePan,
  clampStagePan,
  clampStageZoomPercent,
  DEFAULT_STAGE_ZOOM,
  isStageAtFit,
  resolveStagePanToRegionCenter,
  resolveStageVisibleRegion,
  resolveStageWheelPan,
  resolveStageWheelZoom,
  STAGE_ZOOM_HUD_TIMEOUT_MS,
  STAGE_ZOOM_SETTLE_MS,
  toDomPrecision,
  type StageZoomState,
} from './stageZoom';
import { useStudio } from './StudioShell';
import { useEdl } from './EdlContext';
import { clipSpan } from './model';
import { clipGainAt, fadeFactorAt } from '@client/src/lib/timeline-audio';
import { frameNumberOf } from '@client/src/lib/timeline-frame';
import { useTimeDisplayMode } from '@client/src/lib/hooks';
import { sampleVideoTransform } from '@shared/timeline-keyframes';
import { aiFilter, beautyStyle, cropTransform, maskStyle, sampleTracking } from '@shared/timeline-visual';
import { parseLutCube } from '@shared/lut3d';
import { createLutVideoRenderer, type LutVideoRenderer } from '@client/src/lib/lut-renderer';
import { paramAt, type TimelineClipAudioFxNode } from '@shared/timeline-audio-fx';
import type { TimelineClip, TimelineTextStyle } from '@shared/api.interface';
import { PREVIEW_AUDIO_FX_EVENT } from './ShenJianAudioFx';

type Ratio = '9:16' | '16:9' | '1:1' | '4:3';

// 预览字体映射，与检查器里的字体 id 一一对应
const PREVIEW_FONTS: Record<string, string> = {
  'source-han-sans': '"Noto Sans SC", "Source Han Sans SC", "PingFang SC", sans-serif',
  'pingfang': '"PingFang SC", "Noto Sans SC", sans-serif',
  'songti': '"Songti SC", "Noto Serif SC", serif',
  'kaiti': '"Kaiti SC", "STKaiti", serif',
  'mono': '"SFMono-Regular", "Menlo", monospace',
};

/** 静帧（图片）没有音轨，画面 fade 也走 opacity 分支 */
const STILL_RE = /\.(png|jpe?g|webp|gif|bmp|avif)(?:[?#]|$)/i;

/** 电平表开关持久化（G9）：预览控制条按钮点击即写，刷新后保持 */
const METERS_KEY = 'yimu:om:audio-meters';
const readMetersOn = () => {
  try {
    return localStorage.getItem(METERS_KEY) === '1';
  } catch {
    return false;
  }
};
const writeMetersOn = (on: boolean) => {
  try {
    localStorage.setItem(METERS_KEY, on ? '1' : '0');
  } catch {
    /* 隐私模式忽略 */
  }
};

/**
 * 音量增益对话框（G10）实时预览事件：拖动 fader 时按片段广播临时音量，
 * Stage 读 ref 叠加在 clipGainAt 之前，不进 EDL、不触发重渲染；detail=null 清空。
 */
export const PREVIEW_VOLUME_EVENT = 'yimu:shenjian-preview-volume';

/** 只有同源/内联媒体能安全建 MediaElementSource：跨域未给 CORS 会整路静音 */
const graphSafeUrl = (url: string | null | undefined) => {
  if (!url) return false;
  if (/^(blob:|data:)/i.test(url)) return true;
  try {
    return new URL(url, window.location.origin).origin === window.location.origin;
  } catch {
    return false;
  }
};

/** LUT 预览降级提示只 console.warn 一次：每个片段/每次切换都弹会刷屏 */
let lutDegradedWarned = false;

/** 一帧采样的 RMS（电平表用） */
const rmsOf = (buf: Float32Array) => {
  let sum = 0;
  for (let i = 0; i < buf.length; i += 1) sum += buf[i] * buf[i];
  return Math.sqrt(sum / Math.max(1, buf.length));
};

/* ============================ 音频效果链（FX rack）· WebAudio 建图 ============================ */
/**
 * 预览端 FX 链：插在片段 GainNode（包络 × 淡变 × 预览音量）之后、master/destination 之前。
 * 与导出端的差异（诚实标注）：
 *   · 顺序语义不同——导出是「FX → 音量包络 → afade」（fx → automation），预览是
 *     「包络 → FX」：静态链下两者只在 compressor 等非线性节点上有轻微听感差异；
 *   · reverb 用 ConvolverNode 卷积合成的指数衰减噪声 IR，delay 用反馈回路；
 *     导出端是 aecho 抽头近似（见 shared/timeline-audio-fx.ts）；
 *   · 画面片段自己的原声走 <video> 元素音量（跨域限制不建图），不经 FX——
 *     画面上挂的 FX 会镜像到 auto: 内嵌音频片段，预览实际响的是那条音频轨。
 */

/** dB → 线性增益（compressor 补偿增益用） */
const dbToGain = (db: number) => Math.pow(10, db / 20);

/** 结构指纹：id/type/bypass 任一变化即整链重建；纯参数变化只原位改 value */
const fxChainSig = (nodes: TimelineClipAudioFxNode[]) =>
  JSON.stringify(nodes.map((n) => [n.id, n.type, n.bypass === true]));

/** 合成混响 IR：指数衰减白噪声，长度 = decay（0.1–6s），结尾 5% 线性收零防爆音 */
const buildReverbIr = (ctx: AudioContext, decayMs: number) => {
  const seconds = Math.max(0.1, Math.min(6, decayMs / 1000));
  const len = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch += 1) {
    const data = buf.getChannelData(ch);
    const fade = Math.max(1, Math.floor(len * 0.05));
    for (let i = 0; i < len; i += 1) {
      const t = i / len;
      const tail = i > len - fade ? (len - i) / fade : 1;
      data[i] = (Math.random() * 2 - 1) * Math.exp(-3.5 * t) * tail;
    }
  }
  return buf;
};

/** 单节点建图结果：entry/tail 是链两端，apply 支持参数原位更新 */
interface FxNodeInstance {
  entry: AudioNode;
  tail: AudioNode;
  all: AudioNode[];
  apply: (params: Record<string, number>) => void;
}

/** 按 shared 注册表把一个 FX 节点翻译成 WebAudio 子图（与导出滤镜同语义） */
const buildFxNodeInstance = (ctx: AudioContext, node: TimelineClipAudioFxNode): FxNodeInstance | null => {
  const p = node.params;
  switch (node.type) {
    case 'eq': {
      // 三段 EQ：lowshelf / peaking / highshelf 三只 Biquad 串联
      const low = ctx.createBiquadFilter();
      low.type = 'lowshelf';
      const mid = ctx.createBiquadFilter();
      mid.type = 'peaking';
      const high = ctx.createBiquadFilter();
      high.type = 'highshelf';
      low.connect(mid);
      mid.connect(high);
      const apply = (q: Record<string, number>) => {
        low.frequency.value = q.lowFreq;
        low.gain.value = q.lowGain;
        mid.frequency.value = q.midFreq;
        mid.Q.value = q.midQ;
        mid.gain.value = q.midGain;
        high.frequency.value = q.highFreq;
        high.gain.value = q.highGain;
      };
      apply(p);
      return { entry: low, tail: high, all: [low, mid, high], apply };
    }
    case 'compressor': {
      // DynamicsCompressor + 补偿增益 GainNode（makeup 不内建）
      const comp = ctx.createDynamicsCompressor();
      const makeup = ctx.createGain();
      comp.connect(makeup);
      const apply = (q: Record<string, number>) => {
        comp.threshold.value = q.threshold;
        comp.ratio.value = q.ratio;
        comp.attack.value = Math.max(0, q.attack) / 1000;
        comp.release.value = Math.max(0.01, q.release) / 1000;
        makeup.gain.value = dbToGain(q.makeup);
      };
      apply(p);
      return { entry: comp, tail: makeup, all: [comp, makeup], apply };
    }
    case 'delay': {
      // 干湿并联 + 反馈回路：input→dry→out；input→delay→wet→out；delay→fb→delay
      const input = ctx.createGain();
      const output = ctx.createGain();
      const dry = ctx.createGain();
      const delay = ctx.createDelay(2.5);
      const fb = ctx.createGain();
      const wet = ctx.createGain();
      input.connect(dry);
      dry.connect(output);
      input.connect(delay);
      delay.connect(fb);
      fb.connect(delay);
      delay.connect(wet);
      wet.connect(output);
      const apply = (q: Record<string, number>) => {
        delay.delayTime.value = Math.min(2.4, Math.max(0.005, q.time / 1000));
        fb.gain.value = q.feedback;
        // 干湿比与导出 aecho 同语义：dry = 1-mix，wet = mix
        dry.gain.value = 1 - q.mix;
        wet.gain.value = q.mix;
      };
      apply(p);
      return { entry: input, tail: output, all: [input, output, dry, delay, fb, wet], apply };
    }
    case 'reverb': {
      // 卷积混响：IR 按 decay 生成；decay 变化时原位重建 buffer（其余参数无缝）
      const input = ctx.createGain();
      const output = ctx.createGain();
      const dry = ctx.createGain();
      const conv = ctx.createConvolver();
      const wet = ctx.createGain();
      input.connect(dry);
      dry.connect(output);
      input.connect(conv);
      conv.connect(wet);
      wet.connect(output);
      let lastDecay = Number.NaN;
      const apply = (q: Record<string, number>) => {
        dry.gain.value = 1 - q.mix;
        wet.gain.value = q.mix;
        if (Math.abs(q.decay - lastDecay) > 1) {
          conv.buffer = buildReverbIr(ctx, q.decay);
          lastDecay = q.decay;
        }
      };
      apply(p);
      return { entry: input, tail: output, all: [input, output, dry, conv, wet], apply };
    }
    case 'highpass':
    case 'lowpass': {
      const filter = ctx.createBiquadFilter();
      filter.type = node.type;
      const apply = (q: Record<string, number>) => {
        filter.frequency.value = q.freq;
        filter.Q.value = q.q;
      };
      apply(p);
      return { entry: filter, tail: filter, all: [filter], apply };
    }
    default:
      return null;
  }
};

/** 一条 FX 链的缓存：sig 未变时只跑 apply，变了才整链重建 */
interface FxChainBuild {
  sig: string;
  entry: AudioNode;
  tail: AudioNode;
  all: AudioNode[];
  apply: Array<(params: Record<string, number>) => void>;
}

/** 按 nodes 顺序串联非 bypass 节点；全部 bypass/空时返回 null（= 直通） */
const buildAudioFxChain = (ctx: AudioContext, nodes: TimelineClipAudioFxNode[]): FxChainBuild | null => {
  let entry: AudioNode | null = null;
  let tail: AudioNode | null = null;
  const all: AudioNode[] = [];
  const apply: Array<(params: Record<string, number>) => void> = [];
  for (const node of nodes) {
    if (node.bypass === true) {
      apply.push(() => undefined);
      continue;
    }
    const instance = buildFxNodeInstance(ctx, node);
    if (!instance) {
      // 未知类型（正常不会发生：服务端/客户端都已白名单过滤）占位一个空 apply，
      // 保证 apply 数组与 nodes 逐位对齐，原位更新不会错位到别的节点
      apply.push(() => undefined);
      continue;
    }
    if (tail) tail.connect(instance.entry);
    else entry = instance.entry;
    tail = instance.tail;
    all.push(...instance.all);
    apply.push(instance.apply);
  }
  if (!entry || !tail) return null;
  return { sig: fxChainSig(nodes), entry, tail, all, apply };
};

/** 断开并废弃一条链（顺序=链尾到链头无所谓，全量 disconnect） */
const disposeFxChain = (chain: FxChainBuild) => {
  for (const n of chain.all) {
    try { n.disconnect(); } catch { /* 已断开 */ }
  }
};

/**
 * FX 参数自动化（对齐 OpenMotion automation lane）的预览生效值：
 * 有 automation 的参数按播放头（片段内相对秒）用 paramAt 线性插值（端点外保持），
 * 其余参数保持静态值。apply 每帧吃这份合并表，静态链与自动化链共用一套建图。
 */
const fxEffectiveParams = (node: TimelineClipAudioFxNode, localT: number): Record<string, number> => {
  if (!node.automation) return node.params;
  const out = { ...node.params };
  for (const key of Object.keys(node.automation)) {
    out[key] = paramAt(node.automation, key, localT, node.params[key]);
  }
  return out;
};

/**
 * 屏幕坐标 → 画布归一化坐标（0-1）的唯一入口：字幕拖拽等所有「屏幕点落库」都走这里。
 * getBoundingClientRect 返回的是经预览缩放/平移（.canvas-frame 上的 transform）后的实时画布框，
 * 除以该框的宽高等价于先还原未缩放画布坐标再归一化——因此任何缩放/平移档位下，
 * 拖拽落库的 x/y 与未缩放时完全一致，字幕/安全区坐标系不随缩放漂移。
 */
const canvasPointFromClient = (frame: DOMRect | null | undefined, clientX: number, clientY: number) => {
  if (!frame || frame.width <= 0 || frame.height <= 0) return null;
  return {
    x: (clientX - frame.left) / frame.width,
    y: (clientY - frame.top) / frame.height,
  };
};

export const ShenJianStage = ({
  ratio,
  safe,
  onToggleSafe,
  grade,
}: {
  ratio: Ratio;
  safe: boolean;
  onToggleSafe: () => void;
  grade: { brightness: number; contrast: number; saturation: number; filter: string };
}) => {
  const {
    data,
    curT,
    setCurT,
    playing,
    setPlaying,
    playDir,
    playSpeed,
    loopEnabled,
    setLoopEnabled,
    previewQuality,
    previewVolume,
    setPreviewVolume,
    previewMuted,
    setPreviewMuted,
    projectId,
  } = useStudio();
  const edl = useEdl();
  // 走带时间码：time = 00:MM:SS，frame = 帧号；点击切换并与时间线同步（localStorage 持久化）
  const [timeMode, setTimeMode] = useTimeDisplayMode();
  const tcLabel = (sec: number) =>
    timeMode === 'frame' ? `${frameNumberOf(sec, edl.fps)} f` : fmt(sec);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const chromaRef = useRef<HTMLCanvasElement | null>(null);
  const stillRef = useRef<HTMLImageElement | null>(null);
  // —— LUT（.cube）预览：canvas 覆盖在源元素上，WebGL 渲染器逐帧查表（见 lut-renderer.ts）——
  const lutCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const lutRendererRef = useRef<LutVideoRenderer | null>(null);
  const [lutReady, setLutReady] = useState(false);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const audioRefs = useRef<Map<string, HTMLAudioElement>>(new Map());
  // >0dB（volume>1）需要 WebAudio GainNode；普通音量直接走元素 volume，避免破坏跨域媒体。
  const audioCtxRef = useRef<AudioContext | null>(null);
  const audioGainRef = useRef<Map<string, GainNode>>(new Map());
  // 音频效果链（FX rack）缓存：clipId → 已建子图（GainNode 之后 → master/destination）
  const audioFxRef = useRef<Map<string, FxChainBuild>>(new Map());
  // FX 拖动实时预览：clipId → 临时节点链（Inspector 派发，不进 EDL；commit 后清空）
  const previewFxRef = useRef<Map<string, TimelineClipAudioFxNode[]>>(new Map());
  const [fxPreviewTick, setFxPreviewTick] = useState(0);
  // 建图时记录元素：保存重建 id / 元素重挂载后旧 GainNode 失效，需重建
  const graphElRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  // 增益对话框（G10）实时预览：clipId → 临时音量（不进 EDL）
  const previewVolRef = useRef<Map<string, number>>(new Map());
  const playingRef = useRef(playing);
  playingRef.current = playing;
  // —— 电平表（G9）：Analyser 接在 gain（含包络）之后，rAF 直写 DOM ——
  const [metersOn, setMetersOn] = useState(readMetersOn);
  const metersOnRef = useRef(metersOn);
  metersOnRef.current = metersOn;
  const meterChainRef = useRef<{
    master: GainNode;
    splitter: ChannelSplitterNode;
    analyserL: AnalyserNode;
    analyserR: AnalyserNode;
    bufL: Float32Array<ArrayBuffer>;
    bufR: Float32Array<ArrayBuffer>;
  } | null>(null);
  const fillLRef = useRef<HTMLSpanElement | null>(null);
  const fillRRef = useRef<HTMLSpanElement | null>(null);
  const peakLRef = useRef<HTMLSpanElement | null>(null);
  const peakRRef = useRef<HTMLSpanElement | null>(null);
  const [videoBroken, setVideoBroken] = useState(false);
  const [subDrag, setSubDrag] = useState<{ id: string; x: number; y: number } | null>(null);
  const lastSubDrag = useRef<{ id: string; x: number; y: number } | null>(null);
  // —— 预览缩放/平移（对齐 OpenMotion NLEPreview）——
  // 手势期间直写 DOM 不走 React（每帧 rAF 都在推 curT，重渲染代价高），沉降后提交 settledZoom 给菜单/minimap
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const zoomRef = useRef<StageZoomState>({ ...DEFAULT_STAGE_ZOOM });
  const [settledZoom, setSettledZoom] = useState<StageZoomState>({ ...DEFAULT_STAGE_ZOOM });
  const hudRef = useRef<HTMLDivElement | null>(null);
  const hudTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const zoomingRef = useRef(false);
  const panDragRef = useRef<{ pointerId: number; startX: number; startY: number; originX: number; originY: number } | null>(null);
  const minimapRegionRef = useRef<HTMLDivElement | null>(null);

  // 剪映式时间轴长度＝内容末端，而不是项目参数里的固定时长。
  // 新建项目 durationSeconds 默认 50s，旧实现会让 5s 素材后面挂 45s 黑场，
  // 播放头、走带和字幕拖拽全部落进空白区。
  const total = useMemo(() => {
    let end = 0;
    for (const c of data.timeline?.clips ?? []) {
      end = Math.max(end, c.timelineStart + clipSpan(c));
    }
    return Math.max(1, end || data.totalSec || 0);
  }, [data.timeline?.clips, data.totalSec]);

  // 轨道属性以本地 EDL 为准：静音/显隐点完立即生效，不等一次刷新。
  const timelineTracks = edl.tracks?.length ? edl.tracks : (data.timeline?.tracks ?? []);
  const trackMeta = (track: string, lane: number) =>
    timelineTracks.find((t) => t.track === track && (t.lane ?? 0) === lane);

  const active = useMemo(() => {
    const clips = (data.timeline?.clips ?? []).filter(
      (c) =>
        c.track === 'video' &&
        c.enabled !== false &&
        trackMeta('video', c.lane ?? 0)?.exportEnabled !== false &&
        curT >= c.timelineStart &&
        curT < c.timelineStart + clipSpan(c),
    );
    return clips.sort((a, b) => (b.lane ?? 0) - (a.lane ?? 0))[0] ?? null;
  }, [data.timeline?.clips, timelineTracks, curT]);

  const activeVideoMuted = active ? trackMeta('video', active.lane ?? 0)?.muted === true : false;

  const audioClips = useMemo(
    () => (data.timeline?.clips ?? []).filter((c) => c.track === 'audio' && c.sourceUrl && c.enabled !== false),
    [data.timeline?.clips],
  );
  const activeAudio = useMemo(
    () =>
      audioClips.filter(
        (c) =>
          trackMeta('audio', c.lane ?? 0)?.muted !== true &&
          curT >= c.timelineStart &&
          curT < c.timelineStart + clipSpan(c),
      ),
    [audioClips, timelineTracks, curT],
  );

  // 项目里存在音频内容（音频轨片段 / 带原声的视频）时才提供电平表开关（G9）
  const hasAudioContent = useMemo(
    () =>
      (data.timeline?.clips ?? []).some(
        (c) =>
          (c.track === 'audio' || (c.track === 'video' && !STILL_RE.test(c.sourceUrl ?? ''))) &&
          Boolean(c.sourceUrl),
      ),
    [data.timeline?.clips],
  );

  const activeSubs = useMemo(() => {
    return (data.timeline?.clips ?? [])
      .filter((c) => c.track === 'subtitle' && c.enabled !== false && curT >= c.timelineStart && curT < c.timelineStart + clipSpan(c))
      .sort((a, b) => (b.lane ?? 0) - (a.lane ?? 0) || (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  }, [data.timeline?.clips, curT]);
  // 轨道调色优先：左侧特效/滤镜与右侧调节都写进 tracks[].grade，预览和导出共用
  const trackGrade = (data.timeline?.tracks ?? []).find((t) => t.track === 'video' && (t.lane ?? 0) === (active?.lane ?? 0))?.grade ?? null;
  const effectiveGrade = { ...grade, ...(trackGrade ?? {}) };

  /** 片段最终预览增益 =（增益对话框临时值 ?? clip.volume）× 包络 × 淡入淡出（G10/G11/G12） */
  const gainFor = (clip: TimelineClip, localT: number, span: number) => {
    const override = previewVolRef.current.get(clip.id);
    const src = override != null ? { ...clip, volume: override } : clip;
    return Math.max(0, Math.min(2, clipGainAt(src, localT) * fadeFactorAt(clip, localT, span)));
  };

  /**
   * 片段输出统一接线：GainNode →（FX 链，若有）→ master/destination。
   * 电平表开关联动与 FX 重建都走这里，避免两套接线逻辑打架。
   */
  const wireClipAudioOut = (clipId: string, gainNode: GainNode) => {
    const ctx = audioCtxRef.current;
    if (!ctx) return;
    const out = meterChainRef.current ? meterChainRef.current.master : ctx.destination;
    const fx = audioFxRef.current.get(clipId);
    if (fx) {
      try { fx.tail.disconnect(); } catch { /* 已断开 */ }
      fx.tail.connect(out);
      gainNode.connect(fx.entry);
    } else {
      gainNode.connect(out);
    }
  };

  /**
   * 同步某片段的 FX 链：结构（增删/换类型/bypass/重排）变化整链重建，
   * 纯参数变化只原位改 value（不重建，拖动滑杆时听感无缝）；空链 = 拆链直通。
   * localT = 播放头的片段内相对秒：节点带 FX 参数自动化时按它插值出「生效值」
   * 再原位写 AudioParam（静态参数作为无断点时的 fallback）。音频 effect 依赖
   * curT，播放/seek 每帧都会走到这里——与音量包络 clipGainAt 同款逐帧时机。
   */
  const syncClipFx = (clipId: string, gainNode: GainNode, nodes: TimelineClipAudioFxNode[] | null, localT = 0) => {
    const ctx = audioCtxRef.current;
    if (!ctx) return;
    const cached = audioFxRef.current.get(clipId);
    const sig = nodes && nodes.length > 0 ? fxChainSig(nodes) : '';
    if (!sig) {
      if (cached) {
        disposeFxChain(cached);
        audioFxRef.current.delete(clipId);
        try { gainNode.disconnect(); } catch { /* 已断开 */ }
        wireClipAudioOut(clipId, gainNode);
      }
      return;
    }
    if (cached && cached.sig === sig) {
      // 参数微变更：逐节点原位改 value（自动化参数 = 插值后的生效值）；
      // reverb 的 decay 变化会按需重建 IR
      for (let i = 0; i < nodes!.length; i += 1) cached.apply[i]?.(fxEffectiveParams(nodes![i], localT));
      return;
    }
    if (cached) disposeFxChain(cached);
    const next = buildAudioFxChain(ctx, nodes!);
    try { gainNode.disconnect(); } catch { /* 已断开 */ }
    if (next) {
      audioFxRef.current.set(clipId, next);
      // 建链默认吃静态参数：有自动化时立刻按当前播放头补一次生效值，
      // 否则要等下一帧 curT 推进才会覆盖成插值值
      for (let i = 0; i < nodes!.length; i += 1) next.apply[i]?.(fxEffectiveParams(nodes![i], localT));
    } else audioFxRef.current.delete(clipId);
    wireClipAudioOut(clipId, gainNode);
  };

  // 真预览：只显示播放头命中的真实片段，不用项目封面/首帧冒充当前画面。
  const url = active?.sourceUrl || '';
  const isStill = STILL_RE.test(url);
  const transform = sampleVideoTransform(active?.keyframes, active ? curT - active.timelineStart : 0);
  const local = active ? Math.max(0, curT - active.timelineStart) : 0;
  const activeSpan = active ? clipSpan(active) : 0;
  const visual = active?.visual ?? null;
  const tracking = sampleTracking(visual?.tracking, local);
  const beauty = beautyStyle(visual?.beauty);
  const composited = {
    ...transform,
    x: transform.x + tracking.x,
    y: transform.y + tracking.y,
    scale: transform.scale * tracking.scale,
  };
  // 源画面裁切（C1）：裁切条目追加在媒体 transform 末尾 = 源空间最先裁切，
  // 与导出滤镜链「crop 在最前」同序；运镜/美容/旋转作用在裁切后的画面上。
  // 蒙版（mediaMask）挂在未变换的 .media-effect 上，坐标系仍是项目画幅 ——
  // 即蒙版作用在「裁切后的显示画面」，与所见即所得一致；字幕/安全区不受影响。
  const cropT = cropTransform(visual?.crop);
  // 画面层的统一变换（缩放/位移/旋转/美容收紧 + 裁切）：video、img、chroma 与 LUT canvas 共用同一份
  const mediaTransform = `scale(${composited.scale}) translate(${composited.x * 100}%, ${composited.y * 100}%) rotate(${composited.rotate}deg) scaleX(${beauty.scaleX})${cropT ? ` ${cropT}` : ''}`;
  const mediaMask = maskStyle(visual?.mask);
  const keying = visual?.keying?.enabled ? visual.keying : null;
  // LUT（.cube）：当前片段挂了 lut 且表加载/渲染成功时接管画面；失败回退原片直出
  const lutUrl = visual?.lut?.url ?? null;
  const sourceTime = active ? (active.reverse ? Math.max(active.inPoint, active.outPoint - local * active.speed) : active.inPoint + local * active.speed) : 0;
  // 画面淡入淡出（G11）：图片/视频都按片段头尾线性透明度（与导出 fade 滤镜同语义）
  const activeFadeFactor = active ? fadeFactorAt(active, local, activeSpan) : 1;

  useEffect(() => setVideoBroken(false), [url]);

  // 增益对话框（G10）拖动 fader 的实时预览：写 ref，随播放/seek 生效
  useEffect(() => {
    const onPreview = (e: Event) => {
      const detail = (e as CustomEvent).detail as { id: string; volume: number } | null;
      if (!detail) previewVolRef.current.clear();
      else previewVolRef.current.set(detail.id, detail.volume);
    };
    window.addEventListener(PREVIEW_VOLUME_EVENT, onPreview);
    return () => window.removeEventListener(PREVIEW_VOLUME_EVENT, onPreview);
  }, []);

  // FX 拖动实时预览（音频效果区块）：写 ref + 触发音频循环重跑做原位参数更新
  //（不落库；Inspector 在松手/失焦时 commit 并派发 detail=null 清空）
  useEffect(() => {
    const onPreview = (e: Event) => {
      const detail = (e as CustomEvent).detail as { id: string; nodes: TimelineClipAudioFxNode[] } | null;
      if (!detail) previewFxRef.current.clear();
      else previewFxRef.current.set(detail.id, detail.nodes);
      setFxPreviewTick((v) => v + 1);
    };
    window.addEventListener(PREVIEW_AUDIO_FX_EVENT, onPreview);
    return () => window.removeEventListener(PREVIEW_AUDIO_FX_EVENT, onPreview);
  }, []);

  useEffect(() => {
    const v = videoRef.current;
    if (!v || isStill) return;
    const sync = () => {
      // 走带倒放 / 倒放片段（G7）：HTML5 video 无原生反放，暂停并逐帧精确 seek；
      // 正放保持漂移阈值内的自然播放（playbackRate 与 curT 推进速率一致）
      const stepping = playing && (playDir === -1 || active?.reverse === true);
      if (Number.isFinite(sourceTime)) {
        if (stepping) {
          try { if (Math.abs(v.currentTime - sourceTime) > 0.015) v.currentTime = sourceTime; } catch { /* 元数据未就绪 */ }
        } else if (Math.abs(v.currentTime - sourceTime) > 0.28) {
          try { v.currentTime = sourceTime; } catch { /* 元数据未就绪 */ }
        }
      }
      // 画面原声音量 = 片段 volume × 音量包络 × 淡入淡出（白线/包络线/淡变把手实时作用于预览；
      // >1 增益受跨域限制，导出端完整生效）
      const gain = active ? gainFor(active, local, activeSpan) : 1;
      v.volume = Math.min(1, Math.max(0, gain)) * previewVolume;
      // 有独立音频轨在出声时，画面本体静音，避免同一条对白重复播放；
      // 包络/淡变把当前播放头压到 0 时同样静音
      v.muted = previewMuted || activeVideoMuted || activeAudio.length > 0 || gain <= 0.001;
      if (stepping) {
        v.pause();
        return;
      }
      // 正放加速（G7）：playbackRate = 片段速度 × 走带速度档位（上限 4）
      const rate = (active?.speed && active.speed > 0 ? active.speed : 1) * (playing ? playSpeed : 1);
      v.playbackRate = Math.max(0.1, Math.min(4, rate));
      if (playing) void v.play().catch(() => undefined);
      else v.pause();
    };
    if (v.readyState >= 1) sync();
    else v.addEventListener('loadedmetadata', sync, { once: true });
    return () => v.removeEventListener('loadedmetadata', sync);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceTime, playing, playDir, playSpeed, previewVolume, previewMuted, isStill, active?.id, active?.volume, active?.volumeAutomation, active?.reverse, active?.fadeIn, active?.fadeOut, activeAudio.length, activeVideoMuted]);

  // —— 电平表（G9）：开启时建主总线（master→splitter→L/R Analyser），
  // 并把已建图的片段 GainNode 统一接到 master（Analyser 接在 gain 之后，
  // 包络 / 淡变 / 对话框临时增益都计入）。点击开关本身是用户手势，可直接 resume；
  // 关闭时保留已建链路（节点仍经 master 直通 destination，听感不变）。
  useEffect(() => {
    if (!metersOn) return;
    try {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      if (!audioCtxRef.current) audioCtxRef.current = new Ctx();
      const ctx = audioCtxRef.current;
      if (!meterChainRef.current && ctx) {
        const master = ctx.createGain();
        const splitter = ctx.createChannelSplitter(2);
        const analyserL = ctx.createAnalyser();
        const analyserR = ctx.createAnalyser();
        analyserL.fftSize = 1024;
        analyserR.fftSize = 1024;
        analyserL.smoothingTimeConstant = 0.25;
        analyserR.smoothingTimeConstant = 0.25;
        master.connect(ctx.destination);
        master.connect(splitter);
        splitter.connect(analyserL, 0);
        splitter.connect(analyserR, 1);
        meterChainRef.current = {
          master,
          splitter,
          analyserL,
          analyserR,
          bufL: new Float32Array(analyserL.fftSize),
          bufR: new Float32Array(analyserR.fftSize),
        };
      }
      const chain = meterChainRef.current;
      if (!chain) return;
      void ctx.resume().catch(() => undefined);
      for (const [clipId, node] of audioGainRef.current.entries()) {
        try {
          node.disconnect();
        } catch {
          /* 已断开 */
        }
        // 统一接线：有 FX 链的片段接链（链尾再进 master），没有的直连 master
        wireClipAudioOut(clipId, node);
      }
    } catch {
      // WebAudio 不可用（极端环境）时电平表静默降级为不出数
    }
  }, [metersOn]);

  // 电平表 rAF：RMS + 峰值保持，直写 DOM style，不触发 React 重渲染；暂停归零
  useEffect(() => {
    if (!metersOn) return;
    let raf = 0;
    let peakL = 0;
    let peakR = 0;
    const norm = (amp: number) => {
      const db = 20 * Math.log10(Math.max(amp, 1e-6));
      return Math.max(0, Math.min(1, (db + 60) / 66)); // -60dB → 0，+6dB → 1
    };
    const write = (el: HTMLSpanElement | null, v: number) => {
      if (el) el.style.transform = `scaleY(${v.toFixed(4)})`;
    };
    const writePeak = (el: HTMLSpanElement | null, v: number) => {
      if (el) el.style.bottom = `${(v * 100).toFixed(2)}%`;
    };
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const chain = meterChainRef.current;
      const live = Boolean(
        playingRef.current &&
          chain &&
          audioCtxRef.current &&
          audioCtxRef.current.state === 'running',
      );
      let l = 0;
      let r = 0;
      if (live && chain) {
        chain.analyserL.getFloatTimeDomainData(chain.bufL);
        chain.analyserR.getFloatTimeDomainData(chain.bufR);
        l = rmsOf(chain.bufL);
        r = rmsOf(chain.bufR);
      }
      // 峰值保持：缓慢下落（约 2s 从顶落到 0），暂停立即归零
      peakL = live ? Math.max(l, peakL - 0.006) : 0;
      peakR = live ? Math.max(r, peakR - 0.006) : 0;
      write(fillLRef.current, norm(l));
      write(fillRRef.current, norm(r));
      writePeak(peakLRef.current, norm(peakL));
      writePeak(peakRRef.current, norm(peakR));
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [metersOn]);

  // 音频轨真实播放：时间线每帧对齐 sourceTime，音量/速度/音高/淡变实时生效
  useEffect(() => {
    for (const c of audioClips) {
      const a = audioRefs.current.get(c.id);
      if (!a) continue;
      const inRange = curT >= c.timelineStart && curT < c.timelineStart + clipSpan(c);
      const laneMuted = trackMeta('audio', c.lane ?? 0)?.muted === true;
      if (!inRange || laneMuted) {
        a.pause();
        continue;
      }
      const rate = Math.max(0.1, c.speed ?? 1);
      const pitch = Math.min(2, Math.max(0.5, c.pitch ?? 1));
      const span = clipSpan(c);
      const local = Math.max(0, curT - c.timelineStart);
      const st = c.reverse ? Math.max(c.inPoint, c.outPoint - local * rate) : c.inPoint + local * rate;
      const stepping = playing && (playDir === -1 || c.reverse === true);
      if (stepping) {
        // 倒放（G7）/ 倒放片段：无原生反放，暂停并逐帧精确 seek
        if (Number.isFinite(st) && Math.abs(a.currentTime - st) > 0.015) {
          try { a.currentTime = st; } catch { /* 元数据未就绪 */ }
        }
        a.pause();
        continue;
      }
      if (Number.isFinite(st) && Math.abs(a.currentTime - st) > 0.2) {
        try { a.currentTime = st; } catch { /* 元数据未就绪 */ }
      }
      // 音量包络（G12）× 淡入淡出（G11）：按播放头在包络折线上线性插值再乘淡变斜坡，
      // 每次播放头推进 / seek 都会重算（effect 依赖 curT），与导出的 afade + volume 表达式同语义
      const gain = gainFor(c, local, span);
      // 音频效果链（FX rack）：拖动中的预览链优先（不落库），否则读 EDL
      const fxNodes = previewFxRef.current.get(c.id) ?? (c.audioFx?.nodes ?? null);
      const fxActive = Boolean(fxNodes && fxNodes.some((n) => n.bypass !== true));
      let node = audioGainRef.current.get(c.id) ?? null;
      if (node && graphElRef.current.get(c.id) !== a) {
        // 片段 id 复用 / 元素重挂载：旧 GainNode 绑在已卸载元素上，丢弃重建
        try { node.disconnect(); } catch { /* 已断开 */ }
        audioGainRef.current.delete(c.id);
        graphElRef.current.delete(c.id);
        node = null;
      }
      const needGraph = gain > 1 || fxActive || (metersOnRef.current && graphSafeUrl(c.sourceUrl));
      if (!node && needGraph) {
        try {
          const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
          if (Ctx) {
            const ctx = audioCtxRef.current ?? new Ctx();
            audioCtxRef.current = ctx;
            const src = ctx.createMediaElementSource(a);
            node = ctx.createGain();
            src.connect(node);
            // 有 FX 链时经链再到 master/destination（wireClipAudioOut 统一接线）
            audioGainRef.current.set(c.id, node);
            graphElRef.current.set(c.id, a);
            wireClipAudioOut(c.id, node);
          }
        } catch {
          // 跨域未给 CORS 时无法建 MediaElementSource，退回元素最大音量
          node = undefined;
        }
      }
      // FX 链同步：结构变化重建 / 参数变化原位更新（拖动滑杆时听感无缝）；
      // FX 参数自动化按播放头（片段内相对秒 local）逐帧插值生效
      if (node) {
        syncClipFx(c.id, node as GainNode, fxNodes, local);
      }
      if (node) {
        a.volume = 1;
        node.gain.value = previewMuted ? 0 : Math.min(2, gain * previewVolume);
        if (playing && audioCtxRef.current?.state === 'suspended') void audioCtxRef.current.resume();
      } else {
        a.volume = Math.min(1, gain) * previewVolume;
      }
      a.preservesPitch = pitch === 1;
      // 走带加速（G7）：元素播放速率 = 片段速率 × 音高 × 走带档位
      a.playbackRate = Math.max(0.1, Math.min(4, rate * pitch * playSpeed));
      if (previewMuted) a.pause();
      else if (playing) void a.play().catch(() => undefined);
      else a.pause();
    }
    // 已删除片段的 FX 链回收（<audio> 元素卸载不会自动清理这里的缓存）
    const liveIds = new Set(audioClips.map((c) => c.id));
    for (const [clipId, chain] of audioFxRef.current) {
      if (!liveIds.has(clipId)) {
        disposeFxChain(chain);
        audioFxRef.current.delete(clipId);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioClips, curT, playing, playDir, playSpeed, previewVolume, previewMuted, fxPreviewTick]);

  useEffect(() => () => {
    for (const a of audioRefs.current.values()) a.pause();
    for (const chain of audioFxRef.current.values()) disposeFxChain(chain);
    audioFxRef.current.clear();
    audioGainRef.current.clear();
    graphElRef.current.clear();
    void audioCtxRef.current?.close().catch(() => undefined);
    audioCtxRef.current = null;
    meterChainRef.current = null;
  }, []);

  const filter = [
    previewQuality === 'fast' ? 'saturate(.92) contrast(.96) brightness(.97)' : '',
    effectiveGrade.filter === 'cinematic' ? 'sepia(.12) contrast(1.08)' : '',
    effectiveGrade.filter === 'warm' ? 'sepia(.2) saturate(1.08)' : '',
    effectiveGrade.filter === 'cool' ? 'hue-rotate(10deg) saturate(.9)' : '',
    effectiveGrade.filter === 'soft' ? 'brightness(1.06) contrast(.92) saturate(.96)' : '',
    effectiveGrade.filter === 'sharp' ? 'contrast(1.14) saturate(1.08)' : '',
    effectiveGrade.filter === 'fade' ? 'sepia(.16) saturate(.68) contrast(.92)' : '',
    effectiveGrade.brightness !== 100 ? `brightness(${effectiveGrade.brightness}%)` : '',
    effectiveGrade.contrast !== 100 ? `contrast(${effectiveGrade.contrast}%)` : '',
    effectiveGrade.saturation !== 100 ? `saturate(${effectiveGrade.saturation}%)` : '',
    aiFilter(visual?.ai),
    beauty.filter,
  ]
    .filter(Boolean)
    .join(' ');

  // 实时色度键：按像素距离删背景；导出用 ffmpeg chromakey，参数同源。
  useEffect(() => {
    const v = videoRef.current;
    const c = chromaRef.current;
    if (!v || !c || !keying) return;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    const hex = keying.color.replace('#', '');
    const kr = parseInt(hex.slice(0, 2), 16);
    const kg = parseInt(hex.slice(2, 4), 16);
    const kb = parseInt(hex.slice(4, 6), 16);
    const threshold = Math.max(10, keying.similarity * 441);
    const soft = Math.max(1, keying.smoothness * 180 + 1);
    let raf = 0;
    let last = 0;
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      if (now - last < 33) return;
      last = now;
      if (!v.videoWidth || v.paused || v.seeking) return;
      const scale = Math.min(1, 720 / v.videoWidth);
      const w = Math.max(1, Math.round(v.videoWidth * scale));
      const h = Math.max(1, Math.round(v.videoHeight * scale));
      if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
      ctx.drawImage(v, 0, 0, w, h);
      const frame = ctx.getImageData(0, 0, w, h);
      const d = frame.data;
      for (let i = 0; i < d.length; i += 4) {
        const dr = d[i] - kr;
        const dg = d[i + 1] - kg;
        const db = d[i + 2] - kb;
        const dist = Math.sqrt(dr * dr + dg * dg + db * db);
        if (dist < threshold) d[i + 3] = 0;
        else if (dist < threshold + soft) d[i + 3] = Math.round(((dist - threshold) / soft) * 255);
        else if (keying.spill > 0) {
          const spill = keying.spill * 0.6;
          const rb = (d[i] + d[i + 2]) / 2;
          if (d[i + 1] > rb) d[i + 1] = Math.round(d[i + 1] * (1 - spill) + rb * spill);
        }
      }
      ctx.putImageData(frame, 0, 0);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [keying, active?.id]);

  // LUT（.cube）预览：取到表后交给 WebGL 渲染器接管该片段画面。
  // 任一步失败（拉取/解析/WebGL2 不可用）都诚实降级回原 <video>/<img> 直出，
  // console.warn 只提示一次，不影响走带、字幕与导出。
  useEffect(() => {
    setLutReady(false);
    if (!lutUrl) return;
    const canvas = lutCanvasRef.current;
    const src = isStill ? stillRef.current : videoRef.current;
    if (!canvas || !src) return;
    let disposed = false;
    let renderer: LutVideoRenderer | null = null;
    const wantedStrength = visual?.lut?.strength ?? 1;
    fetch(lutUrl)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.text();
      })
      .then((text) => {
        if (disposed) return;
        const table = parseLutCube(text);
        renderer = createLutVideoRenderer({
          canvas,
          source: src as HTMLVideoElement | HTMLImageElement,
          table,
          strength: wantedStrength,
          // 流畅预览档与 chroma canvas 一样限 720，原画档 1280 已远超画布显示尺寸
          maxSize: previewQuality === 'fast' ? 720 : 1280,
        });
        if (!renderer) throw new Error('WebGL2 不可用');
        lutRendererRef.current = renderer;
        setLutReady(true);
      })
      .catch((err: unknown) => {
        if (disposed) return;
        if (!lutDegradedWarned) {
          lutDegradedWarned = true;
          console.warn('LUT 预览不可用，已回退原片直出：', err instanceof Error ? err.message : err);
        }
        setLutReady(false);
      });
    return () => {
      disposed = true;
      renderer?.dispose();
      lutRendererRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lutUrl, active?.id, isStill, url, previewQuality]);

  // LUT 强度热更：拖滑杆不重建渲染器，只改 uniform（渲染器重建时初值在创建参数里）
  useEffect(() => {
    lutRendererRef.current?.setStrength(visual?.lut?.strength ?? 1);
  }, [visual?.lut?.strength, lutUrl, active?.id]);

  const hexRgba = (hex: string | undefined, alpha: number) => {
    const h = (hex || '#000000').replace('#', '');
    const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.padEnd(6, '0').slice(0, 6);
    return `rgba(${parseInt(full.slice(0, 2), 16)},${parseInt(full.slice(2, 4), 16)},${parseInt(full.slice(4, 6), 16)},${alpha})`;
  };
  const styleFor = (subStyle: TimelineTextStyle | null | undefined, id?: string) => {
    if (!subStyle) return undefined;
    const dragging = subDrag?.id === id;
    const x = dragging ? subDrag.x : (subStyle.x ?? 0.5);
    const y = dragging ? subDrag.y : (subStyle.y ?? 0.86);
    const widthPct = Math.max(20, (subStyle.maxWidth ?? 0.86) * 100);
    // 字幕框按中心定位；用户把 X 拖得太靠边时，宽字幕会有一半跑出画外。
    // 按当前宽度把中心夹在画面内，保证导出/预览都不会截字。
    const clampedX = Math.min(1 - widthPct / 200, Math.max(widthPct / 200, x));
    // 字幕底色必须随模板走：CSS 里 span 旧实现硬编码 #0000008c，
    // 选「经典白字/极简小字」也永远带一条黑底，和剪映不一致。
    const subBg = (subStyle.bgOpacity ?? 0) > 0 ? hexRgba(subStyle.bgColor, subStyle.bgOpacity ?? 0) : 'transparent';
    return {
      top: `${y * 100}%`,
      left: `${clampedX * 100}%`,
      right: 'auto',
      bottom: 'auto',
      width: `${Math.max(20, (subStyle.maxWidth ?? 0.86) * 100)}%`,
      transform: 'translate(-50%, -50%)',
      textAlign: subStyle.align ?? 'center',
      fontSize: `${subStyle.fontSize ?? 7}cqh`,
      fontFamily: PREVIEW_FONTS[subStyle.fontFamily ?? 'source-han-sans'] ?? PREVIEW_FONTS['source-han-sans'],
      color: subStyle.color || '#ffffff',
      fontWeight: subStyle.bold ? 800 : 600,
      fontStyle: subStyle.italic ? 'italic' : 'normal',
      WebkitTextStroke: (subStyle.strokeWidth ?? 0) > 0 ? `${(subStyle.strokeWidth ?? 0)}em ${subStyle.strokeColor || '#000000'}` : undefined,
      ['--sub-bg']: subBg,
      background: 'transparent',
      borderRadius: 0,
      padding: 0,
      cursor: 'grab',
      touchAction: 'none',
      pointerEvents: 'auto',
    } as CSSProperties;
  };

  const startSubtitleDrag = (e: React.PointerEvent, clipId: string, style?: TimelineTextStyle | null) => {
    e.stopPropagation();
    e.preventDefault();
    // 坐标换算集中在 canvasPointFromClient：rect 是按下瞬间的画布框快照（含缩放 transform），
    // 拖拽期间缩放不变，落库坐标与未缩放时一致（见 canvasPointFromClient 注释）
    const frame = canvasRef.current?.getBoundingClientRect();
    const start = canvasPointFromClient(frame, e.clientX, e.clientY);
    if (!start) return;
    const norm = (p: { x: number; y: number }) => ({
      x: Math.max(0.04, Math.min(0.96, p.x)),
      y: Math.max(0.1, Math.min(0.9, p.y)),
    });
    const seed = { id: clipId, x: norm(start).x, y: norm(start).y };
    lastSubDrag.current = seed;
    setSubDrag(seed);
    const onMove = (ev: PointerEvent) => {
      const p = canvasPointFromClient(frame, ev.clientX, ev.clientY);
      if (!p) return;
      const next = { id: clipId, x: norm(p).x, y: norm(p).y };
      lastSubDrag.current = next;
      setSubDrag(next);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      const last = lastSubDrag.current;
      setSubDrag(null);
      if (last && last.id === clipId) edl.updateTextStyle(clipId, { x: last.x, y: last.y });
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  // ================= 预览缩放/平移（对齐 OpenMotion NLEPreview） =================

  /** 画幅宽高比：与 .canvas-frame 的比例档一一对应，minimap 内容框按它等比缩放 */
  const stageAspect = ratio === '16:9' ? 16 / 9 : ratio === '1:1' ? 1 : ratio === '4:3' ? 4 / 3 : 9 / 16;

  /** 视口（canvas-wrap 客户区）与画幅（canvas-frame 未变换布局尺寸，CSS 自适应的 Fit 尺寸）量测 */
  const measureStage = useCallback(() => {
    const wrap = wrapRef.current;
    const frame = frameRef.current;
    return {
      viewportWidth: wrap?.clientWidth ?? 0,
      viewportHeight: wrap?.clientHeight ?? 0,
      contentWidth: frame?.offsetWidth ?? 0,
      contentHeight: frame?.offsetHeight ?? 0,
    };
  }, []);

  /** minimap 视区矩形同步：直写百分比样式，随每次 transform 更新，不触发渲染 */
  const drawNavigator = useCallback((state: StageZoomState) => {
    const region = minimapRegionRef.current;
    if (!region) return;
    const m = measureStage();
    if (m.viewportWidth <= 0 || m.contentWidth <= 0) return;
    const visible = resolveStageVisibleRegion({ state, ...m });
    region.style.left = `${visible.left * 100}%`;
    region.style.top = `${visible.top * 100}%`;
    region.style.width = `${visible.width * 100}%`;
    region.style.height = `${visible.height * 100}%`;
  }, [measureStage]);

  /** 把缩放状态落到画幅 DOM：Fit 时清掉内联 transform/will-change，保持「零变换」的默认画面 */
  const writeTransform = useCallback((state: StageZoomState) => {
    const frame = frameRef.current;
    if (!frame) return;
    if (isStageAtFit(state)) {
      frame.style.transform = '';
      frame.style.willChange = '';
    } else {
      frame.style.willChange = 'transform';
      frame.style.transform = `translate3d(${toDomPrecision(state.panX)}px, ${toDomPrecision(state.panY)}px, 0) scale(${toDomPrecision(state.zoomPercent / 100)})`;
    }
    drawNavigator(state);
  }, [drawNavigator]);

  /** 统一入口：夹紧 → zoomRef → HUD（仅缩放）→ DOM transform → 沉降后提交 settledZoom */
  const applyTransform = useCallback((next: StageZoomState, showHud: boolean) => {
    const clamped: StageZoomState = {
      zoomPercent: clampStageZoomPercent(next.zoomPercent),
      panX: Number.isFinite(next.panX) ? next.panX : 0,
      panY: Number.isFinite(next.panY) ? next.panY : 0,
    };
    zoomRef.current = clamped;
    if (showHud) {
      const hud = hudRef.current;
      if (hud) {
        if (!zoomingRef.current) {
          zoomingRef.current = true;
          hud.style.opacity = '1';
        }
        // 手势中逐帧刷新读数，避免第一次缩放时空壳/手势中途读到旧百分比
        hud.textContent = isStageAtFit(clamped) ? '适应' : `${Math.round(clamped.zoomPercent)}%`;
      }
    }
    writeTransform(clamped);
    if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
    settleTimerRef.current = setTimeout(() => {
      zoomingRef.current = false;
      const final = zoomRef.current;
      setSettledZoom((prev) =>
        prev.zoomPercent === final.zoomPercent && prev.panX === final.panX && prev.panY === final.panY ? prev : final,
      );
      if (showHud) {
        const hud = hudRef.current;
        if (hud) {
          hud.textContent = isStageAtFit(final) ? '适应' : `${Math.round(final.zoomPercent)}%`;
          if (hudTimerRef.current) clearTimeout(hudTimerRef.current);
          hudTimerRef.current = setTimeout(() => {
            if (hudRef.current) hudRef.current.style.opacity = '0';
          }, STAGE_ZOOM_HUD_TIMEOUT_MS);
        }
      }
    }, STAGE_ZOOM_SETTLE_MS);
  }, [writeTransform]);

  const applyZoom = useCallback((next: StageZoomState) => applyTransform(next, true), [applyTransform]);
  const applyPan = useCallback((next: StageZoomState) => applyTransform(next, false), [applyTransform]);
  const applyFit = useCallback(() => applyTransform({ ...DEFAULT_STAGE_ZOOM }, true), [applyTransform]);
  /** 档位菜单选档：跳到预设比例并居中（OpenMotion 同语义：选档归零平移） */
  const zoomToPreset = useCallback(
    (percent: number) => applyZoom({ ...DEFAULT_STAGE_ZOOM, zoomPercent: percent }),
    [applyZoom],
  );

  /** minimap 拖拽/点按 → 主画布平移：让视区中心落在画幅的 (fx, fy) 归一化位置 */
  const panMinimapToFrac = useCallback((fx: number, fy: number) => {
    const m = measureStage();
    if (m.contentWidth <= 0) return;
    const pan = resolveStagePanToRegionCenter({ fx, fy, zoomPercent: zoomRef.current.zoomPercent, ...m });
    applyPan({ ...zoomRef.current, ...pan });
  }, [applyPan, measureStage]);

  /** minimap 视区矩形回调 ref：节点挂载/卸载（折叠切换）时立即补一次同步 */
  const setMinimapRegion = useCallback((node: HTMLDivElement | null) => {
    minimapRegionRef.current = node;
    drawNavigator(zoomRef.current);
  }, [drawNavigator]);

  useEffect(() => () => {
    if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
    if (hudTimerRef.current) clearTimeout(hudTimerRef.current);
  }, []);

  // Ctrl/⌘+滚轮以光标为锚缩放，滚轮直接滚动 = 平移；rAF 合帧，一帧内的多条 wheel 只应用最新一条
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    let raf = 0;
    let pending: { zoom: boolean; clientX: number; clientY: number; deltaX: number; deltaY: number } | null = null;
    const flush = () => {
      raf = 0;
      const ev = pending;
      pending = null;
      const frame = frameRef.current;
      if (!ev || !frame) return;
      const m = measureStage();
      if (m.viewportWidth <= 0 || m.contentWidth <= 0) return;
      if (ev.zoom) {
        // 光标锚定：cursor 相对「未缩放画幅中心」= 变换后 rect 中心 − 当前 pan（推导见 stageZoom.ts 头注释）
        const rect = frame.getBoundingClientRect();
        const cursorX = ev.clientX - (rect.left + rect.width / 2 - zoomRef.current.panX);
        const cursorY = ev.clientY - (rect.top + rect.height / 2 - zoomRef.current.panY);
        applyZoom(resolveStageWheelZoom({ state: zoomRef.current, deltaY: ev.deltaY, ...m, cursorX, cursorY }));
      } else {
        applyPan(resolveStageWheelPan({ state: zoomRef.current, deltaX: ev.deltaX, deltaY: ev.deltaY, ...m }));
      }
    };
    const onWheel = (e: WheelEvent) => {
      // 画布区滚轮不外溢：缩放手势拦浏览器页面缩放，平移拦滚动链/双指历史导航
      e.preventDefault();
      pending = { zoom: e.ctrlKey || e.metaKey, clientX: e.clientX, clientY: e.clientY, deltaX: e.deltaX, deltaY: e.deltaY };
      if (!raf) raf = requestAnimationFrame(flush);
    };
    wrap.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      wrap.removeEventListener('wheel', onWheel);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [applyZoom, applyPan, measureStage]);

  // 中键拖拽 = 平移（左键留给播放/暂停与字幕拖拽，字幕层/minimap 上不抢手势）
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const isPanSurface = (target: EventTarget | null) =>
      target instanceof Element && !target.closest('.layer-sub, .stage-minimap, .stage-zoom-pop');
    const onPointerDown = (e: PointerEvent) => {
      if (!canStartStagePan(e.button) || !isPanSurface(e.target)) return;
      e.preventDefault(); // 拦下中键自动滚动
      panDragRef.current = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        originX: zoomRef.current.panX,
        originY: zoomRef.current.panY,
      };
    };
    const onPointerMove = (e: PointerEvent) => {
      const drag = panDragRef.current;
      if (!drag || drag.pointerId !== e.pointerId) return;
      const m = measureStage();
      if (m.viewportWidth <= 0 || m.contentWidth <= 0) return;
      const pan = clampStagePan({
        panX: drag.originX + e.clientX - drag.startX,
        panY: drag.originY + e.clientY - drag.startY,
        zoomPercent: zoomRef.current.zoomPercent,
        ...m,
      });
      applyPan({ ...zoomRef.current, ...pan });
    };
    const finish = (e: PointerEvent) => {
      if (panDragRef.current?.pointerId === e.pointerId) panDragRef.current = null;
    };
    const onAuxClick = (e: MouseEvent) => {
      if (e.button === 1 && isPanSurface(e.target)) e.preventDefault();
    };
    wrap.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
    wrap.addEventListener('auxclick', onAuxClick);
    return () => {
      wrap.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      wrap.removeEventListener('auxclick', onAuxClick);
    };
  }, [applyPan, measureStage]);

  // 视口/画幅尺寸变化（分栏拖动、切画幅、进出全屏）：平移重新夹紧 + minimap 视区同步（不闪 HUD）
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => applyPan(zoomRef.current));
    ro.observe(wrap);
    const frame = frameRef.current;
    if (frame) ro.observe(frame);
    return () => ro.disconnect();
  }, [applyPan]);

  // 预览全屏（OpenMotion presentationMode 语义）：进入全屏强制回 Fit 便于整幅观看，
  // 全屏内缩放/平移/HUD/minimap 照常可用；退出全屏的尺寸变化交给 ResizeObserver 重新夹紧
  useEffect(() => {
    const onFullscreenChange = () => {
      const el = document.fullscreenElement;
      const wrap = wrapRef.current;
      if (!el || !wrap) return;
      if (el === document.documentElement || el.contains(wrap)) applyFit();
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, [applyFit]);

  // Esc 复位 Fit：只在「指针悬在画布区」或「焦点在画布区」时生效（滚轮缩放不聚焦画布，
  // 焦点式监听接不住）。对话框打开时遮罩盖住画布不会命中悬停，不与既有 Esc 关闭逻辑冲突；
  // 缩放档位菜单开着时其 capture 层先吞掉 Esc，也不会触发。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || isStageAtFit(zoomRef.current)) return;
      const wrap = wrapRef.current;
      if (!wrap) return;
      const active = document.activeElement;
      const focusInside = active instanceof Node && wrap.contains(active);
      if (focusInside || wrap.matches(':hover')) applyFit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [applyFit]);
  // 双击画布复位 Fit（画布单击仍是播放/暂停，双击的两次 toggle 相互抵消）
  const onStageDoubleClick = (e: React.MouseEvent) => {
    const target = e.target as Element;
    if (target.closest('.layer-sub, .stage-minimap, .stage-zoom-pop')) return;
    if (!isStageAtFit(zoomRef.current)) applyFit();
  };

  const renderSubs = activeSubs.length > 0 && !(active && (active.lane ?? 0) > 0);

  return (
    <section className="stage">
      <div className="stage-bar">
        <div className="meta">
          <span>{ratio}</span><span className="dot" />
          <span>{data.timeline?.width ?? 1080} × {data.timeline?.height ?? 1920}</span><span className="dot" />
          <span>{edl.fps} fps</span><span className="dot" />
          <span>{previewQuality === 'fast' ? '流畅预览 540p' : '原画预览'}</span>
        </div>
        <div className="right">
          <StageZoomControls
            zoom={settledZoom}
            onZoomPercent={zoomToPreset}
            onFit={applyFit}
          />
          <button type="button" className="icon-btn" data-tip="安全区参考线：短视频平台 UI 遮挡范围" onClick={onToggleSafe}>
            <Eye />
          </button>
          <button
            type="button"
            className="icon-btn"
            data-tip="全屏预览 (F)"
            onClick={() => {
              if (document.fullscreenElement) void document.exitFullscreen();
              else void document.documentElement.requestFullscreen?.();
            }}
          >
            <Maximize2 />
          </button>
        </div>
      </div>

      <div
        className="canvas-wrap"
        ref={wrapRef}
        onDoubleClick={onStageDoubleClick}
      >
        <div
          ref={frameRef}
          className={`canvas-frame${ratio === '16:9' ? ' wide' : ratio === '1:1' ? ' square' : ratio === '4:3' ? ' four-three' : ''}`}
        >
          <div
            ref={canvasRef}
            className={`canvas${previewQuality === 'fast' ? ' fast' : ''}${safe ? ' safe-on' : ''}`}
            onClick={() => setPlaying(!playing)}
            role="button"
            tabIndex={0}
            aria-label="预览画面，点击播放或暂停"
          >
            {url && !videoBroken ? (
              <div className="media-effect" style={{ ...mediaMask, opacity: (visual?.opacity ?? 1) * activeFadeFactor }}>
                {isStill ? (
                  <>
                    {/* LUT 挂在静帧上时 img 只当 WebGL 纹理源，显示交给等尺寸 canvas（同 chroma canvas 模式） */}
                    <img ref={stillRef} className="bg" src={url} alt="" style={{ filter, opacity: lutReady ? 0 : 1, transform: mediaTransform }} />
                    {lutUrl ? (
                      <canvas
                        key={`${active?.id}:${url}:${lutUrl}`}
                        ref={lutCanvasRef}
                        className="bg lut-canvas"
                        style={{ filter, opacity: lutReady ? 1 : 0, transform: mediaTransform }}
                      />
                    ) : null}
                  </>
                ) : (
                  <>
                    <video
                      key={active?.id || url}
                      ref={videoRef}
                      className="bg"
                      src={url}
                      playsInline
                      muted={previewMuted || activeVideoMuted || activeAudio.length > 0}
                      onError={() => setVideoBroken(true)}
                      style={{ filter, opacity: keying || lutReady ? 0 : 1, transform: mediaTransform }}
                    />
                    {/* LUT canvas：WebGL 查表输出，CSS 调色链（filter）同样挂在它上，层序与导出一致；
                        同片段同时挂抠像时 chroma 仍从原 <video> 采样、盖在 LUT 层之上（导出为 LUT→chromakey） */}
                    {lutUrl ? (
                      <canvas
                        key={`${active?.id}:${url}:${lutUrl}`}
                        ref={lutCanvasRef}
                        className="bg lut-canvas"
                        style={{ filter, opacity: lutReady ? 1 : 0, transform: mediaTransform }}
                      />
                    ) : null}
                    {keying ? <canvas ref={chromaRef} className="bg chroma-canvas" style={{ filter, transform: mediaTransform }} /> : null}
                  </>
                )}
              </div>
            ) : null}
            {renderSubs ? (
              activeSubs.map((c) => (
                <div
                  key={c.id}
                  className={`layer-sub${subDrag?.id === c.id ? ' dragging' : ''}${edl.selectedIds.includes(c.id) ? ' selected' : ''}`}
                  style={styleFor(c.textStyle, c.id)}
                  data-subtitle-id={c.id}
                  title="拖动字幕到画面任意位置"
                  onPointerDown={(e) => startSubtitleDrag(e, c.id, c.textStyle)}
                  onClick={(e) => e.stopPropagation()}
                >
                  <span>{c.text}</span>
                </div>
              ))
            ) : null}
            {audioClips.map((c) => (
              <audio
                key={c.id}
                ref={(el) => {
                  if (el) audioRefs.current.set(c.id, el);
                  else audioRefs.current.delete(c.id);
                }}
                src={c.sourceUrl ?? undefined}
                preload="auto"
              />
            ))}
            <div className="safe" />
            {previewQuality === 'fast' ? <div className="quality-badge">流畅预览 · 代理 540p</div> : null}
          </div>
        </div>
        <StageZoomHud hudRef={hudRef} />
        <StageMinimap
          zoom={settledZoom}
          aspect={stageAspect}
          mediaUrl={url}
          mediaIsStill={isStill}
          regionRef={setMinimapRegion}
          onPanToFrac={panMinimapToFrac}
        />
        {!url || videoBroken ? (
          <div className="canvas-empty">
            <span>当前播放头没有可预览画面</span>
            <small>从左侧素材库拖入时间线，或选择已有镜头</small>
          </div>
        ) : null}
      </div>

      <div className="transport">
        <input
          className="scrub"
          type="range"
          min="0"
          max={total}
          step={1 / edl.fps}
          value={Math.min(total, curT)}
          title="拖动进度条预览"
          onChange={(e) => setCurT(Number(e.target.value))}
        />
        <div
          className="tc"
          role="button"
          tabIndex={0}
          title="点击切换 时间码 / 帧号 显示（时间线读数同步切换）"
          onClick={() => setTimeMode()}
          onKeyDown={(e) => { if (e.key === 'Enter') setTimeMode(); }}
          style={{ cursor: 'pointer', userSelect: 'none' }}
        >
          <span>{tcLabel(curT)}</span><em> / </em><span>{tcLabel(total)}</span>
        </div>
        <div className="mid">
          <button type="button" className="icon-btn" data-tip="跳到片头 (Home)" onClick={() => setCurT(0)}><IconSkipStart /></button>
          <button type="button" className="icon-btn" data-tip="上一帧 (←)" onClick={() => setCurT(Math.max(0, curT - 1 / edl.fps))}><IconFramePrev /></button>
          <button type="button" className="icon-btn play-btn" data-tip="播放 / 暂停 (Space)；J/L 加速走带" onClick={() => setPlaying(!playing)}>
            {playing ? <IconPause /> : <IconPlay />}
          </button>
          <button type="button" className="icon-btn" data-tip="下一帧 (→)" onClick={() => setCurT(Math.min(total, curT + 1 / edl.fps))}><IconFrameNext /></button>
          <button type="button" className="icon-btn" data-tip="跳到片尾 (End)" onClick={() => setCurT(total)}><IconSkipEnd /></button>
          <button
            type="button"
            className={`icon-btn${loopEnabled ? ' active' : ''}`}
            aria-pressed={loopEnabled}
            data-tip="循环播放 (Shift+L)：有 I/O 区域时区域内循环，否则循环整段"
            onClick={() => setLoopEnabled(!loopEnabled)}
          >
            <Repeat size={15} />
          </button>
          {playing && (playSpeed > 1 || playDir === -1) ? (
            <span className={`speed-badge${playDir === -1 ? ' rev' : ''}`}>
              {playDir === -1 ? '−' : ''}{playSpeed}×
            </span>
          ) : null}
        </div>
        <div className="right">
          {hasAudioContent && metersOn ? (
            <div className="meters" aria-hidden>
              <div className="meter"><span className="meter-fill" ref={fillLRef} /><span className="meter-peak" ref={peakLRef} /></div>
              <div className="meter"><span className="meter-fill" ref={fillRRef} /><span className="meter-peak" ref={peakRRef} /></div>
            </div>
          ) : null}
          {hasAudioContent ? (
            <button
              type="button"
              className={`icon-btn${metersOn ? ' active' : ''}`}
              aria-pressed={metersOn}
              data-tip="音频电平表：实时 RMS + 峰值保持（音频轨，含包络/淡变后的总输出）"
              onClick={() => setMetersOn((v) => { writeMetersOn(!v); return !v; })}
            >
              <AudioLines size={15} />
            </button>
          ) : null}
          <button
            type="button"
            className={`icon-btn${previewMuted ? ' active' : ''}`}
            data-tip={previewMuted ? '取消全局静音' : '全局静音'}
            onClick={() => setPreviewMuted(!previewMuted)}
          >
            {previewMuted ? <VolumeX /> : <Volume2 />}
          </button>
          <input
            className="vol-range"
            type="range"
            min="0"
            max="100"
            value={Math.round(previewVolume * 100)}
            title="预览监听音量，不改变片段音量"
            onChange={(e) => setPreviewVolume(Number(e.target.value) / 100)}
          />
          <button
            type="button"
            className="icon-btn"
            data-tip="全屏预览 (F)"
            onClick={() => {
              if (document.fullscreenElement) void document.exitFullscreen();
              else void document.documentElement.requestFullscreen?.();
            }}
          >
            <IconFullscreen />
          </button>
          <span className="save-pill" title={projectId ? '时间线自动保存' : ''}>
            {edl.saving ? '保存中' : edl.dirty ? '待保存' : '已保存'}
          </span>
        </div>
      </div>
    </section>
  );
};

const fmt = (sec: number) => {
  const t = Math.max(0, sec);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = Math.floor(t % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};

export default ShenJianStage;
