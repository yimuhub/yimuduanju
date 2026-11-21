/**
 * LUT（.cube 3D 查找表）· 预览与导出共用
 * -------------------------------------------------------------
 * 解析 .cube 文本（TITLE / LUT_3D_SIZE / DOMAIN_MIN·MAX / R G B 数据行）成 N³ 三线性网格；
 * sampleLut 是 CPU 侧参考实现（单测对照用），WebGL 预览把整张表编成 3D 纹理在片元
 * 着色器里查表（client/src/lib/lut-renderer.ts），导出端用 buildLutFilterArgs 生成
 * ffmpeg lut3d / blend 滤镜参数（timeline.service）。
 *
 * .cube 格式要点（Adobe Cube LUT 规范）：
 *   · 数据行主序 R 变化最慢、B 最快：index = (r * N + g) * N + b；
 *   · DOMAIN_MIN/MAX（或 LUT_3D_INPUT_RANGE）声明表覆盖的颜色区间，查表前把
 *     源颜色从 [DOMAIN_MIN, DOMAIN_MAX] 归一到 [0,1]（ffmpeg lut3d 同语义）；
 *   · 1D LUT（LUT_1D_SIZE）不在支持范围，直接报明确错误。
 */

import type { TimelineVisualLut } from './timeline-visual';

/** 解析失败（缺头 / 行数不符 / 非法数值）都抛这个，调用方可按需提示用户 */
export class LutParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LutParseError';
  }
}

export interface Lut3dTable {
  /** 网格边长 N（限制 2–64，防脏数据撑爆内存） */
  size: number;
  /** 长度 N³×3，行主序 R 慢 B 快 */
  data: Float32Array;
  domainMin: [number, number, number];
  domainMax: [number, number, number];
  title: string | null;
}

/** 网格边长支持范围：超出直接按范围报错，避免巨型 N³ 分配 */
const LUT_SIZE_MIN = 2;
const LUT_SIZE_MAX = 64;

/** 解析一行里的 3 个浮点数（数据行 / DOMAIN_MIN / DOMAIN_MAX 共用） */
const parseVec3 = (raw: string, lineNo: number, what: string): [number, number, number] => {
  const parts = raw.trim().split(/\s+/);
  if (parts.length !== 3) {
    throw new LutParseError(`第 ${lineNo} 行 ${what} 需要 3 个数值，收到 ${parts.length} 个`);
  }
  const v = parts.map(Number);
  if (v.some((x) => !Number.isFinite(x))) {
    throw new LutParseError(`第 ${lineNo} 行 ${what} 含非数值内容：${raw.trim().slice(0, 40)}`);
  }
  return [v[0], v[1], v[2]];
};

/**
 * 解析 .cube 文本。任何结构性问题都抛 LutParseError（带行号），让上层能给出
 * 「这份文件坏在哪」的明确提示，而不是渲染出错误的颜色。
 */
export function parseLutCube(text: string): Lut3dTable {
  let size = 0; // 0 = 尚未声明
  let title: string | null = null;
  let domainMin: [number, number, number] = [0, 0, 0];
  let domainMax: [number, number, number] = [1, 1, 1];
  let data: Float32Array | null = null;
  let row = 0;
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line || line.startsWith('#')) continue;
    const upper = line.toUpperCase();
    const lineNo = i + 1;
    if (upper.startsWith('TITLE')) {
      if (title === null) title = line.slice(5).trim().replace(/^"|"$/g, '');
      continue;
    }
    if (upper.startsWith('LUT_1D_SIZE')) {
      throw new LutParseError('暂不支持 1D LUT（LUT_1D_SIZE）：请改用 3D .cube 文件');
    }
    if (upper.startsWith('LUT_3D_SIZE')) {
      const n = Number(line.slice(11).trim().split(/\s+/)[0]);
      if (!Number.isFinite(n) || n < 1) {
        throw new LutParseError(`第 ${lineNo} 行 LUT_3D_SIZE 不是有效数字：${line.slice(11).trim().slice(0, 20)}`);
      }
      // clamp 到支持范围；随后按 N³ 校验数据行数，声明与实际不符会得到明确报错
      size = Math.min(LUT_SIZE_MAX, Math.max(LUT_SIZE_MIN, Math.round(n)));
      data = new Float32Array(size * size * size * 3);
      row = 0;
      continue;
    }
    if (upper.startsWith('DOMAIN_MIN')) {
      domainMin = parseVec3(line.slice(10), lineNo, 'DOMAIN_MIN');
      continue;
    }
    if (upper.startsWith('DOMAIN_MAX')) {
      domainMax = parseVec3(line.slice(10), lineNo, 'DOMAIN_MAX');
      continue;
    }
    if (upper.startsWith('LUT_3D_INPUT_RANGE')) {
      // Adobe 规范的 DOMAIN 等价写法：min0 min1 min2 max0 max1 max2
      const parts = line.slice(18).trim().split(/\s+/);
      if (parts.length !== 6 || parts.some((p) => !Number.isFinite(Number(p)))) {
        throw new LutParseError(`第 ${lineNo} 行 LUT_3D_INPUT_RANGE 需要 6 个数值`);
      }
      domainMin = [Number(parts[0]), Number(parts[1]), Number(parts[2])];
      domainMax = [Number(parts[3]), Number(parts[4]), Number(parts[5])];
      continue;
    }
    // 其余行都是数据行：R G B 三元组
    if (size === 0) {
      throw new LutParseError(`第 ${lineNo} 行数据出现在 LUT_3D_SIZE 之前：${line.slice(0, 40)}`);
    }
    if (row >= size * size * size) {
      throw new LutParseError(`数据行数超出 LUT_3D_SIZE=${size} 的声明（应有 ${size * size * size} 行 R G B）`);
    }
    const [r, g, b] = parseVec3(line, lineNo, '数据行');
    const o = row * 3;
    data![o] = r;
    data![o + 1] = g;
    data![o + 2] = b;
    row += 1;
  }
  if (size === 0) throw new LutParseError('缺少 LUT_3D_SIZE 头：不是有效的 .cube 3D LUT');
  const expected = size * size * size;
  if (row !== expected) {
    throw new LutParseError(`数据行数不符：LUT_3D_SIZE=${size} 需要 ${expected} 行，实际读得 ${row} 行`);
  }
  return { size, data: data!, domainMin, domainMax, title };
}

