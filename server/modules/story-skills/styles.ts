import type { ArtStyle, StoryStylePreset } from '@shared/api.interface';

/**
 * 故事风格预设包（W4 商业化 / 用户风格要求）。
 * - visual / negative 直接拼进图片·视频生成提示词（与 pavo3 风格库词汇对齐）；
 * - tone 指导调色与光影；camera 给分镜默认运镜倾向；
 * - 新增 live_action（真人实景）补齐用户点名的风格。
 */
export const STYLE_PRESETS: Record<ArtStyle, StoryStylePreset> = {
  realistic: {
    id: 'realistic',
    artStyle: 'realistic',
    label: '写实仿真人',
    description: '真人质感写实风，适合都市情感、悬疑题材',
    visual:
      'photorealistic live-action still, natural skin texture, realistic lighting, cinematic depth of field',
    negative: 'cartoon, anime, illustration, 3d render, deformed faces',
    tone: 'natural color grade, soft daylight or warm interior light',
    camera: 'eye-level medium shots, subtle handheld movement',
  },
  live_action: {
    id: 'live_action',
    artStyle: 'live_action',
    label: '真人实景',
    description: '实拍感真人短剧，强现实代入感，适合家庭伦理、职场题材',
    visual:
      'real-life short drama footage style, on-location shooting look, realistic wardrobe and set design, documentary realism',
    negative: 'anime, cartoon, illustration, cgi, fantasy glow',
    tone: 'neutral realistic grade, location-accurate lighting',
    camera: 'handheld documentary feel, over-the-shoulder dialogue shots',
  },
  anime_2d: {
    id: 'anime_2d',
    artStyle: 'anime_2d',
    label: '2D 日漫',
    description: '经典二维日漫，适合校园、青春、奇幻题材',
    visual:
      '2d japanese anime style, cel shading, clean line art, expressive eyes, vibrant backgrounds',
    negative: 'photorealistic, 3d render, western cartoon, blurry',
    tone: 'bright saturated palette, clean highlights',
    camera: 'dynamic anime angles, speed lines for motion',
  },
  manhwa: {
    id: 'manhwa',
    artStyle: 'manhwa',
    label: '韩漫',
    description: '韩式条漫质感，高颜值人物，适合霸总、复仇题材',
    visual:
      'korean manhwa webtoon style, full-color digital painting, glamorous character design, dramatic lighting',
    negative: 'black and white, sketch, chibi, photorealistic',
    tone: 'rich contrast, glossy highlights, fashionable palette',
    camera: 'vertical-scroll friendly close-ups, dramatic low angles',
  },
  chinese_comic: {
    id: 'chinese_comic',
    artStyle: 'chinese_comic',
    label: '国漫',
    description: '国风二次元，适合仙侠、玄幻、武侠题材',
    visual:
      'chinese donghua style, elegant hanfu costume design, flowing sleeves, ink-inspired accents, refined facial features',
    negative: 'photorealistic, western comic, cyberpunk neon',
    tone: 'jade green and crimson palette, misty atmosphere',
    camera: 'sweeping wuxia wide shots, floating camera moves',
  },
  otome: {
    id: 'otome',
    artStyle: 'otome',
    label: '乙女向',
    description: '少女漫唯美风，适合甜宠、恋爱题材',
    visual:
      'shoujo manga aesthetic, sparkling eyes, soft glowing effects, flower petals atmosphere, delicate linework',
    negative: 'dark horror, gore, photorealistic wrinkles, harsh',
    tone: 'pastel pink palette, dreamy soft focus glow',
    camera: 'intimate close-ups, slow push-in on emotional beats',
  },
  guofeng_3d: {
    id: 'guofeng_3d',
    artStyle: 'guofeng_3d',
    label: '3D 国风',
    description: '三维国风建模，华丽服化道，适合大制作古装、神话题材',
    visual:
      '3d guofeng animation style, detailed hanfu embroidery, ornate headdresses, unreal engine quality render, chinese palace architecture',
    negative: '2d flat, sketch, low-poly, western medieval',
    tone: 'gold and vermilion palette, volumetric god rays',
    camera: 'epic crane shots, slow orbital moves around characters',
  },
  xianxia: {
    id: 'xianxia',
    artStyle: 'xianxia',
    label: '仙侠',
    description: '仙气飘飘的修仙世界，御剑飞行、云雾缭绕',
    visual:
      'xianxia fantasy style, floating immortal mountains, flowing robes, sword light effects, clouds and mist, ethereal glow',
    negative: 'modern city, guns, photorealistic documentary',
    tone: 'celestial cyan and white palette, luminous mist',
    camera: 'aerial flying shots, slow majestic reveals',
  },
  cartoon: {
    id: 'cartoon',
    artStyle: 'cartoon',
    label: '卡通',
    description: '轻松 Q 版卡通，适合搞笑、日常、儿童向',
    visual:
      'cheerful cartoon style, rounded shapes, exaggerated expressions, bright flat colors, family-friendly design',
    negative: 'photorealistic, horror, dark gritty, hyper-detailed',
    tone: 'candy-bright palette, even cheerful lighting',
    camera: 'playful quick cuts, squash-and-stretch energy',
  },
  cg_cyberpunk: {
    id: 'cg_cyberpunk',
    artStyle: 'cg_cyberpunk',
    label: '赛博朋克',
    description: '霓虹都市未来感，适合科幻、悬疑、动作题材',
    visual:
      'cyberpunk cg style, neon-lit rainy streets, holographic ads, reflective wet surfaces, futuristic techwear fashion',
    negative: 'pastoral, daytime rural, watercolor, soft cozy',
    tone: 'magenta-cyan neon grade, rain reflections, night ambience',
    camera: 'low-angle neon reveals, drone-like glides',
  },
  // S1 ToonFlow art_skills 移植（11 画风，描述来自各 prefix.md/README 提炼，
  // visual 英文提示词直给模型，label/description 中文面向用户）
  guofeng_2d: {
    id: 'guofeng_2d',
    artStyle: 'guofeng_2d',
    label: '国风2D',
    description: '新国潮仙侠宫廷，赛璐璐平涂东方古韵，适合仙侠古偶',
    visual:
      'chinese guofeng 2d anime, cel-shading flat colors, delicate brushwork, hanfu palace aesthetics, oriental classical film tone',
    negative: 'photorealistic 3d render, fluorescent colors, western fantasy',
    tone: 'neutral color temperature, natural soft light, cel-shading grade',
    camera: 'cinematic composition, foreground-mid-background depth',
  },
  flat_2d: {
    id: 'flat_2d',
    artStyle: 'flat_2d',
    label: '扁平风',
    description: '纯色块无阴影几何极简，适合职场、科普、广告',
    visual:
      'flat vector illustration style, solid color blocks, geometric shapes, no shadows or gradients, minimal modern clean look',
    negative: '3d render, shadows, gradients, textures, photorealistic',
    tone: 'neutral temperature, solid color contrast blocks',
    camera: 'flat single-plane composition, no depth of field',
  },
  anime_90s: {
    id: 'anime_90s',
    artStyle: 'anime_90s',
    label: '90s日漫',
    description: '90 年代手绘平涂怀旧治愈，适合青春、家庭、治愈题材',
    visual:
      '90s japanese anime style, hand-drawn cel look, smooth linework, nostalgic warm tones, slice-of-life warmth',
    negative: 'modern style, 3d cgi, fluorescent neon, sharp digital',
    tone: 'warm nostalgic grade, soft cinematic warm light',
    camera: 'eye-level natural perspective, layered depth',
  },
  urban_romance: {
    id: 'urban_romance',
    artStyle: 'urban_romance',
    label: '都市罗曼史',
    description: '成熟都市言情二次元，冷调电影光影，适合现代言情',
    visual:
      'mature urban romance anime, cel-shading clean lines, low-saturation cool base with warm accents, dramatic cinematic lighting',
    negative: 'photorealistic, 3d, fluorescent, outdated elements',
    tone: 'cool grade with strong contrast, cold base warm highlights',
    camera: 'cinematic framing, shallow depth of field',
  },
  anime_3d: {
    id: 'anime_3d',
    artStyle: 'anime_3d',
    label: '3D动漫',
    description: '三维赛璐珞渲染明快治愈，适合都市、校园、合家欢',
    visual:
      '3d anime cel-shaded render, outlined toon shading, high-detail warm cartoon look, modern city setting',
    negative: 'photorealistic, dark moody, heavy shadows, fluorescent',
    tone: 'warm sunset glow grade, soft warm light',
    camera: 'natural perspective, shallow depth compositions',
  },
  traditional_3d: {
    id: 'traditional_3d',
    artStyle: 'traditional_3d',
    label: '传统3D',
    description: '高精度 PBR 国风传统色，典雅大气，适合历史、文化题材',
    visual:
      'chinese traditional 3d render, high-precision PBR modeling, traditional chinese color palette, elegant oriental aesthetics',
    negative: 'photorealistic, fluorescent, western cyberpunk, modern',
    tone: 'neutral temperature, volumetric light, traditional colors',
    camera: 'shallow depth with vignette, natural perspective',
  },
  clay_stopmotion: {
    id: 'clay_stopmotion',
    artStyle: 'clay_stopmotion',
    label: '黏土定格',
    description: '手工黏土肌理定格质感，治愈童真，适合儿童、奇幻、广告',
    visual:
      'claymation stop-motion style, handmade clay texture with fingerprints, rounded soft shapes, warm cozy fantasy cartoon',
    negative: 'sleek modern 3d, smooth plastic cgi, photorealistic',
    tone: 'warm soft light, shallow depth, nostalgic warm grade',
    camera: 'shallow focus, tangible stop-motion feel',
  },
  guofeng_cyber: {
    id: 'guofeng_cyber',
    artStyle: 'guofeng_cyber',
    label: '国风赛博',
    description: '东方美学融合全息霓虹，古今共生未来都市，适合科幻国风',
    visual:
      'guofeng cyber 3d render, next-gen PBR, traditional oriental aesthetics fused with holographic neon, future city blending old and new',
    negative: 'pure western style, neon bleed without guofeng elements',
    tone: 'cool-neutral volumetric light with neon fill',
    camera: 'orbit wide angles, neon bokeh depth',
  },
  ancient_real: {
    id: 'ancient_real',
    artStyle: 'ancient_real',
    label: '古风真人',
    description: '真人古风实拍纪实质感，冷中带暖，适合甜宠古偶',
    visual:
      'live-action ancient chinese drama stills, photorealistic skin detail, documentary cinematic texture, sweet romance mood',
    negative: 'cartoon, anime, fluorescent, modern elements',
    tone: 'cool grade with strong contrast, cold base warm accents',
    camera: 'eye-level, shallow depth with vignette',
  },
  modern_city_real: {
    id: 'modern_city_real',
    artStyle: 'modern_city_real',
    label: '都市真人',
    description: '院线级都市实拍克制诗意，适合现实主义、职场题材',
    visual:
      'live-action modern chinese city film stills, photorealistic everyday texture, restrained poetic realism, theatrical cinematography',
    negative: 'cgi, anime, ancient style, cyberpunk sci-fi',
    tone: 'warm daylight and cold night sources, motivated color temperature',
    camera: 'wide-angle deep focus, handheld gaze',
  },
  urban_sweet_real: {
    id: 'urban_sweet_real',
    artStyle: 'urban_sweet_real',
    label: '甜宠真人',
    description: '都市写实强对比直球温暖，适合现代甜宠、生活题材',
    visual:
      'live-action modern sweet romance stills, natural skin documentary detail, warm direct emotion, city life realism',
    negative: 'cartoon, fluorescent, ancient style, revealing outfits',
    tone: 'warm grade with strong contrast, cold base warm accents',
    camera: 'eye-level shallow depth, documentary framing',
  },
};

/** 按 artStyle 取风格包，未知回落写实 */
export function getStylePreset(artStyle?: string): StoryStylePreset {
  if (artStyle && artStyle in STYLE_PRESETS) {
    return STYLE_PRESETS[artStyle as ArtStyle];
  }
  return STYLE_PRESETS.realistic;
}

/** 按风格 id 取风格包，未知回落写实 */
export function getStylePresetById(styleId?: string): StoryStylePreset {
  const found = styleId
    ? (Object.values(STYLE_PRESETS) as StoryStylePreset[]).find((s) => s.id === styleId)
    : undefined;
  return found ?? STYLE_PRESETS.realistic;
}
