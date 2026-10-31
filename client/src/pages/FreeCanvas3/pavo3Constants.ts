/**
 * 自由画布 · 1:1 复刻 Pavo AI Canvas
 * 常量：节点元数据 / 模型列表 / 风格库 / 快捷键 / 姿势预设
 */
import type { ModelItem, PavoNodeType } from './pavo3Types';

/* ---------------- Pavo 视觉令牌（实测取证） ---------------- */
export const P3 = {
  primary: '#0ABCCF', // 主色（青色）：按钮/链接/选中
  text: '#121212',
  helper: '#717171',
  weak: '#9C9C9C',
  faint: '#B0B0B0',
  border: '#E8E8E8',
  hover: '#F2F2F2',
  cardBorder: '#E8E8E8',
  nodeActive: '#0ABCCF',
  green: '#34C759',
};

/* ---------------- 节点类型元数据 ---------------- */
export interface NodeTypeMeta {
  type: PavoNodeType;
  label: string; // 菜单名
  hint: string; // 节点卡片内提示
}

export const NODE_TYPES: NodeTypeMeta[] = [
  { type: 'text', label: '文本', hint: '' },
  { type: 'image', label: '图片', hint: '' },
  { type: 'video', label: '视频', hint: '' },
  { type: 'audio', label: '音频', hint: '' },
  { type: 'composite', label: '视频合成', hint: '请连接视频节点后操作' },
  { type: 'director', label: '导演台', hint: '在3D空间中搭建场景并进行多视角截图' },
  { type: 'script', label: '剧本', hint: '全剧 / 分集剧本文本，双击编辑' },
  { type: 'character', label: '角色', hint: '角色人设与定妆参考，双击编辑属性' },
  { type: 'scene', label: '场景', hint: '场地设定与场景概念，双击编辑属性' },
  { type: 'storyboard', label: '分镜', hint: '单镜头信息（景别 / 台词 / 时长），双击编辑' },
  { type: 'note', label: '备注', hint: '创作便签，双击记录想法' },
];

/** 创作类节点专属配色（节点徽标 / 小地图 / 左侧面板共用） */
export const NODE_COLORS: Record<string, string> = {
  text: '#0ABCCF',
  image: '#7FB8FF',
  video: '#E5484D',
  audio: '#34C759',
  composite: '#9C9C9C',
  director: '#121212',
  script: '#F5A623',
  character: '#E85D75',
  scene: '#8E6FE8',
  storyboard: '#5B8DEF',
  note: '#FFC53D',
};

/** 左侧元素面板 / 添加菜单的分组结构 */
export const NODE_GROUPS: { title: string; types: PavoNodeType[] }[] = [
  { title: '媒体', types: ['text', 'image', 'video', 'audio', 'composite', 'director'] },
  { title: '短剧创作', types: ['script', 'character', 'scene', 'storyboard', 'note'] },
];

/** 全类型空计数器（重置 / 恢复画布共用，避免漏掉新增类型） */
export const EMPTY_COUNTERS: Record<PavoNodeType, number> = {
  text: 0,
  image: 0,
  video: 0,
  audio: 0,
  composite: 0,
  director: 0,
  script: 0,
  character: 0,
  scene: 0,
  storyboard: 0,
  note: 0,
};

/** 空文本节点的「尝试」按钮 */
export const TEXT_TRY = ['自己编写', '一句话生成剧本', '文生图', '文生视频', '图片反推提示词'];

/** 视频节点「尝试」 */
export const VIDEO_TRY = ['首尾帧', '全能参考'];

/** 音频节点「尝试」 */
export const AUDIO_TRY = ['音色克隆', '生成BGM', '生成音效'];

/** 筛选分类（左侧「全部」下拉） */
export const FILTERS: { key: string; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'text', label: '文本' },
  { key: 'image', label: '图片' },
  { key: 'video', label: '视频' },
  { key: 'audio', label: '音频' },
  { key: 'composite', label: '视频合成' },
  { key: 'director', label: '导演台' },
  { key: 'script', label: '剧本' },
  { key: 'character', label: '角色' },
  { key: 'scene', label: '场景' },
  { key: 'storyboard', label: '分镜' },
  { key: 'note', label: '备注' },
];

