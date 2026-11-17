/**
 * 全功能编辑 · 预览下方播放控制条
 * -------------------------------------------------------------
 * 时间码 / 播放暂停 / 可点击拖拽的进度条 / 音量状态。
 * 所有数值来自 StudioShell 的主时钟（curT / playing），与时间线共用一份状态。
 */
import { Pause, Play, Volume2, VolumeX } from 'lucide-react';
import { useStudio } from './StudioShell';
import { clipSpan, toTimecode } from './model';

export const StudioProTransport = () => {
  const {
    data,
    sel,
    curT,
    setCurT,
    playing,
    setPlaying,
    setPlayDir,
    previewMode,
    previewVolume,
    setPreviewVolume,
    previewMuted,
    setPreviewMuted,
    originalAudio,
    setOriginalAudio,
  } = useStudio();

  const previewShot = previewMode === 'shot' ? data.shots[sel] : undefined;
  const base = previewShot ? previewShot.start : 0;
  const total = previewShot
    ? previewShot.dur
    : (() => {
        const clips = data.timeline?.clips ?? [];
        if (clips.length > 0) {
          return clips.reduce((max, c) => Math.max(max, c.timelineStart + clipSpan(c)), 0);
        }
        return data.shots.reduce((sum, s) => sum + s.dur, 0);
      })();
  const relT = Math.max(0, Math.min(total, curT - base));

  const seek = (value: number) => {
    setPlaying(false);
    setCurT(base + Math.max(0, Math.min(total, value)));
  };
  const volPct = previewMuted ? 0 : Math.round(previewVolume * 100);

  return (
    <div className="pro-transport">
      <div className="pt-tc num">
        <b>{toTimecode(relT)}</b>
        <span>/</span>
        <span>{toTimecode(total)}</span>
      </div>

      <button
        type="button"
        className="pt-play"
        title={playing ? '暂停 (空格)' : '播放 (空格)'}
        onClick={() => {
        setPlayDir(1);
        setPlaying(!playing);
      }}
      >
        {playing ? <Pause size={14} /> : <Play size={14} />}
      </button>

      <input
        type="range"
        className="pt-scrub"
        min={0}
        max={Math.max(total, 0.1)}
        step={0.01}
        value={relT}
        aria-label="播放进度"
        onChange={(e) => seek(Number(e.target.value))}
      />

      <div className="pt-vol" title="预览音量，不改变时间线片段的实际音量">
        <button
          type="button"
          className="pt-vol-btn"
          title={previewMuted ? '取消静音' : '静音预览'}
          onClick={() => setPreviewMuted(!previewMuted)}
        >
          {previewMuted || previewVolume === 0 ? <VolumeX size={14} /> : <Volume2 size={14} />}
        </button>
        <input
          type="range"
          className="pt-vol-range"
          min={0}
          max={100}
          step={1}
          value={volPct}
          aria-label="预览音量"
          onChange={(e) => {
            const pct = Number(e.target.value);
            setPreviewVolume(pct / 100);
            setPreviewMuted(pct === 0);
          }}
        />
        <button
          type="button"
          className={`pt-chip${originalAudio ? ' on' : ''}`}
          title="原声开关：关闭后画面静音，只保留时间线配音/音乐"
          onClick={() => setOriginalAudio(!originalAudio)}
        >
          原声
        </button>
      </div>
    </div>
  );
};

export default StudioProTransport;
