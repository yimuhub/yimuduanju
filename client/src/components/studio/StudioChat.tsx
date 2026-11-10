/**
 * Studio · 对话视图
 * -------------------------------------------------------------
 * 有项目：项目会话（服务端落库）→ 流式回复 + 阶段确认卡 + 一致性卡。
 * 无项目：工作台启动页 → 引导从左上角「新建对话」进入创作对话。
 *
 * 所有对话记录都来自 /api/assistant/sessions，刷新、切页、重新进入都能恢复；
 * 生成的图片/人物参考图归档在项目资产里，不会随着一次会话丢失。
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  Loader2,
  AlertTriangle,
  ArrowRight,
  Plus,
  MessageSquare,
  Film,
  Sparkles,
} from 'lucide-react';
import { approveProject } from '@client/src/api/projects';
import { listChatSessions } from '@client/src/api/chat';
import { listCharacters, listLocations, listProps } from '@client/src/api/bible';
import type { ChatSession } from '@shared/api.interface';
import { isCharacterFullyDefined, isPropReady } from '@shared/api.interface';
import { styleOptions } from '@client/src/pages/CreateWizard/WizardSettings';
import { useStudio } from './StudioShell';
import { ChatTurns } from './chat/ChatTurns';
import { ChatComposer, type PendingAttachment } from './chat/ChatComposer';
import { ConsistencyCard } from './chat/ConsistencyCard';
import { GateCard, type GateStage } from './chat/GateCard';
import { PipelineCard, countOpenFailures } from './chat/PipelineCard';
import {
  ACTIVE_STATUSES,
  PENDING_STATUSES,
  READY_STATUSES,
  RUNNING_STATUSES,
  projectStatusMeta,
} from './projectStatus';

const QUICK_CHIPS = [
  '这个项目下一步该做什么？',
  '帮我检查人物和场景的一致性',
  '把剧本节奏再收紧一点',
  '哪些环节会花钱？',
];

const HOME_IDEAS = [
  '做一部 90 秒穿越到唐朝的甜宠短剧',
  '3 分钟悬疑短剧：雨夜出租车',
  '30 秒国风广告片：一把会认主的剑',
];

const fmtCost = (n: number) => `¥${n >= 100 ? n.toFixed(0) : n.toFixed(2)}`;

const whenLabel = (iso?: string) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  return d.toDateString() === now.toDateString()
    ? d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
};

/** 工作台：状态概览 + 继续创作 + 最近对话 + 灵感起步 */
const StudioHome = ({
  openNewWork,
}: {
  openNewWork: ReturnType<typeof useStudio>['openNewWork'];
}) => {
  const navigate = useNavigate();
  const { data } = useStudio();
  const [recent, setRecent] = useState<ChatSession[]>([]);

  useEffect(() => {
    let alive = true;
    listChatSessions()
      .then((rows) => {
        if (!alive) return;
        setRecent(rows.filter((s) => s.kind === 'draft' && !!s.title).slice(0, 6));
      })
      .catch(() => {
        /* 历史列表失败不影响新建入口 */
      });
    return () => {
      alive = false;
    };
  }, []);

  const stats = useMemo(() => {
    const list = data.projects;
    return {
      active: list.filter((p) => RUNNING_STATUSES.includes(p.status)).length,
      pending: list.filter((p) => PENDING_STATUSES.includes(p.status)).length,
      ready: list.filter((p) => READY_STATUSES.includes(p.status)).length,
      total: list.length,
      cost:
        data.stats?.totalCost ??
        list.reduce((sum, p) => sum + (p.totalCost ?? 0), 0),
    };
  }, [data.projects, data.stats]);

  const active = useMemo(
    () =>
      data.projects
        .filter((p) => ACTIVE_STATUSES.includes(p.status))
        .sort(
          (a, b) =>
            new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
        )
        .slice(0, 6),
    [data.projects],
  );

  return (
    <div className="thread">
      <div className="thread-in wh-in">
        <header className="wh-head">
          <div className="home-kicker">YIMU STUDIO · 工作台</div>
          <h1>把想法，推进成片</h1>
          <p>
            先聊清方向，再按「剧本 → 分镜 → 首帧 → 成片」逐段确认。
            每一步都有记录，随时能回到现场。
          </p>
          <div className="home-actions">
            <button type="button" className="btn pri" onClick={() => openNewWork()}>
              <Plus className="ico" /> 新建作品
            </button>
            <button type="button" className="btn" onClick={() => navigate('/projects')}>
              我的项目 <ArrowRight className="ico" />
            </button>
          </div>
        </header>

        <div className="wh-stats">
          <div className="wh-stat">
            <span>进行中</span>
            <b>{stats.active}</b>
          </div>
          <div className="wh-stat">
            <span>待确认</span>
            <b>{stats.pending}</b>
          </div>
          <div className="wh-stat">
            <span>已成片</span>
            <b>{stats.ready}</b>
          </div>
          <div className="wh-stat">
            <span>累计花费</span>
            <b>{fmtCost(stats.cost)}</b>
          </div>
        </div>

        <section className="wh-sec">
          <div className="wh-sec-head">
            <h2>继续创作</h2>
            <button
              type="button"
              className="wh-more"
              onClick={() => navigate('/projects')}
            >
              全部 {stats.total} 个项目 <ArrowRight />
            </button>
          </div>
          {active.length > 0 ? (
            <div className="wh-projects">
              {active.map((p) => {
                const meta = projectStatusMeta(p.status);
                const style =
                  styleOptions.find((s) => s.value === p.artStyle)?.label ??
                  p.artStyle ??
                  '';
                return (
                  <button
                    key={p.id}
                    type="button"
                    className="wh-project"
                    onClick={() => navigate(`/project/${p.id}`)}
                  >
                    <span className="wh-cover">
                      {p.thumbnailUrl ? (
                        <img src={p.thumbnailUrl} alt="" loading="lazy" />
                      ) : (
                        <Film />
                      )}
                    </span>
                    <span className="wh-project-main">
                      <span className="wh-project-top">
                        <b>{p.title}</b>
                        <i className={`wh-chip ${meta.cls}`}>{meta.text}</i>
                      </span>
                      <span className="wh-project-meta">
                        {p.durationSeconds ? `${p.durationSeconds}s` : '—'}
                        {style ? ` · ${style}` : ''} · {whenLabel(p.updatedAt)}
                      </span>
                    </span>
                    <span className="wh-project-side">
                      {p.totalCost ? <em>{fmtCost(p.totalCost)}</em> : null}
                      <ArrowRight className="wh-project-car" />
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="wh-empty">
              <p>还没有进行中的作品。把一句话说清楚，剩下的交给流水线。</p>
              <button type="button" className="btn pri" onClick={() => openNewWork()}>
                <Plus className="ico" /> 新建作品
              </button>
            </div>
          )}
        </section>

        <div className="wh-bottom">
          <section className="wh-panel">
            <div className="wh-sec-head">
              <h2>最近对话</h2>
              {recent.length > 0 ? <span className="wh-count">{recent.length}</span> : null}
            </div>
            {recent.length > 0 ? (
              recent.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className="home-recent-item"
                  onClick={() => openNewWork({ sessionId: s.id })}
                >
                  <MessageSquare className="ico" />
                  <span className="home-recent-t">{s.title}</span>
                  <span className="home-recent-when">{whenLabel(s.updatedAt)}</span>
                </button>
              ))
            ) : (
              <p className="wh-panel-empty">还没有草稿对话，点「新建作品」开始。</p>
            )}
          </section>

          <section className="wh-panel">
            <div className="wh-sec-head">
              <h2>灵感起步</h2>
              <Sparkles className="wh-spark" />
            </div>
            <div className="wh-ideas">
              {HOME_IDEAS.map((idea) => (
                <button
                  key={idea}
                  type="button"
                  className="nw-chip"
                  onClick={() => openNewWork({ prompt: idea })}
                >
                  {idea}
                </button>
              ))}
            </div>
            <p className="wh-panel-empty">
              选一个方向直接开聊，也可以自己描述题材、主角和反转。
            </p>
          </section>
        </div>
      </div>
    </div>
  );
};

export const StudioChat = () => {
  const navigate = useNavigate();
  const {
    data,
    projectId,
    chatMsgs: msgs,
    chatBusy: busy,
    chatLoading: loading,
    sendChat,
    stopChat,
    openNewWork,
  } = useStudio();
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [approvingStage, setApprovingStage] = useState<GateStage | null>(null);
  const [refStats, setRefStats] = useState<{ ready: number; total: number } | null>(null);
  const [bibleStamp, setBibleStamp] = useState(0);

  // 圣经页生成/编辑人物与场景后即时刷新门控进度（jobs 不变时 refStamp 不会动）
  useEffect(() => {
    const onUpdate = () => setBibleStamp((v) => v + 1);
    window.addEventListener('yimu:bible-updated', onUpdate);
    return () => window.removeEventListener('yimu:bible-updated', onUpdate);
  }, []);

  // 分镜门放行前先看人物/场景/道具的资产就绪度：
  // 人物按「主图 + 四视图」判定，道具按「识别锚点 + 设定图」判定。
  const refStamp = useMemo(() => {
    const related = data.jobs.filter(
      (j) => j.targetType === 'character' || j.targetType === 'location' || j.targetType === 'prop',
    );
    return `${related.length}:${related.reduce(
      (m, j) => (j.updatedAt && j.updatedAt > m ? j.updatedAt : m),
      '',
    )}`;
  }, [data.jobs]);

  useEffect(() => {
    if (!projectId) {
      setRefStats(null);
      return;
    }
    let alive = true;
    Promise.all([listCharacters(projectId), listLocations(projectId), listProps(projectId)])
      .then(([chars, locs, props]) => {
        if (!alive) return;
        setRefStats({
          ready:
            chars.filter(isCharacterFullyDefined).length +
            locs.filter((l) => l.referenceImageUrls.length > 0).length +
            props.filter(isPropReady).length,
          total: chars.length + locs.length + props.length,
        });
      })
      .catch(() => {
        /* 设定还没生成时不打扰 */
      });
    return () => {
      alive = false;
    };
  }, [projectId, refStamp, bibleStamp]);

  if (!projectId) return <StudioHome openNewWork={openNewWork} />;

  const send = async (text?: string) => {
    const content = (text ?? input).trim();
    if ((!content && attachments.length === 0) || busy) return;
    const atts = attachments;
    setInput('');
    setAttachments([]);
    await sendChat(content, atts);
  };

  // 项目内对话页是默认落地页：剧本阶段的状态必须在这里可见，否则用户以为卡死
  const nextGate = data.progress?.nextGate ?? null;
  const scriptJob = data.progress?.scriptJob ?? null;
  const scriptRunning =
    !!scriptJob && ['pending', 'queued', 'running', 'retrying'].includes(scriptJob.status);

  /** 三门共用：确认后立即刷新进度，流水线自动继续，不把用户踢出对话页 */
  const approveStage = async (stage: GateStage) => {
    if (!projectId || approvingStage) return;
    setApprovingStage(stage);
    try {
      await approveProject(projectId, stage);
      toast.success(
        stage === 'script'
          ? '剧本已确认，正在物化分镜'
          : stage === 'storyboard'
            ? '分镜已确认，正在提交首帧生成'
            : '成片已确认，项目进入就绪',
      );
      await data.reloadProgress();
      // 确认后服务端会创建新任务，稍后再刷一次即可看到「进行中」
      window.setTimeout(() => void data.reloadProgress(), 1500);
    } catch (err) {
      toast.error(`确认失败：${(err as Error).message}`);
    } finally {
      setApprovingStage(null);
    }
  };

  const header = (
    <>
      {nextGate ? (
        <div id="studio-gate-card">
          <GateCard
            stage={nextGate}
            projectId={projectId}
            shotCount={data.shotStats.total}
            sceneCount={data.scenes.length}
            failedCount={countOpenFailures(data.jobs)}
            consistency={refStats}
            busy={approvingStage === nextGate}
            onApprove={(stage) => void approveStage(stage)}
            onNavigate={navigate}
          />
        </div>
      ) : null}

      {!nextGate && scriptRunning ? (
        <div className="run-strip">
          <Loader2 className="spin" />
          <div className="run-strip-main">
            <b>AI 正在生成剧本</b>
            <span>通常 1-2 分钟；完成后这里会出现「确认剧本」</span>
          </div>
          <button
            type="button"
            className="btn"
            onClick={() => navigate(`/project/${projectId}/tasks`)}
          >
            查看任务队列 <ArrowRight className="ico" />
          </button>
        </div>
      ) : null}

      {!nextGate && scriptJob?.status === 'failed' ? (
        <div className="run-strip fail">
          <AlertTriangle />
          <div className="run-strip-main">
            <b>剧本生成失败</b>
            <span>{scriptJob.errorMessage || '模型返回异常，可重试或手动粘贴剧本'}</span>
          </div>
          <button
            type="button"
            className="btn"
            onClick={() => navigate(`/project/${projectId}/tasks`)}
          >
            去重试
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => navigate(`/project/${projectId}/script`)}
          >
            手动粘贴剧本
          </button>
        </div>
      ) : null}

      <PipelineCard
        projectId={projectId}
        progress={data.progress}
        jobs={data.jobs}
        shotStats={data.shotStats}
        sceneCount={data.scenes.length}
        clipCount={data.timeline?.clips?.length ?? 0}
        durationSec={data.totalSec}
        onNavigate={navigate}
      />
    </>
  );

  return (
    <>
      {loading ? (
        <div className="thread">
          <div className="thread-in">
            <div className="chat-thinking">
              <Loader2 className="spin" /> 正在恢复对话记录…
            </div>
          </div>
        </div>
      ) : (
        <ChatTurns
          msgs={msgs}
          busy={busy}
          header={header}
          empty={
            <div className="turn agent">
              <div className="turn-h">
                <span className="turn-w a">一幕 Agent</span>
                <span className="turn-when">现在</span>
              </div>
              <div className="turn-b">
                <p>
                  这个项目的对话会一直保存。你可以直接问进度、改方向，或者让我解释某一步为什么停住了。
                </p>
                <p>花钱的环节会先摊开给你确认；人物和场景的参考图会作为后续生成的一致性依据。</p>
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 14, marginLeft: 15 }}>
                {QUICK_CHIPS.map((c) => (
                  <button key={c} type="button" className="btn" onClick={() => void send(c)}>
                    {c}
                  </button>
                ))}
              </div>
            </div>
          }
        />
      )}

      {/* 人物/场景一致性常驻输入框上方：不随消息滚动，剧本分析后立即可见 */}
      <div className="chat-cons-dock">
        <ConsistencyCard projectId={projectId} jobs={data.jobs} />
      </div>

      <ChatComposer
        value={input}
        onChange={setInput}
        onSend={() => void send()}
        busy={busy}
        onStop={stopChat}
        attachments={attachments}
        onAddAttachment={(a) => setAttachments((v) => [...v, a])}
        onRemoveAttachment={(i) => setAttachments((v) => v.filter((_, idx) => idx !== i))}
        placeholder="描述镜头、节奏或改动；也可以上传剧本让 Agent 接着改…"
        leftActions={
          <>
            <button type="button" className="ctool" onClick={() => navigate('/create')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" />
              </svg>
              一键创作
            </button>
            <button
              type="button"
              className="ctool"
              onClick={() => navigate(`/project/${projectId}/characters`)}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                <path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M22 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" />
              </svg>
              人物设定
            </button>
            <button
              type="button"
              className="ctool"
              onClick={() => navigate(`/project/${projectId}/assets`)}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="16" rx="2" />
                <path d="M3 9h18" />
              </svg>
              引用资产
            </button>
          </>
        }
      />
    </>
  );
};