/**
 * 分镜表语言纪律 + 台词保真（前后端/后端技能层共用同一份口径）
 * ------------------------------------------------------------------
 * 事故背景：剧本是中文，分镜表技能却把 visualPrompt / beats / scene.summary
 * 全输出成英文，连台词都在 beats 里被改写成 "Why can't I pull it?"。
 * 后果不只是「看不懂」：
 *   - 角色绑定按中文资产名做文本匹配，英文描述让 characterIds 全空 → 首帧取不到参考图；
 *   - 下游视频提示词把英文视觉描述重复拼接，用户看到的「画面描述/对白」全是英文；
 *   - 字幕/配音按 subtitleText 取词，一旦台词被改写就与剧本不符。
 *
 * 因此这里做两件确定性、不依赖模型自觉的事：
 *   1. 按剧本正文判定目标语言，统计分镜表违规比例（供技能层决定是否重跑/降级）；
 *   2. 台词保真：模型产出的 dialogue 必须能在剧本原文里找到，找不到就用顺序
 *      回溯还原，绝不把翻译/改写过的句子落库。
 */
import { keywordSimilarity } from './text-metrics';

export type BoardLanguage = 'zh' | 'en';

const CJK_PATTERN = /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/g;
const LATIN_PATTERN = /[A-Za-z]/g;

/** 汉字在「有意义的字符」里的占比；数字/标点不参与，避免提示词里的编号稀释比例 */
export function cjkRatio(text: string): number {
  const cjk = (text.match(CJK_PATTERN) ?? []).length;
  const latin = (text.match(LATIN_PATTERN) ?? []).length;
  return cjk / Math.max(1, cjk + latin);
}

/** 按正文判定项目语言：中文项目必须输出中文，英文项目不必被强行中文化 */
export function detectBoardLanguage(scriptText: string): BoardLanguage {
  return cjkRatio(scriptText ?? '') >= 0.15 ? 'zh' : 'en';
}

/**
 * 单条文本是否符合作品语言。
 * 短文本（≤12 字符，如片段名）放宽；中文作品里纯英文、或英文里整段中文都算违规。
 */
export function isBoardTextInLanguage(text: string, lang: BoardLanguage): boolean {
  const t = (text ?? '').trim();
  if (!t) return true;
  if (t.length < 12) return true;
  const ratio = cjkRatio(t);
  return lang === 'zh' ? ratio >= 0.15 : ratio <= 0.15;
}

/** 从剧本正文抽出「角色：台词」的台词原文，保持出现顺序并去重 */
export function extractScriptDialogues(scriptText: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const rawLine of (scriptText ?? '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.length > 200) continue;
    const m = /^[^：:\n]{1,20}[：:]\s*(.+)$/.exec(line);
    if (!m) continue;
    const text = m[1].trim().replace(/^["“「]|["”」]$/g, '');
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
  }
  return out;
}

