/**
 * 提示词模板库（migration 0025）：用户可复用的提示词片段目录。
 * ---------------------------------------------------------------------------
 * 数据源两级：
 *  1) 内置经验目录（BUILTIN_PROMPT_TEMPLATES）：构图/光位/氛围/运镜等高频片段，
 *     零网络依赖，离线可用；
 *  2) 技能库（GET /api/skills，3.0 harness 化体系）：把已启用技能的 body 暴露成
 *     模板片段——用户在技能库里编辑过的提示词口径在这里直接复用。
 * 前端在分镜聚焦编辑器与作战室输入框提供「插入模板」按钮，从目录选择片段
 * 插入当前光标位置。
 */
import { skills as skillsApi } from '@client/src/api';

export interface PromptTemplate {
  id: string;
  name: string;
  /** 插入到光标位置的片段正文 */
  body: string;
  /** 来源：builtin=内置经验目录；skill=技能库（用户可编辑复用） */
  source: 'builtin' | 'skill';
  /** 技能线（skill 来源时的分组展示用） */
  group?: string;
}

const T = (id: string, name: string, body: string): PromptTemplate => ({ id, name, body, source: 'builtin' });

/** 内置经验目录：短剧分镜提示词高频片段（摄影机能记录的物理事实口径） */
export const BUILTIN_PROMPT_TEMPLATES: PromptTemplate[] = [
  T('comp-rule-of-thirds', '构图 · 三分法', '【构图】三分法构图，主体位于画面右侧三分线交点，前景保留轻微虚化遮挡物增加纵深'),
  T('comp-center-symmetry', '构图 · 中心对称', '【构图】中心对称构图，主体居于画面中轴，背景元素左右均衡'),
  T('light-backlit-dusk', '光位 · 黄金时刻逆光', '【光线】黄昏黄金时刻，主光源为画面后侧低角度暖阳，人物轮廓带金色边缘光，硬边长阴影拖向镜头'),
  T('light-neon-rain', '氛围 · 雨夜霓虹', '【氛围】雨夜街景，霓虹招牌在湿漉路面上形成彩色倒影，空气中有雨雾，光束边缘可见浮尘'),
  T('light-window-soft', '光位 · 窗光柔和', '【光线】室内白天，主光源为画面左侧大窗柔光，光质柔和，人物面部明暗过渡平缓，浅景深虚化窗外'),
  T('move-push-in', '运镜 · 缓慢推近', '【运镜】机位从全景缓慢匀速推近至近景，运动平滑无抖动，落点停在人物面部微表情'),
  T('move-handheld-follow', '运镜 · 手持跟拍', '【运镜】手持跟拍，机位随人物行进轻微晃动，呼吸感明显，保持人物肩部以上在画面内'),
  T('sfx-ambient-design', '声场 · 环境音设计', '【声场】环境音：远处车流低频声、室内空调嗡鸣、主角脚步与衣料摩擦声，无配乐'),
];

/** 技能库 body 过长时截断（模板片段应是可插入的短语，不是整篇技能文） */
const SKILL_BODY_MAX = 600;

/** 拉取模板目录：内置 + 技能库（失败时静默回落内置，不阻断编辑） */
export async function fetchPromptTemplates(): Promise<PromptTemplate[]> {
  const builtin = [...BUILTIN_PROMPT_TEMPLATES];
  try {
    const list = await skillsApi.listSkills();
    const fromSkills = (list ?? [])
      .filter((s) => s.enabled && s.body?.trim())
      .map((s) => ({
        id: `skill-${s.slug}`,
        name: s.name,
        body: s.body.trim().slice(0, SKILL_BODY_MAX),
        source: 'skill' as const,
        group: s.line,
      }));
    return [...builtin, ...fromSkills];
  } catch {
    return builtin;
  }
}

/** 把片段插入 textarea/input 的光标位置（无选区时插入在光标处，选中时替换选区） */
export function insertAtCursor(
  el: HTMLTextAreaElement | HTMLInputElement | null,
  text: string,
  current: string,
  onChange: (next: string) => void,
): void {
  if (!el) {
    onChange(`${current}${text}`);
    return;
  }
  const start = el.selectionStart ?? current.length;
  const end = el.selectionEnd ?? current.length;
  const next = `${current.slice(0, start)}${text}${current.slice(end)}`;
  onChange(next);
  requestAnimationFrame(() => {
    el.focus();
    const pos = start + text.length;
    el.setSelectionRange(pos, pos);
  });
}
