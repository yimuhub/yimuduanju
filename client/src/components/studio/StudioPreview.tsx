/**
 * Studio · 产出坞「预览」Tab（方案 F 新增）
 * -------------------------------------------------------------
 * 与画布 / 时间线 / 分镜同源：全部读 useStudio() 的 shots 与 sel。
 * 预览内容优先用真实首帧图（shot.startFrameUrl），没有则回退到
 * 景别示意框（与设计稿 .pv-subj 的构图逻辑一致）。
 */
import { useEffect, useState } from 'react';
import { useStudio } from './StudioShell';
import { shotLabel, stateShort, toTimecode } from './model';

type Ratio = '9:16' | '16:9' | '1:1';

export const StudioPreview = () => {
  const { data, sel, setSel, setCurT, curT, playing, setPlaying } = useStudio();
  const [ratio, setRatio] = useState<Ratio>('9:16');

  const shots = data.shots;
  const shot = shots[sel];

  // 切换镜头时把播放头对齐到该镜起点
  useEffect(() => {
    if (shot) setCurT(shot.start);
  }, [shot, setCurT]);

  if (!shot) {
    return (
      <div className="placeholder">
        <b>预览</b>
        当前项目还没有分镜镜头。
        <br />
        先在剧本页把剧本物化成镜头，预览会自动接上。
      </div>
    );
  }

  const endT = shot.start + shot.dur;
  const scene = data.scenes.find((s) => s.id === shot.sceneId);

  const step = (delta: number) => {
    if (shots.length === 0) return;
    setSel((sel + delta + shots.length) % shots.length);
  };

  return (
    <div className="pv">
      <div className="dsub" style={{ margin: '-14px -14px 0', position: 'static' }}>
        <div className="seg">
          {(['9:16', '16:9', '1:1'] as Ratio[]).map((r) => (
            <button
              key={r}
              type="button"
              className={ratio === r ? 'on' : undefined}
              onClick={() => setRatio(r)}
            >
              {r}
            </button>
          ))}
        </div>
        <div className="spacer" />
        <span className="chip num">
          {shotLabel(shot.no)} / {shots.length}
        </span>
      </div>

      <div className="pv-stage">
        <div className="pv-frame" data-ratio={ratio} data-tag={shot.tag} data-st={shot.st}>
          {shot.frameUrl ? (
            <img
              src={shot.frameUrl}
              alt={shotLabel(shot.no)}
              style={{
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                objectFit: 'cover',
              }}
            />
          ) : (
            <>
              <div className="pv-grid" />
              <div className="pv-subj" />
            </>
          )}
          <div className="pv-safe" />
          <div className="pv-scan" />
          <span className="pv-no num">{shotLabel(shot.no)}</span>
          <span className="pv-dur num">{shot.dur.toFixed(1)}s</span>
          <span className={`pv-st${shot.st === 'done' ? ' ok' : shot.st === 'render' ? ' run' : ''}`}>
            {stateShort(shot.st)}
          </span>
        </div>
      </div>

      <div className="pv-tc">
        {toTimecode(curT)} → {toTimecode(endT)}
      </div>

      <div className="pv-meta">
        <div className="pv-row">
          <span className="pv-k">场景</span>
          <span className="pv-v serif">
            {scene ? `${scene.label} · ${scene.title || '场次'}` : shot.sceneLabel}
          </span>
        </div>
        <div className="pv-row">
          <span className="pv-k">景别</span>
          <span className="pv-v">{shot.tag}</span>
        </div>
        <div className="pv-row">
          <span className="pv-k">时长</span>
          <span className="pv-v num">{shot.dur.toFixed(1)}s</span>
        </div>
        <div className="pv-row">
          <span className="pv-k">状态</span>
          <span
            className={`pv-v${shot.st === 'done' ? ' ok' : shot.st === 'render' ? ' run' : ' dim'}`}
          >
            {stateShort(shot.st)}
          </span>
        </div>
      </div>

      <p className="pv-desc">{shot.txt}</p>

      <div className="pv-nav">
        <button type="button" className="icon-btn" onClick={() => step(-1)} title="上一镜 ( ← )">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <button
          type="button"
          className={`pv-play${playing ? ' on' : ''}`}
          onClick={() => setPlaying(!playing)}
          title="按真实时长播放"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            {playing ? <path d="M7 4v16M17 4v16" /> : <path d="M7 4l12 8-12 8z" />}
          </svg>
          <span>{playing ? '暂停' : '播放'}</span>
        </button>
        <button type="button" className="icon-btn" onClick={() => step(1)} title="下一镜 ( → )">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 18l6-6-6-6" />
          </svg>
        </button>
        <div className="spacer" />
        {shot.videoUrl ? (
          <a className="pv-link" href={shot.videoUrl} target="_blank" rel="noreferrer">
            打开视频
          </a>
        ) : null}
      </div>

      <div className="pv-strip-lb">胶片条 · {shots.length} 镜</div>
      <div className="pv-strip">
        {shots.map((s, i) => (
          <div
            key={s.id}
            className={`pv-cell${i === sel ? ' on' : ''}`}
            data-st={s.st}
            onClick={() => setSel(i)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter') setSel(i);
            }}
            title={`${shotLabel(s.no)} · ${s.txt}`}
          >
            {String(s.no).padStart(2, '0')}
          </div>
        ))}
      </div>
    </div>
  );
};
