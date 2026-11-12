/**
 * 系统日志 · 结构化事件存储（单例，零 DI 依赖）
 * ------------------------------------------------------------------
 * 为什么需要它：文件日志（server.log / trace.log）是全量但难检索的，
 * 而生成任务的失败原因散落在「上游 HTTP 响应体」「job.error_message」
 * 「未捕获异常」三处，且 error_message 落库时被截断到 500 字符。
 * 这里在关键路径上记录一条结构化事件，保留**完整**上下文，供
 * /api/system-logs 与「系统日志」页面做筛选、聚合与诊断。
 *
 * 纪律：
 * - 纯内存环形缓冲（默认 4000 条）+ 追加写 logs/events.jsonl；
 * - 写盘失败绝不抛给业务（日志不能拖垮出片）；
 * - 单例通过模块级 export 共享，不需要在任何 Module 里注册 provider。
 */
import { appendFile, mkdir } from 'fs/promises';
import { join } from 'path';

export type SystemLogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

export type SystemLogCategory =
  | 'upstream'
  | 'job'
  | 'exception'
  | 'worker'
  | 'system';

export interface SystemLogEvent {
  /** ISO 时间 */
  ts: string;
  level: SystemLogLevel;
  category: SystemLogCategory;
  /** 一行人话摘要 */
  message: string;
  projectId?: string;
  jobId?: string;
  traceId?: string;
  provider?: string;
  httpStatus?: number;
  /** 完整上游响应 / 请求摘要 / stack，页面可展开查看 */
  detail?: Record<string, unknown>;
}

export function systemLogDir(): string {
  const custom = process.env.YIMU_LOG_DIR?.trim();
  return custom || join(process.cwd(), 'logs');
}

export const SYSTEM_EVENTS_FILE = 'events.jsonl';

class SystemLogStore {
  private readonly buffer: SystemLogEvent[] = [];
  private readonly capacity = 4000;
  private writeChain: Promise<void> = Promise.resolve();
  private warned = false;

  record(input: Omit<SystemLogEvent, 'ts'> & { ts?: string }): void {
    const event: SystemLogEvent = {
      ts: input.ts ?? new Date().toISOString(),
      level: input.level,
      category: input.category,
      message: input.message,
      ...(input.projectId ? { projectId: input.projectId } : {}),
      ...(input.jobId ? { jobId: input.jobId } : {}),
      ...(input.traceId ? { traceId: input.traceId } : {}),
      ...(input.provider ? { provider: input.provider } : {}),
      ...(typeof input.httpStatus === 'number' ? { httpStatus: input.httpStatus } : {}),
      ...(input.detail ? { detail: input.detail } : {}),
    };
    this.buffer.push(event);
    if (this.buffer.length > this.capacity) {
      this.buffer.splice(0, this.buffer.length - this.capacity);
    }
    this.persist(event);
  }

  private persist(event: SystemLogEvent): void {
    // 串行追加，避免并发写造成行交错；失败只静默降级为「内存可见」
    this.writeChain = this.writeChain
      .then(async () => {
        const dir = systemLogDir();
        await mkdir(dir, { recursive: true });
        await appendFile(join(dir, SYSTEM_EVENTS_FILE), `${JSON.stringify(event)}\n`, 'utf8');
      })
      .catch(() => {
        if (!this.warned) {
          this.warned = true;
          // eslint-disable-next-line no-console
          console.warn('[SystemLog] events.jsonl 写入失败，结构化事件仅在内存中可见');
        }
      });
  }

  /** 内存查询：时间倒序，支持级别/分类/关键字/项目/任务/时间窗 */
  query(filters: {
    level?: string;
    category?: string;
    q?: string;
    projectId?: string;
    jobId?: string;
    since?: string;
    until?: string;
    limit?: number;
  } = {}): SystemLogEvent[] {
    const q = filters.q?.trim().toLowerCase();
    const since = filters.since ? Date.parse(filters.since) : Number.NaN;
    const until = filters.until ? Date.parse(filters.until) : Number.NaN;
    const out: SystemLogEvent[] = [];
    for (let i = this.buffer.length - 1; i >= 0; i -= 1) {
      const e = this.buffer[i];
      const t = Date.parse(e.ts);
      if (Number.isFinite(since) && t < since) continue;
      if (Number.isFinite(until) && t > until) continue;
      if (filters.level && e.level !== filters.level.toUpperCase()) continue;
      if (filters.category && e.category !== filters.category) continue;
      if (filters.projectId && e.projectId !== filters.projectId) continue;
      if (filters.jobId && e.jobId !== filters.jobId) continue;
      if (q) {
        const hay = `${e.message} ${e.provider ?? ''} ${e.jobId ?? ''} ${JSON.stringify(e.detail ?? {})}`.toLowerCase();
        if (!hay.includes(q)) continue;
      }
      out.push(e);
      if (out.length >= (filters.limit ?? 200)) break;
    }
    return out;
  }

  size(): number {
    return this.buffer.length;
  }
}

/** 进程内唯一实例 */
export const systemLog = new SystemLogStore();
