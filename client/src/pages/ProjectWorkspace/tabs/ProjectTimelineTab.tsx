import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Film, MessageSquare, Music, AudioLines, Captions, Wand2, Play,
  Clock, ChevronLeft, ChevronRight, GripVertical,
} from 'lucide-react';
import { storyboard } from '@client/src/api';
import type { Scene, Shot } from '@shared/api.interface';
import { logger } from '@client/src/utils/logger';
import { Image } from '@client/src/components/ui/image';

// 轨道定义（文档 4.4 节：Video/Character/Dialogue/BGM/SFX/Ambience/Subtitle）
const tracks = [
  { key: 'video', label: '视频 Video', icon: Film, color: 'from-primary/30 to-primary/15', border: 'border-primary/30' },
  { key: 'dialogue', label: '对白 Dialogue', icon: MessageSquare, color: 'from-blue-400/30 to-cyan-400/30', border: 'border-blue-300' },
  { key: 'bgm', label: '音乐 BGM', icon: Music, color: 'from-purple-400/30 to-pink-400/30', border: 'border-purple-300' },
  { key: 'sfx', label: '音效 SFX', icon: AudioLines, color: 'from-amber-400/30 to-orange-400/30', border: 'border-amber-300' },
  { key: 'subtitle', label: '字幕 Subtitle', icon: Captions, color: 'from-emerald-400/30 to-teal-400/30', border: 'border-emerald-300' },
];

const PX_PER_SEC = 34;
const MIN_CLIP = 48;

