/**
 * 系统日志服务：把「文件日志 + 结构化事件 + 数据库任务状态」汇成一个可查视图。
 * ------------------------------------------------------------------
 * - 文件日志：logs/server.log、trace.log、gateway.log 及其轮转文件，全量保留原始输出；
 *   读取只从文件尾部取一段（默认每文件 512KB），避免 10MB 轮转文件拖慢接口。
 * - 结构化事件：server/common/system-log.store.ts 记录的上游响应/任务失败/异常，
 *   带完整 detail，是「详细提示失败原因」的主要数据来源。
 * - 任务状态：generation_jobs.error_message 只有 500 字符，这里补上诊断与上下文。
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { and, desc, eq, sql } from 'drizzle-orm';
import { existsSync, statSync } from 'fs';
import { open, readdir, stat } from 'fs/promises';
import { join } from 'path';
import { generationJobs, projects } from '@server/database/schema';
import { uploadDir } from '../assets/upload-dir';
import {
  systemLog,
  systemLogDir,
  SYSTEM_EVENTS_FILE,
  type SystemLogEvent,
} from '../../common/system-log.store';
import { diagnoseError, type ErrorDiagnosis } from './diagnosis';

export interface LogFileInfo {
  name: string;
  size: number;
  modifiedAt: string;
  kind: 'server' | 'trace' | 'gateway' | 'events' | 'other';
}

export interface LogEntry {
  source: string;
  ts: string | null;
  level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'UNKNOWN';
  context: string | null;
  message: string;
  traceId: string | null;
  raw: string;
}

export interface EntriesQuery {
  file?: string;
  level?: string;
  q?: string;
  traceId?: string;
  since?: string;
  until?: string;
  limit?: number;
  maxBytesPerFile?: number;
}

export interface FailureItem {
  id: string;
  projectId: string | null;
  projectTitle: string | null;
  jobType: string;
  targetType: string | null;
  targetId: string | null;
  status: string;
  providerName: string | null;
  errorMessage: string | null;
  retryCount: number;
  createdAt: string | null;
  completedAt: string | null;
  diagnosis: ErrorDiagnosis;
}

const LEVELS = ['DEBUG', 'INFO', 'WARN', 'ERROR'] as const;

/** 日志可能含 API Key / Bearer / SQL 参数，出接口前统一脱敏 */
function redact(text: string): string {
  return text
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, 'Bearer ***')
    .replace(/\bsk-[A-Za-z0-9_-]{12,}/g, 'sk-***')
    .replace(/("?(?:api_key|apiKey|token|password|secret)"?\s*[:=]\s*")[^"]{6,}(")/gi, '$1***$2')
    .replace(/enc:v1:[A-Za-z0-9+/=]{20,}/g, 'enc:v1:***');
}

function levelFromText(text: string): LogEntry['level'] {
  if (/\bERROR\b|\bFATAL\b/i.test(text)) return 'ERROR';
  if (/\bWARN(ING)?\b/i.test(text)) return 'WARN';
  if (/\bDEBUG\b/i.test(text)) return 'DEBUG';
  if (/\bINFO\b|\bLOG\b/i.test(text)) return 'INFO';
  return 'UNKNOWN';
}

/** 一行日志 → 结构化条目；兼容平台 JSON 行与 Nest 纯文本行 */
export function parseLogLine(line: string, source: string, fallbackTs: string): LogEntry {
  const trimmed = line.trim();
  if (trimmed.startsWith('{')) {
    try {
      const obj = JSON.parse(trimmed) as Record<string, unknown>;
      const lvl = String(obj.level ?? obj.severity ?? '').toUpperCase();
      return {
        source,
        ts: typeof obj.time === 'string' ? obj.time : (typeof obj.ts === 'string' ? obj.ts : fallbackTs),
        level: (LEVELS as readonly string[]).includes(lvl) ? (lvl as LogEntry['level']) : levelFromText(trimmed),
        context: typeof obj.context === 'string' ? obj.context : null,
        message: redact(String(obj.message ?? obj.msg ?? trimmed).slice(0, 4000)),
        traceId: typeof obj.trace_id === 'string' ? obj.trace_id : null,
        raw: redact(trimmed.slice(0, 4000)),
      };
    } catch {
      // 不是完整 JSON（尾部截断行），按纯文本处理
    }
  }
  // Nest 文本格式：[Nest] 123  - 11/12/2026, 10:41:00 AM     LOG [Context] message
  const m = /^(?:\[Nest\]\s*\d+\s*-\s*[^[]*?)?\s*(LOG|ERROR|WARN|DEBUG)\s*(?:\[([^\]]+)\])?\s*(.*)$/.exec(trimmed);
  return {
    source,
    ts: fallbackTs,
    level: m ? levelFromText(m[1]) : levelFromText(trimmed),
    context: m?.[2] ?? null,
    message: redact((m?.[3] ?? trimmed).slice(0, 4000)),
    traceId: null,
    raw: redact(trimmed.slice(0, 4000)),
  };
}

/** 只读文件尾部，避免整文件载入内存 */
async function readTail(path: string, maxBytes: number): Promise<string[]> {
  const info = await stat(path).catch(() => null);
  if (!info || info.size === 0) return [];
  const length = Math.min(info.size, Math.max(16 * 1024, maxBytes));
  const start = info.size - length;
  const fh = await open(path, 'r');
  try {
    const buf = Buffer.alloc(length);
    const { bytesRead } = await fh.read(buf, 0, length, start);
    const text = buf.subarray(0, bytesRead).toString('utf8');
    const lines = text.split('\n');
    // 起点可能落在某一行中间：丢掉第一行残缺片段
    if (start > 0) lines.shift();
    return lines.filter((l) => l.trim().length > 0);
  } finally {
    await fh.close();
  }
}

function kindOf(name: string): LogFileInfo['kind'] {
  if (name.startsWith('server.log')) return 'server';
  if (name.startsWith('trace.log')) return 'trace';
  if (name.startsWith('gateway.log')) return 'gateway';
  if (name === SYSTEM_EVENTS_FILE) return 'events';
  return 'other';
}

@Injectable()
export class SystemLogsService {
  private readonly logger = new Logger(SystemLogsService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
  ) {}

  private dir(): string {
    return systemLogDir();
  }

  /** 文件名白名单：只允许 logs 目录下的 .log* / .jsonl，杜绝路径穿越 */
  private safeFile(name: string): string | null {
    if (!name || name.includes('/') || name.includes('\\') || name.includes('..')) return null;
    if (!/^[A-Za-z0-9._-]+\.(log|jsonl)(\.\d+)?$/.test(name)) return null;
    const p = join(this.dir(), name);
    return existsSync(p) ? p : null;
  }

  async files(): Promise<LogFileInfo[]> {
    const names = await readdir(this.dir()).catch(() => [] as string[]);
    const out: LogFileInfo[] = [];
    for (const name of names) {
      if (!/^[A-Za-z0-9._-]+\.(log|jsonl)(\.\d+)?$/.test(name)) continue;
      const p = join(this.dir(), name);
      const s = await stat(p).catch(() => null);
      if (!s) continue;
      out.push({
        name,
        size: s.size,
        modifiedAt: s.mtime.toISOString(),
        kind: kindOf(name),
      });
    }
    return out.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
  }

  async entries(query: EntriesQuery): Promise<{
    items: LogEntry[];
    scanned: number;
    files: string[];
    truncated: boolean;
  }> {
    const limit = Math.min(Math.max(query.limit ?? 200, 1), 2000);
    const perFile = Math.min(Math.max(query.maxBytesPerFile ?? 512 * 1024, 32 * 1024), 4 * 1024 * 1024);
    const all = await this.files();
    let targets: LogFileInfo[];
    if (!query.file || query.file === 'all') {
      // 默认全量：当前文件 + 最近的轮转文件，全部加起来仍受 perFile 上限约束
      targets = all;
    } else if (query.file === 'server' || query.file === 'trace' || query.file === 'gateway' || query.file === 'events') {
      targets = all.filter((f) => f.kind === query.file);
    } else {
      targets = all.filter((f) => f.name === query.file);
    }
    const q = query.q?.trim().toLowerCase();
    const since = query.since ? Date.parse(query.since) : Number.NaN;
    const until = query.until ? Date.parse(query.until) : Number.NaN;
    const items: LogEntry[] = [];
    let scanned = 0;
    for (const f of targets) {
      const lines = await readTail(join(this.dir(), f.name), perFile).catch((e: Error) => {
        this.logger.warn(`读取日志失败 ${f.name}：${e.message}`);
        return [] as string[];
      });
      for (const line of lines) {
        scanned += 1;
        const entry = parseLogLine(line, f.name, f.modifiedAt);
        const t = entry.ts ? Date.parse(entry.ts) : Number.NaN;
        if (Number.isFinite(since) && Number.isFinite(t) && t < since) continue;
        if (Number.isFinite(until) && Number.isFinite(t) && t > until) continue;
        if (query.level && query.level !== 'ALL' && entry.level !== query.level.toUpperCase()) continue;
        if (query.traceId && entry.traceId !== query.traceId) continue;
        if (q && !`${entry.message} ${entry.context ?? ''} ${entry.raw}`.toLowerCase().includes(q)) continue;
        items.push(entry);
      }
    }
    items.sort((a, b) => {
      const ta = a.ts ? Date.parse(a.ts) : 0;
      const tb = b.ts ? Date.parse(b.ts) : 0;
      return tb - ta;
    });
    return {
      items: items.slice(0, limit),
      scanned,
      files: targets.map((f) => f.name),
      truncated: items.length > limit,
    };
  }

  /** 结构化事件（内存 + 落盘文件），按时间倒序 */
  async events(filters: {
    level?: string;
    category?: string;
    q?: string;
    projectId?: string;
    jobId?: string;
    limit?: number;
  } = {}): Promise<SystemLogEvent[]> {
    const limit = Math.min(Math.max(filters.limit ?? 200, 1), 2000);
    const inMemory = systemLog.query({ ...filters, limit });
    // 重启后内存为空：从 events.jsonl 尾部补历史，合并去重（按 ts+message）
    const p = join(this.dir(), SYSTEM_EVENTS_FILE);
    const lines = existsSync(p) ? await readTail(p, 1024 * 1024) : [];
    const fromDisk: SystemLogEvent[] = [];
    for (const line of lines) {
      try {
        const obj = JSON.parse(line) as SystemLogEvent;
        if (obj && typeof obj.ts === 'string' && typeof obj.message === 'string') fromDisk.push(obj);
      } catch { /* 跳过残行 */ }
    }
    const seen = new Set<string>();
    const merged: SystemLogEvent[] = [];
    for (const e of [...inMemory, ...fromDisk.reverse()]) {
      const key = `${e.ts}|${e.message}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (filters.level && filters.level !== 'ALL' && e.level !== filters.level.toUpperCase()) continue;
      if (filters.category && e.category !== filters.category) continue;
      if (filters.projectId && e.projectId !== filters.projectId) continue;
      if (filters.jobId && e.jobId !== filters.jobId) continue;
      if (filters.q && !`${e.message} ${JSON.stringify(e.detail ?? {})}`.toLowerCase().includes(filters.q.toLowerCase())) continue;
      merged.push({ ...e, message: redact(e.message) });
      if (merged.length >= limit) break;
    }
    return merged.sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts));
  }

  /** 失败任务清单（含诊断） */
  async failures(query: {
    projectId?: string;
    q?: string;
    limit?: number;
  } = {}): Promise<{ items: FailureItem[]; total: number }> {
    const limit = Math.min(Math.max(query.limit ?? 100, 1), 500);
    const conditions = [eq(generationJobs.status, 'failed')];
    if (query.projectId) conditions.push(eq(generationJobs.projectId, query.projectId));
    if (query.q?.trim()) {
      conditions.push(sql`${generationJobs.errorMessage} ilike ${`%${query.q.trim()}%`}`);
    }
    const rows = await this.db
      .select({
        id: generationJobs.id,
        projectId: generationJobs.projectId,
        projectTitle: projects.title,
        jobType: generationJobs.jobType,
        targetType: generationJobs.targetType,
        targetId: generationJobs.targetId,
        status: generationJobs.status,
        providerName: generationJobs.providerName,
        errorMessage: generationJobs.errorMessage,
        retryCount: generationJobs.retryCount,
        createdAt: generationJobs.createdAt,
        completedAt: generationJobs.completedAt,
      })
      .from(generationJobs)
      .leftJoin(projects, eq(generationJobs.projectId, projects.id))
      .where(and(...conditions))
      .orderBy(desc(generationJobs.createdAt))
      .limit(limit);
    const countRows = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(generationJobs)
      .where(and(...conditions));
    return {
      items: rows.map((r) => ({
        ...r,
        createdAt: r.createdAt ? new Date(r.createdAt).toISOString() : null,
        completedAt: r.completedAt ? new Date(r.completedAt).toISOString() : null,
        diagnosis: diagnoseError(r.errorMessage),
      })),
      total: Number(countRows[0]?.n ?? rows.length),
    };
  }

  /** 单个任务的完整诊断：任务行 + 规则解释 + 关联事件 + 关联原始日志 + 参考图落盘检查 */
  async diagnose(jobId: string): Promise<{
    job: Record<string, unknown> | null;
    historicalError: string | null;
    diagnosis: ErrorDiagnosis;
    relatedEvents: SystemLogEvent[];
    relatedLogs: LogEntry[];
    referenceCheck: { path: string; exists: boolean; size?: number }[];
    suggestions: string[];
  }> {
    const rows = await this.db
      .select()
      .from(generationJobs)
      .where(eq(generationJobs.id, jobId))
      .limit(1);
    const row = rows[0];
    if (!row) {
      return {
        job: null,
        historicalError: null,
        diagnosis: diagnoseError(''),
        relatedEvents: [],
        relatedLogs: [],
        referenceCheck: [],
        suggestions: ['任务不存在或已被删除。'],
      };
    }
    const relatedEvents = await this.events({ jobId, limit: 100 });
    const relatedLogs = (await this.entries({ file: 'all', q: jobId, limit: 120, maxBytesPerFile: 256 * 1024 })).items;
    /* 任务被手动重试成功后 errorMessage 会被清空。此时仍要能回答「当初为什么失败」：
     * 依次从同一镜头的其它失败任务、结构化事件、原始日志里找回历史错误文本。 */
    let historicalError = row.errorMessage ?? '';
    if (!historicalError && row.targetId) {
      const siblings = await this.db
        .select({ errorMessage: generationJobs.errorMessage })
        .from(generationJobs)
        .where(and(eq(generationJobs.targetId, row.targetId), eq(generationJobs.status, 'failed')))
        .orderBy(desc(generationJobs.createdAt))
        .limit(1);
      historicalError = siblings[0]?.errorMessage ?? '';
    }
    if (!historicalError) {
      const fromEvent = relatedEvents.find(
        (e) => e.level === 'ERROR' && typeof e.detail?.errorMessage === 'string',
      );
      historicalError = (fromEvent?.detail?.errorMessage as string | undefined) ?? '';
    }
    if (!historicalError) {
      const fromLog = relatedLogs.find((l) =>
        /(生成失败|请求失败|被上游拒绝|Exception|ERROR)/i.test(l.message),
      );
      historicalError = fromLog?.message ?? '';
    }
    const diagnosis: ErrorDiagnosis = historicalError
      ? diagnoseError(historicalError)
      : row.status === 'succeeded'
        ? {
            code: 'ALREADY_RESOLVED',
            title: '该任务已重试成功',
            cause: '当前任务状态为成功；未找到可关联的原始失败文本（通常是修复前的历史任务，或日志已轮转出读取窗口）。',
            suggestions: [
              '同一镜头若还有失败任务，可在「失败诊断」里查看它们的完整原因。',
              '到「原始日志」按任务 ID 或镜头 ID 检索更早的轮转文件。',
            ],
            severity: 'warning',
            retryable: false,
          }
        : diagnoseError('');
    const refs = Array.isArray((row.inputData as { references?: unknown } | null)?.references)
      ? ((row.inputData as { references: unknown[] }).references.filter((r): r is string => typeof r === 'string'))
      : [];
    const referenceCheck = refs.slice(0, 12).map((path) => {
      if (!path.startsWith('/uploads/')) return { path, exists: false };
      const abs = join(uploadDir(), path.replace(/^\/uploads\//, ''));
      const exists = existsSync(abs);
      return exists ? { path, exists: true, size: statSync(abs).size } : { path, exists: false };
    });
    return {
      job: {
        ...row,
        createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : null,
        completedAt: row.completedAt ? new Date(row.completedAt).toISOString() : null,
      } as unknown as Record<string, unknown>,
      historicalError: historicalError || null,
      diagnosis,
      relatedEvents,
      relatedLogs,
      referenceCheck,
      suggestions: diagnosis.suggestions,
    };
  }

  /** 概览：给日志页顶部四个数字卡片 */
  async overview(): Promise<{
    logFiles: number;
    logBytes: number;
    structuredEvents: number;
    failedJobs24h: number;
    failedJobsTotal: number;
    topCauses: { code: string; title: string; count: number }[];
  }> {
    const fs = await this.files();
    const recent = await this.failures({ limit: 300 });
    const since = Date.now() - 24 * 60 * 60 * 1000;
    const failed24h = recent.items.filter((f) => f.completedAt && Date.parse(f.completedAt) >= since).length;
    const tally = new Map<string, { code: string; title: string; count: number }>();
    for (const f of recent.items) {
      const cur = tally.get(f.diagnosis.code);
      if (cur) cur.count += 1;
      else tally.set(f.diagnosis.code, { code: f.diagnosis.code, title: f.diagnosis.title, count: 1 });
    }
    return {
      logFiles: fs.length,
      logBytes: fs.reduce((s, f) => s + f.size, 0),
      structuredEvents: systemLog.size(),
      failedJobs24h: failed24h,
      failedJobsTotal: recent.total,
      topCauses: [...tally.values()].sort((a, b) => b.count - a.count).slice(0, 5),
    };
  }
}