const stripPunctuation = (s: string) => (s ?? '').replace(/[\s，。！？、；：,.!?;:'"“”‘’「」（）()]/g, '');

/**
 * 把模型产出的台词还原成剧本原文。
 * - 完全一致 / 去标点一致 → 原文
 * - 字面相似（模型只改了几个字）→ 最相近原文
 * - 被翻译成外文、或凭空编造 → 由调用方按剧本顺序回溯；仍无解返回 undefined（宁可留空，不编台词）
 */
export function matchScriptDialogue(
  raw: string | undefined,
  scriptDialogues: string[],
): string | undefined {
  const text = (raw ?? '').trim().replace(/^["“「]|["”」]$/g, '');
  if (!text) return undefined;
  const flat = stripPunctuation(text);
  let best: { value: string; score: number } | null = null;
  for (const d of scriptDialogues) {
    if (d === text || stripPunctuation(d) === flat) return d;
    const score = keywordSimilarity(text, d);
    if (!best || score > best.score) best = { value: d, score };
    if (flat.length >= 4 && (stripPunctuation(d).includes(flat) || flat.includes(stripPunctuation(d)))) {
      return d;
    }
  }
  return best && best.score >= 0.45 ? best.value : undefined;
}

/**
 * 商业标识 / 字体名清洗。
 * 实测分镜描述里出现过「袍服上 Verdana 字样刺绣细节清晰」——模型把字体当纹样写进画面，
 * 既是侵权风险，也是「画面上有字」的隐性指令（与全局禁字纪律冲突）。
 * 只列低歧义的字体与品牌（不包含 impact/georgia 这类常用词），命中即删除。
 */
const BRAND_TOKENS = [
  'Times New Roman',
  'Comic Sans',
  'Helvetica',
  'Verdana',
  'Calibri',
  'Tahoma',
  'Arial',
  'Coca-Cola',
  'Coca Cola',
  'McDonald',
  'Starbucks',
  'Adidas',
  'Nike',
  'iPhone',
  'iPad',
  'MacBook',
  'Microsoft',
  'Windows',
  'Google',
  'Disney',
  'Pixar',
  'Marvel',
  'Netflix',
];

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 去掉品牌/字体名，并清理由此产生的空白与标点残留 */
export function stripBrandTokens(text: string): string {
  let out = text ?? '';
  for (const token of BRAND_TOKENS) {
    out = out.replace(new RegExp(`\\b${escapeRegExp(token)}\\b`, 'gi'), '');
  }
  return out
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([，。、；：！？])/g, '$1')
    .replace(/([，。、；：])\s*[，。、；：]/g, '$1')
    .trim();
}

export interface BoardLike {
  segmentTitle?: string;
  dialogue?: string;
  visualPrompt?: string;
  beats?: { from: number; to: number; description: string; dialogue?: string }[];
}

/** 分镜表里有多少「创作者可见文本」跑偏了语言；用于触发重跑/降级，而不是悄悄落库 */
export function countLanguageViolations(shots: BoardLike[], lang: BoardLanguage): {
  checked: number;
  violating: number;
  ratio: number;
} {
  let checked = 0;
  let violating = 0;
  for (const s of shots) {
    const texts = [
      s.visualPrompt,
      s.segmentTitle,
      ...(s.beats ?? []).map((b) => b.description),
    ].filter((v): v is string => typeof v === 'string' && v.trim().length >= 12);
    for (const t of texts) {
      checked += 1;
      if (!isBoardTextInLanguage(t, lang)) violating += 1;
    }
  }
  return { checked, violating, ratio: checked === 0 ? 0 : violating / checked };
}

/**
 * 台词保真 + beats 清洗。会就地返回新数组，不修改入参。
 * 关键：模型把中文台词翻译成英文时，按剧本台词顺序回溯还原，避免「对白也是英文」。
 */
export function normalizeBoardsLanguage<T extends BoardLike>(
  shots: T[],
  scriptText: string,
  lang: BoardLanguage,
): T[] {
  const scriptDialogues = extractScriptDialogues(scriptText);
  const used = new Set<number>();
  const takeNextUnused = (): string | undefined => {
    const i = scriptDialogues.findIndex((_, idx) => !used.has(idx));
    if (i < 0) return undefined;
    used.add(i);
    return scriptDialogues[i];
  };

  return shots.map((shot) => {
    let dialogue = shot.dialogue;
    if (dialogue && dialogue.trim()) {
      const matched = matchScriptDialogue(dialogue, scriptDialogues);
      if (matched) {
        const idx = scriptDialogues.indexOf(matched);
        if (idx >= 0) used.add(idx);
        dialogue = matched;
      } else if (lang === 'zh' && !isBoardTextInLanguage(dialogue, 'zh')) {
        // 明显是外文（模型把中文台词翻译了）：按剧本顺序还原
        dialogue = takeNextUnused();
      } else {
        // 剧本里没有这句，且不是翻译 → 模型自行编的台词，不落库
        dialogue = undefined;
      }
    }
    // beats 里的 dialogue 是模型对同一句台词的二次表述，最容易夹带英文改写：
    // 只对得上剧本原文的才保留，其余一律清空（画面信息仍在 description 里）。
    const beats = shot.beats?.map((b) => {
      const beatDialogue = b.dialogue?.trim()
        ? matchScriptDialogue(b.dialogue, scriptDialogues)
        : undefined;
      return { ...b, description: stripBrandTokens(b.description), dialogue: beatDialogue };
    });
    return {
      ...shot,
      ...(shot.visualPrompt !== undefined
        ? { visualPrompt: stripBrandTokens(shot.visualPrompt) }
        : {}),
      ...(shot.segmentTitle !== undefined
        ? { segmentTitle: stripBrandTokens(shot.segmentTitle) }
        : {}),
      ...(dialogue !== undefined ? { dialogue } : { dialogue: undefined }),
      ...(beats ? { beats } : {}),
    };
  });
}