const ProjectTimelineTab = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [shots, setShots] = useState<Shot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedShotId, setSelectedShotId] = useState<string | null>(null);
  const [resizing, setResizing] = useState<{ id: string; startX: number; origW: number } | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

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
        if (sh.length > 0 && !selectedShotId) setSelectedShotId(sh[0].id);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  useEffect(() => { load(); }, [id]);

  const orderedShots = useMemo(
    () => [...shots].sort((a, b) => a.sceneId === b.sceneId ? a.shotNumber - b.shotNumber : (a.sortOrder || 0) - (b.sortOrder || 0)),
    [shots],
  );

  const totalDuration = useMemo(
    () => orderedShots.reduce((acc, s) => acc + (s.duration || 8), 0),
    [orderedShots],
  );

  const startXOf = (idx: number) =>
    orderedShots.slice(0, idx).reduce((acc, s) => acc + Math.max(s.duration || 8, 1) * PX_PER_SEC, 0);

  const sceneAt = (shotId: string) =>
    scenes.find((s) => s.id === shots.find((x) => x.id === shotId)?.sceneId);

  const handleResizeStart = (e: React.PointerEvent, shot: Shot) => {
    e.stopPropagation();
    setResizing({ id: shot.id, startX: e.clientX, origW: Math.max(shot.duration || 8, 1) * PX_PER_SEC });
  };

  const handleResizeMove = (e: React.PointerEvent) => {
    if (!resizing) return;
    const delta = e.clientX - resizing.startX;
    const newW = Math.max(MIN_CLIP, resizing.origW + delta);
    const newDur = Math.round((newW / PX_PER_SEC) * 10) / 10;
    setShots((prev) => prev.map((s) => (s.id === resizing.id ? { ...s, duration: newDur } : s)));
  };

  const handleResizeEnd = async () => {
    if (!resizing || !id) { setResizing(null); return; }
    const shot = shots.find((s) => s.id === resizing.id);
    setResizing(null);
    if (!shot) return;
    setSavingId(shot.id);
    try {
      await storyboard.updateShot(id, shot.id, { duration: shot.duration } as never);
    } catch (err) {
      logger.error('save duration failed', String(err));
      setError('保存镜头时长失败');
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-foreground">剪辑时间线</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            多轨道剪辑视图 —— 拖动镜头边缘调整时长，点击选中镜头
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-full border bg-card px-3 py-1 text-xs text-muted-foreground shadow-sm">
          <Clock className="h-3.5 w-3.5 text-primary" />
          总时长 {Math.round(totalDuration)}s · {orderedShots.length} 镜头
        </div>
      </div>

      {error && <div className="rounded-lg border border-red-500/30 bg-red-500/15 p-3 text-sm text-red-400">{error}</div>}

      {loading ? (
        <div className="rounded-xl border bg-card p-12 text-center text-sm text-muted-foreground">加载中...</div>
      ) : orderedShots.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-card p-12 text-center">
          <div className="text-sm text-muted-foreground">暂无镜头，请先在「分镜」标签页创建</div>
          <button onClick={() => navigate(`/project/${id}/storyboard`)} className="mt-4 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">去分镜</button>
        </div>
      ) : (
        <div className="rounded-xl border bg-card shadow-sm">
          {/* 顶部时间刻度 */}
          <div className="flex items-center gap-1 border-b border-border px-4 py-2">
            <Wand2 className="h-4 w-4 text-primary" />
            <span className="text-xs font-medium text-foreground">智能剪辑助手</span>
            <span className="text-[11px] text-muted-foreground">已按剧情节奏自动排序镜头</span>
            {savingId && <span className="ml-auto text-[10px] text-muted-foreground">保存中...</span>}
          </div>

          {/* 轨道头 + 剪辑区 */}
          <div className="flex">
            {/* 轨道标签列 */}
            <div className="w-32 shrink-0 border-r border-border">
              <div className="h-8 border-b border-border bg-muted/30 px-3 py-2 text-[10px] font-medium text-muted-foreground">镜头时间轴</div>
              {tracks.map((t) => (
                <div key={t.key} className="flex h-14 items-center gap-2 border-b border-border/50 px-3">
                  <t.icon className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-[10px] font-medium text-foreground/70">{t.label}</span>
                </div>
              ))}
            </div>

            {/* 剪辑画布 */}
            <div className="flex-1 overflow-x-auto scrollbar-thin" onPointerMove={handleResizeMove} onPointerUp={handleResizeEnd}>
              <div className="min-w-[400px]">
                {/* 刻度 */}
                <div className="relative h-8 border-b border-border bg-muted/30">
                  {Array.from({ length: Math.ceil(totalDuration) + 1 }).map((_, i) => (
                    <div key={i} className="absolute top-0 h-full border-l border-border/40" style={{ left: i * PX_PER_SEC }}>
                      <span className="ml-1 text-[9px] text-muted-foreground">{i}s</span>
                    </div>
                  ))}
                </div>
                {/* 各轨道 */}
                {tracks.map((t) => (
                  <div key={t.key} className="relative h-14 border-b border-border/50">
                    {orderedShots.map((shot, idx) => {
                      const x = startXOf(idx);
                      const w = Math.max(shot.duration || 8, 1) * PX_PER_SEC;
                      const sc = sceneAt(shot.id);
                      const isSel = selectedShotId === shot.id;
                      return (
                        <div
                          key={shot.id}
                          onClick={() => setSelectedShotId(shot.id)}
                          onDoubleClick={() => navigate(`/project/${id}/storyboard?shot=${shot.id}`)}
                          className={`absolute top-1.5 flex h-11 items-center overflow-hidden rounded-md border bg-gradient-to-r ${t.color} ${t.border} ${
                            isSel ? 'ring-2 ring-primary shadow-sm' : 'opacity-90'
                          } cursor-pointer`}
                          style={{ left: x, width: w }}
                          title={`镜 ${shot.shotNumber} · ${shot.duration}s${sc ? ` · ${sc.title}` : ''}`}
                        >
                          {t.key === 'video' && shot.referenceImageUrls?.[0] ? (
                            <Image src={shot.referenceImageUrls[0]} alt="" className="h-full w-12 shrink-0 object-cover" />
                          ) : (
                            <div className="flex h-full w-9 shrink-0 items-center justify-center bg-card/50">
                              <Film className="h-3.5 w-3.5 text-foreground/50" />
                            </div>
                          )}
                          <div className="min-w-0 flex-1 px-2">
                            <div className="flex items-center gap-1 text-[10px] font-semibold text-foreground/80">
                              <span>镜 {shot.shotNumber}</span>
                              {shot.locked && <span className="text-[8px] text-muted-foreground">🔒</span>}
                            </div>
                            <div className="truncate text-[9px] text-foreground/50">
                              {t.key === 'video' ? `${shot.shotSize || '中景'} · ${shot.duration}s` : t.key === 'dialogue' ? shot.dialogue || '—' : `${shot.duration}s`}
                            </div>
                          </div>
                          {t.key === 'video' && (
                            <div
                              className="absolute right-0 top-0 flex h-full w-2.5 cursor-ew-resize items-center justify-center bg-black/10 hover:bg-black/25"
                              onPointerDown={(e) => handleResizeStart(e, shot)}
                            >
                              <GripVertical className="h-3 w-3 text-white/60" />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* 底部选中镜头详情 */}
          {(() => {
            const sel = shots.find((s) => s.id === selectedShotId);
            if (!sel) return null;
            const sc = sceneAt(sel.id);
            return (
              <div className="flex flex-wrap items-center gap-4 border-t border-border bg-muted/20 px-4 py-3">
                <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <Play className="h-3.5 w-3.5 text-primary" />
                  镜 {sel.shotNumber}
                  {sc && <span className="text-xs font-normal text-muted-foreground">· {sc.title}</span>}
                </div>
                <span className="rounded bg-card px-2 py-0.5 text-[10px] text-muted-foreground">{sel.shotSize || '中景'}</span>
                <span className="rounded bg-card px-2 py-0.5 text-[10px] text-muted-foreground">{sel.duration}s</span>
                <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                  {sel.visualPrompt || sel.action || sel.dialogue || '暂无描述'}
                </span>
                <div className="flex items-center gap-1">
                  <button onClick={() => navigate(`/project/${id}/storyboard?shot=${sel.id}`)} className="flex items-center gap-1 rounded-md border border-input bg-card px-2.5 py-1 text-[11px] font-medium text-foreground hover:border-primary hover:text-primary">
                    <ChevronLeft className="h-3 w-3" /> 编辑
                  </button>
                  <button onClick={() => navigate(`/project/${id}/canvas-free3`)} className="flex items-center gap-1 rounded-md border border-input bg-card px-2.5 py-1 text-[11px] font-medium text-foreground hover:border-primary hover:text-primary">
                    画布 <ChevronRight className="h-3 w-3" />
                  </button>
                </div>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
};

export default ProjectTimelineTab;