/* ---------------- 模型列表（对接三通道 API 的展示结构；数据后续由后台配置） ---------------- */
export const MODELS: Record<string, ModelItem[]> = {
  text: [
    { id: 'agnes-2.0-flash', name: 'Agnes 2.0 Flash', tag: '免费', desc: '兼顾效果与速度，适用各类生成场景，优质画面表现', kind: 'text' },
    { id: 'agnes-2.0-pro', name: 'Agnes 2.0 Pro', desc: '深度推理与长文本创作，适合剧本与分镜撰写', kind: 'text' },
    { id: 'deepseek-v3', name: 'DeepSeek V3', desc: '通用文本生成，稳定可靠', kind: 'text' },
    { id: 'qwen-plus', name: 'Qwen Plus', desc: '全能文本模型，中文理解出色', kind: 'text' },
  ],
  image: [
    { id: 'agnes-image-2.1-flash', name: 'Agnes Image 2.1 Flash', tag: '免费', desc: '兼顾效果与速度，适用各类生成场景，优质画面表现', kind: 'image' },
    { id: 'gpt-image-2', name: 'GPT Image 2', desc: '精准图像生成与编辑', kind: 'image' },
    { id: 'seedream-5.0-pro', name: 'Seedream 5.0 Pro', desc: '精准交互式编辑，支持多语言原生排版', kind: 'image' },
    { id: 'seedream-5.0-lite', name: 'Seedream 5.0 Lite', desc: '精细化编辑控制', kind: 'image' },
    { id: 'seedream-4.5', name: 'Seedream 4.5', desc: '更强的主体一致性与文字渲染能力', kind: 'image' },
    { id: 'qwen-image-3-pro', name: 'Qwen Image 3 Pro', desc: '专业视觉创作，精准文字渲染与复杂排版', kind: 'image' },
    { id: 'qwen-image-3', name: 'Qwen Image 3', desc: '全能图像生成，超长指令理解与强细节还原', kind: 'image' },
    { id: 'nanobanana-2', name: 'NanoBanana 2', desc: '更快生成高保真图像', kind: 'image' },
    { id: 'nanobanana-2-lite', name: 'NanoBanana 2 Lite', desc: '更快生成高保真图像', kind: 'image' },
    { id: 'nanobanana-pro', name: 'NanoBanana Pro', desc: '超强提示词理解与执行能力', kind: 'image' },
  ],
  video: [
    { id: 'agnes-video-1.5', name: 'Agnes Video 1.5', tag: '免费', desc: '视频生成与首尾帧控制', kind: 'video' },
    { id: 'seedance-2.5', name: 'Seedance 2.5', desc: '专业级影像与连贯剧情演绎', kind: 'video' },
    { id: 'kling-2.0', name: 'Kling 2.0', desc: '高动态视频生成', kind: 'video' },
  ],
  audio: [
    { id: 'agnes-tts', name: 'Agnes TTS', tag: '免费', desc: '多音色语音合成与克隆', kind: 'audio' },
    { id: 'sunflower-music', name: 'Sunflower Music', desc: 'BGM 与音效生成', kind: 'audio' },
  ],
  composite: [],
  director: [],
};

/* ---------------- 风格库（真实生成参数包：正向/负面风格词 + 色调光影质感 + 参考强度） ---------------- */
export interface StyleItem {
  id: string;
  name: string;
  cat: '2D' | '3D' | '真人';
  /** 风格预览占位色 */
  hue: string;
  /** 正向风格词（英文，拼进生成提示词） */
  prompt: string;
  /** 负面风格词（写入 negative_prompt） */
  negative: string;
  /** 色调 / 光影 / 质感 */
  tone: string;
  /** 参考强度建议值 0-1（图生图时使用） */
  strength: number;
}

