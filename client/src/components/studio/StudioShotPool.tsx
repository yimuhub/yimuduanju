/**
 * Studio · 全功能编辑右侧「镜头池 + 项目素材库」
 * -------------------------------------------------------------
 * 镜头池：按时间线顺序列镜头，点击即进入单镜预览并自动播放。
 * 素材库：直接读项目资产表，按来源折叠成文件夹，可预览、拖入时间线、删除。
 * 导入入口与时间线共用 StudioImportDialog：本地 / 其他任务 / 资产包（含剪映）。
 */
import { useMemo, useState } from 'react';
import { LayoutGrid, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { deleteShot } from '@client/src/api/storyboard';
import { useStudio } from './StudioShell';
import { stateShort, shotLabel } from './model';
import { StudioAssetLibrary } from './StudioAssetLibrary';
import { clearTimelineDrag, startTimelineDrag } from '@client/src/lib/timeline-dnd';

type Filter = 'all' | 'done' | 'render';
type Tab = 'shots' | 'assets';

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'done', label: '已成片' },
  { key: 'render', label: '生成中' },
];

export const StudioShotPool = () => {
  const { data, projectId, sel, setSel, setCurT, setPlaying, setPreviewMode } = useStudio();
  const [filter, setFilter] = useState<Filter>('all');
  const [tab, setTab] = useState<Tab>('shots');

  const shots = data.shots;
  const total = useMemo(
    () => shots.reduce((sum, s) => sum + (Number.isFinite(s.dur) ? s.dur : 0), 0),
    [shots],
  );
  const visible = useMemo(
    () => (filter === 'all' ? shots : shots.filter((s) => s.st === filter)),
    [shots, filter],
  );

  const pick = (index: number) => {
    const shot = shots[index];
    if (!shot) return;
    // 点镜头即进入单镜预览并自动起播，播放条按该镜真实时长走
    setPreviewMode('shot');
    setSel(index);
    setCurT(shot.start + 0.01);
    setPlaying(true);
  };

  const removeShot = async (shotId: string, name: string) => {
    if (!projectId) return;
    const ok = window.confirm(
      `删除镜头「${name}」？\n\n这会从分镜表和项目里移除该镜，并清掉它在时间线上的片段。此操作不可撤销。`,
    );
    if (!ok) return;
    try {
      await deleteShot(projectId, shotId);
      window.dispatchEvent(new CustomEvent('yimu:shot-deleted', { detail: { shotId } }));
      await data.reloadShots();
      await data.reloadTimeline();
      toast.success('镜头已删除');
    } catch {
      toast.error('删除镜头失败，请稍后重试');
    }
  };

  const openImport = () => window.dispatchEvent(new CustomEvent('yimu:studio-import'));

  return (
    <aside className="shot-pool">
      <div className="sp-head">
        <div className="sp-head-top">
          <div className="sp-title">
            <h3>镜头池</h3>
            <small className="num">
              {shots.length} 镜 · {total.toFixed(1)}s
            </small>
          </div>
          <button
            type="button"
            className="sp-import"
            title="导入电脑文件、其他项目素材、资产包或剪映草稿包"
            onClick={openImport}
          >
            <Upload size={12} />
            导入
          </button>
        </div>

        <div className="sp-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'shots'}
            className={tab === 'shots' ? 'on' : ''}
            onClick={() => setTab('shots')}
          >
            <LayoutGrid size={11} />
            镜头
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'assets'}
            className={tab === 'assets' ? 'on' : ''}
            onClick={() => setTab('assets')}
          >
            素材库
          </button>
        </div>

        {tab === 'shots' ? (
          <div className="sp-filters">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                className={`sp-chip${filter === f.key ? ' on' : ''}`}
                onClick={() => setFilter(f.key)}
              >
                {f.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {tab === 'shots' ? (
        <div className="sp-list">
          {visible.length === 0 ? (
            <div className="sp-empty">没有符合筛选条件的镜头</div>
          ) : (
            visible.map((shot) => {
              const index = shots.indexOf(shot);
              const active = index === sel;
              return (
                <div className={`sp-row${active ? ' on' : ''}`} key={shot.id}>
                  <button
                    type="button"
                    className="sp-item"
                    draggable
                    onClick={() => pick(index)}
                    onDragStart={(e) =>
                      startTimelineDrag(e, {
                        kind: 'shot',
                        name: `${shotLabel(shot.no)} ${shot.txt}`.slice(0, 40),
                        durationSeconds: shot.dur,
                        shotId: shot.id,
                        videoUrl: shot.videoUrl,
                        frameUrl: shot.frameUrl,
                      })
                    }
                    onDragEnd={() => clearTimelineDrag()}
                    title={`${shot.sceneLabel} · ${shot.tag} · ${shot.txt}（拖动到时间线落轨，点开即预览）`}
                  >
                    <span className="sp-thumb" data-scene={shot.sceneLabel}>
                      {shot.frameUrl ? <img src={shot.frameUrl} alt="" loading="lazy" /> : null}
                      <b className="num">{String(shot.no).padStart(2, '0')}</b>
                    </span>
                    <span className="sp-meta">
                      <span className="sp-l1">
                        <b>{shot.sceneLabel}</b>
                        <i className={`sp-dot ${shot.st === 'done' ? 'ok' : shot.st === 'render' ? 'run' : ''}`} />
                        <span className="sp-tag">{shot.tag}</span>
                      </span>
                      <span className="sp-l2">{shot.dialogue || shot.txt}</span>
                    </span>
                    <span className="sp-dur num">{shot.dur.toFixed(1)}s</span>
                    <span className="sp-state">{stateShort(shot.st)}</span>
                  </button>
                  <button
                    type="button"
                    className="sp-del"
                    title="删除该镜（同时清理时间线片段）"
                    onClick={() => void removeShot(shot.id, shotLabel(shot.no))}
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              );
            })
          )}
        </div>
      ) : (
        <StudioAssetLibrary />
      )}

      <div className="sp-foot">
        <span>
          {tab === 'shots' ? '点击预览单镜 · 拖动到时间线落轨' : '点素材预览 · 拖动落轨 · 可删除'}
        </span>
      </div>
    </aside>
  );
};

export default StudioShotPool;
