/**
 * 时间线体检（前后端共用，纯函数）
 * -------------------------------------------------------------
 * 目标：让 Agent 在改片前后都能回答「这条时间线现在能不能出片」，
 * 而不是改完才发现缺口、重叠、字幕越界。
 *
 * 分级：
 *   blocking — 必然出不了片或必然出错（缺源、同轨重叠、片段时长为 0）
 *   warning  — 能出片但结果会不对（字幕越界、画面有空隙、音画未绑定）
 *   info     — 只影响编辑体验（片段被停用、轨道为空）
 */
import type { TimelineClip, TimelineDocument } from './api.interface';

export type TimelineIssueSeverity = 'blocking' | 'warning' | 'info';

export interface TimelineIssue {
  code: string;
  severity: TimelineIssueSeverity;
  message: string;
  /** 相关片段业务键，便于 UI 高亮与 Agent 定位 */
  clipKeys: string[];
  /** 可选：建议动作，供 Agent 直接转成 op */
  suggestion?: string;
}

const EPS = 1e-4;

const span = (c: Pick<TimelineClip, 'inPoint' | 'outPoint' | 'speed'>): number =>
  Math.max(0, (c.outPoint - c.inPoint) / (c.speed > 0 ? c.speed : 1));

const keyOf = (c: TimelineClip): string => c.clientKey ?? c.id;

