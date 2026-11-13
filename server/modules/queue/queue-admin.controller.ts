import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { IsBoolean, IsIn, IsOptional, IsUUID } from 'class-validator';
import type {
  KeyLanesResponse,
  PinProjectKeyResult,
  QueueActionResult,
  QueueMoveDirection,
  QueueOverviewResponse,
} from '@shared/api.interface';
import { QueueAdminService } from './queue-admin.service';

const QUEUE_DIRECTIONS = ['up', 'down', 'top', 'bottom'] as const;

class QueueMoveDto {
  @IsIn([...QUEUE_DIRECTIONS])
  direction!: QueueMoveDirection;
}

class QueueGlobalPauseDto {
  @IsBoolean()
  paused!: boolean;
}

/** 钉 Key：传 keyId 表示钉住，传 null 表示解钉 */
class PinProjectKeyDto {
  @IsOptional()
  @IsUUID()
  keyId?: string | null;
}

/**
 * 全站排队 API。与 /api/generation/jobs（单项目任务列表、按时间倒序）互补：
 * 这里只关心「还没终结的任务、按真实执行顺序、可人工干预」。
 */
@Controller('api/queue')
export class QueueAdminController {
  constructor(private readonly queue: QueueAdminService) {}

  /** 全站队列总览：按 queue_seq 升序，即消费器的真实认领顺序 */
  @Get('overview')
  overview(): Promise<QueueOverviewResponse> {
    return this.queue.overview();
  }

  /** 暂停排队中的任务；下游依赖任务级联暂停，后面的任务自动补位 */
  @Post('jobs/:id/pause')
  pause(@Param('id', ParseUUIDPipe) id: string): Promise<QueueActionResult> {
    return this.queue.pauseJob(id);
  }

  /** 恢复到原排队位置，并级联恢复下游 */
  @Post('jobs/:id/resume')
  resume(@Param('id', ParseUUIDPipe) id: string): Promise<QueueActionResult> {
    return this.queue.resumeJob(id);
  }

  /** 终止（不可逆）；下游依赖任务一并终止，避免永久 blocked */
  @Post('jobs/:id/terminate')
  terminate(@Param('id', ParseUUIDPipe) id: string): Promise<QueueActionResult> {
    return this.queue.terminateJob(id);
  }

  /** 上移 / 下移 / 置顶 / 置底 */
  @Post('jobs/:id/move')
  move(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: QueueMoveDto,
  ): Promise<QueueActionResult> {
    return this.queue.moveJob(id, body.direction);
  }

  /** 一键按项目轮转重排（默认仍是严格提交顺序，只有主动调用才改变） */
  @Post('round-robin')
  roundRobin(): Promise<{ reordered: number; message: string }> {
    return this.queue.roundRobin();
  }

  /** 全站消费暂停/恢复（进程级） */
  @Post('global-pause')
  globalPause(@Body() body: QueueGlobalPauseDto): { globallyPaused: boolean; message: string } {
    return this.queue.setGlobalPause(body.paused);
  }

  /** 密钥车道：每把 Key 的并发额度 / 在途 / 冷却 / 钉住它的项目 */
  @Get('key-lanes')
  keyLanes(): Promise<KeyLanesResponse> {
    return this.queue.keyLanes();
  }

  /**
   * 重算排队任务的通道路由（改完环节绑定后点一下）：
   * 把当前绑定的供应商/模型写回还没上游建单的任务，否则换了模型的老任务
   * 会一直在旧供应商那边轮询，表现为「改了没用、一直失败」。
   */
  @Post('recalculate-routes')
  recalculateRoutes(): Promise<{ updated: number; skipped: number; message: string }> {
    return this.queue.recalculateRoutes();
  }

  /** 给项目钉一把 Key（项目间互不抢并发额度）；keyId=null 解钉 */
  @Post('projects/:id/pin-key')
  pinProjectKey(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: PinProjectKeyDto,
  ): Promise<PinProjectKeyResult> {
    return this.queue.pinProjectKey(id, body.keyId ?? null);
  }
}
