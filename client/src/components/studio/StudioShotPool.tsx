/**
 * Studio · 全功能编辑右侧「镜头池」
 * -------------------------------------------------------------
 * 只做导航与状态呈现，不改任何镜头数据：
 *   · 按时间线顺序列出全部镜头（镜号 / 场次 / 景别 / 时长 / 状态 / 画面描述）
 *   · 点卡片 = 选中该镜 + 播放头跳到该镜首帧（与预览、时间线、属性条同一份状态）
 *   · 过滤：全部 / 已成片 / 生成中
 *
 * 为什么独立成组件而不复用右坞：全功能编辑里右坞被折叠，镜头池是编辑期的
 * 常驻侧栏，宽度可拖拽（见 StudioShell 的 .pro-pool），职责与产出坞不同。
 */
import { useMemo, useState } from 'react';
import { useStudio } from './StudioShell';
import { stateShort } from './model';

type Filter = 'all' | 'done' | 'render';

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'done', label: '已成片' },
  { key: 'render', label: '生成中' },
];

export const StudioShotPool = () => {
  const { data, sel, setSel, setCurT, setPlaying } = useStudio();
  const [filter, setFilter] = useState<Filter>('all');

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
    setPlaying(false);
    setSel(index);
    setCurT(shot.start + 0.05);
  };

  return (
    <aside className="shot-pool">
      <div className="sp-head">
        <div className="sp-title">
          <h3>镜头池</h3>
          <small className="num">
            {shots.length} 镜 · {total.toFixed(1)}s
          </small>
        </div>
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
      </div>

      <div className="sp-list">
        {visible.length === 0 ? (
          <div className="sp-empty">没有符合筛选条件的镜头</div>
        ) : (
          visible.map((shot) => {
            const index = shots.indexOf(shot);
            const active = index === sel;
            return (
              <button
                key={shot.id}
                type="button"
                className={`sp-item${active ? ' on' : ''}`}
                onClick={() => pick(index)}
                title={`${shot.sceneLabel} · ${shot.tag} · ${shot.txt}`}
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
            );
          })
        )}
      </div>

      <div className="sp-foot">
        <span>点击镜头，定位预览与时间线</span>
      </div>
    </aside>
  );
};

export default StudioShotPool;
