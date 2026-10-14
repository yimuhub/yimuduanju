/**
 * 文本度量启发式（QC 与生成前自检共用同一份口径）
 * ------------------------------------------------------------------
 * 对白时长估算：中文 ~4 字/s，英文 ~2.5 词/s。
 * TTS 实际语速因模型而异，只用于“明显念不完”的预警，不做精确断言。
 */
export function estimateSpeechSeconds(dialogue: string): number {
  const text = dialogue ?? '';
  const cjk = (text.match(/[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/g) ?? [])
    .length;
  const latinWords = (text.match(/[A-Za-z0-9]+(?:'[A-Za-z]+)?/g) ?? []).length;
  return cjk / 4 + latinWords / 2.5;
}

function textTokens(s: string): Set<string> {
  const t = (s ?? '').toLowerCase();
  const set = new Set<string>();
  // 中文按字（含常见二字延续由 Jaccard 自然覆盖），英文按词
  for (const ch of t.match(/[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/g) ?? [])
    set.add(ch);
  for (const w of t.match(/[a-z0-9]+/g) ?? []) if (w.length > 1) set.add(w);
  return set;
}

/**
 * P1-4 素材复用相似度（移植 ai-shorts-generator library.py 的关键词等价版）。
 * shorts 用 OpenAI embedding + 余弦阈值 0.40；我们无 embedding 时退化为
 * token Jaccard，同阈值 0.40（有文本 Key 后可升级 embedding，阈值不变）。
 */
export function keywordSimilarity(a: string, b: string): number {
  const ta = textTokens(a);
  const tb = textTokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter += 1;
  return inter / (ta.size + tb.size - inter);
}

export const REUSE_MATCH_THRESHOLD = 0.4;