/** 网格下标：行主序 R 慢 B 快 */
const latticeIndex = (n: number, ir: number, ig: number, ib: number) => ((ir * n + ig) * n + ib) * 3;

/**
 * CPU 参考实现：三线性插值查表。入参先按 DOMAIN 归一并夹紧到 [0,1]
 * （与导出端 ffmpeg lut3d、预览端 WebGL 着色器同语义）。
 */
export function sampleLut(
  table: Lut3dTable,
  r: number,
  g: number,
  b: number,
): [number, number, number] {
  const { size: n, data, domainMin, domainMax } = table;
  const norm = (v: number, i: number) => {
    const span = domainMax[i] - domainMin[i];
    const t = span > 1e-6 ? (v - domainMin[i]) / span : 0;
    return Math.max(0, Math.min(1, t));
  };
  // 三线性：R/G/B 三个维度的格点下标（低角/高角）与插值权重
  const axisOf = (v: number, i: number) => norm(v, i) * (n - 1);
  const ar = axisOf(r, 0);
  const ag = axisOf(g, 1);
  const ab = axisOf(b, 2);
  const i0r = Math.min(n - 1, Math.floor(ar));
  const i0g = Math.min(n - 1, Math.floor(ag));
  const i0b = Math.min(n - 1, Math.floor(ab));
  const i1r = Math.min(n - 1, i0r + 1);
  const i1g = Math.min(n - 1, i0g + 1);
  const i1b = Math.min(n - 1, i0b + 1);
  const fr = ar - i0r;
  const fg = ag - i0g;
  const fb = ab - i0b;
  let outR = 0;
  let outG = 0;
  let outB = 0;
  for (let corner = 0; corner < 8; corner += 1) {
    const ir = corner & 1 ? i1r : i0r;
    const ig = corner & 2 ? i1g : i0g;
    const ib = corner & 4 ? i1b : i0b;
    const w =
      (corner & 1 ? fr : 1 - fr) * (corner & 2 ? fg : 1 - fg) * (corner & 4 ? fb : 1 - fb);
    const o = latticeIndex(n, ir, ig, ib);
    outR += data[o] * w;
    outG += data[o + 1] * w;
    outB += data[o + 2] * w;
  }
  return [outR, outG, outB];
}

/** ffmpeg 滤镜参数值内需要转义的字符（路径按 work 目录相对文件名传入，不含目录分隔） */
const escapeFilterPath = (path: string) =>
  path.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/:/g, '\\:');

/**
 * 导出端 ffmpeg 滤镜参数：
 *   strength ≥ ~1 → 单滤镜 `lut3d=file=<path>`（插进 -vf 链即可）；
 *   strength < 1  → 一段带标签的子图
 *     `split[a][b];[a]lut3d=file=<path>[c];[c][b]blend=all_mode=normal:all_opacity=<s>`
 *     嵌进 -vf 链时前面接上一个滤镜（split 无标签输入自动承接），后面接
 *     scale/pad 等（blend 无标签输出自动续链）——ffmpeg filtergraph 会把
 *     相邻链的无标签端口连起来，两种形状都能直接放进逗号连接的 -vf 数组。
 * lut 缺失 / 路径为空 → 返回 []（调用方不加任何滤镜，命令与旧版一致）。
 */
export function buildLutFilterArgs(
  lut: TimelineVisualLut | null | undefined,
  cubePath: string,
): string[] {
  const url = typeof lut?.url === 'string' ? lut.url.trim() : '';
  const path = cubePath.trim();
  if (!url || !path) return [];
  const raw = Number(lut.strength);
  const strength = Number.isFinite(raw) ? Math.max(0, Math.min(1, raw)) : 1;
  if (strength >= 0.999) return [`lut3d=file=${escapeFilterPath(path)}`];
  return [
    `split[a][b];[a]lut3d=file=${escapeFilterPath(path)}[c];[c][b]blend=all_mode=normal:all_opacity=${strength.toFixed(3)}`,
  ];
}
