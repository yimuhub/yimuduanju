import { useNavigate } from 'react-router-dom';
import { useNickname, getAvatarInitial, TIER_LABEL } from '@client/src/lib/identity';
import { APP_VERSION } from '@client/src/lib/version';

/**
 * 侧栏底部用户卡 + 版本徽标（共享组件）
 * ─────────────────────────────────────────────
 * 经典模式侧栏底部（ClassicLayout）与极客模式左栏底部（AgentStudio）
 * 此前各自维护一份「昵称监听 useEffect + 用户卡 + v{APP_VERSION} 徽标」，
 * 现统一收敛：昵称单一来源 useNickname()（lib/identity），点击进用户中心。
 *
 * size:
 *   md  = 经典侧栏（h-9 头像 · text-sm 昵称 · text-xs 等级）
 *   sm  = 极客左栏（h-8 头像 · text-xs 昵称 · text-[10px] 等级 · 在线绿点）
 */

interface SidebarUserCardProps {
  size?: 'md' | 'sm';
  /** 折叠态只显示头像（经典侧栏图标模式） */
  collapsed?: boolean;
  title?: string;
}

const SidebarUserCard = ({ size = 'md', collapsed = false, title }: SidebarUserCardProps) => {
  const navigate = useNavigate();
  const nickname = useNickname();

  const avatarCls =
    size === 'md'
      ? 'h-9 w-9 text-sm'
      : 'h-8 w-8 text-xs';
  const nameCls = size === 'md' ? 'text-sm font-medium' : 'text-xs font-medium';
  const tierCls = size === 'md' ? 'text-xs' : 'text-[10px]';

  return (
    <>
      <button
        onClick={() => navigate('/account')}
        title={title ?? (collapsed ? nickname : `${nickname} · 进入用户中心`)}
        className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors hover:bg-sidebar-accent ${
          collapsed ? 'justify-center' : ''
        }`}
      >
        <div
          className={`flex shrink-0 items-center justify-center rounded-full bg-brand-gradient font-semibold text-white ${avatarCls}`}
        >
          {getAvatarInitial(nickname)}
        </div>
        {!collapsed && (
          <div className="min-w-0 flex-1 overflow-hidden">
            <div className={`truncate text-sidebar-foreground ${nameCls}`}>{nickname}</div>
            <div className={`truncate text-sidebar-foreground/60 ${tierCls}`}>{TIER_LABEL}</div>
          </div>
        )}
        {size === 'sm' && !collapsed && (
          <span className="ml-auto h-2 w-2 shrink-0 rounded-full bg-emerald-500" title="在线" />
        )}
      </button>
      {!collapsed && APP_VERSION && (
        <div className="pt-1 text-center text-[10px] text-sidebar-foreground/30" title={APP_VERSION}>
          v{APP_VERSION}
        </div>
      )}
    </>
  );
};

export default SidebarUserCard;
