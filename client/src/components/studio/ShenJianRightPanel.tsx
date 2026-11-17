/**
 * 一幕·神剪 · 右侧工作区
 * 检查器为主，镜头池作为第二个 Tab 保留原有选镜 / 拖入时间线能力。
 */
import { useState } from 'react';
import { SlidersHorizontal, Clapperboard } from 'lucide-react';
import { ShenJianInspector } from './ShenJianInspector';
import { StudioShotPool } from './StudioShotPool';

export const ShenJianRightPanel = () => {
  const [tab, setTab] = useState<'inspector' | 'shots'>('inspector');
  return (
    <div className="sj-right">
      <div className="sj-right-tabs" role="tablist" aria-label="神剪右侧面板">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'inspector'}
          className={tab === 'inspector' ? 'on' : ''}
          onClick={() => setTab('inspector')}
        >
          <SlidersHorizontal size={12} /> 检查器
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'shots'}
          className={tab === 'shots' ? 'on' : ''}
          onClick={() => setTab('shots')}
        >
          <Clapperboard size={12} /> 镜头池
        </button>
      </div>
      <div className="sj-right-body">
        {tab === 'inspector' ? <ShenJianInspector /> : <StudioShotPool />}
      </div>
    </div>
  );
};

export default ShenJianRightPanel;
