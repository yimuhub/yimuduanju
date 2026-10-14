/**
 * S2 题材预设（移植 ToonFlow story_skills 12 题材编剧铁律）。
 * genreBlock 拼进剧本技能 prompt（novel/adapt/expand/ad），与风格块正交：
 * 风格定“长什么样”，题材定“怎么写”。
 */
export interface GenrePreset {
  id: string;
  label: string;
  description: string;
  /** 编剧铁律（ToonFlow 各题材 README + planning_narrative 提炼） */
  rules: string[];
}

export const GENRE_PRESETS: GenrePreset[] = [
  {
    id: 'historical_epic',
    label: '历史史诗',
    description: '大时代小人物，仪式感与沉默转折',
    rules: ['大时代小人物折射时代', '仪式感赋予历史重量', '转折靠沉默非演说'],
  },
  {
    id: 'urban_workplace',
    label: '都市职场',
    description: '真实感经得起审视，表面和气暗流博弈',
    rules: ['真实感为基石经得审视', '表面和气暗流博弈', '成长螺旋上升有代价'],
  },
  {
    id: 'coming_of_age',
    label: '青春成长',
    description: '第一次的鲜烈慌张，时间不可逆',
    rules: ['珍惜第一次鲜烈慌张', '时间不可逆为底色', '相聚必走向各奔东西'],
  },
  {
    id: 'sweet_romance',
    label: '甜宠言情',
    description: '含蓄留白，以小博大，推拉递进',
    rules: ['含蓄留白靠微反应', '以小博大细节动人', '大特写一集用两三次'],
  },
  {
    id: 'mystery_thriller',
    label: '悬疑推理',
    description: '信息差悬念，真相分层揭示',
    rules: ['操控信息差制造悬念', '真相拆三到五层揭示', '开篇三十秒抛钩子'],
  },
  {
    id: 'hot_blooded_action',
    label: '热血少年',
    description: '先抑后扬，以弱胜强，燃点有节制',
    rules: ['先抑后扬低谷再爆发', '叠加燃点不超三次', '战吼全片限两三次'],
  },
  {
    id: 'xianxia_fantasy',
    label: '古风仙侠',
    description: '意境先行，异象呼应情绪，镜头宜静',
    rules: ['意境先行画外传情', '天地异象呼应情绪', '七成镜头静止极缓'],
  },
  {
    id: 'psychological_drama',
    label: '心理博弈',
    description: '话中有话，信息不对称即武器',
    rules: ['表里不一话中有话', '铺垫反转比例三比一', '对峙段落镜头须静止'],
  },
  {
    id: 'scifi_apocalypse',
    label: '科幻末世',
    description: '生存成本定义一切，环境代替对白',
    rules: ['生存成本定义一切', '环境衰败代替对白', '资源短缺驱动冲突'],
  },
  {
    id: 'horror_supernatural',
    label: '恐怖灵异',
    description: '未知不揭示全貌，日常裂缝，跳吓节制',
    rules: ['未知不提前揭示全貌', '跳吓全片限一两次', '七成镜头静止压迫'],
  },
  {
    id: 'comedy_humor',
    label: '喜剧搞笑',
    description: '预期违背，笑点高频，角色认真',
    rules: ['预期违背先立后破', '笑点间隔不超六十秒', '角色认真荒谬才好笑'],
  },
  {
    id: 'family_warmth',
    label: '家庭温情',
    description: '平凡即伟大，爱用行动传递',
    rules: ['平凡日常即伟大', '爱用笨拙行动传递', '和解靠行动非道歉'],
  },
];

export function getGenrePreset(genreId?: string): GenrePreset | undefined {
  if (!genreId) return undefined;
  return GENRE_PRESETS.find((g) => g.id === genreId);
}

/** 题材块：拼进技能 prompt，放在风格块之后、模式之前 */
export function genreBlock(genre?: GenrePreset): string {
  if (!genre) return '';
  return `题材设定【${genre.label}】：${genre.description}\n题材铁律：${genre.rules.join('；')}`;
}
