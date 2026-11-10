import type { ProjectStatus } from '@shared/api.interface';

export interface ProjectStatusMeta {
  cls: 'ok' | 'run' | 'warn' | 'idle';
  text: string;
}

/** 项目状态 → 徽标样式与文案（左轨、工作台共用，避免两处文案漂移） */
export function projectStatusMeta(status: ProjectStatus): ProjectStatusMeta {
  switch (status) {
    case 'video_generating':
    case 'assets_generating':
    case 'audio_generating':
    case 'parsing':
    case 'planning':
    case 'editing':
      return { cls: 'run', text: '生产中' };
    case 'bible_ready':
      return { cls: 'idle', text: '设定就绪' };
    case 'storyboard_ready':
      return { cls: 'ok', text: '分镜就绪' };
    case 'qc':
      return { cls: 'warn', text: '质检中' };
    case 'ready':
      return { cls: 'ok', text: '成片就绪' };
    case 'exported':
      return { cls: 'ok', text: '已导出' };
    case 'failed':
      return { cls: 'warn', text: '失败' };
    default:
      return { cls: 'idle', text: '草稿' };
  }
}

/** 未完结、可以继续推进的状态（工作台「继续创作」列表） */
export const ACTIVE_STATUSES: ProjectStatus[] = [
  'parsing',
  'planning',
  'bible_ready',
  'storyboard_ready',
  'assets_generating',
  'video_generating',
  'audio_generating',
  'editing',
  'qc',
];

/** 后台正在跑、无需用户操作的状态 */
export const RUNNING_STATUSES: ProjectStatus[] = [
  'parsing',
  'planning',
  'assets_generating',
  'video_generating',
  'audio_generating',
  'editing',
];

/** 需要用户点确认 / 处理的状态集合 */
export const PENDING_STATUSES: ProjectStatus[] = ['bible_ready', 'storyboard_ready', 'qc'];

export const READY_STATUSES: ProjectStatus[] = ['ready', 'exported'];
