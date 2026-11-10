import { FFmpeg } from '@ffmpeg/ffmpeg';
import { toBlobURL } from '@ffmpeg/util';
// classWorker 显式经 Vite ?worker&url 打包：预构建依赖里 `new URL('./worker.js', import.meta.url)`
// 不会被 Vite 处理成 worker，导致 worker 无法启动、load() 永久挂起。显式传入 classWorkerURL 修复。
import classWorkerURL from '@ffmpeg/ffmpeg/worker?worker&url';
// 合成引擎本地化打包（不再依赖 unpkg CDN）。core JS 用 ?raw 取未经 Vite 转换的原始
// ESM 源码再转 blob（与官方 CDN 提供原始文件一致）；wasm 用 ?url 取同源地址再 toBlobURL。
// 走 package exports 映射（"." → esm js，"./wasm" → esm wasm），深路径不被 exports 暴露。
import coreRaw from '@ffmpeg/core?raw';
import wasmURL from '@ffmpeg/core/wasm?url';

/**
 * 取媒体字节：远端片段经服务端同源代理（/api/...）下载，需带 CSRF 头
 * （框架对 /api/* 全方法校验 cookie+header 双提交；@ffmpeg/util 的 fetchFile 用裸 fetch
 * 不带 header 会 403）。这里与 api/http.ts 的 axios 拦截器同口径补上 header。
 * blob:/本地地址不带 header，credentials include 保证同源 cookie 随行。
 */
async function fetchMediaBytes(url: string): Promise<Uint8Array> {
  const headers: Record<string, string> = {};
  if (url.startsWith('/api/')) {
    const m = /(?:^|;\s*)suda-csrf-token=([^;]+)/.exec(document.cookie);
    if (m) headers['X-Suda-Csrf-Token'] = decodeURIComponent(m[1]);
  }
  const resp = await fetch(url, { headers, credentials: 'include' });
  if (!resp.ok) throw new Error(`媒体下载失败（HTTP ${resp.status}）`);
  return new Uint8Array(await resp.arrayBuffer());
}

export type SynthStatus =
  | 'idle'
  | 'loading-core'
  | 'fetching'
  | 'working'
  | 'done'
  | 'error';

export interface SynthClip {
  url: string;
  label: string;
  /** 秒：配音对位与 BGM 裁剪需要；缺失时含配音的合成会被拒绝（不猜） */
  durationSeconds?: number;
  /** 本镜配音 URL（与片段起点对齐混入） */
  voiceUrl?: string;
}

export interface SynthOptions {
  /** BGM URL（本地 objectURL 或远端）；混音链移植 shorts assemble.py:124-133 */
  bgmUrl?: string;
  /** 是否混入各镜配音（默认 true，有 voiceUrl 的镜头才参与） */
  includeVoices?: boolean;
  /**
   * P1-6 跨镜色彩匹配（移植 forge continuity 思想的轻量版）：
   * 抽各片段中间帧→canvas 测平均亮度/饱和度→向全局均值做 eq 校正后拼接。
   * 不是真直方图匹配（wasm 内无 cv2），只拉齐一阶量，默认关闭（多一次转码，较慢）。
   */
  colorMatch?: boolean;
}

/** 中间帧测光：返回平均亮度/饱和度（0-1），供 eq 校正 */
async function measureFrameStats(
  ffmpeg: FFmpeg,
  fileName: string,
  durationSeconds: number,
): Promise<{ y: number; s: number }> {
  const mid = Math.max(0.1, durationSeconds / 2);
  const frameName = `m_${fileName}.png`;
  await ffmpeg.exec([
    '-ss', String(mid), '-i', fileName,
    '-vframes', '1', '-f', 'image2', frameName,
  ]);
  const png = (await ffmpeg.readFile(frameName)) as Uint8Array;
  try {
    await ffmpeg.deleteFile(frameName);
  } catch {
    /* ignore */
  }
  const bmp = await createImageBitmap(
    new Blob([png.buffer as ArrayBuffer], { type: 'image/png' }),
  );
  const w = Math.min(160, bmp.width) || 1;
  const h = Math.max(1, Math.round((bmp.height * w) / Math.max(1, bmp.width)));
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  if (!ctx) return { y: 0.5, s: 0.5 };
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  const data = ctx.getImageData(0, 0, w, h).data;
  let ySum = 0, sSum = 0;
  const n = w * h;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i] / 255, g = data[i + 1] / 255, b = data[i + 2] / 255;
    ySum += 0.299 * r + 0.587 * g + 0.114 * b;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    sSum += mx === 0 ? 0 : (mx - mn) / mx;
  }
  return { y: ySum / n, s: sSum / n };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

let sharedFFmpeg: FFmpeg | null = null;
let coreLoading: Promise<FFmpeg> | null = null;

