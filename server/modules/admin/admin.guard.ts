import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { timingSafeEqual } from 'crypto';

/**
 * W6 企业版：管理接口守卫。
 * 约定：请求头 x-admin-token 必须等于 ENTERPRISE_ADMIN_TOKEN（项目根 .env 配置）。
 * 未配置该环境变量时所有管理接口拒绝并明示（默认安全，不存在无保护的管理后台）。
 * W1 安全修复：比对改为恒定时间（timingSafeEqual），防止时序侧信道。
 * 网关 W4 会在转发时注入该请求头；直连 3000 端口的管理接口需自行携带。
 */
@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const expected = process.env.ENTERPRISE_ADMIN_TOKEN;
    if (!expected) {
      throw new UnauthorizedException('未配置管理令牌（ENTERPRISE_ADMIN_TOKEN），管理接口已锁定');
    }
    const req = context.switchToHttp().getRequest<{
      headers?: Record<string, string | undefined>;
    }>();
    const token =
      req.headers?.['x-admin-token'] ?? req.headers?.['X-Admin-Token'];
    const a = typeof token === 'string' ? Buffer.from(token) : Buffer.alloc(0);
    const b = Buffer.from(expected);
    // 先比长度（timingSafeEqual 要求等长），再恒定时间比对
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException('管理令牌无效');
    }
    return true;
  }
}
