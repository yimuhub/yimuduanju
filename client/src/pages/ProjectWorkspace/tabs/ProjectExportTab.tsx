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
    fetch(`/api/projects/${id}/export/manifest.json`)
      .then((res) => (res.ok ? res.json() : null))
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
      url: s.videoUrl as string,
      label: `镜头 #${s.shotNumber}`,
      durationSeconds: s.duration,
      voiceUrl: s.voiceUrl,
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

  const handleSynthesize = async () => {
    if (videoClips.length === 0 || synthStatus === 'working' || synthStatus === 'fetching' || synthStatus === 'loading-core') return;
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
  const deliverables = [
    {
      icon: FileText,
      label: '字幕 SRT',
      desc: `${withSubtitle} / ${shots.length} 个镜头有字幕，按镜头时长自动排轴`,
      href: `${exportBase}/subtitles.srt`,
      disabled: shots.length === 0,
    },
    {
      icon: FileText,
      label: '卡拉OK字幕 ASS',
      desc: '逐字高亮，竖屏 1080x1920，可用 ffmpeg ass 滤镜烧录（时序为均分启发式）',
      href: `${exportBase}/karaoke.ass`,
      disabled: shots.length === 0,
    },
    {
      icon: FileJson,
      label: '分镜 JSON',
      desc: '场景 + 全部镜头完整数据，可做剪辑底稿与备份',
      href: `${exportBase}/storyboard.json`,
      disabled: shots.length === 0,
    },
    {
      icon: ClipboardList,
      label: '导出清单',
      desc: '项目/计数/资产地址/质检/费用一览，交付归档用',
      href: `${exportBase}/manifest.json`,
      disabled: shots.length === 0,
    },
    {
      icon: Clapperboard,
      label: '剪映草稿（实验性）',
      desc: 'video/audio/text 三轨 draft，可导入大陆版剪映继续编辑字幕配音节奏',
      href: `${exportBase}/jianying.json`,
      disabled: shots.length === 0,
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">导出成片</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          真实可下载的交付物由当前分镜数据生成；有视频片段时可在本机合成 MP4 成片
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <div className="rounded-xl border bg-card p-6 shadow-sm">
            <h3 className="text-base font-semibold text-foreground">项目交付状态</h3>
            {loading ? (
              <p className="mt-4 text-sm text-muted-foreground">加载中...</p>
            ) : loadError ? (
              <p className="mt-4 text-sm text-red-400">分镜数据加载失败，请刷新重试</p>
            ) : (
              <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-lg bg-muted/50 p-3">
                  <div className="text-xs text-muted-foreground">镜头总数</div>
                  <div className="mt-1 text-xl font-bold text-foreground">{shots.length}</div>
                </div>
                <div className="rounded-lg bg-muted/50 p-3">
                  <div className="text-xs text-muted-foreground">累计时长</div>
                  <div className="mt-1 text-xl font-bold text-foreground">
                    {totalDuration.toFixed(1)} 秒
                  </div>
                </div>
                <div className="rounded-lg bg-muted/50 p-3">
                  <div className="text-xs text-muted-foreground">已有视频</div>
                  <div className="mt-1 text-xl font-bold text-foreground">
                    {withVideo} / {shots.length}
                  </div>
                </div>
                <div className="rounded-lg bg-muted/50 p-3">
                  <div className="text-xs text-muted-foreground">已有字幕</div>
                  <div className="mt-1 text-xl font-bold text-foreground">
                    {withSubtitle} / {shots.length}
                  </div>
                </div>
              </div>
            )}

            {/* 交付就绪检查（对标 ArcReel Definition of Done；全部来自真实数据） */}
            {!loading && !loadError && shots.length > 0 && (
              <div className="mt-4 rounded-lg border border-border p-3">
                <div className="text-xs font-medium text-foreground">交付就绪检查</div>
                <div className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                  {readiness.map((item) => (
                    <div key={item.label} className="flex items-center gap-2 text-xs">
                      {item.done ? (
                        <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                      ) : (
                        <Circle className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
                      )}
                      <span className={item.done ? 'text-foreground' : 'text-muted-foreground'}>
                        {item.label}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-4 flex items-start gap-2 rounded-lg bg-blue-500/15 p-3 text-xs text-blue-400">
              <Info className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <p className="font-medium">导出说明</p>
                <p className="mt-0.5 opacity-80">
                  以下文件为真实交付物，点击即下载。有视频片段时可用下方「成片合成」一键生成
                  MP4（浏览器端合成或服务端 ffmpeg 合成二选一），也可下载分镜 JSON 在剪映中精修。
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-6 lg:col-span-2">
          <div className="rounded-xl border bg-card p-6 shadow-sm">
            <h3 className="text-base font-semibold text-foreground">可下载交付物</h3>
            <div className="mt-4 space-y-2">
              {deliverables.map((item) => (
                <a
                  key={item.label}
                  href={item.disabled ? undefined : item.href}
                  aria-disabled={item.disabled}
                  onClick={(e) => {
                    if (item.disabled) e.preventDefault();
                  }}
                  className={`flex items-start gap-3 rounded-lg border p-3 transition-colors ${
                    item.disabled
                      ? 'cursor-not-allowed border-border opacity-50'
                      : 'border-border hover:border-primary/50 hover:bg-primary/5'
                  }`}
                >
                  <item.icon className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                  <div className="flex-1">
                    <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                      {item.label}
                      {!item.disabled && <Download className="h-3.5 w-3.5" />}
                    </div>
                    <div className="text-xs text-muted-foreground">{item.desc}</div>
                  </div>
                </a>
              ))}
            </div>
          </div>

          <div className="rounded-xl border bg-card p-6 shadow-sm">
            <h3 className="flex items-center gap-2 text-base font-semibold text-foreground">
              <Clapperboard className="h-4 w-4" />
              成片合成（浏览器端）
            </h3>
            <p className="mt-2 text-xs text-muted-foreground">
              按镜头顺序拼接已有视频片段，在本机完成，不消耗服务端资源。
              首次使用需加载约 30MB 合成引擎（仅一次）；远端视频需允许跨域，否则会如实报错。
              混音链：BGM 自动闪避＋响度标准化（-14 LUFS），配音按镜头对位混入。
            </p>
            {/* P1-3 BGM 与配音开关 */}
            <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
              <label className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-input bg-card px-3 py-1.5 font-medium text-foreground hover:border-primary">
                <Music className="h-3.5 w-3.5" /> {bgmName ? bgmName.slice(0, 16) : '选择 BGM'}
                <input
                  type="file"
                  accept="audio/*"
                  className="hidden"
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
              {bgmName && (
                <button
                  onClick={() => {
                    if (bgmUrl) URL.revokeObjectURL(bgmUrl);
                    setBgmUrl(null);
                    setBgmName(null);
                  }}
                  className="text-muted-foreground hover:text-red-3000"
                >
                  移除
                </button>
              )}
              <label className="flex cursor-pointer items-center gap-1.5 text-muted-foreground">
                <input
                  type="checkbox"
                  checked={includeVoices}
                  onChange={(e) => setIncludeVoices(e.target.checked)}
                  className="accent-primary"
                />
                混入各镜配音
              </label>
              <label className="flex cursor-pointer items-center gap-1.5 text-muted-foreground" title="抽各片段中间帧测光，向均值拉齐亮度/饱和度后拼接；多一次转码">
                <input
                  type="checkbox"
                  checked={colorMatch}
                  onChange={(e) => setColorMatch(e.target.checked)}
                  className="accent-primary"
                />
                色彩匹配（慢）
              </label>
            </div>
            <div className="mt-3 text-sm text-muted-foreground">
              可合成片段：<span className="font-semibold text-foreground">{videoClips.length}</span>
              {' / '}{shots.length} 个镜头
            </div>
            {(synthStatus === 'working' || synthStatus === 'fetching' || synthStatus === 'loading-core') && (
              <div className="mt-3">
                <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-brand-gradient transition-all"
                    style={{ width: `${synthProgress}%` }}
                  />
                </div>
                <p className="mt-1.5 text-xs text-muted-foreground">
                  {synthMessage}（{synthProgress}%）
                </p>
              </div>
            )}
            {synthStatus === 'error' && (
              <p className="mt-3 rounded-lg bg-red-500/15 p-2.5 text-xs text-red-400">{synthMessage || '合成失败'}</p>
            )}
            <div className="mt-4 flex gap-2">
              <button
                onClick={handleSynthesize}
                disabled={
                  videoClips.length === 0 ||
                  synthStatus === 'working' ||
                  synthStatus === 'fetching' ||
                  synthStatus === 'loading-core'
                }
                className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-primary py-2.5 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Video className="h-4 w-4" />
                {videoClips.length === 0
                  ? '暂无视频片段可合成'
                  : synthStatus === 'done' && synthUrl
                    ? '重新合成'
                    : '合成并下载 MP4'}
              </button>
              {synthStatus === 'done' && synthUrl && (
                <a
                  href={synthUrl}
                  download={synthName}
                  className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-primary/40 bg-primary/5 py-2.5 text-sm font-semibold text-primary hover:bg-primary/10"
                >
                  <Download className="h-4 w-4" />
                  下载成片
                </a>
              )}
            </div>
            <div className="mt-3 rounded-lg border border-dashed border-border bg-muted/30 p-3">
              <p className="text-xs text-muted-foreground">
                服务端合成：在服务器用 ffmpeg 拼接后归档到「项目资产」，资产页可直接预览下载；不依赖浏览器跨域。
              </p>
              <button
                onClick={handleServerAssemble}
                disabled={videoClips.length === 0 || assembling}
                className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg border border-primary/40 bg-card py-2 text-sm font-semibold text-primary hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Clapperboard className="h-4 w-4" />
                {assembling ? '合成中…' : videoClips.length === 0 ? '暂无片段（先生成视频）' : '服务端合成并归档资产'}
              </button>
            </div>
          </div>

          {/* W5 模板市场：项目沉淀为模板 */}
          <div className="rounded-xl border bg-card p-6 shadow-sm">
            <h3 className="text-base font-semibold text-foreground">存为模板</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              把当前项目的参数（时长/画幅/画风/导演偏好）沉淀为模板，供复用与分享
            </p>
            {showTemplateInput ? (
              <div className="mt-3 flex gap-2">
                <input
                  value={templateName}
                  onChange={(e) => setTemplateName(e.target.value)}
                  placeholder="模板名称（默认用项目标题）"
                  className="h-10 flex-1 rounded-lg border border-input px-3 text-sm outline-none focus:border-primary"
                />
                <button
                  onClick={handleSaveAsTemplate}
                  disabled={savingTemplate}
                  className="rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50"
                >
                  {savingTemplate ? '保存中...' : '保存'}
                </button>
              </div>
            ) : (
              <button
                onClick={() => setShowTemplateInput(true)}
                className="mt-3 w-full rounded-lg border border-input py-2.5 text-sm font-medium hover:border-primary hover:text-primary"
              >
                存为模板
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProjectExportTab;
