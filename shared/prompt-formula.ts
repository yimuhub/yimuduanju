/**
 * 五段式视频 prompt 公式（移植 AdForge prompts.py:66-82）
 * ------------------------------------------------------------------
 * [Cinematography] + [Subject] + [Action] + [Context] + [Style & Ambiance]，
 * 单段落、无 markdown。AdForge 要求 60-150 英词；中文 prompt 不适用词数，
 * 只保留结构与“风格圣经逐字复用”纪律（prompts.py:74-75）。
 */

export interface FivePartInput {
  cinematography?: string;
  subject?: string;
  action?: string;
  context?: string;
  style?: string;
}

export function buildFivePart(input: FivePartInput): string {
  return [
    input.cinematography,
    input.subject,
    input.action,
    input.context,
    input.style,
  ]
    .map((s) => (s ?? '').trim().replace(/\s+/g, ' '))
    .filter((s) => s.length > 0)
    .join('。');
}

/**
 * 通用负面约束（移植 YouPipe short_drama.py:28，seedance-skill 铁律 4：
 * 负面约束必须具体到错误品类，不写“低质量”这种空话）。
 * 网关视频接口无 negative 字段，拼进 prompt 正文声明。
 */
export const CINEMATIC_NEGATIVE =
  '避免：人物形变、多余手指、面部扭曲、画面闪烁、果冻形变、模糊低清、水印、凭空出现的文字字幕、白模塑料质感、无意义的教学拆解与箭头标签';

export interface StyleBibleLike {
  visualStyle?: string;
  cameraLanguage?: string;
  colorPalette?: string;
  lighting?: string;
  texture?: string;
  motionLanguage?: string;
}

/** 风格圣经 → Style 段：有料才拼，无圣经时返回空（不编造） */
export function styleBibleToStyle(bible?: StyleBibleLike | null): string {
  if (!bible) return '';
  return [
    bible.visualStyle,
    bible.colorPalette,
    bible.lighting,
    bible.texture,
    bible.motionLanguage,
  ]
    .map((s) => (s ?? '').trim())
    .filter((s) => s.length > 0)
    .join('，');
}
