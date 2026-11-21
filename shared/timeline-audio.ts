/**
 * 时间线音频混音纯函数（G15 人声避让）—— 可单测，无 IO
 * ---------------------------------------------------------------------------
 * 导出侧的「人声避让」：配乐片段标记 duckUnderVoice=true 时，导出混音把
 * 人声链作为 sidechain 输入喂给 sidechaincompress，音乐在有人说话时自动压低。
 *
 * 服务端用法（timeline.service.ts）：
 *   · 每个「可听」音频片段先各自渲染成一条 wav part（既有管线不变）；
 *   · part 顺序与 parts 元数据一致，用 planVoiceDucking 分类；
 *   · 命中避让条件时用 buildVoiceDuckMixFilter 生成一条 filter_complex，
 *     替代默认 amix；未命中时**完全不碰**既有混音命令（字节级不变）。
 */

/** sidechaincompress 参数（对齐 OpenMotion 的 ducking 观感，可按需调整） */
export interface SidechainParams {
  /** 触发阈值（线性振幅），0.03 ≈ -30dB：人声一响就压 */
  threshold?: number;
  /** 压缩比 */
  ratio?: number;
  /** 起控时间（ms）：太快会有泵感，太慢压不住字头 */
  attack?: number;
  /** 释放时间（ms）：句间迅速回弹 */
  release?: number;
}

export const DEFAULT_SIDECHAIN_PARAMS: Required<SidechainParams> = {
  threshold: 0.03,
  ratio: 8,
  attack: 50,
  release: 400,
};

/** 一条已渲染音频 part 的分类元数据（与 filter_complex 输入下标一一对应） */
export interface DuckPartInfo {
  /** 音乐片段（客户端标记「避让人声」） */
  duckUnderVoice?: boolean;
  /** 人声片段：音频对白轨（lane 0）或带 ASR 转写的片段 */
  isVoice: boolean;
}

export interface VoiceDuckingPlan {
  /** 只有「有音乐要避让 + 有人声可避」时才激活；否则走原有 amix 路径 */
  active: boolean;
  musicIndexes: number[];
  voiceIndexes: number[];
  otherIndexes: number[];
}

/**
 * 分类 part：duckUnderVoice 优先（显式标记的音乐即使落在对白轨也按配乐处理）。
 */
export function planVoiceDucking(parts: DuckPartInfo[]): VoiceDuckingPlan {
  const musicIndexes: number[] = [];
  const voiceIndexes: number[] = [];
  const otherIndexes: number[] = [];
  parts.forEach((p, i) => {
    if (p.duckUnderVoice) musicIndexes.push(i);
    else if (p.isVoice) voiceIndexes.push(i);
    else otherIndexes.push(i);
  });
  return {
    active: musicIndexes.length > 0 && voiceIndexes.length > 0,
    musicIndexes,
    voiceIndexes,
    otherIndexes,
  };
}

export interface DuckMixGraph {
  /** 完整 filter_complex 字符串（不含 -filter_complex 参数本身） */
  filter: string;
  /** 最终混音输出的流标签（供 -map 使用） */
  mapLabel: string;
}

/**
 * 构建带人声避让的混音 filter_complex：
 *
 *   [人声part...] --asplit--> 一路人声直通（照常混入成片）
 *                            一路人声求和 --> sidechain 输入
 *   [音乐part] + [sidechain] --> sidechaincompress --> 压低后的音乐
 *   [压低音乐][其余 part][人声直通] --> amix --> [aout]
 *
 * 每个输入流只能被消费一次，所以人声与 sidechain 求和都要显式 asplit。
 * 返回 null 表示 plan 未激活（调用方必须走原有混音路径）。
 */
export function buildVoiceDuckMixFilter(
  parts: DuckPartInfo[],
  plan: VoiceDuckingPlan,
  params: SidechainParams = {},
): DuckMixGraph | null {
  if (!plan.active || parts.length === 0) return null;
  const { threshold, ratio, attack, release } = { ...DEFAULT_SIDECHAIN_PARAMS, ...params };
  const chains: string[] = [];

  // 1) 人声 part：一路直通进最终混音，一路进人声求和（sidechain 源）
  const sidechainBranches: string[] = [];
  const voicePassThrough: string[] = [];
  for (const i of plan.voiceIndexes) {
    chains.push(`[${i}:a]asplit=2[vs${i}][vp${i}]`);
    sidechainBranches.push(`[vs${i}]`);
    voicePassThrough.push(`[vp${i}]`);
  }
  let sidechainLabel: string;
  if (sidechainBranches.length === 1) {
    sidechainLabel = sidechainBranches[0].slice(1, -1);
  } else {
    sidechainLabel = 'vsum';
    chains.push(
      `${sidechainBranches.join('')}amix=inputs=${sidechainBranches.length}:duration=longest:normalize=0[${sidechainLabel}]`,
    );
  }

  // 2) sidechain 求和按音乐路数 split，每路音乐单独压缩
  const scLabels: string[] = [];
  if (plan.musicIndexes.length === 1) {
    scLabels.push(sidechainLabel);
  } else {
    for (let j = 0; j < plan.musicIndexes.length; j += 1) scLabels.push(`sc${j}`);
    chains.push(
      `[${sidechainLabel}]asplit=${plan.musicIndexes.length}${scLabels.map((l) => `[${l}]`).join('')}`,
    );
  }
  const duckedMusic: string[] = [];
  plan.musicIndexes.forEach((i, j) => {
    chains.push(
      `[${i}:a][${scLabels[j]}]sidechaincompress=` +
        `threshold=${threshold}:ratio=${ratio}:attack=${attack}:release=${release}[md${j}]`,
    );
    duckedMusic.push(`[md${j}]`);
  });

  // 3) 最终 amix：压低后的音乐在前，人声直通与其余 part 照常混入。
  //    与默认路径同参（duration=longest:normalize=0），响度语义一致。
  const finalInputs = [...duckedMusic, ...voicePassThrough];
  for (const i of plan.otherIndexes) finalInputs.push(`[${i}:a]`);
  const mapLabel = 'aout';
  chains.push(
    `${finalInputs.join('')}amix=inputs=${finalInputs.length}:duration=longest:normalize=0[${mapLabel}]`,
  );
  return { filter: chains.join(';'), mapLabel };
}