/** 单例加载 FFmpeg.wasm（引擎已本地化打包，首次约 30MB，后续缓存） */
export async function getFFmpeg(
  onLog?: (message: string) => void,
): Promise<FFmpeg> {
  if (sharedFFmpeg) return sharedFFmpeg;
  if (!coreLoading) {
    coreLoading = (async () => {
      const ffmpeg = new FFmpeg();
      if (onLog) {
        ffmpeg.on('log', ({ message }) => onLog(message));
      }
      const coreBlobURL = URL.createObjectURL(new Blob([coreRaw], { type: 'text/javascript' }));
      await ffmpeg.load({
        classWorkerURL,
        coreURL: coreBlobURL,
        wasmURL: await toBlobURL(wasmURL, 'application/wasm'),
      });
      sharedFFmpeg = ffmpeg;
      return ffmpeg;
    })().catch((e) => {
      coreLoading = null;
      throw e;
    });
  }
  return coreLoading;
}

/**
 * 混音滤镜图（纯函数，可单元验证；参数抄 shorts assemble.py:124-133）：
 * 输入布局：0=拼接后视频(含音频)，1=BGM(可选)，2..=配音(可选)。
 * BGM：循环→裁到总时长→0.16→尾1.5s淡出；配音：adelay 对位→1.4；
 * 基底立体声化后 BGM 被基底 sidechain 闪避，最后 amix + loudnorm。
 */
export function buildMixArgs(opts: {
  total: number;
  hasBgm: boolean;
  voiceStarts: number[];
  voiceCount: number;
}): string[] {
  const { total, hasBgm, voiceStarts, voiceCount } = opts;
  const filters: string[] = ['[0:a]aformat=sample_rates=44100:channel_layouts=stereo[base]'];
  const mixInputs = ['[base]'];
  if (hasBgm) {
    const fadeStart = Math.max(0, total - 1.5);
    filters.push(
      `[1:a]aloop=loop=-1:size=2e9,atrim=0:${total.toFixed(2)},volume=0.16,afade=t=out:st=${fadeStart.toFixed(2)}:d=1.5[bgm]`,
    );
    // 注意：filter 输出只能被消费一次，[base] 同时喂 sidechain 与 amix 必须先 asplit
    filters.push('[base]asplit=2[bsc][bmix]');
    // sidechain：BGM 为主体，基底（人声+原片声）为触发，阈值/比值/attack/release 照抄
    filters.push('[bgm][bsc]sidechaincompress=threshold=0.05:ratio=8:attack=20:release=350[ducked]');
    mixInputs.length = 0;
    mixInputs.push('[ducked]', '[bmix]');
  }
  voiceStarts.slice(0, voiceCount).forEach((st, i) => {
    const ms = Math.round(st * 1000);
    filters.push(`[${hasBgm ? 2 + i : 1 + i}:a]adelay=${ms}:all=1,volume=1.4[v${i}]`);
    mixInputs.push(`[v${i}]`);
  });
  filters.push(
    `${mixInputs.join('')}amix=inputs=${mixInputs.length}:normalize=0,loudnorm=I=-14:TP=-1.5:LRA=11[aout]`,
  );
  return [
    '-filter_complex', filters.join(';'),
    '-map', '0:v', '-map', '[aout]',
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k',
    '-movflags', '+faststart', '-shortest', 'mixed.mp4',
  ];
}
/**
 * W3 真 MP4 合成（浏览器端，零服务端成本）：
 * 按镜头顺序拼接已有视频片段。远端 URL 需允许跨域，否则 fetch 失败会如实报错。
 */
