/**
 * 导出与交付 · Studio 右坞版
 * -------------------------------------------------------------
 * 旧版用 Tailwind 的「视口断点」(lg:grid-cols-5) 排版，塞进 548px 的右坞后
 * 变成两栏极窄卡片，文字被压成一团。这里改为纯容器驱动的 .ex-* 设计系统：
 *   · 标准宽度 548px：单列流式，信息按「进度 → 就绪度 → 合成 → 交付物」分层
 *   · 宽屏 / 超宽：用 @container 自动升为双列，不会出现横向滚动
 * 所有原有能力（SRT/ASS/JSON/清单/剪映草稿、浏览器端合成、服务端合成、
 * BGM 与混音开关、色彩匹配、存为模板、mock 占位告警）一律保留。
 */
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  Download,
  FileText,
  FileJson,
  ClipboardList,
  Info,
  Video,
  Clapperboard,
  CheckCircle2,
  Circle,
  Music,
  AlertTriangle,
  Layers,
  Server,
  Upload,
  X,
  Loader2,
  ArrowUpRight,
  Clock3,
  Film,
  Sparkles,
} from 'lucide-react';
import { exportApi, storyboard, templates as templatesApi } from '@client/src/api';
import type { Shot } from '@shared/api.interface';
import { logger } from '@client/src/utils/logger';
import { toast } from 'sonner';
// P1 性能：ffmpeg.wasm 只在点击合成时动态加载，不再进主包
import type { SynthStatus } from '@client/src/utils/ffmpegSynth';

