/**
 * 内容模式 + 白模来源（双模式产线）
 * ---------------------------------------------------------------
 * contentMode（创作模式）与创建模式 CreationMode（quick/script/professional）
 * 正交：前者决定"拍什么"（短剧/广告/通用），后者决定"怎么建"（极速/剧本/专业）。
 * 白模来源：用户要求多来源都要、白模选填——source 只做标注与路由 gợi ý，
 * 不做必填校验；无白模时全链路（生成/QC）必须照常工作。
 */

export type ContentMode = 'general' | 'drama' | 'ads';
export type WhitemodelSource = 'director' | 'sora' | 'gpt6_code' | 'url';

export interface ContentModeMeta {
  id: ContentMode;
  label: string;
  description: string;
  /** 创建向导默认值（用户可改） */
  defaultDurationSeconds: number;
  defaultAspectRatio: string;
}

export const CONTENT_MODES: ContentModeMeta[] = [
  {
    id: 'general',
    label: '通用',
    description: '不预设类型，按镜头逐个创作',
    defaultDurationSeconds: 90,
    defaultAspectRatio: '9:16',
  },
  {
    id: 'drama',
    label: 'AI 短剧',
    description: '竖屏短剧：钩子前置、悬念结尾、尾帧连贯，单集 60-120s',
    defaultDurationSeconds: 90,
    defaultAspectRatio: '9:16',
  },
  {
    id: 'ads',
    label: 'AI 广告片',
    description: 'Hook+PAS+CTA 三段式，15/30s，首帧产品锚定，多画幅投放',
    defaultDurationSeconds: 30,
    defaultAspectRatio: '9:16',
  },
];

export const contentModeById = (id: string | undefined): ContentModeMeta =>
  CONTENT_MODES.find((m) => m.id === id) ?? CONTENT_MODES[0];

export interface WhitemodelSourceMeta {
  id: WhitemodelSource;
  label: string;
  description: string;
}

export const WHITEMODEL_SOURCES: WhitemodelSourceMeta[] = [
  {
    id: 'director',
    label: '导演台录制',
    description: '3D 导演台摆机位后录制的白模视频，最可控',
  },
  {
    id: 'sora',
    label: 'Sora/外部生成',
    description: 'Sora 应用或其他视频模型生成的运镜参考视频，上传绑定',
  },
  {
    id: 'gpt6_code',
    label: 'GPT-6 场景代码',
    description: 'GPT-6（含 ChatGPT）生成的运镜序列 JSON，一键摆机位再录制',
  },
  {
    id: 'url',
    label: 'URL 登记',
    description: '已在线上的白模地址（R2V 直喂需要公网可拉取 URL）',
  },
];

/** 广告尾镜 CTA 启发式词表（QC 用，命中即视为有 CTA，不过度断言） */
export const CTA_KEYWORDS = [
  '购买', '下单', '点击', '领取', '试用', '链接', '咨询', '预约', '抢购',
  '优惠', '免费', '立即', '马上', 'Shop', 'Buy', 'Click', 'Link', 'CTA',
];