/** 体检一条时间线；不修改输入。 */
export function scanTimelineIssues(doc: TimelineDocument): TimelineIssue[] {
  const issues: TimelineIssue[] = [];
  const clips = doc.clips ?? [];

  // 1) 业务键重复：保存层有唯一约束，出现即说明客户端构造了脏数据
  const keyCount = new Map<string, number>();
  for (const c of clips) keyCount.set(keyOf(c), (keyCount.get(keyOf(c)) ?? 0) + 1);
  for (const [key, n] of keyCount) {
    if (n > 1) {
      issues.push({
        code: 'duplicate_client_key',
        severity: 'blocking',
        message: `片段标识 ${key} 出现 ${n} 次，保存会失败`,
        clipKeys: [key],
      });
    }
  }

  // 2) 片段自身合法性
  for (const c of clips) {
    const k = keyOf(c);
    const s = span(c);
    if (c.outPoint <= c.inPoint) {
      issues.push({
        code: 'invalid_trim',
        severity: 'blocking',
        message: `片段 ${k} 的出点必须大于入点`,
        clipKeys: [k],
        suggestion: '把 outPoint 调到 inPoint 之后，或删除该片段',
      });
    } else if (s < 0.1) {
      issues.push({
        code: 'clip_too_short',
        severity: 'warning',
        message: `片段 ${k} 只有 ${s.toFixed(3)}s，短于 0.1s`,
        clipKeys: [k],
      });
    }
    if (c.timelineStart < 0) {
      issues.push({
        code: 'negative_start',
        severity: 'blocking',
        message: `片段 ${k} 的起点为负（${c.timelineStart}s）`,
        clipKeys: [k],
      });
    }
    if (c.track === 'video' && !c.sourceUrl) {
      issues.push({
        code: 'missing_source',
        severity: 'blocking',
        message: `画面片段 ${k} 没有源素材`,
        clipKeys: [k],
        suggestion: '绑定 sourceUrl 或删除该片段',
      });
    }
    if (c.track === 'subtitle' && !String(c.text ?? '').trim()) {
      issues.push({
        code: 'empty_subtitle',
        severity: 'warning',
        message: `字幕片段 ${k} 没有文字`,
        clipKeys: [k],
      });
    }
    if (c.enabled === false && c.track === 'video') {
      issues.push({
        code: 'disabled_video',
        severity: 'info',
        message: `画面片段 ${k} 已停用，不会进入成片`,
        clipKeys: [k],
      });
    }
  }

  // 3) 同轨同层重叠：渲染时后一条会盖住前一条，或 concat 失败
  for (const track of ['video', 'audio', 'subtitle', 'overlay'] as const) {
    const byLane = new Map<number, TimelineClip[]>();
    for (const c of clips) {
      if (c.track !== track) continue;
      const lane = c.lane ?? 0;
      const list = byLane.get(lane) ?? [];
      list.push(c);
      byLane.set(lane, list);
    }
    for (const [lane, list] of byLane) {
      const sorted = [...list].sort((a, b) => a.timelineStart - b.timelineStart);
      for (let i = 1; i < sorted.length; i += 1) {
        const prev = sorted[i - 1];
        const cur = sorted[i];
        const prevEnd = prev.timelineStart + span(prev);
        if (prevEnd > cur.timelineStart + EPS) {
          issues.push({
            code: 'track_overlap',
            severity: 'blocking',
            message: `${track} 轨第 ${lane + 1} 层有片段重叠（${keyOf(prev)} 与 ${keyOf(cur)}）`,
            clipKeys: [keyOf(prev), keyOf(cur)],
            suggestion: '把后一条移到空层，或缩短前一条',
          });
        }
      }
    }
  }

  // 4) 字幕越界：字幕必须落在某条画面片段内，否则导出时会丢
  const videos = clips.filter((c) => c.track === 'video' && c.enabled !== false);
  if (videos.length > 0) {
    const ranges = videos.map((c) => [c.timelineStart, c.timelineStart + span(c)] as const);
    for (const c of clips) {
      if (c.track !== 'subtitle' || c.enabled === false) continue;
      const start = c.timelineStart;
      const end = start + span(c);
      const covered = ranges.some(([vs, ve]) => start >= vs - EPS && end <= ve + EPS);
      if (!covered) {
        issues.push({
          code: 'subtitle_out_of_range',
          severity: 'warning',
          message: `字幕片段 ${keyOf(c)} 超出画面轨范围，导出时可能丢失`,
          clipKeys: [keyOf(c)],
          suggestion: '把字幕移到画面片段内，或延长对应画面',
        });
      }
    }
  }

  // 5) 主画面轨空隙：允许，但提示 Agent 这会让成片出现黑场
  const main = clips
    .filter((c) => c.track === 'video' && (c.lane ?? 0) === 0 && c.enabled !== false)
    .sort((a, b) => a.timelineStart - b.timelineStart);
  for (let i = 1; i < main.length; i += 1) {
    const prevEnd = main[i - 1].timelineStart + span(main[i - 1]);
    const gap = main[i].timelineStart - prevEnd;
    if (gap > 0.2) {
      issues.push({
        code: 'main_gap',
        severity: 'warning',
        message: `主画面轨在 ${prevEnd.toFixed(2)}s 处有 ${gap.toFixed(2)}s 空隙，会黑场`,
        clipKeys: [keyOf(main[i - 1]), keyOf(main[i])],
        suggestion: '用 move 收紧，或插入黑场/转场素材',
      });
    }
  }

  // 6) 未绑定音画：声音与画面分开移动后容易错位
  const boundVideo = new Set(
    clips.filter((c) => c.track === 'video' && c.bindGroup).map((c) => c.bindGroup as string),
  );
  const boundAudio = new Set(
    clips.filter((c) => c.track === 'audio' && c.bindGroup).map((c) => c.bindGroup as string),
  );
  for (const g of boundVideo) {
    if (!boundAudio.has(g)) {
      issues.push({
        code: 'unbound_audio',
        severity: 'info',
        message: `画面绑定组 ${g} 没有对应的音频片段，声音可能与画面脱节`,
        clipKeys: [],
      });
    }
  }

  return issues;
}

/** 只保留 blocking，供导出/生成前快速判定。 */
export function blockingIssues(issues: TimelineIssue[]): TimelineIssue[] {
  return issues.filter((i) => i.severity === 'blocking');
}

/** 给 Agent 的紧凑文本；无问题时明确说“可出片”。 */
export function formatIssuesForAgent(issues: TimelineIssue[]): string {
  if (issues.length === 0) return '# 时间线体检：无阻断问题，可出片。';
  const order: Record<TimelineIssueSeverity, number> = { blocking: 0, warning: 1, info: 2 };
  const lines = [...issues]
    .sort((a, b) => order[a.severity] - order[b.severity])
    .slice(0, 40)
    .map(
      (i) =>
        `- [${i.severity}] ${i.code}：${i.message}` +
        (i.clipKeys.length ? `（片段：${i.clipKeys.join('、')}）` : '') +
        (i.suggestion ? `；建议：${i.suggestion}` : ''),
    );
  const counts = {
    blocking: issues.filter((i) => i.severity === 'blocking').length,
    warning: issues.filter((i) => i.severity === 'warning').length,
    info: issues.filter((i) => i.severity === 'info').length,
  };
  return `# 时间线体检（blocking ${counts.blocking} / warning ${counts.warning} / info ${counts.info}）\n${lines.join('\n')}`;
}
