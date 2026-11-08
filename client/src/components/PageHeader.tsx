import type { ReactNode } from 'react';

/**
 * 全站统一页头（Z Code 式工作台基准）：
 * 左侧标题 + 副标题描述，右侧主操作按钮区（actions）。
 * Dashboard / 作战室 / 画布保持自有头部，其余中心内容页统一使用本组件。
 */
interface PageHeaderProps {
  title: string;
  description?: ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
  actions?: ReactNode;
}

const PageHeader = ({ title, description, icon: Icon, actions }: PageHeaderProps) => (
  /* @container：本组件可能在极客模式右栏 ~400px 窄容器内渲染，
     断点一律用容器查询（@md）而非视口断点（md:），避免窄坞内横向挤压 */
  <div className="@container flex flex-col gap-4 @md:flex-row @md:items-start @md:justify-between">
    <div className="min-w-0">
      <h1 className="flex items-center gap-2 text-xl font-semibold text-foreground">
        {Icon && <Icon className="h-5 w-5 shrink-0 text-primary" />}
        <span className="truncate">{title}</span>
      </h1>
      {description && (
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      )}
    </div>
    {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
  </div>
);

export default PageHeader;
