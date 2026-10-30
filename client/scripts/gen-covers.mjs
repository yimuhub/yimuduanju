/**
 * 生成静态封面 SVG（零依赖，node 直接跑）：
 *   node client/scripts/gen-covers.mjs
 *
 * 输出到 client/public/covers/：
 *   styles-<id>.svg   22 个画风库封面（3:4，读 client/src/data/styleLibrary.ts）
 *   tpl-<n>.svg       6 个内置模板封面（3:4，读 scripts/db-init.sql 种子）
 *   proj-<n>.svg      8 张通用项目封面（渐变 + emoji/图形构图）
 *
 * 设计语言：双色渐变底 + 大号英文水印（实心/描边交替）+ 细纹理（圆点/斜线/圆环）
 * + 光斑留白 + 底部半透明中文风格名条。页面在 <img> 加载失败时回退到纯渐变。
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(scriptDir, '..', '..');
const outDir = join(repoRoot, 'client', 'public', 'covers');
mkdirSync(outDir, { recursive: true });

const W = 600;
const H = 800;
const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** 水印字号随词长自适应（按 0.72em/字符估算宽 + 字距），保证 3:4 版心内不溢出 */
const watermarkFont = (word) => Math.min(112, Math.floor(492 / (word.length * 0.72)));

/**
 * 通用 3:4 封面
 * watermark: 英文水印词数组（逐行堆叠）；texture: dots | lines | rings
 * barText/barSub: 底部名条中文主/副标题；emoji: 可选中心图形
 */