export const STYLE_LIBRARY: StyleItem[] = [
  {
    id: 'crayon', name: '儿童蜡笔手绘插画风格', cat: '2D', hue: '#FFB3A7',
    prompt: 'children crayon hand-drawn illustration, naive art, thick crayon strokes, playful colors, storybook style',
    negative: 'photorealistic, 3d render, dark, gloomy, realistic shading',
    tone: 'warm pastel palette, soft flat lighting, paper texture',
    strength: 0.55,
  },
  {
    id: 'shadowplay', name: '皮影戏插画风格', cat: '2D', hue: '#D9B38C',
    prompt: 'chinese shadow puppetry illustration, cut-paper silhouette style, warm backlit glow, intricate leather carving patterns, traditional folk art',
    negative: 'photorealistic, modern, bright white background, harsh lighting',
    tone: 'amber and sepia tones, backlit rim glow, layered translucent layers',
    strength: 0.6,
  },
  {
    id: 'chinese-shadow', name: '中式皮影风格', cat: '2D', hue: '#C98A5A',
    prompt: 'chinese shadow play style, silhouette cutouts, warm lantern backlight, opera costume patterns, traditional stage curtain',
    negative: 'photorealistic, 3d, modern clothes, daylight',
    tone: 'warm amber glow, strong rim light, fabric texture',
    strength: 0.6,
  },
  {
    id: 'ink', name: '黑白水墨风格', cat: '2D', hue: '#A8A8A8',
    prompt: 'chinese ink wash painting, sumi-e, black and white, flowing brush strokes, negative space, traditional shuimo style',
    negative: 'color, photorealistic, 3d, neon, saturated',
    tone: 'monochrome ink gradients, soft diffused light, rice paper texture',
    strength: 0.5,
  },
  {
    id: 'oriental-ink', name: '东方水墨风格', cat: '2D', hue: '#9AA8A0',
    prompt: 'oriental ink brush painting, eastern minimalism, elegant brush strokes, misty mountains, zen atmosphere, xuan paper',
    negative: 'photorealistic, heavy colors, western oil painting, busy composition',
    tone: 'soft ink washes, gray-green palette, atmospheric mist',
    strength: 0.5,
  },
  {
    id: 'cyberpunk', name: '赛博朋克数字插画风格', cat: '2D', hue: '#7FB8FF',
    prompt: 'cyberpunk digital illustration, neon-lit city, holographic advertisements, rain-soaked streets, futuristic technology, high contrast',
    negative: 'soft, pastel, cozy, daytime, rural',
    tone: 'neon magenta and cyan highlights, wet street reflections, night ambience',
    strength: 0.65,
  },
  {
    id: 'anime90', name: '90年代日式动画风格', cat: '2D', hue: '#F4C98E',
    prompt: '90s japanese anime style, retro cel animation, hand-painted backgrounds, nostalgic pastel palette, classic tv anime aesthetics',
    negative: '3d render, photorealistic, modern digital anime, flat shading',
    tone: 'warm nostalgic tones, cel shading, film grain',
    strength: 0.6,
  },
  {
    id: 'bwcomic', name: '黑白二维漫画动画风格', cat: '2D', hue: '#B0B0B0',
    prompt: 'black and white 2d comic animation style, screentone shading, bold ink outlines, manga panel composition, dramatic contrast',
    negative: 'color, photorealistic, soft gradients',
    tone: 'high contrast monochrome, halftone dots, dynamic lines',
    strength: 0.55,
  },
  {
    id: 'myth', name: '中国神话风格', cat: '2D', hue: '#E8B84B',
    prompt: 'chinese mythology illustration, ancient gods and dragons, auspicious clouds, gold and red palette, dunhuang fresco influence',
    negative: 'modern, photorealistic, western fantasy, muted colors',
    tone: 'rich gold accents, glowing divine light, traditional patterns',
    strength: 0.6,
  },
  {
    id: 'otomo', name: '大友克洋风格', cat: '2D', hue: '#C9B79C',
    prompt: 'katsuhiro otomo style, detailed mechanical illustration, intricate machinery, cinematic wide shots, muted earth tones, akira influence',
    negative: 'flat, simple, bright saturated colors, soft anime',
    tone: 'detailed cross-hatching, industrial ambience, dramatic scale',
    strength: 0.6,
  },
  {
    id: 'pixel', name: '像素风', cat: '2D', hue: '#9BE8B0',
    prompt: 'pixel art style, 16-bit retro game aesthetics, chunky pixels, limited color palette, detailed sprite work',
    negative: 'photorealistic, vector, smooth gradients, 3d',
    tone: 'crisp pixel clusters, retro game lighting',
    strength: 0.5,
  },
  {
    id: 'tezuka', name: '手冢治虫时代卡通插画风格', cat: '2D', hue: '#F0C9A0',
    prompt: 'tezuka era cartoon illustration, 1960s manga style, big expressive eyes, classic round faces, retro newspaper print feel',
    negative: 'photorealistic, 3d, modern digital anime',
    tone: 'warm paper tones, soft cel shading, vintage texture',
    strength: 0.55,
  },
  {
    id: 'anime', name: '二次元动漫', cat: '2D', hue: '#FFC9DE',
    prompt: '2d anime style, vibrant colors, clean lineart, big sparkling eyes, dynamic pose, popular japanese animation aesthetics',
    negative: 'photorealistic, 3d, sketchy, dark',
    tone: 'bright cel shading, glossy highlights, clean composition',
    strength: 0.5,
  },
  {
    id: 'guoman', name: '国漫二次元常用风格', cat: '2D', hue: '#FFB6A3',
    prompt: 'chinese 2d animation style, guoman aesthetics, elegant character design, chinese cultural elements, refined lineart, webtoon quality',
    negative: '3d, photorealistic, western cartoon',
    tone: 'soft gradient shading, warm palette, clean rendering',
    strength: 0.5,
  },
  {
    id: 'ghibli', name: '宫崎骏画风', cat: '2D', hue: '#B8E0C8',
    prompt: 'studio ghibli style, hand-drawn animation, lush nature backgrounds, soft watercolor skies, gentle characters, whimsical atmosphere',
    negative: 'photorealistic, 3d, dark, gritty',
    tone: 'soft natural lighting, pastel skies, dreamy atmosphere',
    strength: 0.6,
  },
  {
    id: 'uscomic', name: '美国漫画动画插画风格', cat: '2D', hue: '#7FC4FF',
    prompt: 'american comic book style, bold ink outlines, dynamic action poses, halftone shadows, superhero comic aesthetics',
    negative: 'photorealistic, flat, minimalist',
    tone: 'dramatic lighting, saturated colors, comic panel energy',
    strength: 0.55,
  },
  {
    id: 'americomix', name: '美式漫画', cat: '2D', hue: '#6FA8DC',
    prompt: 'american comics style, exaggerated anatomy, thick outlines, vibrant flat colors, classic marvel dc comic feel',
    negative: 'anime, photorealistic, watercolor',
    tone: 'high contrast, bold shadows, punchy colors',
    strength: 0.55,
  },
  {
    id: 'cartoon2d', name: '二维卡通插画风格', cat: '2D', hue: '#FFD98E',
    prompt: '2d cartoon illustration style, simple shapes, expressive characters, fun proportions, family-friendly animation look',
    negative: 'photorealistic, dark, complex detail',
    tone: 'bright cheerful lighting, solid colors, clean outlines',
    strength: 0.5,
  },
  {
    id: 'minimal', name: '简洁插画风格', cat: '2D', hue: '#D8D8D8',
    prompt: 'minimalist illustration style, clean lines, flat colors, generous negative space, modern vector look',
    negative: 'photorealistic, cluttered, complex texture',
    tone: 'soft even lighting, monochrome accent palette',
    strength: 0.45,
  },
  {
    id: 'childdoodle', name: '儿童简笔画风格', cat: '2D', hue: '#FFE08A',
    prompt: 'children doodle style, simple stick figures, naive hand-drawn lines, colorful scribbles, playful kindergarten art',
    negative: 'photorealistic, 3d, dark',
    tone: 'bright cheerful colors, flat lighting, paper texture',
    strength: 0.5,
  },
  {
    id: 'shoujo', name: '日式少女漫风格', cat: '2D', hue: '#FFC4E0',
    prompt: 'japanese shoujo manga style, delicate lineart, sparkly eyes, floral backgrounds, soft pastel palette, romantic atmosphere',
    negative: 'photorealistic, 3d, dark, gritty',
    tone: 'soft dreamy lighting, pink accents, glitter effects',
    strength: 0.55,
  },
  {
    id: 'relaxsketch', name: '松弛轮廓手绘风', cat: '2D', hue: '#C9BFA8',
    prompt: 'relaxed sketch style, loose contour lines, unfinished look, expressive strokes, artistic minimalism',
    negative: 'photorealistic, heavy shading, tight rendering',
    tone: 'natural light, sketchbook paper texture, airy feel',
    strength: 0.5,
  },
  {
    id: 'flatillust', name: '日系平涂插画风格', cat: '2D', hue: '#FFD0B0',
    prompt: 'japanese flat illustration style, flat colors, no gradient shading, clean composition, character art with simple background',
    negative: '3d, photorealistic, complex shading',
    tone: 'even flat lighting, crisp color blocks',
    strength: 0.5,
  },
  {
    id: 'darkfantasy', name: '黑暗奇幻风格', cat: '2D', hue: '#5A5A7A',
    prompt: 'dark fantasy illustration, gothic atmosphere, ominous lighting, detailed armor and creatures, epic moody composition',
    negative: 'bright, cheerful, realistic modern',
    tone: 'low-key dramatic lighting, deep shadows, desaturated palette',
    strength: 0.65,
  },
  {
    id: 'darkconcept', name: '黑暗原画概念风格', cat: '2D', hue: '#4A4A5E',
    prompt: 'dark concept art style, moody environment design, cinematic lighting, atmospheric fog, game concept art quality',
    negative: 'bright, saturated, flat',
    tone: 'chiaroscuro lighting, volumetric fog, gritty texture',
    strength: 0.65,
  },
  {
    id: 'shangmei', name: '上美厂老动画风格', cat: '2D', hue: '#E8C48E',
    prompt: 'shanghai animation studio classic style, chinese ink animation, watercolor backgrounds, 1980s chinese cel animation, folk art aesthetics',
    negative: 'photorealistic, 3d, modern digital',
    tone: 'warm nostalgic tones, soft watercolor washes, delicate lines',
    strength: 0.6,
  },
  {
    id: 'guofeng', name: '国风二次元新国潮风格', cat: '2D', hue: '#FFB0A0',
    prompt: 'guofeng xin-guochao style, chinese traditional elements fused with anime, hanfu fashion, modern chinese pop aesthetics, vibrant reds and golds',
    negative: 'photorealistic, dull, western',
    tone: 'festive warm lighting, gold embroidery accents, clean cel shading',
    strength: 0.55,
  },
  {
    id: 'aaagame', name: '美国3A游戏概念艺术风格', cat: '3D', hue: '#8FA8C8',
    prompt: 'american AAA game concept art style, realistic rendering, epic scale, detailed environments, cinematic lighting, unreal engine quality',
    negative: 'flat, anime, low detail',
    tone: 'cinematic dynamic lighting, realistic materials, atmospheric depth',
    strength: 0.65,
  },
  {
    id: 'blender', name: 'Blender 渲染风格', cat: '3D', hue: '#8FD0E0',
    prompt: 'blender 3d render style, clean geometry, studio lighting, smooth materials, cycles render look',
    negative: 'photorealistic photo, sketch, anime',
    tone: 'studio softbox lighting, clean reflections, neutral backdrop',
    strength: 0.6,
  },
  {
    id: 'lowpoly', name: '低多边形风格', cat: '3D', hue: '#A8D8A8',
    prompt: 'low poly 3d style, faceted geometry, stylized low-poly models, vibrant flat colors, game asset look',
    negative: 'photorealistic, smooth high-poly, dark',
    tone: 'bright ambient lighting, matte surfaces, colorful palette',
    strength: 0.55,
  },
  {
    id: 'cartoon3d', name: '3D卡通渲染风格', cat: '3D', hue: '#9FD0FF',
    prompt: '3d cartoon render style, toon shading, stylized proportions, pixar-like quality, cute character design',
    negative: 'photorealistic, dark, flat 2d',
    tone: 'soft global illumination, rim light, playful colors',
    strength: 0.55,
  },
  {
    id: 'film', name: '电影感写真风格', cat: '真人', hue: '#B0A8A0',
    prompt: 'cinematic film photography style, shallow depth of field, film grain, moody color grading, anamorphic look, realistic portrait',
    negative: 'cartoon, illustration, oversaturated',
    tone: 'golden hour or teal-orange grade, soft bokeh, natural skin texture',
    strength: 0.6,
  },
  {
    id: 'commercial', name: '商业摄影风格', cat: '真人', hue: '#A8B8C8',
    prompt: 'commercial photography style, studio product lighting, crisp details, professional retouching, high-end advertising look',
    negative: 'amateur snapshot, heavy filter, cartoon',
    tone: 'clean studio lighting, soft shadows, premium finish',
    strength: 0.55,
  },
  {
    id: 'fashion', name: '时尚大片风格', cat: '真人', hue: '#E8A0B8',
    prompt: 'high fashion editorial photography, bold poses, dramatic styling, magazine cover quality, avant-garde composition',
    negative: 'casual snapshot, cartoon, dull',
    tone: 'studio strobe lighting, editorial contrast, glossy finish',
    strength: 0.6,
  },
  {
    id: 'live_action', name: '真人实景风格', cat: '真人', hue: '#C9BFA8',
    prompt: 'real-life short drama footage style, on-location shooting look, realistic wardrobe and set design, documentary realism, vertical video framing',
    negative: 'anime, cartoon, illustration, cgi, fantasy glow',
    tone: 'neutral realistic grade, location-accurate lighting',
    strength: 0.6,
  },
  {
    id: 'guofeng3d', name: '国风3D写实风格', cat: '3D', hue: '#7AC8A8',
    prompt: '3d guofeng realistic render, detailed hanfu embroidery, ornate headdresses, chinese palace architecture, unreal engine quality, lifelike skin',
    negative: '2d flat, sketch, low-poly, western medieval',
    tone: 'gold and vermilion palette, volumetric god rays, cinematic depth',
    strength: 0.65,
  },
];

