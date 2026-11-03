/**
 * Studio · 项目工作区
 * -------------------------------------------------------------
 * 路由真源：/project/:id/<seg>
 *   seg = ''            → 舞台=对话，右坞=预览
 *   seg = 'canvas'      → 舞台=无限画布
 *   seg = script/...    → 舞台=对话，右坞=对应 Tab
 *   seg = overview/...  → 舞台=内容页（复用既有页签）
 *
 * 组件本身不需要读路由参数（StudioShell 统一解析），这里只做语义占位。
 */
import { StudioShell } from '@client/src/components/studio/StudioShell';

const StudioProjectPage = () => <StudioShell />;

export default StudioProjectPage;
