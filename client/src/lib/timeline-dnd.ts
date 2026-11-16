/**
 * 时间线拖放协议（跨面板 DnD 的唯一约定）
 * -------------------------------------------------------------
 * 素材来源有三个面板：底部「镜头」条、右坞「资产」「分镜」。
 * 它们都往时间线里拖，落点规则却必须只有一套，所以载荷格式定死在这里：
 *
 *   { kind: 'shot' | 'video' | 'audio' | 'image', url?, name, durationSeconds?, shotId? }
 *
 * 为什么还要一个模块级 `current`：
 * HTML5 DnD 在 `dragover` 阶段是读不到 `dataTransfer.getData()` 的（浏览器安全限制，
 * 只有 `types` 可见），而"拖到哪一条轨"必须在 dragover 就算出来才能画出落点提示。
 * 所以拖起时同时写一份到模块变量，dragover 读它、drop 时以 dataTransfer 为准。
 */

export const TL_DND_MIME = 'application/x-yimu-timeline';

export type TimelineDragKind = 'shot' | 'video' | 'audio' | 'image';

export interface TimelineDragPayload {
  kind: TimelineDragKind;
  /** 媒体地址；kind=shot 时可缺省（用镜头自己的成片/首帧） */
  url?: string;
  name: string;
  durationSeconds?: number;
  shotId?: string | null;
  /** kind=shot 时优先用成片，没有成片才退回首帧（静帧按 durationSeconds 铺开） */
  videoUrl?: string;
  frameUrl?: string;
}

let current: TimelineDragPayload | null = null;

export const peekTimelineDrag = (): TimelineDragPayload | null => current;

export const clearTimelineDrag = (): void => {
  current = null;
};

/** 拖起：写模块变量 + dataTransfer（同一浏览器内两者都可用） */
export const startTimelineDrag = (
  e: { dataTransfer: DataTransfer | null },
  payload: TimelineDragPayload,
): void => {
  current = payload;
  if (!e.dataTransfer) return;
  e.dataTransfer.effectAllowed = 'copy';
  try {
    e.dataTransfer.setData(TL_DND_MIME, JSON.stringify(payload));
    // 兜底：某些环境（含部分 Electron/WebView）只认 text/plain
    e.dataTransfer.setData('text/plain', payload.name);
  } catch {
    /* dataTransfer 只读时不至于让拖拽整体失败 */
  }
};

/** 落下：优先 dataTransfer，读不到就用拖起时的那份 */
export const readTimelineDrag = (e: {
  dataTransfer: DataTransfer | null;
}): TimelineDragPayload | null => {
  const raw = e.dataTransfer?.getData(TL_DND_MIME);
  if (raw) {
    try {
      return JSON.parse(raw) as TimelineDragPayload;
    } catch {
      /* 落到下面的兜底 */
    }
  }
  return current;
};

/** 载荷 → 应该落在哪一类轨道 */
export const trackOfDrag = (p: TimelineDragPayload): 'video' | 'audio' =>
  p.kind === 'audio' ? 'audio' : 'video';

/** 载荷 → 可用的媒体地址（镜头优先成片，没有就退回首帧静图） */
export const mediaOfDrag = (p: TimelineDragPayload): string | undefined => {
  if (p.kind === 'shot') return p.videoUrl || p.frameUrl || p.url;
  return p.url;
};
