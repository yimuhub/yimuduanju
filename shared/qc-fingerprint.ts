/**
 * QC 确认指纹（migration 0024 一致性工程 B3，方案③「不更坏」校验的警示层）：
 * shot 图片/视频重跑（forceNew 语义，本仓即 rerunShot）时把旧产物指纹
 * （尺寸 + 文件大小 + md5 前 8 位）快照进新任务 inputData.prevFingerprint；
 * 新产物完成后与旧指纹比对，QC 分数下降 → outputData.regressWarn=true，
 * 任务仍 succeeded（只警示不拦截——拦截策略待产品决策）。
 *
 * 本文件是纯逻辑（无 node 依赖，可被 client/单测直接复用）：
 * 文件 IO 与 md5 计算在 server/modules/generation/artifact-qc.service.ts。
 */

export interface ArtifactFingerprint {
  /** image | video */
  kind: 'image' | 'video';
  /** 像素宽（图片可解析；视频本地解析不了时缺省） */
  width?: number;
  /** 像素高 */
  height?: number;
  /** 文件字节数 */
  size: number;
  /** 文件 md5 前 8 位十六进制 */
  md5: string;
  /** 快照时的产物 URL（/uploads/ 本地路径），供追溯；可缺省 */
  url?: string;
  /** 快照时按 scoreArtifactFingerprint 算出的分（0-100） */
  score?: number;
}

/** QC 分数下降的警示（落在任务 outputData 上，任务本身仍 succeeded） */
export interface FingerprintRegression {
  regressWarn: true;
  prevScore: number;
  nextScore: number;
  prevFingerprint: Pick<ArtifactFingerprint, 'kind' | 'size' | 'md5'> & Partial<Pick<ArtifactFingerprint, 'width' | 'height'>>;
  nextFingerprint: Pick<ArtifactFingerprint, 'kind' | 'size' | 'md5'> & Partial<Pick<ArtifactFingerprint, 'width' | 'height'>>;
}

/** 图类产物低于该字节数按「疑似坏图」扣分（占位图/半截文件通常 < 20KB） */
const IMAGE_MIN_BYTES = 20 * 1024;
/** 视频类产物低于该字节数按「疑似坏片」扣分（半截 mp4 通常 < 100KB） */
const VIDEO_MIN_BYTES = 100 * 1024;

/**
 * 确定性产物 QC 分（0-100，纯指纹口径，不引入 AI 审片）：
 * - 起始 100；
 * - 画幅不符（调用方按 shared/aspect.compareImageAspect 判定后传 flags）−30；
 * - 图片解析不出尺寸 −10（视频头本地解析不了不扣）；
 * - 产物体积低于同类下限 −20（疑似占位/半截文件）。
 * 规则只依赖指纹本身 → 旧产物（快照时）与新产物（完成时）同一把尺子，「不更坏」可比。
 */
export function scoreArtifactFingerprint(
  fp: ArtifactFingerprint,
  flags: { aspectMismatch?: boolean } = {},
): number {
  let score = 100;
  if (flags.aspectMismatch) score -= 30;
  if (fp.kind === 'image' && (typeof fp.width !== 'number' || typeof fp.height !== 'number')) {
    score -= 10;
  }
  const floor = fp.kind === 'image' ? IMAGE_MIN_BYTES : VIDEO_MIN_BYTES;
  if (Number.isFinite(fp.size) && fp.size > 0 && fp.size < floor) score -= 20;
  return Math.max(0, Math.min(100, score));
}

/**
 * 新旧指纹比对：QC 分下降 → 回归警示对象；未下降/无法比较 → null。
 * 旧指纹缺 score（历史数据）时按同规则补算，保证口径一致。
 */
export function compareFingerprints(
  prev: ArtifactFingerprint,
  next: ArtifactFingerprint,
  flags: { aspectMismatch?: boolean } = {},
): FingerprintRegression | null {
  const prevScore =
    typeof prev.score === 'number' ? prev.score : scoreArtifactFingerprint(prev, {});
  const nextScore = scoreArtifactFingerprint(next, flags);
  if (nextScore >= prevScore) return null;
  return {
    regressWarn: true,
    prevScore,
    nextScore,
    prevFingerprint: {
      kind: prev.kind,
      size: prev.size,
      md5: prev.md5,
      ...(typeof prev.width === 'number' ? { width: prev.width } : {}),
      ...(typeof prev.height === 'number' ? { height: prev.height } : {}),
    },
    nextFingerprint: {
      kind: next.kind,
      size: next.size,
      md5: next.md5,
      ...(typeof next.width === 'number' ? { width: next.width } : {}),
      ...(typeof next.height === 'number' ? { height: next.height } : {}),
    },
  };
}
