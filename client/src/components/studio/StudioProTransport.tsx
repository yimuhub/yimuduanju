/**
 * 全功能编辑 · 预览下方播放控制条
 * -------------------------------------------------------------
 * 时间码 / 播放暂停 / 可点击拖拽的进度条 / 音量状态。
 * 所有数值来自 StudioShell 的主时钟（curT / playing），与时间线共用一份状态。
 */
import { Pause, Play, Volume2 } from 'lucide-react';
import { useStudio } from './StudioShell';
import { clipSpan, toTimecode } from './model';

export const StudioProTransport = () => {
  const { data, curT, setCurT, playing, setPlaying } = useStudio();

  const total = (() => {
    const clips = data.timeline?.clips ?? [];
    if (clips.length > 0) {
      return clips.reduce((max, c) => Math.max(max, c.timelineStart + clipSpan(c)), 0);
    }
    return data.shots.reduce((sum, s) => sum + s.dur, 0);
  })();

  const seek = (value: number) => {
    setPlaying(false);
    setCurT(Math.max(0, Math.min(total, value)));
  };

  return (
    <div className="pro-transport">
      <div className="pt-tc num">
        <b>{toTimecode(curT)}</b>
        <span>/</span>
        <span>{toTimecode(total)}</span>
      </div>

      <button
        type="button"
        className="pt-play"
        title={playing ? '暂停 (空格)' : '播放 (空格)'}
        onClick={() => setPlaying(!playing)}
      >
        {playing ? <Pause size={14} /> : <Play size={14} />}
      </button>

      <input
        type="range"
        className="pt-scrub"
        min={0}
        max={Math.max(total, 0.1)}
        step={0.01}
        value={Math.min(curT, total)}
        aria-label="播放进度"
        onChange={(e) => seek(Number(e.target.value))}
      />

      <div className="pt-vol" title="预览音量（原声 / 静音由片段属性控制）">
        <Volume2 size={14} />
        <span className="pt-vol-bar" />
        <span className="pt-chip">原声</span>
      </div>
    </div>
  );
};

export default StudioProTransport;
