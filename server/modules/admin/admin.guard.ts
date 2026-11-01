import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, timingSafeEqual } from 'crypto';

/**
 * W6 企业版：管理接口守卫。
 * 约定：请求头 x-admin-token 必须等于 ENTERPRISE_ADMIN_TOKEN（项目根 .env 配置）。
 * 未配置该环境变量时所有管理接口拒绝并明示（默认安全，不存在无保护的管理后台）。
 * W1 安全修复：比对改为恒定时间（timingSafeEqual），防止时序侧信道。
 * 网关 W4 会在转发时注入该请求头；直连 3000 端口的管理接口需自行携带。
 *
 * 本轮加固：
 * 1) 失败限流 + 临时锁定：旧实现可无限暴力尝试单个静态 token，没有任何失败计数。
 *    注意这是进程内内存计数，多实例部署需换成 Redis；本项目为单机部署，内存计数足够。
 * 2) 恒定时间比对不再泄漏长度：旧实现先比 a.length !== b.length，
 *    等于把 token 长度直接告诉攻击者（注释宣称的「恒定时间」名不副实）。
 *    改为对双方取 SHA-256 后比对定长 32 字节摘要，长度信息不再外泄，比对仍是恒定时间。
 * 3) 部署告警：x-admin-token 是客户端可自由设置的请求头。若 3000 端口可直连，
 *    任何人都能自己带上它。生产部署必须在边缘（网关 / Nginx）剥离入站的
 *    x-admin-token，或将管理端口限制为内网可达 / mTLS。代码层无法代替边缘配置。
 */
const WINDOW_MS = 5 * 60 * 1000; // 失败计数窗口：5 分钟
const MAX_FAILURES_PER_IP = 10; // 窗口内允许的最大失败次数
const LOCKOUT_MS = 10 * 60 * 1000; // 触发后锁定时长：10 分钟
const MAX_TRACKED_IPS = 4096; // 计数表上限，防止 Map 无界增长

interface AttemptState {
  failures: number;
  windowStart: number;
  lockedUntil: number;
}

@Injectable()
export class AdminGuard implements CanActivate {
  private readonly logger = new Logger(AdminGuard.name);
  private readonly attempts = new Map<string, AttemptState>();

  canActivate(context: ExecutionContext): boolean {
    const expected = process.env.ENTERPRISE_ADMIN_TOKEN;
    if (!expected) {
      throw new UnauthorizedException('未配置管理令牌（ENTERPRISE_ADMIN_TOKEN），管理接口已锁定');
    }
    const req = context.switchToHttp().getRequest<{
      headers?: Record<string, string | undefined>;
      ip?: string;
      socket?: { remoteAddress?: string };
    }>();
    const ip = req.ip ?? req.socket?.remoteAddress ?? 'unknown';
    const now = Date.now();

    // 1) 锁定检查：命中锁定直接拒绝，不再做比对（也避免用比对耗时探测锁定状态）
    const existing = this.attempts.get(ip);
    if (existing && existing.lockedUntil > now) {
      this.logger.warn(
        `管理接口已临时锁定 ip=${ip}，剩余 ${Math.ceil((existing.lockedUntil - now) / 1000)}s`,
      );
      throw new UnauthorizedException('管理令牌尝试过于频繁，已临时锁定，请稍后再试');
    }

    const token =
      req.headers?.['x-admin-token'] ?? req.headers?.['X-Admin-Token'];
    if (this.safeEqual(typeof token === 'string' ? token : '', expected)) {
      this.attempts.delete(ip); // 成功后清零，避免正常运维被历史失败拖累
      return true;
    }

    // 2) 失败计数 + 审计日志（旧实现失败时不留任何记录，无法发现爆破）
    const state = this.recordFailure(ip, now);
    this.logger.warn(
      `管理令牌校验失败 ip=${ip} 窗口内失败=${state.failures}/${MAX_FAILURES_PER_IP}` +
        (state.lockedUntil > now ? '（已触发锁定）' : ''),
    );
    throw new UnauthorizedException('管理令牌无效');
  }

  /**
   * 定长摘要比对。timingSafeEqual 要求等长输入，旧实现用「先比长度」满足这个前提，
   * 代价是泄漏 token 长度。改为比较 SHA-256 摘要（恒为 32 字节）后，
   * 等长前提天然成立，长度信息不再外泄，比对本身仍是恒定时间。
   */
  private safeEqual(actual: string, expected: string): boolean {
    const a = createHash('sha256').update(actual, 'utf8').digest();
    const b = createHash('sha256').update(expected, 'utf8').digest();
    return timingSafeEqual(a, b);
  }

  private recordFailure(ip: string, now: number): AttemptState {
    const prev = this.attempts.get(ip);
    const expired = !prev || now - prev.windowStart > WINDOW_MS;
    const state: AttemptState = expired
      ? { failures: 1, windowStart: now, lockedUntil: 0 }
      : { failures: prev.failures + 1, windowStart: prev.windowStart, lockedUntil: prev.lockedUntil };

    if (state.failures >= MAX_FAILURES_PER_IP) {
      state.lockedUntil = now + LOCKOUT_MS;
      state.failures = 0;
      state.windowStart = now;
    }

    // 防止计数表无界增长：达到上限时先清理已过窗口且未锁定的条目
    if (this.attempts.size >= MAX_TRACKED_IPS) {
      for (const [key, value] of this.attempts) {
        if (value.lockedUntil <= now && now - value.windowStart > WINDOW_MS) {
          this.attempts.delete(key);
        }
      }
    }
    this.attempts.set(ip, state);
    return state;
  }
}