export async function synthesizeMp4(
  clips: SynthClip[],
  onProgress: (status: SynthStatus, progress: number, message?: string) => void,
  opts: SynthOptions = {},
): Promise<{ blobUrl: string; fileName: string }> {
  if (clips.length === 0) throw new Error('没有可合成的视频片段');
  const includeVoices = opts.includeVoices !== false;
  const voices = includeVoices
    ? clips.filter((c) => c.voiceUrl)
    : [];
  for (const v of voices) {
    if (!Number.isFinite(v.durationSeconds) || (v.durationSeconds ?? 0) <= 0) {
      throw new Error(`配音对位需要镜头时长：「${v.label}」缺少 durationSeconds`);
    }
  }
  const wantMix = Boolean(opts.bgmUrl) || voices.length > 0;
  onProgress('loading-core', 0, '加载合成引擎（首次约 30MB，仅一次）…');
  const ffmpeg = await getFFmpeg();
  ffmpeg.on('progress', ({ progress }) => {
    onProgress('working', Math.round(progress * 100));
  });

  onProgress('fetching', 0, `下载 ${clips.length} 个片段…`);
  const names: string[] = [];
  for (let i = 0; i < clips.length; i += 1) {
    const name = `clip${i}.mp4`;
    // eslint-disable-next-line no-await-in-loop
    await ffmpeg.writeFile(name, await fetchMediaBytes(clips[i].url));
    names.push(name);
    onProgress('fetching', Math.round(((i + 1) / clips.length) * 100));
  }

  // P1-6 色彩匹配：测光→向均值 eq 校正→拼接校正后文件（默认关闭）
  let concatNames = names;
  if (opts.colorMatch) {
    if (names.length < 2) {
      onProgress('fetching', 100, '仅 1 个片段，无需色彩匹配');
    } else {
      onProgress('working', 0, '色彩匹配：测量各片段亮度…');
      const stats: { y: number; s: number }[] = [];
      for (let i = 0; i < names.length; i += 1) {
        const dur = Number(clips[i].durationSeconds);
        if (!Number.isFinite(dur) || dur <= 0) {
          throw new Error(`色彩匹配需要镜头时长：「${clips[i].label}」缺少 durationSeconds`);
        }
        // eslint-disable-next-line no-await-in-loop
        stats.push(await measureFrameStats(ffmpeg, names[i], dur));
        onProgress('working', Math.round(((i + 1) / names.length) * 40));
      }
      const gY = stats.reduce((a, s) => a + s.y, 0) / stats.length;
      const gS = stats.reduce((a, s) => a + s.s, 0) / stats.length;
      concatNames = [];
      for (let i = 0; i < names.length; i += 1) {
        // 实证过的线性校正（系统 ffmpeg 验证：Y178→118）：亮度差/255，饱和度比值，均钳制防过校
        const b = clamp(gY - stats[i].y, -0.3, 0.3);
        const sat = stats[i].s < 0.01 ? 1 : clamp(gS / stats[i].s, 0.5, 2);
        const nn = `norm${i}.mp4`;
        onProgress('working', 40 + Math.round(((i + 1) / names.length) * 40), `校正片段 ${i + 1}/${names.length}…`);
        // eslint-disable-next-line no-await-in-loop
        const okN = await ffmpeg
          .exec([
            '-i', names[i],
            '-vf', `eq=brightness=${b.toFixed(3)}:saturation=${sat.toFixed(3)}`,
            '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
            '-c:a', 'aac', nn,
          ])
          .then(() => true)
          .catch(() => false);
        if (!okN) throw new Error(`片段 ${i + 1} 色彩校正失败`);
        concatNames.push(nn);
      }
    }
  }
  const list = concatNames.map((n) => `file '${n}'`).join('\n');
  await ffmpeg.writeFile('list.txt', list);

  onProgress('working', 0, '拼接中…');
  // 先尝试快速拼接（同编码直接 copy），失败回落转码
  let ok = await ffmpeg
    .exec(['-f', 'concat', '-safe', '0', '-i', 'list.txt', '-c', 'copy', 'out.mp4'])
    .then(() => true)
    .catch(() => false);
  if (!ok) {
    onProgress('working', 0, '编码不一致，转码拼接中（较慢）…');
    ok = await ffmpeg
      .exec([
        '-f', 'concat', '-safe', '0', '-i', 'list.txt',
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
        '-c:a', 'aac', '-movflags', '+faststart', 'out.mp4',
      ])
      .then(() => true)
      .catch(() => false);
  }
  if (!ok) throw new Error('合成失败，片段编码不受支持');

  // 第二 pass：BGM + 配音混入（无则跳过，保持旧行为）
  const voiceNames: string[] = [];
  if (wantMix) {
    onProgress('working', 0, '混音中（BGM 闪避 + 响度标准化）…');
    const inputs = ['-i', 'out.mp4'];
    // 配音起点 = 片段时长累加（与拼接顺序一致）
    let cursor = 0;
    const voiceStarts: number[] = [];
    for (const c of clips) {
      if (c.voiceUrl && includeVoices) voiceStarts.push(cursor);
      cursor += Math.max(0.5, Number(c.durationSeconds) || 4);
    }
    const total = cursor;
    if (opts.bgmUrl) {
      inputs.push('-i', 'bgm.dat');
      // eslint-disable-next-line no-await-in-loop
      await ffmpeg.writeFile('bgm.dat', await fetchMediaBytes(opts.bgmUrl));
    }
    let vi = 0;
    for (const c of clips) {
      if (!c.voiceUrl || !includeVoices) continue;
      const vn = `voice${vi}.dat`;
      // eslint-disable-next-line no-await-in-loop
      await ffmpeg.writeFile(vn, await fetchMediaBytes(c.voiceUrl));
      inputs.push('-i', vn);
      voiceNames.push(vn);
      vi += 1;
    }
    const args = buildMixArgs({
      total,
      hasBgm: Boolean(opts.bgmUrl),
      voiceStarts,
      voiceCount: voiceNames.length,
    });
    const mixOk = await ffmpeg
      .exec([...inputs, ...args])
      .then(() => true)
      .catch(() => false);
    if (!mixOk) throw new Error('混音失败（BGM/配音格式不受支持，已保留无混音版本 out.mp4 逻辑）');
  }

  const data = (await ffmpeg.readFile(wantMix ? 'mixed.mp4' : 'out.mp4')) as Uint8Array;
  const blob = new Blob([data.buffer as ArrayBuffer], { type: 'video/mp4' });
  const blobUrl = URL.createObjectURL(blob);
  // 清理输入文件，释放 wasm 内存
  for (const n of [...names, ...concatNames, 'list.txt', 'out.mp4', 'bgm.dat', 'mixed.mp4', ...voiceNames]) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await ffmpeg.deleteFile(n);
    } catch {
      /* ignore */
    }
  }
  onProgress('done', 100, '合成完成');
  return { blobUrl, fileName: `yimu-export-${Date.now()}.mp4` };
}
