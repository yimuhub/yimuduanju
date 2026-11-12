/**
 * 系统日志 · 全量日志读取 + 失败任务诊断
 * ------------------------------------------------------------------
 * 设计目标：用户遇到「某个项目一直生成失败」时，不用再翻几十 MB 文本日志。
 * 这里把三类来源汇到同一页：
 *   ① 原始文件日志（server/trace/gateway 及轮转文件，可按级别/关键字/文件筛）
 *   ② 结构化事件（上游完整响应、任务失败、未捕获异常，可展开 detail）
 *   ③ 失败任务清单（自动翻译成中文原因与可执行建议，可展开完整链路）
 * 视觉沿用 Studio Graphite：发丝线 + 底色深浅差，不用渐变/毛玻璃/上浮缩放。
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Activity,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  Filter,
  Info,
  RefreshCw,
  Search,
  ShieldAlert,
  Terminal,
  X,
} from 'lucide-react';
import {
  systemLogsApi,
  type DiagnoseResponse,
  type FailureItem,
  type LogEntry,
  type LogFileInfo,
  type LogLevel,
  type LogOverview,
  type SystemLogEvent,
} from '@client/src/api/systemLogs';

type Tab = 'failures' | 'raw' | 'events';

const LEVEL_COLORS: Record<LogLevel, string> = {
  ERROR: 'var(--brand-hi)',
  WARN: 'var(--warn)',
  INFO: 'var(--fg-2)',
  DEBUG: 'var(--fg-4)',
  UNKNOWN: 'var(--fg-3)',
};

const fmtTime = (s: string | null | undefined) => {
  if (!s) return '—';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString('zh-CN', { hour12: false });
};

const fmtBytes = (n: number) => {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
};

const STYLES = `
.syslog { display:flex; flex-direction:column; gap:14px; height:100%; min-height:0; color:var(--fg); font-family:var(--sans); }
.syslog-head { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; }
.syslog-title { font-size:17px; font-weight:600; letter-spacing:-.01em; margin:0; }
.syslog-sub { font-size:12px; color:var(--fg-3); margin-top:5px; line-height:1.6; }
.syslog-actions { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
.syslog-btn { display:inline-flex; align-items:center; gap:6px; height:30px; padding:0 11px; border:1px solid var(--line-strong); background:var(--bg-panel); color:var(--fg-2); border-radius:var(--r-sm); font-size:12px; cursor:pointer; }
.syslog-btn:hover { background:var(--bg-hover); color:var(--fg); }
.syslog-btn.on { border-color:var(--brand-line); color:var(--brand-hi); background:var(--brand-soft); }
.syslog-btn:disabled { opacity:.5; cursor:default; }
.syslog-cards { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:1px; background:var(--line); border:1px solid var(--line); border-radius:var(--r-md); overflow:hidden; }
.syslog-card { background:var(--bg-panel); padding:12px 14px; }
.syslog-card .k { font-size:11px; color:var(--fg-3); letter-spacing:.02em; }
.syslog-card .v { font-family:var(--mono); font-variant-numeric:tabular-nums; font-size:20px; margin-top:6px; }
.syslog-card .v.err { color:var(--brand-hi); }
.syslog-causes { display:flex; gap:8px; flex-wrap:wrap; align-items:center; font-size:11px; color:var(--fg-3); }
.syslog-cause { border:1px solid var(--line); background:var(--bg-inset); padding:4px 8px; border-radius:var(--r-xs); }
.syslog-tabs { display:flex; gap:2px; border-bottom:1px solid var(--line); }
.syslog-tab { padding:8px 14px; font-size:12px; color:var(--fg-3); cursor:pointer; border:0; background:transparent; border-bottom:2px solid transparent; }
.syslog-tab:hover { color:var(--fg-2); }
.syslog-tab.on { color:var(--fg); border-bottom-color:var(--brand); }
.syslog-filters { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
.syslog-input, .syslog-select { height:30px; background:var(--bg-inset); border:1px solid var(--line); color:var(--fg-2); border-radius:var(--r-sm); padding:0 9px; font-size:12px; font-family:var(--sans); outline:none; }
.syslog-input:focus, .syslog-select:focus { border-color:var(--line-strong); }
.syslog-input { min-width:190px; }
.syslog-input.short { min-width:110px; }
.syslog-select option { background:var(--bg-panel); }
.syslog-list { border:1px solid var(--line); border-radius:var(--r-md); background:var(--bg-inset); overflow:auto; min-height:220px; max-height:calc(100vh - 390px); }
.syslog-row { border-bottom:1px solid var(--line); }
.syslog-row:last-child { border-bottom:0; }
.syslog-row-head { display:flex; gap:10px; align-items:flex-start; padding:10px 12px; cursor:pointer; }
.syslog-row-head:hover { background:var(--bg-hover); }
.syslog-badge { flex:none; font-family:var(--mono); font-size:10px; padding:2px 6px; border:1px solid var(--line-strong); border-radius:var(--r-xs); color:var(--fg-3); }
.syslog-badge.err { color:var(--brand-hi); border-color:var(--brand-line); }
.syslog-badge.warn { color:var(--warn); }
.syslog-row-body { flex:1; min-width:0; }
.syslog-row-title { font-size:12px; color:var(--fg); line-height:1.5; display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
.syslog-row-meta { font-size:11px; color:var(--fg-4); margin-top:4px; font-family:var(--mono); }
.syslog-row-msg { font-size:11px; color:var(--fg-3); margin-top:5px; font-family:var(--mono); word-break:break-all; line-height:1.5; }
.syslog-detail { padding:12px 14px 16px 34px; background:var(--bg-panel); border-top:1px solid var(--line); }
.syslog-sec { margin-bottom:14px; }
.syslog-sec h4 { font-size:11px; color:var(--fg-3); font-weight:600; letter-spacing:.04em; margin:0 0 7px; text-transform:uppercase; }
.syslog-sec p { font-size:12px; color:var(--fg-2); line-height:1.75; margin:0; }
.syslog-sec ul { margin:0; padding-left:18px; }
.syslog-sec li { font-size:12px; color:var(--fg-2); line-height:1.75; }
.syslog-pre { font-family:var(--mono); font-size:11px; color:var(--fg-2); background:var(--bg-inset); border:1px solid var(--line); border-radius:var(--r-sm); padding:9px 11px; white-space:pre-wrap; word-break:break-all; line-height:1.55; max-height:260px; overflow:auto; margin:0; }
.syslog-logline { display:flex; gap:10px; padding:5px 12px; border-bottom:1px solid var(--line); font-family:var(--mono); font-size:11px; line-height:1.55; }
.syslog-logline:hover { background:var(--bg-hover); }
.syslog-logline .t { color:var(--fg-4); flex:none; }
.syslog-logline .lv { flex:none; width:52px; font-weight:600; }
.syslog-logline .src { color:var(--fg-4); flex:none; max-width:130px; overflow:hidden; text-overflow:ellipsis; }
.syslog-logline .m { color:var(--fg-2); word-break:break-word; white-space:pre-wrap; }
.syslog-empty { padding:36px 16px; text-align:center; color:var(--fg-4); font-size:12px; }
.syslog-hint { font-size:11px; color:var(--fg-4); }
.syslog-loading { opacity:.6; }
@media (max-width:900px) { .syslog-cards { grid-template-columns:repeat(2,minmax(0,1fr)); } }
`;

const Badge = ({ text, tone }: { text: string; tone?: 'err' | 'warn' }) => (
  <span className={`syslog-badge${tone ? ` ${tone}` : ''}`}>{text}</span>
);

const Section = ({ title, children }: { title: string; children: ReactNode }) => (
  <div className="syslog-sec">
    <h4>{title}</h4>
    {children}
  </div>
);

const SystemLogsPage = () => {
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState<Tab>('failures');
  const [overview, setOverview] = useState<LogOverview | null>(null);
  const [files, setFiles] = useState<LogFileInfo[]>([]);
  const [failures, setFailures] = useState<FailureItem[]>([]);
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [events, setEvents] = useState<SystemLogEvent[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [diagnoseMap, setDiagnoseMap] = useState<Record<string, DiagnoseResponse>>({});
  const [loading, setLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 筛选条件
  const [q, setQ] = useState('');
  const [projectId, setProjectId] = useState('');
  const [level, setLevel] = useState('ALL');
  const [file, setFile] = useState('all');
  const [limit, setLimit] = useState(300);
  const [category, setCategory] = useState('ALL');

  const jobIdFromUrl = params.get('jobId');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [ov, fs, fl, en, ev] = await Promise.all([
        systemLogsApi.overview().catch(() => null),
        systemLogsApi.files().catch(() => [] as LogFileInfo[]),
        systemLogsApi.failures({ projectId: projectId || undefined, q: q || undefined, limit: 200 }),
        systemLogsApi.entries({ file, level, q: q || undefined, limit }),
        systemLogsApi.events({ level: level === 'ALL' ? undefined : level, category: category === 'ALL' ? undefined : category, q: q || undefined, limit }),
      ]);
      setOverview(ov);
      setFiles(fs);
      setFailures(fl.items);
      setEntries(en.items);
      setEvents(ev);
    } catch (e) {
      setError((e as Error)?.message ?? '加载日志失败');
    } finally {
      setLoading(false);
    }
  }, [projectId, q, level, file, limit, category]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!autoRefresh) return;
    const t = window.setInterval(() => void load(), 15000);
    return () => window.clearInterval(t);
  }, [autoRefresh, load]);

  // ?jobId=xxx：直接打开该任务的诊断详情（供任务页「查看日志」跳转）
  useEffect(() => {
    if (!jobIdFromUrl) return;
    setTab('failures');
    void openDetail(jobIdFromUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobIdFromUrl]);

  const openDetail = async (jobId: string) => {
    if (expanded === jobId) {
      setExpanded(null);
      return;
    }
    setExpanded(jobId);
    if (diagnoseMap[jobId]) return;
    try {
      const d = await systemLogsApi.diagnose(jobId);
      setDiagnoseMap((m) => ({ ...m, [jobId]: d }));
    } catch (e) {
      setDiagnoseMap((m) => ({
        ...m,
        [jobId]: {
          job: null,
          historicalError: null,
          diagnosis: {
            code: 'API_ERROR',
            title: '诊断接口调用失败',
            cause: (e as Error)?.message ?? '未知错误',
            suggestions: ['确认后端服务已启动并包含 /api/system-logs 路由。'],
            severity: 'error',
            retryable: true,
          },
          relatedEvents: [],
          relatedLogs: [],
          referenceCheck: [],
          suggestions: [],
        },
      }));
    }
  };

  const exportCurrent = () => {
    const lines: string[] = [`一幕 · 系统日志导出 ${new Date().toISOString()}`, `视图：${tab}`, ''];
    if (tab === 'raw') {
      for (const e of entries) lines.push(`[${e.ts ?? '-'}] [${e.level}] [${e.source}] ${e.message}`);
    } else if (tab === 'events') {
      for (const e of events) lines.push(`[${e.ts}] [${e.level}] [${e.category}] ${e.message}\n${JSON.stringify(e.detail ?? {})}`);
    } else {
      for (const f of displayFailures) {
        lines.push(`[${f.completedAt ?? f.createdAt ?? '-'}] ${f.projectTitle ?? '-'} / ${f.jobType} / ${f.diagnosis.code}\n${f.errorMessage ?? ''}\n原因：${f.diagnosis.cause}\n`);
      }
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `yimu-system-logs-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  /**
   * ?jobId= 直达时，该任务可能已经被重试成功、不在「失败清单」里。
   * 用 diagnose 返回的 job 行补一条置顶卡片，保证深链永远能看到诊断详情。
   */
  const displayFailures = useMemo<FailureItem[]>(() => {
    if (!jobIdFromUrl || failures.some((f) => f.id === jobIdFromUrl)) return failures;
    const d = diagnoseMap[jobIdFromUrl];
    if (!d?.job) return failures;
    const j = d.job;
    const str = (v: unknown) => (typeof v === 'string' ? v : null);
    const extra: FailureItem = {
      id: jobIdFromUrl,
      projectId: str(j.projectId),
      projectTitle: null,
      jobType: str(j.jobType) ?? 'image',
      targetType: str(j.targetType),
      targetId: str(j.targetId),
      status: str(j.status) ?? 'unknown',
      providerName: str(j.providerName),
      errorMessage: d.historicalError ?? str(j.errorMessage),
      retryCount: typeof j.retryCount === 'number' ? j.retryCount : 0,
      createdAt: str(j.createdAt),
      completedAt: str(j.completedAt),
      diagnosis: d.diagnosis,
    };
    return [extra, ...failures];
  }, [failures, jobIdFromUrl, diagnoseMap]);

  const countLabel = useMemo(() => {
    if (tab === 'raw') return `${entries.length} 条日志`;
    if (tab === 'events') return `${events.length} 条事件`;
    return `${displayFailures.length} 个失败任务`;
  }, [tab, entries.length, events.length, displayFailures.length]);

  const fileOptions = useMemo(() => {
    const base = [
      { value: 'all', label: '全部日志' },
      { value: 'server', label: '服务日志 (server.log*)' },
      { value: 'trace', label: '链路日志 (trace.log*)' },
      { value: 'gateway', label: '网关日志 (gateway.log*)' },
      { value: 'events', label: '结构化事件 (events.jsonl)' },
    ];
    return [...base, ...files.map((f) => ({ value: f.name, label: `${f.name} · ${fmtBytes(f.size)}` }))];
  }, [files]);

  return (
    <div className="syslog">
      <style>{STYLES}</style>
      <div className="syslog-head">
        <div>
          <h1 className="syslog-title">系统日志</h1>
          <div className="syslog-sub">
            读取全部服务日志、结构化事件与生成任务失败记录；每条失败都附带具体原因与处理建议。
          </div>
        </div>
        <div className="syslog-actions">
          <button className={`syslog-btn${autoRefresh ? ' on' : ''}`} onClick={() => setAutoRefresh((v) => !v)} title="每 15 秒自动刷新">
            <Activity size={13} /> {autoRefresh ? '自动刷新中' : '自动刷新'}
          </button>
          <button className="syslog-btn" onClick={() => void load()} disabled={loading}>
            <RefreshCw size={13} /> 刷新
          </button>
          <button className="syslog-btn" onClick={exportCurrent}>
            <Download size={13} /> 导出当前
          </button>
        </div>
      </div>

      <div className="syslog-cards">
        <div className="syslog-card"><div className="k">日志文件</div><div className="v">{overview?.logFiles ?? '—'}</div></div>
        <div className="syslog-card"><div className="k">日志体积</div><div className="v">{overview ? fmtBytes(overview.logBytes) : '—'}</div></div>
        <div className="syslog-card"><div className="k">结构化事件（内存）</div><div className="v">{overview?.structuredEvents ?? '—'}</div></div>
        <div className="syslog-card"><div className="k">近 24h 失败任务 / 累计</div><div className="v err">{overview ? `${overview.failedJobs24h} / ${overview.failedJobsTotal}` : '—'}</div></div>
      </div>

      {(overview?.topCauses ?? []).length > 0 && (
        <div className="syslog-causes">
          <span>高频失败原因：</span>
          {overview!.topCauses.map((c) => (
            <span className="syslog-cause" key={c.code} title={c.title}>{c.title} × {c.count}</span>
          ))}
        </div>
      )}

      <div className="syslog-tabs">
        {([
          ['failures', '失败诊断', ShieldAlert],
          ['raw', '原始日志', Terminal],
          ['events', '结构化事件', Activity],
        ] as const).map(([key, label, Icon]) => (
          <button key={key} className={`syslog-tab${tab === key ? ' on' : ''}`} onClick={() => setTab(key as Tab)}>
            <Icon size={13} style={{ verticalAlign: '-2px', marginRight: 6 }} />{label}
          </button>
        ))}
      </div>

      <div className="syslog-filters">
        <span style={{ color: 'var(--fg-4)' }}><Filter size={13} /></span>
        <input className="syslog-input" placeholder="搜索错误信息 / 日志内容 / 任务 ID" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void load(); }} />
        {tab === 'failures' && (
          <input className="syslog-input short" placeholder="项目 ID（可选）" value={projectId} onChange={(e) => setProjectId(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void load(); }} />
        )}
        {tab === 'raw' && (
          <select className="syslog-select" value={file} onChange={(e) => setFile(e.target.value)}>
            {fileOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        )}
        {tab === 'events' && (
          <select className="syslog-select" value={category} onChange={(e) => setCategory(e.target.value)}>
            {[['ALL', '全部分类'], ['upstream', '上游调用'], ['job', '任务'], ['exception', '异常'], ['worker', '队列'], ['system', '系统']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        )}
        {(tab === 'raw' || tab === 'events') && (
          <select className="syslog-select" value={level} onChange={(e) => setLevel(e.target.value)}>
            {['ALL', 'ERROR', 'WARN', 'INFO', 'DEBUG'].map((v) => <option key={v} value={v}>{v === 'ALL' ? '全部级别' : v}</option>)}
          </select>
        )}
        <select className="syslog-select" value={limit} onChange={(e) => setLimit(Number(e.target.value))}>
          {[100, 300, 800, 2000].map((n) => <option key={n} value={n}>最多 {n} 条</option>)}
        </select>
        <button className="syslog-btn" onClick={() => void load()}><Search size={12} /> 查询</button>
        {jobIdFromUrl && (
          <button className="syslog-btn" onClick={() => { const p = new URLSearchParams(params); p.delete('jobId'); setParams(p, { replace: true }); }}>
            <X size={12} /> 清除任务筛选
          </button>
        )}
        <span className="syslog-hint">{countLabel}{loading ? ' · 加载中' : ''}</span>
      </div>

      {error && <div className="syslog-badge err" style={{ padding: '8px 10px' }}>加载失败：{error}</div>}

      {/* ---------- 失败诊断 ---------- */}
      {tab === 'failures' && (
        <div className={`syslog-list${loading ? ' syslog-loading' : ''}`}>
          {displayFailures.length === 0 && <div className="syslog-empty">没有匹配的失败任务</div>}
          {displayFailures.map((f) => {
            const open = expanded === f.id;
            const d = diagnoseMap[f.id];
            return (
              <div className="syslog-row" key={f.id}>
                <div className="syslog-row-head" onClick={() => void openDetail(f.id)}>
                  <span style={{ color: 'var(--fg-4)', marginTop: 2 }}>{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span>
                  <div className="syslog-row-body">
                    <div className="syslog-row-title">
                      <Badge text={f.diagnosis.code} tone={f.diagnosis.severity === 'critical' ? 'err' : undefined} />
                      <span>{f.diagnosis.title}</span>
                      <span style={{ color: 'var(--fg-4)', fontSize: 11 }}>{f.projectTitle ?? f.projectId ?? '无项目'}</span>
                    </div>
                    <div className="syslog-row-meta">
                      {fmtTime(f.completedAt ?? f.createdAt)} · {f.jobType}/{f.targetType ?? '-'} · {f.providerName ?? '未指定供应商'} · 重试 {f.retryCount} 次 · {f.id.slice(0, 8)}
                    </div>
                    <div className="syslog-row-msg">{f.errorMessage ?? '（无错误信息）'}</div>
                  </div>
                </div>
                {open && (
                  <div className="syslog-detail">
                    {!d ? <div className="syslog-hint">正在读取完整诊断…</div> : (
                      <>
                        <Section title="具体原因">
                          <p>{d.diagnosis.cause}</p>
                        </Section>
                        {d.historicalError && (
                          <Section title="历史失败原文（任务若已重试，库内错误会被清空）">
                            <pre className="syslog-pre">{d.historicalError}</pre>
                          </Section>
                        )}
                        <Section title="建议操作">
                          <ul>{d.diagnosis.suggestions.map((s, i) => <li key={i}>{s}</li>)}</ul>
                        </Section>
                        {d.referenceCheck.length > 0 && (
                          <Section title="参考图落盘检查">
                            <ul>{d.referenceCheck.map((r, i) => (
                              <li key={i}>{r.path} — {r.exists ? `存在（${fmtBytes(r.size ?? 0)}）` : '文件不存在或非本地路径'}</li>
                            ))}</ul>
                          </Section>
                        )}
                        <Section title="上游完整响应 / 结构化事件">
                          {d.relatedEvents.length === 0 ? <p>暂无关联事件（可能是修复前产生的历史任务）。</p> : d.relatedEvents.map((e, i) => (
                            <div key={i} style={{ marginBottom: 8 }}>
                              <div className="syslog-row-meta">[{fmtTime(e.ts)}] {e.level} · {e.category} · {e.provider ?? '-'} {e.httpStatus ? `· HTTP ${e.httpStatus}` : ''}</div>
                              <pre className="syslog-pre">{JSON.stringify(e.detail ?? e.message, null, 2)}</pre>
                            </div>
                          ))}
                        </Section>
                        <Section title="任务输入 / 输出">
                          <pre className="syslog-pre">{JSON.stringify({ inputData: d.job?.inputData ?? null, outputData: d.job?.outputData ?? null, errorMessage: d.job?.errorMessage ?? null }, null, 2)}</pre>
                        </Section>
                        {d.relatedLogs.length > 0 && (
                          <Section title={`关联原始日志（${d.relatedLogs.length} 条）`}>
                            <pre className="syslog-pre">{d.relatedLogs.map((l) => `[${l.ts ?? '-'}] [${l.level}] [${l.source}] ${l.message}`).join('\n')}</pre>
                          </Section>
                        )}
                        <button className="syslog-btn" onClick={() => { void navigator.clipboard?.writeText(f.id); }}>
                          <Copy size={12} /> 复制任务 ID
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ---------- 原始日志 ---------- */}
      {tab === 'raw' && (
        <div className={`syslog-list${loading ? ' syslog-loading' : ''}`}>
          {entries.length === 0 && <div className="syslog-empty">没有匹配的日志行（可切换文件、放宽级别或清空关键字）</div>}
          {entries.map((e, i) => (
            <div className="syslog-logline" key={`${e.source}-${i}`}>
              <span className="t">{e.ts ? fmtTime(e.ts) : '—'}</span>
              <span className="lv" style={{ color: LEVEL_COLORS[e.level] }}>{e.level}</span>
              <span className="src" title={e.source}>{e.source}</span>
              <span className="m">{e.message}</span>
            </div>
          ))}
        </div>
      )}

      {/* ---------- 结构化事件 ---------- */}
      {tab === 'events' && (
        <div className={`syslog-list${loading ? ' syslog-loading' : ''}`}>
          {events.length === 0 && <div className="syslog-empty">暂无结构化事件（新产生的上游失败/任务失败会实时出现在这里）</div>}
          {events.map((e, i) => (
            <div className="syslog-row" key={`${e.ts}-${i}`}>
              <div className="syslog-row-head" onClick={() => setExpanded(expanded === `ev-${i}` ? null : `ev-${i}`)}>
                <span style={{ color: 'var(--fg-4)', marginTop: 2 }}>{expanded === `ev-${i}` ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span>
                <div className="syslog-row-body">
                  <div className="syslog-row-title">
                    <Badge text={e.level} tone={e.level === 'ERROR' ? 'err' : e.level === 'WARN' ? 'warn' : undefined} />
                    <Badge text={e.category} />
                    <span>{e.message}</span>
                  </div>
                  <div className="syslog-row-meta">
                    {fmtTime(e.ts)} · {e.provider ?? '-'}{e.httpStatus ? ` · HTTP ${e.httpStatus}` : ''}{e.jobId ? ` · job ${e.jobId.slice(0, 8)}` : ''}{e.projectId ? ` · project ${e.projectId.slice(0, 8)}` : ''}
                  </div>
                </div>
              </div>
              {expanded === `ev-${i}` && e.detail && (
                <div className="syslog-detail"><Section title="完整上下文"><pre className="syslog-pre">{JSON.stringify(e.detail, null, 2)}</pre></Section></div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="syslog-hint">
        <Info size={11} style={{ verticalAlign: '-2px', marginRight: 5 }} />
        原始日志读取每个文件尾部最多 512KB（含轮转文件）；敏感字段（API Key / Bearer / 加密串）在返回前已脱敏。
      </div>
    </div>
  );
};

export default SystemLogsPage;
