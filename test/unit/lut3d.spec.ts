/**
 * LUT（.cube）解析与应用纯函数回归测试
 * ------------------------------------------------------------------
 * 覆盖：标准 2³/4³ 恒等表、DOMAIN 偏移归一与越界夹紧、三线性插值、
 * 坏文件（缺头 / 行数不符 / 非数值 / 1D LUT）、buildLutFilterArgs 两种形状
 * （strength=1 直挂 lut3d；<1 走 split+blend 子图）、normalizeVisualLut 夹紧。
 */
import { buildLutFilterArgs, LutParseError, parseLutCube, sampleLut, type Lut3dTable } from '@shared/lut3d';
import { normalizeVisualLut } from '@shared/timeline-visual';

/** 生成恒等映射 .cube 文本：格点值 = 格点坐标；domain 可选 */
const identityCube = (n: number, domain?: { min: [number, number, number]; max: [number, number, number] }) => {
  const lines: string[] = ['TITLE "unit test"', `LUT_3D_SIZE ${n}`];
  if (domain) {
    lines.push(`DOMAIN_MIN ${domain.min.join(' ')}`);
    lines.push(`DOMAIN_MAX ${domain.max.join(' ')}`);
  }
  const v = (i: number) => (i / Math.max(1, n - 1)).toFixed(6);
  for (let r = 0; r < n; r += 1) {
    for (let g = 0; g < n; g += 1) {
      for (let b = 0; b < n; b += 1) lines.push(`${v(r)} ${v(g)} ${v(b)}`);
    }
  }
  return lines.join('\n');
};

const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;
const expectTriple = (got: [number, number, number], want: [number, number, number]) => {
  expect(near(got[0], want[0])).toBe(true);
  expect(near(got[1], want[1])).toBe(true);
  expect(near(got[2], want[2])).toBe(true);
};

