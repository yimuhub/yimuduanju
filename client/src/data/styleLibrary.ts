/**
 * 风格中心 · 画风库（2025-2026 AI 短剧 / AI 漫剧主流画风调研整理）
 *
 * 分类依据：即梦 / 可灵 / PixVerse / 海螺等主流生成工具的画风归类，
 * 以及 AI 漫剧工业化生产资料中通行的五大体系：
 * 真人短剧（电影感实拍）、漫剧动漫（日漫 / 韩漫 / 美漫）、国风（水墨 / 工笔 / 仙侠）、
 * 3D（皮克斯系 / 写实渲染）、风格化（赛博朋克 / 废土 / 蒸汽波）。
 * 提示词为本项目按「主体 + 镜头 + 光线 + 氛围 + 风格」六要素自主撰写，非任何网站文案搬运。
 */

export type StyleCategory = 'live' | 'anime' | 'guofeng' | 'three_d' | 'stylized';

/** 适用产品线：真人短剧 / AI 漫剧动漫 / 商业广告 */
export type StyleProductLine = '短剧' | '漫剧' | '广告';

export interface StylePreset {
  id: string;
  /** 中文名 */
  nameZh: string;
  /** 英文名 */
  nameEn: string;
  /** 一句话定位 */
  tagline: string;
  /** 正向提示词（英文） */
  positivePrompt: string;
  /** 负面提示词 */
  negativePrompt: string;
  /** 适用产品线 */
  productLines: StyleProductLine[];
  /** 渐变预览色（两个 hex，from → to） */
  gradient: [string, string];
  category: StyleCategory;
}

export const STYLE_CATEGORY_LABELS: Record<StyleCategory, string> = {
  live: '真人短剧',
  anime: '漫剧动漫',
  guofeng: '国风水墨',
  three_d: '3D 写实',
  stylized: '赛博朋克',
};

/** 详情弹窗 / 卡片通用负面提示词：先给通用底，风格再叠加专属项 */
const BASE_NEGATIVE =
  'lowres, blurry, jpeg artifacts, watermark, text, logo, extra fingers, deformed hands, bad anatomy, distorted face';

