import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Film, Clapperboard, ChevronRight, Play, Image as ImageIcon, Camera,
  Sparkles, Lock, Unlock, ChevronDown, Layers, MonitorPlay, Box, Upload, Link2, X,
} from 'lucide-react';
import { storyboard, assets } from '@client/src/api';
import type { Asset, Scene, Shot } from '@shared/api.interface';
import { CAMERA_RIGS, rigById } from '@shared/camera-rigs';
import { WHITEMODEL_SOURCES, type WhitemodelSource } from '@shared/content-modes';
import { logger } from '@client/src/utils/logger';
import { Image } from '@client/src/components/ui/image';

const shotSizeOptions = [
  { value: 'close_up', label: '特写' },
  { value: 'medium_close_up', label: '中近景' },
  { value: 'medium', label: '中景' },
  { value: 'wide', label: '全景' },
  { value: 'long', label: '远景' },
  { value: 'extreme_close_up', label: '大特写' },
];
const angleOptions = [
  { value: 'eye_level', label: '平视' },
  { value: 'high', label: '俯拍' },
  { value: 'low', label: '仰拍' },
  { value: 'over_shoulder', label: '过肩' },
  { value: 'top', label: '顶拍' },
  { value: 'dutch', label: '斜角' },
];
const lensOptions = ['24mm', '35mm', '50mm', '85mm', '100mm', '135mm'];
const moveOptions = [
  { value: 'static', label: '固定' },
  { value: 'slow_push_in', label: '缓推' },
  { value: 'push_in', label: '推进' },
  { value: 'pull_out', label: '拉远' },
  { value: 'pan_left', label: '左摇' },
  { value: 'pan_right', label: '右摇' },
  { value: 'tilt_up', label: '上摇' },
  { value: 'tilt_down', label: '下摇' },
  { value: 'tracking', label: '跟拍' },
  { value: 'crane_up', label: '升降' },
];

