/**
 * Studio · 底时间线（方案 B 骨架）
 * -------------------------------------------------------------
 * 轨道与片段全部由真实 shots 派生：
 *   V1 画面  ← shot.videoUrl（未出片则 pending / render）
 *   V2 字幕  ← shot.subtitleText / dialogue
 *   A1 对白  ← shot.voiceUrl
 * 片段宽度 = 真实时长 × 像素密度，因此时间码与预览天然自洽。
 *
 * 收起/展开：
 *   · 头部右侧「收起 / 展开」按钮（ChevronDown / ChevronUp）
 *   · 最右缘垂直居中小把手，hover 高亮，同样可切换
 *   · 状态持久 localStorage（yimu.timelineCollapsed），快捷键 ⌥T / \
 */
import { useMemo } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useStudio } from './StudioShell';
import { shotLabel, toTimecode } from './model';

const PX_PER_S = 17;

export const StudioTimeline = () => {
  const {
    data,
    sel,
    setSel,
    curT,
    setCurT,
    playing,
    tlCollapsed,
    setTlCollapsed,
    toggleTlCollapsed,
  } = useStudio();
  const shots = data.shots;
  const collapsed = tlCollapsed;

  const total = useMemo(() => shots.reduce((s, x) => s + x.dur, 0), [shots]);

  /** 刻度：每 5 秒一个，每 15 秒加粗 */
  const ticks = useMemo(() => {
    const out: { x: number; major: boolean; label: string }[] = [];
    const stepSec = 5;
    for (let t = 0; t <= total; t += stepSec) {
      out.push({
        x: t * PX_PER_S,
        major: t % 15 === 0,
        label: t % 15 === 0 ? toTimecode(t).slice(3, 8) : '',
      });
    }
    return out;
  }, [total]);

  // ---------- 收起态：36px 细条（时间线 · N 项 + 展开按钮） ----------
  if (collapsed) {
    return (
      <section className="tl tl-collapsed-bar" id="tl">
        <div className="tl-head">
          <h3>时间线</h3>
          <span className="tl-count num">· {shots.length} 项</span>
          <span className="sp" />
          <span className="tl-tc">{toTimecode(total)}</span>
          <button
            type="button"
            className="tl-toggle-btn"
            title="展开时间线 (⌥T)"
            onClick={() => setTlCollapsed(false)}
          >
            <ChevronUp size={13} strokeWidth={2.2} />
            <span>展开</span>
          </button>
        </div>
        <button
          type="button"
          className="tl-edge-grip"
          aria-label="展开时间线"
          title="展开时间线 (⌥T)"
          onClick={toggleTlCollapsed}
        >
          <ChevronUp size={11} strokeWidth={2.4} />
        </button>
      </section>
    );
  }

  if (shots.length === 0) {
    return (
      <section className="tl" id="tl">
        <div className="tl-head">
          <h3>时间线</h3>
          <span className="chip num">0 镜</span>
          <span className="sp" />
          <span className="tl-tc">00:00:00:00 / —</span>
          <button
            type="button"
            className="tl-toggle-btn"
            title="收起时间线 (⌥T)"
            onClick={() => setTlCollapsed(true)}
          >
            <ChevronDown size={13} strokeWidth={2.2} />
            <span>收起</span>
          </button>
        </div>
        <button
          type="button"
          className="tl-edge-grip"
          aria-label="收起时间线"
          title="收起时间线 (⌥T)"
          onClick={toggleTlCollapsed}
        >
          <ChevronDown size={11} strokeWidth={2.4} />
        </button>
        <div className="tl-main">
          <div className="tl-labels">
            <div className="tl-lb">
              <span className="sw" style={{ background: '#3F5C73' }} />
              <b>V1</b>画面
            </div>
            <div className="tl-lb">
              <span className="sw" style={{ background: '#3E6B4C' }} />
              <b>A1</b>对白
            </div>
          </div>
          <div className="tl-tracks">
            <div className="ruler" />
            <div className="trk" />
            <div className="trk" />
          </div>
        </div>
      </section>
    );
  }

  const clipClass = (kind: 'v' | 'a' | 'v2', has: boolean, st: string) => {
    if (!has) return 'clip pending';
    if (st === 'render') return `clip ${kind} render`;
    return `clip ${kind}`;
  };

  return (
    <section className="tl" id="tl">
      <div className="tl-head">
        <h3>时间线</h3>
        <span className="chip num">
          {data.project?.title ?? 'EP'} · {shots.length} 镜
        </span>
        <span className="tl-hint">
          按 <span className="kbd">\</span> 或 <span className="kbd">⌥T</span> 收起
        </span>
        <span className="sp" />
        <span className="tl-tc">
          {toTimecode(curT)} / {toTimecode(total)}
        </span>
        <div className="tl-zoom">
          <button
            type="button"
            className="icon-btn"
            title="按时间线定位"
            onClick={() => setCurT(0)}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M5 12h14" />
            </svg>
          </button>
          <button
            type="button"
            className="icon-btn"
            title="跳到下一镜"
            onClick={() => setSel((sel + 1) % shots.length)}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
        </div>
        <button
          type="button"
          className="tl-toggle-btn"
          title="收起时间线 (⌥T)"
          onClick={() => setTlCollapsed(true)}
        >
          <ChevronDown size={13} strokeWidth={2.2} />
          <span>收起</span>
        </button>
      </div>

      <button
        type="button"
        className="tl-edge-grip"
        aria-label="收起时间线"
        title="收起时间线 (⌥T)"
        onClick={toggleTlCollapsed}
      >
        <ChevronDown size={11} strokeWidth={2.4} />
      </button>

      <div className="tl-main">
        <div className="tl-labels">
          <div className="tl-lb">
            <span className="sw" style={{ background: '#5A4E78' }} />
            <b>V2</b>字
          </div>
          <div className="tl-lb">
            <span className="sw" style={{ background: '#3F5C73' }} />
            <b>V1</b>画面
          </div>
          <div className="tl-lb">
            <span className="sw" style={{ background: '#3E6B4C' }} />
            <b>A1</b>对白
          </div>
          <div className="tl-lb">
            <span className="sw" style={{ background: '#3E6B4C' }} />
            <b>A2</b>配乐
          </div>
        </div>

        <div className="tl-tracks" id="tracks">
          <div className="ruler">
            {ticks.map((t, i) => (
              <div
                key={i}
                className={`tick${t.major ? ' maj' : ''}`}
                style={{ left: `${t.x}px` }}
              >
                {t.label ? <span>{t.label}</span> : null}
              </div>
            ))}
          </div>

          {/* V2 字幕 */}
          <div className="trk">
            {shots.map((s, i) =>
              s.subtitleText || s.dialogue ? (
                <div
                  key={s.id}
                  className={`clip v2${i === sel ? ' on' : ''}`}
                  style={{ left: `${s.start * PX_PER_S}px`, width: `${Math.max(6, s.dur * PX_PER_S)}px` }}
                  onClick={() => setSel(i)}
                  title={s.subtitleText || s.dialogue}
                >
                  <span>{(s.subtitleText || s.dialogue || '').slice(0, 12)}</span>
                </div>
              ) : null,
            )}
          </div>

          {/* V1 画面 */}
          <div className="trk">
            {shots.map((s, i) => (
              <div
                key={s.id}
                className={`${clipClass('v', Boolean(s.videoUrl), s.st)}${i === sel ? ' on' : ''}`}
                style={{ left: `${s.start * PX_PER_S}px`, width: `${Math.max(6, s.dur * PX_PER_S)}px` }}
                onClick={() => setSel(i)}
                title={`${shotLabel(s.no)} · ${s.txt}`}
              >
                <span>{shotLabel(s.no)}</span>
              </div>
            ))}
          </div>

          {/* A1 对白 */}
          <div className="trk">
            {shots.map((s, i) =>
              s.voiceUrl ? (
                <div
                  key={s.id}
                  className={`clip a${i === sel ? ' on' : ''}`}
                  style={{ left: `${s.start * PX_PER_S}px`, width: `${Math.max(6, s.dur * PX_PER_S)}px` }}
                  onClick={() => setSel(i)}
                  title="配音"
                >
                  <span>♪</span>
                </div>
              ) : null,
            )}
          </div>

          {/* A2 配乐（项目级，无逐镜数据时留空轨道） */}
          <div className="trk" />

          <div
            className="playhead"
            id="playhead"
            style={{ left: `${curT * PX_PER_S}px`, opacity: playing ? 1 : 0.85 }}
          />
        </div>
      </div>
    </section>
  );
};
