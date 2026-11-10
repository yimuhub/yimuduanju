/**
 * 右产出坞「道具」专页 · /project/:id/props
 * -------------------------------------------------------------
 * 与圣经页里的「道具一致性」分区共用 PropsPanel，数据同源于 props 表，
 * 避免出现两份互不同步的道具清单。
 */
import { useParams } from 'react-router-dom';
import { Box } from 'lucide-react';
import PropsPanel from './PropsPanel';

export const StudioPropsTab = () => {
  const { id } = useParams<{ id: string }>();
  if (!id) {
    return (
      <div className="dp-empty">
        <div className="dp-empty-ico"><Box size={20} /></div>
        <b>还没有进入项目</b>
        <p>进入项目后，这里会从剧本提取并管理本片所有道具资产。</p>
      </div>
    );
  }
  return <PropsPanel projectId={id} variant="full" />;
};

export default StudioPropsTab;
