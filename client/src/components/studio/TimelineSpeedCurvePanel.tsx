/**
 * 曲线变速（Shift+B）
 * -------------------------------------------------------------
 * 剪映的曲线变速是连续速度曲线；浏览器与 ffmpeg 的现成管线都只支持
 * 单段匀速，所以这里用「等长源片段 + 逐段速度」折线逼近：
 * 每个分段是真实片段，预览、保存、导出全部走既有链路，结果可预期。
 */
import { useMemo, useState } from 'react';
import { X, Zap } from 'lucide-react';
import { useEdl } from './EdlContext';
import type { TimelineClip } from '@shared/api.interface';

const PRESETS: { name: string; desc: string; speeds: number[] }[] = [
  { name: '缓入缓出', desc: '慢起 → 加速 → 收慢，适合情绪段落', speeds: [0.75, 1, 1.5, 1, 0.75] },
  { name: '子弹时间', desc: '中间骤慢，适合高光瞬间', speeds: [2, 1.5, 0.5, 1.5, 2] },
  { name: '快剪冲刺', desc: '整体加速，尾部更快', speeds: [1.25, 1.5, 1.75, 2.0, 2.25] },
  { name: '慢镜头铺陈', desc: '整体放慢，适合开场', speeds: [0.5, 0.6, 0.75, 0.75, 0.5] },
];

export const TimelineSpeedCurvePanel = ({
  clip,
  onClose,
}: {
  clip: TimelineClip;
  onClose: () => void;
}) => {
  const editor = useEdl();
  const [speeds, setSpeeds] = useState<number[]>([0.75, 1, 1.5, 1, 0.75]);
  const srcDur = Math.max(0.1, clip.outPoint - clip.inPoint);
  const result = useMemo(() => {
    const n = speeds.length;
    const slice = srcDur / n;
    let visible = 0;
    const spans = speeds.map((s) => {
      const v = Math.max(0.25, Math.min(4, s)) || 1;
      const span = slice / v;
      visible += span;
      return span;
    });
    return { spans, visible };
  }, [speeds, srcDur]);

  const apply = () => {
    const ok = editor.setClipSpeedCurve(clip.id, speeds);
    if (ok) onClose();
  };

  return (
    <div className="tl-modal-mask" onClick={onClose}>
      <div className="tl-modal tl-curve-modal" onClick={(e) => e.stopPropagation()}>
        <div className="tl-modal-head">
          <b>曲线变速 · {clip.text?.slice(0, 18) || '画面片段'}</b>
          <button type="button" title="关闭" onClick={onClose}>
            <X size={14} />
          </button>
        </div>

        <p className="tl-curve-tip">
          按等长源片段拆成 {speeds.length} 段，逐段设置播放速度，形成折线曲线。
          原片段 {srcDur.toFixed(2)}s → 曲线后 {result.visible.toFixed(2)}s；
          应用后是真片段，可继续裁剪、拖动与导出。原运镜关键帧不随拆分保留。
        </p>

        <div className="tl-curve-presets">
          {PRESETS.map((p) => (
            <button
              key={p.name}
              type="button"
              onClick={() => setSpeeds(p.speeds)}
              title={p.desc}
            >
              <Zap size={11} />
              {p.name}
            </button>
          ))}
        </div>

        <div className="tl-curve-bars">
          {speeds.map((s, i) => (
            <div className="tl-curve-bar" key={i}>
              <span className="tl-curve-idx">{i + 1}</span>
              <input
                type="range"
                min={0.25}
                max={4}
                step={0.05}
                value={s}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setSpeeds((prev) => prev.map((x, j) => (j === i ? v : x)));
                }}
              />
              <input
                className="tl-curve-num"
                type="number"
                min={0.25}
                max={4}
                step={0.05}
                value={s}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (!Number.isFinite(v)) return;
                  setSpeeds((prev) => prev.map((x, j) => (j === i ? v : x)));
                }}
              />
              <span className="tl-curve-sec">{result.spans[i].toFixed(2)}s</span>
            </div>
          ))}
        </div>

        <div className="tl-curve-actions">
          <button
            type="button"
            onClick={() => setSpeeds((prev) => (prev.length >= 7 ? prev : [...prev, 1]))}
            disabled={speeds.length >= 7}
          >
            + 增加一段
          </button>
          <button
            type="button"
            onClick={() => setSpeeds((prev) => (prev.length <= 3 ? prev : prev.slice(0, -1)))}
            disabled={speeds.length <= 3}
          >
            − 减少一段
          </button>
          <span className="tl-curve-spacer" />
          <button type="button" className="tl-curve-apply" onClick={apply}>
            应用曲线变速
          </button>
        </div>
      </div>
    </div>
  );
};
