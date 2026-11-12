/**
 * 流水线「真完成」判定（前后端共用唯一口径）
 * ------------------------------------------------------------------
 * 事故背景：7 个镜头里只有 1 个有 videoUrl，服务端却因为
 *   `shotRows.some(s => s.videoUrl)` 判定「全部镜头就绪」，建了 edit 任务
 *   （clips: 1 / 8s）→ 推进 editing → qc，前端按 project.status 把
 *   video_generating 标成 100% 完成。QC 报告同时写着 29 条问题、pass=false。
 *
 * 根因是完成态只看「状态机走到哪」和「任意一个产物存在」，从不比较
 * 「应产出 N 个视频」与「实产出 M 个视频」。这里把 M/N 变成唯一真源：
 * 后端门控、进度接口、前端完成文案都必须引用同一份结果。
 */
export interface PipelineShotSnapshot {
  id: string;
  startFrameUrl?: string | null;
  videoUrl?: string | null;
  voiceUrl?: string | null;
  dialogue?: string | null;
  status?: string | null;
}

export interface PipelineReadiness {
  total: number;
  withFrame: number;
  withVideo: number;
  withVoice: number;
  /** 有对白、因此必须配音的镜头数 */
  needVoice: number;
  /** 仍处于 failed 的镜头数（不阻断成片判定，但必须暴露给用户） */
  failedShots: number;
  missingFrames: string[];
  missingVideos: string[];
  missingVoices: string[];
  /** 全部镜头都有成片，才允许建 edit / 标「视频生成完成」 */
  videoComplete: boolean;
  voiceComplete: boolean;
  fullyComplete: boolean;
  /** 0-100，视频阶段真实进度 */
  videoPercent: number;
}

export function computePipelineReadiness(shots: PipelineShotSnapshot[]): PipelineReadiness {
  const missingFrames: string[] = [];
  const missingVideos: string[] = [];
  const missingVoices: string[] = [];
  let withFrame = 0;
  let withVideo = 0;
  let withVoice = 0;
  let needVoice = 0;
  let failedShots = 0;

  for (const s of shots) {
    if (s.startFrameUrl) withFrame += 1;
    else missingFrames.push(s.id);
    if (s.videoUrl) withVideo += 1;
    else missingVideos.push(s.id);
    const hasDialogue = (s.dialogue ?? '').trim().length > 0;
    if (hasDialogue) {
      needVoice += 1;
      if (s.voiceUrl) withVoice += 1;
      else missingVoices.push(s.id);
    }
    if (s.status === 'failed') failedShots += 1;
  }

  const total = shots.length;
  const videoComplete = total > 0 && withVideo === total;
  const voiceComplete = needVoice === 0 || withVoice === needVoice;
  return {
    total,
    withFrame,
    withVideo,
    withVoice,
    needVoice,
    failedShots,
    missingFrames,
    missingVideos,
    missingVoices,
    videoComplete,
    voiceComplete,
    fullyComplete: videoComplete && voiceComplete && failedShots === 0,
    videoPercent: total === 0 ? 0 : Math.round((withVideo / total) * 100),
  };
}