describe('parseLutCube', () => {
  it('标准 2³ 恒等表：表形状与采样与输入一致', () => {
    const table = parseLutCube(identityCube(2));
    expect(table.size).toBe(2);
    expect(table.data.length).toBe(2 * 2 * 2 * 3);
    expect(table.title).toBe('unit test');
    expect(table.domainMin).toEqual([0, 0, 0]);
    expect(table.domainMax).toEqual([1, 1, 1]);
    expectTriple(sampleLut(table, 0, 0, 0), [0, 0, 0]);
    expectTriple(sampleLut(table, 1, 1, 1), [1, 1, 1]);
    expectTriple(sampleLut(table, 0.25, 0.75, 0.5), [0.25, 0.75, 0.5]);
  });

  it('4³ 恒等表：格点中点与任意点插值恒等', () => {
    const table = parseLutCube(identityCube(4));
    expect(table.size).toBe(4);
    expectTriple(sampleLut(table, 1 / 3, 1 / 3, 1 / 3), [1 / 3, 1 / 3, 1 / 3]);
    expectTriple(sampleLut(table, 0.9, 0.1, 0.6), [0.9, 0.1, 0.6]);
  });

  it('DOMAIN 偏移：[0.1, 0.9] 归一到 [0,1] 再查表', () => {
    const table = parseLutCube(identityCube(2, { min: [0.1, 0.1, 0.1], max: [0.9, 0.9, 0.9] }));
    expectTriple(sampleLut(table, 0.1, 0.1, 0.1), [0, 0, 0]);
    expectTriple(sampleLut(table, 0.9, 0.9, 0.9), [1, 1, 1]);
    expectTriple(sampleLut(table, 0.5, 0.5, 0.5), [0.5, 0.5, 0.5]);
  });

  it('DOMAIN 越界夹紧：低于/高于区间的输入落到域角点的格点值', () => {
    const table = parseLutCube(identityCube(2, { min: [0.1, 0.1, 0.1], max: [0.9, 0.9, 0.9] }));
    // 0.0 低于 DOMAIN_MIN → 归一后 0；1.5/-0.5/2.0 分别落到各自域角点
    expectTriple(sampleLut(table, 0.0, 0.0, 0.0), [0, 0, 0]);
    expectTriple(sampleLut(table, 1.5, -0.5, 2.0), [1, 0, 1]);
  });

  it('三线性插值：单通道 LUT 中点取两角点平均', () => {
    // 2³ 表：每行 = (R, 0, 0)，即只随 R 变化；R=0.5 处应插出 0.5
    const lines = ['LUT_3D_SIZE 2'];
    for (let r = 0; r < 2; r += 1) {
      for (let g = 0; g < 2; g += 1) {
        for (let b = 0; b < 2; b += 1) lines.push(`${r} 0 0`);
      }
    }
    const table = parseLutCube(lines.join('\n'));
    expectTriple(sampleLut(table, 0.5, 0.9, 0.2), [0.5, 0, 0]);
    expectTriple(sampleLut(table, 0.25, 0.1, 0.9), [0.25, 0, 0]);
  });

  it('注释 / 空行 / CRLF / 小写关键字都能解析', () => {
    const text = ['# 注释\r\n', '\r\n', 'title "mixed"\r\n', 'lut_3d_size 2\r\n', '\r\n', '0 0 0\r\n', '0 0 1\r\n', '0 1 0\r\n', '0 1 1\r\n', '1 0 0\r\n', '1 0 1\r\n', '1 1 0\r\n', '1 1 1\r\n'].join('');
    const table = parseLutCube(text);
    expect(table.size).toBe(2);
    expect(table.title).toBe('mixed');
    expectTriple(sampleLut(table, 1, 1, 1), [1, 1, 1]);
  });

  it('LUT_3D_SIZE clamp：声明 1 → 按 2 校验行数，行数不符报明确错误', () => {
    expect(() => parseLutCube('LUT_3D_SIZE 1\n0 0 0')).toThrow(LutParseError);
    expect(() => parseLutCube('LUT_3D_SIZE 1\n0 0 0')).toThrow(/数据行数不符/);
  });

  it('缺 LUT_3D_SIZE 头直接报错', () => {
    expect(() => parseLutCube('TITLE x\n0 0 0\n1 1 1')).toThrow(/LUT_3D_SIZE/);
    expect(() => parseLutCube('')).toThrow(LutParseError);
  });

  it('1D LUT 明确拒绝', () => {
    expect(() => parseLutCube('LUT_1D_SIZE 256\n0 0 0')).toThrow(/1D/);
  });

  it('数据行数不符（少/多）报明确错误', () => {
    const missing = ['LUT_3D_SIZE 2', '0 0 0', '0 0 1'].join('\n');
    expect(() => parseLutCube(missing)).toThrow(/需要 8 行，实际读得 2 行/);
    const extra = ['LUT_3D_SIZE 2', ...Array.from({ length: 9 }, () => '0 0 0')].join('\n');
    expect(() => parseLutCube(extra)).toThrow(/超出 LUT_3D_SIZE=2 的声明/);
  });

  it('非数值数据行报错并带行号', () => {
    const bad = ['LUT_3D_SIZE 2', '0 0 0', 'oops not numbers', '0 0 0'].join('\n');
    expect(() => parseLutCube(bad)).toThrow(/第 3 行/);
  });

  it('数据行出现在 LUT_3D_SIZE 之前报错', () => {
    expect(() => parseLutCube('0 0 0\nLUT_3D_SIZE 2')).toThrow(/LUT_3D_SIZE 之前/);
  });

  it('LUT_3D_INPUT_RANGE 等价 DOMAIN', () => {
    const lines = ['LUT_3D_SIZE 2', 'LUT_3D_INPUT_RANGE 0.1 0.1 0.1 0.9 0.9 0.9', ...gridRows2()];
    const table = parseLutCube(lines.join('\n'));
    expectTriple(sampleLut(table, 0.1, 0.1, 0.1), [0, 0, 0]);
    expectTriple(sampleLut(table, 0.9, 0.9, 0.9), [1, 1, 1]);
  });
});