export const STYLE_CATS = ['全部', '2D', '3D', '真人'] as const;

/* ---------------- 快捷键（Pavo 实测取证） ---------------- */
export const SHORTCUT_GROUPS: { title: string; items: { keys: string; desc: string }[] }[] = [
  {
    title: '创作',
    items: [
      { keys: '双击空白', desc: '新建文本节点' },
      { keys: 'Tab', desc: '新建节点' },
      { keys: '⌘D', desc: '复制节点和连线' },
      { keys: 'Delete', desc: '删除选中节点 / 连线' },
      { keys: '右键节点', desc: '节点菜单（重命名/复制/删除/设为参考）' },
      { keys: '⌘Enter', desc: '生成' },
      { keys: '⌥拖动', desc: '节点复制' },
      { keys: '⌘⌥拖动', desc: '创建副本' },
    ],
  },
  {
    title: '缩放',
    items: [
      { keys: '⌘+', desc: '放大' },
      { keys: '⌘-', desc: '缩小' },
      { keys: '⌘0', desc: '适应画布' },
      { keys: '⌘+触控板', desc: '触控板缩放' },
      { keys: '⌘+滚轮', desc: '鼠标缩放' },
    ],
  },
  {
    title: '移动画布',
    items: [
      { keys: 'Space', desc: '键盘移动' },
      { keys: '触控板', desc: '触控板移动' },
      { keys: '鼠标', desc: '鼠标移动' },
    ],
  },
  {
    title: '其它',
    items: [
      { keys: '⌘Z', desc: '撤销' },
      { keys: '⌘⇧Z', desc: '重做' },
      { keys: 'Delete', desc: '删除' },
    ],
  },
];