const ProjectDirectorTab = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [shots, setShots] = useState<Shot[]>([]);
  const [selectedShotId, setSelectedShotId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedScenes, setExpandedScenes] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState<string | null>(null);

  const load = () => {
    if (!id) return;
    setLoading(true);
    // P1 N+1 修复：场景与全量镜头并行各 1 个请求（之前 1+N）
    Promise.all([
      storyboard.listScenes(id).catch((e) => { logger.error('scenes', String(e)); return [] as Scene[]; }),
      storyboard.listAllShots(id).catch((e) => { logger.error('shots', String(e)); return [] as Shot[]; }),
    ])
      .then(([sc, sh]) => {
        setScenes(sc); setShots(sh);
        setExpandedScenes(new Set(sc.map((s) => s.id)));
        if (sh.length > 0 && !selectedShotId) setSelectedShotId(sh[0].id);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  useEffect(() => { load(); }, [id]);

  const shotsByScene = useMemo(() => {
    const map = new Map<string, Shot[]>();
    scenes.forEach((s) => map.set(s.id, []));
    shots.forEach((s) => {
      if (map.has(s.sceneId)) map.get(s.sceneId)!.push(s);
      else map.set(s.sceneId, [s]);
    });
    map.forEach((arr) => arr.sort((a, b) => a.shotNumber - b.shotNumber));
    return map;
  }, [scenes, shots]);

  const selectedShot = useMemo(
    () => shots.find((s) => s.id === selectedShotId) ?? null,
    [shots, selectedShotId],
  );
  const selectedScene = useMemo(
    () => (selectedShot ? scenes.find((s) => s.id === selectedShot.sceneId) ?? null : null),
    [scenes, selectedShot],
  );

  const updateShot = async (patch: Partial<Shot>) => {
    if (!id || !selectedShot) return;
    setSaving(selectedShot.id);
    try {
      const updated = await storyboard.updateShot(id, selectedShot.id, patch as never);
      setShots((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
      setError(null);
    } catch (err) {
      logger.error('update shot failed', String(err));
      setError('保存镜头参数失败');
    } finally {
      setSaving(null);
    }
  };

  const toggleScene = (sceneId: string) => {
    setExpandedScenes((prev) => {
      const next = new Set(prev);
      // P1 lint 修复：三元表达式作语句改 if/else
      if (next.has(sceneId)) next.delete(sceneId);
      else next.add(sceneId);
      return next;
    });
  };

  const selectControl = <T extends string>(current: string | undefined, options: { value: string; label: string }[], onPick: (v: T) => void) => (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onPick(o.value as T)}
          className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${
            current === o.value
              ? 'bg-primary text-primary-foreground'
              : 'border border-input bg-white text-foreground/70 hover:border-primary hover:text-primary'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );

  return (
    <div className="space-y-4">
      {/* 标题 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-foreground">导演台</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            项目树 · 实时监看 · 导演控制，像真正的导演一样掌控每个镜头
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">
            共 {shots.length} 个镜头 · {scenes.length} 场
          </span>
          <button onClick={() => navigate(`/project/${id}/canvas`)} className="flex items-center gap-1.5 rounded-lg border border-input bg-white px-3 py-1.5 text-xs font-medium text-foreground hover:border-primary hover:text-primary">
            <Layers className="h-3.5 w-3.5" /> 打开无限画布
          </button>
        </div>
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-600">{error}</div>}

      {loading ? (
        <div className="rounded-xl border bg-white p-12 text-center text-sm text-muted-foreground">加载中...</div>
      ) : shots.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-white p-12 text-center">
          <div className="text-sm text-muted-foreground">暂无镜头，请先在「分镜」标签页创建场景与镜头</div>
          <button onClick={() => navigate(`/project/${id}/storyboard`)} className="mt-4 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">去分镜</button>
        </div>
      ) : (
        <div className="flex flex-col gap-4 xl:flex-row">
          {/* 左：项目树 */}
          <div className="w-full shrink-0 rounded-xl border bg-white p-3 shadow-sm xl:w-64">
            <div className="mb-2 flex items-center gap-1.5 px-1 text-xs font-medium text-muted-foreground">
              <ChevronDown className="h-3 w-3" /> 项目结构
            </div>
            <div className="max-h-[560px] space-y-1 overflow-y-auto scrollbar-thin">
              {scenes.map((scene) => {
                const sshots = shotsByScene.get(scene.id) ?? [];
                const expanded = expandedScenes.has(scene.id);
                return (
                  <div key={scene.id}>
                    <button
                      onClick={() => toggleScene(scene.id)}
                      className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-sm font-medium text-foreground hover:bg-muted/50"
                    >
                      <ChevronRight className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${expanded ? 'rotate-90' : ''}`} />
                      <Clapperboard className="h-3.5 w-3.5 text-primary" />
                      <span className="truncate">{scene.title || `第 ${scene.sceneNumber} 场`}</span>
                      <span className="ml-auto text-[10px] text-muted-foreground">{sshots.length}</span>
                    </button>
                    {expanded && (
                      <div className="ml-4 space-y-0.5 border-l border-border pl-2">
                        {sshots.map((s) => (
                          <button
                            key={s.id}
                            onClick={() => setSelectedShotId(s.id)}
                            className={`flex w-full items-center gap-1.5 rounded-lg px-2 py-1 text-left text-xs ${
                              selectedShotId === s.id ? 'bg-primary/10 text-primary' : 'text-foreground/70 hover:bg-muted/50'
                            }`}
                          >
                            <Film className="h-3 w-3 shrink-0" />
                            <span className="truncate">镜 {s.shotNumber} · {s.shotSize || '中景'}</span>
                            {s.locked && <Lock className="ml-auto h-3 w-3 shrink-0 text-muted-foreground" />}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* 中：实时监看 */}
          <div className="flex-1">
            <div className="rounded-xl border bg-white p-4 shadow-sm">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <MonitorPlay className="h-4 w-4 text-primary" />
                  <span className="text-sm font-semibold text-foreground">
                    实时监看 {selectedShot ? `· 镜 ${selectedShot.shotNumber}` : ''}
                  </span>
                  {selectedScene && (
                    <span className="text-xs text-muted-foreground">{selectedScene.title}</span>
                  )}
                </div>
                {selectedShot?.locked && (
                  <span className="flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-600">
                    <Lock className="h-3 w-3" /> 已锁定
                  </span>
                )}
              </div>
              {selectedShot ? (
                <>
                  <div className="relative overflow-hidden rounded-xl border bg-muted/20">
                    {selectedShot.referenceImageUrls?.[0] || selectedShot.startFrameUrl ? (
                      <Image
                        src={selectedShot.referenceImageUrls?.[0] || selectedShot.startFrameUrl}
                        alt={`镜 ${selectedShot.shotNumber}`}
                        className="aspect-video w-full object-cover"
                      />
                    ) : (
                      <div className="flex aspect-video w-full flex-col items-center justify-center gap-2 bg-gradient-to-br from-primary/10 via-[#FF7A3A]/10 to-purple-500/10">
                        <ImageIcon className="h-10 w-10 text-muted-foreground/40" />
                        <span className="text-xs text-muted-foreground">该镜头尚未生成画面，可点击下方「生成图片」</span>
                      </div>
                    )}
                    <span className="absolute left-2 top-2 rounded bg-black/40 px-2 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm">
                      {selectedShot.shotSize || '中景'} · {selectedShot.lens || '50mm'} · {selectedShot.cameraAngle || '平视'}
                    </span>
                    {selectedShot.videoUrl && (
                      <span className="absolute bottom-2 right-2 flex items-center gap-1 rounded bg-black/50 px-2 py-0.5 text-[10px] text-white backdrop-blur-sm">
                        <Play className="h-3 w-3" /> 已生成视频
                      </span>
                    )}
                  </div>
                  <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="rounded-lg bg-muted/40 p-3">
                      <div className="text-[10px] font-medium text-muted-foreground">画面描述</div>
                      <div className="mt-1 text-xs leading-relaxed text-foreground/80">
                        {selectedShot.visualPrompt || selectedShot.action || '暂无画面描述'}
                      </div>
                    </div>
                    <div className="rounded-lg bg-muted/40 p-3">
                      <div className="text-[10px] font-medium text-muted-foreground">对白 / 情绪</div>
                      <div className="mt-1 text-xs leading-relaxed text-foreground/80">
                        {selectedShot.dialogue ? `「${selectedShot.dialogue}」` : '无对白'}
                        {selectedShot.emotion ? `（${selectedShot.emotion}）` : ''}
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    <button
                      onClick={() => navigate(`/project/${id}/storyboard?shot=${selectedShot.id}`)}
                      className="flex items-center gap-1.5 rounded-lg border border-input bg-white px-3 py-1.5 text-xs font-medium text-foreground hover:border-primary hover:text-primary"
                    >
                      <Sparkles className="h-3.5 w-3.5" /> 生成图片
                    </button>
                    <button
                      onClick={() => navigate(`/project/${id}/storyboard?shot=${selectedShot.id}`)}
                      className="flex items-center gap-1.5 rounded-lg border border-input bg-white px-3 py-1.5 text-xs font-medium text-foreground hover:border-primary hover:text-primary"
                    >
                      <Play className="h-3.5 w-3.5" /> 生成视频
                    </button>
                    <VariantButton projectId={id ?? ''} shot={selectedShot} onError={setError} />
                    <button
                      onClick={() => updateShot({ locked: !selectedShot.locked })}
                      className="flex items-center gap-1.5 rounded-lg border border-input bg-white px-3 py-1.5 text-xs font-medium text-foreground hover:border-primary hover:text-primary"
                    >
                      {selectedShot.locked ? <Unlock className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
                      {selectedShot.locked ? '解锁' : '锁定'}
                    </button>
                    {saving === selectedShot.id && <span className="text-[10px] text-muted-foreground">保存中...</span>}
                  </div>
                </>
              ) : (
                <div className="flex aspect-video items-center justify-center rounded-xl border border-dashed bg-muted/20 text-sm text-muted-foreground">
                  从左侧选择镜头开始导演
                </div>
              )}
            </div>
          </div>

          {/* 右：导演控制 */}
          <div className="w-full shrink-0 space-y-3 xl:w-72">
            {selectedShot && (
              <div className="rounded-xl border bg-white p-4 shadow-sm">
                <div className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-foreground">
                  <Camera className="h-4 w-4 text-primary" /> 导演控制
                </div>
                <div className="space-y-4">
                  <div>
                    <div className="mb-1.5 text-[11px] font-medium text-muted-foreground">景别</div>
                    {selectControl(selectedShot.shotSize, shotSizeOptions, (v) => updateShot({ shotSize: v }))}
                  </div>
                  <div>
                    <div className="mb-1.5 text-[11px] font-medium text-muted-foreground">机位 / 角度</div>
                    {selectControl(selectedShot.cameraAngle, angleOptions, (v) => updateShot({ cameraAngle: v }))}
                  </div>
                  <div>
                    <div className="mb-1.5 text-[11px] font-medium text-muted-foreground">镜头焦段</div>
                    <div className="flex flex-wrap gap-1.5">
                      {lensOptions.map((l) => (
                        <button
                          key={l}
                          onClick={() => updateShot({ lens: l })}
                          className={`rounded-md px-2.5 py-1 text-[11px] font-medium ${
                            selectedShot.lens === l
                              ? 'bg-primary text-primary-foreground'
                              : 'border border-input bg-white text-foreground/70 hover:border-primary hover:text-primary'
                          }`}
                        >
                          {l}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="mb-1.5 text-[11px] font-medium text-muted-foreground">运镜</div>
                    {selectControl(selectedShot.movement, moveOptions, (v) => updateShot({ movement: v }))}
                  </div>
                </div>
              </div>
            )}
            {/* 机位预设（白模产线 · 十种机位类型，一键统一运镜口径） */}
            {selectedShot && (
              <div className="rounded-xl border bg-white p-4 shadow-sm">
                <div className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-foreground">
                  <Clapperboard className="h-4 w-4 text-primary" /> 机位预设
                </div>
                <p className="mb-2 text-[10px] leading-relaxed text-muted-foreground">
                  套用后同步景别之外的运镜三件套（运镜/角度/焦段），视频 prompt 自动带入运镜事实
                </p>
                <div className="grid grid-cols-2 gap-1.5">
                  {CAMERA_RIGS.map((r) => {
                    const active = rigById(selectedShot.movement)?.id === r.id;
                    return (
                      <button
                        key={r.id}
                        title={r.description}
                        onClick={() => updateShot({ movement: r.movement, cameraAngle: r.cameraAngle, lens: r.lens })}
                        className={`rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
                          active
                            ? 'bg-primary text-primary-foreground'
                            : 'border border-input bg-white text-foreground/70 hover:border-primary hover:text-primary'
                        }`}
                      >
                        {r.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            {/* 白模参考（空间关系/运镜路径/时间节奏以白模为准，材质以首帧图为准） */}
            {selectedShot && (
              <WhitemodelCard
                projectId={id ?? ''}
                shot={selectedShot}
                onChanged={(s) => setShots((prev) => prev.map((x) => (x.id === s.id ? s : x)))}
                onError={setError}
              />
            )}
            {/* 底部时间线条预览 */}
            <div className="rounded-xl border bg-white p-3 shadow-sm">
              <div className="mb-2 text-[11px] font-medium text-muted-foreground">全片镜头流</div>
              <div className="flex flex-wrap gap-1">
                {shots.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => setSelectedShotId(s.id)}
                    className={`h-7 w-9 rounded-md text-[9px] font-medium transition-colors ${
                      selectedShotId === s.id
                        ? 'bg-primary text-primary-foreground'
                        : s.status === 'ready'
                          ? 'bg-green-100 text-green-700'
                          : 'bg-muted text-foreground/60'
                    }`}
                    title={`镜 ${s.shotNumber}`}
                  >
                    {s.shotNumber}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

/**
 * P2-2 运镜变体按钮：同一镜按运镜轮换生成 3 个视频变体（可复现、可解释），
 * 变体组标签供后续按 Hook率/Hold率/CPA 评估。Hook 换文案需 LLM，不在此做。
 */
const VariantButton = ({
  projectId,
  shot,
  onError,
}: {
  projectId: string;
  shot: Shot;
  onError: (msg: string | null) => void;
}) => {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <span className="flex items-center gap-2">
      <button
        disabled={busy}
        title="同一镜按运镜轮换生成3个视频变体（任务组标签variantGroup）"
        onClick={async () => {
          setBusy(true);
          try {
            const res = await storyboard.createShotVariants(projectId, shot.id, { count: 3 });
            setMsg(`变体组 ${res.groupId} 已建 ${res.jobIds.length} 个任务，去任务页查看`);
            onError(null);
          } catch (e) {
            logger.error('create variants failed', String(e));
            onError('变体任务创建失败');
          } finally {
            setBusy(false);
          }
        }}
        className="flex items-center gap-1.5 rounded-lg border border-input bg-white px-3 py-1.5 text-xs font-medium text-foreground hover:border-primary hover:text-primary disabled:opacity-50"
      >
        <Layers className="h-3.5 w-3.5" /> {busy ? '创建中…' : '运镜变体×3'}
      </button>
      {msg && <span className="text-[10px] text-muted-foreground">{msg}</span>}
    </span>
  );
};

const WhitemodelCard = ({  projectId,
  shot,
  onChanged,
  onError,
}: {
  projectId: string;
  shot: Shot;
  onChanged: (s: Shot) => void;
  onError: (msg: string | null) => void;
}) => {
  const [busy, setBusy] = useState(false);
  const [urlInput, setUrlInput] = useState('');
  const [showUrl, setShowUrl] = useState(false);
  const [assetOptions, setAssetOptions] = useState<Asset[]>([]);
  const [showAssets, setShowAssets] = useState(false);
  // 白模来源（选填标注）：director 导演台录制 / sora 外部生成 /
  // gpt6_code GPT-6场景代码 / url URL登记；只影响元数据与R2V路由提示
  const [source, setSource] = useState<WhitemodelSource>(
    (shot.whitemodelMeta?.source as WhitemodelSource) || 'director',
  );

  const save = async (patch: Partial<Shot>) => {
    setBusy(true);
    try {
      const updated = await storyboard.updateShot(projectId, shot.id, patch as never);
      onChanged(updated);
      onError(null);
    } catch (e) {
      logger.error('whitemodel save failed', String(e));
      onError('白模绑定保存失败');
    } finally {
      setBusy(false);
    }
  };

  const handleFile = async (file: File) => {
    if (!/^video\/(webm|mp4)$/.test(file.type)) {
      onError('仅支持 webm / mp4 白模视频');
      return;
    }
    setBusy(true);
    try {
      const { asset, fileUrl } = await assets.uploadLocalFile(
        projectId,
        file,
        `whitemodel-${Date.now()}.${file.type === 'video/mp4' ? 'mp4' : 'webm'}`,
        shot.duration,
      );
      const updated = await storyboard.updateShot(projectId, shot.id, {
        whitemodelUrl: fileUrl,
        whitemodelMeta: {
          durationSeconds: shot.duration,
          rigId: rigById(shot.movement)?.id,
          movement: shot.movement,
          source,
          assetId: asset.id,
          createdAt: new Date().toISOString(),
        },
      } as never);
      onChanged(updated);
      onError(null);
    } catch (e) {
      logger.error('whitemodel upload failed', String(e));
      onError('白模上传失败（文件需 ≤25MB，后端服务需在线）');
    } finally {
      setBusy(false);
    }
  };

  const loadAssets = async () => {
    setBusy(true);
    try {
      const res = await assets.listAssets({ projectId, assetType: 'video', pageSize: 50 });
      setAssetOptions(res.items.filter((a) => a.sourceType === 'whitemodel' && a.fileUrl));
      setShowAssets((v) => !v);
    } catch (e) {
      logger.error('whitemodel assets failed', String(e));
      onError('白模资产列表加载失败');
    } finally {
      setBusy(false);
    }
  };

  const meta = shot.whitemodelMeta;
  return (
    <div className="rounded-xl border bg-white p-4 shadow-sm">
      <div className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-foreground">
        <Box className="h-4 w-4 text-primary" /> 白模参考
      </div>
      <p className="mb-2 text-[10px] leading-relaxed text-muted-foreground">
        空间关系/运镜路径/时间节奏继承白模；材质光影继承首帧图。云端 R2V 直喂需公网 URL，当前本地 URL 先做存档与质检核对。
      </p>
      <div className="mb-2 flex items-center gap-1.5">
        <span className="text-[10px] text-muted-foreground">来源</span>
        <div className="flex flex-wrap gap-1">
          {WHITEMODEL_SOURCES.map((s) => (
            <button
              key={s.id}
              title={s.description}
              disabled={busy}
              onClick={() => {
                setSource(s.id);
                if (shot.whitemodelUrl) {
                  void save({
                    whitemodelMeta: { ...(shot.whitemodelMeta ?? {}), source: s.id },
                  } as never);
                }
              }}
              className={`rounded-md px-2 py-0.5 text-[10px] font-medium transition-colors ${
                source === s.id
                  ? 'bg-primary text-primary-foreground'
                  : 'border border-input bg-white text-foreground/60 hover:border-primary hover:text-primary'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>
      {shot.whitemodelUrl ? (
        <div className="space-y-2">
          <video src={shot.whitemodelUrl} controls className="aspect-video w-full rounded-lg bg-black" />
          {meta && (
            <div className="text-[10px] text-muted-foreground">
              {typeof meta.durationSeconds === 'number' ? `时长 ${meta.durationSeconds}s` : ''}
              {meta.movement ? ` · 运镜 ${meta.movement}` : ''}
              {meta.source ? ` · 来源 ${WHITEMODEL_SOURCES.find((s) => s.id === meta.source)?.label ?? meta.source}` : ''}
            </div>
          )}
          <button
            disabled={busy}
            onClick={() => save({ whitemodelUrl: null, whitemodelMeta: undefined } as never)}
            className="flex items-center gap-1.5 rounded-lg border border-input bg-white px-3 py-1.5 text-xs font-medium text-foreground hover:border-red-400 hover:text-red-500 disabled:opacity-50"
          >
            <X className="h-3.5 w-3.5" /> 清除绑定
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <label className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-input bg-white px-3 py-1.5 text-xs font-medium text-foreground hover:border-primary hover:text-primary">
            <Upload className="h-3.5 w-3.5" /> {busy ? '处理中…' : '上传白模视频'}
            <input
              type="file"
              accept="video/webm,video/mp4"
              className="hidden"
              disabled={busy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) void handleFile(f);
              }}
            />
          </label>
          <button
            disabled={busy}
            onClick={() => void loadAssets()}
            className="flex w-full items-center gap-1.5 rounded-lg border border-input bg-white px-3 py-1.5 text-xs font-medium text-foreground hover:border-primary hover:text-primary disabled:opacity-50"
          >
            <Film className="h-3.5 w-3.5" /> 从白模资产选择
          </button>
          {showAssets && (
            <div className="max-h-32 space-y-1 overflow-y-auto rounded-lg bg-muted/40 p-2">
              {assetOptions.length === 0 && (
                <div className="text-[10px] text-muted-foreground">暂无白模资产（去自由画布 3D 导演台录制后上传）</div>
              )}
              {assetOptions.map((a) => (
                <button
                  key={a.id}
                  disabled={busy}
                  onClick={() => save({
                    whitemodelUrl: a.fileUrl,
                    whitemodelMeta: {
                      durationSeconds: a.durationSeconds ?? shot.duration,
                      rigId: rigById(shot.movement)?.id,
                      movement: shot.movement,
                      source,
                      assetId: a.id,
                      createdAt: new Date().toISOString(),
                    },
                  } as never)}
                  className="block w-full truncate rounded px-2 py-1 text-left text-[11px] text-foreground/80 hover:bg-white"
                >
                  {a.name}
                </button>
              ))}
            </div>
          )}
          {!showUrl ? (
            <button
              onClick={() => setShowUrl(true)}
              className="flex w-full items-center gap-1.5 rounded-lg border border-input bg-white px-3 py-1.5 text-xs font-medium text-foreground hover:border-primary hover:text-primary"
            >
              <Link2 className="h-3.5 w-3.5" /> URL 登记（公网白模）
            </button>
          ) : (
            <div className="flex gap-1.5">
              <input
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                placeholder="https://…/whitemodel.mp4"
                className="min-w-0 flex-1 rounded-lg border border-input bg-white px-2 py-1.5 text-xs outline-none focus:border-primary"
              />
              <button
                disabled={busy || !urlInput.trim()}
                onClick={() => {
                  setShowUrl(false);
                  void save({
                    whitemodelUrl: urlInput.trim(),
                    whitemodelMeta: {
                      durationSeconds: shot.duration,
                      rigId: rigById(shot.movement)?.id,
                      movement: shot.movement,
                      source,
                      createdAt: new Date().toISOString(),
                    },
                  } as never);
                  setUrlInput('');
                }}
                className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
              >
                绑定
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ProjectDirectorTab;
