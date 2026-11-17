/**
 * 一幕·神剪 · 右侧镜头池
 * 与原型同宽同高的一列：点任一镜头即自动起播并在舞台预览；
 * 删除镜头会同步分镜表与时间线，导入入口复用项目导入弹窗。
 */
import { useMemo, useState } from 'react';
import { ChevronLeft, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { deleteShot } from '@client/src/api/storyboard';
import { useStudio } from './StudioShell';
import { stateShort } from './model';

type Filter = 'all' | 'done' | 'render';

export const ShenJianShotPool = ({ onBack }: { onBack: () => void }) => {
  const { data, projectId, setCurT, setPlaying, setPreviewMode } = useStudio();
  const [filter, setFilter] = useState<Filter>('all');

  const shots = data.shots;
  const visible = useMemo(
    () => (filter === 'all' ? shots : shots.filter((s) => (filter === 'done' ? s.st === 'done' : s.st !== 'done'))),
    [shots, filter],
  );
  const total = useMemo(() => shots.reduce((sum, s) => sum + (Number.isFinite(s.dur) ? s.dur : 0), 0), [shots]);

  /** 点镜头即自动预览：跳到该镜起点并起播，不需要再点播放 */
  const pick = (index: number) => {
    const shot = shots[index];
    if (!shot) return;
    setPreviewMode('shot');
    setCurT(Math.max(0, shot.start + 0.01));
    setPlaying(true);
  };

  const remove = async (shotId: string, no: number) => {
    if (!projectId) return;
    if (!window.confirm(`删除镜头 #${String(no).padStart(2, '0')}？\n\n分镜表与时间线里的对应片段都会被移除。`)) return;
    try {
      await deleteShot(projectId, shotId);
      window.dispatchEvent(new CustomEvent('yimu:shot-deleted', { detail: { shotId } }));
      await data.reloadShots();
      await data.reloadTimeline();
      toast.success(`镜头 #${String(no).padStart(2, '0')} 已删除`);
    } catch {
      toast.error('删除镜头失败，请稍后重试');
    }
  };

  return (
    <aside className="inspector shot-pool2" aria-label="镜头池">
      <div className="insp-tabs" style={{ padding: 0 }}>
        <button type="button" className="on">镜头池</button>
        <button type="button" onClick={onBack}>
          <ChevronLeft style={{ width: 12, height: 12, verticalAlign: '-2px' }} /> 检查器
        </button>
      </div>
      <div className="insp-body" style={{ padding: 12 }}>
        <div className="sp2-head">
          <div>
            <h3>镜头池</h3>
            <small>{shots.length} 镜 · {total.toFixed(1)}s</small>
          </div>
          <button
            type="button"
            className="mini-btn"
            data-tip="导入素材到项目资产库，再从左侧拖入时间线"
            onClick={() => window.dispatchEvent(new CustomEvent('yimu:studio-import'))}
          >
            <Upload /> 导入
          </button>
        </div>

        <div className="sp2-filters">
          {([
            ['all', '全部'],
            ['done', '已成片'],
            ['render', '生成中'],
          ] as [Filter, string][]).map(([k, label]) => (
            <button key={k} type="button" className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>
              {label}
            </button>
          ))}
        </div>

        <div className="sp2-list">
          {visible.length === 0 ? <div className="insp-empty">这个筛选下还没有镜头。</div> : null}
          {visible.map((shot) => {
            const index = shots.findIndex((s) => s.id === shot.id);
            return (
              <div key={shot.id} className="sp2-card">
                <button type="button" className="sp2-thumb" onClick={() => pick(index)} title="点击即自动预览">
                  {shot.frameUrl ? <img src={shot.frameUrl} alt="" /> : <span className="sp2-no">{String(shot.no).padStart(2, '0')}</span>}
                  <span className="sp2-dur">{shot.dur.toFixed(1)}s</span>
                  {shot.videoUrl ? <span className="sp2-play">▶</span> : null}
                </button>
                <div className="sp2-meta" onClick={() => pick(index)}>
                  <b>#{String(shot.no).padStart(2, '0')} {shot.tag || '镜头'}</b>
                  <span>{shot.txt || '暂无画面描述'}</span>
                  <em>{stateShort(shot.st)} · {shot.movement || '固定'}</em>
                </div>
                <button type="button" className="icon-btn sp2-del" data-tip="删除镜头" onClick={() => void remove(shot.id, shot.no)}>
                  <Trash2 />
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </aside>
  );
};

export default ShenJianShotPool;