/* ---------------- 3D 导演台：姿势预设（20 种，Pavo 实测取证） ---------------- */
export const POSE_PRESETS = [
  '站立', 'T型', '行走', '跑步', '坐姿', '蹲下', '单膝跪', '双膝跪', '叉腰', '倚靠',
  '鞠躬', '思考', '格斗', '踢球', '投掷', '推进', '招手', '伸手', '抱臂', '看手机',
];

export const BODY_SLIDERS = [
  { group: '身体', label: '前倾', key: 'bend' },
  { group: '身体', label: '转身', key: 'turn' },
  { group: '身体', label: '侧倾', key: 'lean' },
  { group: '躯干', label: '前倾', key: 'torsoBend' },
  { group: '躯干', label: '扭转', key: 'torsoTwist' },
];

/* ---------------- 图片生成面板选项 ---------------- */
export const RATIOS = ['9:16', '16:9', '1:1', '3:4', '4:3', '21:9'];
/** 视频时长 / 分辨率（Pavo 参数行：比例 | 时长 | 分辨率） */
export const VIDEO_DURATIONS = ['4s', '8s', '12s', '15s', '30s'];
export const VIDEO_RESOLUTIONS = ['720P', '1080P', '2K', '4K'];

export const VIDEO_MODES = ['文生视频', '全能参考', '首尾帧'];

