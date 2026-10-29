import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Grid3X3,
  List,
  Sparkles,
  Play,
  RefreshCw,
  Lock,
  Trash2,
  ChevronUp,
  ChevronDown,
  Filter,
  Mic,
  Clapperboard,
} from 'lucide-react';
import { storyboard } from '@client/src/api';
import type { Shot, Scene } from '@shared/api.interface';
import { logger } from '@client/src/utils/logger';
import { showConfirm } from '@client/src/components/ui/confirm';
import { toast } from 'sonner';
import { MediaOrMissing } from '@client/src/components/MediaOrMissing';

const statusConfig: Record<string, { label: string; className: string }> = {
  draft: { label: '草稿', className: 'bg-gray-100 text-gray-600' },
  queued: { label: '排队中', className: 'bg-amber-50 text-amber-600' },
  pending: { label: '等待中', className: 'bg-gray-100 text-gray-600' },
  generating: { label: '生成中', className: 'bg-blue-50 text-blue-600' },
  running: { label: '生成中', className: 'bg-blue-50 text-blue-600' },
  ready: { label: '已就绪', className: 'bg-green-50 text-green-600' },
  completed: { label: '已完成', className: 'bg-green-50 text-green-600' },
  succeeded: { label: '已完成', className: 'bg-green-50 text-green-600' },
  failed: { label: '失败', className: 'bg-red-50 text-red-600' },
};

const getStatusInfo = (status: string) =>
  statusConfig[status] || { label: status, className: 'bg-gray-100 text-gray-600' };

const shotSizeLabels: Record<string, string> = {
  close_up: '特写',
  close_up_shot: '特写',
  medium_close_up: '近景',
  medium_shot: '中景',
  medium_long_shot: '全景',
  long_shot: '远景',
  wide_shot: '全景',
  extreme_close_up: '大特写',
  over_the_shoulder: '过肩',
};

