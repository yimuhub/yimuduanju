/**
 * 画幅（宽高比）→ 生成尺寸映射
 * ------------------------------------------------------------------
 * 之前图片通道永远落 1024x1024、Agnes 视频通道写死 9:16，
 * 导致「16:9 的项目里全是方图 + 竖屏视频」。宽高比必须由项目决定，
 * 生成前统一从项目取，不允许各通道各写一套默认值。
 *
 * 供应商对尺寸白名单不一致时：
 * - 优先用 provider.modelParams.imageSizes / videoSizes 声明的白名单取最接近的一档；
 * - 未声明时按本表映射。只有用户显式选择 1:1 才允许出方图，
 *   不再有「生成失败就回落 1024x1024」这种把项目画幅悄悄改掉的行为。
 */

/** 与 DB / 新建作品 UI 的默认画幅保持一致（projects.aspect_ratio 默认 9:16）。 */
export const DEFAULT_ASPECT_RATIO = '9:16';

const IMAGE_SIZES: Record<string, string> = {
  '16:9': '1280x720',
  '9:16': '720x1280',
  '1:1': '1024x1024',
  '4:3': '1152x864',
  '3:4': '864x1152',
  '4:5': '864x1080',
  '21:9': '1344x576',
  '3:2': '1216x832',
  '2:3': '832x1216',
};

const VIDEO_SIZES: Record<string, string> = {
  '16:9': '1280x720',
  '9:16': '720x1280',
  '1:1': '1024x1024',
  '4:3': '1152x864',
  '3:4': '864x1152',
  '4:5': '864x1080',
  '21:9': '1344x576',
  '3:2': '1216x832',
  '2:3': '832x1216',
};

/** 把 '16:9' / '16：9' / '宽屏' 之类收敛成标准串；未知一律回落到默认。 */
export function normalizeAspect(value?: string | null): string {
  if (!value) return DEFAULT_ASPECT_RATIO;
  const raw = String(value).replace('：', ':').trim();
  if (IMAGE_SIZES[raw]) return raw;
  const hit = Object.keys(IMAGE_SIZES).find((k) => k.replace(':', '') === raw.replace(':', ''));
  return hit ?? DEFAULT_ASPECT_RATIO;
}

/** 目标图片尺寸；供应商白名单存在时取白名单里最接近的一个。 */
export function imageSizeForAspect(
  aspect?: string | null,
  allowed?: readonly string[],
): string {
  return pickSize(IMAGE_SIZES, aspect, allowed, '1024x1024');
}

/** 目标视频尺寸。 */
export function videoSizeForAspect(
  aspect?: string | null,
  allowed?: readonly string[],
): string {
  return pickSize(VIDEO_SIZES, aspect, allowed, '1280x720');
}

/** 画幅是否竖屏（用于文案与占位策略）。 */
export function isVerticalAspect(aspect?: string | null): boolean {
  const [w, h] = normalizeAspect(aspect).split(':').map(Number);
  return Number.isFinite(w) && Number.isFinite(h) && h > w;
}

/** 画幅是否横屏。 */
export function isHorizontalAspect(aspect?: string | null): boolean {
  const [w, h] = normalizeAspect(aspect).split(':').map(Number);
  return Number.isFinite(w) && Number.isFinite(h) && w > h;
}

/**
 * Agnes 视频接口的 aspect_ratio 只认 16:9 / 9:16 / 1:1 三档。
 * 项目画幅（21:9 / 4:3 / 3:4 等）按宽高比就近收敛到它真能出的一档，
 * 而不是像旧实现那样写死 '9:16' —— 16:9 项目出竖屏视频是整条链路最刺眼的错位。
 */
export function agnesAspectRatio(aspect?: string | null): '16:9' | '9:16' | '1:1' {
  const [w, h] = normalizeAspect(aspect).split(':').map(Number);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w === h) return '1:1';
  return w > h ? '16:9' : '9:16';
}

/**
 * 给定目标尺寸与供应商白名单，取白名单里宽高比最接近的一项。
 * 白名单为空时原样返回——不猜供应商能力，失败由调用方回退。
 */
export function closestAllowedSize(wanted: string, allowed?: readonly string[]): string {
  const list = (allowed ?? []).filter((s) => /^\d+x\d+$/i.test(String(s)));
  if (list.length === 0) return wanted;
  if (list.includes(wanted)) return wanted;
  const [tw, th] = wanted.split('x').map(Number);
  if (!tw || !th) return list[0];
  const targetRatio = tw / th;
  let best = list[0];
  let bestDiff = Number.POSITIVE_INFINITY;
  for (const size of list) {
    const [w, h] = size.split('x').map(Number);
    if (!w || !h) continue;
    const diff = Math.abs(w / h - targetRatio);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = size;
    }
  }
  return best;
}

function pickSize(
  table: Record<string, string>,
  aspect: string | null | undefined,
  allowed: readonly string[] | undefined,
  fallback: string,
): string {
  const key = normalizeAspect(aspect);
  const wanted = table[key] ?? table[DEFAULT_ASPECT_RATIO] ?? fallback;
  const list = (allowed ?? []).filter((s) => /^\d+x\d+$/i.test(s));
  if (list.length === 0) return wanted;
  if (list.includes(wanted)) return wanted;
  const [tw, th] = wanted.split('x').map(Number);
  const targetRatio = th > 0 ? tw / th : 1;
  let best = list[0];
  let bestDiff = Number.POSITIVE_INFINITY;
  for (const size of list) {
    const [w, h] = size.split('x').map(Number);
    if (!w || !h) continue;
    const diff = Math.abs(w / h - targetRatio);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = size;
    }
  }
  return best;
}
