/**
 * LUT 预览渲染器（WebGL2）· 一幕·神剪
 * -------------------------------------------------------------
 * 给定 <video>/<img> 源 + shared/lut3d 解析出的 LUT 表，把逐帧画面查表调色后
 * 画到等尺寸 canvas 上：源纹理 texImage2D → 片元着色器里 DOMAIN 归一 → 3D 纹理
 * 硬件三线性查表 → mix(strength) 与原色混合输出。Stage 侧约定：
 *   · canvas 挂 .bg 类与源元素同 rect（object-fit 同为 cover），预览缩放/字幕拖拽
 *     坐标系不受影响（画布子元素自然跟随 .canvas-frame 的 transform）；
 *   · CSS 调色链继续挂在 canvas 元素上——像素层序为「源 → LUT → CSS 调色」，
 *     与导出端 lut3d 先于 grade eq 的滤镜顺序一致；
 *   · WebGL2 / 着色器编译 / 纹理创建任一步失败都返回 null，由 Stage 回退原片
 *     直出并 console.warn 一次（诚实降级，不静默吞错）。
 * LUT 表编成 RGBA16F 3D 纹理：半浮点在 WebGL2 核心即可线性过滤（32F 需要
 * OES_texture_float_linear 扩展，不赌）；.cube 行主序 R 慢 B 快 → 查表坐标 (x=B, y=G, z=R)。
 */

import type { Lut3dTable } from '@shared/lut3d';

const VERT_SRC = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  // 视频纹理第 0 行在 t=0（画面顶部），flip y 让画面方向与 <video> 一致
  vUv = vec2(aPos.x * 0.5 + 0.5, 0.5 - aPos.y * 0.5);
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const FRAG_SRC = `#version 300 es
precision highp float;
precision highp sampler3D;
in vec2 vUv;
uniform sampler2D uVideo;
uniform sampler3D uLut;
uniform float uStrength;
uniform vec3 uDomainMin;
uniform vec3 uDomainMax;
out vec4 fragColor;
void main() {
  vec4 src = texture(uVideo, vUv);
  // DOMAIN 归一（ffmpeg lut3d 同语义）：[DOMAIN_MIN, DOMAIN_MAX] → [0, 1]
  vec3 span = max(uDomainMax - uDomainMin, vec3(1e-4));
  vec3 key = clamp((src.rgb - uDomainMin) / span, vec3(0.0), vec3(1.0));
  // .cube 数据 R 慢 B 快 → 3D 纹理坐标 (x=B, y=G, z=R)；LINEAR 过滤即硬件三线性
  vec3 graded = texture(uLut, key.bgr).rgb;
  fragColor = vec4(mix(src.rgb, graded, uStrength), 1.0);
}`;

/** Float32 → Float16（半浮点）位级转换；LUT 表数值范围极小，性能足够 */
const toHalf = (() => {
  const f32 = new Float32Array(1);
  const i32 = new Int32Array(f32.buffer);
  return (v: number): number => {
    f32[0] = v;
    const x = i32[0];
    let bits = (x >> 16) & 0x8000;
    let m = (x >> 12) & 0x07ff;
    const e = (x >> 23) & 0xff;
    if (e < 103) return bits;
    if (e > 142) {
      bits |= 0x7c00;
      bits |= (e === 255 ? 0 : 1) && (x & 0x007fffff);
      return bits;
    }
    if (e < 113) {
      m |= 0x0800;
      bits |= (m >> (114 - e)) + ((m >> (113 - e)) & 1);
      return bits;
    }
    bits |= ((e - 112) << 10) | (m >> 1);
    bits += m & 1;
    return bits;
  };
})();

export interface LutVideoRendererOptions {
  canvas: HTMLCanvasElement;
  /** 帧源：<video> 或静帧 <img>（图片片段也走同一套查表，预览/导出一致） */
  source: HTMLVideoElement | HTMLImageElement;
  table: Lut3dTable;
  /** 0–1 与原色混合比例，缺省 1；后续可 setStrength 热更 */
  strength?: number;
  /** canvas 位图边长上限（预览画质档用，CSS .bg + object-fit 负责放大显示） */
  maxSize?: number;
}

export interface LutVideoRenderer {
  setStrength(strength: number): void;
  dispose(): void;
}

/** 编译着色器程序；失败抛错由外层统一转成 null（诚实降级） */
const buildProgram = (gl: WebGL2RenderingContext, vert: string, frag: string): WebGLProgram => {
  const compile = (type: number, src: string) => {
    const sh = gl.createShader(type);
    if (!sh) throw new Error('createShader 失败');
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(sh) || '着色器编译失败');
    }
    return sh;
  };
  const prog = gl.createProgram();
  if (!prog) throw new Error('createProgram 失败');
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, vert));
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, frag));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(prog) || '着色器链接失败');
  }
  return prog;
};

/**
 * 创建渲染器并启动逐帧循环；任何 WebGL 相关失败返回 null（不抛错），
 * Stage 拿到 null 就回退原片直出。
 */