export const STYLE_LIBRARY: StylePreset[] = [
  /* ---------------- 真人短剧 ---------------- */
  {
    id: 'cinematic-realism',
    nameZh: '电影感写实',
    nameEn: 'Cinematic Realism',
    tagline: '电影级实拍质感，真人短剧的默认安全牌',
    positivePrompt:
      'live-action cinematic still, photorealistic young Asian actors, 35mm film lens, shallow depth of field, natural skin texture, soft key light with warm practical lamps, shallow contrast, muted color grade, emotional close-up shot, professional film set lighting, 8k ultra detailed',
    negativePrompt: `${BASE_NEGATIVE}, cartoon, anime, illustration, 3d render, plastic skin, over-smoothed face`,
    productLines: ['短剧', '广告'],
    gradient: ['#3B4A6B', '#C98B5E'],
    category: 'live',
  },
  {
    id: 'urban-romance',
    nameZh: '都市情感',
    nameEn: 'Urban Romance',
    tagline: '暖调柔光都市剧质感，甜宠 / 霸总题材首选',
    positivePrompt:
      'modern urban romance drama still, elegant young couple in city apartment, warm golden hour window light, soft bokeh city background, clean contemporary fashion, gentle skin tones, airy highlights, romantic atmosphere, 85mm portrait lens, glossy TV drama color grade',
    negativePrompt: `${BASE_NEGATIVE}, dark horror mood, gritty grunge, heavy shadows, cartoon style`,
    productLines: ['短剧', '广告'],
    gradient: ['#F2A6B3', '#F7D9A8'],
    category: 'live',
  },
  {
    id: 'thriller-coldtone',
    nameZh: '悬疑冷调',
    nameEn: 'Cold Noir Thriller',
    tagline: '低饱和蓝绿冷调，悬疑反转题材的氛围引擎',
    positivePrompt:
      'suspense thriller film still, cold desaturated teal and steel blue grade, dim corridor with single overhead practical light, deep shadows, volumetric haze, tense wide-angle composition, rain-wet street reflections at night, anamorphic lens flare, high detail realistic',
    negativePrompt: `${BASE_NEGATIVE}, bright cheerful colors, flat lighting, anime, painting`,
    productLines: ['短剧'],
    gradient: ['#1E3A4C', '#6FA8B5'],
    category: 'live',
  },
  {
    id: 'hk-neon-noir',
    nameZh: '港风霓虹',
    nameEn: 'Hong Kong Neon Noir',
    tagline: '90 年代港片霓虹夜色，黑帮 / 复仇题材出片神器',
    positivePrompt:
      '1990s Hong Kong cinema style, neon-lit night street, red and cyan neon signage reflecting on wet asphalt, moody magenta rim light, smoke and steam, tailored suits, cinematic grain, 2.39:1 wide shot, practical neon lighting, retro film color science',
    negativePrompt: `${BASE_NEGATIVE}, daylight, pastel colors, 3d cartoon, clean minimalist background`,
    productLines: ['短剧'],
    gradient: ['#7A1E4B', '#20B2AA'],
    category: 'live',
  },
  {
    id: 'retro-film',
    nameZh: '复古胶片',
    nameEn: 'Retro Film 90s',
    tagline: '胶片颗粒怀旧色，年代戏与情怀向内容的通行证',
    positivePrompt:
      'retro 1990s film photography look, kodak portra warm tones, visible film grain, slight halation on highlights, nostalgic summer afternoon light, vintage wardrobe and props, faded color palette, candid documentary framing, 50mm lens',
    negativePrompt: `${BASE_NEGATIVE}, hyper-clean digital look, hdr, oversaturated, modern smartphone photo`,
    productLines: ['短剧', '广告'],
    gradient: ['#C46A4A', '#E8C98F'],
    category: 'live',
  },

  /* ---------------- 漫剧动漫 ---------------- */
  {
    id: 'jp-cel-anime',
    nameZh: '日系赛璐璐',
    nameEn: 'Japanese Cel Anime',
    tagline: '标准番剧赛璐璐上色，漫剧量产最稳的底盘',
    positivePrompt:
      'japanese tv anime style, clean cel shading, sharp line art, two-tone shadows, expressive large eyes, consistent character design, vibrant yet controlled palette, dynamic action composition, studio anime key visual quality, 4k',
    negativePrompt: `${BASE_NEGATIVE}, realistic photo, 3d render, thick oil texture, sketch lines`,
    productLines: ['漫剧', '短剧'],
    gradient: ['#4C7DE0', '#9AD0F5'],
    category: 'anime',
  },
  {
    id: 'shinkai-sky',
    nameZh: '逆光云海',
    nameEn: 'Luminous Sky Drama',
    tagline: '逆光云海与极致天空，情绪向漫剧的画面记忆点',
    positivePrompt:
      'anime film still in the style of luminous sky drama, hyper-detailed cumulus clouds and gradient sunset sky, lens flare, radiant backlight, reflective wet streets, delicate light particles, emotional distance shot, painterly background art, crisp character line art',
    negativePrompt: `${BASE_NEGATIVE}, flat dull sky, muted colors, realistic photograph, thick black outlines`,
    productLines: ['漫剧'],
    gradient: ['#2E6FB7', '#F5A3B5'],
    category: 'anime',
  },
  {
    id: 'ghibli-fairytale',
    nameZh: '手绘童话',
    nameEn: 'Storybook Fantasy',
    tagline: '手绘水彩自然光，治愈系童话漫剧的标配',
    positivePrompt:
      'hand-painted anime fairytale style, lush watercolor backgrounds, warm pastoral countryside, gentle afternoon light through leaves, whimsical cozy atmosphere, soft rounded character design, gouache texture, nostalgic storybook feeling',
    negativePrompt: `${BASE_NEGATIVE}, cyberpunk neon, dark gritty mood, photorealistic, hard cel shading`,
    productLines: ['漫剧', '广告'],
    gradient: ['#5B9E6F', '#CBE3A6'],
    category: 'anime',
  },
  {
    id: 'korean-webtoon',
    nameZh: '韩漫质感',
    nameEn: 'Korean Webtoon',
    tagline: '竖屏漫剧主流画风，细线条 + 柔和厚涂',
    positivePrompt:
      'korean webtoon illustration style, clean soft linework, semi-realistic faces with subtle blush, soft airbrush shading, fashionable modern outfits, vertical composition friendly, pastel-toned palette with gentle gradients, romantic drama mood',
    negativePrompt: `${BASE_NEGATIVE}, heavy black outlines, chibi proportions, retro anime palette, photo texture`,
    productLines: ['漫剧', '短剧'],
    gradient: ['#8E7CC3', '#E7B7D3'],
    category: 'anime',
  },
  {
    id: 'american-comic',
    nameZh: '美式漫画',
    nameEn: 'American Comic',
    tagline: '粗线硬朗强对比，热血打斗与英雄题材',
    positivePrompt:
      'american comic book style, bold ink outlines, halftone dot shading, dramatic chiaroscuro, dynamic foreshortening action pose, saturated primary colors, vintage newsprint texture, heroic low-angle composition',
    negativePrompt: `${BASE_NEGATIVE}, soft pastel colors, kawaii style, photorealism, watercolor`,
    productLines: ['漫剧'],
    gradient: ['#D84331', '#2B4C9B'],
    category: 'anime',
  },
  {
    id: 'impasto-fantasy',
    nameZh: '厚涂幻想',
    nameEn: 'Impasto Fantasy',
    tagline: '油画厚涂质感，玄幻史诗感的关键',
    positivePrompt:
      'digital oil impasto painting style, rich textured brush strokes, epic fantasy warrior in dramatic rim light, deep color depth, painterly cloth and armor details, volumetric god rays, concept art masterpiece quality, dramatic composition',
    negativePrompt: `${BASE_NEGATIVE}, flat cel shading, thin line art, cute chibi, photograph`,
    productLines: ['漫剧'],
    gradient: ['#4A3B8C', '#C98A3D'],
    category: 'anime',
  },
  {
    id: 'chibi-cute',
    nameZh: 'Q版萌系',
    nameEn: 'Chibi Cute',
    tagline: '二头身萌系表达，轻喜剧与品牌内容的流量密码',
    positivePrompt:
      'chibi style, super deformed two-head-tall proportions, round soft shapes, big sparkling eyes, pastel candy colors, clean flat shading with soft gradient, kawaii props and expressions, sticker-like composition, white or single-color background',
    negativePrompt: `${BASE_NEGATIVE}, realistic proportions, dark horror, complex background, gritty texture`,
    productLines: ['漫剧', '广告'],
    gradient: ['#F7A8C4', '#A8D8F0'],
    category: 'anime',
  },

  /* ---------------- 国风水墨 ---------------- */
  {
    id: 'ink-wash',
    nameZh: '水墨丹青',
    nameEn: 'Ink Wash Painting',
    tagline: '留白写意水墨，国风短剧开场即封面的格调',
    positivePrompt:
      'traditional chinese ink wash painting style, expressive brush strokes, generous negative space, misty mountains and flowing river, subtle ink gradient from deep black to pale grey, single accent of vermillion red, xuan paper texture, poetic composition',
    negativePrompt: `${BASE_NEGATIVE}, neon colors, 3d render, photorealistic skin, heavy saturation`,
    productLines: ['短剧', '漫剧', '广告'],
    gradient: ['#3A3F44', '#D8D4C8'],
    category: 'guofeng',
  },
  {
    id: 'gongbi-illustration',
    nameZh: '国风工笔',
    nameEn: 'Gongbi Illustration',
    tagline: '细腻线稿雅致上色，人物向国风内容的高级感来源',
    positivePrompt:
      'chinese gongbi fine-brush illustration, delicate hairline outlines, elegant layered translucent coloring, silk scroll texture, ornate hanfu costume patterns, refined floral border motifs, muted mineral pigments, dignified portrait composition',
    negativePrompt: `${BASE_NEGATIVE}, rough sketch, western oil painting, neon lighting, photo texture`,
    productLines: ['漫剧', '广告'],
    gradient: ['#B4574E', '#E3CFA8'],
    category: 'guofeng',
  },
  {
    id: 'xianxia-fantasy',
    nameZh: '仙侠玄幻',
    nameEn: 'Xianxia Fantasy',
    tagline: '御剑流云仙气拉满，仙侠题材的门面画风',
    positivePrompt:
      'chinese xianxia fantasy style, immortal cultivator with flowing robes and sword, floating jade peaks above sea of clouds, glowing spiritual energy particles, silk ribbons in wind, ethereal cyan and gold palette, wuxia cinematic composition, ultra detailed matte painting',
    negativePrompt: `${BASE_NEGATIVE}, modern clothing, sci-fi cyberpunk, cheap plastic 3d, dull colors`,
    productLines: ['短剧', '漫剧'],
    gradient: ['#2C6E8F', '#A8D8C8'],
    category: 'guofeng',
  },
  {
    id: 'dunhuang-mural',
    nameZh: '敦煌壁画',
    nameEn: 'Dunhuang Mural',
    tagline: '矿物颜料壁画质感，文化向内容的稀缺记忆点',
    positivePrompt:
      'dunhuang mogao cave mural style, flying apsaras with flowing ribbons, mineral pigments of azurite malachite and cinnabar, aged earthen wall texture, elegant line drawings, halo patterns and lotus motifs, solemn sacred atmosphere, ancient silk road aesthetic',
    negativePrompt: `${BASE_NEGATIVE}, modern elements, neon, glossy 3d, photograph`,
    productLines: ['漫剧', '广告'],
    gradient: ['#8A5A2B', '#4E7E8C'],
    category: 'guofeng',
  },

  /* ---------------- 3D 写实 ---------------- */
  {
    id: 'pixar-family',
    nameZh: '3D 合家欢',
    nameEn: 'Family 3D',
    tagline: '圆润讨喜的合家欢 3D，全年龄段通吃',
    positivePrompt:
      'family-friendly 3d animation still, stylized rounded character with exaggerated expressive features, soft subsurface scattering skin, warm cinematic lighting, detailed cozy set design, lighthearted adventure mood, octane render, 8k, shallow depth of field',
    negativePrompt: `${BASE_NEGATIVE}, uncanny realistic face, horror mood, flat 2d, low poly`,
    productLines: ['漫剧', '广告'],
    gradient: ['#2E86C1', '#F5B041'],
    category: 'three_d',
  },
  {
    id: 'guofeng-3d',
    nameZh: '国风 3D',
    nameEn: 'Chinese 3D Cartoon',
    tagline: '3D 引擎里的东方美学，国风 IP 短剧主力画风',
    positivePrompt:
      'chinese-style 3d animation, cute stylized character in hanfu, pavilion and bamboo garden set, ink-wash inspired color palette, soft global illumination, silk and jade material detail, dreamy depth of field, high quality cg render',
    negativePrompt: `${BASE_NEGATIVE}, western cartoon style, cyberpunk, photorealistic human, flat 2d`,
    productLines: ['漫剧', '短剧'],
    gradient: ['#C25B6A', '#8FBCB0'],
    category: 'three_d',
  },
  {
    id: 'realistic-3d',
    nameZh: '写实 3D 渲染',
    nameEn: 'Realistic 3D Render',
    tagline: '介纪实拍与 CG 之间，广告大片质感',
    positivePrompt:
      'hyper-realistic 3d render, unreal engine 5 lumen lighting, physically based materials, ray-traced reflections, cinematic product shot composition, meticulous surface detail, studio three-point lighting with rim light, 8k octane render',
    negativePrompt: `${BASE_NEGATIVE}, cartoon, hand-drawn, flat shading, noisy render, low poly`,
    productLines: ['广告', '短剧'],
    gradient: ['#5A6B7C', '#B8C4CC'],
    category: 'three_d',
  },

  /* ---------------- 赛博朋克 / 风格化 ---------------- */
  {
    id: 'cyberpunk-neon',
    nameZh: '赛博朋克',
    nameEn: 'Cyberpunk Neon',
    tagline: '霓虹雨夜机械义体，科幻题材的视觉炸点',
    positivePrompt:
      'cyberpunk style, rain-soaked neon megacity, holographic advertisements in the smog, augmented human with subtle cybernetic implants, magenta and electric blue rim lighting, flying vehicles in the distance, blade runner atmosphere, cinematic wide shot, ultra detailed',
    negativePrompt: `${BASE_NEGATIVE}, daylight countryside, pastoral mood, soft pastel, hand-drawn watercolor`,
    productLines: ['短剧', '漫剧'],
    gradient: ['#12043B', '#00E5FF'],
    category: 'stylized',
  },
  {
    id: 'post-apocalyptic',
    nameZh: '末世废土',
    nameEn: 'Wasteland Post-Apocalyptic',
    tagline: '沙尘铁锈与残垣，生存题材的压迫感来源',
    positivePrompt:
      'post-apocalyptic wasteland style, lone survivor in layered scavenged gear, ruined city overgrown with dust and rusted vehicles, ochre and ash color palette, harsh sunlight through dust haze, desaturated gritty grade, cinematic wide-angle survival composition',
    negativePrompt: `${BASE_NEGATIVE}, lush green forest, cheerful colors, cute chibi, clean modern city`,
    productLines: ['短剧', '漫剧'],
    gradient: ['#6B5637', '#9E9E9E'],
    category: 'stylized',
  },
  {
    id: 'vaporwave',
    nameZh: '蒸汽波',
    nameEn: 'Vaporwave Aesthetic',
    tagline: '粉紫渐变复古未来，潮玩广告与转场包装利器',
    positivePrompt:
      'vaporwave aesthetic, pink and purple gradient sky, chrome geometric shapes, retro computer graphics grid floor, marble statue with glitch effect, palm silhouettes, dreamy synthwave sun, grainy vhs texture, surreal composition',
    negativePrompt: `${BASE_NEGATIVE}, natural realism, muted earth tones, documentary photography`,
    productLines: ['广告', '漫剧'],
    gradient: ['#B96BE0', '#FF8FC8'],
    category: 'stylized',
  },
];

/** 按分类取风格 */
export const stylesByCategory = (category: StyleCategory | 'all') =>
  category === 'all' ? STYLE_LIBRARY : STYLE_LIBRARY.filter((s) => s.category === category);