export const RESOLUTIONS = ['1K', '2K', '4K'];
export const PRESETS = ['通用', '电影感', '动漫', '插画', '写实', '水墨'];
export const COUNTS = [1, 2, 3, 4];

/* ---------------- 演示产物（占位） ---------------- */
export const DEMO_IMAGE =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0ABCCF" stop-opacity="0.35"/><stop offset="1" stop-color="#7FB8FF" stop-opacity="0.55"/></linearGradient></defs><rect width="512" height="512" rx="24" fill="url(#g)"/><g fill="none" stroke="#ffffff" stroke-opacity="0.9" stroke-width="6" stroke-linecap="round"><path d="M150 190l80 0M150 210l50 0"/><circle cx="340" cy="200" r="46"/><circle cx="340" cy="200" r="14"/></g><text x="256" y="330" font-family="PingFang SC, sans-serif" font-size="26" fill="#ffffff" text-anchor="middle">AI 生成图片</text><text x="256" y="368" font-family="PingFang SC, sans-serif" font-size="15" fill="#ffffff" opacity="0.85" text-anchor="middle">演示产物 · 对接 API 后替换为真实结果</text></svg>`,
  );

export const DEMO_VIDEO =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" rx="24" fill="#121212"/><circle cx="256" cy="246" r="70" fill="none" stroke="#0ABCCF" stroke-width="10"/><polygon points="236,210 236,282 292,246" fill="#0ABCCF"/><text x="256" y="380" font-family="PingFang SC, sans-serif" font-size="24" fill="#ffffff" text-anchor="middle">AI 生成视频</text><text x="256" y="414" font-family="PingFang SC, sans-serif" font-size="14" fill="#ffffff" opacity="0.7" text-anchor="middle">演示产物</text></svg>`,
  );

export const DEMO_AUDIO =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" rx="24" fill="#F2F2F2"/><g stroke="#121212" stroke-width="8" stroke-linecap="round"><path d="M180 210h80v100h-80z" fill="none"/><path d="M260 240l60-30v100l-60-30"/></g><text x="256" y="380" font-family="PingFang SC, sans-serif" font-size="24" fill="#121212" text-anchor="middle">AI 生成音频</text></svg>`,
  );
