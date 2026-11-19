/**
 * 同构版时间线外壳：第一行是“工具 + 录音 / 自动字幕 / 智能包装”快捷条，
 * 第二行沿用 ShenJianTimeline 的真实工具条与轨道区。
 * 已有剪辑动作直接调用 EDL；未接入的能力只提示，不伪造结果。
 */
import { Captions, Copy, Gauge, Mic, MousePointer2, Redo2, Scissors, Trash2, Undo2, Wand2 } from 'lucide-react';
import { toast } from 'sonner';
import { useStudio } from './StudioShell';
import { useEdl } from './EdlContext';
import { ShenJianTimeline } from './ShenJianTimeline';
import { clipSpan } from './model';

export const ParityTimeline = ({
  snapOn,
  setSnapOn,
}: {
  snapOn: boolean;
  setSnapOn: (v: boolean) => void;
}) => {
  const { data, curT } = useStudio();
  const edl = useEdl();
  const selected = (data.timeline?.clips ?? []).find((c) => edl.selectedIds.includes(c.id)) ?? null;

  const splitAtPlayhead = () => {
    const hit = selected ?? (data.timeline?.clips ?? []).find(
      (c) => c.track === 'video' && curT >= c.timelineStart && curT < c.timelineStart + clipSpan(c),
    );
    if (!hit) {
      toast.info('播放头下没有可分割片段');
      return;
    }
    const next = edl.splitAtPlayhead(curT, hit.id);
    if (next) toast.success('已分割');
    else toast.info('播放头不在片段内');
  };

  return (
    <div className="parity-timeline">
      <div className="parity-tl-toolbar">
        <button type="button" className="ptl-btn active" title="选择工具 (A)" onClick={() => window.dispatchEvent(new CustomEvent('yimu:shenjian-tool', { detail: 'select' }))}>
          <MousePointer2 /><span>选择</span>
        </button>
        <button type="button" className="ptl-btn" title="分割 (E)" onClick={splitAtPlayhead}>
          <Scissors /><span>分割</span>
        </button>
        <span className="ptl-sep" />
        <button type="button" className="ptl-btn" title="撤销 (Ctrl+Z)" onClick={() => edl.undo()}>
          <Undo2 />
        </button>
        <button type="button" className="ptl-btn" title="重做 (Ctrl+Shift+Z)" onClick={() => edl.redo()}>
          <Redo2 />
        </button>
        <button type="button" className="ptl-btn" title="删除选中片段" disabled={!selected} onClick={() => selected && edl.rippleDelete([selected.id])}>
          <Trash2 />
        </button>
        <button type="button" className="ptl-btn" title="复制选中片段" disabled={!selected} onClick={() => selected && edl.copySelection([selected.id])}>
          <Copy />
        </button>
        <span className="ptl-sep" />
        <button type="button" className="ptl-btn" title="变速：打开检查器变速页" onClick={() => window.dispatchEvent(new CustomEvent('yimu:shenjian-inspector-main', { detail: 'speed' }))}>
          <Gauge /><span>变速</span>
        </button>
        <span className="ptl-sep" />
        <button type="button" className="ptl-btn pending" title="录音能力待接入" onClick={() => toast.info('同构版占位：录音能力待接入，经典版也未提供')}>
          <Mic /><span>录音</span>
        </button>
        <button type="button" className="ptl-btn pending" title="自动字幕待接入" onClick={() => toast.info('同构版占位：自动字幕待接入；当前可手动加字幕轨')}>
          <Captions /><span>自动字幕</span><span className="ptl-ai">AI</span>
        </button>
        <button type="button" className="ptl-btn pending" title="智能包装待接入" onClick={() => toast.info('同构版占位：智能包装待接入；当前保留字幕、贴纸与模板能力')}>
          <Wand2 /><span>智能包装</span>
        </button>
        <span className="ptl-grow" />
        <div className="ptl-zoom">
          <span>缩放</span>
          <input
            type="range"
            min="14"
            max="120"
            defaultValue="44"
            aria-label="时间线缩放"
            onChange={(e) => window.dispatchEvent(new CustomEvent('yimu:shenjian-zoom-set', { detail: Number(e.target.value) }))}
          />
          <em>px/s</em>
        </div>
        <span className="ptl-note">同构版 · 第一行快捷条</span>
      </div>
      <ShenJianTimeline snapOn={snapOn} setSnapOn={setSnapOn} />
    </div>
  );
};

export default ParityTimeline;
