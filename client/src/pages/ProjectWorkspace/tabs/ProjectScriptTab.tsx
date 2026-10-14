import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Save, Sparkles, FileText, AlertCircle, Megaphone, Clapperboard } from 'lucide-react';
import { projects, storyboard } from '@client/src/api';
import type { Project, StoryGenreInfo } from '@shared/api.interface';
import { logger } from '@client/src/utils/logger';

const ProjectScriptTab = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [project, setProject] = useState<Project | null>(null);
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedTip, setSavedTip] = useState(false);
  // 广告创意：产品信息 → Hook+PAS+CTA 脚本任务（链式物化为分镜）
  const [adOpen, setAdOpen] = useState(false);
  const [adBrief, setAdBrief] = useState('');
  const [adBusy, setAdBusy] = useState(false);
  const [adMsg, setAdMsg] = useState<string | null>(null);
  const [adGenres, setAdGenres] = useState<StoryGenreInfo[]>([]);
  const [adGenreId, setAdGenreId] = useState<string | undefined>(undefined);
  const [boardsBusy, setBoardsBusy] = useState(false);

  const handleToBoards = async () => {
    if (!id || content.trim().length < 10) {
      setError('剧本内容过短（需 10 字以上）');
      return;
    }
    setBoardsBusy(true);
    try {
      await storyboard.scriptToBoards(id, {
        scriptText: content,
        replaceExisting: false,
      });
      setError(null);
      navigate(`/project/${id}/tasks`);
    } catch (e) {
      logger.error('script to boards failed', String(e));
      setError('转分镜失败（需配置文本模型 Key）');
    } finally {
      setBoardsBusy(false);
    }
  };

  useEffect(() => {
    storyboard.listStorySkills()
      .then((res) => setAdGenres(res.genres ?? []))
      .catch(() => {});
  }, []);

  const handleCreateAd = async () => {
    if (!id || adBrief.trim().length < 10) {
      setAdMsg('请填写产品信息（10字以上：产品名+卖点+人群+期望CTA）');
      return;
    }
    setAdBusy(true);
    try {
      const res = await storyboard.createAd(id, { productBrief: adBrief.trim(), genreId: adGenreId });
      setAdMsg(`广告脚本任务已创建（${res.jobId.slice(0, 8)}），完成后自动物化为分镜，可去任务页查看`);
      setAdBrief('');
    } catch (e) {
      logger.error('create ad failed', String(e));
      setAdMsg('创建失败（需配置文本模型 Key）');
    } finally {
      setAdBusy(false);
    }
  };

  useEffect(() => {
    if (!id) return;
    projects.getProject(id)
      .then((data) => {
        setProject(data);
        setContent(data.scriptText || '');
        setLoading(false);
      })
      .catch((err) => {
        logger.error('load project failed', String(err));
        setError('加载剧本失败');
        setLoading(false);
      });
  }, [id]);

  const handleSave = async () => {
    if (!id) return;
    setSaving(true);
    try {
      await projects.updateProject(id, { scriptText: content } as never);
      setSavedTip(true);
      setTimeout(() => setSavedTip(false), 2000);
    } catch (err) {
      logger.error('save script failed', String(err));
      setError('保存剧本失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-foreground">剧本</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {project?.title || '短剧项目'} 的剧本原文，可编辑后保存
          </p>
        </div>
        <div className="flex items-center gap-2">
          {savedTip && <span className="text-xs font-medium text-green-600">已保存</span>}
          <button
            onClick={handleToBoards}
            disabled={boardsBusy}
            title="分镜表技能：剧本→结构化分镜JSON→直接物化（失败回落启发式拆分）"
            className="flex items-center gap-1.5 rounded-lg border border-input bg-white px-4 py-2 text-sm font-medium text-foreground hover:border-primary hover:text-primary disabled:opacity-50"
          >
            <Clapperboard className="h-4 w-4" /> {boardsBusy ? '转分镜中…' : '转分镜表'}
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90 disabled:opacity-50"
          >
            <Save className="h-4 w-4" /> {saving ? '保存中...' : '保存剧本'}
          </button>
        </div>
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-600">{error}</div>}

      {/* 广告创意（Hook+PAS+CTA，借鉴 creatify skill Part 1 框架） */}
      <div className="rounded-xl border bg-white shadow-sm">
        <button
          onClick={() => setAdOpen((v) => !v)}
          className="flex w-full items-center gap-2 px-4 py-3 text-left"
        >
          <Megaphone className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium text-foreground">广告创意成片脚本</span>
          <span className="text-xs text-muted-foreground">产品信息 → Hook+正文+CTA → 自动物化为分镜</span>
        </button>
        {adOpen && (
          <div className="space-y-2 border-t border-border px-4 py-3">
            <textarea
              value={adBrief}
              onChange={(e) => setAdBrief(e.target.value)}
              placeholder="产品名、核心卖点（最多3个）、目标人群、价格/优惠、期望CTA，如：XX面膜，补水+修护，25-35岁女性，买一送一，CTA点击领取试用"
              rows={3}
              className="w-full resize-y rounded-lg border border-input bg-white p-3 text-sm outline-none placeholder:text-muted-foreground/60 focus:border-primary"
            />
            <div className="flex items-center gap-2">
              {adGenres.length > 0 && (
                <select
                  value={adGenreId ?? ''}
                  onChange={(e) => setAdGenreId(e.target.value || undefined)}
                  className="rounded-lg border border-input bg-white px-2 py-2 text-xs outline-none focus:border-primary"
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
              <button
                onClick={handleCreateAd}
                disabled={adBusy}
                className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
              >
                <Sparkles className="h-4 w-4" /> {adBusy ? '创建中…' : '生成广告脚本'}
              </button>
              {adMsg && <span className="text-xs text-muted-foreground">{adMsg}</span>}
            </div>
          </div>
        )}
      </div>

      {loading ? (
        <div className="rounded-xl border bg-white p-12 text-center text-sm text-muted-foreground">加载中...</div>
      ) : (
        <div className="rounded-xl border bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium text-foreground">剧本原文</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground">{content.length} 字</span>
              <button
                onClick={() => navigate(`/project/${id}/canvas`)}
                className="flex items-center gap-1.5 rounded-md border border-input bg-white px-3 py-1.5 text-xs font-medium text-foreground hover:border-primary hover:text-primary"
              >
                <Sparkles className="h-3.5 w-3.5" /> 去无限画布编排
              </button>
            </div>
          </div>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder={project?.description ? `${project.description}\n\n在这里编写或粘贴剧本原文...` : '在这里编写或粘贴剧本原文...'}
            className="min-h-[420px] w-full resize-y rounded-b-xl bg-white p-5 text-sm leading-relaxed text-foreground/85 outline-none placeholder:text-muted-foreground/60"
          />
        </div>
      )}
    </div>
  );
};

export default ProjectScriptTab;