/** 2³ 恒等表数据行 */
const gridRows2 = () => {
  const rows: string[] = [];
  for (let r = 0; r < 2; r += 1) {
    for (let g = 0; g < 2; g += 1) {
      for (let b = 0; b < 2; b += 1) rows.push(`${r} ${g} ${b}`);
    }
  }
  return rows;
};

describe('buildLutFilterArgs', () => {
  it('strength=1 直接 lut3d，不 blend', () => {
    expect(buildLutFilterArgs({ url: '/uploads/p/a.cube', strength: 1 }, 'lut_000.cube')).toEqual([
      'lut3d=file=lut_000.cube',
    ]);
    expect(buildLutFilterArgs({ url: '/a.cube', strength: 0.999 }, 'lut_000.cube')).toEqual([
      'lut3d=file=lut_000.cube',
    ]);
  });

  it('strength<1 生成 split+blend 子图（两种形状区分）', () => {
    const args = buildLutFilterArgs({ url: '/a.cube', strength: 0.5 }, 'lut_000.cube');
    expect(args).toHaveLength(1);
    expect(args[0]).toBe('split[a][b];[a]lut3d=file=lut_000.cube[c];[c][b]blend=all_mode=normal:all_opacity=0.500');
    expect(args[0]).toContain('split');
    expect(args[0]).toContain('blend=all_mode=normal:all_opacity=0.500');
    // 强度 0 也走 blend（原片权重 1），形状一致便于链上拼接
    expect(buildLutFilterArgs({ url: '/a.cube', strength: 0 }, 'x.cube')[0]).toContain('all_opacity=0.000');
  });

  it('lut 缺失 / url 为空 / 路径为空都返回空数组（命令与旧版一致）', () => {
    expect(buildLutFilterArgs(null, 'a.cube')).toEqual([]);
    expect(buildLutFilterArgs(undefined, 'a.cube')).toEqual([]);
    expect(buildLutFilterArgs({ url: '', strength: 1 }, 'a.cube')).toEqual([]);
    expect(buildLutFilterArgs({ url: '/a.cube', strength: 1 }, '')).toEqual([]);
    expect(buildLutFilterArgs({ url: '   ', strength: 1 }, 'a.cube')).toEqual([]);
  });

  it('路径中 ffmpeg 特殊字符做转义', () => {
    const args = buildLutFilterArgs({ url: '/a.cube', strength: 1 }, "a'b:c.cube");
    expect(args[0]).toBe("lut3d=file=a\\'b\\:c.cube");
  });
});

describe('normalizeVisualLut', () => {
  it('合法值透传并补默认强度', () => {
    expect(normalizeVisualLut({ url: '/uploads/p/a.cube', name: 'Teal.cube', strength: 1 })).toEqual({
      url: '/uploads/p/a.cube',
      name: 'Teal.cube',
      strength: 1,
    });
    expect(normalizeVisualLut({ url: ' /a.cube ', strength: 0.4 })).toEqual({ url: '/a.cube', strength: 0.4 });
  });

  it('strength 夹紧 0–1，缺省 1', () => {
    expect(normalizeVisualLut({ url: '/a.cube', strength: 1.7 })?.strength).toBe(1);
    expect(normalizeVisualLut({ url: '/a.cube', strength: -0.2 })?.strength).toBe(0);
    expect(normalizeVisualLut({ url: '/a.cube', strength: Number.NaN })?.strength).toBe(1);
    expect(normalizeVisualLut({ url: '/a.cube' })?.strength).toBe(1);
  });

  it('url 非法整体视为未设置（null），name 超长截断', () => {
    expect(normalizeVisualLut(null)).toBeNull();
    expect(normalizeVisualLut(undefined)).toBeNull();
    expect(normalizeVisualLut({ url: '   ', strength: 1 })).toBeNull();
    expect(normalizeVisualLut({ url: '/a.cube', name: 'x'.repeat(130), strength: 1 })?.name).toHaveLength(120);
  });
});
