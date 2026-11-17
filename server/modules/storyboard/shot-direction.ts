/**
 * Pavo 式分镜导演字段 —— 全产线唯一真源。
 *
 * 为什么独立成模块：
 * 分镜有两条物化路径（模型 boards / 本地 parse_script 启发式），历史上各自
 * 拼一句 visualPrompt，导致同一个平台里「模型分镜很详细、本地拆分只有一句话」。
 * 任何新增物化路径都必须调用 buildShotDirection()，不允许再各自拼字符串。
 */

export interface ShotDirectionInput {
  shotTitle?: string;
  rawVisual?: string;
  dialogue?: string;
  speaker?: string;
  tone?: string;
  soundDesign?: string;
  continuityNote?: string;
  negativePrompt?: string;
  shotSize?: string;
  cameraAngle?: string;
  lens?: string;
  movement?: string;
  sceneEnv?: Record<string, string>;
  shotNumber?: number;
}

export interface ShotDirection {
  title: string;
  speaker: string;
  tone: string;
  soundDesign: string;
  continuityNote: string;
  negativePrompt: string;
  shotSize: string;
  cameraAngle: string;
  lens: string;
  movement: string;
}

const SIZE_LABEL: Record<string, string> = {
  extreme_close_up: '大特写',
  close_up: '特写',
  medium_close_up: '近景',
  medium: '中景',
  wide: '全景',
  long: '远景',
};

const ANGLE_LABEL: Record<string, string> = {
  eye_level: '平视',
  high_angle: '俯拍',
  low_angle: '仰拍',
  overhead: '顶拍',
  dutch: '斜角',
};

const MOVE_LABEL: Record<string, string> = {
  static: '固定机位',
  pan: '横摇',
  zoom: '推拉变焦',
  dolly: '轨道推入',
  follow: '跟拍',
  retreat: '拉远',
  orbit: '环绕',
  crane: '升降',
  aerial: '航拍',
  pov: '主观视角',
};

const DEFAULT_NEGATIVE =
  '画面文字、字幕、水印、logo、手指畸形、多余肢体、换脸、人物数量错误、现代物件、低清噪点';

function envSentence(env?: Record<string, string>): string {
  if (!env) return '';
  const parts = [
    env.place ? `场景：${env.place}` : '',
    env.timeOfDay ? `时间：${env.timeOfDay}` : '',
    env.weather ? `天气：${env.weather}` : '',
    env.lightSource ? `光源：${env.lightSource}` : '',
    env.lightDirection ? `光向：${env.lightDirection}` : '',
    env.colorPalette ? `色彩：${env.colorPalette}` : '',
    env.atmosphere ? `氛围：${env.atmosphere}` : '',
  ].filter(Boolean);
  return parts.length > 0 ? `${parts.join('；')}。` : '';
}

/**
 * 生成一段 120 字以上的可拍导演描述，并返回结构化字段。
 * 已有详细描述（≥120 字）时只做补齐，不推翻用户/模型写好的内容。
 */
export function buildShotDirection(input: ShotDirectionInput): {
  visualPrompt: string;
  dialogueLine: string;
  direction: ShotDirection;
} {
  const raw = (input.rawVisual ?? '').trim();
  const size = SIZE_LABEL[input.shotSize ?? 'medium'] ?? '中景';
  const angle = ANGLE_LABEL[input.cameraAngle ?? 'eye_level'] ?? '平视';
  const lens = input.lens || '50mm';
  const move = MOVE_LABEL[input.movement ?? 'static'] ?? '固定机位';
  const title = (input.shotTitle ?? '').trim() || `镜 ${input.shotNumber ?? ''}`.trim();
  const speaker = (input.speaker ?? '').trim();
  const tone = (input.tone ?? '').trim();
  const soundDesign =
    (input.soundDesign ?? '').trim() ||
    '环境音延续上一镜，BGM 压低不抢台词，主体动作带轻微拟音（脚步/衣料/呼吸）';
  const continuityNote =
    (input.continuityNote ?? '').trim() ||
    '人物服装、发型、道具持握手、场景光线方向与上一镜保持一致，时间不跳变';
  const negativePrompt = (input.negativePrompt ?? '').trim() || DEFAULT_NEGATIVE;

  let visualPrompt = raw;
  if (visualPrompt.length < 120) {
    const body = raw
      ? `${raw.replace(/[。；;\s]+$/g, '')}。`
      : '主体在画面中完成一个明确的动作。';
    visualPrompt =
      `${size}，${angle}机位，${lens}，${move}。${body}` +
      `${envSentence(input.sceneEnv)}` +
      `动作从起势、过程到落点完整呈现，主体表情与手部细节清晰可见；` +
      `光线保持统一方向与色温，暗部保留层次，画面维持电影级质感；` +
      `镜头最后稳在主体面部或关键道具上，并与下一镜留出动作衔接。`;
  }

  visualPrompt = [
    title ? `【${title}】` : '',
    visualPrompt,
    `声音设计：${soundDesign}`,
    `连续性：${continuityNote}`,
  ]
    .filter(Boolean)
    .join('\n');

  const dialogueLine = input.dialogue
    ? speaker && speaker !== '无'
      ? `${speaker}${tone ? `（${tone}）` : ''}：${input.dialogue}`
      : input.dialogue
    : '';

  return {
    visualPrompt,
    dialogueLine,
    direction: {
      title,
      speaker: speaker || (input.dialogue ? '旁白' : '无'),
      tone,
      soundDesign,
      continuityNote,
      negativePrompt,
      shotSize: input.shotSize ?? 'medium',
      cameraAngle: input.cameraAngle ?? 'eye_level',
      lens,
      movement: input.movement ?? 'static',
    },
  };
}
