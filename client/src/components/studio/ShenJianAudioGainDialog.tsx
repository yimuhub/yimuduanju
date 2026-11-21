/**
 * 音频增益对话框（G10，OpenMotion AudioGainDialog 对齐）
 * -------------------------------------------------------------
 * 选中片段（含音频）按 G 弹出：fader 滑杆映射片段 volume 0–2 → dB 读数，
 * 0dB 中心刻度线（volume 1 = 原声），拖动实时预览（自定义事件通知 ShenJianStage，
 * 不写 EDL），确认批量应用到所有选中片段（走既有 setClipVolume，auto: 内嵌原声
 * 自动镜像）；Esc / 取消还原打开时的值。
 */
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import type { TimelineClip } from '@shared/api.interface';
import { useEdl } from './EdlContext';
import { PREVIEW_VOLUME_EVENT } from './ShenJianStage';

const DB_MIN = -60;
const DB_MAX = 6;
/** fader 全程换算：dB → volume（0–2）；贴底吸附为静音 0 */
const dbToVolume = (db: number) => {
  if (db <= DB_MIN + 1e-6) return 0;
  return Math.max(0, Math.min(2, Math.pow(10, db / 20)));
};
const volumeToDb = (volume: number) => {
  const v = Math.max(0, Math.min(2, volume));
  if (v <= 0.001) return DB_MIN;
  return Math.max(DB_MIN, Math.min(DB_MAX, 20 * Math.log10(v)));
};
const dbText = (db: number) => (db <= DB_MIN + 1e-6 ? '−∞' : `${db > 0 ? '+' : ''}${db.toFixed(1)}`);

/** fader 刻度：0dB 在 (0-(-60))/66 ≈ 90.9% 处，即中心刻度线偏右是正常形态 */
const dbPct = (db: number) => ((db - DB_MIN) / (DB_MAX - DB_MIN)) * 100;
const SCALE_TICKS = [-60, -48, -36, -24, -12, -6, 0, 6];

export const ShenJianAudioGainDialog = ({
  targets,
  onClose,
}: {
  targets: TimelineClip[];
  onClose: () => void;
}) => {
  const edl = useEdl();
  // 初值取时间线顺序里最后一个选中片段；多选批量应用同一目标值
  const first = targets[targets.length - 1] ?? targets[0];
  const [db, setDb] = useState(() => volumeToDb(first?.volume ?? 1));
  const [applied, setApplied] = useState(false);

  // 卸载即清空实时预览：确认/取消/Escape 三条路都经过这里
  useEffect(() => () => {
    window.dispatchEvent(new CustomEvent(PREVIEW_VOLUME_EVENT, { detail: null }));
  }, []);

  // Escape 取消还原；Enter 确认（输入焦点在滑杆上时同样生效）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        apply();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const volume = useMemo(() => dbToVolume(db), [db]);

  /** 拖动实时预览：按片段广播临时音量，Stage 叠乘在包络之前，不落库 */
  const preview = (nextDb: number) => {
    setDb(nextDb);
    const v = dbToVolume(nextDb);
    for (const clip of targets) {
      window.dispatchEvent(new CustomEvent(PREVIEW_VOLUME_EVENT, { detail: { id: clip.id, volume: v } }));
    }
  };

  const apply = () => {
    for (const clip of targets) edl.setClipVolume(clip.id, volume);
    setApplied(true);
    window.dispatchEvent(new CustomEvent(PREVIEW_VOLUME_EVENT, { detail: null }));
    toast.success(
      targets.length > 1
        ? `已应用到 ${targets.length} 个片段：${dbText(db)} dB`
        : `已设置音量 ${dbText(db)} dB`,
    );
    onClose();
  };

  return (
    <div className="modal-mask open" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal gain-dialog" role="dialog" aria-modal="true" aria-label="音频增益" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          音频增益
          <button type="button" className="x icon-btn" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="mini-note" style={{ marginBottom: 10 }}>
            {targets.length > 1
              ? `批量调整 ${targets.length} 个片段的音量（拖动实时试听，确认后写入片段）`
              : '拖动推子调整片段音量（实时试听，确认后写入片段）；0dB = 原声'}
          </div>
          <div className="gain-fader">
            <div className="gain-scale" aria-hidden>
              {SCALE_TICKS.map((t) => (
                <span key={t} style={{ left: `${dbPct(t)}%` }} className={t === 0 ? 'zero' : ''}>
                  {t === 0 ? '0dB' : t === -60 ? '−∞' : `${t > 0 ? '+' : ''}${t}`}
                </span>
              ))}
            </div>
            <div className="gain-fader-track">
              <span className="gain-zero-tick" style={{ left: `${dbPct(0)}%` }} />
              <input
                type="range"
                min={DB_MIN}
                max={DB_MAX}
                step={0.1}
                value={db}
                aria-label="片段音量（dB）"
                aria-valuetext={`${dbText(db)} dB`}
                onChange={(e) => preview(Number(e.target.value))}
              />
            </div>
            <div className="gain-readout">
              <b>{dbText(db)} dB</b>
              <span>{Math.round(volume * 100)}%</span>
              <span className="gain-clip-name" title={first ? `当前：${first.text || first.sourceUrl || ''}` : ''}>
                {first?.text || first?.sourceUrl?.split('/').pop() || '音频片段'}
                {targets.length > 1 ? ` 等 ${targets.length} 个片段` : ''}
              </span>
            </div>
          </div>
        </div>
        <div className="modal-foot">
          <span className="mini-note" style={{ marginRight: 'auto' }}>Esc 取消还原 · Enter 确认</span>
          <button
            type="button"
            className="btn"
            onClick={() => {
              window.dispatchEvent(new CustomEvent(PREVIEW_VOLUME_EVENT, { detail: null }));
              onClose();
            }}
          >
            取消
          </button>
          <button type="button" className="btn primary" disabled={applied} onClick={apply}>
            确认
          </button>
        </div>
      </div>
    </div>
  );
};

export default ShenJianAudioGainDialog;
