import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Plus, MapPin, Image as ImageIcon, Trash2, X, Sparkles, Clapperboard, Sun, Moon, CloudSun,
} from 'lucide-react';
import { storyboard, bible } from '@client/src/api';
import type { Scene, Location } from '@shared/api.interface';
import { logger } from '@client/src/utils/logger';
import { showConfirm } from '@client/src/components/ui/confirm';
import { MediaOrMissing } from '@client/src/components/MediaOrMissing';

const timeIcon = (t?: string) => {
  const v = (t || '').toLowerCase();
  if (v.includes('夜')) return <Moon className="h-3.5 w-3.5" />;
  if (v.includes('晨')) return <CloudSun className="h-3.5 w-3.5" />;
  return <Sun className="h-3.5 w-3.5" />;
};

const ProjectScenesTab = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateScene, setShowCreateScene] = useState(false);
  const [showCreateLocation, setShowCreateLocation] = useState(false);
  const [sceneForm, setSceneForm] = useState({ title: '', timeOfDay: '日', summary: '' });
  const [locForm, setLocForm] = useState({ name: '', timeOfDay: '日', description: '' });
  const [generatingIds, setGeneratingIds] = useState<Set<string>>(new Set());

  const load = () => {
    if (!id) return;
    setLoading(true);
    Promise.all([
      storyboard.listScenes(id).catch((e) => { logger.error('scenes', String(e)); return [] as Scene[]; }),
      bible.listLocations(id).catch((e) => { logger.error('locs', String(e)); return [] as Location[]; }),
    ]).then(([sc, lo]) => { setScenes(sc); setLocations(lo); setLoading(false); })
      .catch(() => setLoading(false));
  };

  useEffect(() => { load(); }, [id]);

  const handleCreateScene = async () => {
    if (!id || !sceneForm.title.trim()) return;
    try {
      const created = await storyboard.createScene(id, {
        title: sceneForm.title.trim(),
        timeOfDay: sceneForm.timeOfDay,
        summary: sceneForm.summary.trim() || undefined,
      } as never);
      setScenes((prev) => [...prev, created]);
      setShowCreateScene(false);
      setSceneForm({ title: '', timeOfDay: '日', summary: '' });
    } catch (err) {
      logger.error('create scene failed', String(err));
      setError('创建场景失败');
    }
  };

  const handleCreateLocation = async () => {
    if (!id || !locForm.name.trim()) return;
    try {
      const created = await bible.createLocation(id, {
        name: locForm.name.trim(),
        timeOfDay: locForm.timeOfDay,
        description: locForm.description.trim() || undefined,
      } as never);
      setLocations((prev) => [...prev, created]);
      setShowCreateLocation(false);
      setLocForm({ name: '', timeOfDay: '日', description: '' });
    } catch (err) {
      logger.error('create location failed', String(err));
      setError('创建地点失败');
    }
  };

  const handleDeleteScene = async (sceneId: string) => {
    if (!id) return;
    if (!await showConfirm('确定删除这个场景吗？其下镜头也会被删除')) return;
    try {
      await storyboard.deleteScene(id, sceneId);
      setScenes((prev) => prev.filter((s) => s.id !== sceneId));
    } catch (err) {
      logger.error('delete scene failed', String(err));
      setError('删除场景失败');
    }
  };

  const handleGenerateLocImage = async (locId: string) => {
    if (!id) return;
    setGeneratingIds((prev) => new Set(prev).add(locId));
    try {
      // P1 断链修复：之前调不存在的 /api/generation/image（必 404），改走 bible 嵌套端点
      await bible.generateLocationImage(id, locId);
    } catch (err) {
      logger.error('gen loc img failed', String(err));
      setError('生成立绘失败');
    } finally {
      setTimeout(() => {
        setGeneratingIds((prev) => { const n = new Set(prev); n.delete(locId); return n; });
      }, 2000);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-foreground">场景与地点</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            管理项目场景与拍摄地点 · {scenes.length} 场 / {locations.length} 个地点
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowCreateLocation(true)} className="flex items-center gap-1.5 rounded-lg border border-input bg-white px-3.5 py-2 text-sm font-medium text-foreground hover:border-primary hover:text-primary">
            <MapPin className="h-4 w-4" /> 添加地点
          </button>
          <button onClick={() => setShowCreateScene(true)} className="flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90">
            <Plus className="h-4 w-4" /> 添加场景
          </button>
        </div>
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-600">{error}</div>}

      {loading ? (
        <div className="rounded-xl border bg-white p-12 text-center text-sm text-muted-foreground">加载中...</div>
      ) : (
        <>
          {/* 场景网格 */}
          {scenes.length === 0 ? (
            <div className="rounded-xl border border-dashed bg-white p-12 text-center text-sm text-muted-foreground">
              暂无场景，点击「添加场景」开始搭建故事结构
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {scenes.map((sc) => (
                <div key={sc.id} className="group overflow-hidden rounded-xl border bg-white shadow-sm transition-shadow hover:shadow-md">
                  <div className="relative flex h-32 items-center justify-center bg-muted">
                    <Clapperboard className="h-8 w-8 text-primary/40" />
                    <span className="absolute left-3 top-3 flex items-center gap-1 rounded bg-black/30 px-2 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm">
                      {timeIcon(sc.timeOfDay)} {sc.timeOfDay || '日'}
                    </span>
                    <span className="absolute right-3 top-3 rounded bg-black/30 px-2 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm">
                      第 {sc.sceneNumber} 场
                    </span>
                  </div>
                  <div className="p-4">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="truncate font-semibold text-foreground">{sc.title || `第 ${sc.sceneNumber} 场`}</h3>
                      <button onClick={() => handleDeleteScene(sc.id)} className="text-muted-foreground opacity-0 transition-opacity hover:text-red-500 group-hover:opacity-100" title="删除">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{sc.summary || '暂无摘要'}</p>
                    <button
                      onClick={() => navigate(`/project/${id}/storyboard?scene=${sc.id}`)}
                      className="mt-3 w-full rounded-md border border-input bg-white py-1.5 text-xs font-medium text-foreground hover:border-primary hover:text-primary"
                    >
                      查看分镜
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* 地点列表 */}
          {locations.length > 0 && (
            <div>
              <h3 className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-foreground">
                <MapPin className="h-4 w-4 text-primary" /> 拍摄地点
              </h3>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                {locations.map((loc) => (
                  <div key={loc.id} className="group overflow-hidden rounded-xl border bg-white shadow-sm transition-shadow hover:shadow-md">
                    <div className="relative h-28 w-full">
                      <MediaOrMissing
                        src={loc.referenceImageUrls?.[0]}
                        alt={loc.name}
                        className="h-28 w-full"
                      />
                      {generatingIds.has(loc.id) && (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-xs font-medium text-white backdrop-blur-sm">生成中...</div>
                      )}
                    </div>
                    <div className="p-4">
                      <div className="flex items-center gap-1.5">
                        <h4 className="truncate text-sm font-semibold text-foreground">{loc.name}</h4>
                        <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground">{timeIcon(loc.timeOfDay)} {loc.timeOfDay}</span>
                      </div>
                      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{loc.description || '暂无描述'}</p>
                      <button
                        onClick={() => handleGenerateLocImage(loc.id)}
                        disabled={generatingIds.has(loc.id)}
                        className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-md border border-input bg-white py-1.5 text-xs font-medium text-foreground hover:border-primary hover:text-primary disabled:opacity-50"
                      >
                        <ImageIcon className="h-3.5 w-3.5" /> 生成场景图
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* 创建场景弹窗 */}
      {showCreateScene && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-foreground">添加场景</h3>
              <button onClick={() => setShowCreateScene(false)} className="text-muted-foreground hover:text-foreground"><X className="h-5 w-5" /></button>
            </div>
            <div className="mt-4 space-y-4">
              <div>
                <label className="text-sm font-medium text-foreground">场景标题</label>
                <input value={sceneForm.title} onChange={(e) => setSceneForm({ ...sceneForm, title: e.target.value })} placeholder="如：雨夜书店初遇" className="mt-1.5 h-9 w-full rounded-lg border border-input px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" />
              </div>
              <div>
                <label className="text-sm font-medium text-foreground">时间</label>
                <select value={sceneForm.timeOfDay} onChange={(e) => setSceneForm({ ...sceneForm, timeOfDay: e.target.value })} className="mt-1.5 h-9 w-full rounded-lg border border-input px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20">
                  <option value="日">日</option><option value="夜">夜</option><option value="清晨">清晨</option><option value="黄昏">黄昏</option>
                </select>
              </div>
              <div>
                <label className="text-sm font-medium text-foreground">场景摘要</label>
                <textarea value={sceneForm.summary} onChange={(e) => setSceneForm({ ...sceneForm, summary: e.target.value })} rows={3} placeholder="描述场景内容与氛围" className="mt-1.5 w-full resize-none rounded-lg border border-input px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" />
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button onClick={() => setShowCreateScene(false)} className="rounded-lg border border-input bg-white px-4 py-2 text-sm font-medium text-foreground hover:bg-muted/50">取消</button>
              <button onClick={handleCreateScene} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">创建</button>
            </div>
          </div>
        </div>
      )}

      {/* 创建地点弹窗 */}
      {showCreateLocation && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-foreground">添加地点</h3>
              <button onClick={() => setShowCreateLocation(false)} className="text-muted-foreground hover:text-foreground"><X className="h-5 w-5" /></button>
            </div>
            <div className="mt-4 space-y-4">
              <div>
                <label className="text-sm font-medium text-foreground">地点名称</label>
                <input value={locForm.name} onChange={(e) => setLocForm({ ...locForm, name: e.target.value })} placeholder="如：旧书店" className="mt-1.5 h-9 w-full rounded-lg border border-input px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" />
              </div>
              <div>
                <label className="text-sm font-medium text-foreground">时间</label>
                <select value={locForm.timeOfDay} onChange={(e) => setLocForm({ ...locForm, timeOfDay: e.target.value })} className="mt-1.5 h-9 w-full rounded-lg border border-input px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20">
                  <option value="日">日</option><option value="夜">夜</option><option value="清晨">清晨</option><option value="黄昏">黄昏</option>
                </select>
              </div>
              <div>
                <label className="text-sm font-medium text-foreground">地点描述</label>
                <textarea value={locForm.description} onChange={(e) => setLocForm({ ...locForm, description: e.target.value })} rows={3} className="mt-1.5 w-full resize-none rounded-lg border border-input px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" />
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button onClick={() => setShowCreateLocation(false)} className="rounded-lg border border-input bg-white px-4 py-2 text-sm font-medium text-foreground hover:bg-muted/50">取消</button>
              <button onClick={handleCreateLocation} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">创建</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ProjectScenesTab;
