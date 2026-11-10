/**
 * Studio · 产出坞「剧本」Tab（重设计）
 * -------------------------------------------------------------
 * 旧版把剧本原文塞进一整块 textarea（纯文本墙），既不好读也不好改。
 * 这里改为「阅读 / 编辑」双模式：
 *   · 阅读：把原文解析为场次卡 + 角色对白 / 动作 / 括号提示，
 *           场次可折叠，角色名独立成列，长稿件也能快速扫读。
 *   · 编辑：保留原始 textarea 与所有既有能力（保存 / 转分镜表 /
 *           广告创意成片脚本 / 去自由画布）。
 * 解析只作用于展示层，绝不改写用户原文，保存时仍按原文提交。
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ChevronDown,
  Clapperboard,
  FileText,
  Megaphone,
  PenLine,
  Save,
  Sparkles,
} from 'lucide-react';
import { projects, storyboard } from '@client/src/api';
import type { Project, StoryGenreInfo } from '@shared/api.interface';
import { logger } from '@client/src/utils/logger';

type LineKind = 'dialog' | 'action' | 'note';
interface ScriptLine {
  kind: LineKind;
  speaker?: string;
  text: string;
}
interface ScriptScene {
  no: string;
  title: string;
  lines: ScriptLine[];
}

const TITLE_RE = /^(?:剧名|片名|标题|作品名)\s*[：:]\s*(.+)$/;
const SCENE_RE =
  /^(?:第\s*[一二三四五六七八九十百零〇\d]+\s*[场幕集回]|S\s*\d+|SC(?:ENE)?\s*\d+|场景\s*\d+|(?:INT|EXT)\.?\s)/i;
const DIALOG_RE = /^([^：:]{1,12})\s*[：:]\s*(.+)$/;
const TIMECODE_RE = /^\d{1,2}:\d{2}/;

function parseScript(raw: string): { title: string; scenes: ScriptScene[] } {
  const scenes: ScriptScene[] = [];
  let title = '';
  let cur: ScriptScene | null = null;
  let n = 0;

  for (const source of raw.replace(/\r/g, '').split('\n')) {
    const line = source.trim();
    if (!line) continue;

    const tm = line.match(TITLE_RE);
    if (tm) {
      title = tm[1].trim();
      continue;
    }
    if (SCENE_RE.test(line)) {
      n += 1;
      cur = { no: String(n).padStart(2, '0'), title: line, lines: [] };
      scenes.push(cur);
      continue;
    }
    if (!cur) {
      n += 1;
      cur = { no: String(n).padStart(2, '0'), title: '开场', lines: [] };
      scenes.push(cur);
    }

    const dm = line.match(DIALOG_RE);
    if (dm && !TIMECODE_RE.test(dm[1]) && !/^\d+$/.test(dm[1])) {
      cur.lines.push({ kind: 'dialog', speaker: dm[1].trim(), text: dm[2].trim() });
    } else if (/^[（(].*[）)]$/.test(line)) {
      cur.lines.push({ kind: 'note', text: line });
    } else {
      cur.lines.push({ kind: 'action', text: line });
    }
  }
  return { title, scenes };
}

type Mode = 'read' | 'edit';

export const StudioScriptTab = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [project, setProject] = useState<Project | null>(null);
  const [content, setContent] = useState('');
  const [savedContent, setSavedContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedTip, setSavedTip] = useState(false);
  const [mode, setMode] = useState<Mode>('read');
  const [folded, setFolded] = useState<string[]>([]);
  // 广告创意：产品信息 → Hook+PAS+CTA 脚本任务（链式物化为分镜）
  const [adOpen, setAdOpen] = useState(false);
  const [adBrief, setAdBrief] = useState('');
  const [adBusy, setAdBusy] = useState(false);
  const [adMsg, setAdMsg] = useState<string | null>(null);
  const [adGenres, setAdGenres] = useState<StoryGenreInfo[]>([]);
  const [adGenreId, setAdGenreId] = useState<string | undefined>(undefined);
  const [boardsBusy, setBoardsBusy] = useState(false);

  useEffect(() => {
    storyboard
      .listStorySkills()
      .then((res) => setAdGenres(res.genres ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!id) return;
    projects
      .getProject(id)
      .then((data) => {
        setProject(data);
        const text = data.scriptText || '';
        setContent(text);
        setSavedContent(text);
        if (!text.trim()) setMode('edit');
        setLoading(false);
      })
      .catch((err) => {
        logger.error('load project failed', String(err));
        setError('加载剧本失败');
        setLoading(false);
      });
  }, [id]);

  const parsed = useMemo(() => parseScript(content), [content]);
  const dialogCount = useMemo(
    () => parsed.scenes.reduce((sum, s) => sum + s.lines.filter((l) => l.kind === 'dialog').length, 0),
    [parsed],
  );
  const dirty = content !== savedContent;

  const handleSave = async () => {
    if (!id) return;
    setSaving(true);
    try {
      await projects.updateProject(id, { scriptText: content } as never);
      setSavedContent(content);
      setError(null);
      setSavedTip(true);
      window.setTimeout(() => setSavedTip(false), 2000);
    } catch (err) {
      logger.error('save script failed', String(err));
      setError('保存剧本失败');
    } finally {
      setSaving(false);
    }
  };

  const handleToBoards = async () => {
    if (!id || content.trim().length < 10) {
      setError('剧本内容过短（需 10 字以上）');
      return;
    }
    setBoardsBusy(true);
    try {
      await storyboard.scriptToBoards(id, { scriptText: content, replaceExisting: false });
      setError(null);
      navigate(`/project/${id}/tasks`);
    } catch (e) {
      logger.error('script to boards failed', String(e));
      setError('转分镜失败（需配置文本模型 Key）');
    } finally {
      setBoardsBusy(false);
    }
  };

  const handleCreateAd = async () => {
    if (!id || adBrief.trim().length < 10) {
      setAdMsg('请填写产品信息（10 字以上：产品名 + 卖点 + 人群 + 期望 CTA）');
      return;
    }
    setAdBusy(true);
    try {
      const res = await storyboard.createAd(id, { productBrief: adBrief.trim(), genreId: adGenreId });
      setAdMsg(`脚本任务已创建（${res.jobId.slice(0, 8)}），完成后自动物化为分镜`);
      setAdBrief('');
    } catch (e) {
      logger.error('create ad failed', String(e));
      setAdMsg('创建失败（需配置文本模型 Key）');
    } finally {
      setAdBusy(false);
    }
  };

  const toggleFold = (no: string) =>
    setFolded((prev) => (prev.includes(no) ? prev.filter((x) => x !== no) : [...prev, no]));

  return (
    <div className="sc">
      {/* 稿件概览 */}
      <div className="sc-hero">
        <div className="sc-hero-main">
          <span className="sc-kicker"><FileText size={11} /> 剧本原文</span>
          <h3 className="sc-title">{parsed.title || project?.title || '未命名剧本'}</h3>
          <div className="sc-stats">
            <span><b className="num">{parsed.scenes.length}</b> 场</span>
            <span><b className="num">{content.length}</b> 字</span>
            <span><b className="num">{dialogCount}</b> 句对白</span>
            {dirty && <span className="sc-dirty">未保存改动</span>}
          </div>
        </div>
        <div className="sc-mode" role="group" aria-label="剧本视图">
          <button type="button" className={mode === 'read' ? 'on' : ''} onClick={() => setMode('read')}>
            阅读
          </button>
          <button type="button" className={mode === 'edit' ? 'on' : ''} onClick={() => setMode('edit')}>
            <PenLine size={11} /> 编辑
          </button>
        </div>
      </div>

      {/* 主操作 */}
      <div className="sc-actions">
        <button type="button" className="sc-btn sc-btn-primary" onClick={handleSave} disabled={saving}>
          <Save size={13} /> {saving ? '保存中…' : '保存剧本'}
        </button>
        <button type="button" className="sc-btn" onClick={handleToBoards} disabled={boardsBusy}>
          <Clapperboard size={13} /> {boardsBusy ? '转分镜中…' : '转分镜表'}
        </button>
        <button
          type="button"
          className="sc-btn sc-btn-ghost"
          onClick={() => navigate(`/project/${id}/canvas-free3`)}
        >
          <Sparkles size={13} /> 自由画布
        </button>
        {savedTip && <span className="sc-saved">已保存</span>}
      </div>

      {error && <div className="sc-err">{error}</div>}

      {/* 广告创意：可折叠 */}
      <div className={`sc-ad${adOpen ? ' open' : ''}`}>
        <button type="button" className="sc-ad-head" onClick={() => setAdOpen((v) => !v)}>
          <Megaphone size={14} />
          <span>广告创意成片脚本</span>
          <em>产品信息 → Hook + 正文 + CTA</em>
          <ChevronDown size={14} className="sc-chev" />
        </button>
        {adOpen && (
          <div className="sc-ad-body">
            <textarea
              value={adBrief}
              onChange={(e) => setAdBrief(e.target.value)}
              placeholder="产品名、核心卖点（最多 3 个）、目标人群、价格 / 优惠、期望 CTA…"
              rows={3}
            />
            <div className="sc-ad-row">
              {adGenres.length > 0 && (
                <select
                  value={adGenreId ?? ''}
                  onChange={(e) => setAdGenreId(e.target.value || undefined)}
                  title="题材铁律（可选）"
                >
                  <option value="">不限题材</option>
                  {adGenres.map((g) => (
                    <option key={g.id} value={g.id} title={g.rules.join('；')}>
                      {g.label}
                    </option>
                  ))}
                </select>
              )}
              <button type="button" className="sc-btn sc-btn-primary" onClick={handleCreateAd} disabled={adBusy}>
                <Sparkles size={13} /> {adBusy ? '创建中…' : '生成广告脚本'}
              </button>
              {adMsg && <span className="sc-ad-msg">{adMsg}</span>}
            </div>
          </div>
        )}
      </div>

      {loading ? (
        <div className="sc-loading">正在载入剧本…</div>
      ) : mode === 'edit' ? (
        <div className="sc-editor-wrap">
          <div className="sc-editor-head">
            <span>原文编辑</span>
            <span className="num">{content.length} 字</span>
          </div>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder={
              project?.description
                ? `${project.description}\n\n在这里编写或粘贴剧本原文…`
                : '在这里编写或粘贴剧本原文…\n\n剧名：第七枚硬币\n\n第一场 便利店·深夜\n店长：小林，交班了。\n小林：好的。'
            }
            className="sc-editor"
          />
          <div className="sc-editor-foot">
            支持「第 X 场 地点·时间」划分场次、「角色：台词」识别对白；切回阅读会自动结构化，原文不会被改写。
          </div>
        </div>
      ) : parsed.scenes.length === 0 ? (
        <div className="dp-empty">
          <div className="dp-empty-ico"><FileText size={20} /></div>
          <b>还没有剧本内容</b>
          <p>写下第一句，或粘贴已有剧本原文，这里会自动排成场次与对白。</p>
          <button type="button" className="sc-btn sc-btn-primary" onClick={() => setMode('edit')}>
            <PenLine size={13} /> 开始编写
          </button>
        </div>
      ) : (
        <div className="sc-scenes">
          <div className="sc-section-lb">
            场次 · {parsed.scenes.length}
            <span>点击场次标题可折叠</span>
          </div>
          {parsed.scenes.map((scene) => {
            const isFolded = folded.includes(scene.no);
            return (
              <section key={scene.no} className={`sc-card${isFolded ? ' folded' : ''}`}>
                <button type="button" className="sc-card-head" onClick={() => toggleFold(scene.no)}>
                  <span className="sc-no num">{scene.no}</span>
                  <span className="sc-card-title">{scene.title}</span>
                  <span className="sc-card-count num">{scene.lines.length} 行</span>
                  <ChevronDown size={14} className="sc-chev" />
                </button>
                {!isFolded && (
                  <div className="sc-lines">
                    {scene.lines.map((line, i) => (
                      <div key={i} className={`sc-line sc-line-${line.kind}`}>
                        {line.kind === 'dialog' && <span className="sc-speaker">{line.speaker}</span>}
                        <span className="sc-text">{line.text}</span>
                      </div>
                    ))}
                    {scene.lines.length === 0 && <div className="sc-line sc-line-note">（本场暂无正文）</div>}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
};
