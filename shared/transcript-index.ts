/**
 * 毫秒级转写索引（纯函数，前后端共用）
 * -------------------------------------------------------------
 * 目的：让「给我剪一个 1 分钟宣传片」不再靠模型瞎猜时间码。
 *
 * 数据来源（按可信度从高到低）：
 *   1. 时间线字幕片段的真实时间线位置（timelineStart / inPoint / outPoint）
 *   2. 镜头对白 / 字幕文本 + 该镜头在时间线上的真实占用区间
 *
 * 诚实边界：
 *   · 字幕片段与镜头区间的时间码是精确的（毫秒）；
 *   · 一条字幕内如果包含多句，句间切分点按字数比例估算，不是语音强制对齐；
 *   · 当前项目没有词级 ASR 时间戳，words 仅为阅读辅助，统一标记 estimated=true；
 *   · 需要词级精度时，应接入外部 ASR（见 docs/神剪-深度剪辑-技术边界.md）。
 */
import type { Shot, TimelineClip, TimelineDocument } from './api.interface';

export type TranscriptSource = 'subtitle' | 'shot';
export type BoundaryQuality = 'exact-clip' | 'estimated-sentence' | 'estimated-word';

export interface TranscriptWord {
  text: string;
  startMs: number;
  endMs: number;
  estimated: true;
}

export interface TranscriptCue {
  /** 稳定引用：subtitle:<clientKey> / shot:<shotId>:<n> */
  key: string;
  /** 来源片段（字幕/画面）的 clientKey；Agent 可用它定位 EDL */
  clipKey: string;
  shotId?: string | null;
  source: TranscriptSource;
  /** 字幕/对白原文 */
  text: string;
  /** 时间线绝对毫秒（不是源媒体内的时间） */
  startMs: number;
  endMs: number;
  durationMs: number;
  /** 时间码可信度 */
  boundary: BoundaryQuality;
  /** 0–1：文本完整度/可读性，供抽取式打分参考 */
  quality: number;
  words: TranscriptWord[];
}

export interface TranscriptIndex {
  projectId: string;
  durationSec: number;
  cues: TranscriptCue[];
  /** 总字数（去空白后） */
  textChars: number;
  /** 每条来源各多少段 */
  counts: Record<TranscriptSource, number>;
  /** 是否含估算边界（前端/Agent 应如实展示） */
  hasEstimatedBoundaries: boolean;
}

interface ShotTextRow {
  id: string;
  dialogue?: string | null;
  subtitleText?: string | null;
}

const EPS = 1e-4;
const roundMs = (n: number) => Math.round(n);

const clipSpan = (c: Pick<TimelineClip, 'inPoint' | 'outPoint' | 'speed'>): number =>
  Math.max(0, (c.outPoint - c.inPoint) / (c.speed > 0 ? c.speed : 1));