const ProjectExportTab = () => {
  const { id } = useParams<{ id: string }>();
  const [shots, setShots] = useState<Shot[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    // P1 N+1 修复：本页仅需镜头，一次取全量（之前按场景逐个查询）
    storyboard
      .listAllShots(id)
      .then((allShots) => {
        setShots(allShots);
        setLoadError(false);
      })
      .catch((e) => {
        logger.error('load export data failed', String(e));
        setLoadError(true);
      })
      .finally(() => setLoading(false));
  }, [id]);

  // W5 模板市场：项目存为模板（标题/时长/画幅/画风/导演参数一键沉淀）
  const [templateName, setTemplateName] = useState('');
  const [showTemplateInput, setShowTemplateInput] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const handleSaveAsTemplate = async () => {
    if (!id) return;
    setSavingTemplate(true);
    try {
      const tpl = await templatesApi.saveAsTemplate(
        id,
        templateName.trim() || undefined,
      );
      toast.success(`已存为模板「${tpl.name}」，可在模板中心查看`);
      setShowTemplateInput(false);
      setTemplateName('');
    } catch {
      toast.error('存为模板失败');
    } finally {
      setSavingTemplate(false);
    }
  };
  // P1 导出真实化：时长/计数全部来自真实分镜，不再写死 60 秒
  const totalDuration = shots.reduce((sum, s) => sum + (s.duration || 0), 0);
  const withVideo = shots.filter((s) => s.videoUrl).length;
  const withVoice = shots.filter((s) => s.voiceUrl).length;
  const withSubtitle = shots.filter((s) => s.subtitleText || s.dialogue).length;

  // 交付就绪检查（对标 ArcReel Definition of Done）：manifest 拉真实质检与费用
  const [manifest, setManifest] = useState<{
    counts?: { shots?: number; withVideo?: number; withVoice?: number; withSubtitle?: number };
    latestQc?: { pass?: boolean; overallScore?: number } | null;
    project?: { totalCost?: number };
  } | null>(null);
  useEffect(() => {
    if (!id) return;
    exportApi
      .getManifest(id)
      .then((data) => setManifest(data))
      .catch(() => setManifest(null));
  }, [id, shots.length]);

  const readiness = [
    { label: '有分镜数据', done: shots.length > 0 },
    { label: '全部镜头有视频', done: shots.length > 0 && withVideo === shots.length },
    { label: '全部镜头有配音', done: shots.length > 0 && withVoice === shots.length },
    { label: '全部镜头有字幕', done: shots.length > 0 && withSubtitle === shots.length },
    { label: '质检通过', done: manifest?.latestQc?.pass === true },
    {
      label: '费用已结算',
      done: (manifest?.project?.totalCost ?? 0) > 0 || withVideo > 0,
    },
  ];
  const readyCount = readiness.filter((r) => r.done).length;
  const readyPct = Math.round((readyCount / readiness.length) * 100);

  // W3 真 MP4 合成（浏览器端 FFmpeg.wasm，零服务端成本）
  const [synthStatus, setSynthStatus] = useState<SynthStatus | null>(null);
  const [synthProgress, setSynthProgress] = useState(0);
  const [synthMessage, setSynthMessage] = useState('');
  const [synthUrl, setSynthUrl] = useState<string | null>(null);
  // 服务端成片：ffmpeg 拼接后归档为项目资产（资产页可见）
  const [assembling, setAssembling] = useState(false);
  const handleServerAssemble = async () => {
    if (!id || assembling) return;
    setAssembling(true);
    try {
      // 断链修复：改走 axios 封装（自动携带 CSRF 头；原裸 fetch 直连后端时会 403）
      const data = await exportApi.assembleVideo(id);
      toast.success(`成片已合成：${data.clips} 段拼接，已归档到「项目资产」`);
    } catch (e) {
      const axiosMsg =
        typeof e === 'object' && e && 'response' in e
          ? ((e as { response?: { data?: { message?: string } } }).response?.data?.message ?? '')
          : '';
      toast.error(axiosMsg || (e as Error).message || '服务端合成失败');
    } finally {
      setAssembling(false);
    }
  };
  const [synthName, setSynthName] = useState('yimu-export.mp4');

  useEffect(
    () => () => {
      // P1 修复：合成产物 URL 卸载时释放
      if (synthUrl) URL.revokeObjectURL(synthUrl);
    },
    [synthUrl],
  );

  const videoClips = shots
    .filter((s) => s.videoUrl)
    .sort((a, b) => a.shotNumber - b.shotNumber)
    .map((s) => ({
      // 远端 CDN 片段经服务端同源代理取流，绕开浏览器 CORS（修复 "Failed to fetch"）
      url: id ? exportApi.mediaProxyUrl(id, s.videoUrl as string) : (s.videoUrl as string),
      label: `镜头 #${s.shotNumber}`,
      durationSeconds: s.duration,
      voiceUrl: s.voiceUrl && id ? exportApi.mediaProxyUrl(id, s.voiceUrl) : s.voiceUrl,
    }));

  // P1-3 BGM：本地文件直入合成（objectURL，不经过服务器），配音默认按镜混入
  const [bgmUrl, setBgmUrl] = useState<string | null>(null);
  const [bgmName, setBgmName] = useState<string | null>(null);
  const [includeVoices, setIncludeVoices] = useState(true);
  // P1-6 色彩匹配：默认关闭（多一次转码，较慢）
  const [colorMatch, setColorMatch] = useState(false);
  useEffect(
    () => () => {
      if (bgmUrl) URL.revokeObjectURL(bgmUrl);
    },
    [bgmUrl],
  );

  const synthBusy = synthStatus === 'working' || synthStatus === 'fetching' || synthStatus === 'loading-core';

  const handleSynthesize = async () => {
    if (videoClips.length === 0 || synthBusy) return;
    if (synthUrl) {
      URL.revokeObjectURL(synthUrl);
      setSynthUrl(null);
    }
    try {
      const { synthesizeMp4 } = await import('@client/src/utils/ffmpegSynth');
      const { blobUrl, fileName } = await synthesizeMp4(videoClips, (status, progress, message) => {
        setSynthStatus(status);
        setSynthProgress(progress);
        if (message) setSynthMessage(message);
      }, { bgmUrl: bgmUrl ?? undefined, includeVoices, colorMatch });
      setSynthUrl(blobUrl);
      setSynthName(fileName);
    } catch (e) {
      setSynthStatus('error');
      setSynthMessage((e as Error)?.message || '合成失败');
    }
  };

  const exportBase = id ? `/api/projects/${id}/export` : '';
  const hasShots = shots.length > 0;
  const deliverables = [
    {
      icon: FileText,
      label: '字幕 SRT',
      desc: `${withSubtitle} / ${shots.length} 个镜头有字幕，按镜头时长自动排轴`,
      tag: 'SRT',
      group: '字幕与时间轴',
      href: `${exportBase}/subtitles.srt`,
      disabled: !hasShots,
    },
    {
      icon: FileText,
      label: '卡拉OK字幕 ASS',
      desc: '逐字高亮，竖屏 1080×1920，可用 ffmpeg ass 滤镜烧录',
      tag: 'ASS',
      group: '字幕与时间轴',
      href: `${exportBase}/karaoke.ass`,
      disabled: !hasShots,
    },
    {
      icon: FileJson,
      label: '分镜 JSON',
      desc: '场景 + 全部镜头完整数据，可作剪辑底稿与备份',
      tag: 'JSON',
      group: '数据与工程',
      href: `${exportBase}/storyboard.json`,
      disabled: !hasShots,
    },
    {
      icon: ClipboardList,
      label: '导出清单',
      desc: '项目 / 计数 / 资产地址 / 质检 / 费用一览，交付归档用',
      tag: 'JSON',
      group: '数据与工程',
      href: `${exportBase}/manifest.json`,
      disabled: !hasShots,
    },
    {
      icon: Clapperboard,
      label: '剪映草稿（实验性）',
      desc: 'video / audio / text 三轨 draft，可导入剪映继续精修',
      tag: 'DRAFT',
      group: '数据与工程',
      href: `${exportBase}/jianying.json`,
      disabled: !hasShots,
    },
  ];
  const groups = ['字幕与时间轴', '数据与工程'] as const;

  // mock 演练占位镜头：合成/导出前必须显式告知，避免把占位内容当成交付成片
  const mockShots = shots.filter((s) => s.mock);

  return (
    <div className="ex">
      {/* ① 概览：标题 + 交付就绪度 */}
      <header className="ex-hero">
        <div className="ex-hero-l">
          <span className="ex-kicker">DELIVERY / 交付中心</span>
          <h2>导出与交付</h2>
          <p>基于当前分镜数据生成真实可下载的成片与工程文件</p>
        </div>
        <div className="ex-ready" data-state={readyPct === 100 ? 'ok' : 'progress'}>
          <div className="ex-ready-top">
            <span>交付就绪度</span>
            <b className="num">{readyCount}<i>/{readiness.length}</i></b>
          </div>
          <div className="ex-ready-bar"><span style={{ width: `${readyPct}%` }} /></div>
          <span className="ex-ready-note">
            {readyPct === 100 ? '全部检查通过，可交付' : `${readiness.length - readyCount} 项待完成`}
          </span>
        </div>
      </header>

      {/* ② 关键指标 */}
      <div className="ex-stats">
        <div className="ex-stat">
          <span className="ex-stat-ico"><Film size={14} /></span>
          <span className="ex-stat-k">镜头总数</span>
          <b className="num">{shots.length}</b>
        </div>
        <div className="ex-stat">
          <span className="ex-stat-ico"><Clock3 size={14} /></span>
          <span className="ex-stat-k">累计时长</span>
          <b className="num">{totalDuration.toFixed(1)}<i>s</i></b>
        </div>
        <div className="ex-stat">
          <span className="ex-stat-ico"><Video size={14} /></span>
          <span className="ex-stat-k">已有视频</span>
          <b className="num">{withVideo}<i>/{shots.length}</i></b>
        </div>
        <div className="ex-stat">
          <span className="ex-stat-ico"><FileText size={14} /></span>
          <span className="ex-stat-k">已有字幕</span>
          <b className="num">{withSubtitle}<i>/{shots.length}</i></b>
        </div>
      </div>

      {loading ? (
        <div className="ex-note ex-note-plain"><Loader2 size={14} className="spin" /> 正在读取分镜数据…</div>
      ) : null}
      {loadError ? (
        <div className="ex-alert ex-alert-err">分镜数据加载失败，请刷新页面重试</div>
      ) : null}

      {!loading && !loadError && mockShots.length > 0 && (
        <div className="ex-alert ex-alert-warn">
          <AlertTriangle size={15} />
          <div>
            <b>本片含 {mockShots.length} 个演示占位镜头（未计费）</b>
            <p>
              镜头号 {mockShots.map((s) => `#${s.shotNumber}`).join('、')} 的首帧/成片来自 mock 演练通道，
              是可播放的占位内容，不是真实生成结果。请配置真实模型供应商并重新生成后再对外交付。
            </p>
          </div>
        </div>
      )}

      {/* ③ 就绪检查 */}
      <section className="ex-sec">
        <div className="ex-sec-h">
          <div><span className="ex-sec-idx">01</span><h3>交付就绪检查</h3></div>
          <span className="ex-sec-meta">基于真实分镜 / 质检 / 费用数据</span>
        </div>
        <div className="ex-checks">
          {readiness.map((item) => (
            <div key={item.label} className={`ex-check${item.done ? ' ok' : ''}`}>
              {item.done
                ? <CheckCircle2 size={14} strokeWidth={2} />
                : <Circle size={14} strokeWidth={1.6} />}
              <span>{item.label}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ④ 成片合成 */}
      <section className="ex-sec">
        <div className="ex-sec-h">
          <div><span className="ex-sec-idx">02</span><h3>成片合成</h3></div>
          <span className="ex-sec-meta">可合成 {videoClips.length} / {shots.length} 个镜头</span>
        </div>

        <div className="ex-synth">
          <div className="ex-synth-h">
            <span className="ex-synth-ico"><Sparkles size={15} /></span>
            <div>
              <b>本机合成 MP4</b>
              <span>按镜头顺序拼接 · BGM 闪避 · 响度标准化 −14 LUFS · 不消耗服务端资源</span>
            </div>
          </div>

          <div className="ex-opts">
            <label className="ex-opt-file">
              <Music size={13} />
              <span>{bgmName || '选择 BGM'}</span>
              <input
                type="file"
                accept="audio/*"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (!f) return;
                  if (bgmUrl) URL.revokeObjectURL(bgmUrl);
                  setBgmUrl(URL.createObjectURL(f));
                  setBgmName(f.name);
                }}
              />
            </label>
            {bgmName ? (
              <button
                type="button"
                className="ex-opt-x"
                onClick={() => {
                  if (bgmUrl) URL.revokeObjectURL(bgmUrl);
                  setBgmUrl(null);
                  setBgmName(null);
                }}
                title="移除 BGM"
              >
                <X size={12} /> 移除
              </button>
            ) : null}
            <label className="ex-toggle">
              <input type="checkbox" checked={includeVoices} onChange={(e) => setIncludeVoices(e.target.checked)} />
              <span />混入各镜配音
            </label>
            <label className="ex-toggle" title="抽各片段中间帧测光，向均值拉齐亮度/饱和度后拼接；多一次转码">
              <input type="checkbox" checked={colorMatch} onChange={(e) => setColorMatch(e.target.checked)} />
              <span />色彩匹配（慢）
            </label>
          </div>

          {synthBusy ? (
            <div className="ex-progress">
              <div className="ex-progress-bar"><span style={{ width: `${synthProgress}%` }} /></div>
              <span className="ex-progress-t">{synthMessage} · {synthProgress}%</span>
            </div>
          ) : null}
          {synthStatus === 'error' ? (
            <div className="ex-alert ex-alert-err ex-alert-sm">{synthMessage || '合成失败'}</div>
          ) : null}

          <div className="ex-actions">
            <button
              type="button"
              className="ex-btn ex-btn-primary"
              onClick={handleSynthesize}
              disabled={videoClips.length === 0 || synthBusy}
            >
              {synthBusy ? <Loader2 size={14} className="spin" /> : <Video size={14} />}
              {videoClips.length === 0
                ? '暂无视频片段可合成'
                : synthStatus === 'done' && synthUrl
                  ? '重新合成'
                  : '合成并下载 MP4'}
            </button>
            {synthStatus === 'done' && synthUrl ? (
              <a href={synthUrl} download={synthName} className="ex-btn ex-btn-ghost">
                <Download size={14} /> 下载成片
              </a>
            ) : null}
          </div>

          <div className="ex-synth-alt">
            <div className="ex-synth-alt-l">
              <span className="ex-synth-alt-ico"><Server size={14} /></span>
              <div>
                <b>服务端合成并归档</b>
                <span>服务器 ffmpeg 拼接后归档到「项目资产」，不依赖浏览器跨域</span>
              </div>
            </div>
            <button
              type="button"
              className="ex-btn ex-btn-quiet"
              onClick={handleServerAssemble}
              disabled={videoClips.length === 0 || assembling}
            >
              {assembling ? <Loader2 size={13} className="spin" /> : <Upload size={13} />}
              {assembling ? '合成中…' : videoClips.length === 0 ? '暂无片段' : '开始合成'}
            </button>
          </div>
        </div>
      </section>

      {/* ⑤ 可下载交付物 */}
      <section className="ex-sec">
        <div className="ex-sec-h">
          <div><span className="ex-sec-idx">03</span><h3>可下载交付物</h3></div>
          <span className="ex-sec-meta">{deliverables.length} 项 · 点击即下载</span>
        </div>
        <div className="ex-files">
          {groups.map((g) => (
            <div key={g} className="ex-file-group">
              <div className="ex-group-h"><Layers size={12} />{g}</div>
              {deliverables.filter((d) => d.group === g).map((item) => (
                <a
                  key={item.label}
                  href={item.disabled ? undefined : item.href}
                  aria-disabled={item.disabled}
                  onClick={(e) => {
                    e.preventDefault();
                    if (item.disabled || !item.href) return;
                    exportApi.downloadDeliverable(item.href).catch(() => {
                      toast.error(`${item.label} 下载失败`);
                    });
                  }}
                  className={`ex-file${item.disabled ? ' disabled' : ''}`}
                >
                  <span className="ex-file-ico"><item.icon size={15} /></span>
                  <span className="ex-file-main">
                    <b>{item.label}</b>
                    <span>{item.desc}</span>
                  </span>
                  <span className="ex-file-tag num">{item.tag}</span>
                  <span className="ex-file-go">
                    {item.disabled ? <Circle size={13} /> : <ArrowUpRight size={14} />}
                  </span>
                </a>
              ))}
            </div>
          ))}
        </div>
      </section>

      {/* ⑥ 存为模板 */}
      <section className="ex-sec">
        <div className="ex-sec-h">
          <div><span className="ex-sec-idx">04</span><h3>沉淀为模板</h3></div>
          <span className="ex-sec-meta">时长 / 画幅 / 画风 / 导演偏好</span>
        </div>
        {showTemplateInput ? (
          <div className="ex-tpl-form">
            <input
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
              placeholder="模板名称（留空则用项目标题）"
              onKeyDown={(e) => { if (e.key === 'Enter') void handleSaveAsTemplate(); }}
            />
            <button type="button" className="ex-btn ex-btn-primary" onClick={handleSaveAsTemplate} disabled={savingTemplate}>
              {savingTemplate ? '保存中…' : '保存模板'}
            </button>
            <button type="button" className="ex-btn ex-btn-quiet" onClick={() => setShowTemplateInput(false)}>取消</button>
          </div>
        ) : (
          <button type="button" className="ex-tpl-trigger" onClick={() => setShowTemplateInput(true)}>
            <span><Sparkles size={14} /> 把当前项目参数存为可复用模板</span>
            <ArrowUpRight size={14} />
          </button>
        )}
      </section>

      <footer className="ex-foot">
        <Info size={13} />
        <span>所有文件均由当前分镜数据实时生成。首次本机合成需加载约 30MB 合成引擎；远端视频需允许跨域，否则会如实报错。</span>
      </footer>
    </div>
  );
};

export default ProjectExportTab;