export function createLutVideoRenderer(opts: LutVideoRendererOptions): LutVideoRenderer | null {
  const { canvas, source, table } = opts;
  let gl: WebGL2RenderingContext | null = null;
  try {
    gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      // 暂停/seek 后循环不再重绘，保留最后一帧避免画面闪黑
      preserveDrawingBuffer: true,
    });
    if (!gl) return null;
    const program = buildProgram(gl, VERT_SRC, FRAG_SRC);
    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(program, 'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    gl.useProgram(program);

    // —— 源纹理（2D）——
    const videoTex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, videoTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.uniform1i(gl.getUniformLocation(program, 'uVideo'), 0);

    // —— LUT 3D 纹理：RGBA16F（半浮点在 WebGL2 核心可 LINEAR 过滤）——
    const n = table.size;
    const quads = new Uint16Array(n * n * n * 4);
    for (let i = 0, j = 0; i < table.data.length; i += 3) {
      quads[j++] = toHalf(table.data[i]);
      quads[j++] = toHalf(table.data[i + 1]);
      quads[j++] = toHalf(table.data[i + 2]);
      quads[j++] = toHalf(1);
    }
    const lutTex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_3D, lutTex);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA16F, n, n, n, 0, gl.RGBA, gl.HALF_FLOAT, quads);
    gl.uniform1i(gl.getUniformLocation(program, 'uLut'), 1);
    gl.uniform3fv(gl.getUniformLocation(program, 'uDomainMin'), table.domainMin);
    gl.uniform3fv(gl.getUniformLocation(program, 'uDomainMax'), table.domainMax);
    const uStrength = gl.getUniformLocation(program, 'uStrength');

    const rawStrength = Number(opts.strength ?? 1);
    let strength = Number.isFinite(rawStrength) ? Math.max(0, Math.min(1, rawStrength)) : 1;
    gl.uniform1f(uStrength, strength);
    const maxDim = Math.max(64, Math.min(4096, Math.round(opts.maxSize ?? 1280)));

    const isVideo = source instanceof HTMLVideoElement;
    const srcSize = () =>
      isVideo
        ? { w: source.videoWidth, h: source.videoHeight }
        : { w: source.naturalWidth, h: source.naturalHeight };
    // 帧变化戳：视频跟 currentTime（seek/播放都会变）；静帧只需画一次
    const stampOf = () => (isVideo ? source.currentTime : 1);

    let raf = 0;
    let lastTick = 0;
    let lastStamp = -1;
    const draw = (sw: number, sh: number) => {
      // 位图按 maxSize 等比缩（预览端省带宽），显示尺寸交给 CSS .bg + object-fit
      const scale = Math.min(1, maxDim / Math.max(sw, sh));
      const w = Math.max(1, Math.round(sw * scale));
      const h = Math.max(1, Math.round(sh * scale));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        gl!.viewport(0, 0, w, h);
      }
      gl!.activeTexture(gl!.TEXTURE0);
      gl!.bindTexture(gl!.TEXTURE_2D, videoTex);
      gl!.texImage2D(gl!.TEXTURE_2D, 0, gl!.RGBA, gl!.RGBA, gl!.UNSIGNED_BYTE, source as TexImageSource);
      gl!.uniform1f(uStrength, strength);
      gl!.drawArrays(gl!.TRIANGLES, 0, 6);
    };
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      // 与 chroma canvas 同款 33ms 节流；尺寸未知（元数据/图片未就绪）继续等下一帧
      if (now - lastTick < 33) return;
      const { w, h } = srcSize();
      if (!w || !h) return;
      // 暂停（无新帧）/ seek 中跳过，画面停在最后一帧
      if (isVideo && ((source.paused && stampOf() === lastStamp) || source.seeking)) return;
      const stamp = stampOf();
      if (stamp === lastStamp) return;
      lastTick = now;
      lastStamp = stamp;
      draw(w, h);
    };
    raf = requestAnimationFrame(tick);

    return {
      setStrength(v: number) {
        const raw = Number(v);
        strength = Number.isFinite(raw) ? Math.max(0, Math.min(1, raw)) : 1;
      },
      dispose() {
        cancelAnimationFrame(raf);
        try {
          // 只删本渲染器的资源，不 loseContext：canvas 元素全局只有一个 context，
          // 重建渲染器（切 LUT / 换片段）时会复用同一 context，丢了就再也拿不回来。
          // 整个 canvas 卸载时 context 随元素一起被回收。
          gl?.deleteTexture(videoTex);
          gl?.deleteTexture(lutTex);
          gl?.deleteBuffer(vbo);
          gl?.deleteProgram(program);
        } catch {
          /* 上下文已失效 */
        }
      },
    };
  } catch {
    // WebGL2 / 着色器 / 纹理任一步失败：清理后如实返回 null（Stage 回退原片直出）
    try {
      gl?.getExtension('WEBGL_lose_context')?.loseContext();
    } catch {
      /* 忽略 */
    }
    return null;
  }
}