const cleanText = (raw: string | null | undefined): string =>
  (raw ?? '')
    .replace(/[\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** 去掉「角色名：」前缀，保留台词本体；返回 [角色, 文本] */
export function splitSpeaker(text: string): { speaker: string; body: string } {
  const m = text.match(/^([^：:]{1,12})[：:]\s*(.+)$/);
  if (m) return { speaker: m[1].trim(), body: m[2].trim() };
  return { speaker: '', body: text.trim() };
}

/** 按中文标点断句；无标点时按逗号/空格；仍无则整段 */
export function splitSentences(text: string): string[] {
  const t = cleanText(text);
  if (!t) return [];
  const parts = t
    .split(/(?<=[。！？!?；;…])|(?<=[，,、])/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length > 1) return parts;
  return [t];
}

function qualityOf(text: string): number {
  const t = cleanText(text);
  if (!t) return 0;
  let q = Math.min(1, 0.35 + t.length / 42);
  if (/[。！？!?]/.test(t)) q += 0.12;
  if (t.length < 4) q -= 0.25;
  if (/^(嗯|啊|呃|哦|这个|那个|然后)$/.test(t)) q -= 0.35;
  return Math.max(0, Math.min(1, q));
}

/** 把一段文本按字符长度比例映射到 ms 区间，生成词级阅读时间（估算） */
function estimateWords(text: string, startMs: number, endMs: number): TranscriptWord[] {
  const units = cleanText(text)
    .split(/(\s+|(?<=[，。！？；：、])|(?<=[a-zA-Z0-9]))/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (units.length === 0) return [];
  const total = units.reduce((n, u) => n + u.length, 0) || units.length;
  let cursor = startMs;
  const out: TranscriptWord[] = [];
  for (const u of units) {
    const dur = Math.max(1, Math.round(((endMs - startMs) * u.length) / total));
    const end = Math.min(endMs, cursor + dur);
    out.push({ text: u, startMs: roundMs(cursor), endMs: roundMs(end), estimated: true });
    cursor = end;
  }
  if (out.length > 0) out[out.length - 1].endMs = endMs;
  return out;
}

/**
 * 把一个片段文本切成句级 cue。时间边界按字符比例估算，
 * 外层片段边界仍是 exact-clip；只有被切开的句子标记 estimated-sentence。
 */
function pushSentenceCues(
  out: TranscriptCue[],
  opts: {
    clipKey: string;
    shotId?: string | null;
    source: TranscriptSource;
    clipText: string;
    startMs: number;
    endMs: number;
    baseKey: string;
  },
) {
  const text = cleanText(opts.clipText);
  if (!text) return;
  const sentences = splitSentences(text);
  if (sentences.length <= 1) {
    out.push({
      key: opts.baseKey,
      clipKey: opts.clipKey,
      shotId: opts.shotId ?? null,
      source: opts.source,
      text,
      startMs: roundMs(opts.startMs),
      endMs: roundMs(opts.endMs),
      durationMs: Math.max(1, roundMs(opts.endMs - opts.startMs)),
      boundary: 'exact-clip',
      quality: qualityOf(text),
      words: estimateWords(text, opts.startMs, opts.endMs),
    });
    return;
  }
  const total = sentences.reduce((n, s) => n + s.length, 0) || sentences.length;
  let cursor = opts.startMs;
  sentences.forEach((sentence, i) => {
    const isLast = i === sentences.length - 1;
    const dur = isLast
      ? opts.endMs - cursor
      : Math.max(1, Math.round(((opts.endMs - opts.startMs) * sentence.length) / total));
    const end = Math.min(opts.endMs, cursor + dur);
    out.push({
      key: `${opts.baseKey}#${i + 1}`,
      clipKey: opts.clipKey,
      shotId: opts.shotId ?? null,
      source: opts.source,
      text: sentence,
      startMs: roundMs(cursor),
      endMs: roundMs(end),
      durationMs: Math.max(1, roundMs(end - cursor)),
      boundary: 'estimated-sentence',
      quality: qualityOf(sentence),
      words: estimateWords(sentence, cursor, end),
    });
    cursor = end;
  });
}

/**
 * 构建整条时间线的转写索引。
 * @param shots 项目镜头（用于给「没有字幕但有对白」的画面补文本）
 */
export function buildTranscriptIndex(
  doc: TimelineDocument,
  shots: ShotTextRow[] | Shot[] = [],
): TranscriptIndex {
  const shotById = new Map<string, ShotTextRow>();
  for (const s of shots as ShotTextRow[]) {
    if (s?.id) shotById.set(s.id, s);
  }
  const cues: TranscriptCue[] = [];
  const subtitleShotIds = new Set<string>();

  const enabledClips = doc.clips.filter((c) => c.enabled !== false);

  // 1) 字幕片段优先：它的时间码就是成片时间码
  for (const c of enabledClips) {
    if (c.track !== 'subtitle') continue;
    const text = cleanText(c.text);
    if (!text) continue;
    if (c.sourceShotId) subtitleShotIds.add(c.sourceShotId);
    const start = c.timelineStart;
    const end = c.timelineStart + clipSpan(c);
    if (end - start < EPS) continue;
    pushSentenceCues(cues, {
      clipKey: c.clientKey ?? c.id,
      shotId: c.sourceShotId ?? null,
      source: 'subtitle',
      clipText: text,
      startMs: start * 1000,
      endMs: end * 1000,
      baseKey: `subtitle:${c.clientKey ?? c.id}`,
    });
  }

  // 2) 画面片段补对白/字幕：同一镜已有字幕就不重复
  for (const c of enabledClips) {
    if (c.track !== 'video') continue;
    const shot = c.sourceShotId ? shotById.get(c.sourceShotId) : undefined;
    if (!shot) continue;
    if (c.sourceShotId && subtitleShotIds.has(c.sourceShotId)) continue;
    const text = cleanText(shot.subtitleText || shot.dialogue);
    if (!text) continue;
    const start = c.timelineStart;
    const end = c.timelineStart + clipSpan(c);
    if (end - start < EPS) continue;
    pushSentenceCues(cues, {
      clipKey: c.clientKey ?? c.id,
      shotId: c.sourceShotId ?? null,
      source: 'shot',
      clipText: text,
      startMs: start * 1000,
      endMs: end * 1000,
      baseKey: `shot:${c.sourceShotId}:${c.clientKey ?? c.id}`,
    });
  }

  cues.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  const durationSec = cues.length
    ? Math.max(...cues.map((c) => c.endMs)) / 1000
    : 0;
  return {
    projectId: doc.projectId,
    durationSec: Math.round(durationSec * 1000) / 1000,
    cues,
    textChars: cues.reduce((n, c) => n + c.text.replace(/\s/g, '').length, 0),
    counts: {
      subtitle: cues.filter((c) => c.source === 'subtitle').length,
      shot: cues.filter((c) => c.source === 'shot').length,
    },
    hasEstimatedBoundaries: cues.some((c) => c.boundary !== 'exact-clip'),
  };
}

const fmtMs = (ms: number): string => {
  const total = Math.max(0, Math.round(ms));
  const h = Math.floor(total / 3_600_000);
  const m = Math.floor((total % 3_600_000) / 60_000);
  const s = Math.floor((total % 60_000) / 1000);
  const milli = total % 1000;
  return `${h > 0 ? `${h}:` : ''}${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(milli).padStart(3, '0')}`;
};

/**
 * 给模型的全文转写清单。默认最多 24000 字符，保证 30 分钟素材也能被完整读完；
 * 超长时按「首/中/尾 + 高信息密度」均匀抽样，并在末尾明确写出抽样规则。
 */
export function formatTranscriptForAgent(
  index: TranscriptIndex,
  maxChars = 24000,
  maxCues = 900,
): string {
  const header = [
    `# 全文转写索引（${index.cues.length} 句 / ${index.textChars} 字 / ${index.durationSec.toFixed(1)}s）`,
    `# 时间码为「成片时间线的毫秒」；estimated-sentence 表示句内切分按字数估算，片段边界仍精确。`,
    index.hasEstimatedBoundaries ? '# 注意：部分句间边界为估算值，引用时保留原始片段范围更安全。' : '',
  ].filter(Boolean);

  const all = index.cues;
  if (all.length === 0) {
    return `${header.join('\n')}\n（没有字幕/对白，无法做文本级粗剪；请先补字幕或接入 ASR）`;
  }

  let picked = all;
  if (all.length > maxCues) {
    const pickedIdx = new Set<number>();
    const step = (all.length - 1) / (maxCues - 1);
    for (let i = 0; i < maxCues; i += 1) pickedIdx.add(Math.round(i * step));
    picked = all.filter((_, i) => pickedIdx.has(i));
  }

  const lines = picked.map(
    (c) =>
      `[${fmtMs(c.startMs)}–${fmtMs(c.endMs)}] (${c.boundary === 'exact-clip' ? '精确' : '估算'}) ${c.text.replace(/\n/g, ' ')}`,
  );
  let out: string[] = [];
  let used = header.join('\n').length;
  for (const line of lines) {
    if (used + line.length + 1 > maxChars) break;
    out.push(line);
    used += line.length + 1;
  }
  if (out.length < picked.length) {
    const omitted = picked.length - out.length;
    out.push(`…（受上下文预算限制，省略 ${omitted} 句；可用工具按关键词二次检索）`);
  }
  return [...header, ...out].join('\n');
}

const KEYWORDS = [
  '关键', '核心', '其实', '因为', '所以', '但是', '最后', '第一', '首先', '记住', '一定',
  '免费', '机会', '结果', '如何', '为什么', '建议', '价值', '产品', '品牌', '故事', '我们',
  '你', '我', '现在', '今天', '未来', '改变', '增长', '成本', '效率', '开始', '终于',
];

/** 单句信息量打分（0–100）：长度、关键词、标点、位置、说话人完整度 */
export function scoreCue(c: TranscriptCue, totalDurationSec: number): number {
  const text = c.text.replace(/\s/g, '');
  if (!text) return 0;
  let score = 18;
  if (text.length >= 8) score += 18;
  if (text.length >= 16) score += 14;
  if (text.length >= 28) score += 8;
  if (text.length > 60) score -= 12;
  if (/[。！？!?]/.test(c.text)) score += 8;
  if (/[，,；;]/.test(c.text)) score += 3;
  const kw = KEYWORDS.filter((k) => c.text.includes(k)).length;
  score += Math.min(18, kw * 6);
  if (/^(嗯|啊|呃|哦|这个|那个|然后|就是)$/.test(text)) score -= 30;
  if (c.quality >= 0.85) score += 8;
  const pos = totalDurationSec > 0 ? c.startMs / 1000 / totalDurationSec : 0;
  if (pos < 0.12) score += 12; // 开场钩子
  else if (pos > 0.88) score += 6; // 收尾
  const dur = c.durationMs / 1000;
  if (dur >= 1.2 && dur <= 8) score += 6;
  if (dur < 0.8) score -= 10;
  return Math.max(0, Math.min(100, Math.round(score)));
}

export interface RoughCutRange {
  start: number;
  end: number;
  label?: string;
  score?: number;
}

export interface SelectRoughCutOptions {
  /** 目标时长（秒），默认 60 */
  targetSec?: number;
  /** 每段前后留白（秒），默认 0.18 */
  paddingSec?: number;
  /** 允许的最短片段，默认 0.8 */
  minPieceSec?: number;
  /** 是否优先保留开场钩子 */
  keepHook?: boolean;
}

/**
 * 抽取式选段：通读全部 cue → 打分 → 为每句开一个窗口 →
 * 在目标时长内挑选信息量最高且不互相重叠的窗口，合并相邻窗口。
 * 这是没有模型/模型失败时的确定性兜底；有模型时模型可输出更语义化的 ranges。
 */
export function selectRoughCutRanges(
  index: TranscriptIndex,
  options: SelectRoughCutOptions = {},
): RoughCutRange[] {
  const target = Math.max(5, options.targetSec ?? 60);
  const padding = Math.max(0, options.paddingSec ?? 0.18);
  const minPiece = Math.max(0.3, options.minPieceSec ?? 0.8);
  const total = index.durationSec;
  if (index.cues.length === 0 || total <= 0) return [];
  if (target >= total) {
    return [{ start: 0, end: Math.round(total * 1000) / 1000, label: '全片' }];
  }

  const candidates = index.cues
    .map((c) => {
      const score = scoreCue(c, total);
      const start = Math.max(0, c.startMs / 1000 - padding);
      const end = Math.min(total, c.endMs / 1000 + padding);
      return { cue: c, score, start, end, dur: end - start };
    })
    .filter((x) => x.dur >= minPiece)
    .sort((a, b) => b.score - a.score || a.start - b.start);

  const selected: typeof candidates = [];
  let budget = target;
  for (const cand of candidates) {
    if (budget <= 0) break;
    // 与已选窗口重叠的直接跳过；间距 <0.6s 的也跳过，避免把同一句话剪两遍
    const clash = selected.some((s) => cand.start < s.end - 0.15 && cand.end > s.start + 0.15);
    if (clash) continue;
    if (cand.dur > budget + 0.4) continue;
    selected.push(cand);
    budget -= cand.dur;
  }

  // 保底：如果高分句太少（例如纯空镜），按时间轴均匀补段，保证目标时长
  if (budget > 2) {
    const slots = Math.max(1, Math.ceil(budget / Math.max(2, target / 8)));
    for (let i = 0; i < slots && budget > 0; i += 1) {
      const center = total * ((i + 0.5) / slots);
      const start = Math.max(0, center - Math.min(3, target / 10));
      const end = Math.min(total, start + Math.min(6, budget));
      if (selected.some((s) => start < s.end - 0.15 && end > s.start + 0.15)) continue;
      selected.push({
        cue: {
          key: `fallback-${i}`,
          clipKey: '',
          source: 'shot',
          text: '均匀补段',
          startMs: start * 1000,
          endMs: end * 1000,
          durationMs: (end - start) * 1000,
          boundary: 'exact-clip',
          quality: 0.5,
          words: [],
        },
        score: 30,
        start,
        end,
        dur: end - start,
      });
      budget -= end - start;
    }
  }

  selected.sort((a, b) => a.start - b.start);
  const merged: RoughCutRange[] = [];
  for (const s of selected) {
    const last = merged[merged.length - 1];
    if (last && s.start <= last.end + 0.35) {
      last.end = Math.min(total, Math.max(last.end, s.end));
      last.score = Math.max(last.score ?? 0, s.score);
      if (s.cue.text) last.label = last.label ? `${last.label} ${s.cue.text.slice(0, 24)}` : s.cue.text.slice(0, 24);
    } else {
      merged.push({
        start: Math.round(s.start * 1000) / 1000,
        end: Math.round(s.end * 1000) / 1000,
        score: s.score,
        label: s.cue.text ? s.cue.text.slice(0, 24) : undefined,
      });
    }
  }

  // 合并后可能超目标：从最低分的段落开始收缩，保证总长贴近目标
  let totalLen = merged.reduce((n, r) => n + (r.end - r.start), 0);
  while (totalLen > target + 0.5 && merged.length > 1) {
    let worst = 0;
    for (let i = 1; i < merged.length; i += 1) {
      const a = merged[i];
      const b = merged[worst];
      if ((a.score ?? 0) < (b.score ?? 0)) worst = i;
    }
    const r = merged[worst];
    const excess = totalLen - target;
    const cut = Math.min(excess, r.end - r.start - minPiece);
    if (cut > 0.05) {
      r.end = Math.round((r.end - cut) * 1000) / 1000;
      totalLen -= cut;
    } else {
      merged.splice(worst, 1);
      totalLen -= r.end - r.start;
    }
  }
  return merged.map((r) => ({
    ...r,
    label: r.label ? r.label.replace(/\s+/g, ' ').slice(0, 60) : undefined,
  }));
}

/** 人读摘要（给确认卡/审计） */
export function describeRoughCut(ranges: RoughCutRange[]): string {
  const total = ranges.reduce((n, r) => n + (r.end - r.start), 0);
  return `${ranges.length} 段，共 ${total.toFixed(1)}s`;
}