const ProjectStoryboardTab = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [shots, setShots] = useState<Shot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedScene, setSelectedScene] = useState<string>('all');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [batching, setBatching] = useState(false);
  const [regeneratingIds, setRegeneratingIds] = useState<Set<string>>(new Set());
  // P2 修复（方案断点7）：提示词编辑搬进行卡片展开区——改 prompt 与重跑单镜同处完成
  const [promptDrafts, setPromptDrafts] = useState<Record<string, string>>({});
  const [savingPromptIds, setSavingPromptIds] = useState<Set<string>>(new Set());

  const handleSavePrompt = async (shot: Shot, rerun?: 'image') => {
    if (!id) return;
    const draft = promptDrafts[shot.id];
    if (draft === undefined) return;
    setSavingPromptIds((prev) => new Set(prev).add(shot.id));
    try {
      await storyboard.updateShot(id, shot.id, { visualPrompt: draft });
      setShots((prev) =>
        prev.map((s) => (s.id === shot.id ? { ...s, visualPrompt: draft } : s)),
      );
      setPromptDrafts((prev) => {
        const next = { ...prev };
        delete next[shot.id];
        return next;
      });
      if (rerun === 'image') {
        await storyboard.rerunShot(id, shot.id, { type: 'image' });
        toast.success('提示词已保存，已重跑该镜首帧');
      } else {
        toast.success('提示词已保存');
      }
    } catch (err) {
      logger.error('Save prompt failed:', String(err));
      toast.error('提示词保存失败');
    } finally {
      setSavingPromptIds((prev) => {
        const next = new Set(prev);
        next.delete(shot.id);
        return next;
      });
    }
  };

  // P1 配音闭环：试听 + 不满意重配（之前配音只有 URL 存着，无处可听）
  const handleVoice = async (shot: Shot) => {
    if (!id) return;
    setRegeneratingIds((prev) => new Set(prev).add(shot.id));
    try {
      await storyboard.generateShotVoiceAt(id, shot.id);
      toast.success('配音任务已发起，可在任务页查看进度');
    } catch (err) {
      logger.error('Voice failed:', String(err));
      setError('配音发起失败');
    } finally {
      setTimeout(() => {
        setRegeneratingIds((prev) => {
          const next = new Set(prev);
          next.delete(shot.id);
          return next;
        });
      }, 2000);
    }
  };
  const handleBatchGenerate = async () => {
    if (!id || shots.length === 0 || batching) return;
    if (!await showConfirm(`将为全部 ${shots.length} 个镜头创建图片生成任务，继续吗？`)) return;
    setBatching(true);
    try {
      await storyboard.batchGenerate(id, { type: 'image' });
      navigate(`/project/${id}/tasks`);
    } catch (err) {
      logger.error('Batch generate failed:', String(err));
      setError('批量生成发起失败');
    } finally {
      setBatching(false);
    }
  };

  const handleOneClick = async () => {
    if (!id || shots.length === 0 || batching) return;
    if (!await showConfirm(`一键成片：先批量生成全部 ${shots.length} 镜首帧图，再批量生成视频（图优先认领），继续吗？`)) return;
    setBatching(true);
    try {
      const res = await storyboard.oneClickGenerate(id, {});
      navigate(`/project/${id}/tasks`);
    } catch (err) {
      logger.error('One-click generate failed:', String(err));
      setError('一键成片发起失败');
    } finally {
      setBatching(false);
    }
  };

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    storyboard.listScenes(id)
      .then(async (sceneData) => {
        setScenes(sceneData);
        // P1 N+1 修复：一次取全量镜头（之前按场景逐个查询）
        try {
          const allShots = await storyboard.listAllShots(id);
          setShots(allShots.sort((a, b) => a.shotNumber - b.shotNumber));
        } catch {
          // skip
        }
      })
      .catch((err) => {
        logger.error('Failed to load storyboard:', String(err));
        setError('加载分镜失败');
      })
      .finally(() => setLoading(false));
  }, [id]);

  const filteredShots = selectedScene === 'all'
    ? shots
    : shots.filter((s) => s.sceneId === selectedScene);

  const handleRerun = async (shot: Shot, type: 'image' | 'video') => {
    if (!id) return;
    setRegeneratingIds((prev) => new Set(prev).add(shot.id));
    try {
      // P1 断链修复：rerun 签名已改为 (projectId, shotId, {type})
      await storyboard.rerunShot(id, shot.id, { type });
    } catch (err) {
      logger.error('Rerun failed:', String(err));
      setError('重生成失败');
    } finally {
      setTimeout(() => {
        setRegeneratingIds((prev) => {
          const next = new Set(prev);
          next.delete(shot.id);
          return next;
        });
      }, 2000);
    }
  };

  const handleMove = async (index: number, direction: 'up' | 'down') => {
    if (!id) return;
    if (direction === 'up' && index === 0) return;
    if (direction === 'down' && index === filteredShots.length - 1) return;
    const newShots = [...filteredShots];
    const targetIdx = direction === 'up' ? index - 1 : index + 1;
    const a = newShots[index];
    const b = newShots[targetIdx];
    // P1 修复：排序持久化到后端（交换 shotNumber；之前只改本地，刷新即丢）
    try {
      await storyboard.updateShot(id, a.id, { shotNumber: b.shotNumber });
      await storyboard.updateShot(id, b.id, { shotNumber: a.shotNumber });
      setShots((prev) =>
        prev
          .map((s) =>
            s.id === a.id ? { ...s, shotNumber: b.shotNumber }
            : s.id === b.id ? { ...s, shotNumber: a.shotNumber }
            : s,
          )
          .sort((x, y) => x.shotNumber - y.shotNumber),
      );
    } catch (err) {
      logger.error('Move shot failed:', String(err));
      setError('调整顺序失败');
    }
  };

  const handleDelete = async (shotId: string) => {
    if (!id) return;
    if (!await showConfirm('确定删除这个分镜吗？')) return;
    // P1 修复：删除落库（之前只删本地，刷新即恢复）
    try {
      await storyboard.deleteShot(id, shotId);
      setShots((prev) => prev.filter((s) => s.id !== shotId));
      toast.success('已删除');
    } catch (err) {
      logger.error('Delete shot failed:', String(err));
      setError('删除失败');
    }
  };

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-600">
          {error}
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground">分镜故事板</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            共 {shots.length} 个分镜 · {scenes.length} 个场景
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <select
              value={selectedScene}
              onChange={(e) => setSelectedScene(e.target.value)}
              className="h-9 rounded-lg border border-input bg-white px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
            >
              <option value="all">全部场景</option>
              {scenes.map((scene) => (
                <option key={scene.id} value={scene.id}>
                  场景 {scene.sceneNumber}：{scene.title || scene.summary?.slice(0, 15) || scene.id.slice(0, 8)}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center rounded-lg border border-input bg-white p-0.5">
            <button
              onClick={() => setViewMode('grid')}
              className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors ${
                viewMode === 'grid' ? 'bg-primary/10 text-primary' : 'text-muted-foreground'
              }`}
              title="网格视图"
            >
              <Grid3X3 className="h-4 w-4" />
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors ${
                viewMode === 'list' ? 'bg-primary/10 text-primary' : 'text-muted-foreground'
              }`}
              title="列表视图"
            >
              <List className="h-4 w-4" />
            </button>
          </div>

          <button
            onClick={handleBatchGenerate}
            disabled={batching || shots.length === 0}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90 disabled:opacity-50"
          >
            <span className="flex items-center gap-1.5">
              <Sparkles className="h-4 w-4" />
              {batching ? '发起中...' : `批量生成图片（${shots.length} 镜）`}
            </span>
          </button>
          <button
            onClick={handleOneClick}
            disabled={batching || shots.length === 0}
            title="先图后片一次建完，去任务页看进度，成片用导出页合成"
            className="rounded-lg border border-primary px-4 py-2 text-sm font-medium text-primary hover:bg-primary/5 disabled:opacity-50"
          >
            <span className="flex items-center gap-1.5">
              <Clapperboard className="h-4 w-4" />
              {batching ? '发起中...' : '一键成片'}
            </span>
          </button>
        </div>
      </div>

      {/* Shots grid */}
      {loading ? (
        <div className="text-sm text-muted-foreground">加载中...</div>
      ) : filteredShots.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-white p-12 text-center">
          <div className="text-sm text-muted-foreground">
            暂无分镜，请先生成分镜故事板
          </div>
        </div>
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {filteredShots.map((shot, idx) => {
            const statusInfo = getStatusInfo(shot.status);
            const isExpanded = expandedId === shot.id;
            const isRegenerating = regeneratingIds.has(shot.id);
            return (
              <div
                key={shot.id}
                className="overflow-hidden rounded-xl border bg-white shadow-sm transition-all hover:shadow-md"
              >
                {/* Thumbnail */}
                <div
                  className="relative aspect-[9/16] w-full cursor-pointer"
                  onClick={() => setExpandedId(isExpanded ? null : shot.id)}
                >
                  <MediaOrMissing
                    src={shot.startFrameUrl}
                    alt={`Shot ${shot.shotNumber}`}
                    className="h-full w-full"
                  />
                  {isRegenerating && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-xs font-medium text-white backdrop-blur-sm">
                      生成中...
                    </div>
                  )}
                  {shot.locked && (
                    <div className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-sm">
                      <Lock className="h-3 w-3" />
                    </div>
                  )}
                  <div className="absolute left-2 top-2 rounded-md bg-black/50 px-1.5 py-0.5 text-xs font-medium text-white backdrop-blur-sm">
                    #{shot.shotNumber}
                  </div>
                </div>

                {/* Info */}
                <div className="p-3">
                  <div className="flex items-center justify-between gap-1">
                    <div className="flex items-center gap-1">
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                        {shotSizeLabels[shot.shotSize] || shot.shotSize || '中景'}
                      </span>
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                        {shot.movement || '固定'}
                      </span>
                    </div>
                    <span
                      className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${statusInfo.className}`}
                    >
                      {statusInfo.label}
                    </span>
                  </div>
                  <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">
                    {shot.visualPrompt || shot.action || '暂无描述'}
                  </p>

                  {/* Actions */}
                  <div className="mt-3 flex items-center gap-1">
                    <button
                      onClick={() => handleRerun(shot, 'image')}
                      disabled={isRegenerating}
                      className="flex flex-1 items-center justify-center gap-1 rounded-md border border-input bg-white py-1 text-[11px] font-medium text-foreground hover:border-primary hover:text-primary disabled:opacity-50"
                    >
                      <RefreshCw className="h-3 w-3" />
                      重生成
                    </button>
                    <button
                      onClick={() => handleRerun(shot, 'video')}
                      disabled={isRegenerating}
                      className="flex flex-1 items-center justify-center gap-1 rounded-md border border-input bg-white py-1 text-[11px] font-medium text-foreground hover:border-primary hover:text-primary disabled:opacity-50"
                    >
                      <Play className="h-3 w-3" />
                      生成视频
                    </button>
                    <button
                      onClick={() => handleMove(idx, 'up')}
                      className="flex h-6 w-6 items-center justify-center rounded-md border border-input bg-white text-muted-foreground hover:text-foreground"
                      title="上移"
                    >
                      <ChevronUp className="h-3 w-3" />
                    </button>
                    <button
                      onClick={() => handleMove(idx, 'down')}
                      className="flex h-6 w-6 items-center justify-center rounded-md border border-input bg-white text-muted-foreground hover:text-foreground"
                      title="下移"
                    >
                      <ChevronDown className="h-3 w-3" />
                    </button>
                    <button
                      onClick={() => handleDelete(shot.id)}
                      className="flex h-6 w-6 items-center justify-center rounded-md border border-input bg-white text-muted-foreground hover:text-red-500"
                      title="删除"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </div>

                {/* Expanded detail */}
                {isExpanded && (
                  <div className="border-t border-border bg-muted/20 p-3">
                    <div className="space-y-1.5 text-xs">
                      {/* P2 行内提示词编辑：改完可就地重跑单镜，不再跳导演台 */}
                      <div>
                        <span className="font-medium text-foreground">画面提示词：</span>
                        <textarea
                          value={promptDrafts[shot.id] ?? shot.visualPrompt ?? ''}
                          onChange={(e) =>
                            setPromptDrafts((prev) => ({ ...prev, [shot.id]: e.target.value }))
                          }
                          rows={3}
                          placeholder="描述这一镜的画面（将用于生成首帧图与视频）"
                          className="mt-1 w-full resize-y rounded-md border border-input bg-white p-2 text-xs outline-none focus:border-primary"
                        />
                        <div className="mt-1.5 flex items-center gap-1.5">
                          <button
                            onClick={() => handleSavePrompt(shot)}
                            disabled={
                              savingPromptIds.has(shot.id) ||
                              (promptDrafts[shot.id] ?? shot.visualPrompt ?? '') === (shot.visualPrompt ?? '')
                            }
                            className="rounded-md border border-input bg-white px-2 py-1 text-[11px] font-medium hover:border-primary hover:text-primary disabled:opacity-40"
                          >
                            {savingPromptIds.has(shot.id) ? '保存中…' : '保存'}
                          </button>
                          <button
                            onClick={() => handleSavePrompt(shot, 'image')}
                            disabled={savingPromptIds.has(shot.id) || !promptDrafts[shot.id]}
                            title="保存提示词并重跑该镜首帧"
                            className="inline-flex items-center gap-1 rounded-md border border-primary/40 bg-primary/5 px-2 py-1 text-[11px] font-medium text-primary hover:bg-primary/10 disabled:opacity-40"
                          >
                            <RefreshCw className="h-3 w-3" />
                            保存并重跑首帧
                          </button>
                        </div>
                      </div>
                      {shot.dialogue && (
                        <div>
                          <span className="font-medium text-foreground">台词：</span>
                          <span className="text-muted-foreground">{shot.dialogue}</span>
                        </div>
                      )}
                      {shot.action && (
                        <div>
                          <span className="font-medium text-foreground">动作：</span>
                          <span className="text-muted-foreground">{shot.action}</span>
                        </div>
                      )}
                      <div>
                        <span className="font-medium text-foreground">时长：</span>
                        <span className="text-muted-foreground">{shot.duration}s</span>
                      </div>
                      <div>
                        <span className="font-medium text-foreground">镜头：</span>
                        <span className="text-muted-foreground">
                          {shot.cameraAngle || '平视'} · {shot.lens || '标准'}
                        </span>
                      </div>
                      {/* P1 配音闭环：有配音可试听，无配音有对白可一键生成 */}
                      <div>
                        <span className="font-medium text-foreground">配音：</span>
                        {shot.voiceUrl ? (
                          <span className="mt-1 block">
                            <audio controls preload="none" src={shot.voiceUrl} className="h-8 w-full" />
                            <button
                              onClick={() => handleVoice(shot)}
                              disabled={isRegenerating}
                              className="mt-1.5 inline-flex items-center gap-1 rounded-md border border-input bg-white px-2 py-1 text-[11px] font-medium hover:border-primary hover:text-primary disabled:opacity-50"
                            >
                              <Mic className="h-3 w-3" />
                              不满意，重配
                            </button>
                          </span>
                        ) : shot.dialogue ? (
                          <button
                            onClick={() => handleVoice(shot)}
                            disabled={isRegenerating}
                            className="ml-1 inline-flex items-center gap-1 rounded-md border border-input bg-white px-2 py-1 text-[11px] font-medium hover:border-primary hover:text-primary disabled:opacity-50"
                          >
                            <Mic className="h-3 w-3" />
                            生成配音
                          </button>
                        ) : (
                          <span className="text-muted-foreground">暂无（先填写对白）</span>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        /* List view */
        <div className="overflow-hidden rounded-xl border bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-muted/30">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">#</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">预览</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">景别</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">描述</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">状态</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">操作</th>
              </tr>
            </thead>
            <tbody>
              {filteredShots.map((shot, idx) => {
                const statusInfo = getStatusInfo(shot.status);
                return (
                  <tr key={shot.id} className="border-t border-border">
                    <td className="px-4 py-3 font-medium text-foreground">
                      #{shot.shotNumber}
                    </td>
                    <td className="px-4 py-3">
                      <div className="h-12 w-8 overflow-hidden rounded bg-muted">
                        <MediaOrMissing
                          src={shot.startFrameUrl}
                          className="h-full w-full"
                        />
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {shotSizeLabels[shot.shotSize] || shot.shotSize || '-'}
                    </td>
                    <td className="px-4 py-3 max-w-[200px] truncate text-muted-foreground">
                      {shot.visualPrompt || shot.action || '-'}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs ${statusInfo.className}`}>
                        {statusInfo.label}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => handleRerun(shot, 'image')}
                          className="rounded-md border border-input px-2 py-1 text-xs text-foreground hover:border-primary hover:text-primary"
                        >
                          重生成
                        </button>
                        <button
                          onClick={() => handleDelete(shot.id)}
                          className="rounded-md border border-input px-2 py-1 text-xs text-muted-foreground hover:border-red-300 hover:text-red-500"
                        >
                          删除
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default ProjectStoryboardTab;