function coverSvg({ c1, c2, watermark = [], texture = 'dots', barText = '', barSub = '', emoji = '' }) {
  const defs = [`<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/>
    </linearGradient>`,
  `<radialGradient id="glow" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.28"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>`,
  `<radialGradient id="shade" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#000000" stop-opacity="0.22"/>
      <stop offset="1" stop-color="#000000" stop-opacity="0"/>
    </radialGradient>`];

  if (texture === 'dots') {
    defs.push(`<pattern id="tex" width="26" height="26" patternUnits="userSpaceOnUse">
      <circle cx="3" cy="3" r="1.7" fill="#ffffff" opacity="0.16"/>
    </pattern>`);
  } else if (texture === 'lines') {
    defs.push(`<pattern id="tex" width="16" height="16" patternUnits="userSpaceOnUse">
      <path d="M-2 2 L2 -2 M0 16 L16 0 M14 18 L18 14" stroke="#ffffff" stroke-width="1.1" opacity="0.14"/>
    </pattern>`);
  } else {
    defs.push(`<pattern id="tex" width="72" height="72" patternUnits="userSpaceOnUse">
      <circle cx="36" cy="36" r="30" fill="none" stroke="#ffffff" stroke-width="1" opacity="0.12"/>
    </pattern>`);
  }

  // 水印行：实心与描边交替，制造层级
  const lines = watermark.slice(0, 3);
  const lineH = 96;
  const startY = 380 - ((lines.length - 1) * lineH) / 2;
  const watermarkEl = lines
    .map((word, i) => {
      const fs = watermarkFont(word);
      const y = startY + i * lineH;
      return i % 2 === 0
        ? `<text x="48" y="${y}" font-family="'PingFang SC','Noto Sans SC',-apple-system,'Segoe UI',sans-serif" font-size="${fs}" font-weight="900" letter-spacing="2" fill="#ffffff" opacity="0.16">${esc(word.toUpperCase())}</text>`
        : `<text x="48" y="${y}" font-family="'PingFang SC','Noto Sans SC',-apple-system,'Segoe UI',sans-serif" font-size="${fs}" font-weight="900" letter-spacing="2" fill="none" stroke="#ffffff" stroke-width="1.6" opacity="0.24">${esc(word.toUpperCase())}</text>`;
    })
    .join('\n    ');

  // 底部名条：宽度按中英文文本估算
  let bar = '';
  if (barText) {
    const zhW = barText.length * 27;
    const subW = barSub ? barSub.length * 7.4 + 18 : 0;
    const bw = Math.round(56 + zhW + subW);
    const bx = 44;
    const by = H - 108;
    bar = `
    <rect x="${bx}" y="${by}" width="${bw}" height="60" rx="30" fill="#0b0e14" opacity="0.34"/>
    <rect x="${bx}" y="${by}" width="${bw}" height="60" rx="30" fill="none" stroke="#ffffff" stroke-opacity="0.28"/>
    <circle cx="${bx + 30}" cy="${by + 30}" r="5" fill="#ffffff" opacity="0.85"/>
    <text x="${bx + 46}" y="${by + 39}" font-family="'PingFang SC','Noto Sans SC','Microsoft YaHei',sans-serif" font-size="26" font-weight="600" fill="#ffffff">${esc(barText)}</text>
    ${barSub ? `<text x="${bx + 46 + zhW + 16}" y="${by + 37}" font-family="-apple-system,'Segoe UI',sans-serif" font-size="13" letter-spacing="1" fill="#ffffff" opacity="0.72">${esc(barSub)}</text>` : ''}`;
  }

  const emojiEl = emoji
    ? `
    <circle cx="${W / 2}" cy="330" r="128" fill="none" stroke="#ffffff" stroke-opacity="0.3" stroke-width="1.5"/>
    <circle cx="${W / 2}" cy="330" r="148" fill="none" stroke="#ffffff" stroke-opacity="0.14" stroke-width="1"/>
    <text x="${W / 2}" y="${330 + 58}" font-size="132" text-anchor="middle">${esc(emoji)}</text>`
    : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img">
  <defs>
    ${defs.join('\n    ')}
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <rect width="${W}" height="${H}" fill="url(#tex)"/>
  <circle cx="96" cy="86" r="210" fill="url(#glow)"/>
  <circle cx="540" cy="760" r="230" fill="url(#shade)"/>
  <circle cx="532" cy="120" r="64" fill="none" stroke="#ffffff" stroke-opacity="0.2" stroke-width="1.4"/>
  <circle cx="60" cy="620" r="10" fill="#ffffff" opacity="0.3"/>${emojiEl}
  <text x="48" y="112" font-family="-apple-system,'Segoe UI',sans-serif" font-size="15" letter-spacing="6" fill="#ffffff" opacity="0.66">YIMU · AI STUDIO</text>
  <line x1="48" y1="128" x2="128" y2="128" stroke="#ffffff" stroke-opacity="0.4" stroke-width="2"/>
  ${watermarkEl}${bar}
</svg>
`;
}

/* ---------------- 1. 画风库封面：读 styleLibrary.ts ---------------- */

const libSource = readFileSync(
  join(repoRoot, 'client', 'src', 'data', 'styleLibrary.ts'),
  'utf8',
);

const styleRe =
  /id:\s*'([^']+)'[\s\S]*?nameZh:\s*'([^']+)'[\s\S]*?nameEn:\s*'([^']+)'[\s\S]*?gradient:\s*\[\s*'([^']+)'\s*,\s*'([^']+)'/g;
const styles = [];
let m;
while ((m = styleRe.exec(libSource)) !== null) {
  styles.push({ id: m[1], nameZh: m[2], nameEn: m[3], c1: m[4], c2: m[5] });
}
if (styles.length === 0) throw new Error('未能从 styleLibrary.ts 解析到任何风格');

const TEXTURES = ['dots', 'lines', 'rings'];
let count = 0;
for (const [i, s] of styles.entries()) {
  const words = s.nameEn.split(/\s+/).filter(Boolean);
  const svg = coverSvg({
    c1: s.c1,
    c2: s.c2,
    watermark: words,
    texture: TEXTURES[i % TEXTURES.length],
    barText: s.nameZh,
    barSub: s.nameEn,
  });
  writeFileSync(join(outDir, `styles-${s.id}.svg`), svg);
  count++;
}

/* ---------------- 2. 模板封面：读 db-init.sql 内置种子 ---------------- */

const sql = readFileSync(join(repoRoot, 'scripts', 'db-init.sql'), 'utf8');
const tplRe =
  /\('([^']+)',\s*'(full|duration|genre|style)',\s*'[^']*',\s*'[^']*',\s*\d+,\s*'[\d:]+',\s*'([a-z0-9_]+)'/g;
const templates = [];
while ((m = tplRe.exec(sql)) !== null) {
  templates.push({ name: m[1], artStyle: m[3] });
}

/** 内置模板专属渐变（同名 artStyle 的多个模板各自区分） */
const TPL_PALETTE = {
  都市情感: ['#5B5FC7', '#F2A0B5'],
  古风仙侠: ['#C2503E', '#E8B54A'],
  悬疑推理: ['#22344E', '#5E8AA0'],
  热血动漫: ['#E8554D', '#2B4C9B'],
  三分钟成片: ['#0E7A6E', '#67E8F9'],
  九宫格漫剧: ['#4F6DF5', '#8B5CF6'],
};
const TPL_WATERMARK = {
  realistic: ['Realistic'],
  guofeng_3d: ['Guofeng', '3D'],
  anime_2d: ['Anime', '2D'],
  manhwa: ['Manhwa'],
  duration: ['3 Min', 'Cut'],
};
const TPL_STYLE_LABEL = {
  realistic: '写实真人',
  guofeng_3d: '国风 3D',
  anime_2d: '日漫 2D',
  manhwa: '漫剧',
  duration: '通用时长',
};

for (const [i, t] of templates.entries()) {
  const [c1, c2] = TPL_PALETTE[t.name] ?? ['#6366F1', '#EC4899'];
  const wm = TPL_WATERMARK[t.artStyle] ?? ['Template'];
  const svg = coverSvg({
    c1,
    c2,
    watermark: wm,
    texture: TEXTURES[(i + 1) % TEXTURES.length],
    barText: t.name,
    barSub: TPL_STYLE_LABEL[t.artStyle] ?? t.artStyle,
  });
  writeFileSync(join(outDir, `tpl-${i + 1}.svg`), svg);
  count++;
}

/* ---------------- 3. 通用项目封面 ---------------- */

const PROJECTS = [
  { c1: '#0EA5E9', c2: '#4F46E5', emoji: '🌊' },
  { c1: '#F59E0B', c2: '#DC2626', emoji: '🌆' },
  { c1: '#8B5CF6', c2: '#EC4899', emoji: '🌙' },
  { c1: '#10B981', c2: '#84CC16', emoji: '🌿' },
  { c1: '#475569', c2: '#1E293B', emoji: '🏙️' },
  { c1: '#F43F5E', c2: '#F97316', emoji: '🔥' },
  { c1: '#06B6D4', c2: '#3B82F6', emoji: '❄️' },
  { c1: '#A855F7', c2: '#4F46E5', emoji: '🎭' },
];

for (const [i, p] of PROJECTS.entries()) {
  const svg = coverSvg({
    c1: p.c1,
    c2: p.c2,
    watermark: [],
    texture: TEXTURES[i % TEXTURES.length],
    barText: '短剧项目',
    barSub: `No.${i + 1}`,
    emoji: p.emoji,
  });
  writeFileSync(join(outDir, `proj-${i + 1}.svg`), svg);
  count++;
}

console.log(
  `已生成 ${count} 张封面到 client/public/covers/（styles ${styles.length} + tpl ${templates.length} + proj ${PROJECTS.length}）`,
);
