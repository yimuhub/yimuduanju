/**
 * Studio · 既有整页塞进中舞台
 * -------------------------------------------------------------
 * 项目列表 / 模板中心 / 资产库 / 设置 等原本是整页的页面，
 * 在 Studio 外壳里作为「内容页」渲染：无项目时右坞与时间线自动隐藏，
 * 给内容留出完整宽度（换 UI 不丢功能）。
 */
import { Outlet } from 'react-router-dom';
import { StudioShell } from '@client/src/components/studio/StudioShell';

const StudioSectionPage = () => (
  <StudioShell>
    <div className="studio-page">
      <Outlet />
    </div>
  </StudioShell>
);

export default StudioSectionPage;
