/**
 * 运镜关键帧面板（缩放 / 平移 / 旋转）
 * -------------------------------------------------------------
 * 只做预览与导出都能真实生效的属性；时间以片段内秒数保存。
 * 关键帧数据整组写回 EDL，和其他片段属性一样走撤销/修订账本。
 */
import { X } from 'lucide-react';
import { clipSpan } from './model';
import { useEdl } from './EdlContext';
import {
  normalizeVideoKeyframes,
  removeVideoKeyframe,
  sampleVideoTransform,
  upsertVideoKeyframe,
  type TimelineVideoKeyframe,
} from '@shared/timeline-keyframes';
import type { TimelineClip } from '@shared/api.interface';

const fmt = (n: number) => Number(n.toFixed(2));

export const TimelineKeyframePanel = ({
  clip,
  curT,
  onSeek,
  onClose,
}: {
  clip: TimelineClip;
  curT: number;
  onSeek: (t: number) => void;
  onClose: () => void;
}) => {
  const editor = useEdl();
  const span = clipSpan(clip);
  const frames = normalizeVideoKeyframes(clip.keyframes);
  const localT = Math.max(0, Math.min(span, (curT - clip.timelineStart)));
  const current = sampleVideoTransform(frames, localT);

  const write = (next: TimelineVideoKeyframe[]) =>
    editor.setClipKeyframes(clip.id, next.length ? next : null);

  const addAtPlayhead = () => {
    write(
      upsertVideoKeyframe(frames, localT, {
        scale: current.scale,
        x: current.x,
        y: current.y,
        rotate: current.rotate,
        easing: 'linear',
      }),
    );
  };

  const patch = (time: number, key: 'scale' | 'x' | 'y' | 'rotate' | 'time', value: number) => {
    if (!Number.isFinite(value)) return;
    if (key === 'time') {
      const moved = frames
        .map((f) => (Math.abs(f.time - time) < 1e-3 ? { ...f, time: Math.max(0, Math.min(span, value)) } : f))
        .sort((a, b) => a.time - b.time);
      write(moved);
      return;
    }
    write(frames.map((f) => (Math.abs(f.time - time) < 1e-3 ? { ...f, [key]: value } : f)));
  };

  return (
    <div className="tl-modal-mask tl-kf-mask" onClick={onClose}>
      <div className="tl-modal tl-kf-modal" onClick={(e) => e.stopPropagation()}>
        <div className="tl-modal-head">
          <b>运镜关键帧 · 缩放 / 平移 / 旋转</b>
          <button type="button" title="关闭" onClick={onClose}>
            <X size={14} />
          </button>
        </div>

        <div className="tl-kf-top">
          <span>
            片段 <b className="num">{clip.text?.slice(0, 24) || clip.id.slice(0, 8)}</b> · {span.toFixed(2)}s
          </span>
          <button type="button" className="tl-kf-add" onClick={addAtPlayhead}>
            在播放头 {localT.toFixed(2)}s 添加关键帧
          </button>
        </div>

        {frames.length === 0 ? (
          <p className="tl-kf-empty">
            当前没有关键帧。添加后，画面会按关键帧在导出与预览中缩放/平移/旋转；
            关键帧之间线性插值，首尾之外保持端点值。
          </p>
        ) : (
          <div className="tl-kf-table">
            <div className="tl-kf-row tl-kf-head">
              <span>时间 (s)</span>
              <span>缩放</span>
              <span>X 平移</span>
              <span>Y 平移</span>
              <span>旋转°</span>
              <span />
            </div>
            {frames.map((f) => (
              <div className="tl-kf-row" key={`${f.time}`}>
                <input
                  type="number"
                  min={0}
                  max={span}
                  step={0.05}
                  value={fmt(f.time)}
                  onChange={(e) => patch(f.time, 'time', Number(e.target.value))}
                />
                <input
                  type="number"
                  min={0.5}
                  max={3}
                  step={0.05}
                  value={fmt(f.scale ?? current.scale)}
                  onChange={(e) => patch(f.time, 'scale', Number(e.target.value))}
                />
                <input
                  type="number"
                  min={-1}
                  max={1}
                  step={0.05}
                  value={fmt(f.x ?? 0)}
                  onChange={(e) => patch(f.time, 'x', Number(e.target.value))}
                />
                <input
                  type="number"
                  min={-1}
                  max={1}
                  step={0.05}
                  value={fmt(f.y ?? 0)}
                  onChange={(e) => patch(f.time, 'y', Number(e.target.value))}
                />
                <input
                  type="number"
                  min={-180}
                  max={180}
                  step={1}
                  value={fmt(f.rotate ?? 0)}
                  onChange={(e) => patch(f.time, 'rotate', Number(e.target.value))}
                />
                <span className="tl-kf-ops">
                  <button
                    type="button"
                    title="跳到这个关键帧"
                    onClick={() => onSeek(clip.timelineStart + f.time)}
                  >
                    定位
                  </button>
                  <button
                    type="button"
                    title="删除这个关键帧"
                    onClick={() => write(removeVideoKeyframe(frames, f.time))}
                  >
                    删
                  </button>
                </span>
              </div>
            ))}
          </div>
        )}

        <div className="tl-kf-foot">
          <span>导出口径：zoompan 按输出帧插值；旋转后四周补黑，不会拉伸素材。</span>
          <button type="button" onClick={() => write([])} disabled={frames.length === 0}>
            清空全部
          </button>
        </div>
      </div>
    </div>
  );
};
