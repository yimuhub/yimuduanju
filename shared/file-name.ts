/**
 * 导出文件名规范化（唯一真源）
 * ---------------------------------------------------------------------------
 * 需求：成片导出的文件名必须等于项目名 ——「项目叫什么，导出的文件就叫什么」。
 * 旧实现落 `final_<uuid8>.mp4`，用户下载到一堆 final_3e1a2b53.mp4，
 * 既认不出是哪个项目，也无法在素材箱里按名字找片。
 *
 * 但项目名是自然语言，直接当文件名会踩三类坑：
 *   ① 路径分隔符 / 反斜杠 → 会被当成子目录，文件写到别处甚至失败；
 *   ② Windows/macOS 非法字符 : * ? " < > | 与结尾的点/空格；
 *   ③ 控制字符与超长（HFS/APFS 单个组件上限 255 字节，中文标题很容易撞）。
 * 这里统一裁剪成「保留中文、去掉危险字符、限长」的形态，且是纯函数（可单测）。
 */

/** 路径分隔符：替换成短横，而不是直接删（删了会把两个词粘在一起） */
const PATH_SEP = /[/\\]/g;
/** 半角冒号替换成全角，尽量保住原名的标点观感（中文标题里很常见） */
const HALF_COLON = /:/g;
/** 其余跨平台非法字符与 URL 里有歧义的 % # ?，以及控制字符 */
const ILLEGAL = /[*?"<>|%#\u0000-\u001f\u007f]/g;

/** Windows 保留设备名，撞上会被系统拒绝（即便在 macOS 上导出，交付到 Windows 也会炸） */
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/**
 * 把任意标题压成安全的文件主名（不含扩展名）。
 * @param raw      原始标题（项目名）
 * @param fallback 标题为空/全是非法字符时的兜底名
 * @param maxLength 最大字符数（按码点计，默认 60，给扩展名与去重后缀留余量）
 */
export function sanitizeFileBase(
  raw: string | null | undefined,
  fallback = 'yimu-export',
  maxLength = 60,
): string {
  let name = (raw ?? '')
    // NFC：避免同一个字由「组合字符」拼成，导致同名文件被判成不同名
    .normalize('NFC')
    .replace(PATH_SEP, '-')
    .replace(HALF_COLON, '：')
    // 先把换行/制表/连续空白压成一个空格（顺序很重要：若先删控制字符，
    // 「第一行\n第二行」会被粘成「第一行第二行」）
    .replace(/\s+/g, ' ')
    .replace(ILLEGAL, '')
    // 结尾的点与空格在 Windows 上会被静默吞掉，直接去掉
    .replace(/^[\s.]+|[\s.]+$/g, '');

  if (RESERVED.test(name)) name = `${name}-export`;
  const chars = Array.from(name);
  if (chars.length > maxLength) {
    name = chars.slice(0, maxLength).join('').replace(/[\s.]+$/g, '');
  }
  return name || fallback;
}

/**
 * 项目名 → 导出成片文件名（含扩展名）。
 * 例：「唐朝甜宠番外二：李昭把琉璃灯…」→「唐朝甜宠番外二：李昭把琉璃灯….mp4」
 *     （全角冒号合法，保留；半角冒号会被剔除）
 */
export function projectExportFileName(
  title: string | null | undefined,
  ext = 'mp4',
  fallback = 'yimu-export',
): string {
  const base = sanitizeFileBase(title, fallback);
  return `${base}.${ext.replace(/^\.+/, '')}`;
}
