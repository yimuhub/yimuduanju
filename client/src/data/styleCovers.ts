/**
 * 风格封面 · 21 种画风 + 22 个风格中心条目的原创封面映射
 *
 * 图片为项目自制 AI 生成（原创虚构角色，不含任何影视/游戏 IP 角色与品牌标识），
 * 统一 3:4 竖构图、单人半身、电影级环境光，裁成 768×1024 存于 /public/styles/*.webp。
 * 21 种画风各有专属封面；风格中心的 22 个条目按视觉最接近一一对应。
 */
import type { ArtStyle } from '@shared/api.interface';

/** 画风 → 风格大类（风格条标签 / 筛选用） */
export type StyleFamily = '真人' | '2D 漫' | '3D' | '风格化';

const ART_STYLE_COVER: Record<ArtStyle, string> = {
  realistic: '/styles/realistic.webp',
  live_action: '/styles/live-action.webp',
  anime_2d: '/styles/anime-2d.webp',
  manhwa: '/styles/manhwa.webp',
  chinese_comic: '/styles/chinese-comic.webp',
  otome: '/styles/otome.webp',
  guofeng_3d: '/styles/guofeng-3d.webp',
  xianxia: '/styles/xianxia.webp',
  cartoon: '/styles/cartoon.webp',
  cg_cyberpunk: '/styles/cg-cyberpunk.webp',
  guofeng_2d: '/styles/guofeng-2d.webp',
  flat_2d: '/styles/flat-2d.webp',
  anime_90s: '/styles/anime-90s.webp',
  urban_romance: '/styles/urban-romance.webp',
  anime_3d: '/styles/anime-3d.webp',
  traditional_3d: '/styles/traditional-3d.webp',
  clay_stopmotion: '/styles/clay-stopmotion.webp',
  guofeng_cyber: '/styles/guofeng-cyber.webp',
  ancient_real: '/styles/ancient-real.webp',
  modern_city_real: '/styles/modern-city-real.webp',
  urban_sweet_real: '/styles/urban-sweet-real.webp',
};

const ART_STYLE_FAMILY: Record<ArtStyle, StyleFamily> = {
  realistic: '真人',
  live_action: '真人',
  anime_2d: '2D 漫',
  manhwa: '2D 漫',
  chinese_comic: '2D 漫',
  otome: '2D 漫',
  guofeng_3d: '3D',
  xianxia: '风格化',
  cartoon: '2D 漫',
  cg_cyberpunk: '风格化',
  guofeng_2d: '2D 漫',
  flat_2d: '风格化',
  anime_90s: '2D 漫',
  urban_romance: '2D 漫',
  anime_3d: '3D',
  traditional_3d: '3D',
  clay_stopmotion: '3D',
  guofeng_cyber: '风格化',
  ancient_real: '真人',
  modern_city_real: '真人',
  urban_sweet_real: '真人',
};

export const styleCover = (style?: string): string =>
  ART_STYLE_COVER[(style ?? '') as ArtStyle] ?? ART_STYLE_COVER.realistic;

export const styleFamily = (style?: string): StyleFamily =>
  ART_STYLE_FAMILY[(style ?? '') as ArtStyle] ?? '真人';

/**
 * 风格中心 22 个条目 → 视觉最接近的专属封面。
 * 每个条目仍有独立提示词；只有 3D 写实组两例共用一张 PBR 渲染图。
 */
export const STYLE_LIBRARY_COVERS: Record<string, string> = {
  'cinematic-realism': '/styles/realistic.webp',
  'urban-romance': '/styles/urban-romance.webp',
  'thriller-coldtone': '/styles/modern-city-real.webp',
  'hk-neon-noir': '/styles/guofeng-cyber.webp',
  'retro-film': '/styles/anime-90s.webp',
  'jp-cel-anime': '/styles/anime-2d.webp',
  'shinkai-sky': '/styles/anime-3d.webp',
  'ghibli-fairytale': '/styles/otome.webp',
  'korean-webtoon': '/styles/manhwa.webp',
  'american-comic': '/styles/cartoon.webp',
  'impasto-fantasy': '/styles/traditional-3d.webp',
  'chibi-cute': '/styles/clay-stopmotion.webp',
  'ink-wash': '/styles/chinese-comic.webp',
  'gongbi-illustration': '/styles/guofeng-2d.webp',
  'xianxia-fantasy': '/styles/xianxia.webp',
  'dunhuang-mural': '/styles/ancient-real.webp',
  'pixar-family': '/styles/urban-sweet-real.webp',
  'guofeng-3d': '/styles/guofeng-3d.webp',
  'realistic-3d': '/styles/traditional-3d.webp',
  'cyberpunk-neon': '/styles/cg-cyberpunk.webp',
  'post-apocalyptic': '/styles/live-action.webp',
  vaporwave: '/styles/flat-2d.webp',
};

/** 内置模板封面（按模板名匹配，缺失时按 hash 复用） */
export const TEMPLATE_COVERS: Record<string, string> = {
  都市情感: '/styles/urban-romance.webp',
  古风仙侠: '/styles/xianxia.webp',
  悬疑推理: '/styles/modern-city-real.webp',
  热血动漫: '/styles/anime-2d.webp',
  三分钟成片: '/styles/live-action.webp',
  九宫格漫剧: '/styles/chinese-comic.webp',
};

const TEMPLATE_FALLBACKS = Object.values(TEMPLATE_COVERS);

export const templateCover = (name: string): string => {
  if (TEMPLATE_COVERS[name]) return TEMPLATE_COVERS[name];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return TEMPLATE_FALLBACKS[h % TEMPLATE_FALLBACKS.length];
};
